import { NextResponse } from "next/server";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getCrossReferencesFor, type CrossReference } from "@/lib/bible/crossRefs";
import { getVerseText, TRANSLATIONS, type TranslationId } from "@/lib/bible/translations";

export const maxDuration = 10;

// The cross-reference set ships inside the deploy (src/data/crossrefs, built
// from openbible.info, CC-BY) and the verse text it quotes is Scripture, so
// nothing here can go stale except through a new build. Same header as
// /api/bible/original, and safe to mark public: the answer is a function of the
// query string alone and carries no user state.
const cacheHeaders = {
	"Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
/** Longest same-chapter span quoted inline, matching the getCrossReferences tool. */
const MAX_QUOTED_VERSES = 4;

/**
 * Parse a 1-based query param. Digits only, so "1.5", "-1" and "five" are all
 * rejected rather than silently coerced by Number().
 */
function positiveInteger(raw: string): number | null {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return value >= 1 ? value : null;
}

function isTranslationId(value: string): value is TranslationId {
	return Object.prototype.hasOwnProperty.call(TRANSLATIONS, value);
}

function bookName(order: number): string {
	return bookByOrder(order)?.name ?? `Book ${order}`;
}

/** "John 3:16", "John 3:16-18" or "John 3:36-4:2" for one ranked edge. */
function referenceOf(ref: CrossReference): string {
	const name = bookName(ref.order);
	const isRange =
		ref.endChapter !== undefined &&
		ref.endVerse !== undefined &&
		(ref.endChapter !== ref.chapter || ref.endVerse !== ref.verse);
	if (!isRange) return `${name} ${ref.chapter}:${ref.verse}`;
	return ref.endChapter === ref.chapter
		? `${name} ${ref.chapter}:${ref.verse}-${ref.endVerse}`
		: `${name} ${ref.chapter}:${ref.verse}-${ref.endChapter}:${ref.endVerse}`;
}

/**
 * The text to show under an edge, or undefined for reference-only. A range
 * that crosses a chapter is never quoted (the card would swallow a chapter
 * tail), and a translation that has to be fetched can fail without taking the
 * whole row down: NKJV comes from bolls.life, and a "See also" list of
 * references still answers the question when it is unreachable.
 */
async function quote(ref: CrossReference, translation: TranslationId): Promise<string | undefined> {
	if (ref.endChapter !== undefined && ref.endChapter !== ref.chapter) return undefined;
	const last = Math.min(ref.endVerse ?? ref.verse, ref.verse + MAX_QUOTED_VERSES - 1);
	const texts: string[] = [];
	try {
		for (let verse = ref.verse; verse <= last; verse++) {
			const text = await getVerseText(translation, ref.order, ref.chapter, verse);
			if (!text) break;
			texts.push(text);
		}
	} catch (error) {
		console.error("[api/bible/crossrefs] verse text lookup failed", error);
		return undefined;
	}
	return texts.length > 0 ? texts.join(" ") : undefined;
}

/**
 * The curated cross-references for one verse, best first, with their text in
 * the reader's translation: the "See also" row of the verse sheet. Android
 * cannot bundle the 2.9MB set, so the data reaches every client through here.
 *
 * Public for the same reason /api/bible/original is: reference data with no
 * user state, cached hard at the edge, needed before a session exists.
 */
export async function GET(req: Request): Promise<Response> {
	try {
		const params = new URL(req.url).searchParams;

		const rawReference = params.get("reference");
		const target = rawReference ? resolveReference(rawReference) : null;
		// A chapter-only reference ("Romans 8") has no edges of its own; saying
		// so beats answering with an empty list the caller would read as "none".
		if (!target || target.verse === undefined) {
			return NextResponse.json({ error: "invalid_reference" }, { status: 400 });
		}

		const rawLimit = params.get("limit");
		const limit = rawLimit === null ? DEFAULT_LIMIT : positiveInteger(rawLimit);
		if (limit === null || limit > MAX_LIMIT) {
			return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
		}

		const rawTranslation = params.get("translation");
		if (rawTranslation !== null && !isTranslationId(rawTranslation)) {
			return NextResponse.json({ error: "invalid_translation" }, { status: 400 });
		}
		const translation: TranslationId = rawTranslation ?? "KJV";

		const refs = (await getCrossReferencesFor(target.order, target.chapter, target.verse)).slice(
			0,
			limit
		);
		const crossReferences = await Promise.all(
			refs.map(async (ref) => {
				const text = await quote(ref, translation);
				return { reference: referenceOf(ref), ...(text ? { text } : {}) };
			})
		);

		// A verse with no edges answers 200 with an empty list, not 404: "no
		// cross-references" is a fact about this verse, and the card hides itself.
		return NextResponse.json(
			{
				reference: `${bookName(target.order)} ${target.chapter}:${target.verse}`,
				translation,
				crossReferences,
			},
			{ headers: cacheHeaders }
		);
	} catch (error) {
		console.error("[api/bible/crossrefs] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
