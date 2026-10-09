/**
 * Pure rules behind the reading log overview (streak, per-book coverage) and
 * the "Your walk" reflection (cache key, prompt facts, output validation).
 *
 * Kept free of Prisma and "@/" imports so tests/reading-overview.test.mjs can
 * load it with plain `node --experimental-strip-types`.
 */

/** Canonical KJV chapter count across all 66 books. */
export const TOTAL_BIBLE_CHAPTERS = 1189;

/** A stored reflection is reused while the reading behind it is unchanged, up to this age. */
export const REFLECTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * New reading makes a reflection stale, but a fresh one is still served for this
 * long so a person reading chapter after chapter does not pay for a model call
 * per chapter. The card says what it was written from, so a short lag is honest.
 */
export const REFLECTION_MIN_REWRITE_MS = 3 * 60 * 60 * 1000;

export const REFLECTION_MAX_TITLE = 60;
export const REFLECTION_MAX_TEXT = 700;
export const REFLECTION_MAX_NOTE = 220;

export interface StreakInterval {
	startDate: string;
	endDate: string;
}

export interface ReadingStreak {
	/** Consecutive local days with reading ending today or yesterday; 0 when broken. */
	current: number;
	longest: number;
	/** True when the current streak has not been extended today yet. */
	atRisk: boolean;
	lastActiveDate: string | null;
}

