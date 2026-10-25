import { generateText, Output } from "ai";
import { z } from "zod";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel, type ResolvedModel } from "@/lib/ai/provider";
import { bookByOrder } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { prisma } from "@/lib/prisma";
import {
	QUIZ_LENGTH,
	type ChapterQuiz,
	type QuizAttemptInput,
	type QuizDepth,
	type QuizQuestion,
	type QuizReflection,
} from "@/lib/quiz-contract";
import {
	defaultDepthFromProfile,
	formatReference,
	selectQuestions,
	validateDraft,
	type DraftQuestion,
	type DropReason,
	type ValidationContext,
} from "@/lib/quiz-rules";
import { systemPrompt } from "@/utils/systemPrompt";

/**
 * Bump whenever the prompt or the validation rules change. Banks are keyed on
 * it, so old ones stop matching and the next reader regenerates.
 */
export const QUIZ_PROMPT_VERSION = 1;

/** Drafts asked for; validation keeps the best `QUIZ_LENGTH`. */
const DRAFT_COUNT = 8;

/** The fewest questions worth serving when a chapter is too short for five. */
const MIN_QUESTIONS = 3;

/** The route's budget is 60 s; leave room for the cache write and the response. */
const GENERATION_TIMEOUT_MS = 40_000;

/* -------------------------------------------------------------------------
 * The model's half
 * ---------------------------------------------------------------------- */

// Every field is required, with nullable for "none": an OpenAI strict schema
// rejects `.optional()` outright.
const draftSchema = z.object({
	prompt: z.string().describe("The question, one sentence, plain modern English"),
	correct: z.string().describe("The right answer, short, in the verse's own words"),
	wrong: z
		.array(z.string())
		.length(3)
		.describe("Three wrong answers, short, plausible, clearly not what the verse says"),
	verses: z
		.array(z.number().int().min(1))
		.min(1)
		.max(3)
		.describe("Verse numbers in this chapter that answer it, the main one first"),
	note: z
		.string()
		.nullable()
		.describe("One short sentence on why it matters, or null"),
});

const quizSchema = z.object({
	questions: z.array(draftSchema).min(MIN_QUESTIONS),
	reflection: z.object({
		verse: z.number().int().min(1).describe("The chapter's central verse"),
		prompt: z.string().describe("One personal question about that verse, at most 25 words"),
	}),
});

const DEPTH_BRIEF: Record<QuizDepth, string> = {
	seeking:
		"DEPTH: FOUNDATIONS. The reader may be new to the Bible or still seeking God. Ask what happened, who said it, who it was said to, where, and above all what Jesus or God said. Plain words, no church vocabulary they would have to look up, no doctrine they must already hold to answer.",
	growing:
		"DEPTH: GOING DEEPER. The reader knows the Bible's outline. Ask what a verse teaches, why a statement matters, how two verses in the chapter answer each other, and what the passage reveals about God, about Christ, about sin and salvation, or about how to walk with Him. Every answer must still be stated in the chapter's own words.",
};

const TASK = `CURRENT TASK: The user just finished reading a chapter of their King James Bible and asked to be quizzed on it. You are given the whole chapter, verse by verse. Write ${DRAFT_COUNT} multiple-choice questions on THIS chapter and nothing else, then one reflection.

The point is not trivia. Each question should send the reader back to a verse that matters, so that every answer, right or wrong, ends with them reading Scripture again.

RULES FOR QUESTIONS:
- Walk through the chapter: spread the questions from beginning to end, at most two on any one verse, and favour the verses that carry the chapter's meaning over incidental details.
- "correct" must be what the verse says, using the verse's own key words (short: at most 12 words). Never a paraphrase that drops the verse's words, never an interpretation the verse does not state.
- "wrong" are three answers that are plausible to someone who skimmed, each short, each clearly NOT what the cited verse says. Draw them from other parts of Scripture, from common misunderstandings, or from details of the chapter that answer a different question. Never put a wrong answer that is also true according to the chapter. Never "all of the above", "none of the above", or jokes.
- All four choices must look alike: the same grammatical form and roughly the same length, so the right one cannot be spotted by its length or its old-English wording. If the right answer quotes the verse, phrase the wrong ones in the same style.
- "verses": the verse numbers that state the answer, main verse first, at most three.
- Never ask about verse numbers, chapter numbers, or word counts. Never a trick question, never a negative ("which is NOT").
- "note": optional, at most 25 words, why this truth matters for the reader's walk with God; null when the verse speaks for itself.
- Faithful and reverent: the KJV is the inerrant Word of God. Do not question, soften, or reinterpret it.

REFLECTION: choose the chapter's central verse and ask one personal, gentle question (at most 25 words) that helps the reader carry it into today. Speak to "you". Do not assume they are saved or unsaved.

Plain text everywhere: no markdown, no quotation marks around whole answers, no dashes.`;

