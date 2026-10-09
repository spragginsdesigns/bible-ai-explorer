/**
 * Pure presentation logic for the reading log screen: the overview and
 * reflection payloads, day grouping for the timeline, and per-testament book
 * progress for the Bible map. Mirrors src/lib/reading-overview-rules.ts on the
 * server; tested in readingOverview.test.ts.
 */
import type { VerseRange } from "./readingLogCore";

export interface ReadingStreak {
	current: number;
	longest: number;
	atRisk: boolean;
	lastActiveDate: string | null;
}

export interface BookCoverage {
	book: number;
	complete: number[];
	started: number[];
}

/** GET /api/reading-log/overview */
export interface ReadingOverview {
	totals: {
		chaptersComplete: number;
		totalChapters: number;
		booksStarted: number;
		chapterReadings: number;
		activeDays: number;
		lastReadAt: string | null;
	};
	streak: ReadingStreak;
	books: BookCoverage[];
	historicalBackfillPending: boolean;
}

export interface ReadingReflection {
	title: string;
	reflection: string;
	verse: { book: number; bookName: string; chapter: number; verse: number; text: string; note: string | null } | null;
	next: { book: number; bookName: string; chapter: number; reason: string } | null;
}

/** GET /api/reading-log/reflection */
export type ReflectionResponse =
	| { status: "ready"; reflection: ReadingReflection; generatedAt: string }
	| { status: "empty" }
	| { status: "consent-required" }
	| { status: "unavailable" };

/** One entry from GET /api/reading-log, as the timeline reads it. */
export interface LogEntry {
	eventId: string;
	book: number;
	bookName?: string;
	chapter: number;
	translation: string;
	source: string;
	completed: boolean;
	verseRanges: VerseRange[];
	occurredAt: string | null;
	localDate?: string | null;
	precision: string;
	chapterVerses?: number;
}

export interface DayChapter {
	key: string;
	book: number;
	bookName: string;
	chapter: number;
	translation: string;
	completed: boolean;
	/** 0..1 share of the chapter's verses seen that day; 1 when completed. */
	fraction: number;
	readings: number;
	physical: boolean;
	/** Logged by the old five-second tracker before verse coverage existed. */
	legacy: boolean;
	firstVerse: number;
}

export interface LogDay {
	date: string;
	chapters: DayChapter[];
}

/** The device's IANA timezone, or null when the runtime cannot say. */
export function deviceTimezone(): string | null {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
	} catch {
		return null;
	}
}

