import { NextResponse } from "next/server";
import { bookByOrder } from "@/lib/bible/books";
import {
	chapterTimingUrl,
	chapterWordsUrl,
	hasAlive,
	hasNarration,
	hasWordTimings,
	parseChapterTiming,
	parseEdition,
	withWordTimings,
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
 * `edition=alive` asks for the book's Alive recording instead (LC-15532);
 * a book without one answers unavailable, so clients offer only the Listen
 * choices that exist.
 *
 * A recording with word timings (LC-17909) also carries `words` on each verse
 * it could align, read from the `.words.json` beside the MP3 in the same
 * request. A missing or broken words file only leaves them out.
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
	if (!hasNarration(book) || (edition === "alive" && !hasAlive(book))) {
		return NextResponse.json(UNAVAILABLE, { headers: { "Cache-Control": CACHE_CONTROL } });
	}
	try {
		const read = (url: string, timeoutMs: number) =>
			fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(timeoutMs) });
		const [response, wordsResponse] = await Promise.all([
			read(chapterTimingUrl(book, chapter, edition), 10_000),
			// The words are extra: a slow bucket drops them rather than holding up the chapter.
			hasWordTimings(book, edition) ? read(chapterWordsUrl(book, chapter, edition), 3_000).catch(() => null) : null,
		]);
		// The bucket answers 403 (not 404) for a key that does not exist yet.
		const timing = response.ok ? parseChapterTiming(await response.json(), book, chapter, edition) : null;
		const words = timing && wordsResponse?.ok ? await wordsResponse.json().catch(() => null) : null;
		const audio = timing ? withWordTimings(timing, words) : null;
		return NextResponse.json(audio ?? UNAVAILABLE, {
			headers: { "Cache-Control": audio ? CACHE_CONTROL : UNAVAILABLE_CACHE_CONTROL },
		});
	} catch (error) {
		console.error("Error in bible/audio route:", error);
		// Not cached: a blip at the bucket should not hide Listen for a day.
		return NextResponse.json(UNAVAILABLE, { headers: { "Cache-Control": "no-store" } });
	}
}
