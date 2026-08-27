import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { findTodayCross } from "@/lib/daily-cross";
import { prisma } from "@/lib/prisma";
import { loadStudyContext, READING_HISTORY_DAYS } from "@/lib/study-context";
import { commonQuestionSuggestions } from "@/utils/commonQuestions";
import { parseReferenceLabel, questionReference } from "@/utils/questionPresentation";

/**
 * The questions waiting on the empty chat screen. Instead of six fixed prompts,
 * these are drawn from the user's own walk — the chapters they have been
 * reading, what they have been asking, their notes, what SureWord remembers,
 * and the "Pick Up Your Cross" they were given today — so opening the app puts
 * their real next questions in front of them.
 *
 * Same honesty rule as the daily cross: only what is actually in the context.
 * A brand-new account gets the static six rather than invented history.
 */

export const SUGGESTED_QUESTION_COUNT = 6;

/** Two lines on a phone chip. Longer than this and the model is writing a paragraph. */
const MAX_QUESTION_LENGTH = 110;

/**
 * The label under a chip when the question is not anchored to one passage: the
 * place in the user's own walk it was drawn from. A reference always wins over
 * one of these; see `sanitizeLabel`.
 */
export const SUGGESTED_QUESTION_KINDS = [
	"MEMORY",
	"YOUR NOTES",
	"TODAY'S VERSE",
	"APPLY",
	"NEXT CHAPTER",
	"DOCTRINE",
] as const;

export type SuggestedQuestionKind = (typeof SUGGESTED_QUESTION_KINDS)[number];

const questionsSchema = z.object({
	questions: z
		.array(
			z.object({
				question: z.string().describe("The question, worded as the user would type it."),
				label: z
					.string()
					.describe(
						`Either a Scripture reference ("James 3:5-6") when the question is anchored to one passage, or exactly one of: ${SUGGESTED_QUESTION_KINDS.join(", ")}.`
					),
			})
		)
		.min(4)
		.max(SUGGESTED_QUESTION_COUNT)
		.describe("The questions, most compelling first."),
});

const INSTRUCTIONS = `You choose the questions waiting on the opening screen of SureWord, a King James Bible study assistant, for one particular user. You are given their recent walk: the chapters they have been reading, questions they have asked, notes they have written, what the app remembers about them, and the guided verse they were given today.

Write ${SUGGESTED_QUESTION_COUNT} questions that this person would actually want to ask next.

The rules, in order of importance:

1. THE USER IS THE ONE ASKING. Each question is sent word-for-word as their own message the moment they tap it, so write it the way they would type it — "Why does God answer Job with questions instead of answers?", never "You noted Job's silence — why does God answer with questions?". Never address the user, never mention their history back to them, never say "you" about them at all. A chip that reads like the app talking is wrong even if its subject is right.
2. GROUND EVERY ONE IN THE CONTEXT YOU WERE GIVEN. Draw on the actual chapters, doctrines, people and troubles that appear there. Never invent a study, struggle or question this context does not show.
3. VARY THEM. Across the six, aim for a spread: the passage they have been living in, a doctrine their recent questions circle, something that follows from today's verse, a plain application question, and a natural next step in their reading. Do not write six variations of one question.
4. Do not re-ask something they have already asked — move past it instead.
5. One sentence each, under ${MAX_QUESTION_LENGTH} characters, plain and specific. No numbering, no quotation marks around the whole question, no emoji, no yes/no questions, and nothing so broad it could sit on any user's screen.
6. LABEL EVERY QUESTION. The label is the small caption shown above the question, and it says where the question comes from. If the question is anchored to one passage, the label is that Scripture reference - book and chapter, with a verse or verse range when the question is about specific verses ("Romans 8", "James 3:5-6"). A reference always beats a kind label: only when no single passage fits, use exactly one of these, spelled exactly like this:
   - MEMORY - drawn from what SureWord remembers about them
   - YOUR NOTES - drawn from a note they wrote
   - TODAY'S VERSE - follows from today's "Pick Up Your Cross"
   - APPLY - a plain application question, no one passage
   - NEXT CHAPTER - the natural next step in their reading
   - DOCTRINE - a doctrine their recent questions circle
   Never invent a reference the question is not actually about, and never write any other label.`;

/** One chip: the question the user sends, and the caption shown above it. */
export interface SuggestedQuestion {
	question: string;
	/** A Scripture reference, a `SuggestedQuestionKind`, or null when neither applies. */
	label: string | null;
}

