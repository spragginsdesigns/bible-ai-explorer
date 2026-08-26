import { generateText, Output } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteAttachmentBlob } from "@/lib/chat-attachments.server";
import { resolveModel } from "@/lib/ai/provider";
import { loadStudyContext, READING_HISTORY_DAYS } from "@/lib/study-context";
import { getKjvBookName, getKjvBookNumber, getKjvVerseText } from "@/utils/kjvBible";

/**
 * "Pick Up Your Cross" (Luke 9:23) — the personalized daily walk. One shared
 * generator serves both the morning cron (push notification) and the
 * on-demand /api/verse-of-day/today route (the Daily Cross screen on Android
 * and web), so a user never gets two different "days".
 */

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

/** The pinned-verse variant of the day: the reference is fixed, the prose is not. */
const pinnedCrossSchema = dailyCrossSchema.omit({ book: true, chapter: true, verse: true });

/**
 * Shared with the spoken devotional (`src/lib/daily-cross-audio.ts`) so the
 * voice a user reads and the voice they hear are the same believer, not two
 * personas that happen to quote the same verse.
 */
export const PERSONA = `You prepare "Pick Up Your Cross" (Luke 9:23 — "take up his cross daily") for SureWord, a KJV Bible study assistant. You speak as a saved, born-again believer who holds the King James Version Bible to be the inerrant, infallible Word of God. You are a companion who keeps putting the right Scripture in front of this person — you never claim to be God, the Holy Spirit, or to speak for Him beyond what Scripture says. The Spirit works through the Word; your job is to hand them the Word.`;

const SHARED_RULES = `Honesty rule, non-negotiable: whyToday may only reference activity that is actually present in the context you are given. Fabricated intimacy ("you've been wrestling with...") when the context shows nothing is worse than a plain word of encouragement. When the context is thin, say less.

The study path should usually continue or deepen what they have been reading, and the question should be plain enough to carry into an ordinary day. Warm, direct, second person, no fluff, no headings.`;

const INSTRUCTIONS = `${PERSONA}

Given one user's recent Bible reading, chat questions, notes and saved memories, choose ONE verse from the KJV canon that speaks to where they are right now, then build their guided day around it. Prefer a verse that meets them where they are over a generic famous one. Never pick a verse on the exclusion list.

${SHARED_RULES}`;

/** Instructions for the pinned path: the user named the verse; only the day is yours. */
function pinnedInstructions(reference: string, text: string): string {
	return `${PERSONA}

The user has asked for today's day to be built on ${reference} — that choice is settled and is not yours to revisit. Build the guided day around it. Its exact KJV text is:

"${text}"

${SHARED_RULES}`;
}

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
 * A verse the user named that is not in the KJV canon. Thrown out of the
 * generator rather than swallowed, so "make today Psalm 151:1" comes back to
 * them as a correction instead of silently becoming some other day.
 */
export class DailyCrossReferenceError extends Error {}

export interface DailyCrossRequest {
	/** What the user asked today's word to centre on, in their own words. */
	focus?: string;
	/** Pin the day to a verse the user named instead of letting the model choose. */
	verse?: { book: string; chapter: number; verse: number };
}

interface PinnedVerse {
	book: string;
	chapter: number;
	verse: number;
	text: string;
}

/** Resolve a user-named reference to its canonical book name and KJV text. */
async function resolvePinnedVerse(requested: {
	book: string;
	chapter: number;
	verse: number;
}): Promise<PinnedVerse> {
	const bookNumber = getKjvBookNumber(requested.book);
	if (!bookNumber) {
		throw new DailyCrossReferenceError(`"${requested.book}" is not a book of the King James Bible.`);
	}
	const book = getKjvBookName(bookNumber) ?? requested.book;
	const text = await getKjvVerseText(bookNumber, requested.chapter, requested.verse);
	if (!text) {
		throw new DailyCrossReferenceError(
			`${book} ${requested.chapter}:${requested.verse} is not a verse in the King James Bible.`
		);
	}
	return { book, chapter: requested.chapter, verse: requested.verse, text };
}

/** A pinned day whose prose could not be generated still keeps the user's verse. */
function pinnedFallbackCross(pinned: PinnedVerse): DailyCross {
	const reference = `${pinned.book} ${pinned.chapter}:${pinned.verse}`;
	return {
		...pinned,
		reason: "The verse you asked to carry today.",
		whyToday: `You asked for ${reference} today, so that is where the day starts.`,
		application:
			"Read it slowly, more than once, and let it set the tone before the day gets loud.",
		studyPath: [
			{
				book: pinned.book,
				chapter: pinned.chapter,
				focus: "Read the whole chapter slowly and let the verse sit in its context.",
			},
		],
		question: `What changes today if ${reference} is true of you?`,
	};
}

