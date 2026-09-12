/**
 * What a user has read in the Bible reader, folded from their `ReadingEvent`
 * rows into the shape GET /api/reading-events returns (Continue reading, My
 * Walk, the day block).
 *
 * The aggregation is pure so tests/reading-history.test.mjs can drive day
 * boundaries directly; only `loadReadingHistory` touches the database, through
 * a dynamic import, which keeps this file loadable by a plain
 * `node --experimental-strip-types` test.
 *
 * Days are the user's calendar days, not 24-hour buckets: "3 days in a row" has
 * to mean what it means on their wall clock. The timezone comes from their
 * newest push token, the only place the server learns one.
 */

export const DEFAULT_READING_TIMEZONE = "America/Los_Angeles";
export const MAX_TOP_BOOKS = 5;
export const MAX_RECENT_READS = 20;
/**
 * Bounds the query. Reading older than this only matters to topBooks, and to
 * lastRead or a streak for someone who has not opened the reader in over a year.
 */
export const READING_HISTORY_WINDOW_DAYS = 400;
export const READING_HISTORY_MAX_EVENTS = 5000;

export interface ReadingEventInput {
	book: string;
	chapter: number;
	translation: string;
	readAt: Date | string;
}

export interface ReadingHistory {
	lastRead: { book: string; chapter: number; translation: string; readAt: string } | null;
	/** Completed chapter readings in the last 7 local days, including reread sessions. */
	chaptersLast7Days: number;
	chaptersLast30Days: number;
	/** Local days in the last 30 (today included) with at least one chapter read. */
	activeDaysLast30: number;
	/** Consecutive local days with reading, ending today; an unread today does not break it yet. */
	currentStreakDays: number;
	/** Books by distinct completed chapters across lifetime history, most first. */
	topBooks: { book: string; chapters: number }[];
	/** Newest reads first. */
	recent: { book: string; chapter: number; readAt: string }[];
}

/** A timezone Intl accepts, or the default when it is missing or unknown. */
export function resolveReadingTimezone(timezone: string | null | undefined): string {
	if (!timezone) return DEFAULT_READING_TIMEZONE;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return timezone;
	} catch {
		return DEFAULT_READING_TIMEZONE;
	}
}

