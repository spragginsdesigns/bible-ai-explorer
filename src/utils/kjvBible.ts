import { readFile } from "node:fs/promises";
import path from "node:path";

interface KjvBook {
	name: string;
	heading: string;
}

const KJV_BOOKS: readonly KjvBook[] = [
	{ name: "Genesis", heading: "The First Book of Moses: Called Genesis" },
	{ name: "Exodus", heading: "The Second Book of Moses: Called Exodus" },
	{ name: "Leviticus", heading: "The Third Book of Moses: Called Leviticus" },
	{ name: "Numbers", heading: "The Fourth Book of Moses: Called Numbers" },
	{ name: "Deuteronomy", heading: "The Fifth Book of Moses: Called Deuteronomy" },
	{ name: "Joshua", heading: "The Book of Joshua" },
	{ name: "Judges", heading: "The Book of Judges" },
	{ name: "Ruth", heading: "The Book of Ruth" },
	{ name: "1 Samuel", heading: "The First Book of Samuel" },
	{ name: "2 Samuel", heading: "The Second Book of Samuel" },
	{ name: "1 Kings", heading: "The First Book of the Kings" },
	{ name: "2 Kings", heading: "The Second Book of the Kings" },
	{ name: "1 Chronicles", heading: "The First Book of the Chronicles" },
	{ name: "2 Chronicles", heading: "The Second Book of the Chronicles" },
	{ name: "Ezra", heading: "Ezra" },
	{ name: "Nehemiah", heading: "The Book of Nehemiah" },
	{ name: "Esther", heading: "The Book of Esther" },
	{ name: "Job", heading: "The Book of Job" },
	{ name: "Psalms", heading: "The Book of Psalms" },
	{ name: "Proverbs", heading: "The Proverbs" },
	{ name: "Ecclesiastes", heading: "Ecclesiastes" },
	{ name: "Song of Solomon", heading: "The Song of Solomon" },
	{ name: "Isaiah", heading: "The Book of the Prophet Isaiah" },
	{ name: "Jeremiah", heading: "The Book of the Prophet Jeremiah" },
	{ name: "Lamentations", heading: "The Lamentations of Jeremiah" },
	{ name: "Ezekiel", heading: "The Book of the Prophet Ezekiel" },
	{ name: "Daniel", heading: "The Book of Daniel" },
	{ name: "Hosea", heading: "Hosea" },
	{ name: "Joel", heading: "Joel" },
	{ name: "Amos", heading: "Amos" },
	{ name: "Obadiah", heading: "Obadiah" },
	{ name: "Jonah", heading: "Jonah" },
	{ name: "Micah", heading: "Micah" },
	{ name: "Nahum", heading: "Nahum" },
	{ name: "Habakkuk", heading: "Habakkuk" },
	{ name: "Zephaniah", heading: "Zephaniah" },
	{ name: "Haggai", heading: "Haggai" },
	{ name: "Zechariah", heading: "Zechariah" },
	{ name: "Malachi", heading: "Malachi" },
	{ name: "Matthew", heading: "The Gospel According to Saint Matthew" },
	{ name: "Mark", heading: "The Gospel According to Saint Mark" },
	{ name: "Luke", heading: "The Gospel According to Saint Luke" },
	{ name: "John", heading: "The Gospel According to Saint John" },
	{ name: "Acts", heading: "The Acts of the Apostles" },
	{ name: "Romans", heading: "The Epistle of Paul the Apostle to the Romans" },
	{ name: "1 Corinthians", heading: "The First Epistle of Paul the Apostle to the Corinthians" },
	{ name: "2 Corinthians", heading: "The Second Epistle of Paul the Apostle to the Corinthians" },
	{ name: "Galatians", heading: "The Epistle of Paul the Apostle to the Galatians" },
	{ name: "Ephesians", heading: "The Epistle of Paul the Apostle to the Ephesians" },
	{ name: "Philippians", heading: "The Epistle of Paul the Apostle to the Philippians" },
	{ name: "Colossians", heading: "The Epistle of Paul the Apostle to the Colossians" },
	{ name: "1 Thessalonians", heading: "The First Epistle of Paul the Apostle to the Thessalonians" },
	{ name: "2 Thessalonians", heading: "The Second Epistle of Paul the Apostle to the Thessalonians" },
	{ name: "1 Timothy", heading: "The First Epistle of Paul the Apostle to Timothy" },
	{ name: "2 Timothy", heading: "The Second Epistle of Paul the Apostle to Timothy" },
	{ name: "Titus", heading: "The Epistle of Paul the Apostle to Titus" },
	{ name: "Philemon", heading: "The Epistle of Paul the Apostle to Philemon" },
	{ name: "Hebrews", heading: "The Epistle of Paul the Apostle to the Hebrews" },
	{ name: "James", heading: "The General Epistle of James" },
	{ name: "1 Peter", heading: "The First Epistle General of Peter" },
	{ name: "2 Peter", heading: "The Second General Epistle of Peter" },
	{ name: "1 John", heading: "The First Epistle General of John" },
	{ name: "2 John", heading: "The Second Epistle General of John" },
	{ name: "3 John", heading: "The Third Epistle General of John" },
	{ name: "Jude", heading: "The General Epistle of Jude" },
	{ name: "Revelation", heading: "The Revelation of Saint John the Divine" },
];

