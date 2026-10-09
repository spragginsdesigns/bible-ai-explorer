import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { BOOKS, bookByOrder } from "@/lib/bible/books";
import { allowsMemoryUse } from "@/lib/memory-policy";
import { prisma } from "@/lib/prisma";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { localDayKey, shiftDayKey } from "@/lib/reading-history";
import { getReadingOverview } from "@/lib/reading-overview";
import {
	formatBookCoverage,
	formatRecentDays,
	hasAnyReading,
	naturalNextChapter,
	reflectionBasis,
	reflectionDecision,
	sanitizeReflection,
	storedReflectionAllowed,
	type ReadingReflectionContent,
} from "@/lib/reading-overview-rules";
import { loadStudyContext } from "@/lib/study-context";
import { getKjvBookNumber, getKjvVerseText } from "@/utils/kjvBible";
import { doctrinalFoundation, interpretationGuidance, trustedContextGuidance } from "@/utils/systemPrompt";

/**
 * "Your walk": a short, personal reflection at the top of the reading log,
 * written from what the person actually read plus the same study context the
 * daily cross reads (questions, notes, memories, plan, church). Free for every
 * account. One model call per change in their reading, cached in
 * ReadingReflection, so opening the log is a single row read.
 */

const RECENT_DAYS = 14;
const RECENT_ENTRY_LIMIT = 120;

const reflectionSchema = z.object({
	title: z.string().describe("Three to six words naming the season of their reading, e.g. 'A week in James'."),
	reflection: z
		.string()
		.describe("Two to four sentences, second person, under 600 characters."),
	verse: z
		.object({ book: z.string(), chapter: z.number().int(), verse: z.number().int() })
		.nullable()
		.describe("One KJV verse from a chapter they actually read recently, to carry with them; null if none fits."),
	verseNote: z
		.string()
		.nullable()
		.describe("One sentence on why this verse fits them now, tied to their questions, notes or reading. Never restate the verse. Null if nothing specific."),
	next: z
		.object({ book: z.string(), chapter: z.number().int(), reason: z.string() })
		.nullable()
		.describe("The single chapter to read next and a one-sentence reason, or null."),
});

const INSTRUCTIONS = `${doctrinalFoundation}

${interpretationGuidance}

${trustedContextGuidance}

You write "Your walk", a short reflection at the top of one person's Bible reading log in SureWord. It helps them see what God has been putting in front of them in His Word and where to go next.

Rules:
- Ground every claim in the supplied facts. Say what they read, when, and how it connects to what they have asked, noted, prayed about or told SureWord. Never invent reading, feelings, struggles, victories or spiritual progress. Opening a chapter is activity, not proof of understanding.
- Meet them where they are. The questions, memories and notes show whether they are exploring, doubting, newly saved or a mature believer. Speak to that person honestly and warmly, as a born-again believer who holds the KJV as the inerrant Word of God, without labeling them or assuming they are saved.
- Point to Christ and the Scripture itself, not to their performance. Do not flatter, guilt or gamify. Streaks and counts may be mentioned once, plainly, if they help.
- Write in plain words. No headings, lists, emoji, or em/en dashes. Two to four sentences.
- The verse must come from a chapter they read recently and must be quoted by reference only; the app inserts the exact KJV text.
- The next chapter should usually continue where they left off (the natural next chapter is supplied). Choose something else only when their questions, prayer requests or plan clearly call for it, and say why in one sentence.
- If they follow a reading plan, the next chapter is today's plan reading unless it is already done.
- Keep private details discreet: refer to a prayer request or memory gently, never quote it at length.`;

export type ReadingReflectionResult =
	| { status: "ready"; reflection: ReadingReflectionContent; generatedAt: string }
	| { status: "empty" }
	| { status: "consent-required" }
	| { status: "unavailable" };

function parseStored(content: string): ReadingReflectionContent | null {
	try {
		const parsed = JSON.parse(content) as ReadingReflectionContent;
		return typeof parsed?.reflection === "string" && parsed.reflection ? parsed : null;
	} catch {
		return null;
	}
}

