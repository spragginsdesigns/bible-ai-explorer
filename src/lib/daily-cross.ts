import { generateText, Output } from "ai";
import { z } from "zod";
import { loadUserMemories } from "@/lib/memory";
import { prisma } from "@/lib/prisma";
import { resolveModel } from "@/lib/ai/provider";
import { getKjvBookName, getKjvBookNumber, getKjvVerseText } from "@/utils/kjvBible";

/**
 * "Pick Up Your Cross" (Luke 9:23) — the personalized daily walk. One shared
 * generator serves both the morning cron (push notification) and the
 * on-demand /api/verse-of-day/today route (the Daily Cross screen on Android
 * and web), so a user never gets two different "days".
 */

const READING_HISTORY_DAYS = 30;
const RECENT_MESSAGES = 15;
const RECENT_NOTES = 10;
const EXCLUDED_PICKS = 30;
const MESSAGE_SNIPPET_LENGTH = 200;
const NOTE_SNIPPET_LENGTH = 300;

/**
 * An entry younger than this is still "today". Cheaper and timezone-proof
 * compared to computing local midnight: the cron fires at most once a day per
 * user, and an on-demand generation inside the window is reused rather than
 * regenerated.
 */
export const DAILY_CROSS_REUSE_MS = 20 * 60 * 60 * 1000;

const FALLBACK_TEXT =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

const studyStepSchema = z.object({
	book: z.string().describe("Canonical KJV book name, e.g. 'John' or '1 Corinthians'."),
	chapter: z.number().int().min(1),
	focus: z.string().describe("One sentence: what to look for while reading this chapter."),
});

const dailyCrossSchema = z.object({
	book: z.string().describe("Canonical KJV book name, e.g. 'John' or '1 Corinthians'."),
	chapter: z.number().int().min(1),
	verse: z.number().int().min(1),
	reason: z
		.string()
		.describe(
			"One short warm line on why this verse fits them today; it is the notification body."
		),
	whyToday: z
		.string()
		.describe(
			"2-4 sentences, second person: why this verse was chosen for them today. Cite ONLY activity present in the provided context (chapters they read, questions they asked, notes they wrote). If the context is empty or thin, encourage them plainly instead — never invent history they don't have."
		),
	application: z
		.string()
		.describe("2-3 sentences applying the verse personally to their walk today."),
	study: z
		.array(studyStepSchema)
		.min(1)
		.max(3)
		.describe("Today's study path: 1-3 chapters to read, each with a focus line."),
	question: z.string().describe("One question for them to carry through the day."),
});

const INSTRUCTIONS = `You prepare "Pick Up Your Cross" (Luke 9:23 — "take up his cross daily") for SureWord, a KJV Bible study assistant. You speak as a saved, born-again believer who holds the King James Version Bible to be the inerrant, infallible Word of God. You are a companion who keeps putting the right Scripture in front of this person — you never claim to be God, the Holy Spirit, or to speak for Him beyond what Scripture says. The Spirit works through the Word; your job is to hand them the Word.

Given one user's recent Bible reading, chat questions, notes and saved memories, choose ONE verse from the KJV canon that speaks to where they are right now, then build their guided day around it. Prefer a verse that meets them where they are over a generic famous one. Never pick a verse on the exclusion list.

Honesty rule, non-negotiable: whyToday may only reference activity that is actually present in the context you are given. Fabricated intimacy ("you've been wrestling with...") when the context shows nothing is worse than a plain word of encouragement. When the context is thin, say less.

The study path should usually continue or deepen what they have been reading, and the question should be plain enough to carry into an ordinary day. Warm, direct, second person, no fluff, no headings.`;

export interface StudyStep {
	book: string;
	chapter: number;
	focus: string;
}

export interface DailyCross {
	book: string;
	chapter: number;
	verse: number;
	text: string;
	reason: string;
	whyToday: string | null;
	application: string | null;
	studyPath: StudyStep[];
	question: string | null;
}

function fallbackCross(text?: string): DailyCross {
	return {
		book: "John",
		chapter: 3,
		verse: 16,
		text: text ?? FALLBACK_TEXT,
		reason: "The heart of the gospel, for every season.",
		whyToday:
			"Some days the best place to stand is the plainest one: God loved, God gave, and whosoever believeth shall not perish. Start today there.",
		application:
			"Read the verse slowly and put your own name where it says \"whosoever\". Everything else in the day can be carried from inside that assurance.",
		studyPath: [
			{
				book: "John",
				chapter: 3,
				focus: "Read the whole conversation with Nicodemus and watch what Jesus says a person must be, not do, to see the kingdom.",
			},
		],
		question: "What would today look like if you actually believed John 3:16 applied to you?",
	};
}

/** Keep only study steps whose book exists in the KJV canon, canonically named. */
function sanitizeStudyPath(steps: StudyStep[]): StudyStep[] {
	const cleaned: StudyStep[] = [];
	for (const step of steps) {
		const bookNumber = getKjvBookNumber(step.book);
		if (!bookNumber) continue;
		cleaned.push({
			book: getKjvBookName(bookNumber) ?? step.book,
			chapter: step.chapter,
			focus: step.focus,
		});
	}
	return cleaned;
}

/**
 * Generate one guided day. Any failure — no AI credentials, bad model output,
 * a reference outside the KJV canon — degrades to a John 3:16 day so callers
 * never have nothing to show or send.
 */