export interface SuggestedQuestions {
	questions: SuggestedQuestion[];
	/** False when these are the static defaults - nothing was personalized. */
	personalized: boolean;
}

/**
 * The wire shape, which is deliberately redundant. Every client already in the
 * wild - Android 1.26 and earlier, the current macOS DMG - reads
 * `questions: string[]` and filters out anything that is not a string, so
 * moving that key to objects would silently drop every installed user back to
 * the static six. `questions` therefore stays exactly what it was, and the
 * labels ride alongside in `items` (same questions, same order) for clients
 * that know to look.
 */
export interface SuggestedQuestionsResponse {
	questions: string[];
	items: SuggestedQuestion[];
	personalized: boolean;
}

export function toSuggestedQuestionsResponse(
	result: SuggestedQuestions
): SuggestedQuestionsResponse {
	return {
		questions: result.questions.map((item) => item.question),
		items: result.questions,
		personalized: result.personalized,
	};
}

/**
 * How long a stored set keeps serving before a fresh one is generated. Same
 * 20-hour window as the daily cross: "one per day" that still rolls over
 * naturally whichever hour the morning cron or the first open lands on.
 */
const SUGGESTED_REUSE_MS = 20 * 60 * 60 * 1000;

const fallback = (): SuggestedQuestions => ({
	questions: sanitize(commonQuestionSuggestions),
	personalized: false,
});

/** A question as it arrives from the model, or out of an older stored row. */
interface RawSuggestedQuestion {
	question: string;
	label?: string | null;
}

