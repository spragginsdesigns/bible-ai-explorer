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
import { prisma } from "@/lib/prisma";

export interface FullTextVerseHit {
	book: number;
	chapter: number;
	verse: number;
	text: string;
	/** Raw ts_rank_cd score, comparable only within one result set. */
	rank: number;
	/** `rank` scaled so the best hit of this search is 1, for the verse cards. */
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
}

/**
 * A tsquery lexeme: single-quoted, with any internal quote doubled. Postgres
 * needs the quoting because a lexeme may legitimately contain an apostrophe
 * ("lord's"), and an unquoted one would end the token early.
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
		.replace(/[^a-z0-9' ]+/g, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^'+|'+$/g, ""))
		.filter((token) => token.length > 0);
}

/**
 * Split a user query into tsquery clauses. A "quoted phrase" becomes an
 * ordered phrase of exact lexemes (`'be' <-> 'still'`); every bare word
 * becomes a prefix match (`'loveth':*`) so archaic inflections the 'simple'
 * dictionary never stems are still reachable from a shorter stem.
 */
function parseVerseQuery(query: string): ParsedVerseQuery {
	const lowered = query.toLowerCase();
	const clauses: string[] = [];
	const phrasePattern = /"([^"]*)"/g;
	let remainder = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null = phrasePattern.exec(lowered);
	while (match !== null) {
		remainder += `${lowered.slice(lastIndex, match.index)} `;
		lastIndex = phrasePattern.lastIndex;
		const words = tokenizeWords(match[1]);
		if (words.length > 0) clauses.push(words.map(quoteLexeme).join(" <-> "));
		match = phrasePattern.exec(lowered);
	}
	remainder += lowered.slice(lastIndex);

	const bare = tokenizeWords(remainder);
	for (const word of bare) clauses.push(`${quoteLexeme(word)}:*`);
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

async function runTsQuery(tsquery: string, limit: number): Promise<RankedRow[]> {
	return prisma.$queryRaw<RankedRow[]>`
		SELECT "book", "chapter", "verse", "text", ts_rank_cd("search", q) AS "rank"
		FROM "KjvVerse", to_tsquery('simple', ${tsquery}) q
		WHERE "search" @@ q
		ORDER BY "rank" DESC, "book", "chapter", "verse"
		LIMIT ${limit}
	`;
}

/**
 * Verses matching every term of `query`, best first. If requiring all terms
 * finds nothing and the user typed two or more bare words, the same terms are
 * tried once more as "any of these" so a partial recollection still ranks
 * rather than returning an empty result.
 */
export async function findVersesFullText(
	query: string,
	limit: number
): Promise<FullTextVerseHit[]> {
	const parsed = parseVerseQuery(query);
	if (parsed.clauses.length === 0) return [];
	const safeLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit) || MIN_LIMIT));

	let rows = await runTsQuery(parsed.clauses.join(" & "), safeLimit);
	if (rows.length === 0 && parsed.bareWords >= 2) {
		rows = await runTsQuery(parsed.clauses.join(" | "), safeLimit);
	}
	if (rows.length === 0) return [];

	// ts_rank_cd is unbounded and query-dependent, so it means nothing to a
	// client badge on its own; scale it against this search's best hit. When
	// every hit ranks 0 they all matched equally, so they all read as 1.
	const topRank = Number(rows[0].rank) || 0;
	return rows.map((row) => {
		const rank = Number(row.rank) || 0;
		return {
			book: row.book,
			chapter: row.chapter,
			verse: row.verse,
			text: row.text,
			rank,
			similarity: topRank > 0 ? rank / topRank : 1,
		};
	});
}
