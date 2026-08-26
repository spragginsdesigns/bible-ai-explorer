/**
 * Detects Bible verse references in assistant prose so they can be wrapped in
 * a popover. Handles patterns like:
 *   - John 3:16
 *   - 1 Corinthians 2:14   /   1Cor 2:14
 *   - Gen. 1:1-3   /   Gen.1:1   /   Gen 1:1
 *   - Psalm 23:1-6
 *   - John 3:16-4:2 (cross-chapter range, captured whole or not at all)
 *   - Revelation 21:1-4 KJV
 * Matching is case-insensitive, so a model that lowercases ("john 3:16") still
 * gets a link.
 *
 * Keep in sync with mobile/src/features/chat/verseLinks.ts - the two clients
 * must link the same strings (CLAUDE.md parity rule). tests/verse-parity.test.mjs
 * runs both parsers over the same sentences and fails if they disagree.
 *
 * DETECTION IS NOT ACCEPTANCE. The regex is deliberately loose; every candidate
 * it produces is then validated through `resolveReference`
 * (src/lib/bible/books.ts) and anything that does not resolve is left as plain
 * text - exactly what Android does with its own copy of the book table. A
 * linked reference opens a popover that fetches the verse and offers "Read in
 * the Bible", so a link that cannot resolve is a dead end: "John 25:1" (John
 * has 21 chapters) and "Sam 1:1" (which volume?) must stay plain prose.
 *
 * The numbered books stay a separate branch below even so, because the branch
 * decides where a match STARTS. A rejected candidate is skipped whole and the
 * scan resumes after it, never re-scanned for a shorter reference inside
 * itself - so "2 Genesis 1:1" links "Genesis 1:1" only because the numeral
 * branch never matched there ("Genesis" is not a numbered book), not because
 * anything backtracked.
 */
import { resolveReference } from "@/lib/bible/books";

/**
 * Books that exist only as a numbered volume, written WITHOUT the numeral.
 * The pattern requires one in front of these. "John" is here as well as in
 * the single list: it is both a Gospel and three epistles.
 */
export const NUMBERED_BOOK_NAMES = [
	"Samuel", "Kings", "Chronicles",
	"Corinthians", "Thessalonians", "Timothy", "Peter",
	"John",
];

/**
 * Books spelled out in full that carry no volume number. These require
 * whitespace between the name and the chapter, so "Genesis1:1" stays
 * unlinked. Longer names come first so a short name cannot shadow a longer
 * one that starts with it.
 */
export const SINGLE_BOOK_NAMES = [
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
	"Joshua", "Judges", "Ruth",
	"Ezra", "Nehemiah", "Esther",
	"Job", "Psalms?", "Proverbs", "Ecclesiastes",
	"Song of Solomon", "Song of Songs",
	"Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
	"Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
	"Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
	"Matthew", "Mark", "Luke", "John",
	"Acts", "Romans",
	"Galatians", "Ephesians", "Philippians", "Colossians",
	"Titus", "Philemon", "Hebrews", "James",
	"Jude", "Revelation",
];

/**
 * Abbreviations of the numbered books, written WITHOUT the trailing period.
 * A numeral is required in front ("1 Sam 1:1"), because a bare "Sam 1:1"
 * cannot be resolved to a book.
 */
export const NUMBERED_ABBREVIATIONS = [
	"Thess", "Sam", "Kgs", "Chr", "Cor", "Tim", "Pet", "Jn",
];

/**
 * Abbreviations of the single-volume books, written WITHOUT the trailing
 * period. Each one is accepted in two shapes: with a period and optional
 * space ("Gen. 1:1", "Gen.1:1") or bare with a required space ("Gen 1:1").
 * The bare form must keep the space or ordinary words would start swallowing
 * digits. Longest-first so "Eccles" is reachable even though "Eccl" prefixes
 * it, "Exod" before "Ex", and "Obad" before "Ob".
 *
 * Mirrors BOOK_ABBREVIATIONS in mobile/src/features/chat/verseLinks.ts: "Ex",
 * "Obad" and "Song" are books.json's own abbreviations, which Android accepted
 * and web silently did not.
 */
export const SINGLE_ABBREVIATIONS = [
	"Eccles", "Eccl",
	"Deut", "Josh", "Judg", "Prov", "Ezek", "Zeph", "Zech",
	"Matt", "Phlm", "Exod", "Esth", "Hag", "Obad", "Song",
	"Gen", "Lev", "Num", "Neh", "Isa", "Jer", "Lam",
	"Dan", "Hos", "Mic", "Nah", "Hab", "Mal", "Rom", "Gal", "Eph",
	"Phil", "Col", "Tit", "Heb", "Jas", "Rev",
	"Ps", "Ob", "Ex", "Mk", "Lk", "Jn",
];

