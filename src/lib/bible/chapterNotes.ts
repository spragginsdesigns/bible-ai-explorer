/**
 * Pure chapter-to-note matcher for the Bible reader ("My Study" loop).
 *
 * Links the user's saved notes to the chapter and verses currently on screen
 * without a database round-trip per chapter: callers hand in the cached note
 * summaries (`id`, `title`, `plainText`, `updatedAt`) and the active chapter
 * (`bookName`, `bookAbbr`, `chapter`, `verseCount`), and receive both the
 * per-verse set for inline reader indicators and the filtered list for the
 * Verse Sheet's Notes tab.
 *
 * Pure and zero-dependency so `src/lib/bible/chapterNotes.ts` and
 * `mobile/src/features/bible/chapterNotes.ts` stay byte-for-byte identical
 * (pinned by `tests/chapter-notes.test.mjs`).
 */

export interface ChapterNoteSummary {
	id: string;
	title: string;
	plainText?: string | null;
	updatedAt: string;
}

export interface ChapterNotesContext {
	bookName: string;
	bookAbbr?: string;
	chapter: number;
	/** Maximum verse number in this chapter (used to clamp ranges). Defaults to 200. */
	verseCount?: number;
}

export interface MatchedChapterNote {
	id: string;
	title: string;
	excerpt: string;
	updatedAt: string;
	/** Sorted 1-based verse numbers in this chapter explicitly referenced by the note. */
	verses: number[];
	/** True when the note's title names this chapter as a whole (e.g. "Romans 8 Study"). */
	chapterLevel: boolean;
}

const EXTRA_BOOK_STEMS: Readonly<Record<string, readonly string[]>> = {
	Exodus: ["Exod", "Ex"],
	Psalms: ["Psalm", "Ps"],
	Ecclesiastes: ["Eccles", "Eccl"],
	"Song of Solomon": ["Song of Songs", "Song"],
	Obadiah: ["Obad", "Ob"],
	Matthew: ["Matt"],
	Mark: ["Mk"],
	Luke: ["Lk"],
	John: ["Jn"],
	"1 John": ["1 Jn", "1Jn"],
	"2 John": ["2 Jn", "2Jn"],
	"3 John": ["3 Jn", "3Jn"],
	Titus: ["Tit"],
};

function escapeRegex(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the regex alternation for a book's canonical name, its standard
 * abbreviation, and any known alias stems (longest first). Numbered books
 * ("1 Corinthians", "1 Cor") allow an optional space after the leading digit
 * ("1Cor 13:4").
 */
function buildBookPattern(bookName: string, bookAbbr?: string): string {
	const rawStems = new Set<string>([bookName.trim()]);
	if (bookAbbr?.trim()) rawStems.add(bookAbbr.trim().replace(/\.$/, ""));
	for (const extra of EXTRA_BOOK_STEMS[bookName] ?? []) {
		rawStems.add(extra);
	}
	const patterns = [...rawStems]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length)
		.map((stem) => {
			const numbered = /^([123])\s+(.+)$/.exec(stem);
			if (numbered) {
				return `${numbered[1]}\\s*${escapeRegex(numbered[2]).replace(/\\ /g, "\\s+")}`;
			}
			return escapeRegex(stem).replace(/\\ /g, "\\s+");
		});
	return `(?:${patterns.join("|")})`;
}

/**
 * A non-numbered book like "John" must not match inside "1 John 3:16" or
 * "2Jn 1:3". Checks the text immediately preceding `matchIndex`.
 */
function isPrecededByVolumeDigit(text: string, matchIndex: number): boolean {
	let i = matchIndex - 1;
	while (i >= 0 && (text[i] === " " || text[i] === "\t")) i -= 1;
	if (i < 0) return false;
	const ch = text[i];
	if (ch !== "1" && ch !== "2" && ch !== "3") return false;
	return i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]);
}

function buildExcerpt(title: string, plainText: string | null | undefined): string {
	const raw = (plainText ?? "").trim();
	if (!raw) return "";
	const lines = raw
		.split(/\r?\n/)
		.map((line) => line.replace(/^>\s*/, "").trim())
		.filter(Boolean);
	// If the note has multiple lines and the first line is just the title or
	// reference header, prefer the lines after it so the reader sees their own
	// commentary or the verse text rather than the title twice.
	const normalizedTitle = title.trim().toLowerCase();
	const bodyLines =
		lines.length > 1 && lines[0].toLowerCase() === normalizedTitle ? lines.slice(1) : lines;
	const joined = bodyLines.join(" ").replace(/\s+/g, " ").trim();
	if (joined.length <= 140) return joined;
	return `${joined.slice(0, 137).trimEnd()}…`;
}

