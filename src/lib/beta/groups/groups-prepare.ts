import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel } from "@/lib/ai/provider";
import { systemPrompt } from "@/utils/systemPrompt";
import { checkPreparedDraft, type PreparedQuestions, type VerseView } from "@/lib/beta/groups/groups-rules";

/**
 * Discussion questions a group's leader prepares with SureWord's help
 * (LC-17656, docs/beta/groups.md), written only when a leader asks for them.
 *
 * The model is given the week's passage from the bundled KJV and drafts
 * questions in three movements (observe, interpret, apply), each tied to the
 * verses it rests on, plus a short note of background for the leader that is
 * labelled as SureWord's interpretation. `checkPreparedDraft` then drops any
 * draft whose verses are outside the passage or that quotes words the KJV text
 * does not hold, so Scripture is only ever quoted from the bundle. The leader
 * chooses which drafts reach the group, and may edit them first.
 */

/** Bump when the prompt or the checks change; stored with each preparation. */
export const GROUP_QUESTIONS_PROMPT_VERSION = 2;

const GENERATION_TIMEOUT_MS = 45_000;

// Every field is required: an OpenAI strict schema rejects `.optional()`.
const draftSchema = z.object({
	type: z.enum(["observe", "interpret", "apply"]).describe("observe: what the passage says; interpret: what it means in its context; apply: living it out this week"),
	text: z.string().describe("The question, one or two sentences, plain modern English, no quotation of Scripture unless copied exactly from the verses given"),
	verses: z.array(z.number().int().min(1)).max(6).describe("The verse numbers from the verses given that the question rests on, main one first"),
});

const schema = z.object({
	questions: z.array(draftSchema).min(6).max(10),
	leaderNote: z
		.string()
		.describe("Two to four sentences of background for the leader only: who wrote the passage, to whom, and where it sits in the book's argument, citing verse numbers. Paraphrase, never quote: no quotation marks. This is SureWord's interpretation, so write it as such."),
	topics: z.array(z.string()).min(1).max(4).describe("One to four short lowercase themes of the passage, like anger or listening"),
});

function task(reference: string): string {
	return `CURRENT TASK: A small group leader is preparing next week's meeting on ${reference} (KJV) and asked SureWord to help with discussion questions. You are given the verses. Write 7 to 9 questions on THESE verses for the group to discuss together, in three movements:

OBSERVE (2 or 3): what the passage plainly says. Who speaks, to whom, what is commanded, promised or warned, which words repeat, what comes first and what follows. A careful reader answers them from the verses alone.
INTERPRET (2 or 3): what the passage means in its context. The group answers them from the text and the surrounding Scripture, so ask, never assert: no question may smuggle in a doctrine as fact. They are labelled as interpretation questions in the app.
APPLY (2 or 3): living it out this week. Personal and concrete, but safe for a group: never ask anyone to confess private sins aloud or to say how they voted, spent or sinned. Invite, do not pry.

GOOD QUESTIONS:
- Open, not yes or no. One question at a time; never two questions joined by "and".
- Anchored in these verses: name the verse ("In verse 19, ...") rather than quoting it. SureWord shows the KJV text beside each question itself, so never quote Scripture from memory. If you must name a phrase, copy it exactly from the verses given, inside double quotation marks.
- Faithful and reverent: Scripture is the inerrant Word of God. Do not question, soften or reinterpret it, and do not invent background the text does not give.
- "verses": the verse numbers from the verses given that the question rests on.

THE LEADER'S NOTE ("leaderNote"): two to four sentences of background for the leader, never shown to the group as Scripture: who wrote it, to whom, and where it sits in the argument of the book, citing verse numbers. That background comes from verses outside this passage (James 1:1, say), so paraphrase it and give the verse number: never put any words of the note in quotation marks. Label it plainly as context, and keep to what the Bible itself says about the book.

"topics": one to four short lowercase themes of the passage.

Plain text everywhere: no markdown, no dashes, no numbering.`;
}

function plain(text: string): string {
	return stripDashes(text.replace(/\s+/g, " ").trim());
}

export class GroupQuestionsUnavailableError extends Error {}

/** Draft and check one week's questions. `verses` are the passage's verses, in order, from the bundled KJV. */
export async function prepareGroupQuestions(options: { userId: string; reference: string; verses: VerseView[] }): Promise<PreparedQuestions & { dropped: string[] }> {
	const { userId, reference, verses } = options;
	if (verses.length === 0) throw new GroupQuestionsUnavailableError("The passage has no verses.");
	const resolved = await resolveModel({ userId, modelId: null, effort: "low", structured: true });
	const { output } = await generateText({
		model: resolved.model,
		providerOptions: resolved.providerOptions,
		output: Output.object({ schema }),
		instructions: `${systemPrompt}\n\n${task(reference)}`,
		prompt: [`${reference} (KJV):`, ...verses.map((verse) => `${verse.verse} ${verse.text}`)].join("\n"),
		abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
	});
	if (!output) throw new GroupQuestionsUnavailableError("The model returned no questions.");
	const checked = checkPreparedDraft(
		{
			questions: output.questions.map((question) => ({ type: question.type, text: plain(question.text), verses: question.verses })),
			leaderNote: plain(output.leaderNote) || null,
			topics: output.topics,
		},
		{ first: verses[0].verse, last: verses[verses.length - 1].verse, text: verses.map((verse) => verse.text).join(" ") },
	);
	if (!checked) throw new GroupQuestionsUnavailableError("Too few of SureWord's questions held up against the passage. Try again.");
	if (checked.dropped.length > 0) console.info(`[beta/groups] questions ${reference}: dropped ${checked.dropped.join(",")}`);
	return {
		questions: checked.questions,
		leaderNote: checked.leaderNote,
		topics: checked.topics,
		model: `${resolved.definition.id}@v${GROUP_QUESTIONS_PROMPT_VERSION}`,
		generatedAt: new Date().toISOString(),
		dropped: checked.dropped,
	};
}
