/**
 * Search the inspired original-language text by word, root, or Strong's
 * number, backed by the "OriginalVerse" table in Neon (one row per verse of
 * the Westminster Leningrad Codex and Scrivener's 1894 Textus Receptus, with a
 * `strongs` text[] under a GIN index and a GENERATED `search` tsvector over
 * the consonantal/unaccented `plain` column).
 *
 * `getOriginalText` answers "what does this verse say in Hebrew"; this module
 * answers the other direction, "where does this Hebrew word occur", which is
 * what a word study actually needs. It is the sibling of verse-fulltext.ts and
 * keeps the same division of labour: a pure query builder that can be tested
 * without a database, and a thin Prisma runner.
 *
 * Everything above `searchOriginalVerses` is pure, because the interesting
 * half of this feature is the transliteration guesswork, not the SQL.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
	getStrongsDictionary,
	type StrongsDictionary,
	type StrongsEntry,
} from "@/lib/bible/originals";

/** The two inspired languages, spelled as the tool and the table spell them. */
export type OriginalLanguage = "Hebrew" | "Greek";

/** Which bundled Strong's dictionary an entry came from. */
export type StrongsLanguage = "hebrew" | "greek";

/** Lowest and highest number of verses one search may return. */
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

/** How many Strong's numbers a transliteration may resolve to. */
const MAX_CANDIDATES = 6;

/* -------------------------------------------------------------------------
 * Normalisation
 * ---------------------------------------------------------------------- */

/**
 * Strong's transliterations are a 19th-century phonetic notation, not a
 * spelling a reader would type: H2617 is `chêçêd`, G26 is `agápē`, H430 is
 * `ʼĕlôhîym`. Folding both the dictionary's spelling and the user's onto one
 * skeleton is what lets "hesed" find H2617.
 *
 * The rules, in order, and why each one exists:
 *
 *  1. NFD, so every accented letter becomes a base letter plus marks.
 *  2. Lowercase.
 *  3. `c` + combining cedilla -> `s`. Strong's writes samekh as `ç`; it is an
 *     /s/, and stripping the cedilla alone would leave the misleading `c`.
 *  4. Drop combining marks (the circumflexes, macrons and acutes are vowel
 *     length and stress, which nobody types).
 *  5. Fold the superscript reduced vowels (shewa and the hatephs) down to
 *     their base letter. They are real vowels a reader spells out, so
 *     dropping them would turn `Yᵉhôvâh` into "yhovah" instead of "yehovah".
 *  6. Drop everything that is not a-z. This is what removes the aleph and
 *     ayin marks (ʼ ʻ), spaces and punctuation.
 *  7. `ch` -> `h`. Strong's spells both Hebrew chet and Greek chi `ch`, while
 *     readers write "hesed" as often as "chesed"; folding is safe because it
 *     is applied to the dictionary side too ("christos" and "Christós" both
 *     land on "hristos").
 *  8. Collapse the mater lectionis digraphs `iy` -> `i`, `ow` -> `o`,
 *     `uw` -> `u`. These spell a vowel written with a consonant letter, so
 *     `ʼĕlôhîym` is the word an English reader spells "elohim" and `shâlôwm`
 *     is "shalom".
 *  9. A tiny alias table for names whose English form is not a
 *     transliteration at all ("Jehovah" and "Yahweh" for `Yᵉhôvâh`).
 */
export function normalizeTranslit(input: string): string {
	const folded = input
		.normalize("NFD")
		.toLowerCase()
		.replace(/c\u0327/g, "s")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[\u1d43\u1d49\u1d52\u1d58]/g, (mark) => SUPERSCRIPT_VOWELS[mark] ?? "")
		.replace(/[^a-z]+/g, "")
		.replace(/ch/g, "h")
		.replace(/iy/g, "i")
		.replace(/ow/g, "o")
		.replace(/uw/g, "u");
	return TRANSLIT_ALIASES[folded] ?? folded;
}

/**
 * Strong's writes Hebrew's reduced vowels (shewa, and the hateph vowels) as
 * superscripts. A reader spells them out, so they fold to their base letter
 * instead of being dropped with the rest of the notation.
 */
const SUPERSCRIPT_VOWELS: Record<string, string> = {
	"ᵃ": "a",
	"ᵉ": "e",
	"ᵒ": "o",
	"ᵘ": "u",
};

/**
 * Spellings that are not transliterations of the Hebrew at all but are what a
 * reader types. Deliberately tiny: every entry is a claim about one word, and
 * a wrong claim silently sends a word study to the wrong lemma.
 */
