import { NextResponse } from "next/server";
import { bookByOrder } from "@/lib/bible/books";
import {
	aliveSources,
	chapterTimingUrl,
	hasNarration,
	parseChapterTiming,
	parseEdition,
	type AliveText,
	type AudioEdition,
	type ChapterAudio,
	type ChapterAudioResponse,
} from "@/lib/bible/audioBible";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
/** "No narration yet" is cached briefly, so a newly uploaded chapter shows up within minutes. */
const UNAVAILABLE_CACHE_CONTROL = "public, max-age=300, s-maxage=300";
const UNAVAILABLE: ChapterAudioResponse = { status: "unavailable" };

/**
 * The narrated KJV for one chapter: where its MP3 is and when each verse
 * starts, for the reader's Listen player on every client. Public and free:
 * the audio was rendered once (see src/lib/bible/audioBible.ts), so a play
 * costs storage egress, never a generation.
 *
 * `status: "unavailable"` means this chapter has no narration yet (one not
 * uploaded), and the clients then show no Listen
 * control at all. The timing file is read from our media bucket and cached
 * for a day, so the bucket sees about one request per chapter per day.
 *
 * `edition=alive` asks for the chapter's Alive recording instead (LC-15532):
 * the ASV recording when one is uploaded, else the LC Greek one for Matthew
 * to John (`aliveSources`), else unavailable, so clients offer only the
 * Listen choices that exist. There is no list of Alive books (LC-17800): a
 * chapter uploaded to the ASV folder answers here once the unavailable
 * answer's few-minute cache runs out, and `text` says which one it reads.
 */
export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const book = Number(params.get("book"));
	const chapter = Number(params.get("chapter"));
	const selectedBook = bookByOrder(book);
	const edition = parseEdition(params.get("edition"));
	if (
		!edition ||
		!/^\d+$/.test(params.get("book") ?? "") ||
		!/^\d+$/.test(params.get("chapter") ?? "") ||
		!selectedBook ||
		chapter < 1 ||
		chapter > selectedBook.chapters
	) {
		return NextResponse.json(
			{ error: "Use book=1–66, a valid chapter and edition=regular|alive." },
			{ status: 400 }
		);
	}
	if (!hasNarration(book)) {
		return NextResponse.json(UNAVAILABLE, { headers: { "Cache-Control": CACHE_CONTROL } });
	}
	try {
		let audio: ChapterAudio | null = null;
		const texts: (AliveText | undefined)[] = edition === "alive" ? aliveSources(book) : [undefined];
		for (const text of texts) {
			audio = await readTiming(book, chapter, edition, text);
			if (audio) break;
		}
		return NextResponse.json(audio ?? UNAVAILABLE, {
			headers: { "Cache-Control": audio ? CACHE_CONTROL : UNAVAILABLE_CACHE_CONTROL },
		});
	} catch (error) {
		console.error("Error in bible/audio route:", error);
		// Not cached: a blip at the bucket should not hide Listen for a day.
		return NextResponse.json(UNAVAILABLE, { headers: { "Cache-Control": "no-store" } });
	}
}

/**
 * One folder's timing file for the chapter, or null when it has none. Only a
 * 200 is kept in Next's fetch cache (a day); the bucket answers 403 (not 404)
 * for a key that does not exist yet, and that is never cached here.
 */
async function readTiming(
	book: number,
	chapter: number,
	edition: AudioEdition,
	text: AliveText | undefined
): Promise<ChapterAudio | null> {
	const response = await fetch(chapterTimingUrl(book, chapter, edition, text), {
		next: { revalidate: 86400 },
		signal: AbortSignal.timeout(10_000),
	});
	return response.ok ? parseChapterTiming(await response.json(), book, chapter, edition, text) : null;
}
