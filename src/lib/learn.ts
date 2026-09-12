/**
 * Learn a verse: the queue and the schedule behind /api/learn/*.
 *
 * One row per verse per user (`VerseMemory`), one card per screen, and the only
 * number the product counts is how many verses the user knows. The ladder
 * itself lives in learn-schedule.ts and is pure; everything here is the
 * database half plus resolving the verse text.
 *
 * Text is resolved server-side so web and Apple can render a card without
 * carrying a Bible, but Android may prefer its bundled copy. KJV comes out of
 * the bundled corpus the reader already uses, so the common case costs no
 * network call; an NKJV card falls back to the bundled KJV text rather than
 * failing if the upstream chapter cannot be fetched.
 */
import { prisma } from "@/lib/prisma";
import { bookByOrder } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { getChapter, type TranslationId } from "@/lib/bible/translations";
import {
	LEARN_DAILY_LIMIT,
	reviewCard,
	startOfToday,
	startOfTomorrow,
	toLearnStage,
	type LearnResult,
	type LearnStage,
} from "@/lib/learn-schedule";

/** Where the card was added from, for later product questions only. */
export type LearnSource = "sheet" | "highlight" | "chat";

export interface LearnCard {
	id: string;
	book: number;
	chapter: number;
	verse: number;
	translation: TranslationId;
	/** "John 3:16". */
	reference: string;
	text: string;
	stage: LearnStage;
	intervalDays: number;
	/** ISO instant: midnight of the day the card comes back, in the user's zone. */
	dueAt: string;
	knownAt: string | null;
}

export interface LearnToday {
	/** The session: at most LEARN_DAILY_LIMIT, due first, then newest unstarted. */
	cards: LearnCard[];
	/** Verses the user knows, the only score the product keeps. */
	knownCount: number;
	/** How many cards are waiting today in total; `cards` is the head of it. */
	queueCount: number;
}

