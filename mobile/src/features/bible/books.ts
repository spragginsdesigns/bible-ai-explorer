/**
 * Book metadata for the Bible reader (data/books.json, generated alongside the
 * bundled KJV text) plus a loose reference parser so verse cards and Ask-AI
 * links can turn "John 3:16"-style strings into a book/chapter/verse location.
 */
import booksJson from "./data/books.json";

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

/** Lowercase, drop punctuation, collapse whitespace: "1 Sam." → "1 sam". */
function normalizeName(value: string): string {
	return value
		.toLowerCase()
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
	return map;
})();

const REFERENCE_PATTERN =
	/^([1-3])?\s*([a-zA-Z. ]+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*[-–—]\s*\d+)?)?$/;

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