/** Kind labels are matched forgivingly: case, curly apostrophes, stray punctuation. */
function matchKind(label: string): SuggestedQuestionKind | null {
	const normalized = label
		.toUpperCase()
		.replace(/[‘’ʼ]/g, "'")
		.replace(/[_-]+/g, " ")
		.replace(/[^A-Z' ]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return SUGGESTED_QUESTION_KINDS.find((kind) => kind === normalized) ?? null;
}

/**
 * A label we are willing to show: one of the fixed kinds, or a reference that
 * actually parses. Anything else the model invents is dropped in favour of a
 * reference lifted out of the question text, and if there is none, no label at
 * all - an empty gold slot is honest, a guessed one is not.
 */
function sanitizeLabel(rawLabel: string | null | undefined, question: string): string | null {
	const raw = typeof rawLabel === "string" ? rawLabel.trim() : "";
	if (raw) {
		const kind = matchKind(raw);
		if (kind) return kind;
		const reference = parseReferenceLabel(raw);
		if (reference) return reference;
	}
	return questionReference(question);
}

/** Trim, drop the malformed, dedupe, label, and stop at a full grid. */
function sanitize(candidates: readonly (string | RawSuggestedQuestion)[]): SuggestedQuestion[] {
	const cleaned: SuggestedQuestion[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const isPlain = typeof candidate === "string";
		const source = isPlain ? candidate : candidate.question;
		if (typeof source !== "string") continue;
		const question = source.trim().replace(/^["'`]|["'`]$/g, "").trim();
		if (!question || question.length > MAX_QUESTION_LENGTH) continue;
		const key = question.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push({ question, label: sanitizeLabel(isPlain ? null : candidate.label, question) });
		if (cleaned.length === SUGGESTED_QUESTION_COUNT) break;
	}
	return cleaned;
}

export async function generateSuggestedQuestions(
	userId: string,
	options: { abortSignal?: AbortSignal } = {},
): Promise<SuggestedQuestions> {
	try {
		if (options.abortSignal?.aborted) throw options.abortSignal.reason ?? new Error("Question refresh timed out.");
		const context = await loadStudyContext(userId);
		// Nothing to personalize from: a first-time user gets the static six
		// rather than six questions invented about a walk they have not walked.
		if (context.isEmpty) return fallback();

		// Read-only: the welcome screen must never trigger a day's generation as
		// a side effect. If today's cross has not been prepared yet, it simply
		// is not part of the context.
		const cross = await findTodayCross(userId).catch(() => null);

		const prompt = [
			`Bible chapters read in the last ${READING_HISTORY_DAYS} days:\n${context.readingBlock}`,
			`Questions they have already asked (do not repeat these):\n${context.questionsBlock}`,
			`Their notes:\n${context.notesBlock}`,
			`What you remember about them:\n${context.memoriesBlock}`,
			cross
				? `Today's "Pick Up Your Cross" verse:\n${cross.book} ${cross.chapter}:${cross.verse} — "${cross.text}"${
						cross.question ? `\nThe question they were given to carry: ${cross.question}` : ""
					}`
				: `Today's "Pick Up Your Cross": (not prepared yet)`,
		].join("\n\n");

		const { model, providerOptions } = await resolveModel({ userId, utility: true });
		const { output } = await generateText({
			model,
			providerOptions,
			output: Output.object({ schema: questionsSchema }),
			instructions: INSTRUCTIONS,
			prompt,
			...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
		});
		if (!output) throw new Error("The model returned no questions.");

		const fromModel = sanitize(output.questions);
		if (fromModel.length === 0) return fallback();
		// Worth a line in the log: silently serving mostly-static chips because
		// the model wrote paragraphs looks identical, from the outside, to a user
		// who simply has no history yet.
		if (fromModel.length < output.questions.length) {
			console.warn(
				`[suggested-questions] Dropped ${output.questions.length - fromModel.length} of ${output.questions.length} generated questions (empty, over ${MAX_QUESTION_LENGTH} chars, or duplicated) for user ${userId}.`
			);
		}
		return {
			// Top up from the static set so the grid is always full, even when the
			// model returns four good ones.
			questions:
				fromModel.length >= SUGGESTED_QUESTION_COUNT
					? fromModel
					: sanitize([...fromModel, ...commonQuestionSuggestions]),
			personalized: true,
		};
	} catch (error) {
		console.error(`[suggested-questions] Generation failed for user ${userId}; using defaults:`, error);
		return fallback();
	}
}

/** Today's stored set if one exists inside the reuse window, else null. */
async function findTodaySet(userId: string): Promise<SuggestedQuestions | null> {
	const since = new Date(Date.now() - SUGGESTED_REUSE_MS);
	const row = await prisma.suggestedQuestionSet.findFirst({
		where: { userId, createdAt: { gte: since } },
		orderBy: { createdAt: "desc" },
		select: { questions: true },
	});
	if (!row) return null;
	try {
		const parsed: unknown = JSON.parse(row.questions);
		if (!Array.isArray(parsed)) return null;
		// Rows written before labels existed are plain strings. Serving one for
		// the rest of its window means a screen where only the regex-liftable
		// references get a caption and every MEMORY / YOUR NOTES question sits
		// bare - so a string row is stale, and today's set regenerates once.
		const candidates: RawSuggestedQuestion[] = [];
		for (const entry of parsed) {
			if (typeof entry === "string") return null;
			if (typeof entry !== "object" || entry === null) continue;
			const { question, label } = entry as { question?: unknown; label?: unknown };
			if (typeof question !== "string" || question.length === 0) continue;
			candidates.push({ question, label: typeof label === "string" ? label : null });
		}
		const questions = sanitize(candidates);
		return questions.length > 0 ? { questions, personalized: true } : null;
	} catch {
		// A malformed stored row regenerates rather than erroring.
		return null;
	}
}

/** Persist a personalized set so the rest of the day serves it instantly. */
async function storeSet(userId: string, result: SuggestedQuestions): Promise<void> {
	await prisma.suggestedQuestionSet.create({
		data: { userId, questions: JSON.stringify(result.questions) },
	});
}

/**
 * The welcome screen's questions: today's stored set when there is one,
 * otherwise generate-and-store (first open of the day wins, exactly like the
 * daily cross). Only personalized sets are stored - the static fallback is
 * free to produce, and not storing it lets a user who studies later today get
 * personalized questions on their next open instead of frozen defaults.
 */
export async function getSuggestedQuestions(userId: string): Promise<SuggestedQuestions> {
	const existing = await findTodaySet(userId).catch(() => null);
	if (existing) return existing;

	const generated = await generateSuggestedQuestions(userId);
	if (generated.personalized) {
		await storeSet(userId, generated).catch((error) => {
			console.error(`[suggested-questions] Failed to store set for user ${userId}:`, error);
		});
	}
	return generated;
}

/**
 * Cron hook: refresh the day's set unconditionally (called right after a new
 * daily cross is generated, so the questions can build on it). Failures are
 * the caller's to log; the morning push must not depend on this.
 */
export async function refreshSuggestedQuestions(
	userId: string,
	options: { abortSignal?: AbortSignal } = {},
): Promise<void> {
	const generated = await generateSuggestedQuestions(userId, options);
	if (generated.personalized) await storeSet(userId, generated);
}
