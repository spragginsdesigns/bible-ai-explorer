/**
 * Exact-word and phrase search over the whole KJV, backed by the Postgres
 * full-text index in Neon ("KjvVerse"."search", a GENERATED tsvector on the
 * 'simple' dictionary with a GIN index).
 *
 * This is the free, instant half of retrieval: no embedding call, no
 * in-process scan of all 31,102 verses. It answers "what verse says 'be still
 * and know'", "every verse with 'loveth'", and the half-remembered wording a
 * semantic search talks itself out of; `searchScripture` still owns meaning
 * and topic questions.
 */
import { Prisma } from "@prisma/client";
import { searchQuery } from "@/lib/search-query";
import { getKjvBookName } from "@/utils/kjvBible";

export interface FullTextVerseHit {
	book: number;
	chapter: number;
	verse: number;
	text: string;
	/** Raw ts_rank_cd score, comparable only within one result set. */
	rank: number;
	/** Legacy lexical indicator: 1 for all-clause matches, 0 for partial recall; never semantic confidence. */
	similarity: number;
}

/** Lowest and highest number of verses one search may return. */
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

interface ParsedVerseQuery {
	/** tsquery clauses, ready to be joined by `&` (all) or `|` (any). */
	clauses: string[];
	/** How many clauses came from bare words rather than a quoted phrase. */
	bareWords: number;
	queryError?: "unmatched_quote" | "empty_quoted_phrase";
}

/**
 * A tsquery lexeme: single-quoted, with any internal quote doubled. Postgres
 * needs SQL-style escaping here. Its parser splits an internal apostrophe
 * into adjacent exact lexemes ("lord's" becomes lord <-> s).
 */
function quoteLexeme(word: string): string {
	return `'${word.replace(/'/g, "''")}'`;
}

/**
 * Words of a fragment: lowercase already, everything but letters, digits,
 * apostrophes and spaces dropped, and leading/trailing apostrophes trimmed so
 * a stray quote mark never becomes an empty lexeme.
 */
function tokenizeWords(fragment: string): string[] {
	return fragment
		// Canonical KJV text uses curly apostrophes; keep input spelling equivalent.
		.replace(/([\p{L}\p{N}])[’‘](?=[\p{L}\p{N}])/gu, "$1'")
		// "Beth-el" is indexed as "bethel" (see migration
		// 20261008120000_kjv_search_joins_hyphens), so join it here too.
		.replace(/([a-z0-9])-(?=[a-z0-9])/g, "$1")
		.replace(/[^\p{L}\p{N}\p{M}' ]+/gu, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^'+|'+$/g, ""))
		.filter((token) => /[\p{L}\p{N}]/u.test(token));
}

/**
 * Split a user query into tsquery clauses. A "quoted phrase" becomes an
 * ordered phrase of exact lexemes (`'be' <-> 'still'`); ordinary bare words
 * become prefix matches (`'loveth':*`) so archaic inflections the 'simple'
 * dictionary never stems are still reachable from a shorter stem. Words with
 * internal apostrophes stay exact: a wildcard would also prefix-match the
 * split suffix, so lord's would incorrectly match LORD shaketh.
 */
function parseVerseQuery(query: string): ParsedVerseQuery {
	// Normalize typographic double quotes before identifying phrase boundaries.
	// A malformed phrase must never turn into optional bare words.
	const lowered = query.normalize("NFC").toLowerCase().replace(/[“”„‟＂«»]/g, '"');
	if ((lowered.match(/"/g)?.length ?? 0) % 2 !== 0) {
		return { clauses: [], bareWords: 0, queryError: "unmatched_quote" };
	}
	const clauses: string[] = [];
	const phrasePattern = /"([^"]*)"/g;
	let remainder = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null = phrasePattern.exec(lowered);
	while (match !== null) {
		remainder += `${lowered.slice(lastIndex, match.index)} `;
		lastIndex = phrasePattern.lastIndex;
		const words = tokenizeWords(match[1]);
		if (!words.length) return { clauses: [], bareWords: 0, queryError: "empty_quoted_phrase" };
		clauses.push(words.map(quoteLexeme).join(" <-> "));
		match = phrasePattern.exec(lowered);
	}
	remainder += lowered.slice(lastIndex);

	const bare = tokenizeWords(remainder);
	for (const word of bare) clauses.push(quoteLexeme(word) + (word.includes("'") ? "" : ":*"));
	return { clauses, bareWords: bare.length };
}

/**
 * The `to_tsquery('simple', ...)` string for a user query, requiring every
 * term (`&`). Returns null when nothing usable survives tokenizing. Pure, so
 * the parsing rules can be tested without a database.
 */
export function buildVerseTsQuery(query: string): string | null {
	const { clauses } = parseVerseQuery(query);
	return clauses.length > 0 ? clauses.join(" & ") : null;
}

interface RankedRow {
	book: number;
	chapter: number;
	verse: number;
	text: string;
	rank: number;
}

async function runTsQuery(tsquery: string, limit: number, book?: number): Promise<RankedRow[]> {
	// "Every verse with loveth in Proverbs" is a filter on the primary key's
	// first column, so it belongs in SQL rather than in a post-filter that
	// would silently drop hits past the LIMIT.
	const bookFilter = book === undefined ? Prisma.empty : Prisma.sql`AND "book" = ${book}`;
	return searchQuery<RankedRow>(Prisma.sql`
		SELECT "book", "chapter", "verse", "text", ts_rank_cd("search", q) AS "rank"
		FROM "KjvVerse", to_tsquery('simple', ${tsquery}) q
		WHERE "search" @@ q ${bookFilter}
		ORDER BY "rank" DESC, "book", "chapter", "verse"
		LIMIT ${limit}
	`);
}

export interface FindVersesOptions {
	/** Partial bare-word recall only after the strict query has no hits. */
	allowPartial?: boolean;
	/** Restrict hits to one book (1-66, canonical order). */
	book?: number;
}

export interface KeywordMatchCoverage {
	/** Matching uses this index even when quotations use another translation. */
	indexedTranslation: "KJV";
	/** Null means the whole KJV index; otherwise the canonical restricted book. */
	book: number | null;
	bookName: string | null;
	/** A rejected query made no index request and proves no absence of verses. */
	queryError?: "unmatched_quote" | "empty_quoted_phrase";
	matchMode: "all" | "any" | "none";
	/** True when an explicitly enabled partial-word retry was attempted. */
	relaxed: boolean;
	requestedClauseCount: number;
	returnedCount: number;
	limit: number;
	truncated: boolean;
	/** A bounded page does not establish an exhaustive corpus count. */
	totalMatches: null;
}

export interface FullTextVerseSearchResult {
	hits: FullTextVerseHit[];
	coverage: KeywordMatchCoverage;
}

/** Strict by default; explicit partial recall never discards a quoted phrase. */
export async function findVersesFullTextDetailed(
	query: string,
	limit: number,
	options: FindVersesOptions = {}
): Promise<FullTextVerseSearchResult> {
	const parsed = parseVerseQuery(query);
	const safeLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit) || MIN_LIMIT));
	let rows: RankedRow[] = [];
	let relaxed = false;
	if (parsed.clauses.length) {
		// One extra bounded row distinguishes a complete page from truncation.
		rows = await runTsQuery(parsed.clauses.join(" & "), safeLimit + 1, options.book);
		if (!rows.length && options.allowPartial === true && parsed.bareWords >= 2 && parsed.bareWords === parsed.clauses.length) {
			relaxed = true;
			rows = await runTsQuery(parsed.clauses.join(" | "), safeLimit + 1, options.book);
		}
	}
	const truncated = rows.length > safeLimit;
	const hits = rows.slice(0, safeLimit).map(row => ({
		book: row.book, chapter: row.chapter, verse: row.verse, text: row.text,
		rank: Number(row.rank) || 0,
		// This legacy field describes lexical coverage, never semantic confidence.
		similarity: relaxed ? 0 : 1,
	}));
	return { hits, coverage: {
		indexedTranslation: "KJV",
		book: options.book ?? null,
		bookName: options.book === undefined ? null : getKjvBookName(options.book) ?? "Book " + options.book,
		...(parsed.queryError ? { queryError: parsed.queryError } : {}),
		matchMode: hits.length ? relaxed ? "any" : "all" : "none",
		relaxed, requestedClauseCount: parsed.clauses.length, returnedCount: hits.length,
		limit: safeLimit, truncated, totalMatches: null,
	} };
}