/**
 * Generate one guided day. Any failure — no AI credentials, bad model output,
 * a reference outside the KJV canon — degrades to a John 3:16 day (or, when the
 * user pinned a verse, to a plain day on that verse) so callers never have
 * nothing to show or send.
 */
export async function generateDailyCross(
	userId: string,
	request: DailyCrossRequest = {}
): Promise<DailyCross> {
	// Validated before the try block: a mistyped reference must reach the caller
	// as an error rather than be swallowed by the fallback.
	const pinned = request.verse ? await resolvePinnedVerse(request.verse) : null;
	const focus = request.focus?.trim();

	try {
		const context = await loadStudyContext(userId);

		const prompt = [
			`Bible chapters read in the last ${READING_HISTORY_DAYS} days:\n${context.readingBlock}`,
			`Recent things they asked about:\n${context.questionsBlock}`,
			`Recent notes:\n${context.notesBlock}`,
			`What you remember about them:\n${context.memoriesBlock}`,
			// A pinned verse is the user's own choice; the exclusion list, which
			// only exists to stop repeats, must not argue with it.
			pinned
				? null
				: `Do NOT pick any of these recently sent verses:\n${context.recentPicksBlock}`,
			focus
				? `The user asked for today's word to centre on this, in their own words:\n"${focus}"\nHonour it as far as Scripture honestly allows, and let it outweigh the patterns above.`
				: null,
		]
			.filter((block): block is string => block !== null)
			.join("\n\n");

		const { model, providerOptions } = await resolveModel({ userId, utility: true });

		if (pinned) {
			const { output } = await generateText({
				model,
				providerOptions,
				output: Output.object({ schema: pinnedCrossSchema }),
				instructions: pinnedInstructions(
					`${pinned.book} ${pinned.chapter}:${pinned.verse}`,
					pinned.text
				),
				prompt,
			});
			if (!output) throw new Error("The model returned no daily cross.");
			const pinnedStudyPath = sanitizeStudyPath(output.study);
			return {
				...pinned,
				reason: output.reason,
				whyToday: output.whyToday,
				application: output.application,
				studyPath: pinnedStudyPath.length ? pinnedStudyPath : pinnedFallbackCross(pinned).studyPath,
				question: output.question,
			};
		}

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
		if (pinned) return pinnedFallbackCross(pinned);
		const text = await getKjvVerseText(43, 3, 16).catch(() => undefined);
		return fallbackCross(text);
	}
}

/** Persist a generated day; returns the stored row's id and sentAt. */
export async function storeDailyCross(
	userId: string,
	cross: DailyCross
): Promise<{ id: string; sentAt: Date }> {
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
		select: { id: true, sentAt: true },
	});
	return row;
}

export interface StoredDailyCross extends DailyCross {
	id: string;
	sentAt: Date;
	/**
	 * Blob path of the spoken devotional for this day, when one has been
	 * generated. Carried here so replacing the day can clean the old audio up
	 * without a second query.
	 */
	audioPathname: string | null;
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
		id: row.id,
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
		audioPathname: row.audioPathname,
	};
}

/**
 * Replace today's day with a freshly generated one, and report the reference it
 * displaced. The new row is simply the newest inside the reuse window, so every
 * client's next `findTodayCross` picks it up; the row it replaced stays in
 * `VerseOfDay` as history — and as an exclusion, so a regenerate never hands
 * back the very verse the user just asked to move on from.
 */
export async function replaceDailyCross(
	userId: string,
	request: DailyCrossRequest = {}
): Promise<{ cross: StoredDailyCross; previousReference: string | null }> {
	const previous = await findTodayCross(userId);
	const cross = await generateDailyCross(userId, request);
	const { id, sentAt } = await storeDailyCross(userId, cross);

	// The new row carries no audio, so the replaced day's spoken devotional is
	// unreachable from here on. Delete the blob rather than leave it paid for.
	// Best effort: a failed delete must never fail the replacement.
	if (previous?.audioPathname) {
		const pathname = previous.audioPathname;
		await deleteAttachmentBlob(pathname).catch((error: unknown) => {
			console.error(`[daily-cross] Could not delete replaced audio ${pathname}:`, error);
		});
	}

	return {
		cross: { ...cross, id, sentAt, audioPathname: null },
		previousReference: previous
			? `${previous.book} ${previous.chapter}:${previous.verse}`
			: null,
	};
}
