/**
 * Book metadata for the Bible reader (data/books.json, generated alongside the
 * bundled KJV text) plus a loose reference parser so verse cards and Ask-AI
 * links can turn "John 3:16"-style strings into a book/chapter/verse location.
 */
import booksJson from "./data/books.json";
import bookNamesJson from "./data/book-names.json";

export interface Book {
	order: number;
	name: string;
	abbr: string;
	testament: "OT" | "NT";
	chapters: number;
	file: string;
}

export interface Reference {
	order: number;
	chapter: number;
	verse?: number;
}

export const BOOKS: Book[] = booksJson as Book[];

export function bookByOrder(order: number): Book | null {
	return BOOKS.find((book) => book.order === order) ?? null;
}

/** Genre groupings used to subdivide each testament on the book list. */
export type BookGroup =
	| "Law"
	| "History"
	| "Poetry & Wisdom"
	| "Major Prophets"
	| "Minor Prophets"
	| "Gospels"
	| "Paul's Epistles"
	| "General Epistles"
	| "Prophecy";

export const BOOK_GROUPS: BookGroup[] = [
	"Law",
	"History",
	"Poetry & Wisdom",
	"Major Prophets",
	"Minor Prophets",
	"Gospels",
	"Paul's Epistles",
	"General Epistles",
	"Prophecy",
];

/** Map a book's canonical order (1–66) to its genre group. */
export function bookGroup(order: number): BookGroup | null {
	if (order >= 1 && order <= 5) return "Law";
	if (order >= 6 && order <= 17) return "History";
	if (order >= 18 && order <= 22) return "Poetry & Wisdom";
	if (order >= 23 && order <= 27) return "Major Prophets";
	if (order >= 28 && order <= 39) return "Minor Prophets";
	if (order >= 40 && order <= 43) return "Gospels";
	if (order === 44) return "History";
	if (order >= 45 && order <= 57) return "Paul's Epistles";
	if (order >= 58 && order <= 65) return "General Epistles";
	if (order === 66) return "Prophecy";
	return null;
}

/**
 * Spanish and German book names and common spellings (data/book-names.json),
 * each paired with its canonical order, so a reference in an answer written in
 * Spanish or German ("Juan 3:16", "1. Mose 1:1") resolves and links like an
 * English one. English names win wherever a spelling is shared.
 */
export const LOCALIZED_BOOK_NAMES: ReadonlyArray<readonly [string, number]> = (() => {
	const entries: [string, number][] = [];
	for (const language of ["es", "de"] as const) {
		const { names, aliases } = bookNamesJson[language] as { names: string[]; aliases: Record<string, number> };
		names.forEach((name, index) => entries.push([name, index + 1]));
		for (const [alias, order] of Object.entries(aliases)) entries.push([alias, order]);
	}
	return entries;
})();

/**
 * Accented letters fold to their base letter for lookups, so a model that
 * writes "Isaias" or "Filemon" still resolves. Written as escapes because
 * tooling on this machine flattens some non-ASCII literals.
 */
const ACCENT_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
	[/[\u00e0-\u00e5]/g, "a"],
	[/[\u00e8-\u00eb]/g, "e"],
	[/[\u00ec-\u00ef]/g, "i"],
	[/[\u00f2-\u00f6]/g, "o"],
	[/[\u00f9-\u00fc]/g, "u"],
	[/\u00f1/g, "n"],
];

export function foldAccents(value: string): string {
	return ACCENT_FOLDS.reduce((text, [pattern, base]) => text.replace(pattern, base), value);
}

/** Regex source matching a folded letter in either form: "i" also matches an accented i. */
const ACCENT_CLASSES: Record<string, string> = {
	a: "[a\\u00e0-\\u00e5]",
	e: "[e\\u00e8-\\u00eb]",
	i: "[i\\u00ec-\\u00ef]",
	o: "[o\\u00f2-\\u00f6]",
	u: "[u\\u00f9-\\u00fc]",
	n: "[n\\u00f1]",
};

/** One localized name as regex source: "1. Mose" accepts "1 Mose" and "1Mose". */
function localizedNamePattern(name: string): string {
	const volume = name.match(/^([1-3])\.? /);
	const rest = volume ? name.slice(volume[0].length) : name;
	const body = Array.from(rest)
		.map((char) => {
			if (char === " ") return "\\s+";
			const lower = char.toLowerCase();
			const base = foldAccents(lower);
			return base !== lower ? (ACCENT_CLASSES[base] ?? char) : char;
		})
		.join("");
	return volume ? `${volume[1]}\\.?\\s?${body}` : body;
}

/**
 * Regex alternation (source text) of every localized name, longest first, for
 * the chat link detectors. An accented letter also matches its plain form.
 * Each name must still be followed by whitespace before the chapter, as an
 * English full name is.
 */
export const LOCALIZED_BOOK_PATTERN = LOCALIZED_BOOK_NAMES.map(([name]) => name)
	.sort((a, b) => b.length - a.length)
	.map(localizedNamePattern)
	.join("|");

/** Lowercase, drop punctuation, collapse whitespace: "1 Sam." → "1 sam". */
function normalizeName(value: string): string {
	return foldAccents(value.toLowerCase())
		.replace(/[.,]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Extra aliases beyond the data's name/abbr (e.g. "Psalm" vs "Psalms"). */
const EXTRA_ALIASES: Record<string, string> = {
	psalm: "Psalms",
	"song of songs": "Song of Solomon",
};

const NAME_TO_BOOK = (() => {
	const map = new Map<string, Book>();
	for (const book of BOOKS) {
		map.set(normalizeName(book.name), book);
		map.set(normalizeName(book.abbr), book);
	}
	for (const [alias, name] of Object.entries(EXTRA_ALIASES)) {
		const book = BOOKS.find((b) => b.name === name);
		if (book) map.set(normalizeName(alias), book);
	}
	for (const [name, order] of LOCALIZED_BOOK_NAMES) {
		const key = normalizeName(name);
		const book = bookByOrder(order);
		if (book && !map.has(key)) map.set(key, book);
	}
	return map;
})();

const REFERENCE_PATTERN =
	/^([1-3])?\s*([a-zA-Z\u00c0-\u00ff. ]+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*[-–—]\s*\d+)?)?$/;

/**
 * Parse "John 3:16", "1 Samuel 2:1-10", "Psalm 23", "Gen 1" (case-insensitive,
 * full names and abbreviations) into a location. A verse range resolves to its
 * start verse. Returns null when the input cannot be resolved.
 */
export function resolveReference(input: string): Reference | null {
	const match = input.trim().match(REFERENCE_PATTERN);
	if (!match) return null;

	const [, leadingDigit, namePart, chapterPart, versePart] = match;
	const bookName = `${leadingDigit ? `${leadingDigit} ` : ""}${namePart}`;
	const book = NAME_TO_BOOK.get(normalizeName(bookName));
	if (!book) return null;

	const chapter = Number.parseInt(chapterPart, 10);
	if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return null;

	if (versePart === undefined) return { order: book.order, chapter };

	const verse = Number.parseInt(versePart, 10);
	if (!Number.isInteger(verse) || verse < 1) return null;
	return { order: book.order, chapter, verse };
}
