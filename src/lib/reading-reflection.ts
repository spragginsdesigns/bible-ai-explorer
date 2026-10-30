import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { checkedStructuredProseModel } from "@/lib/ai/structured-prose-model";
import { beforeProseDeadline, remainingProseTime } from "@/lib/ai/structured-prose";
import { bindReflectionSources, certifyReflection, parseVerifiedReflection, verifyReflectionContent, type VerifiedReflectionSources, type VerifiedStoredReflection } from "@/lib/reading-reflection-verification";
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
	reflectionSourcesPresent,
	sanitizeReflection,
	storedReflectionAllowed,
	type ReadingReflectionContent,
} from "@/lib/reading-overview-rules";
import { loadStudyContext, memorySourceKey } from "@/lib/study-context";
import { noteSourceRevision, memorySourceRevision } from "@/lib/study-source-revisions";
import { getKjvBookNumber, getKjvVerseText } from "@/utils/kjvBible";
import { doctrinalFoundation, interpretationGuidance, trustedContextGuidance } from "@/utils/systemPrompt";

/**
 * "Your walk": a short, personal reflection at the top of the reading log,
 * written from what the person actually read plus the same study context the
 * daily cross reads (questions, notes, memories, plan, church). Free for every
 * account. One bounded draft/check job per change in their reading, cached in
 * ReadingReflection, so opening the log is a single row read.
 */

const RECENT_DAYS = 14;
const RECENT_ENTRY_LIMIT = 120;
/** Generation and checking share one absolute workflow, with persistence margin. */
export const REFLECTION_WORKFLOW_MS = 120_000;
const GENERATION_TIMEOUT_MS = 30_000;
const REFLECTION_MAX_SOURCE_CONTEXT = 64_000;
const REFLECTION_MAX_PROMPT_CHARS = 96_000;
/**
 * After a failed generation (provider outage, exhausted credits) the next
 * visits avoid another doomed call; only a certified reusable row can be served. Per
 * instance only; Fluid Compute reuses instances, so this covers most repeats.
 */
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const failures = new Map<string, number>();

function recentFailure(userId: string, now: Date): boolean {
	const at = failures.get(userId);
	if (at === undefined) return false;
	if (now.getTime() - at < FAILURE_BACKOFF_MS) return true;
	failures.delete(userId);
	return false;
}

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

type StoredReflection = VerifiedStoredReflection;

/**
 * Whether every memory and note the stored reflection was written from still
 * exists unchanged. A reflection that could repeat something the person deleted
 * or corrected is never served.
 */
async function sourcesIntact(userId: string, sources: VerifiedReflectionSources, memoryAllowed: boolean): Promise<boolean> {
	if (sources.memoryAllowed !== memoryAllowed) return false;
	if (!sources.memories.length && !sources.notes.length) return true;
	const memoryIds = sources.memories.map((key) => key.slice(0, key.lastIndexOf(":")));
	const [memories, notes] = await Promise.all([
		sources.memories.length
			? prisma.userMemory.findMany({ where: { userId, id: { in: memoryIds } }, select: { id: true, content: true, category: true } })
			: Promise.resolve([]),
		sources.notes.length
			? prisma.note.findMany({ where: { userId, id: { in: sources.notes } }, select: { id: true, title: true, plainText: true } })
			: Promise.resolve([]),
	]);
	return sources.revisions.notes.every(source => notes.some(note => note.id === source.id && noteSourceRevision(note) === source.revision)) &&
		sources.revisions.memories.every(source => memories.some(memory => memory.id === source.id && memorySourceRevision(memory) === source.revision)) && reflectionSourcesPresent(sources, {
		memories: new Set(memories.map((memory) => memorySourceKey(memory.id, memory.content))),
		notes: new Set(notes.map((note) => note.id)),
	});
}

async function buildPrompt(
	userId: string,
	timezone: string,
	now: Date,
	memoryAllowed: boolean,
): Promise<{ prompt: string; sources: VerifiedReflectionSources }> {
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
	const prompt = [
		`Today is ${today} in their timezone.`,
		`Lifetime: ${totals.chaptersComplete} of ${totals.totalChapters} chapters read in full at least once, across ${totals.booksStarted} books; ${totals.activeDays} days with reading. Current streak: ${streak.current} day(s)${streak.atRisk ? " (not yet extended today)" : ""}; longest ${streak.longest}.`,
		`Reading in the last ${RECENT_DAYS} days, newest first ("part" means only some verses):\n${formatRecentDays(
			recent.map((row) => ({ ...row, bookName: bookByOrder(row.book)?.name ?? String(row.book) })),
		)}`,
		`Where they left off: ${latest ? `${bookByOrder(latest.book)?.name} ${latest.chapter}${latest.completed ? "" : " (part)"}` : "(none)"}. Natural next chapter: ${nextName}.`,
		`Books they have read in:\n${formatBookCoverage(overview.books, BOOKS)}`,
		`Their reading plan today:\n${study.planBlock}`,
		`Verses they missed in a recent chapter quiz (worth returning to, never a failure):\n${study.quizBlock}`,
		`Questions they have asked SureWord recently:\n${study.questionsBlock}`,
		`Their notes:\n${study.notesBlock}`,
		`What SureWord remembers about them (respecting their memory setting):\n${study.memoriesBlock}`,
		`Their home church:\n${study.churchBlock}`,
	].join("\n\n");
	if (prompt.length > REFLECTION_MAX_SOURCE_CONTEXT - 1024 || INSTRUCTIONS.length + prompt.length > REFLECTION_MAX_PROMPT_CHARS) throw new Error("Complete reflection source exceeds its bound.");
	return { prompt, sources: bindReflectionSources(study.sources, study.sourceRevisions, memoryAllowed) };
}