export interface LearnVerseKey {
	/** Canonical book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
	translation: TranslationId;
	source: LearnSource;
}

/** The columns a card needs, so every query selects the same set. */
const cardSelect = {
	id: true,
	book: true,
	chapter: true,
	verse: true,
	translation: true,
	stage: true,
	intervalDays: true,
	dueAt: true,
	knownAt: true,
} as const;

interface CardRow {
	id: string;
	book: number;
	chapter: number;
	verse: number;
	translation: string;
	stage: number;
	intervalDays: number;
	dueAt: Date;
	knownAt: Date | null;
}

function toTranslation(value: string): TranslationId {
	return value === "NKJV" ? "NKJV" : "KJV";
}

/** "John 3:16", or "43 3:16" for a book order the metadata does not know. */
export function formatLearnReference(book: number, chapter: number, verse: number): string {
	return `${bookByOrder(book)?.name ?? String(book)} ${chapter}:${verse}`;
}

/**
 * The verse text for a card. KJV is bundled; NKJV is fetched by the same loader
 * the reader uses and falls back to the bundled KJV when that fetch fails, so a
 * card always has something to show.
 */
export async function learnVerseText(
	translation: TranslationId,
	book: number,
	chapter: number,
	verse: number,
): Promise<string | undefined> {
	if (translation !== "KJV") {
		try {
			const verses = await getChapter(translation, book, chapter);
			const text = verses[verse - 1];
			if (text) return text;
		} catch {
			// Fall through to the bundled text below.
		}
	}
	try {
		return (await getKjvChapter(book, chapter))[verse - 1];
	} catch {
		return undefined;
	}
}

async function toCard(row: CardRow): Promise<LearnCard> {
	const translation = toTranslation(row.translation);
	return {
		id: row.id,
		book: row.book,
		chapter: row.chapter,
		verse: row.verse,
		translation,
		reference: formatLearnReference(row.book, row.chapter, row.verse),
		text: (await learnVerseText(translation, row.book, row.chapter, row.verse)) ?? "",
		stage: toLearnStage(row.stage),
		intervalDays: row.intervalDays,
		dueAt: row.dueAt.toISOString(),
		knownAt: row.knownAt ? row.knownAt.toISOString() : null,
	};
}

/**
 * The user's timezone, learned from their newest push token: the only place the
 * server is ever told one. Same source as the reading history, so a streak and
 * a due date roll over on the same midnight.
 */
export async function learnTimezone(userId: string): Promise<string | null> {
	const device = await prisma.pushToken.findFirst({
		where: { userId },
		orderBy: { updatedAt: "desc" },
		select: { timezone: true },
	});
	return device?.timezone ?? null;
}

/**
 * Today's session.
 *
 * A card is in today's queue when its due date has arrived, which covers both
 * the ones scheduled for today and anything overdue; a brand new card is
 * created due today, so unstarted cards are in the queue too. Within that,
 * oldest due date first and newest card next, so a verse just added is the one
 * offered once the backlog is clear.
 */
export async function todayCards(userId: string, now: Date = new Date()): Promise<LearnToday> {
	const timezone = await learnTimezone(userId);
	const dueBefore = startOfTomorrow(now, timezone);
	const dueFilter = { userId, dueAt: { lt: dueBefore } };

	const [rows, queueCount, knownCount] = await Promise.all([
		prisma.verseMemory.findMany({
			where: dueFilter,
			orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
			take: LEARN_DAILY_LIMIT,
			select: cardSelect,
		}),
		prisma.verseMemory.count({ where: dueFilter }),
		prisma.verseMemory.count({ where: { userId, knownAt: { not: null } } }),
	]);

	return {
		cards: await Promise.all(rows.map((row) => toCard(row))),
		knownCount,
		queueCount,
	};
}

/**
 * Add a verse to the queue, or hand back the card it already has.
 *
 * One card per verse regardless of translation, so adding John 3:16 again from
 * an NKJV chapter switches the card's translation instead of making a second
 * one; the schedule the user has already built on that verse is untouched.
 */
export async function addCard(
	userId: string,
	key: LearnVerseKey,
	now: Date = new Date(),
): Promise<{ card: LearnCard; created: boolean }> {
	const { book, chapter, verse, translation, source } = key;

	const existing = await prisma.verseMemory.findUnique({
		where: { userId_book_chapter_verse: { userId, book, chapter, verse } },
		select: cardSelect,
	});
	if (existing) {
		const row =
			toTranslation(existing.translation) === translation
				? existing
				: await prisma.verseMemory.update({
						where: { id: existing.id },
						data: { translation },
						select: cardSelect,
					});
		return { card: await toCard(row), created: false };
	}

	const dueAt = startOfToday(now, await learnTimezone(userId));
	const row = await prisma.verseMemory.create({
		data: { userId, book, chapter, verse, translation, source, dueAt },
		select: cardSelect,
	});
	return { card: await toCard(row), created: true };
}

/**
 * Record one review. Returns null when the card is not this user's, which the
 * route answers as a 404 rather than leaking that the id exists.
 */
export async function reviewCardById(
	userId: string,
	id: string,
	result: LearnResult,
	now: Date = new Date(),
): Promise<LearnCard | null> {
	const existing = await prisma.verseMemory.findFirst({
		where: { id, userId },
		select: { id: true, stage: true, intervalDays: true, knownAt: true },
	});
	if (!existing) return null;

	const next = reviewCard(existing, result, now, await learnTimezone(userId));
	const row = await prisma.verseMemory.update({
		where: { id: existing.id },
		data: next,
		select: cardSelect,
	});
	return toCard(row);
}

/** Drop a card. Returns false when it is not this user's. */
export async function removeCard(userId: string, id: string): Promise<boolean> {
	const { count } = await prisma.verseMemory.deleteMany({ where: { id, userId } });
	return count > 0;
}
