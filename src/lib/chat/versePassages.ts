/**
 * Groups an answer's retrieved verses into readable passages.
 *
 * MIRRORED BY ANDROID: `mobile/src/lib/versePassages.ts` is a byte-identical
 * copy (tests/verse-passages.test.mjs fails on any drift). The module imports
 * nothing so both trees can carry it; the caller injects its own reference
 * resolver.
 *
 * Why it exists: a getPassage call for "2 Peter 3:5-13" used to render as nine
 * separate rows, each with its own "100%" score and four action chips, so one
 * answer could scroll for screens (production, 2026-10: a quarter of answers
 * carried 20+ verses, the largest 85). Contiguous verses from one lookup now
 * read as one passage, ordered by where the answer cites them, and search hits
 * keep their scores in a section of their own.
 */

/** Verse rows as both clients' chat view models carry them. */
export interface PassageSourceVerse {
	reference: string;
	similarity: number;
	text?: string;
	translation?: string;
	/**
	 * "passage" for getPassage lookups; "exact" for word-match tools
	 * (findVerses, searchOriginalLanguage) whose rows carry no real score;
	 * anything else is a scored search hit.
	 */
	source?: "passage" | "exact" | "search";
}

export interface ResolvedReference {
	order: number;
	chapter: number;
	verse?: number;
}

export type ReferenceResolver = (reference: string) => ResolvedReference | null;

export interface PassageVerse {
	verse: number;
	text?: string;
}

export interface VersePassage {
	/** Stable within one answer; used to focus the passage from a link tap. */
	key: string;
	kind: "passage" | "search";
	/** "Psalms 56:1-4", or the verse's own reference for a single verse. */
	reference: string;
	/** Reference of the first verse, for the reader deep link. */
	firstReference: string;
	translation?: string;
	order: number | null;
	chapter: number | null;
	verses: PassageVerse[];
	/** Best score in the group; null for exact lookups, which have none. */
	similarity: number | null;
}

export interface GroupedVerses {
	/** Exact lookups, cited ones first in the order the answer cites them. */
	passages: VersePassage[];
	/** Search results in retrieval order, with any verse already shown as a passage removed. */
	searchHits: VersePassage[];
}

const VERSE_REFERENCE = /^(.*\S)\s+(\d{1,3}):(\d{1,3})$/;

interface ParsedRow {
	row: PassageSourceVerse;
	book: string;
	chapter: number;
	verse: number;
	resolved: ResolvedReference | null;
}

function parseRow(row: PassageSourceVerse, resolve: ReferenceResolver): ParsedRow | null {
	const match = VERSE_REFERENCE.exec(row.reference.trim());
	if (!match) return null;
	return {
		row,
		book: match[1],
		chapter: Number(match[2]),
		verse: Number(match[3]),
		resolved: resolve(row.reference),
	};
}

