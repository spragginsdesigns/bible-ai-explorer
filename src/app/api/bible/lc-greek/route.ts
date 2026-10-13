import { NextResponse } from "next/server";
import { bookByOrder } from "@/lib/bible/books";
import type { LcGreekResponse } from "@/lib/bible/audioBible";
import { loadLcGreekChapter } from "@/lib/bible/lcGreek";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
const UNAVAILABLE: LcGreekResponse = { status: "unavailable" };

/**
 * One chapter of the LC Greek (LC-15842), SureWord's own translation that the
 * Alive recordings read, for the Android and Apple readers (web imports the
 * same bundled text). Public: it is our own text. A book without LC Greek
 * answers unavailable, and the clients then offer no LC Greek chip.
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
	const verses = await loadLcGreekChapter(book, chapter);
	const body: LcGreekResponse = verses ? { status: "ready", book, chapter, verses } : UNAVAILABLE;
	return NextResponse.json(body, { headers: { "Cache-Control": CACHE_CONTROL } });
}