const BODY_START_HEADING = "The Old Testament of the King James Version of the Bible";
const BODY_END_MARKER = "*** END OF THE PROJECT GUTENBERG EBOOK";
const VERSE_MARKER_PATTERN = /(?:^|\s)(\d+):(\d+)\s+/g;

let kjvIndexPromise: Promise<Map<string, string>> | undefined;

function verseKey(bookNumber: number, chapter: number, verse: number): string {
	return `${bookNumber}:${chapter}:${verse}`;
}

function buildKjvIndex(source: string): Map<string, string> {
	const normalizedSource = source.replace(/\r\n/g, "\n");
	const bodyStart = normalizedSource.lastIndexOf(BODY_START_HEADING);
	if (bodyStart < 0) {
		throw new Error("KJV corpus body heading was not found.");
	}

	const body = normalizedSource.slice(bodyStart);
	const bookStarts: number[] = [];
	let searchFrom = 0;

	for (const book of KJV_BOOKS) {
		const heading = `\n${book.heading}\n`;
		const headingStart = body.indexOf(heading, searchFrom);
		if (headingStart < 0) {
			throw new Error(`KJV corpus heading was not found for ${book.name}.`);
		}
		bookStarts.push(headingStart + heading.length);
		searchFrom = headingStart + heading.length;
	}

	const index = new Map<string, string>();

	for (let bookIndex = 0; bookIndex < KJV_BOOKS.length; bookIndex++) {
		const sectionStart = bookStarts[bookIndex];
		const sectionEnd =
			bookStarts[bookIndex + 1] ?? body.indexOf(BODY_END_MARKER, sectionStart);
		const section = body.slice(sectionStart, sectionEnd < 0 ? undefined : sectionEnd);
		const markers = Array.from(section.matchAll(VERSE_MARKER_PATTERN));

		for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
			const marker = markers[markerIndex];
			const chapter = Number(marker[1]);
			const verse = Number(marker[2]);
			const textStart = (marker.index ?? 0) + marker[0].length;
			const textEnd = markers[markerIndex + 1]?.index ?? section.length;
			const text = section.slice(textStart, textEnd).replace(/\s+/g, " ").trim();

			if (text) {
				index.set(verseKey(bookIndex + 1, chapter, verse), text);
			}
		}
	}

	return index;
}

async function getKjvIndex(): Promise<Map<string, string>> {
	kjvIndexPromise ??= readFile(
		path.join(process.cwd(), "biblical-texts", "KJV-Bible.txt"),
		"utf8"
	).then(buildKjvIndex);

	return kjvIndexPromise;
}

export function getKjvBookName(bookNumber: number): string | undefined {
	return KJV_BOOKS[bookNumber - 1]?.name;
}

export async function getKjvVerseText(
	bookNumber: number,
	chapter: number,
	verse: number
): Promise<string | undefined> {
	const index = await getKjvIndex();
	return index.get(verseKey(bookNumber, chapter, verse));
}
