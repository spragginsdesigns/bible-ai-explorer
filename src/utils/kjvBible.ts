import { readFile } from "node:fs/promises";
import path from "node:path";

/** Canonical book names, index + 1 = book number. */
const KJV_BOOKS: readonly string[] = [
	"Genesis",
	"Exodus",
	"Leviticus",
	"Numbers",
	"Deuteronomy",
	"Joshua",
	"Judges",
	"Ruth",
	"1 Samuel",
	"2 Samuel",
	"1 Kings",
	"2 Kings",
	"1 Chronicles",
	"2 Chronicles",
	"Ezra",
	"Nehemiah",
	"Esther",
	"Job",
	"Psalms",
	"Proverbs",
	"Ecclesiastes",
	"Song of Solomon",
	"Isaiah",
	"Jeremiah",
	"Lamentations",
	"Ezekiel",
	"Daniel",
	"Hosea",
	"Joel",
	"Amos",
	"Obadiah",
	"Jonah",
	"Micah",
	"Nahum",
	"Habakkuk",
	"Zephaniah",
	"Haggai",
	"Zechariah",
	"Malachi",
	"Matthew",
	"Mark",
	"Luke",
	"John",
	"Acts",
	"Romans",
	"1 Corinthians",
	"2 Corinthians",
	"Galatians",
	"Ephesians",
	"Philippians",
	"Colossians",
	"1 Thessalonians",
	"2 Thessalonians",
	"1 Timothy",
	"2 Timothy",
	"Titus",
	"Philemon",
	"Hebrews",
	"James",
	"1 Peter",
	"2 Peter",
	"1 John",
	"2 John",
	"3 John",
	"Jude",
	"Revelation",
];

export function getKjvBookName(bookNumber: number): string | undefined {
	return KJV_BOOKS[bookNumber - 1];
}

const BOOK_NAME_ALIASES: Record<string, string> = {
	"psalm": "psalms",
	"song of songs": "song of solomon",
	"canticles": "song of solomon",
	"revelations": "revelation",
};

function normalizeBookName(name: string): string {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/\./g, "")
		.replace(/^(i{1,3})\s/, (_, numerals: string) => `${numerals.length} `)
		.replace(/^1st\s/, "1 ")
		.replace(/^2nd\s/, "2 ")
		.replace(/^3rd\s/, "3 ")
		.replace(/\s+/g, " ");
	return BOOK_NAME_ALIASES[normalized] ?? normalized;
}

export function getKjvBookNumber(name: string): number | undefined {
	const normalized = normalizeBookName(name);
	const index = KJV_BOOKS.findIndex(
		(book) => book.toLowerCase() === normalized
	);
	return index >= 0 ? index + 1 : undefined;
}

const requestedBooks = new Map<number, Promise<string[][]>>();

export async function getKjvVerseText(
	bookNumber: number,
	chapter: number,
	verse: number
): Promise<string | undefined> {
	const name = getKjvBookName(bookNumber);
	if (!name || chapter < 1 || verse < 1) return undefined;
	try {
		let book = requestedBooks.get(bookNumber);
		if (!book) {
			const filename = `${String(bookNumber).padStart(2, "0")}-${name.toLowerCase().replace(/ /g, "-")}.json`;
			book = readFile(path.join(process.cwd(), "src", "data", "kjv", filename), "utf8").then(text => JSON.parse(text) as string[][]);
			requestedBooks.set(bookNumber, book);
		}
		return (await book)[chapter - 1]?.[verse - 1];
	} catch {
		requestedBooks.delete(bookNumber);
		return undefined;
	}
}
