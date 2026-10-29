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

// An answer that lost some verse text to a failed lookup (NKJV is fetched from
// bolls.life) is still worth sending, but not worth keeping: cached for a week
// it would show those rows reference-only to every reader long after the
// source came back.
const degradedCacheHeaders = {
	"Cache-Control": "public, max-age=60, s-maxage=60",
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
/** Longest same-chapter span quoted inline, matching the getCrossReferences tool. */
const MAX_QUOTED_VERSES = 30;

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

interface QuoteCoverage {
	requestedReference: string;
	returnedReference: string | null;
	requestedVerseCount: number | null;
	returnedVerseCount: number;
	truncated: boolean;
}

interface QuotedCrossReference {
	text?: string;
	failed: boolean;
	quotedReference: string | null;
	coverage: QuoteCoverage;
	notice?: string;
}

/** Only complete quotations may appear beneath a full curated reference. */
async function quote(
	ref: CrossReference,
	translation: TranslationId
): Promise<QuotedCrossReference> {
	const reference = referenceOf(ref);
	const crossChapter = ref.endChapter !== undefined && ref.endChapter !== ref.chapter;
	const last = ref.endVerse ?? ref.verse;
	const requestedVerseCount = crossChapter ? null : last - ref.verse + 1;
	const referenceOnly = (notice: string, failed = false): QuotedCrossReference => ({
		failed, quotedReference: null, notice,
		coverage: { requestedReference: reference, returnedReference: null,
			requestedVerseCount, returnedVerseCount: 0, truncated: true },
	});
	if (crossChapter) return referenceOnly("Cross-chapter range; open the reference to read each chapter.");
	if ((requestedVerseCount ?? 0) > MAX_QUOTED_VERSES) {
		return referenceOnly(`Range exceeds ${MAX_QUOTED_VERSES} verses; open the reference to read the full passage.`);
	}
	if (!Number.isInteger(requestedVerseCount) || (requestedVerseCount ?? 0) < 1) {
		return referenceOnly("The complete range could not be read.", true);
	}
	const texts: string[] = [];
	try {
		for (let verse = ref.verse; verse <= last; verse++) {
			const text = await getVerseText(translation, ref.order, ref.chapter, verse);
			if (!text?.trim()) return referenceOnly(`The complete range is unavailable in ${translation}; no quotation was returned.`, true);
			texts.push(text);
		}
	} catch (error) {
		const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
		console.error(
			`[api/bible/crossrefs] ${translation} verse text lookup failed for ${ref.order}:${ref.chapter}`,
			cause
		);
		return referenceOnly(`The complete range could not be loaded in ${translation}; no quotation was returned.`, true);
	}
	return {
		text: texts.join(" "), failed: false, quotedReference: reference,
		coverage: { requestedReference: reference, returnedReference: reference,
			requestedVerseCount, returnedVerseCount: texts.length, truncated: false },
	};
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

		const allRefs = await getCrossReferencesFor(target.order, target.chapter, target.verse);
		const refs = allRefs.slice(0, limit);
		const quoted = await Promise.all(refs.map((ref) => quote(ref, translation)));
		const crossReferences = refs.map((ref, index) => {
			const { failed: _failed, ...quotation } = quoted[index];
			return { reference: referenceOf(ref), ...quotation };
		});
		const degraded = quoted.some((result) => result.failed);

		// A verse with no edges answers 200 with an empty list, not 404: "no
		// cross-references" is a fact about this verse, and the card hides itself.
		return NextResponse.json(
			{
				reference: `${bookName(target.order)} ${target.chapter}:${target.verse}`,
				translation,
				crossReferences,
				total: allRefs.length,
				returnedCount: refs.length,
				truncated: allRefs.length > refs.length,
			},
			{ headers: degraded ? degradedCacheHeaders : cacheHeaders }
		);
	} catch (error) {
		console.error("[api/bible/crossrefs] request failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