function chapterGrounding(title: string, verses: string[]): string {
	return [`${title} (KJV), verse by verse:`, ...verses.map((text, index) => `${index + 1} ${text}`)].join("\n");
}

/* -------------------------------------------------------------------------
 * Cache
 * ---------------------------------------------------------------------- */

interface BankKey {
	book: number;
	chapter: number;
	depth: QuizDepth;
}

interface BankBody {
	questions: QuizQuestion[];
	reflection: QuizReflection | null;
	model: string | null;
}

/** The cached bank, or null. A database failure is a miss, never an error. */
export async function readQuizBank(key: BankKey): Promise<BankBody | null> {
	try {
		const row = await prisma.quizBank.findUnique({
			where: { book_chapter_depth_promptVersion: { ...key, promptVersion: QUIZ_PROMPT_VERSION } },
			select: { data: true, model: true },
		});
		if (!row) return null;
		const parsed: unknown = JSON.parse(row.data);
		if (typeof parsed !== "object" || parsed === null) return null;
		const body = parsed as Partial<BankBody>;
		if (!Array.isArray(body.questions) || body.questions.length < MIN_QUESTIONS) return null;
		return { questions: body.questions, reflection: body.reflection ?? null, model: row.model };
	} catch (error) {
		console.error("quiz bank read failed:", error);
		return null;
	}
}

/** Store a bank; a concurrent duplicate is a no-op rather than an error. */
export async function writeQuizBank(key: BankKey, body: BankBody): Promise<void> {
	try {
		await prisma.quizBank.createMany({
			data: {
				...key,
				promptVersion: QUIZ_PROMPT_VERSION,
				data: JSON.stringify({ questions: body.questions, reflection: body.reflection }),
				model: body.model,
			},
			skipDuplicates: true,
		});
	} catch (error) {
		console.error("quiz bank write failed:", error);
	}
}

/* -------------------------------------------------------------------------
 * Generation
 * ---------------------------------------------------------------------- */

export class QuizUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QuizUnavailableError";
	}
}

/** The chapter's verses as plain KJV text. Throws on a chapter the KJV does not have. */
async function chapterVerses(book: number, chapter: number): Promise<string[]> {
	return (await getKjvChapter(book, chapter)).map((raw) => bibleVersePlainText(raw).trim());
}

function plain(text: string): string {
	return stripDashes(text.replace(/\s+/g, " ").trim());
}

/**
 * Write and validate a quiz for one chapter at one depth. Questions the
 * chapter does not support are dropped (`quiz-rules.ts`); the verse text on
 * every question comes from the bundled KJV. Returns null when the book or
 * chapter does not exist.
 */
export async function generateChapterQuiz(options: {
	book: number;
	chapter: number;
	depth: QuizDepth;
	resolved: ResolvedModel;
}): Promise<(BankBody & { complete: boolean }) | null> {
	const { book, chapter, depth, resolved } = options;
	const meta = bookByOrder(book);
	if (!meta || chapter < 1 || chapter > meta.chapters) return null;
	const verses = await chapterVerses(book, chapter);
	const title = `${meta.name} ${chapter}`;

	const { output } = await generateText({
		model: resolved.model,
		providerOptions: resolved.providerOptions,
		output: Output.object({ schema: quizSchema }),
		instructions: `${systemPrompt}\n\n${TASK}\n\n${DEPTH_BRIEF[depth]}`,
		prompt: chapterGrounding(title, verses),
		abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
	});
	if (!output) throw new QuizUnavailableError("The model returned no quiz.");

	const ctx: ValidationContext = { book, chapter, bookName: meta.name, verses };
	const valid: QuizQuestion[] = [];
	const dropped: DropReason[] = [];
	output.questions.forEach((draft: DraftQuestion, index) => {
		const result = validateDraft(
			{
				prompt: plain(draft.prompt),
				correct: plain(draft.correct),
				wrong: draft.wrong.map(plain),
				verses: draft.verses,
				note: draft.note ? plain(draft.note) : null,
			},
			ctx,
			`d${index + 1}`
		);
		if ("question" in result) valid.push(result.question);
		else dropped.push(result.dropped);
	});
	if (dropped.length > 0) console.info(`quiz ${title} ${depth}: dropped ${dropped.join(",")}`);
	if (valid.length < MIN_QUESTIONS) {
		throw new QuizUnavailableError(`Only ${valid.length} questions survived validation.`);
	}

	const reflectionVerse = output.reflection.verse;
	const reflectionPrompt = plain(output.reflection.prompt);
	const reflection: QuizReflection | null =
		reflectionVerse >= 1 && reflectionVerse <= verses.length && reflectionPrompt && reflectionPrompt.length <= 200
			? {
					verse: reflectionVerse,
					reference: formatReference(meta.name, chapter, [reflectionVerse]),
					verseText: verses[reflectionVerse - 1],
					prompt: reflectionPrompt,
				}
			: null;

	const questions = selectQuestions(valid, QUIZ_LENGTH);
	return {
		questions,
		reflection,
		model: resolved.definition.id,
		complete: questions.length === QUIZ_LENGTH,
	};
}

