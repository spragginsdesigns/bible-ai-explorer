/**
 * Regex to detect Bible verse references in text.
 * Handles patterns like:
 *   - John 3:16
 *   - 1 Corinthians 2:14
 *   - Gen. 1:1-3
 *   - Psalm 23:1-6
 *   - 2 Tim. 4:7
 *   - Revelation 21:1-4 KJV
 */

const BOOK_NAMES = [
	// Full names (order matters — longer first to avoid partial matches)
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
	"Joshua", "Judges", "Ruth",
	"1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
	"1 Chronicles", "2 Chronicles",
	"Ezra", "Nehemiah", "Esther",
	"Job", "Psalms?", "Proverbs", "Ecclesiastes", "Song of Solomon",
	"Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
	"Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
	"Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
	"Matthew", "Mark", "Luke", "John",
	"Acts", "Romans",
	"1 Corinthians", "2 Corinthians",
	"Galatians", "Ephesians", "Philippians", "Colossians",
	"1 Thessalonians", "2 Thessalonians",
	"1 Timothy", "2 Timothy",
	"Titus", "Philemon", "Hebrews", "James",
	"1 Peter", "2 Peter",
	"1 John", "2 John", "3 John",
	"Jude", "Revelation",
	// Common abbreviations
	"Gen\\.", "Exod\\.", "Lev\\.", "Num\\.", "Deut\\.",
	"Josh\\.", "Judg\\.", "Sam\\.", "Kgs\\.", "Chr\\.",
	"Neh\\.", "Esth\\.", "Ps\\.", "Prov\\.", "Eccles\\.",
	"Isa\\.", "Jer\\.", "Lam\\.", "Ezek\\.", "Dan\\.",
	"Hos\\.", "Ob\\.", "Mic\\.", "Nah\\.", "Hab\\.", "Zeph\\.", "Hag\\.", "Zech\\.", "Mal\\.",
	"Matt\\.", "Mk\\.", "Lk\\.", "Jn\\.",
	"Rom\\.", "Cor\\.", "Gal\\.", "Eph\\.", "Phil\\.", "Col\\.",
	"Thess\\.", "Tim\\.", "Tit\\.", "Phlm\\.", "Heb\\.", "Jas\\.",
	"Pet\\.", "Rev\\.",
];

const bookPattern = `(?:(?:[123]\\s)?(?:${BOOK_NAMES.join("|")}))`;
// Chapter:Verse with optional range (e.g., 3:16, 1:1-3, 23:1-6)
const refPattern = `\\d{1,3}:\\d{1,3}(?:\\s*[-–]\\s*\\d{1,3})?`;
// Optional trailing translation tag (KJV, NIV, ESV, etc.)
const translationPattern = `(?:\\s+(?:KJV|NKJV|NIV|ESV|NASB|NLT|RSV|ASV|AMP))?`;

export const VERSE_REFERENCE_REGEX = new RegExp(
	`(${bookPattern}\\s+${refPattern}${translationPattern})`,
	"g"
);

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

	const regex = new RegExp(VERSE_REFERENCE_REGEX.source, "g");
	let match;

	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
		}
		segments.push({ type: "verse-ref", value: match[1] });
		lastIndex = regex.lastIndex;
	}

	if (lastIndex < text.length) {
		segments.push({ type: "text", value: text.slice(lastIndex) });
	}

	return segments;
}
