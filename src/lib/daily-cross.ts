import { generateText, Output } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deleteAttachmentBlob } from "@/lib/chat-attachments.server";
import {
	builtInDailyCrossModel,
	DAILY_CROSS_MODEL_NAME,
} from "@/lib/ai/built-in-openai";
import { loadStudyContext } from "@/lib/study-context";
import {
	primaryThemeKeySchema,
	selectDailyCrossFallback,
	validateDailyCrossSelection,
	type DailyCrossSelection,
	type PrimaryThemeKey,
	type RecentDailyCross,
	type SelectionEvidence,
} from "@/lib/daily-cross-selection";
import { selectDailyCross } from "@/lib/daily-cross-selector";
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

const studyStepSchema = z.object({
	book: z.string().describe("Canonical KJV book name, e.g. 'John' or '1 Corinthians'."),
	chapter: z.number().int().min(1),
	focus: z.string().describe("One sentence: what to look for while reading this chapter."),
});

const guidedDaySchema = z.object({
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
	primaryTheme: z.string().trim().min(1).max(120),
	primaryThemeKey: primaryThemeKeySchema,
	themeTags: z.array(primaryThemeKeySchema).max(4),
});

/**
 * Shared with the spoken devotional (`src/lib/daily-cross-audio.ts`) so the
 * voice a user reads and the voice they hear are the same believer, not two
 * personas that happen to quote the same verse.
 */
export const PERSONA = `You prepare "Pick Up Your Cross" (Luke 9:23 — "take up his cross daily") for SureWord, a KJV Bible study assistant. You speak as a saved, born-again believer who holds the King James Version Bible to be the inerrant, infallible Word of God. You are a companion who keeps putting the right Scripture in front of this person — you never claim to be God, the Holy Spirit, or to speak for Him beyond what Scripture says. The Spirit works through the Word; your job is to hand them the Word.`;

const SHARED_RULES = `Honesty rule, non-negotiable: whyToday may only reference activity that is actually present in the context you are given. Fabricated intimacy ("you've been wrestling with...") when the context shows nothing is worse than a plain word of encouragement. When the context is thin, say less.

Reading plan rule: when the context shows they are following a reading plan and names today's reading in it, the study path IS that reading - the same chapters, in the same order, with your own focus line for each. Do not send them somewhere else and leave the plan sitting unread; the plan is the walk they already committed to. The one exception is when they have pinned a verse or asked today to centre on something in particular: honour what they asked for first, and if it takes you off the plan, say so in a clause rather than pretending the plan does not exist.

Otherwise the study path should continue or deepen what they have been reading, and the question should be plain enough to carry into an ordinary day. Warm, direct, second person, no fluff, no headings.`;

