/**
 * Mirror of `src/lib/quiz-contract.ts`, the shape `POST /api/quiz` returns and
 * `POST /api/quiz/attempt` accepts. The mobile tree sits outside the web
 * tsconfig and cannot import it, so the types are copied here;
 * `quizView.test.ts` pins the constants against the web file. Change both
 * together (and `macos/Shared/Quiz/QuizModels.swift`).
 */

/**
 * How a chapter is asked. Seeking: who, what, where, and what Jesus said.
 * Growing: what a verse teaches and how the chapter fits together. Never shown
 * to the reader as a label on themselves.
 */
export type QuizDepth = "seeking" | "growing";

export const QUIZ_DEPTHS: readonly QuizDepth[] = ["seeking", "growing"];

/** Questions in one quiz. A short chapter can come back with fewer. */
export const QUIZ_LENGTH = 5;

/** Answer choices per question. */
export const QUIZ_OPTION_COUNT = 4;

export interface QuizQuestion {
	/** Stable within the quiz ("q1".."q5"), for keys and attempt records. */
	id: string;
	prompt: string;
	/** Exactly `QUIZ_OPTION_COUNT` distinct choices, already in display order. */
	options: string[];
	/** Index into `options` of the right answer. */
	answerIndex: number;
	/** Verse numbers in this chapter the answer comes from, ascending, first is primary. */
	verses: number[];
	/** "John 3:3" or "John 3:3-5". */
	reference: string;
	/** The KJV text of `verses`, from the bundled Bible, never from the model. */
	verseText: string;
	/** One short sentence on why, or null. Shown under the verse. */
	note: string | null;
}

/** The closing card: one verse to carry and one question to answer in a note. */
export interface QuizReflection {
	verse: number;
	reference: string;
	verseText: string;
	prompt: string;
}

export interface ChapterQuiz {
	book: number;
	chapter: number;
	bookName: string;
	/** "John 3". */
	title: string;
	depth: QuizDepth;
	/** The depth this reader gets when they do not choose; clients preselect it. */
	suggestedDepth: QuizDepth;
	questions: QuizQuestion[];
	reflection: QuizReflection | null;
	model: string | null;
	cached: boolean;
}

/** `POST /api/quiz/attempt` body. Coordinates and counts, never text. */
export interface QuizAttemptInput {
	book: number;
	chapter: number;
	depth: QuizDepth;
	total: number;
	correct: number;
	/** Verse numbers of the questions answered wrong, so they can come back. */
	missedVerses: number[];
}
