import { loadUserMemories } from "@/lib/memory";
import { prisma } from "@/lib/prisma";
import { getTodayPlanReading } from "@/lib/reading-plans";

/**
 * One user's recent walk, formatted for a prompt: what they have been reading,
 * asking, writing and remembered for.
 *
 * Extracted so "Pick Up Your Cross" (`src/lib/daily-cross.ts`) and the
 * personalized welcome-screen questions (`src/lib/suggested-questions.ts`) read
 * a user the same way. Both features are only honest if they are looking at the
 * same evidence — two different notions of "recent" would let the chips claim a
 * study the day's verse knows nothing about.
 */

export const READING_HISTORY_DAYS = 30;
const RECENT_MESSAGES = 15;
const RECENT_NOTES = 10;
const EXCLUDED_PICKS = 30;
const MESSAGE_SNIPPET_LENGTH = 200;
const NOTE_SNIPPET_LENGTH = 300;
const TOP_CHAPTERS = 20;

export interface StudyContext {
	/** "Romans 8 (4x), John 3 (2x)" — most-read first — or "(none yet)". */
	readingBlock: string;
	/** The user's own recent questions, one per line, or "(none)". */
	questionsBlock: string;
	/** Recent note titles with a snippet of each, or "(none)". */
	notesBlock: string;
	/** Saved memories with their category, or "(none)". */
	memoriesBlock: string;
	/** Recently sent daily verses, for exclusion, or "(none)". */
	recentPicksBlock: string;
	/**
	 * Today's reading in the plan they are following - "The Gospels in 30 days,
	 * day 4 of 30: Matthew 10-12" - or "(none)". The daily cross builds its
	 * study path out of this when it is present, so a user following a plan is
	 * never pulled two directions at once.
	 */
	planBlock: string;
	/**
	 * True when there is nothing at all to personalize from — a brand-new
	 * account. Callers should fall back rather than ask a model to invent a
	 * history this user does not have.
	 */
	isEmpty: boolean;
}

export async function loadStudyContext(userId: string): Promise<StudyContext> {
	const readingSince = new Date(Date.now() - READING_HISTORY_DAYS * 24 * 60 * 60 * 1000);
	const [readingEvents, messages, notes, memories, recentPicks, planReading] = await Promise.all([
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
		// Best effort: a plan lookup that fails must not cost the user their
		// daily cross or their opening questions.
		getTodayPlanReading(userId).catch((error: unknown) => {
			console.error("[study-context] Reading plan lookup failed:", error);
			return null;
		}),
	]);

	const readingCounts = new Map<string, number>();
	for (const event of readingEvents) {
		const reference = `${event.book} ${event.chapter}`;
		readingCounts.set(reference, (readingCounts.get(reference) ?? 0) + 1);
	}

	return {
		readingBlock:
			Array.from(readingCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, TOP_CHAPTERS)
				.map(([reference, count]) => `${reference} (${count}x)`)
				.join(", ") || "(none yet)",
		questionsBlock:
			messages.map((message) => `- ${message.content.slice(0, MESSAGE_SNIPPET_LENGTH)}`).join("\n") ||
			"(none)",
		notesBlock:
			notes
				.map((note) => `- ${note.title}: ${note.plainText.slice(0, NOTE_SNIPPET_LENGTH)}`)
				.join("\n") || "(none)",
		memoriesBlock:
			memories.map((memory) => `- (${memory.category}) ${memory.content}`).join("\n") || "(none)",
		recentPicksBlock:
			recentPicks.map((pick) => `${pick.book} ${pick.chapter}:${pick.verse}`).join(", ") || "(none)",
		planBlock: planReading
			? `${planReading.planTitle}, day ${planReading.day} of ${planReading.dayCount}: ${planReading.reference}` +
				`${planReading.focus ? ` - ${planReading.focus}` : ""}` +
				`${planReading.done ? " (already read today)" : ""}`
			: "(none)",
		// The daily picks are not evidence of study - the cron writes them
		// whether or not the user ever opened the app. A reading plan is, though:
		// the user chose it.
		isEmpty:
			readingEvents.length === 0 &&
			messages.length === 0 &&
			notes.length === 0 &&
			memories.length === 0 &&
			planReading === null,
	};
}