export async function generateDailyCross(userId: string): Promise<DailyCross> {
	try {
		const readingSince = new Date(Date.now() - READING_HISTORY_DAYS * 24 * 60 * 60 * 1000);
		const [readingEvents, messages, notes, memories, recentPicks] = await Promise.all([
			prisma.readingEvent.findMany({
				where: { userId, readAt: { gte: readingSince } },
				select: { book: true, chapter: true },
			}),
			prisma.message.findMany({
				where: { role: "user", conversation: { userId } },
				orderBy: { createdAt: "desc" },
				take: RECENT_MESSAGES,
				select: { content: true },
			}),
			prisma.note.findMany({
				where: { userId },
				orderBy: { updatedAt: "desc" },
				take: RECENT_NOTES,
				select: { title: true, plainText: true },
			}),
			loadUserMemories(userId),
			prisma.verseOfDay.findMany({
				where: { userId },
				orderBy: { sentAt: "desc" },
				take: EXCLUDED_PICKS,
				select: { book: true, chapter: true, verse: true },
			}),
		]);

		const readingCounts = new Map<string, number>();
		for (const event of readingEvents) {
			const reference = `${event.book} ${event.chapter}`;
			readingCounts.set(reference, (readingCounts.get(reference) ?? 0) + 1);
		}
		const readingBlock =
			Array.from(readingCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 20)
				.map(([reference, count]) => `${reference} (${count}x)`)
				.join(", ") || "(none yet)";

		const prompt = [
			`Bible chapters read in the last ${READING_HISTORY_DAYS} days:\n${readingBlock}`,
			`Recent things they asked about:\n${
				messages.map((message) => `- ${message.content.slice(0, MESSAGE_SNIPPET_LENGTH)}`).join("\n") ||
				"(none)"
			}`,
			`Recent notes:\n${
				notes
					.map((note) => `- ${note.title}: ${note.plainText.slice(0, NOTE_SNIPPET_LENGTH)}`)
					.join("\n") || "(none)"
			}`,
			`What you remember about them:\n${
				memories.map((memory) => `- (${memory.category}) ${memory.content}`).join("\n") || "(none)"
			}`,
			`Do NOT pick any of these recently sent verses:\n${
				recentPicks.map((pick) => `${pick.book} ${pick.chapter}:${pick.verse}`).join(", ") || "(none)"
			}`,
		].join("\n\n");

		const { model, providerOptions } = await resolveModel({ userId, utility: true });
		const { output } = await generateText({
			model,
			providerOptions,
			output: Output.object({ schema: dailyCrossSchema }),
			instructions: INSTRUCTIONS,
			prompt,
		});
		if (!output) throw new Error("The model returned no daily cross.");

		const bookNumber = getKjvBookNumber(output.book);
		if (!bookNumber) throw new Error(`Unknown book "${output.book}".`);
		const text = await getKjvVerseText(bookNumber, output.chapter, output.verse);
		if (!text) throw new Error(`No KJV text for ${output.book} ${output.chapter}:${output.verse}.`);

		const book = getKjvBookName(bookNumber) ?? output.book;
		const studyPath = sanitizeStudyPath(output.study);
		return {
			book,
			chapter: output.chapter,
			verse: output.verse,
			text,
			reason: output.reason,
			whyToday: output.whyToday,
			application: output.application,
			studyPath: studyPath.length
				? studyPath
				: [{ book, chapter: output.chapter, focus: "Read the whole chapter slowly and let the verse sit in its context." }],
			question: output.question,
		};
	} catch (error) {
		console.error(`[daily-cross] Generation failed for user ${userId}; using fallback:`, error);
		const text = await getKjvVerseText(43, 3, 16).catch(() => undefined);
		return fallbackCross(text);
	}
}

/** Persist a generated day; returns the stored row's sentAt. */
export async function storeDailyCross(userId: string, cross: DailyCross): Promise<Date> {
	const row = await prisma.verseOfDay.create({
		data: {
			userId,
			book: cross.book,
			chapter: cross.chapter,
			verse: cross.verse,
			text: cross.text,
			reason: cross.reason,
			whyToday: cross.whyToday,
			application: cross.application,
			studyPath: JSON.stringify(cross.studyPath),
			question: cross.question,
		},
		select: { sentAt: true },
	});
	return row.sentAt;
}

export interface StoredDailyCross extends DailyCross {
	sentAt: Date;
}

/** Today's entry if one exists inside the reuse window, else null. */
export async function findTodayCross(userId: string): Promise<StoredDailyCross | null> {
	const since = new Date(Date.now() - DAILY_CROSS_REUSE_MS);
	const row = await prisma.verseOfDay.findFirst({
		where: { userId, sentAt: { gte: since } },
		orderBy: { sentAt: "desc" },
	});
	if (!row) return null;

	let studyPath: StudyStep[] = [];
	try {
		const parsed: unknown = row.studyPath ? JSON.parse(row.studyPath) : [];
		if (Array.isArray(parsed)) {
			studyPath = parsed.filter(
				(step): step is StudyStep =>
					typeof step === "object" &&
					step !== null &&
					typeof (step as StudyStep).book === "string" &&
					typeof (step as StudyStep).chapter === "number" &&
					typeof (step as StudyStep).focus === "string"
			);
		}
	} catch {
		// A malformed stored path renders as no study section rather than an error.
	}

	return {
		book: row.book,
		chapter: row.chapter,
		verse: row.verse,
		text: row.text,
		reason: row.reason,
		whyToday: row.whyToday,
		application: row.application,
		studyPath,
		question: row.question,
		sentAt: row.sentAt,
	};
}