function rangeLabel(first: ParsedRow, last: ParsedRow): string {
	return first.verse === last.verse
		? first.row.reference
		: `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
}

function scoreOf(rows: PassageSourceVerse[]): number | null {
	const scored = rows.filter((row) => row.source !== "passage" && row.source !== "exact");
	return scored.length > 0 ? Math.max(...scored.map((row) => row.similarity)) : null;
}

function buildGroups(rows: PassageSourceVerse[], kind: "passage" | "search", resolve: ReferenceResolver, keyPrefix: string): VersePassage[] {
	const groups: VersePassage[] = [];
	let current: ParsedRow[] = [];

	const flush = () => {
		if (current.length === 0) return;
		const first = current[0];
		const last = current[current.length - 1];
		groups.push({
			key: `${keyPrefix}${groups.length}`,
			kind,
			reference: rangeLabel(first, last),
			firstReference: first.row.reference,
			...(first.row.translation ? { translation: first.row.translation } : {}),
			order: first.resolved?.order ?? null,
			chapter: first.chapter,
			verses: current.map((parsed) => ({
				verse: parsed.verse,
				...(parsed.row.text !== undefined ? { text: parsed.row.text } : {}),
			})),
			similarity: scoreOf(current.map((parsed) => parsed.row)),
		});
		current = [];
	};

	for (const row of rows) {
		const parsed = parseRow(row, resolve);
		if (!parsed) {
			// An unexpected reference shape still shows, as a group of its own.
			flush();
			groups.push({
				key: `${keyPrefix}${groups.length}`,
				kind,
				reference: row.reference,
				firstReference: row.reference,
				...(row.translation ? { translation: row.translation } : {}),
				order: null,
				chapter: null,
				verses: [{ verse: 0, ...(row.text !== undefined ? { text: row.text } : {}) }],
				similarity: scoreOf([row]),
			});
			continue;
		}
		const previous = current[current.length - 1];
		// Search hits are ranked individually, so they never merge; passage
		// verses join while they continue one chapter in one translation.
		const continues =
			kind === "passage" &&
			previous !== undefined &&
			previous.book === parsed.book &&
			previous.chapter === parsed.chapter &&
			previous.row.translation === parsed.row.translation &&
			parsed.verse === previous.verse + 1;
		if (!continues) flush();
		current.push(parsed);
	}
	flush();
	return groups;
}

function dedupeKey(row: PassageSourceVerse): string {
	return `${row.reference.trim().toLowerCase()}|${row.translation ?? ""}`;
}

interface CitedReference extends ResolvedReference {
	/** Last verse of a same-chapter range ("3:5-13"); the resolvers drop it. */
	verseEnd?: number;
}

// A same-chapter range tail, before any translation tag: "3:5-13", "3:5-13 KJV".
// Built from code points: an escape inside a regex class has been flattened to a
// plain hyphen by this PC's editing tools before (it read [---]).
const RANGE_DASHES = `[-${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`;
const RANGE_TAIL = new RegExp(
	String.raw`:(\d{1,3})\s*` + RANGE_DASHES + String.raw`\s*(\d{1,3})(?:\s+[A-Za-z]+)?\s*$`
);

function resolveCited(reference: string, resolve: ReferenceResolver): CitedReference | null {
	const resolved = resolve(reference);
	if (!resolved) return null;
	const range = RANGE_TAIL.exec(reference.trim());
	const end = range ? Number(range[2]) : undefined;
	return end !== undefined && resolved.verse !== undefined && end > resolved.verse
		? { ...resolved, verseEnd: end }
		: resolved;
}

/** Does a cited reference (or any verse of its range) land inside this passage? */
function passageContains(passage: VersePassage, cited: CitedReference): boolean {
	if (passage.order === null || passage.order !== cited.order || passage.chapter !== cited.chapter) {
		return false;
	}
	const start = cited.verse;
	if (start === undefined) return true;
	const end = cited.verseEnd ?? start;
	return passage.verses.some((entry) => entry.verse >= start && entry.verse <= end);
}

/** The passage a tapped reference points at, or null when none holds it. */
export function findPassageForReference(
	grouped: GroupedVerses,
	reference: string,
	resolve: ReferenceResolver
): VersePassage | null {
	const cited = resolveCited(reference, resolve);
	if (!cited) return null;
	return (
		grouped.passages.find((passage) => passageContains(passage, cited)) ??
		grouped.searchHits.find((passage) => passageContains(passage, cited)) ??
		null
	);
}

export function groupRetrievedVerses(
	verses: readonly PassageSourceVerse[],
	options: {
		resolve: ReferenceResolver;
		/** References in the order the answer text cites them. */
		citedReferences?: readonly string[];
	}
): GroupedVerses {
	const seen = new Set<string>();
	const passageRows: PassageSourceVerse[] = [];
	for (const row of verses) {
		if (row.source !== "passage") continue;
		const key = dedupeKey(row);
		if (seen.has(key)) continue;
		seen.add(key);
		passageRows.push(row);
	}
	const searchRows: PassageSourceVerse[] = [];
	for (const row of verses) {
		if (row.source === "passage") continue;
		const key = dedupeKey(row);
		if (seen.has(key)) continue;
		seen.add(key);
		searchRows.push(row);
	}

	const passages = buildGroups(passageRows, "passage", options.resolve, "p");
	const searchHits = buildGroups(searchRows, "search", options.resolve, "s");

	// Order passages by their first citation; uncited ones keep retrieval
	// order after them (Array.prototype.sort is stable).
	const cited = (options.citedReferences ?? [])
		.map((reference) => resolveCited(reference, options.resolve))
		.filter((reference): reference is CitedReference => reference !== null);
	const firstCitation = (passage: VersePassage): number => {
		const index = cited.findIndex((reference) => passageContains(passage, reference));
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	};
	const ranked = passages
		.map((passage) => ({ passage, rank: firstCitation(passage) }))
		.sort((a, b) => a.rank - b.rank)
		.map(({ passage }) => passage);

	return { passages: ranked, searchHits };
}

/** "Be merciful unto me..." for one verse; "1 Be merciful... 2 Mine enemies..." for several. */
export function passagePlainText(passage: VersePassage): string {
	if (passage.verses.length === 1) return passage.verses[0].text?.trim() ?? "";
	return passage.verses
		.filter((entry) => entry.text?.trim())
		.map((entry) => `${entry.verse} ${entry.text?.trim()}`)
		.join(" ");
}

/** "3 passages · 12 search results" */
export function passagesSummary(grouped: GroupedVerses): string {
	const parts: string[] = [];
	const passageCount = grouped.passages.length;
	if (passageCount > 0) parts.push(`${passageCount} ${passageCount === 1 ? "passage" : "passages"}`);
	const hitCount = grouped.searchHits.length;
	if (hitCount > 0) parts.push(`${hitCount} ${hitCount === 1 ? "search result" : "search results"}`);
	return parts.join(" · ");
}