const TRANSLIT_ALIASES: Record<string, string> = {
	// The divine name, H3068 `Yᵉhôvâh` -> "yehovah".
	yahweh: "yehovah",
	jehovah: "yehovah",
	yhwh: "yehovah",
	// H136 `ʼĂdônây` -> "adonay".
	adonai: "adonay",
};

/**
 * The consonantal skeleton of Hebrew, matching how the seed builds
 * `OriginalVerse.plain`: maqaf (the Hebrew hyphen) becomes a space so a
 * hyphenated pair indexes as two words, then every point and accent in
 * U+0591-U+05C7 is dropped. Both sides of the comparison must use this
 * function or a pointed query will never meet an unpointed index.
 */
export function hebrewPlainQuery(input: string): string {
	return input
		.replace(/\u05be/g, " ")
		.replace(/[\u0591-\u05c7]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The unaccented, lowercase form of Greek, matching the seed: NFD, drop the
 * combining breathings/accents/iota subscript, lowercase. Final sigma is left
 * alone precisely because the seed leaves it alone; prefix matching in
 * `buildOriginalTsQuery` is what carries inflection.
 */
export function greekPlainQuery(input: string): string {
	return input
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Which alphabet the user typed in, so a pasted Hebrew or Greek word searches
 * the text directly and a Latin one goes through the dictionary first.
 */
export function detectScript(input: string): "hebrew" | "greek" | "latin" {
	if (/[\u0590-\u05ff\ufb1d-\ufb4f]/.test(input)) return "hebrew";
	if (/[\u0370-\u03ff\u1f00-\u1fff]/.test(input)) return "greek";
	return "latin";
}

/**
 * A tsquery lexeme: single-quoted with any internal quote doubled, the same
 * rule verse-fulltext.ts uses, so nothing a user types can escape into the
 * query as an operator.
 */
function quoteLexeme(word: string): string {
	return `'${word.replace(/'/g, "''")}'`;
}

/**
 * The `to_tsquery('simple', ...)` string for already-plain words, requiring
 * every one of them. Each is a prefix match, because Hebrew and Greek inflect
 * heavily and the 'simple' dictionary stems nothing: `αγαπ:*` reaches
 * ἀγάπη, ἀγάπης and ἀγάπην alike. Returns null when nothing usable is left.
 */
export function buildOriginalTsQuery(plainWords: string | readonly string[]): string | null {
	const words = (typeof plainWords === "string" ? plainWords.split(/\s+/) : plainWords)
		.map((word) => word.trim())
		.filter((word) => word.length > 0);
	if (words.length === 0) return null;
	return words.map((word) => `${quoteLexeme(word)}:*`).join(" & ");
}

/**
 * A Strong's number as the dictionary keys it: uppercase, leading zeros gone
 * ("h0430" -> "H430"). Mirrors the rule inside `lookupStrongsEntry`, which
 * keeps its own copy private.
 */
export function normalizeStrongsNumber(input: string): string | null {
	const normalized = input.trim().toUpperCase().replace(/^([HG])0+/, "$1");
	return /^[HG]\d+$/.test(normalized) ? normalized : null;
}

/* -------------------------------------------------------------------------
 * Resolving an English spelling to Strong's numbers
 * ---------------------------------------------------------------------- */

export interface StrongsCandidate {
	strongs: string;
	lemma: string;
	translit: string;
	/** The KJV rendering list, or the definition when the list is empty. */
	gloss: string;
	/** Why this entry matched, best first. */
	matchKind: "translit" | "translit-prefix" | "gloss";
}

export interface StrongsIndex {
	entries: Map<string, StrongsEntry>;
	language: Map<string, StrongsLanguage>;
	/** normalized transliteration -> Strong's numbers */
	byTranslit: Map<string, string[]>;
	/** plain (unpointed / unaccented) lemma -> Strong's numbers */
	byLemma: Map<string, string[]>;
	/** English word from the KJV list or the definition -> Strong's numbers */
	byGloss: Map<string, string[]>;
	/** Every transliteration key, for the prefix pass. */
	translitKeys: string[];
}

/**
 * English words too common to be evidence of anything. Without this, "the" or
 * "one" in a definition would tie half the dictionary to a single query.
 */
const GLOSS_STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"into",
	"but",
	"not",
	"was",
	"are",
	"his",
	"her",
	"its",
	"one",
	"any",
	"all",
	"out",
	"who",
	"used",
	"also",
	"idiom",
	"phrase",
	"etc",
]);

function push(map: Map<string, string[]>, key: string, value: string): void {
	if (!key) return;
	const existing = map.get(key);
	if (existing) {
		if (!existing.includes(value)) existing.push(value);
		return;
	}
	map.set(key, [value]);
}

/**
 * English words a Strong's entry should be findable by. The KJV column is a
 * comma-separated list of renderings written with editorial shorthand, so each
 * segment yields both its bare words and its letters-only squash: "(loving-)
 * kindness" is how Strong's writes "lovingkindness", and only the squash finds
 * it.
 */
function glossKeys(entry: StrongsEntry): string[] {
	const keys: string[] = [];
	for (const segment of entry.kjv.split(/[,;]/)) {
		const squashed = segment.toLowerCase().replace(/[^a-z]+/g, "");
		if (squashed.length >= 4) keys.push(squashed);
		for (const word of segment.toLowerCase().split(/[^a-z]+/)) {
			if (word.length >= 3 && !GLOSS_STOPWORDS.has(word)) keys.push(word);
		}
	}
	for (const word of entry.def.toLowerCase().split(/[^a-z]+/)) {
		if (word.length >= 4 && !GLOSS_STOPWORDS.has(word)) keys.push(word);
	}
	return keys;
}

/**
 * Build the lookup index over one or both dictionaries. Pure and exported so
 * the ranking can be tested against a hand-written mini-dictionary instead of
 * the real 14,000-entry files.
 */
export function buildStrongsIndex(
	dictionaries: Partial<Record<StrongsLanguage, StrongsDictionary>>
): StrongsIndex {
	const index: StrongsIndex = {
		entries: new Map(),
		language: new Map(),
		byTranslit: new Map(),
		byLemma: new Map(),
		byGloss: new Map(),
		translitKeys: [],
	};

	for (const language of ["hebrew", "greek"] as const) {
		const dictionary = dictionaries[language];
		if (!dictionary) continue;
		for (const [number, entry] of Object.entries(dictionary)) {
			index.entries.set(number, entry);
			index.language.set(number, language);
			push(index.byTranslit, normalizeTranslit(entry.translit), number);
			const lemma =
				language === "hebrew" ? hebrewPlainQuery(entry.lemma) : greekPlainQuery(entry.lemma);
			push(index.byLemma, lemma, number);
			// Gloss keys go through the same fold as the query, or "charity"
			// would index as itself while the user's "charity" normalizes to
			// "harity" and never meets it.
			for (const key of glossKeys(entry)) push(index.byGloss, normalizeTranslit(key), number);
		}
	}

	index.translitKeys = [...index.byTranslit.keys()].sort();
	return index;
}

function toCandidate(
	index: StrongsIndex,
	number: string,
	matchKind: StrongsCandidate["matchKind"]
): StrongsCandidate | null {
	const entry = index.entries.get(number);
	if (!entry) return null;
	return {
		strongs: number,
		lemma: entry.lemma,
		translit: entry.translit,
		gloss: entry.kjv || entry.def,
		matchKind,
	};
}

/** Sort key inside one tier: the lower Strong's number is the commoner word. */
function strongsOrder(number: string): number {
	return Number.parseInt(number.slice(1), 10) || 0;
}

/**
 * Strong's numbers a spelling could mean, best first. Pure: the caller
 * supplies the index, so this is what the tests exercise.
 */
export function resolveStrongsInIndex(
	index: StrongsIndex,
	word: string,
	language?: OriginalLanguage
): StrongsCandidate[] {
	const wanted: StrongsLanguage | undefined =
		language === "Hebrew" ? "hebrew" : language === "Greek" ? "greek" : undefined;
	const script = detectScript(word);
	const normalized = normalizeTranslit(word);

	const seen = new Set<string>();
	const results: StrongsCandidate[] = [];

	const take = (numbers: readonly string[], matchKind: StrongsCandidate["matchKind"]): void => {
		const tier: StrongsCandidate[] = [];
		for (const number of numbers) {
			if (seen.has(number)) continue;
			if (wanted && index.language.get(number) !== wanted) continue;
			const candidate = toCandidate(index, number, matchKind);
			if (!candidate) continue;
			seen.add(number);
			tier.push(candidate);
		}
		tier.sort((a, b) => strongsOrder(a.strongs) - strongsOrder(b.strongs));
		results.push(...tier);
	};

	// A word pasted in its own alphabet is a lemma lookup, not a
	// transliteration, so it gets the exact tier.
	if (script !== "latin") {
		const plain = script === "hebrew" ? hebrewPlainQuery(word) : greekPlainQuery(word);
		take(index.byLemma.get(plain) ?? [], "translit");
	} else {
		take(index.byTranslit.get(normalized) ?? [], "translit");
		if (normalized.length >= 3 && results.length < MAX_CANDIDATES) {
			const prefixed: string[] = [];
			for (const key of index.translitKeys) {
				if (key.startsWith(normalized)) prefixed.push(...(index.byTranslit.get(key) ?? []));
			}
			take(prefixed, "translit-prefix");
		}
		if (results.length < MAX_CANDIDATES) {
			take(index.byGloss.get(normalized) ?? [], "gloss");
		}
	}

	return results.slice(0, MAX_CANDIDATES);
}

let cachedIndex: StrongsIndex | null = null;

/**
 * The same resolution against the real bundled dictionaries. The index costs
 * one pass over both files, so it is built once per process and kept.
 */
export async function resolveStrongsByWord(
	word: string,
	language?: OriginalLanguage
): Promise<StrongsCandidate[]> {
	cachedIndex ??= buildStrongsIndex({
		hebrew: await getStrongsDictionary("hebrew"),
		greek: await getStrongsDictionary("greek"),
	});
	return resolveStrongsInIndex(cachedIndex, word, language);
}

/* -------------------------------------------------------------------------
 * The database half
 * ---------------------------------------------------------------------- */

export interface OriginalVerseRow {
	book: number;
	chapter: number;
	verse: number;
	language: OriginalLanguage;
	/** The bundled form: pointed Hebrew, or unaccented Greek. */
	text: string;
	/** The indexed form: consonantal Hebrew, or NFD-stripped lowercase Greek. */
	plain: string;
	strongs: string[];
	kjvBook: number | null;
	kjvChapter: number | null;
	kjvVerse: number | null;
}

export interface OriginalSearchOptions {
	/** Strong's numbers, already normalized. Matched as an array overlap. */
	strongs?: string[];
	/** Original-script words, already run through the matching plain query. */
	text?: string;
	language?: OriginalLanguage;
	/** Restrict to one book, 1-66 in canonical order. */
	book?: number;
	limit: number;
}

export interface OriginalSearchResult {
	rows: OriginalVerseRow[];
	/** Every verse the search matched, not just the page returned. */
	total: number;
}

interface CountRow {
	total: number;
}

/**
 * Verses of the original text matching a Strong's number set, a word, or
 * both, in canonical order. `total` comes from a second count over the same
 * predicate so the model can say "245 verses, showing 20" instead of implying
 * the page is the whole answer.
 */
export async function searchOriginalVerses(
	options: OriginalSearchOptions
): Promise<OriginalSearchResult> {
	const conditions: Prisma.Sql[] = [];
	if (options.strongs && options.strongs.length > 0) {
		// Array overlap rides the GIN index on "strongs"; a word may carry any
		// of the resolved numbers, so ANY-of is the right test, not all-of.
		conditions.push(Prisma.sql`"strongs" && ${options.strongs}::text[]`);
	}
	if (options.text) {
		const tsquery = buildOriginalTsQuery(options.text);
		if (!tsquery) return { rows: [], total: 0 };
		conditions.push(Prisma.sql`"search" @@ to_tsquery('simple', ${tsquery})`);
	}
	// Without a predicate this would scan the whole text and return an
	// arbitrary 20 verses, which reads to the model like a real answer.
	if (conditions.length === 0) return { rows: [], total: 0 };

	if (options.language) conditions.push(Prisma.sql`"language" = ${options.language}`);
	if (options.book !== undefined) conditions.push(Prisma.sql`"book" = ${options.book}`);

	const where = Prisma.join(conditions, " AND ");
	const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(options.limit) || MIN_LIMIT));

	const [rows, counted] = await Promise.all([
		prisma.$queryRaw<OriginalVerseRow[]>`
			SELECT "book", "chapter", "verse", "language", "text", "plain", "strongs",
			       "kjvBook", "kjvChapter", "kjvVerse"
			FROM "OriginalVerse"
			WHERE ${where}
			ORDER BY "book", "chapter", "verse"
			LIMIT ${limit}
		`,
		// count(*) is bigint, which Prisma hands back as a BigInt that JSON
		// cannot serialise into a tool result; cast it in SQL.
		prisma.$queryRaw<CountRow[]>`
			SELECT count(*)::int AS "total" FROM "OriginalVerse" WHERE ${where}
		`,
	]);

	return { rows, total: Number(counted[0]?.total ?? rows.length) };
}
