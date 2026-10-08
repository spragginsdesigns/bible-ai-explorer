import { NextResponse } from "next/server";
import { bookByOrder } from "@/lib/bible/books";
import {
	chapterTimingUrl,
	hasNarration,
	parseChapterTiming,
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
 * `status: "unavailable"` means this chapter has no narration yet (the Old
 * Testament, until it is rendered), and the clients then show no Listen
 * control at all. The timing file is read from our media bucket and cached
 * for a day, so the bucket sees about one request per chapter per day.
 */
export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const book = Number(params.get("book"));
	const chapter = Number(params.get("chapter"));
	const selectedBook = bookByOrder(book);
	if (
		!/^\d+$/.test(params.get("book") ?? "") ||
		!/^\d+$/.test(params.get("chapter") ?? "") ||
		!selectedBook ||
		chapter < 1 ||
		chapter > selectedBook.chapters
	) {
		return NextResponse.json({ error: "Use book=1–66 and a valid chapter." }, { status: 400 });
	}
	if (!hasNarration(book)) {
		return NextResponse.json(UNAVAILABLE, { headers: { "Cache-Control": CACHE_CONTROL } });
	}
	try {
		const response = await fetch(chapterTimingUrl(book, chapter), { next: { revalidate: 86400 } });
		// The bucket answers 403 (not 404) for a key that does not exist yet.
		const audio = response.ok ? parseChapterTiming(await response.json(), book, chapter) : null;
		return NextResponse.json(audio ?? UNAVAILABLE, {
			headers: { "Cache-Control": audio ? CACHE_CONTROL : UNAVAILABLE_CACHE_CONTROL },
		});
	} catch (error) {
		console.error("Error in bible/audio route:", error);
		// Not cached: a blip at the bucket should not hide Listen for a day.
		return NextResponse.json(UNAVAILABLE, { headers: { "Cache-Control": "no-store" } });
	}
}