/** The selector has settled the verse; this model writes but may not reselect. */
function writerInstructions(reference: string, text: string, theme: string | null): string {
	return `${PERSONA}

The verse for today is ${reference}. That choice is settled and is not yours to revisit. Build the guided day around it. Its exact KJV text is:

"${text}"

${theme ? `The settled primary theme is "${theme}". Keep the entire day faithful to that theme.` : "The user pinned the verse. Name its primary theme honestly in the structured fields."}

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
	primaryTheme: string | null;
	primaryThemeKey: PrimaryThemeKey | null;
	themeTags: PrimaryThemeKey[];
	selectionMode: "theme" | "focus" | "pinned" | "fallback" | null;
	selectionReason: string | null;
	selectionEvidence: SelectionEvidence[];
	selectorModel: string | null;
	selectorEffort: string | null;
	writerModel: string | null;
	writerEffort: string | null;
	isFallback: boolean | null;
	fallbackReason: string | null;
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
	/** Internal runtime budget used by the batched morning cron. */
	abortSignal?: AbortSignal;
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

function errorSummary(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 1000);
	return "Unknown Daily Cross generation failure.";
}

function baseFallbackProvenance(reason: string) {
	return {
		selectorModel: DAILY_CROSS_MODEL_NAME,
		selectorEffort: "xhigh",
		writerModel: DAILY_CROSS_MODEL_NAME,
		writerEffort: "high",
		isFallback: true,
		fallbackReason: reason,
	} as const;
}

/** A pinned day whose prose could not be generated still keeps the user's verse. */
function pinnedFallbackCross(pinned: PinnedVerse, error: unknown): DailyCross {
	const reference = `${pinned.book} ${pinned.chapter}:${pinned.verse}`;
	const failure = errorSummary(error);
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
		primaryTheme: "The verse you chose to carry",
		primaryThemeKey: "scripture",
		themeTags: ["scripture", "obedience"],
		selectionMode: "pinned",
		selectionReason: `The user explicitly pinned ${reference}.`,
		selectionEvidence: [
			{ kind: "explicit-verse", summary: reference, origin: "user-pinned" },
		],
		selectorModel: null,
		selectorEffort: null,
		writerModel: DAILY_CROSS_MODEL_NAME,
		writerEffort: "high",
		isFallback: true,
		fallbackReason: failure,
	};
}

async function loadRecentSelections(userId: string, now = new Date()): Promise<RecentDailyCross[]> {
	const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
	const rows = await prisma.verseOfDay.findMany({
		where: { userId, sentAt: { gte: since } },
		orderBy: { sentAt: "desc" },
		select: {
			book: true,
			chapter: true,
			verse: true,
			sentAt: true,
			primaryTheme: true,
			primaryThemeKey: true,
			selectionReason: true,
			whyToday: true,
			reason: true,
		},
	});
	return rows.map((row) => ({
		book: row.book,
		chapter: row.chapter,
		verse: row.verse,
		sentAt: row.sentAt,
		primaryTheme: row.primaryTheme,
		primaryThemeKey: row.primaryThemeKey,
		selectionReason: row.selectionReason ?? row.whyToday ?? row.reason,
	}));
}

async function canonicalSelection(
	selection: DailyCrossSelection,
	recent: readonly RecentDailyCross[],
	now: Date,
): Promise<{ selection: DailyCrossSelection; text: string }> {
	const bookNumber = getKjvBookNumber(selection.book);
	if (!bookNumber) throw new Error(`Unknown book "${selection.book}".`);
	const book = getKjvBookName(bookNumber) ?? selection.book;
	const canonical = { ...selection, book };
	const policy = validateDailyCrossSelection(canonical, { recentSelections: recent, now });
	if (!policy.ok) throw new Error(policy.errors.join(" "));
	const text = await getKjvVerseText(bookNumber, canonical.chapter, canonical.verse);
	if (!text) throw new Error(`No KJV text for ${book} ${canonical.chapter}:${canonical.verse}.`);
	return { selection: canonical, text };
}

async function selectWithOneRetry(
	userId: string,
	focus: string | undefined,
	recent: readonly RecentDailyCross[],
	now: Date,
	abortSignal?: AbortSignal,
): Promise<{ selection: DailyCrossSelection; text: string }> {
	let retryFeedback: string | undefined;
	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			if (abortSignal?.aborted) throw abortSignal.reason ?? new Error("Daily Cross selection timed out.");
			const selection = await selectDailyCross({
				userId,
				mode: focus ? "focus" : "theme",
				...(focus ? { focus } : {}),
				recentSelections: recent,
				now,
				...(abortSignal ? { abortSignal } : {}),
				...(retryFeedback ? { retryFeedback } : {}),
			});
			return canonicalSelection(selection, recent, now);
		} catch (error) {
			lastError = error;
			retryFeedback = errorSummary(error);
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Daily Cross selection failed twice.");
}

async function writeGuidedDay(
	userId: string,
	verse: PinnedVerse,
	selection: DailyCrossSelection | null,
	focus: string | undefined,
	abortSignal?: AbortSignal,
): Promise<DailyCross> {
	const context = await loadStudyContext(userId);
	const reference = `${verse.book} ${verse.chapter}:${verse.verse}`;
	const evidence = selection?.evidence ?? [
		{ kind: "explicit-verse", summary: reference, origin: "user-pinned" },
	];
	const prompt = [
		selection ? `Why the selector chose this direction:\n${selection.selectionReason}` : null,
		selection ? `Why it is fresh enough for today:\n${selection.noveltyReason}` : null,
		`Evidence the selector actually used:\n${evidence.map((item) => `- [${item.origin ?? item.kind}] ${item.summary}`).join("\n")}`,
		`Today's reading in the user's active plan:\n${context.planBlock}`,
		focus ? `The user's explicit focus:\n${focus}` : null,
	]
		.filter((part): part is string => Boolean(part))
		.join("\n\n");
	const { output } = await generateText({
		model: builtInDailyCrossModel(),
		reasoning: "high",
		output: Output.object({ schema: guidedDaySchema }),
		instructions: writerInstructions(reference, verse.text, selection?.primaryTheme ?? null),
		prompt,
		...(abortSignal ? { abortSignal } : {}),
	});
	if (!output) throw new Error("The model returned no guided Daily Cross.");
	const studyPath = sanitizeStudyPath(output.study);
	const primaryTheme = selection?.primaryTheme ?? output.primaryTheme;
	const primaryThemeKey = selection?.primaryThemeKey ?? output.primaryThemeKey;
	const themeTags = [
		primaryThemeKey,
		...(selection?.secondaryThemeKeys ?? output.themeTags),
	].filter((tag, index, all): tag is PrimaryThemeKey => all.indexOf(tag) === index);
	return {
		...verse,
		reason: output.reason,
		whyToday: output.whyToday,
		application: output.application,
		studyPath: studyPath.length
			? studyPath
			: [{ book: verse.book, chapter: verse.chapter, focus: "Read the whole chapter slowly and let the verse sit in its context." }],
		question: output.question,
		primaryTheme,
		primaryThemeKey,
		themeTags,
		selectionMode: selection?.mode ?? "pinned",
		selectionReason: selection?.selectionReason ?? `The user explicitly pinned ${reference}.`,
		selectionEvidence: evidence,
		selectorModel: selection ? DAILY_CROSS_MODEL_NAME : null,
		selectorEffort: selection ? "xhigh" : null,
		writerModel: DAILY_CROSS_MODEL_NAME,
		writerEffort: "high",
		isFallback: false,
		fallbackReason: null,
	};
}