/** Translation tags the model may append to a reference. */
export const TRANSLATION_TAGS = "NKJV|KJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP";

// The numeral of a numbered book, with the space the model may omit ("2Cor").
const volumeNumber = `[123]\\s?`;
// An abbreviation may end in a period that butts straight against the chapter
// ("Gen.1:1"), which is how several models emit them.
const afterAbbreviation = `(?:\\.\\s*|\\s+)`;
const bookPattern =
	`(?:` +
	`${volumeNumber}(?:${NUMBERED_BOOK_NAMES.join("|")})\\s+` +
	`|${volumeNumber}(?:${NUMBERED_ABBREVIATIONS.join("|")})${afterAbbreviation}` +
	`|(?:${SINGLE_BOOK_NAMES.join("|")})\\s+` +
	`|(?:${SINGLE_ABBREVIATIONS.join("|")})${afterAbbreviation}` +
	`)`;
// Chapter:Verse with an optional range end that may cross a chapter boundary
// (3:16, 1:1-3, 23:1-6, 3:16-4:2). The dash class carries U+2013 and U+2014 as
// escapes rather than literals: models emit both, and this file has to survive
// round-trips through tooling that flattens non-ASCII.
const DASHES = "-\\u2013\\u2014";
const refPattern = `\\d{1,3}:\\d{1,3}(?:\\s*[${DASHES}]\\s*\\d{1,3}(?::\\d{1,3})?)?`;
const translationPattern = `(?:\\s+(?:${TRANSLATION_TAGS}))?`;
/**
 * Refuse to stop mid-number: without this, "John 3:16-4:2" captures the
 * truncated "John 3:16-4" and leaves a dangling ":2" beside the link. A bare
 * trailing colon is fine and common in production prose ("...found in John
 * 3:14:", 'Read Psalm 23:1-6: "The LORD...'), so only a colon that starts
 * another number is rejected - `(?![:\d])` unlinked those sentences entirely.
 */
const referenceBoundary = `(?!\\d)(?!:\\d)`;

/**
 * Case-insensitive, like Android's copy: models lowercase references often
 * enough that a case-sensitive list quietly dropped them, and the validator
 * below is what keeps the looser match honest.
 */
export const VERSE_REFERENCE_REGEX = new RegExp(
	`\\b(${bookPattern}${refPattern}${referenceBoundary}${translationPattern})`,
	"gi"
);

const TRANSLATION_TAG_SUFFIX = new RegExp(`\\s+(?:${TRANSLATION_TAGS})$`, "i");

/**
 * Drop a trailing translation tag from a captured reference. Lookups resolve
 * the reference itself; the tag is display-only, and leaving it on is what
 * turned "Isaiah 53:5 NKJV" into a failed fetch.
 */
export function stripTranslationTag(reference: string): string {
	return reference.trim().replace(TRANSLATION_TAG_SUFFIX, "").trim();
}

/**
 * Can this captured reference actually be opened in the reader? The tag is
 * display-only so it comes off first; resolveReference itself already accepts
 * the range tail ("John 3:16-4:2") and the period-with-no-space form
 * ("Gen.1:1") the detection regex allows.
 */
export function isResolvableReference(reference: string): boolean {
	return resolveReference(stripTranslationTag(reference)) !== null;
}

/**
 * Split text into segments of plain text and verse references.
 */
export interface TextSegment {
	type: "text" | "verse-ref";
	value: string;
}

export function parseVerseReferences(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let lastIndex = 0;

	const regex = new RegExp(VERSE_REFERENCE_REGEX.source, "gi");
	let match;

	while ((match = regex.exec(text)) !== null) {
		const value = match[1];
		// Detection is not acceptance. A candidate the reader could not open is
		// skipped whole and falls into the surrounding text segment - the scan
		// resumes after it rather than hunting for a shorter reference inside
		// it, which is exactly what segmentVerseReferences does on Android.
		if (!isResolvableReference(value)) continue;
		if (match.index > lastIndex) {
			segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
		}
		segments.push({ type: "verse-ref", value });
		lastIndex = regex.lastIndex;
	}

	if (lastIndex < text.length) {
		segments.push({ type: "text", value: text.slice(lastIndex) });
	}

	return segments;
}