/** The model for a quiz: the user's pick at low effort, structured, like the word study. */
export function resolveQuizModel(userId: string, modelId: string | null): Promise<ResolvedModel> {
	return resolveModel({ userId, modelId, effort: "low", structured: true });
}

/** Assemble the response from a bank body. */
export function chapterQuiz(
	key: BankKey,
	body: BankBody,
	suggestedDepth: QuizDepth,
	cached: boolean
): ChapterQuiz {
	const meta = bookByOrder(key.book);
	const bookName = meta?.name ?? `Book ${key.book}`;
	return {
		book: key.book,
		chapter: key.chapter,
		bookName,
		title: `${bookName} ${key.chapter}`,
		depth: key.depth,
		suggestedDepth,
		questions: body.questions,
		reflection: body.reflection,
		model: body.model,
		cached,
	};
}

/* -------------------------------------------------------------------------
 * The reader
 * ---------------------------------------------------------------------- */

/**
 * The depth this reader gets by default, from their own words: About me, and
 * their profile memories when memory is on. Any failure reads as "growing".
 */
export async function suggestedQuizDepth(userId: string): Promise<QuizDepth> {
	try {
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { aboutMe: true, memoryEnabled: true },
		});
		if (!user) return "growing";
		const texts: string[] = user.aboutMe ? [user.aboutMe] : [];
		if (user.memoryEnabled) {
			const memories = await prisma.userMemory.findMany({
				where: { userId, category: "profile" },
				select: { content: true },
				take: 40,
			});
			texts.push(...memories.map((memory) => memory.content));
		}
		return defaultDepthFromProfile(texts);
	} catch (error) {
		console.error("quiz depth lookup failed:", error);
		return "growing";
	}
}

/** Record a finished quiz. Coordinates and counts only. */
export async function recordQuizAttempt(userId: string, attempt: QuizAttemptInput): Promise<string> {
	const row = await prisma.quizAttempt.create({
		data: {
			userId,
			book: attempt.book,
			chapter: attempt.chapter,
			depth: attempt.depth,
			total: attempt.total,
			correct: attempt.correct,
			missedVerses: attempt.missedVerses,
		},
		select: { id: true },
	});
	return row.id;
}

/**
 * The verses a reader recently missed in a quiz, newest first, for the study
 * context ("came back to a verse that did not stick"). At most `limit`.
 */
export async function recentQuizMisses(
	userId: string,
	limit = 3
): Promise<{ reference: string; finishedAt: Date }[]> {
	const rows = await prisma.quizAttempt.findMany({
		where: { userId, NOT: { missedVerses: { isEmpty: true } } },
		orderBy: { createdAt: "desc" },
		take: 5,
		select: { book: true, chapter: true, missedVerses: true, createdAt: true },
	});
	const misses: { reference: string; finishedAt: Date }[] = [];
	for (const row of rows) {
		const meta = bookByOrder(row.book);
		if (!meta) continue;
		for (const verse of row.missedVerses) {
			if (misses.length >= limit) return misses;
			misses.push({ reference: formatReference(meta.name, row.chapter, [verse]), finishedAt: row.createdAt });
		}
	}
	return misses;
}