/** "YYYY-MM-DD" of an instant on the calendar of `timeZone`. */
export function localDayKey(instant: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The day key `offset` calendar days from `dayKey`. Done on the date itself in
 * UTC, so a DST change in the user's zone cannot skip or repeat a day.
 */
export function shiftDayKey(dayKey: string, offset: number): string {
	const [year, month, day] = dayKey.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

/**
 * Consecutive days in `activeDays` counting back from `today`. Today not being
 * active yet does not break the run, because the day is not over; the same
 * rule computePlanProgress applies to plan days.
 */
export function countDayStreak(activeDays: ReadonlySet<string>, today: string): number {
	let day = activeDays.has(today) ? today : shiftDayKey(today, -1);
	let streak = 0;
	while (activeDays.has(day)) {
		streak += 1;
		day = shiftDayKey(day, -1);
	}
	return streak;
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

/** Fold reading events into the endpoint's summary. Events may arrive in any order. */
export function summarizeReadingHistory(
	events: readonly ReadingEventInput[],
	options: { now: Date; timeZone?: string | null }
): ReadingHistory {
	const timeZone = resolveReadingTimezone(options.timeZone);
	const today = localDayKey(options.now, timeZone);
	const since7 = shiftDayKey(today, -6);
	const since30 = shiftDayKey(today, -29);

	const sorted = events
		.map((event) => ({ ...event, at: toDate(event.readAt) }))
		.filter((event) => !Number.isNaN(event.at.getTime()))
		.sort((a, b) => b.at.getTime() - a.at.getTime());

	const activeDays = new Set<string>();
	// Re-opening a chapter later the same day is one chapter read, not two.
	const chapterDays7 = new Set<string>();
	const chapterDays30 = new Set<string>();
	const activeDays30 = new Set<string>();
	const chaptersByBook = new Map<string, { chapters: Set<number>; newest: number }>();

	for (const event of sorted) {
		const day = localDayKey(event.at, timeZone);
		activeDays.add(day);
		const chapterDay = `${day}|${event.book}|${event.chapter}`;
		if (day >= since30 && day <= today) {
			chapterDays30.add(chapterDay);
			activeDays30.add(day);
			if (day >= since7) chapterDays7.add(chapterDay);
		}
		const entry = chaptersByBook.get(event.book);
		if (entry) {
			entry.chapters.add(event.chapter);
		} else {
			chaptersByBook.set(event.book, { chapters: new Set([event.chapter]), newest: event.at.getTime() });
		}
	}

	const newest = sorted[0];
	return {
		lastRead: newest
			? {
					book: newest.book,
					chapter: newest.chapter,
					translation: newest.translation,
					readAt: newest.at.toISOString(),
				}
			: null,
		chaptersLast7Days: chapterDays7.size,
		chaptersLast30Days: chapterDays30.size,
		activeDaysLast30: activeDays30.size,
		currentStreakDays: countDayStreak(activeDays, today),
		topBooks: [...chaptersByBook.entries()]
			// Ties go to the book read most recently: it is the one they are in.
			.sort(([, a], [, b]) => b.chapters.size - a.chapters.size || b.newest - a.newest)
			.slice(0, MAX_TOP_BOOKS)
			.map(([book, entry]) => ({ book, chapters: entry.chapters.size })),
		recent: sorted.slice(0, MAX_RECENT_READS).map((event) => ({
			book: event.book,
			chapter: event.chapter,
			readAt: event.at.toISOString(),
		})),
	};
}

/** Lifetime summaries use bounded aggregates, not a rolling event scan. */
export async function loadReadingHistory(userId: string, now: Date = new Date()): Promise<ReadingHistory> {
  const { prisma } = await import("@/lib/prisma");
  const { bookByOrder } = await import("@/lib/bible/books");
  const { recentReadingChapters } = await import("@/lib/reading-log");
  const device = await prisma.pushToken.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { timezone: true } });
  const today = localDayKey(now, resolveReadingTimezone(device?.timezone));
  const since30 = shiftDayKey(today, -29);
  const [totals, days, chapters, latest, recent, streak] = await Promise.all([
    prisma.readingLogTotals.findUnique({ where: { userId } }),
    prisma.readingLogDay.findMany({ where: { userId, localDate: { gte: since30, lte: today }, entries: { gt: 0 } }, take: 30 }),
    prisma.readingLogChapter.findMany({ where: { userId, chapterReadings: { gt: 0 } }, take: 1189 }),
    prisma.readingLogEntry.findFirst({ where: { userId, deletedAt: null }, orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }] }),
    recentReadingChapters(userId, new Date(0), MAX_RECENT_READS),
    prisma.readingLogStreak.findFirst({ where: { userId, endDate: { gte: shiftDayKey(today, -1) }, startDate: { lte: today } }, orderBy: { endDate: "desc" } }),
  ]);
  if (!totals?.legacyBackfilled) {
    // Temporary rollout compatibility only. Completion of resumable backfill
    // removes this bounded legacy read and makes all lifetime totals complete.
    const legacy = await prisma.readingEvent.findMany({ where: { userId, readAt: { gte: new Date(now.getTime() - READING_HISTORY_WINDOW_DAYS * 86400_000) } }, orderBy: { readAt: "desc" }, take: READING_HISTORY_MAX_EVENTS });
    const fallback = summarizeReadingHistory(legacy, { now, timeZone: device?.timezone });
    return { ...fallback, lastRead: latest && (!fallback.lastRead || latest.occurredAt > new Date(fallback.lastRead.readAt)) ? {
      book: bookByOrder(latest.book)!.name, chapter: latest.chapter, translation: latest.translation,
      readAt: ["exact", "legacy"].includes(latest.precision) ? latest.occurredAt.toISOString() : latest.localDate,
    } : fallback.lastRead, recent: recent.map((entry) => ({ book: entry.book, chapter: entry.chapter, readAt: ["exact", "legacy"].includes(entry.precision) ? entry.readAt.toISOString() : entry.localDate })) };
  }
  const books = new Map<string, { chapters: number; newest: number }>();
  for (const chapter of chapters) {
    const name = bookByOrder(chapter.book)!.name;
    const previous = books.get(name) ?? { chapters: 0, newest: 0 };
    books.set(name, { chapters: previous.chapters + 1, newest: Math.max(previous.newest, chapter.lastReadAt?.getTime() ?? 0) });
  }
  return {
    lastRead: latest ? { book: bookByOrder(latest.book)!.name, chapter: latest.chapter, translation: latest.translation,
      readAt: ["exact", "legacy"].includes(latest.precision) ? latest.occurredAt.toISOString() : latest.localDate } : null,
    chaptersLast7Days: days.filter((day) => day.localDate >= shiftDayKey(today, -6)).reduce((sum, day) => sum + day.chapterReadings, 0),
    chaptersLast30Days: days.reduce((sum, day) => sum + day.chapterReadings, 0), activeDaysLast30: days.length,
    currentStreakDays: streak ? Math.round((new Date(streak.endDate > today ? today : streak.endDate).getTime() - new Date(streak.startDate).getTime()) / 86400_000) + 1 : 0,
    topBooks: [...books.entries()].sort(([, a], [, b]) => b.chapters - a.chapters || b.newest - a.newest).slice(0, MAX_TOP_BOOKS).map(([book, data]) => ({ book, chapters: data.chapters })),
    recent: recent.map((entry) => ({ book: entry.book, chapter: entry.chapter, readAt: ["exact", "legacy"].includes(entry.precision) ? entry.readAt.toISOString() : entry.localDate })),
  };
}
