import "server-only";

import { prisma } from "@/lib/prisma";
import { localDayKey, resolveReadingTimezone } from "@/lib/reading-history";
import {
	TOTAL_BIBLE_CHAPTERS,
	foldBookCoverage,
	streakFromIntervals,
	type BookCoverage,
	type ReadingStreak,
} from "@/lib/reading-overview-rules";

/**
 * The reading log's header: plain lifetime totals, the streak, and which
 * chapters of each book have been read (the Bible map). Every number is a
 * bounded read of the summary tables `sureword_write_readings` maintains, never
 * a scan of the event journal. Served by GET /api/reading-log/overview.
 */
export interface ReadingOverview {
	totals: {
		/** Distinct chapters read whole in one sitting at least once. */
		chaptersComplete: number;
		totalChapters: number;
		/** Books with any reading at all. */
		booksStarted: number;
		chapterReadings: number;
		activeDays: number;
		lastReadAt: string | null;
	};
	streak: ReadingStreak;
	books: BookCoverage[];
	historicalBackfillPending: boolean;
}

/**
 * The person's calendar day decides whether a streak is alive. Clients send
 * their IANA zone; older callers fall back to the newest push token's zone.
 */
export async function resolveTimezoneFor(userId: string, requested: string | null): Promise<string> {
	if (requested) return resolveReadingTimezone(requested);
	const device = await prisma.pushToken.findFirst({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		select: { timezone: true },
	});
	return resolveReadingTimezone(device?.timezone);
}

export async function getReadingOverview(
	userId: string,
	timezone: string,
	now: Date = new Date(),
): Promise<ReadingOverview> {
	const [totals, chapters, intervals, legacy] = await Promise.all([
		prisma.readingLogTotals.findUnique({ where: { userId } }),
		prisma.readingLogChapter.findMany({
			where: { userId, entries: { gt: 0 } },
			select: { book: true, chapter: true, entries: true, chapterReadings: true },
			take: TOTAL_BIBLE_CHAPTERS,
		}),
		prisma.readingLogStreak.findMany({
			where: { userId },
			select: { startDate: true, endDate: true },
		}),
		prisma.readingEvent.findFirst({ where: { userId }, select: { id: true } }),
	]);
	const books = foldBookCoverage(chapters);
	return {
		totals: {
			chaptersComplete: totals?.uniqueChapters ?? 0,
			totalChapters: TOTAL_BIBLE_CHAPTERS,
			booksStarted: books.length,
			chapterReadings: totals?.chapterReadings ?? 0,
			activeDays: totals?.activeDays ?? 0,
			lastReadAt: totals?.lastReadAt?.toISOString() ?? null,
		},
		streak: streakFromIntervals(intervals, localDayKey(now, timezone)),
		books,
		historicalBackfillPending: totals ? !totals.legacyBackfilled : Boolean(legacy),
	};
}
