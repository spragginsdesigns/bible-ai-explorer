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
 * network call. Unavailable NKJV text is never replaced with another translation.
 */
import { createHash } from "node:crypto";
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
	textUnavailable?: boolean;
	revision: number;
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
	revision: true,
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
	revision: number;
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

/** Resolve only the requested translation. Missing text must never be mislabeled. */
export async function learnVerseText(
 translation: TranslationId, book: number, chapter: number, verse: number,
): Promise<string | undefined> {
 try {
  const chapterText = translation === "KJV"
   ? await getKjvChapter(book, chapter)
   : await getChapter(translation, book, chapter);
  const text = chapterText[verse - 1];
  if (!text || translation === "KJV") return text || undefined;
  // Provider markup is presentation, not part of the words being memorized.
  const plainText = text.replace(/<[^>]*>/g, "")
   .replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, name: string) => {
    const key = name.toLowerCase();
    if (key.startsWith("#")) {
     const point = key.startsWith("#x") ? parseInt(key.slice(2), 16) : Number(key.slice(1));
     return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return ({ amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' } as Record<string, string>)[key] ?? entity;
   }).replace(/\s+/g, " ").trim();
  return plainText || undefined;
 } catch { return undefined; }
}

async function toCard(row: CardRow): Promise<LearnCard> {
	const translation = toTranslation(row.translation);
	const text = await learnVerseText(translation, row.book, row.chapter, row.verse);
	return {
		id: row.id,
		revision: row.revision,
		book: row.book,
		chapter: row.chapter,
		verse: row.verse,
		translation,
		reference: formatLearnReference(row.book, row.chapter, row.verse),
		text: text ?? "",
		...(text ? {} : { textUnavailable: true }),
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

	const [rows, queueCount, knownCount] = await prisma.$transaction([
		prisma.verseMemory.findMany({
			where: dueFilter,
			orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }, { id: "asc" }],
			take: LEARN_DAILY_LIMIT,
			select: cardSelect,
		}),
		prisma.verseMemory.count({ where: dueFilter }),
		prisma.verseMemory.count({ where: { userId, knownAt: { not: null } } }),
	], { isolationLevel: "RepeatableRead" });

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

 const dueAt = startOfToday(now, await learnTimezone(userId));
 const outcome = await retryLearnTransaction(() => prisma.$transaction(async (tx) => {
  const existing = await tx.verseMemory.findUnique({
   where: { userId_book_chapter_verse: { userId, book, chapter, verse } }, select: cardSelect,
  });
  if (existing) {
   if (toTranslation(existing.translation) === translation) return { row: existing, created: false };
   const changed = await tx.verseMemory.updateMany({
    where: { id: existing.id, userId, revision: existing.revision },
    data: { translation, revision: { increment: 1 } },
   });
   if (!changed.count) throw new LearnRetry();
   const row = await tx.verseMemory.findFirstOrThrow({ where: { id: existing.id, userId }, select: cardSelect });
   return { row, created: false };
  }
  const row = await tx.verseMemory.create({ data: { userId, book, chapter, verse, translation, source, dueAt }, select: cardSelect });
  return { row, created: true };
 }));
 return { card: await toCard(outcome.row), created: outcome.created };
}

export interface LearnReviewOperation {
 result: LearnResult;
 operationId: string;
 expectedRevision: number;
 reviewedAt: string;
 timezone: string;
}

export interface LearnReviewAcknowledgement {
 operationId: string;
 appliedRevision: number;
 replayed: boolean;
 currentCard: LearnCard | null;
}

export class LearnReviewConflict extends Error {
 code: "operation_id_reused" | "revision_conflict";
 currentCard: LearnCard | null;
 constructor(code: "operation_id_reused" | "revision_conflict", currentCard: LearnCard | null) {
  super(code);
  this.code = code;
  this.currentCard = currentCard;
 }
}

class LearnRetry extends Error {}

/** Retry the entire aborted transaction, never a query inside an aborted transaction. */
async function retryLearnTransaction<T>(run: () => Promise<T>): Promise<T> {
 for (let attempt = 0; ; attempt++) {
  try { return await run(); } catch (error) {
   const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
   if (attempt >= 4 || (!(error instanceof LearnRetry) && code !== "P2034" && code !== "P2002")) throw error;
  }
 }
}