/** Array-return compatibility; strict matching remains the default. */
export async function findVersesFullText(query: string, limit: number, options: FindVersesOptions = {}): Promise<FullTextVerseHit[]> {
	return (await findVersesFullTextDetailed(query, limit, options)).hits;
}

/** Keep the model's prose contract as explicit as the structured metadata. */
export function formatKeywordCoverageForModel(coverage: KeywordMatchCoverage, quotationTranslation = "KJV"): string {
	const scope = coverage.book === null ? "" : " in " + (coverage.bookName ?? "Book " + coverage.book);
	if (coverage.queryError) {
		return "The KJV keyword search" + scope + " was not run: " +
			(coverage.queryError === "unmatched_quote" ? "a double quote is unmatched. Close or remove the quote and retry." : "a quoted phrase has no searchable words. Supply phrase words or remove the quotes and retry.") +
			" No conclusion about matching verses can be drawn from this rejected query.";
	}
	const matching = coverage.requestedClauseCount === 0
		? "No searchable KJV terms were supplied."
		: coverage.matchMode === "any"
			? "No KJV verse" + scope + " matched all search clauses. These candidates match only some terms; do not present them as exact matches to the complete query."
			: coverage.matchMode === "all"
				? "Every returned verse" + scope + " matches all KJV search clauses (ordinary bare words use prefix matching; words with internal apostrophes use exact adjacent indexed words)."
				: coverage.relaxed
					? "No KJV verse" + scope + " matched all search clauses, and the optional partial-word retry found no candidates."
					: "No KJV verses" + scope + " matched all search clauses.";
	const restriction = coverage.book === null ? "" : " Only " + (coverage.bookName ?? "Book " + coverage.book) + " was searched; no claim is made about other books.";
	const page = "Returned " + coverage.returnedCount + " indexed matches, limited to " + coverage.limit + ". " +
		(coverage.truncated ? "More matches exist beyond this page. " : "") + "This bounded search is not an exhaustive corpus count.";
	const translation = quotationTranslation === "KJV" ? "" : " Word matching used KJV; displayed quotations use " + quotationTranslation + ". Do not claim those words occur in " + quotationTranslation + " from this search.";
	return matching + restriction + " " + page + translation;
}
