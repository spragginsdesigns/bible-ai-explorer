import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/provider";
import { findTodayCross } from "@/lib/daily-cross";
import { loadStudyContext, READING_HISTORY_DAYS } from "@/lib/study-context";
import { commonQuestions } from "@/utils/commonQuestions";

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

const questionsSchema = z.object({
	questions: z
		.array(z.string())
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
5. One sentence each, under ${MAX_QUESTION_LENGTH} characters, plain and specific. No numbering, no quotation marks around the whole question, no emoji, no yes/no questions, and nothing so broad it could sit on any user's screen.`;

export interface SuggestedQuestions {
	questions: string[];
	/** False when these are the static defaults — nothing was personalized. */
	personalized: boolean;
}

const fallback = (): SuggestedQuestions => ({
	questions: commonQuestions.slice(0, SUGGESTED_QUESTION_COUNT),
	personalized: false,
});

/**
 * Trim, drop the malformed, dedupe, and top up from the static set so callers
 * always get a full grid even when the model returns four good ones.
 */
function sanitize(questions: string[]): string[] {
	const cleaned: string[] = [];
	const seen = new Set<string>();
	for (const candidate of [...questions, ...commonQuestions]) {
		const question = candidate.trim().replace(/^["'`]|["'`]$/g, "").trim();
		if (!question || question.length > MAX_QUESTION_LENGTH) continue;
		const key = question.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push(question);
		if (cleaned.length === SUGGESTED_QUESTION_COUNT) break;
	}
	return cleaned;
}

export async function generateSuggestedQuestions(userId: string): Promise<SuggestedQuestions> {
	try {
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
		});
		if (!output) throw new Error("The model returned no questions.");

		const questions = sanitize(output.questions);
		if (questions.length === 0) return fallback();
		return { questions, personalized: true };
	} catch (error) {
		console.error(`[suggested-questions] Generation failed for user ${userId}; using defaults:`, error);
		return fallback();
	}
}