/** Legacy reviews remain bare-card responses but participate in revision concurrency. */
export async function reviewCardById(
 userId: string, id: string, result: LearnResult, now: Date = new Date(),
): Promise<LearnCard | null> {
 const timezone = await learnTimezone(userId);
 const row = await retryLearnTransaction(() => prisma.$transaction(async (tx) => {
  const existing = await tx.verseMemory.findFirst({ where: { id, userId }, select: cardSelect });
  if (!existing) return null;
  const next = reviewCard(existing, result, now, timezone);
  const changed = await tx.verseMemory.updateMany({
   where: { id, userId, revision: existing.revision }, data: { ...next, revision: { increment: 1 } },
  });
  if (!changed.count) throw new LearnRetry();
  return tx.verseMemory.findFirstOrThrow({ where: { id, userId }, select: cardSelect });
 }));
 return row ? toCard(row) : null;
}

/**
 * A receipt and its schedule change commit together. Receipts outlive card deletion.
 * reviewedAt accepts Unix epoch onward without an aging cutoff: delayed reviews retain their local day.
 * Validation of the public request happens in the route before this function runs.
 */
export async function reviewCardOperation(
 userId: string, id: string, operation: LearnReviewOperation,
): Promise<LearnReviewAcknowledgement | null> {
 const payloadHash = createHash("sha256").update(JSON.stringify([
  id, operation.result, operation.expectedRevision, new Date(operation.reviewedAt).toISOString(), operation.timezone,
 ])).digest("hex");
 const outcome = await retryLearnTransaction(() => prisma.$transaction(async (tx) => {
  const receipt = await tx.learnReviewReceipt.findUnique({
   where: { userId_operationId: { userId, operationId: operation.operationId } },
  });
  if (receipt) {
   if (receipt.payloadHash !== payloadHash) return { kind: "operation_id_reused" as const, row: null };
   const row = await tx.verseMemory.findFirst({ where: { id, userId }, select: cardSelect });
   return { kind: "applied" as const, row, appliedRevision: receipt.appliedRevision, replayed: true };
  }
  const existing = await tx.verseMemory.findFirst({ where: { id, userId }, select: cardSelect });
  if (!existing || existing.revision !== operation.expectedRevision) {
   // Under ReadCommitted a matching operation can commit between the first
   // receipt lookup and the card read. Check again before declaring conflict.
   const committedReceipt = await tx.learnReviewReceipt.findUnique({
    where: { userId_operationId: { userId, operationId: operation.operationId } },
   });
   if (committedReceipt) {
    if (committedReceipt.payloadHash !== payloadHash) return { kind: "operation_id_reused" as const, row: null };
    const row = await tx.verseMemory.findFirst({ where: { id, userId }, select: cardSelect });
    return { kind: "applied" as const, row, appliedRevision: committedReceipt.appliedRevision, replayed: true };
   }
   if (!existing) return null;
   return { kind: "revision_conflict" as const, row: existing };
  }
  const next = reviewCard(existing, operation.result, new Date(operation.reviewedAt), operation.timezone);
  const changed = await tx.verseMemory.updateMany({
   where: { id, userId, revision: operation.expectedRevision }, data: { ...next, revision: { increment: 1 } },
  });
  // Re-enter receipt lookup after a concurrent winner, including an identical request.
  if (!changed.count) throw new LearnRetry();
  const row = await tx.verseMemory.findFirstOrThrow({ where: { id, userId }, select: cardSelect });
  await tx.learnReviewReceipt.create({ data: {
   userId, operationId: operation.operationId, cardId: id, payloadHash, appliedRevision: row.revision,
  } });
  return { kind: "applied" as const, row, appliedRevision: row.revision, replayed: false };
 }));
 if (!outcome) return null;
 // Text can require network IO. Resolve it only after releasing transaction locks.
 const currentCard = outcome.row ? await toCard(outcome.row) : null;
 if (outcome.kind !== "applied") throw new LearnReviewConflict(outcome.kind, currentCard);
 return { operationId: operation.operationId, appliedRevision: outcome.appliedRevision, replayed: outcome.replayed, currentCard };
}

/** Drop a card. Returns false when it is not this user's. */
export async function removeCard(userId: string, id: string): Promise<boolean> {
	const { count } = await prisma.verseMemory.deleteMany({ where: { id, userId } });
	return count > 0;
}