async function generate(userId: string, timezone: string, now: Date, basis: string, deadlineAt: number, memoryAllowed: boolean): Promise<StoredReflection | null> {
	const generationDeadline = Math.min(Date.now() + GENERATION_TIMEOUT_MS, deadlineAt - 75_000 - 15_000);
	const phase = await beforeProseDeadline(generationDeadline, 0, async () => {
		const { prompt, sources } = await buildPrompt(userId, timezone, now, memoryAllowed);
		// Reflection stays a utility job. The same already-metered model
		// object carries draft, review and possible repair in one correlation.
		const job = checkedStructuredProseModel(await resolveModel({ userId, utility: true }), true);
		const { output } = await generateText({ model: job.model, providerOptions: job.providerOptions,
			output: Output.object({ schema: reflectionSchema }), instructions: INSTRUCTIONS, prompt,
			abortSignal: AbortSignal.timeout(remainingProseTime(generationDeadline, GENERATION_TIMEOUT_MS)), maxRetries: 0 });
		if (!output) return null;
		// Sanitize once before checking. Never clip or strip a checked field.
		const reflection = await sanitizeReflection(output, { bookNumber: getKjvBookNumber, bookMeta: bookByOrder, verseText: getKjvVerseText, clean: stripDashes });
		return reflection ? { reflection, sources, prompt, job } : null;
	});
	if (!phase) return null;
	const canonicalCoordinates = [phase.reflection.verse ? `${phase.reflection.verse.bookName} ${phase.reflection.verse.chapter}:${phase.reflection.verse.verse}` : "",
		phase.reflection.next ? `${phase.reflection.next.bookName} ${phase.reflection.next.chapter}` : ""].filter(Boolean).join("; ");
	const context = `Canonical source coordinates: ${canonicalCoordinates}\n\n${phase.prompt}`;
	if (context.length > REFLECTION_MAX_SOURCE_CONTEXT) throw new Error("Complete reflection review source exceeds its bound.");
	const reflection = await verifyReflectionContent(phase.reflection, {
		verification: { model: phase.job.model, providerOptions: phase.job.providerOptions, translation: "KJV",
			question: "Write a short Your walk reflection grounded in the supplied reading and study facts, with a suitable suggested chapter.",
			context, maxContextChars: REFLECTION_MAX_SOURCE_CONTEXT, requireCompleteContext: true, purpose: "Your walk card title, reflection, optional verse note and optional next-chapter reason; preserve all selected verse and chapter coordinates" },
		deadlineAt,
	});
	return certifyReflection(reflection, phase.sources, basis);
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
	const deadlineAt = Date.now() + REFLECTION_WORKFLOW_MS;
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
	let cached =
		stored && storedReflectionAllowed(stored.basis, memoryAllowed) ? parseVerifiedReflection(stored.content, stored.basis) : null;
	if (cached && !(await sourcesIntact(userId, cached.sources, memoryAllowed))) cached = null;
	if (stored && !cached) {
		// Retired (memory off, or a source deleted or edited): nothing private
		// stays behind, even when no new reflection can be written now.
		await prisma.readingReflection.deleteMany({ where: { userId, createdAt: stored.createdAt } });
	}
	const ready = (entry: StoredReflection, at: Date): ReadingReflectionResult => ({
		status: "ready",
		reflection: entry.reflection,
		generatedAt: at.toISOString(),
	});
	if (cached && stored && reflectionDecision(stored, basis, now) === "reuse") return ready(cached, stored.createdAt);
	if (!hasCurrentAiConsent(user))
		return { status: "consent-required" };
	if (recentFailure(userId, now)) return { status: "unavailable" };

	try {
		const fresh = await generate(userId, timezone, now, basis, deadlineAt, memoryAllowed);
		if (!fresh) throw new Error("The model returned no usable reflection.");
		// Generation/review can take up to 105 seconds. Recheck privacy/source
		// state at the write boundary rather than certifying a deleted source
		// or returning a reflection after consent was revoked during the job.
		const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true, memoryEnabled: true } });
		if (!hasCurrentAiConsent(currentUser)) return { status: "consent-required" };
		if (allowsMemoryUse(currentUser?.memoryEnabled) !== memoryAllowed || !(await sourcesIntact(userId, fresh.sources, memoryAllowed))) throw new Error("Reflection sources changed during generation.");
		remainingProseTime(deadlineAt, 15_000);
		const content = JSON.stringify(fresh);
		const row = await prisma.readingReflection.upsert({
			where: { userId },
			create: { userId, basis, content, createdAt: now },
			update: { basis, content, createdAt: now },
		});
		failures.delete(userId);
		return ready(fresh, row.createdAt);
	} catch {
		console.warn("[reading-reflection] Generation or verification failed; no reflection stored.");
		failures.set(userId, now.getTime());
		// A stale or unchecked entry is never an outage fallback.
		return { status: "unavailable" };
	}
}
