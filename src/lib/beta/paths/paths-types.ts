/**
 * Learning Paths (LC-17648, docs/beta/paths.md): the shape of a path, as it
 * is written once at build time (`content/*.ts`) and as a personal curriculum
 * is generated on request, and the progress a founder keeps in the shared
 * study store (`BetaItem`, module `paths`).
 *
 * Content never carries Scripture text. Every passage is a reference
 * ("Romans 3:21-26") resolved against the bundled KJV when a lesson is
 * served, so the words a founder reads and is answered with are always the
 * KJV's own (`content-rules.ts` checks every answer against them).
 *
 * No imports on purpose: the content files and the tests load this with
 * Node's type stripping.
 */

/** 1 lays the foundation, 2 is the core of the lesson, 3 goes deeper. */
export type PathLevel = 1 | 2 | 3;

export type ExerciseType = "choice" | "blank" | "order" | "match";

export const EXERCISE_TYPES: readonly ExerciseType[] = ["choice", "blank", "order", "match"];

interface ExerciseBase {
	/** Unique across every path: "<lesson id>.<n>", like "romans-03.2". */
	id: string;
	/** Short lowercase label of the truth it tests ("justification"). Mastery is kept per concept. */
	concept: string;
	level: PathLevel;
}

/** Multiple choice. `correct` is in the words of the `answer` verse. */
export interface ChoiceExercise extends ExerciseBase {
	type: "choice";
	prompt: string;
	correct: string;
	/** Exactly three, each clearly not what the verse says. */
	wrong: string[];
	/** The verse (or up to three verses) that answers it: "Romans 3:23". */
	answer: string;
	/** One sentence on why it matters, shown under the verse. Teaching, not Scripture. */
	note?: string;
}

/** Fill in the blank: the `answer` verse with `word` taken out, chosen from four. */
export interface BlankExercise extends ExerciseBase {
	type: "blank";
	/** One verse. */
	answer: string;
	/** One to three words exactly as the verse has them, appearing once in it. */
	word: string;
	/** Exactly three other words to choose from. */
	wrong: string[];
}

/** Put the events (or the steps of the argument) in order. */
export interface OrderExercise extends ExerciseBase {
	type: "order";
	prompt: string;
	/** Three to five steps, in the right order, each in the words of its own verse. */
	steps: { text: string; answer: string }[];
}

/** Match each verse to the truth it states. */
export interface MatchExercise extends ExerciseBase {
	type: "match";
	prompt: string;
	/** Three or four pairs; each truth is in the words of its verse. */
	pairs: { answer: string; truth: string }[];
}

export type PathExercise = ChoiceExercise | BlankExercise | OrderExercise | MatchExercise;

export interface PathLesson {
	/** "<path id>-NN" for written paths; stable, it is what progress is keyed on. */
	id: string;
	title: string;
	/** One line on the path map. */
	summary: string;
	/** The short reading, one chapter: "John 1:1-14". */
	reading: string;
	/** Two to four sentences of teaching on the reading. Shown labelled as teaching, never as Scripture. */
	teaching: string;
	/** The verse to carry, offered to Learn a verse. */
	keyVerse: string;
	/** The pool the adaptive session draws from (seven to ten). */
	exercises: PathExercise[];
	/** The written reflection that closes the lesson. */
	reflection: { prompt: string; answer: string };
	/** Personal curricula only: the concept the lesson teaches, known before its questions are written. */
	concept?: string;
}

export interface PathUnit {
	id: string;
	title: string;
	summary: string;
	lessons: PathLesson[];
}

export type PathAudience = "Beginner friendly" | "Growing" | "Going deeper";

/** What the path suggests reading alongside it, through Reading plans. */
export type PathReadAlong =
	| { kind: "preset"; presetKey: string; label: string }
	| { kind: "goal"; goal: string; days: number; label: string };

export interface PathDef {
	/** URL segment: /beta/learn/paths/<id>. */
	id: string;
	title: string;
	tagline: string;
	/** Two or three sentences on the path page. */
	description: string;
	audience: PathAudience;
	/** Lowercase topics, for the study store. */
	topics: string[];
	readAlong: PathReadAlong | null;
	units: PathUnit[];
}

/* -------------------------------------------------------------------------
 * Progress, kept in BetaItem.data (module "paths")
 * ---------------------------------------------------------------------- */

/** How well one concept has been shown: strength 0-5, right and wrong counts, last seen. */
export interface ConceptStat {
	s: number;
	r: number;
	w: number;
	at: string;
}

/** kind "learner": one per founder, shared by every path, so mastery carries across them. */
export interface LearnerData {
	v: 1;
	concepts: Record<string, ConceptStat>;
}

export interface SessionScore {
	at: string;
	/** Answered right the first time. */
	right: number;
	total: number;
}

/** A question answered wrong the first time; it comes back until it is answered right. */
export interface ReviewEntry {
	ex: string;
	lesson: string;
	at: string;
	misses: number;
}

export type SessionKind = "lesson" | "review" | "checkpoint";

export interface SessionAnswer {
	ex: string;
	ok: boolean;
	/** The second try at a question missed earlier in the same session. */
	retry: boolean;
}

/** The session in progress, so a founder can leave and pick up at the same question. */
export interface ActiveSession {
	id: string;
	kind: SessionKind;
	/** Lesson id, unit id (checkpoint) or "" (review). */
	target: string;
	/** Exercise ids in the order they are asked; a miss is asked again once at the end. */
	queue: string[];
	/** Exercise ids that came from earlier lessons' misses. */
	fromReview: string[];
	index: number;
	answers: SessionAnswer[];
	startedAt: string;
}

/** kind "enrollment": one per path a founder has started. */
export interface EnrollmentData {
	v: 1;
	pathId: string;
	startedAt: string;
	lessons: Record<string, SessionScore>;
	checkpoints: Record<string, SessionScore>;
	review: ReviewEntry[];
	active: ActiveSession | null;
	lastLesson: string | null;
}
