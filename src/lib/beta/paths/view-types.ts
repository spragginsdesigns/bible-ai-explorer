/**
 * What the Learning Paths pages and API hand the browser (LC-17648). Only the
 * lesson being taken reaches the client; the written content stays on the
 * server. Scripture text in these views is always the bundled KJV's.
 */
import type { ExerciseType, PathAudience, PathLevel, PathReadAlong, SessionKind, SessionScore } from "./paths-types";
import type { ConceptState, LessonState } from "./progress-rules";

export interface VerseView {
	/** "Romans 3:23" or "Romans 3:23-24". */
	ref: string;
	text: string;
	book: number;
	chapter: number;
	/** The first verse of the reference. */
	verse: number;
}

export interface ExerciseView {
	id: string;
	type: ExerciseType;
	concept: string;
	level: PathLevel;
	/** Missed in an earlier lesson and back for another try. */
	fromReview: boolean;
	prompt: string;
	/** choice and blank: the options in their seeded order, and the right one. */
	options?: string[];
	answerIndex?: number;
	/** blank: the verse around the missing words. */
	blank?: { ref: string; before: string; after: string };
	/** order: the steps as shown, and for each shown step its place in the right order. */
	items?: string[];
	itemPlaces?: number[];
	/** match: the verse references in pair order, the truths as shown, and for each shown truth its pair. */
	verses?: string[];
	truths?: string[];
	truthPairs?: number[];
	/** The verse or verses that answer it, shown after every answer, right or wrong. */
	answers: (VerseView & { label: string | null })[];
	/** Teaching on why it matters, labelled as such. */
	note: string | null;
}

export interface SessionView {
	pathId: string;
	pathTitle: string;
	sessionId: string;
	kind: SessionKind;
	target: string;
	/** "Who is God?", "Unit 1 checkpoint" or "Review". */
	title: string;
	queue: string[];
	index: number;
	/** Distinct questions in the session (retries not counted). */
	total: number;
	exercises: Record<string, ExerciseView>;
	reading: { ref: string; book: number; chapter: number; verses: { n: number; text: string }[]; teaching: string } | null;
	keyVerse: VerseView | null;
	reflection: { prompt: string; verse: VerseView } | null;
	/** The session was already under way and picks up at `index`. */
	resumed: boolean;
}

export interface AnswerResult {
	correct: boolean;
	/** For order and match, right or wrong per place. */
	parts: boolean[];
	/** The question will be asked again at the end of this session. */
	again: boolean;
	queue: string[];
	index: number;
	finished: SessionSummary | null;
}

export interface SessionSummary {
	kind: SessionKind;
	target: string;
	score: SessionScore;
	concepts: { concept: string; state: ConceptState }[];
	reviewCount: number;
	next: { id: string; title: string } | null;
	pathDone: boolean;
}

export interface LessonNodeView {
	id: string;
	number: number;
	title: string;
	summary: string;
	reading: string;
	state: LessonState;
	score: SessionScore | null;
	/** Curriculum lessons are written the first time they are opened. */
	written: boolean;
}

export interface UnitNodeView {
	id: string;
	title: string;
	summary: string;
	lessons: LessonNodeView[];
	checkpoint: "locked" | "open" | "done";
	checkpointScore: SessionScore | null;
}

export interface PathCardView {
	id: string;
	title: string;
	tagline: string;
	audience: PathAudience;
	lessonCount: number;
	done: number;
	percent: number;
	started: boolean;
	/** Personal curriculum, built around a topic the founder asked for. */
	personal: boolean;
	topic: string | null;
	next: { id: string; title: string; number: number } | null;
	resume: { kind: SessionKind; target: string; title: string; at: number; of: number } | null;
	reviewCount: number;
	updatedAt: string | null;
}

export interface PathPageView extends PathCardView {
	description: string;
	units: UnitNodeView[];
	concepts: { concept: string; state: ConceptState; comingBack: boolean }[];
	readAlong: PathReadAlong | null;
}
