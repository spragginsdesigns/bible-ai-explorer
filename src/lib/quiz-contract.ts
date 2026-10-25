/**
 * The shape every client renders for "Quiz me" (docs/quiz/PLAN.md and
 * docs/FEATURES.md, "Quiz me"). This file is the contract between
 * `POST /api/quiz`, `POST /api/quiz/attempt` and the Android, web and Apple
 * clients; it carries no runtime imports so the plain-node logic tests and
 * the mobile tree can both read it.
 *
 * Mirrored in `mobile/src/features/quiz/quizContract.ts` (TypeScript) and
 * `macos/Shared/Quiz/QuizModels.swift` (Codable). Change all three together.
 */

/**
 * How a chapter is asked. Seeking: who, what, where, and what Jesus said, for
 * someone still finding their way. Growing: what a verse teaches and how the
 * chapter fits together. The default is chosen from what SureWord knows about
 * the reader and is never shown to them as a label on themselves.
 */
export type QuizDepth = "seeking" | "growing";

export const QUIZ_DEPTHS: readonly QuizDepth[] = ["seeking", "growing"];

/** Questions in one quiz. The bank holds more so validation can drop some. */
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
