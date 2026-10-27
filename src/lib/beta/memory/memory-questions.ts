import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel } from "@/lib/ai/provider";
import { bookByOrder } from "@/lib/bible/books";
import type { TranslationId } from "@/lib/bible/translations";
import type { QuizQuestion } from "@/lib/quiz-contract";
import { overlapWithVerse, validateDraft, type DraftQuestion } from "@/lib/quiz-rules";
import { systemPrompt } from "@/utils/systemPrompt";
import { answerKey, rangeReference, type PassageRange } from "@/lib/beta/memory/memory-rules";

/**
 * Comprehension questions for a memory card (LC-17651, docs/beta/memory.md),
 * written only when the founder asks for them.
 *
 * Every question is answered by the words of the verse being learned. The
 * model drafts; Quiz me's own `validateDraft` (`src/lib/quiz-rules.ts`) then
 * drops any question whose right answer the verse does not say, whose wrong
 * answer the verse does say, or whose right answer gives itself away, and the
 * verse text on every question comes from the bundled Bible, never the model.
 */

/** Bump when the prompt or the rules change; stored with each set. */
export const MEMORY_QUESTIONS_PROMPT_VERSION = 1;

const DRAFT_COUNT = 5;
const KEEP = 3;
const GENERATION_TIMEOUT_MS = 40_000;

// Every field is required, with nullable for "none": an OpenAI strict schema rejects `.optional()`.
const draftSchema = z.object({
	prompt: z.string().describe("The question, one sentence, plain modern English"),
	correct: z.string().describe("The right answer, short, in the verse's own words"),
	wrong: z.array(z.string()).length(3).describe("Three wrong answers, short, plausible, clearly not what the verse says"),
	verses: z.array(z.number().int().min(1)).min(1).max(3).describe("The verse numbers that state the answer, main one first"),
	note: z.string().nullable().describe("Always null"),
});

const schema = z.object({ questions: z.array(draftSchema).min(1).max(6) });

function task(reference: string, translation: TranslationId): string {
	return `CURRENT TASK: The user is memorizing ${reference} (${translation}) and asked for comprehension questions on it, so that learning the words by heart goes together with understanding what they say. You are given the verses. Write ${DRAFT_COUNT} multiple-choice questions on THESE verses and nothing else.

GOOD QUESTIONS:
- Ask about the plain sense a careful reader takes from the verses: who acts, what is given or done, to whom, how, why, and what is promised or warned. Each question has exactly one right answer, and the verses state it plainly.
- Ask what these verses say, never a general question about God: anchor each question in the passage ("In this verse, whom did God so love that he gave his only begotten Son?", not "Whom does God love?"), so a wrong answer is wrong because these verses say otherwise.
- Never ask what a pronoun or a word like "it" or "that" refers to, and never build a question on grammar, spelling, verse numbers or word counts. No trick questions, no negatives ("which is NOT").
- Spread the questions across the key phrases. Never ask the same thing twice.

THE RIGHT ANSWER ("correct"):
- The verse's own words, or very nearly: a short phrase (at most 8 words) that reads as a natural, complete answer to the question on its own.
- Never a fragment that only makes sense inside the sentence, such as "that not of yourselves".

THE WRONG ANSWERS ("wrong"):
- Three answers a person might give who half remembers the verse, each in the same grammatical form and about the same length as the right one.
- All four choices must look alike, so the right one cannot be spotted by its length or its old-English wording. If the right answer keeps the verse's words ("Them that love God"), phrase the wrong ones in the same style ("Them that love the world"), never in modern English beside it.
- None may be true, according to these verses or the rest of Scripture, as an answer to this question. This matters most for what God and Christ do: Christ forgives, guides, teaches and strengthens, so none of those may be a wrong answer about what He does. Prefer questions whose wrong answers are plainly false (who, to whom, by what, for whom) over questions whose wrong answers are only missing from this verse.
- Never reuse another phrase of these verses as a wrong answer: in a memory drill that blurs the verse. Draw them from ideas a reader could confuse with it.
- Never "all of the above", "none of the above", or jokes.

"verses": the verse numbers that state the answer, from the verses given only. "note": always null.

Faithful and reverent: Scripture is the inerrant Word of God. Do not question, soften, or reinterpret it.

EXAMPLE, for Psalm 23:1 (KJV) "The LORD is my shepherd; I shall not want.":
{"prompt": "Who does the psalmist say is his shepherd?", "correct": "The LORD", "wrong": ["King Saul", "His father Jesse", "The prophet Samuel"], "verses": [1], "note": null}

Plain text everywhere: no markdown, no quotation marks around whole answers, no dashes.

The question must never contain its own answer.`;
}