async function buildPrompt(userId: string, timezone: string, now: Date): Promise<string> {
	const today = localDayKey(now, timezone);
	const [overview, recent, latest, study] = await Promise.all([
		getReadingOverview(userId, timezone, now),
		prisma.readingLogEntry.findMany({
			where: { userId, deletedAt: null, localDate: { gte: shiftDayKey(today, -(RECENT_DAYS - 1)) } },
			orderBy: [{ localDate: "desc" }, { occurredAt: "desc" }],
			take: RECENT_ENTRY_LIMIT,
			select: { book: true, chapter: true, completed: true, localDate: true, source: true },
		}),
		prisma.readingLogEntry.findFirst({
			where: { userId, deletedAt: null },
			orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }],
			select: { book: true, chapter: true, completed: true },
		}),
		loadStudyContext(userId),
	]);
	const next = naturalNextChapter(latest, BOOKS);
	const nextName = next ? `${bookByOrder(next.book)?.name} ${next.chapter}` : "(none)";
	const { totals, streak } = overview;
	return [
		`Today is ${today} in their timezone.`,
		`Lifetime: ${totals.chaptersComplete} of ${totals.totalChapters} chapters read in full at least once, across ${totals.booksStarted} books; ${totals.activeDays} days with reading. Current streak: ${streak.current} day(s)${streak.atRisk ? " (not yet extended today)" : ""}; longest ${streak.longest}.`,
		`Reading in the last ${RECENT_DAYS} days, newest first ("part" means only some verses):\n${formatRecentDays(
			recent.map((row) => ({ ...row, bookName: bookByOrder(row.book)?.name ?? String(row.book) })),
		)}`,
		`Where they left off: ${latest ? `${bookByOrder(latest.book)?.name} ${latest.chapter}${latest.completed ? "" : " (part)"}` : "(none)"}. Natural next chapter: ${nextName}.`,
		`Books they have read in:\n${formatBookCoverage(overview.books, BOOKS)}`,
		`Their reading plan today:\n${study.planBlock}`,
		`Questions they have asked SureWord recently:\n${study.questionsBlock}`,
		`Their notes:\n${study.notesBlock}`,
		`What SureWord remembers about them (respecting their memory setting):\n${study.memoriesBlock}`,
		`Their home church:\n${study.churchBlock}`,
	].join("\n\n");
}

async function generate(userId: string, timezone: string, now: Date): Promise<ReadingReflectionContent | null> {
	const { model, providerOptions } = await resolveModel({ userId, utility: true });
	const { output } = await generateText({
		model,
		providerOptions,
		output: Output.object({ schema: reflectionSchema }),
		instructions: INSTRUCTIONS,
		prompt: await buildPrompt(userId, timezone, now),
	});
	if (!output) return null;
	return sanitizeReflection(output, {
		bookNumber: getKjvBookNumber,
		bookMeta: bookByOrder,
		verseText: getKjvVerseText,
		clean: stripDashes,
	});
}

/**
 * The stored reflection when it still describes their reading, otherwise a
 * fresh one. Nothing personal reaches a model without current AI consent, and an
 * account with no reading gets `empty` rather than a reflection about nothing.
 */
export async function getReadingReflection(
	userId: string,
	timezone: string,
	now: Date = new Date(),
): Promise<ReadingReflectionResult> {
	const [user, totals, stored] = await Promise.all([
		prisma.user.findUnique({
			where: { id: userId },
			select: { aiConsentVersion: true, aiConsentAt: true, memoryEnabled: true },
		}),
		prisma.readingLogTotals.findUnique({
			where: { userId },
			select: { chapterReadings: true, partialReadings: true, sessions: true, lastReadAt: true },
		}),
		prisma.readingReflection.findUnique({ where: { userId } }),
	]);
	if (!hasAnyReading(totals)) return { status: "empty" };
	const memoryAllowed = allowsMemoryUse(user?.memoryEnabled);
	const basis = reflectionBasis(totals, memoryAllowed);
	const cached =
		stored && storedReflectionAllowed(stored.basis, memoryAllowed) ? parseStored(stored.content) : null;
	if (cached && stored && reflectionDecision(stored, basis, now) === "reuse")
		return { status: "ready", reflection: cached, generatedAt: stored.createdAt.toISOString() };
	if (!hasCurrentAiConsent(user))
		return cached && stored
			? { status: "ready", reflection: cached, generatedAt: stored.createdAt.toISOString() }
			: { status: "consent-required" };

	try {
		const reflection = await generate(userId, timezone, now);
		if (!reflection) throw new Error("The model returned no usable reflection.");
		const row = await prisma.readingReflection.upsert({
			where: { userId },
			create: { userId, basis, content: JSON.stringify(reflection), createdAt: now },
			update: { basis, content: JSON.stringify(reflection), createdAt: now },
		});
		return { status: "ready", reflection, generatedAt: row.createdAt.toISOString() };
	} catch (error) {
		console.error(`[reading-reflection] Generation failed for user ${userId}:`, error);
		// An older reflection beats an empty card; it says when it was written.
		if (cached && stored) return { status: "ready", reflection: cached, generatedAt: stored.createdAt.toISOString() };
		return { status: "unavailable" };
	}
}
