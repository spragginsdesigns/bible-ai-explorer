import { NextResponse } from "next/server";
import { bookByOrder } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { searchOriginalVerses } from "@/lib/bible/original-search";
import { lookupStrongsEntry } from "@/lib/bible/originals";
import { cleanGloss } from "@/lib/bible/original-text";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import type { StrongsOccurrence, StrongsOccurrences } from "@/lib/verse-words-contract";

export const maxDuration = 10;

// Same reasoning as /api/bible/original: public-domain dictionary data bundled
// with the deploy, requested once per Strong's number a reader taps. The
// occurrence list comes from the OriginalVerse index, which only changes with
// a deploy-time backfill, so it is cached just as hard.
const cacheHeaders = {
	"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

const STRONGS_NUMBER = /^[HG]\d{1,5}$/;
/** "21:4:6": the verse the reader is on, left out of the examples. */
const EXCLUDE = /^(\d{1,2}):(\d{1,3}):(\d{1,3})$/;
const MAX_EXAMPLES = 5;

/**
 * Other places the number occurs, as KJV references with the KJV verse text.
 * Rows without a KJV alignment (a Psalm title in the Hebrew numbering) are
 * skipped: the reader is shown English they can open, not a bare number.
 */
async function occurrencesFor(
	number: string,
	examples: number,
	exclude: { book: number; chapter: number; verse: number } | null
): Promise<StrongsOccurrences> {
	// Headroom for the reader's own verse and for rows the KJV numbering does
	// not align (Psalm titles), both of which are dropped below.
	const result = await searchOriginalVerses({ strongs: [number], limit: examples + 4 });
	const picked: StrongsOccurrence[] = [];
	for (const row of result.rows) {
		if (picked.length >= examples) break;
		if (row.kjvBook === null || row.kjvChapter === null || row.kjvVerse === null) continue;
		if (
			exclude &&
			row.kjvBook === exclude.book &&
			row.kjvChapter === exclude.chapter &&
			row.kjvVerse === exclude.verse
		) {
			continue;
		}
		const name = bookByOrder(row.kjvBook)?.name;
		if (!name) continue;
		let text: string | undefined;
		try {
			text = (await getKjvChapter(row.kjvBook, row.kjvChapter))[row.kjvVerse - 1];
		} catch {
			continue;
		}
		if (!text) continue;
		picked.push({
			reference: `${name} ${row.kjvChapter}:${row.kjvVerse}`,
			text: bibleVersePlainText(text),
		});
	}
	return { total: result.total, examples: picked };
}

/**
 * One Strong's Hebrew or Greek dictionary entry. Public for the same reason as
 * the original-language verse route: public-domain reference data, no user
 * state. With `examples=<1-5>` the answer also carries where else the number
 * occurs (`occurrences`), skipping the verse named by `exclude=book:chapter:verse`.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		const params = new URL(req.url).searchParams;
		const raw = params.get("number")?.trim().toUpperCase() ?? "";
		if (!STRONGS_NUMBER.test(raw)) {
			return NextResponse.json({ error: "invalid_number" }, { status: 400 });
		}

		// Word records carry zero-padded numbers ("H0430") but the dictionary is
		// keyed unpadded, so normalize before echoing the number back to callers.
		const number = raw.replace(/^([HG])0+(?=\d)/, "$1");

		const entry = await lookupStrongsEntry(number);
		if (!entry) {
			return NextResponse.json({ error: "not_found" }, { status: 404, headers: cacheHeaders });
		}

		const examplesRaw = params.get("examples");
		let occurrences: StrongsOccurrences | undefined;
		if (examplesRaw !== null) {
			const examples = Number(examplesRaw);
			if (!Number.isInteger(examples) || examples < 1 || examples > MAX_EXAMPLES) {
				return NextResponse.json({ error: "invalid_examples" }, { status: 400 });
			}
			const excludeMatch = params.get("exclude")?.match(EXCLUDE) ?? null;
			const exclude = excludeMatch
				? { book: Number(excludeMatch[1]), chapter: Number(excludeMatch[2]), verse: Number(excludeMatch[3]) }
				: null;
			try {
				occurrences = await occurrencesFor(number, examples, exclude);
			} catch (error) {
				// The index lives in the database; the dictionary entry does not.
				// A reader still gets the definition when the index is unreachable.
				console.error("[api/bible/strongs] occurrence lookup failed", error);
			}
		}

		return NextResponse.json(
			{
				number,
				lemma: entry.lemma,
				translit: entry.translit,
				def: entry.def,
				kjv: cleanGloss(entry.kjv),
				...(occurrences ? { occurrences } : {}),
			},
			{ headers: cacheHeaders }
		);
	} catch (error) {
		console.error("[api/bible/strongs] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
