import { NextResponse } from "next/server";
import { bookByOrder } from "@/lib/bible/books";
import { getOriginalVerse } from "@/lib/bible/originals";

export const maxDuration = 10;

// The Hebrew and Greek texts are public domain and ship inside the deploy, so
// nothing here can go stale except through a new build. Cache hard: this is the
// per-tap request every client makes when a reader opens a verse.
const cacheHeaders = {
	"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

/**
 * Parse a 1-based query param. Digits only, so "1.5", "-1" and "one" are all
 * rejected rather than silently coerced by Number().
 */
function positiveInteger(raw: string | null): number | null {
	if (raw === null) return null;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return value >= 1 ? value : null;
}

/**
 * The original-language text of one verse, word by word with Strong's numbers,
 * morphology and glosses. Public: the text is public domain and carries no user
 * state, and every client needs it before a session exists.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		const params = new URL(req.url).searchParams;
		const book = positiveInteger(params.get("book"));
		const chapter = positiveInteger(params.get("chapter"));
		const verse = positiveInteger(params.get("verse"));

		// Only the book has an upper bound worth checking here; an out-of-range
		// chapter or verse is a legitimate miss and answers 404 below.
		if (book === null || book > 66 || chapter === null || verse === null) {
			return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		}

		const original = await getOriginalVerse(book, chapter, verse);
		if (!original) {
			// A miss is a permanent fact about the versification, so cache it as
			// hard as a hit: every client asks this on every fresh load.
			return NextResponse.json({ error: "not_found" }, { status: 404, headers: cacheHeaders });
		}

		// book is already known to be 1-66, so this always resolves; the fallback
		// only exists to keep the value a string without a non-null assertion.
		const name = bookByOrder(book)?.name ?? String(book);

		return NextResponse.json(
			{
				book,
				chapter,
				verse,
				reference: `${name} ${chapter}:${verse}`,
				language: original.language,
				textName: original.textName,
				words: original.words,
			},
			{ headers: cacheHeaders }
		);
	} catch (error) {
		console.error("[api/bible/original] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