function plain(text: string): string {
	return stripDashes(text.replace(/\s+/g, " ").trim());
}

export class MemoryQuestionsUnavailableError extends Error {}

/**
 * Write and validate questions for one unit. `verses` are the unit's verses,
 * in order, in the card's translation.
 */
export async function writeMemoryQuestions(options: {
	userId: string;
	range: PassageRange;
	translation: TranslationId;
	verses: { verse: number; text: string }[];
}): Promise<{ questions: QuizQuestion[]; model: string; dropped: string[] }> {
	const { userId, range, translation, verses } = options;
	const meta = bookByOrder(range.book);
	if (!meta) throw new MemoryQuestionsUnavailableError("Unknown book.");
	const reference = rangeReference(meta.name, range);
	const resolved = await resolveModel({ userId, modelId: null, effort: "low", structured: true });

	const { output } = await generateText({
		model: resolved.model,
		providerOptions: resolved.providerOptions,
		output: Output.object({ schema }),
		instructions: `${systemPrompt}\n\n${task(reference, translation)}`,
		prompt: [`${reference} (${translation}):`, ...verses.map((verse) => `${verse.verse} ${verse.text}`)].join("\n"),
		abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
	});
	if (!output) throw new MemoryQuestionsUnavailableError("The model returned no questions.");

	// Quiz me validates against a whole chapter; only this unit's verses carry text here.
	const chapterVerses: string[] = new Array(range.end).fill("");
	for (const verse of verses) chapterVerses[verse.verse - 1] = verse.text;
	const context = { book: range.book, chapter: range.chapter, bookName: meta.name, verses: chapterVerses };

	const passage = verses.map((verse) => verse.text).join(" ");
	const valid: QuizQuestion[] = [];
	const dropped: string[] = [];
	const answers = new Set<string>();
	output.questions.forEach((draft: DraftQuestion, index) => {
		if (draft.verses.some((verse) => verse < range.start || verse > range.end)) {
			dropped.push("bad_verses");
			return;
		}
		// Stricter than Quiz me, because this is a memory drill: a wrong answer
		// lifted from the verse blurs the very words being learned.
		if (draft.wrong.some((option) => { const overlap = overlapWithVerse(option, passage); return overlap.words > 0 && overlap.share === 1; })) {
			dropped.push("distractor_from_passage");
			return;
		}
		const asked = overlapWithVerse(draft.correct, draft.prompt);
		if (asked.words > 0 && asked.share === 1) {
			dropped.push("answer_in_question");
			return;
		}
		const result = validateDraft(
			{
				prompt: plain(draft.prompt),
				correct: plain(draft.correct),
				wrong: draft.wrong.map(plain),
				verses: draft.verses,
				note: null,
			},
			context,
			`m${index + 1}`,
		);
		if (!("question" in result)) {
			dropped.push(result.dropped);
			return;
		}
		// Two questions with one answer are one question asked twice.
		const key = answerKey(result.question.options[result.question.answerIndex]);
		if (answers.has(key)) {
			dropped.push("same_answer");
			return;
		}
		answers.add(key);
		valid.push(result.question);
	});
	if (dropped.length > 0) console.info(`[beta/memory] questions ${reference}: dropped ${dropped.join(",")}`);
	if (valid.length === 0) throw new MemoryQuestionsUnavailableError("No question survived the checks against the verse.");
	return { questions: valid.slice(0, KEEP), model: resolved.definition.id, dropped };
}