/**
 * Scan the user's notes for references to `context.bookName` + `context.chapter`.
 * Returns matches ordered with the most recently updated notes first.
 */
export function matchChapterNotes(
	notes: readonly ChapterNoteSummary[],
	context: ChapterNotesContext
): MatchedChapterNote[] {
	const { bookName, bookAbbr, chapter } = context;
	const maxVerse = context.verseCount && context.verseCount > 0 ? context.verseCount : 200;
	if (!bookName.trim() || !Number.isInteger(chapter) || chapter < 1) return [];

	const isNumberedBook = /^[123]\s/.test(bookName.trim());
	const bookAlt = buildBookPattern(bookName, bookAbbr);
	// Matches e.g. "John 3:16", "Jn. 3:16-18", "1 Cor 13:4–7", "John 3:16-4:2"
	const verseRegex = new RegExp(
		`(?<![A-Za-z0-9])(${bookAlt})\\.?\\s+${chapter}:(\\d{1,3})(?:\\s*[-\\u2013\\u2014]\\s*(\\d{1,3})(?::(\\d{1,3}))?)?(?!\\d)(?!:\\d)`,
		"gi"
	);
	// Matches a whole-chapter title like "John 3" or "Romans 8 Study" (no ":verse" after the chapter)
	const chapterTitleRegex = new RegExp(
		`(?<![A-Za-z0-9])(${bookAlt})\\.?\\s+${chapter}(?!\\d)(?!\\s*:\\s*\\d)`,
		"gi"
	);

	const results: MatchedChapterNote[] = [];

	for (const note of notes) {
		const verseSet = new Set<number>();
		const combined = `${note.title}\n${note.plainText ?? ""}`;

		verseRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = verseRegex.exec(combined)) !== null) {
			if (!isNumberedBook && isPrecededByVolumeDigit(combined, match.index)) {
				continue;
			}
			const startVerse = Number.parseInt(match[2], 10);
			if (!Number.isInteger(startVerse) || startVerse < 1 || startVerse > maxVerse) {
				continue;
			}
			const rangeSecond = match[3] ? Number.parseInt(match[3], 10) : null;
			const crossChapterVerse = match[4] ? Number.parseInt(match[4], 10) : null;

			let endVerse = startVerse;
			if (rangeSecond !== null && crossChapterVerse === null && rangeSecond >= startVerse) {
				endVerse = Math.min(rangeSecond, maxVerse, startVerse + 50);
			}
			for (let v = startVerse; v <= endVerse; v += 1) {
				verseSet.add(v);
			}
		}

		let chapterLevel = false;
		chapterTitleRegex.lastIndex = 0;
		let titleMatch: RegExpExecArray | null;
		while ((titleMatch = chapterTitleRegex.exec(note.title)) !== null) {
			if (!isNumberedBook && isPrecededByVolumeDigit(note.title, titleMatch.index)) {
				continue;
			}
			chapterLevel = true;
			break;
		}

		if (verseSet.size === 0 && !chapterLevel) continue;

		results.push({
			id: note.id,
			title: note.title || "Untitled Note",
			excerpt: buildExcerpt(note.title, note.plainText),
			updatedAt: note.updatedAt,
			verses: [...verseSet].sort((a, b) => a - b),
			chapterLevel,
		});
	}

	return results.sort((a, b) => {
		const timeA = Date.parse(a.updatedAt) || 0;
		const timeB = Date.parse(b.updatedAt) || 0;
		return timeB - timeA;
	});
}

/**
 * The set of 1-based verse numbers in the active chapter that have at least
 * one explicit verse note. Used by the chapter reader to render the inline
 * note badge beside the verse number.
 */
export function versesWithNotes(matches: readonly MatchedChapterNote[]): Set<number> {
	const set = new Set<number>();
	for (const note of matches) {
		for (const v of note.verses) set.add(v);
	}
	return set;
}

/**
 * Notes relevant to the Verse Sheet's current selection: notes that explicitly
 * cite any verse in `[selection.start, selection.end]` come first, followed by
 * whole-chapter notes (`chapterLevel: true`).
 */
export function notesForSelection(
	matches: readonly MatchedChapterNote[],
	selection: { start: number; end: number } | null
): MatchedChapterNote[] {
	if (!selection) return [];
	const start = Math.min(selection.start, selection.end);
	const end = Math.max(selection.start, selection.end);

	const verseMatches: MatchedChapterNote[] = [];
	const chapterMatches: MatchedChapterNote[] = [];

	for (const note of matches) {
		const touchesSelection = note.verses.some((v) => v >= start && v <= end);
		if (touchesSelection) {
			verseMatches.push(note);
		} else if (note.chapterLevel) {
			chapterMatches.push(note);
		}
	}
	return [...verseMatches, ...chapterMatches];
}