function staticFallbackCross(
	verse: PinnedVerse,
	selection: DailyCrossSelection,
	error: unknown,
): DailyCross {
	const reference = `${verse.book} ${verse.chapter}:${verse.verse}`;
	return {
		...verse,
		reason: "A sure word from Scripture to carry today.",
		whyToday:
			"Today begins with a plain word from Scripture. Read it slowly and let the whole chapter keep it in its proper place.",
		application:
			"Carry this verse into the next choice in front of you, and let obedience begin with what the passage says clearly.",
		studyPath: [
			{ book: verse.book, chapter: verse.chapter, focus: "Read the whole chapter and watch how this verse serves its main message." },
		],
		question: `What faithful response does ${reference} call for today?`,
		primaryTheme: selection.primaryTheme,
		primaryThemeKey: selection.primaryThemeKey,
		themeTags: [selection.primaryThemeKey, ...selection.secondaryThemeKeys].filter(
			(tag, index, all) => all.indexOf(tag) === index
		),
		selectionMode: "fallback",
		selectionReason: selection.selectionReason,
		selectionEvidence: selection.evidence,
		...baseFallbackProvenance(errorSummary(error)),
	};
}

/** Select with Sol/xhigh, write with Sol/high, then fail closed to a varied local day. */
export async function generateDailyCross(
	userId: string,
	request: DailyCrossRequest = {}
): Promise<DailyCross> {
	const pinned = request.verse ? await resolvePinnedVerse(request.verse) : null;
	const focus = request.focus?.trim();
	if (pinned) {
		try {
			return await writeGuidedDay(userId, pinned, null, focus, request.abortSignal);
		} catch (error) {
			console.error(`[daily-cross] Pinned-day writing failed for user ${userId}; using pinned fallback:`, error);
			return pinnedFallbackCross(pinned, error);
		}
	}

	const now = new Date();
	const recent = await loadRecentSelections(userId, now);
	let selected: { selection: DailyCrossSelection; text: string } | null = null;
	try {
		selected = await selectWithOneRetry(userId, focus, recent, now, request.abortSignal);
		const verse = { ...selected.selection, text: selected.text };
		try {
			return await writeGuidedDay(userId, verse, selected.selection, focus, request.abortSignal);
		} catch (error) {
			console.error(`[daily-cross] Guided-day writing failed for user ${userId}; preserving the validated selection:`, error);
			return staticFallbackCross(verse, selected.selection, error);
		}
	} catch (error) {
		console.error(`[daily-cross] Selection failed for user ${userId}; using exclusion-aware fallback:`, error);
		const fallback = selectDailyCrossFallback({
			recentSelections: recent,
			now,
			mode: focus ? "focus" : "theme",
			...(focus ? { focus } : {}),
			seed: `${userId}:${now.toISOString().slice(0, 10)}`,
		});
		const canonical = await canonicalSelection(fallback, recent, now);
		const verse = { ...canonical.selection, text: canonical.text };
		return staticFallbackCross(verse, canonical.selection, error);
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
			primaryTheme: cross.primaryTheme,
			primaryThemeKey: cross.primaryThemeKey,
			themeTags: JSON.parse(JSON.stringify(cross.themeTags)),
			selectionMode: cross.selectionMode,
			selectionReason: cross.selectionReason,
			selectionEvidence: JSON.parse(JSON.stringify(cross.selectionEvidence)),
			selectorModel: cross.selectorModel,
			selectorEffort: cross.selectorEffort,
			writerModel: cross.writerModel,
			writerEffort: cross.writerEffort,
			isFallback: cross.isFallback,
			fallbackReason: cross.fallbackReason,
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

function parseThemeTags(value: unknown): PrimaryThemeKey[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((candidate) => {
		const parsed = primaryThemeKeySchema.safeParse(candidate);
		return parsed.success ? [parsed.data] : [];
	});
}

function parseSelectionEvidence(value: unknown): SelectionEvidence[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((candidate) => {
		if (typeof candidate !== "object" || candidate === null) return [];
		const record = candidate as Record<string, unknown>;
		if (typeof record.kind !== "string" || typeof record.summary !== "string") return [];
		return [
			{
				kind: record.kind,
				summary: record.summary,
				...(typeof record.id === "string" ? { id: record.id } : {}),
				...(typeof record.origin === "string" ? { origin: record.origin } : {}),
			},
		];
	});
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
		primaryTheme: row.primaryTheme,
		primaryThemeKey: primaryThemeKeySchema.safeParse(row.primaryThemeKey).success
			? (row.primaryThemeKey as PrimaryThemeKey)
			: null,
		themeTags: parseThemeTags(row.themeTags),
		selectionMode:
			row.selectionMode === "theme" ||
			row.selectionMode === "focus" ||
			row.selectionMode === "pinned" ||
			row.selectionMode === "fallback"
				? row.selectionMode
				: null,
		selectionReason: row.selectionReason,
		selectionEvidence: parseSelectionEvidence(row.selectionEvidence),
		selectorModel: row.selectorModel,
		selectorEffort: row.selectorEffort,
		writerModel: row.writerModel,
		writerEffort: row.writerEffort,
		isFallback: row.isFallback,
		fallbackReason: row.fallbackReason,
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

	// A new day earns a new narration, in the background. Hooked in here rather
	// than in the callers so every route to a replacement gets it - the "a
	// different word for today" control and the `setDailyCross` chat tool alike.
	//
	// Imported dynamically on purpose: daily-cross-audio imports this module for
	// PERSONA and findTodayCross, so a static import back would be a cycle.
	const { scheduleDailyCrossAudio } = await import("@/lib/daily-cross-audio");
	await scheduleDailyCrossAudio(userId).catch((error: unknown) => {
		console.error(`[daily-cross] Could not schedule audio for ${userId}:`, error);
	});

	return {
		cross: { ...cross, id, sentAt, audioPathname: null },
		previousReference: previous
			? `${previous.book} ${previous.chapter}:${previous.verse}`
			: null,
	};
}