/** "YYYY-MM-DD" for an instant on the device's calendar. */
export function localDateKey(instant: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

function entryDate(entry: LogEntry): string {
	if (entry.localDate) return entry.localDate;
	if (entry.occurredAt) return localDateKey(new Date(entry.occurredAt));
	return "unknown";
}

function versesIn(ranges: readonly VerseRange[]): Set<number> {
	const verses = new Set<number>();
	for (const range of ranges) for (let verse = range.start; verse <= range.end; verse++) verses.add(verse);
	return verses;
}

/**
 * Group entries into local days, newest day first, one row per chapter per day.
 * Rereading a chapter in a second session that day adds to `readings`, and
 * partial sessions pool their verses so the progress bar shows what was seen.
 */
export function groupByDay(entries: readonly LogEntry[], bookName: (order: number) => string): LogDay[] {
	const days: LogDay[] = [];
	const index = new Map<string, { day: LogDay; verses: Map<string, Set<number>> }>();
	for (const entry of entries) {
		const date = entryDate(entry);
		let bucket = index.get(date);
		if (!bucket) {
			bucket = { day: { date, chapters: [] }, verses: new Map() };
			index.set(date, bucket);
			days.push(bucket.day);
		}
		const key = `${date}:${entry.book}:${entry.chapter}`;
		let row = bucket.day.chapters.find((chapter) => chapter.key === key);
		if (!row) {
			row = {
				key,
				book: entry.book,
				bookName: entry.bookName ?? bookName(entry.book),
				chapter: entry.chapter,
				translation: entry.translation,
				completed: false,
				fraction: 0,
				readings: 0,
				physical: false,
				legacy: false,
				firstVerse: entry.verseRanges[0]?.start ?? 1,
			};
			bucket.day.chapters.push(row);
			bucket.verses.set(key, new Set());
		}
		const seen = bucket.verses.get(key)!;
		for (const verse of versesIn(entry.verseRanges)) seen.add(verse);
		row.readings += 1;
		row.completed ||= entry.completed;
		row.physical ||= entry.source === "physical";
		row.legacy ||= entry.source === "legacy";
		row.firstVerse = Math.min(row.firstVerse, entry.verseRanges[0]?.start ?? row.firstVerse);
		const total = entry.chapterVerses ?? 0;
		row.fraction = row.completed ? 1 : total > 0 ? Math.min(1, seen.size / total) : 0;
	}
	// The server pages by instant, not calendar date, so a trip across
	// timezones can deliver days out of order. Newest first, undated last.
	return days.sort((a, b) =>
		a.date === b.date ? 0 : a.date === "unknown" ? 1 : b.date === "unknown" ? -1 : a.date < b.date ? 1 : -1
	);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", "Wednesday, Oct 7", or "Oct 7, 2025" for another year. */
export function dayHeading(date: string, today: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Date not recorded";
	if (date === today) return "Today";
	const [y, m, d] = date.split("-").map(Number);
	const [ty, tm, td] = today.split("-").map(Number);
	const day = Date.UTC(y, m - 1, d);
	const diff = Math.round((Date.UTC(ty, tm - 1, td) - day) / 86_400_000);
	if (diff === 1) return "Yesterday";
	const label = `${MONTHS[m - 1]} ${d}`;
	if (y !== ty) return `${label}, ${y}`;
	if (diff > 1 && diff < 7) return WEEKDAYS[new Date(day).getUTCDay()];
	return `${WEEKDAYS[new Date(day).getUTCDay()]}, ${label}`;
}

export interface BookProgress {
	order: number;
	name: string;
	abbr: string;
	chapters: number;
	complete: Set<number>;
	started: Set<number>;
}

/** Every book of a testament in canonical order, with what has been read. */
export function testamentProgress(
	books: readonly { order: number; name: string; abbr: string; chapters: number; testament: "OT" | "NT" }[],
	coverage: readonly BookCoverage[],
	testament: "OT" | "NT",
): BookProgress[] {
	const byBook = new Map(coverage.map((entry) => [entry.book, entry]));
	return books
		.filter((book) => book.testament === testament)
		.map((book) => ({
			order: book.order,
			name: book.name,
			abbr: book.abbr,
			chapters: book.chapters,
			complete: new Set(byBook.get(book.order)?.complete ?? []),
			started: new Set(byBook.get(book.order)?.started ?? []),
		}));
}

/** "3%", or "<1%" so a first chapter never reads as zero. */
export function percentOfBible(chapters: number, total: number): string {
	if (chapters <= 0 || total <= 0) return "0%";
	const percent = (chapters / total) * 100;
	return percent < 1 ? "<1%" : `${Math.floor(percent)}%`;
}

/** "Written this morning" style freshness line for the reflection card. */
export function reflectionAge(generatedAt: string, now: Date): string {
	const at = new Date(generatedAt);
	if (Number.isNaN(at.getTime())) return "";
	if (localDateKey(at) === localDateKey(now)) return "Written today from your reading";
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (localDateKey(at) === localDateKey(yesterday)) return "Written yesterday from your reading";
	return `Written ${MONTHS[at.getMonth()]} ${at.getDate()} from your reading`;
}

/** The streak tile's small line. */
export function streakNote(streak: ReadingStreak): string {
	if (streak.atRisk) return "Read today to keep it";
	if (streak.current === 0) return streak.longest ? `Best ${streak.longest}` : "Read today to start";
	return streak.current >= streak.longest ? "Your best yet" : `Best ${streak.longest}`;
}

/** The map opens on the testament with more reading; a tie goes to the New. */
export function defaultTestament(
	books: readonly { order: number; name: string; abbr: string; chapters: number; testament: "OT" | "NT" }[],
	coverage: readonly BookCoverage[],
): "OT" | "NT" {
	const count = (testament: "OT" | "NT") =>
		testamentProgress(books, coverage, testament).reduce((sum, book) => sum + book.complete.size + book.started.size, 0);
	return count("NT") >= count("OT") ? "NT" : "OT";
}

/** Width of a partial reading's bar, in percent: never so thin it disappears. */
export function partialPercent(fraction: number): number {
	return Math.max(6, Math.round(fraction * 100));
}