function dayNumber(day: string): number {
	return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/** Days covered by an inclusive YYYY-MM-DD interval. */
export function intervalDays(interval: StreakInterval): number {
	return dayNumber(interval.endDate) - dayNumber(interval.startDate) + 1;
}

/**
 * Fold the stored disjoint active-day intervals into the streak a person sees.
 * An unread today does not break a streak yet: it ends at yesterday and is "at risk".
 */
export function streakFromIntervals(intervals: readonly StreakInterval[], today: string): ReadingStreak {
	let longest = 0;
	let latest: StreakInterval | null = null;
	for (const interval of intervals) {
		if (intervalDays(interval) <= 0) continue;
		longest = Math.max(longest, intervalDays(interval));
		if (!latest || interval.endDate > latest.endDate) latest = interval;
	}
	if (!latest) return { current: 0, longest: 0, atRisk: false, lastActiveDate: null };
	const gap = dayNumber(today) - dayNumber(latest.endDate);
	// A future endDate (a device clock ahead of ours) still counts as today.
	const alive = gap <= 1;
	const current = alive ? intervalDays(latest) : 0;
	return { current, longest: Math.max(longest, current), atRisk: alive && gap === 1, lastActiveDate: latest.endDate };
}

export interface ChapterCounter {
	book: number;
	chapter: number;
	entries: number;
	chapterReadings: number;
}

export interface BookCoverage {
	book: number;
	/** Chapters read whole in a single session at least once, ascending. */
	complete: number[];
	/** Chapters with some verses read but never completed in one sitting, ascending. */
	started: number[];
}

/** Group lifetime chapter counters by book; books with no reading are omitted. */
export function foldBookCoverage(rows: readonly ChapterCounter[]): BookCoverage[] {
	const books = new Map<number, BookCoverage>();
	for (const row of rows) {
		if (row.entries <= 0 && row.chapterReadings <= 0) continue;
		const book = books.get(row.book) ?? { book: row.book, complete: [], started: [] };
		(row.chapterReadings > 0 ? book.complete : book.started).push(row.chapter);
		books.set(row.book, book);
	}
	return [...books.values()]
		.sort((a, b) => a.book - b.book)
		.map((book) => ({
			book: book.book,
			complete: [...book.complete].sort((a, b) => a - b),
			started: [...book.started].sort((a, b) => a - b),
		}));
}

export interface ReflectionTotals {
	chapterReadings: number;
	partialReadings: number;
	sessions: number;
	lastReadAt: Date | string | null;
}

/**
 * Changes whenever reading is added, corrected or removed, and records whether
 * memories were allowed into the prompt that wrote it.
 */
export function reflectionBasis(totals: ReflectionTotals | null, memoryAllowed: boolean): string {
	const memory = memoryAllowed ? "m1" : "m0";
	if (!totals) return `none:${memory}`;
	const last = totals.lastReadAt ? new Date(totals.lastReadAt).toISOString() : "never";
	return `${totals.chapterReadings}:${totals.partialReadings}:${totals.sessions}:${last}:${memory}`;
}

/**
 * A reflection written from memories must not outlive the person turning
 * memory off: it is neither served nor kept as a fallback.
 */
export function storedReflectionAllowed(storedBasis: string, memoryAllowed: boolean): boolean {
	return memoryAllowed || !storedBasis.endsWith(":m1");
}

export function hasAnyReading(totals: ReflectionTotals | null): boolean {
	return Boolean(totals && totals.chapterReadings + totals.partialReadings > 0);
}

/** Memories (`id:fingerprint`) and note ids a reflection was written from. */
export interface ReflectionSources {
	memories: string[];
	notes: string[];
}

/** True while every source is still present as it was; additions never retire a reflection. */
export function reflectionSourcesPresent(
	stored: ReflectionSources,
	current: { memories: ReadonlySet<string>; notes: ReadonlySet<string> },
): boolean {
	return stored.memories.every((key) => current.memories.has(key)) && stored.notes.every((id) => current.notes.has(id));
}

export type ReflectionDecision = "reuse" | "generate";

/**
 * Whether a stored reflection can be served. Unchanged reading reuses it for up
 * to a week (memories and chats move too); changed reading rewrites it once it
 * is at least a few hours old.
 */
export function reflectionDecision(
	stored: { basis: string; createdAt: Date } | null,
	basis: string,
	now: Date,
): ReflectionDecision {
	if (!stored) return "generate";
	const age = now.getTime() - stored.createdAt.getTime();
	if (stored.basis === basis) return age < REFLECTION_MAX_AGE_MS ? "reuse" : "generate";
	return age < REFLECTION_MIN_REWRITE_MS ? "reuse" : "generate";
}

export interface RecentReadingRow {
	book: number;
	bookName: string;
	chapter: number;
	completed: boolean;
	localDate: string;
	source: string;
}

/**
 * Recent reading, one line per local day, newest first:
 * "2026-10-09: James 4 (part), James 3 (part)". Same chapter on one day is listed once.
 */
export function formatRecentDays(rows: readonly RecentReadingRow[], maxDays = 14): string {
	const days = new Map<string, Map<string, { completed: boolean; physical: boolean }>>();
	for (const row of rows) {
		const day = days.get(row.localDate) ?? new Map();
		const key = `${row.bookName} ${row.chapter}`;
		const seen = day.get(key);
		day.set(key, {
			completed: Boolean(seen?.completed) || row.completed,
			physical: Boolean(seen?.physical) || row.source === "physical",
		});
		days.set(row.localDate, day);
	}
	return (
		[...days.entries()]
			.sort((a, b) => (a[0] < b[0] ? 1 : -1))
			.slice(0, maxDays)
			.map(
				([day, chapters]) =>
					`${day}: ${[...chapters.entries()]
						.map(
							([name, state]) =>
								`${name}${state.completed ? "" : " (part)"}${state.physical ? " [physical Bible]" : ""}`,
						)
						.join(", ")}`,
			)
			.join("\n") || "(none)"
	);
}

export interface BookMeta {
	order: number;
	name: string;
	chapters: number;
}

/** "James: 3 of 5 chapters complete, 1 started" for every book touched, most read first. */
export function formatBookCoverage(coverage: readonly BookCoverage[], books: readonly BookMeta[]): string {
	return (
		[...coverage]
			.sort((a, b) => b.complete.length + b.started.length - (a.complete.length + a.started.length) || a.book - b.book)
			.map((entry) => {
				const meta = books.find((book) => book.order === entry.book);
				if (!meta) return null;
				return `${meta.name}: ${entry.complete.length} of ${meta.chapters} chapters complete${
					entry.started.length ? `, ${entry.started.length} started` : ""
				}`;
			})
			.filter((line): line is string => Boolean(line))
			.join("\n") || "(none)"
	);
}

export interface RawReflection {
	title: string;
	reflection: string;
	verse: { book: string; chapter: number; verse: number } | null;
	verseNote: string | null;
	next: { book: string; chapter: number; reason: string } | null;
}

export interface ReadingReflectionContent {
	title: string;
	reflection: string;
	verse: { book: number; bookName: string; chapter: number; verse: number; text: string; note: string | null } | null;
	next: { book: number; bookName: string; chapter: number; reason: string } | null;
}

export interface ReflectionResolvers {
	bookNumber(name: string): number | undefined;
	bookMeta(order: number): BookMeta | null;
	verseText(book: number, chapter: number, verse: number): Promise<string | undefined>;
	clean(text: string): string;
}

function clip(text: string, max: number): string {
	const trimmed = text.trim().replace(/\s+\n/g, "\n");
	if (trimmed.length <= max) return trimmed;
	const cut = trimmed.slice(0, max);
	const sentence = cut.lastIndexOf(". ");
	return (sentence > max * 0.5 ? cut.slice(0, sentence + 1) : cut.replace(/\s+\S*$/, "")).trim();
}

/**
 * Turn model output into what clients render. Scripture is never taken from the
 * model: the reference is resolved against the bundled KJV and the text comes
 * from there, or the verse is dropped. A suggested chapter must exist.
 */
export async function sanitizeReflection(
	raw: RawReflection,
	resolve: ReflectionResolvers,
): Promise<ReadingReflectionContent | null> {
	const reflection = clip(resolve.clean(raw.reflection ?? ""), REFLECTION_MAX_TEXT);
	if (!reflection) return null;
	const title = clip(resolve.clean(raw.title ?? ""), REFLECTION_MAX_TITLE) || "Your walk";

	let verse: ReadingReflectionContent["verse"] = null;
	if (raw.verse) {
		const book = resolve.bookNumber(raw.verse.book);
		const text = book ? await resolve.verseText(book, raw.verse.chapter, raw.verse.verse) : undefined;
		const meta = book ? resolve.bookMeta(book) : null;
		if (book && text && meta) {
			const note = raw.verseNote ? clip(resolve.clean(raw.verseNote), REFLECTION_MAX_NOTE) : "";
			verse = { book, bookName: meta.name, chapter: raw.verse.chapter, verse: raw.verse.verse, text, note: note || null };
		}
	}

	let next: ReadingReflectionContent["next"] = null;
	if (raw.next) {
		const book = resolve.bookNumber(raw.next.book);
		const meta = book ? resolve.bookMeta(book) : null;
		const reason = clip(resolve.clean(raw.next.reason ?? ""), REFLECTION_MAX_NOTE);
		if (book && meta && Number.isInteger(raw.next.chapter) && raw.next.chapter >= 1 && raw.next.chapter <= meta.chapters && reason)
			next = { book, bookName: meta.name, chapter: raw.next.chapter, reason };
	}

	return { title, reflection, verse, next };
}

/** The chapter after the newest reading, or that chapter again when it was only part-read. */
export function naturalNextChapter(
	latest: { book: number; chapter: number; completed: boolean } | null,
	books: readonly BookMeta[],
): { book: number; chapter: number } | null {
	if (!latest) return null;
	if (!latest.completed) return { book: latest.book, chapter: latest.chapter };
	const meta = books.find((book) => book.order === latest.book);
	if (!meta) return null;
	if (latest.chapter < meta.chapters) return { book: latest.book, chapter: latest.chapter + 1 };
	const following = books.find((book) => book.order === latest.book + 1);
	return following ? { book: following.order, chapter: 1 } : null;
}
