/**
 * Pure rules for a founder's progress through Learning Paths (LC-17648,
 * docs/beta/paths.md): which questions a session asks, how an answer is
 * graded, what it does to mastery and to the review list, and what the path
 * map shows as done, current and locked.
 *
 * Adaptive, without hearts or penalties:
 * - Mastery is kept per concept (0-5) across every path. A concept someone is
 *   still learning gets the foundational questions; one they have mastered
 *   gets the deeper ones, and its level 1 questions are skipped.
 * - A question missed the first time is asked again at the end of the same
 *   session, goes on the review list, and comes back in later lessons until
 *   it is answered right. Nothing is ever lost or locked by a wrong answer.
 *
 * Option order is seeded by Quiz me's `arrangeOptions`/`seedHash`, passed in
 * as `Arrange` so this file has no imports and the tests load it with Node's
 * type stripping.
 */
import type {
	ActiveSession,
	ConceptStat,
	EnrollmentData,
	ExerciseType,
	LearnerData,
	MatchExercise,
	OrderExercise,
	PathDef,
	PathExercise,
	PathLesson,
	PathLevel,
	ReviewEntry,
	SessionAnswer,
	SessionKind,
	SessionScore,
} from "./paths-types";

/** Graded questions in one lesson. */
export const LESSON_SIZE = 6;
/** Earlier misses mixed into a lesson. */
export const REVIEW_IN_LESSON = 2;
/** Questions in a unit checkpoint. */
export const CHECKPOINT_SIZE = 8;
/** Questions in one review session. */
export const REVIEW_SESSION_SIZE = 8;
/** Questions in a course's final review (SureWord Academy, LC-17660), shared out across its units. */
export const FINAL_SIZE = 12;
/** Misses kept on the review list, oldest dropped first. */
export const REVIEW_MAX = 60;
export const MAX_STRENGTH = 5;
export const MASTERED_STRENGTH = 4;

const TYPES: readonly ExerciseType[] = ["choice", "blank", "order", "match"];

export interface Arrange {
	arrangeOptions: (correct: string, wrong: string[], seed: string) => { options: string[]; answerIndex: number };
	seedHash: (seed: string) => number;
}

/* -------------------------------------------------------------------------
 * Mastery
 * ---------------------------------------------------------------------- */

export type ConceptState = "new" | "learning" | "growing" | "mastered";

export function conceptState(stat: ConceptStat | undefined): ConceptState {
	if (!stat || stat.r + stat.w === 0) return "new";
	if (stat.s >= MASTERED_STRENGTH) return "mastered";
	if (stat.s >= 2) return "growing";
	return "learning";
}

/** The level a concept is asked at: foundations until it is shown, deeper once it is mastered. */
export function targetLevel(stat: ConceptStat | undefined): PathLevel {
	const strength = stat?.s ?? 0;
	if (strength >= MASTERED_STRENGTH) return 3;
	if (strength >= 2) return 2;
	return 1;
}

/** A first-try answer moves the concept up one, a miss moves it down two. */
export function updateConcept(stat: ConceptStat | undefined, ok: boolean, now: string): ConceptStat {
	const base = stat ?? { s: 0, r: 0, w: 0, at: now };
	return ok
		? { s: Math.min(MAX_STRENGTH, base.s + 1), r: base.r + 1, w: base.w, at: now }
		: { s: Math.max(0, base.s - 2), r: base.r, w: base.w + 1, at: now };
}

/* -------------------------------------------------------------------------
 * Choosing the questions
 * ---------------------------------------------------------------------- */

function fit(ex: PathExercise, concepts: Record<string, ConceptStat>): number {
	const stat = concepts[ex.concept];
	const distance = Math.abs(ex.level - targetLevel(stat));
	// Mastered ones advance: their first rung is only asked when nothing else is left.
	return conceptState(stat) === "mastered" && ex.level === 1 ? distance + 3 : distance;
}

/**
 * The `size` questions a session asks from `pool`: one of each exercise type
 * first (so every lesson has its choice, blank, order and match), each the
 * best fit for what the founder has shown; then the best fits of the rest,
 * weaker concepts first. Returned in the pool's own order, which is the order
 * the lesson was written to be read in.
 */
export function selectExercises(pool: readonly PathExercise[], concepts: Record<string, ConceptStat>, size: number): PathExercise[] {
	const ranked = pool
		.map((ex, index) => ({ ex, index, fit: fit(ex, concepts), weak: concepts[ex.concept]?.s ?? 0 }))
		.sort((a, b) => a.fit - b.fit || a.weak - b.weak || a.index - b.index);
	const chosen = new Set<number>();
	for (const type of TYPES) {
		const best = ranked.find((entry) => entry.ex.type === type && !chosen.has(entry.index));
		if (best && chosen.size < size) chosen.add(best.index);
	}
	for (const entry of ranked) {
		if (chosen.size >= size) break;
		chosen.add(entry.index);
	}
	return [...chosen].sort((a, b) => a - b).map((index) => pool[index]);
}

/** Up to `max` earlier misses for a lesson, oldest first, never from the lesson itself. */
export function reviewPicks(review: readonly ReviewEntry[], lessonId: string, max: number, exists: (exerciseId: string) => boolean): string[] {
	return [...review]
		.filter((entry) => entry.lesson !== lessonId && exists(entry.ex))
		.sort((a, b) => a.at.localeCompare(b.at))
		.slice(0, max)
		.map((entry) => entry.ex);
}

export function lessonsOf(path: PathDef): PathLesson[] {
	return path.units.flatMap((unit) => unit.lessons);
}

export function exerciseIndex(path: PathDef): Map<string, { ex: PathExercise; lesson: PathLesson }> {
	const index = new Map<string, { ex: PathExercise; lesson: PathLesson }>();
	for (const lesson of lessonsOf(path)) for (const ex of lesson.exercises) index.set(ex.id, { ex, lesson });
	return index;
}

/** A new session: the questions it asks, in order, with no answers yet. */
export function buildSession(options: {
	id: string;
	now: string;
	path: PathDef;
	kind: SessionKind;
	target: string;
	learner: LearnerData;
	enrollment: EnrollmentData;
}): ActiveSession | null {
	const { path, kind, target, learner, enrollment } = options;
	const index = exerciseIndex(path);
	let queue: string[] = [];
	let fromReview: string[] = [];
	if (kind === "lesson") {
		const lesson = lessonsOf(path).find((entry) => entry.id === target);
		if (!lesson || lesson.exercises.length === 0) return null;
		queue = selectExercises(lesson.exercises, learner.concepts, LESSON_SIZE).map((ex) => ex.id);
		fromReview = reviewPicks(enrollment.review, lesson.id, REVIEW_IN_LESSON, (id) => index.has(id));
	} else if (kind === "checkpoint") {
		const unit = path.units.find((entry) => entry.id === target);
		if (!unit) return null;
		queue = selectExercises(unit.lessons.flatMap((lesson) => lesson.exercises), learner.concepts, CHECKPOINT_SIZE).map((ex) => ex.id);
	} else if (kind === "final") {
		// A course's final review asks from every unit, the first units taking any remainder.
		if (!path.course || path.units.length === 0) return null;
		const share = Math.floor(FINAL_SIZE / path.units.length);
		const extra = FINAL_SIZE % path.units.length;
		queue = path.units.flatMap((unit, place) =>
			selectExercises(unit.lessons.flatMap((lesson) => lesson.exercises), learner.concepts, share + (place < extra ? 1 : 0)).map((ex) => ex.id)
		);
	} else {
		fromReview = reviewPicks(enrollment.review, "", REVIEW_SESSION_SIZE, (id) => index.has(id));
	}
	const all = [...queue, ...fromReview];
	if (all.length === 0) return null;
	return { id: options.id, kind, target: kind === "review" || kind === "final" ? "" : target, queue: all, fromReview, index: 0, answers: [], startedAt: options.now };
}

/* -------------------------------------------------------------------------
 * Showing and grading a question
 * ---------------------------------------------------------------------- */

/** A seeded order of `count` items that is never the answer itself (when there is any other). */
export function scramble(count: number, seed: string, arrange: Arrange): number[] {
	const order = Array.from({ length: count }, (_, index) => index);
	for (let index = count - 1; index > 0; index -= 1) {
		const swap = arrange.seedHash(`${seed}:${index}`) % (index + 1);
		[order[index], order[swap]] = [order[swap], order[index]];
	}
	if (count > 1 && order.every((value, index) => value === index)) order.push(order.shift()!);
	return order;
}

/** Choice and blank options, in the same seeded order on the client and the server. */
export function arrangedOptions(ex: PathExercise, arrange: Arrange): { options: string[]; answerIndex: number } | null {
	if (ex.type === "choice") return arrange.arrangeOptions(ex.correct, ex.wrong, ex.id);
	if (ex.type === "blank") return arrange.arrangeOptions(ex.word, ex.wrong, ex.id);
	return null;
}

/** Shown position -> the step's place in the right order. */
export function orderDisplay(ex: OrderExercise, arrange: Arrange): number[] {
	return scramble(ex.steps.length, `${ex.id}:order`, arrange);
}

/** Shown position -> the pair the truth belongs to. Verses are shown in pair order. */
export function matchDisplay(ex: MatchExercise, arrange: Arrange): number[] {
	return scramble(ex.pairs.length, `${ex.id}:match`, arrange);
}

/**
 * What the founder answered:
 * - choice and blank: the shown option's index;
 * - order: the shown items' indexes in the order they were placed;
 * - match: for each verse, in pair order, the shown truth's index.
 */
export type ExerciseResponse = { choice: number } | { order: number[] } | { pairs: number[] };

function isPermutation(values: unknown, count: number): values is number[] {
	return Array.isArray(values) && values.length === count && values.every((value) => Number.isInteger(value) && value >= 0 && value < count) && new Set(values).size === count;
}

/** Right or wrong, with a right/wrong per place for order and match. Null when the response does not fit the question. */
export function gradeResponse(ex: PathExercise, response: unknown, arrange: Arrange): { ok: boolean; parts: boolean[] } | null {
	if (typeof response !== "object" || response === null) return null;
	const body = response as Record<string, unknown>;
	if (ex.type === "choice" || ex.type === "blank") {
		const arranged = arrangedOptions(ex, arrange)!;
		const choice = body.choice;
		if (!Number.isInteger(choice) || (choice as number) < 0 || (choice as number) >= arranged.options.length) return null;
		const ok = choice === arranged.answerIndex;
		return { ok, parts: [ok] };
	}
	if (ex.type === "order") {
		if (!isPermutation(body.order, ex.steps.length)) return null;
		const display = orderDisplay(ex, arrange);
		const parts = body.order.map((shown, place) => display[shown] === place);
		return { ok: parts.every(Boolean), parts };
	}
	if (!isPermutation(body.pairs, ex.pairs.length)) return null;
	const display = matchDisplay(ex, arrange);
	const parts = body.pairs.map((shown, pair) => display[shown] === pair);
	return { ok: parts.every(Boolean), parts };
}

/* -------------------------------------------------------------------------
 * Recording an answer
 * ---------------------------------------------------------------------- */

export interface AnswerOutcome {
	learner: LearnerData;
	enrollment: EnrollmentData;
	/** Set when this answer finished the session. */
	finished: { kind: SessionKind; target: string; score: SessionScore } | null;
	retry: boolean;
	/** The question will be asked again at the end of this session. */
	again: boolean;
}

function upsertReview(review: readonly ReviewEntry[], entry: Omit<ReviewEntry, "misses">): ReviewEntry[] {
	const existing = review.find((item) => item.ex === entry.ex);
	const rest = review.filter((item) => item.ex !== entry.ex);
	const next = [...rest, { ...entry, misses: (existing?.misses ?? 0) + 1 }];
	return next.length > REVIEW_MAX ? [...next].sort((a, b) => a.at.localeCompare(b.at)).slice(next.length - REVIEW_MAX) : next;
}

/**
 * Apply one graded answer to the active session. The caller has checked that
 * `exerciseId` is the session's current question.
 */
export function recordAnswer(options: {
	learner: LearnerData;
	enrollment: EnrollmentData;
	exercise: PathExercise;
	lessonId: string;
	ok: boolean;
	now: string;
}): AnswerOutcome {
	const { learner, enrollment, exercise, lessonId, ok, now } = options;
	const session = enrollment.active!;
	const retry = session.answers.some((answer) => answer.ex === exercise.id);
	const answers: SessionAnswer[] = [...session.answers, { ex: exercise.id, ok, retry }];
	const again = !ok && !retry;
	const queue = again ? [...session.queue, exercise.id] : session.queue;
	const concepts = retry ? learner.concepts : { ...learner.concepts, [exercise.concept]: updateConcept(learner.concepts[exercise.concept], ok, now) };
	let review = enrollment.review;
	if (!retry && !ok) review = upsertReview(review, { ex: exercise.id, lesson: lessonId, at: now });
	if (!retry && ok) review = review.filter((entry) => entry.ex !== exercise.id);
	const nextSession: ActiveSession = { ...session, queue, answers, index: session.index + 1 };
	let next: EnrollmentData = { ...enrollment, review, active: nextSession };
	let finished: AnswerOutcome["finished"] = null;
	if (nextSession.index >= nextSession.queue.length) {
		const first = answers.filter((answer) => !answer.retry);
		const score: SessionScore = { at: now, right: first.filter((answer) => answer.ok).length, total: first.length };
		finished = { kind: session.kind, target: session.target, score };
		next = {
			...next,
			active: null,
			lessons: session.kind === "lesson" ? { ...next.lessons, [session.target]: score } : next.lessons,
			checkpoints: session.kind === "checkpoint" ? { ...next.checkpoints, [session.target]: score } : next.checkpoints,
			lastLesson: session.kind === "lesson" ? session.target : next.lastLesson,
			...(session.kind === "final" ? { final: score } : {}),
		};
	}
	return { learner: { ...learner, concepts }, enrollment: next, finished, retry, again };
}

/* -------------------------------------------------------------------------
 * The path map
 * ---------------------------------------------------------------------- */

export type LessonState = "done" | "current" | "open" | "locked";

export interface LessonNode {
	id: string;
	unitId: string;
	number: number;
	title: string;
	summary: string;
	reading: string;
	state: LessonState;
	score: SessionScore | null;
}

export interface UnitNode {
	id: string;
	title: string;
	summary: string;
	lessons: LessonNode[];
	checkpoint: "locked" | "open" | "done";
	checkpointScore: SessionScore | null;
}

export interface PathProgress {
	units: UnitNode[];
	done: number;
	total: number;
	percent: number;
	/** The next lesson to take, or null when every lesson is done. */
	next: LessonNode | null;
	reviewCount: number;
	/** A course's final review (LC-17660): "none" on a path; it opens once every unit checkpoint is done. */
	final: "none" | "locked" | "open" | "done";
	finalScore: SessionScore | null;
}

/**
 * Lessons open one after another; a done lesson can always be taken again,
 * and a unit's checkpoint opens once all of its lessons are done.
 */
export function pathProgress(path: PathDef, enrollment: EnrollmentData | null): PathProgress {
	const done = (id: string) => Boolean(enrollment?.lessons[id]);
	let number = 0;
	let previousDone = true;
	let next: LessonNode | null = null;
	const units: UnitNode[] = path.units.map((unit) => {
		const lessons = unit.lessons.map((lesson) => {
			number += 1;
			const isDone = done(lesson.id);
			const state: LessonState = isDone ? "done" : previousDone ? (next ? "open" : "current") : "locked";
			const node: LessonNode = { id: lesson.id, unitId: unit.id, number, title: lesson.title, summary: lesson.summary, reading: lesson.reading, state, score: enrollment?.lessons[lesson.id] ?? null };
			if (state === "current") next = node;
			previousDone = isDone;
			return node;
		});
		const checkpointScore = enrollment?.checkpoints[unit.id] ?? null;
		const checkpoint = checkpointScore ? "done" : lessons.every((lesson) => lesson.state === "done") ? "open" : "locked";
		return { id: unit.id, title: unit.title, summary: unit.summary, lessons, checkpoint, checkpointScore };
	});
	const total = number;
	const index = exerciseIndex(path);
	const doneCount = units.reduce((sum, unit) => sum + unit.lessons.filter((lesson) => lesson.state === "done").length, 0);
	const finalScore = path.course ? (enrollment?.final ?? null) : null;
	const final = !path.course ? "none" : finalScore ? "done" : units.length > 0 && units.every((unit) => unit.checkpoint === "done") ? "open" : "locked";
	return {
		units,
		done: doneCount,
		total,
		percent: total ? Math.round((doneCount / total) * 100) : 0,
		next,
		reviewCount: enrollment?.review.filter((entry) => index.has(entry.ex)).length ?? 0,
		final,
		finalScore,
	};
}

/** Whether a session of this kind may start now. */
export function canStart(progress: PathProgress, kind: SessionKind, target: string): boolean {
	if (kind === "review") return progress.reviewCount > 0;
	if (kind === "final") return progress.final === "open" || progress.final === "done";
	if (kind === "checkpoint") return progress.units.some((unit) => unit.id === target && unit.checkpoint !== "locked");
	return progress.units.some((unit) => unit.lessons.some((lesson) => lesson.id === target && lesson.state !== "locked"));
}

/** The concepts a path teaches, with what the founder has shown of each. */
export function pathConcepts(path: PathDef, learner: LearnerData, enrollment: EnrollmentData | null): { concept: string; state: ConceptState; comingBack: boolean }[] {
	const index = exerciseIndex(path);
	const comingBack = new Set((enrollment?.review ?? []).map((entry) => index.get(entry.ex)?.ex.concept).filter(Boolean));
	// A curriculum lesson names its concept before its questions are written.
	const concepts = [...new Set(lessonsOf(path).flatMap((lesson) => [...(lesson.concept ? [lesson.concept] : []), ...lesson.exercises.map((ex) => ex.concept)]))];
	return concepts.map((concept) => ({ concept, state: conceptState(learner.concepts[concept]), comingBack: comingBack.has(concept) }));
}

/* -------------------------------------------------------------------------
 * Reading stored progress
 * ---------------------------------------------------------------------- */

const isString = (value: unknown): value is string => typeof value === "string";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readScore(value: unknown): SessionScore | null {
	if (!isRecord(value) || !isString(value.at) || !Number.isInteger(value.right) || !Number.isInteger(value.total)) return null;
	return { at: value.at, right: value.right as number, total: value.total as number };
}

function readScores(value: unknown): Record<string, SessionScore> {
	const out: Record<string, SessionScore> = {};
	if (!isRecord(value)) return out;
	for (const [key, raw] of Object.entries(value)) {
		const score = readScore(raw);
		if (score) out[key] = score;
	}
	return out;
}

function readSession(value: unknown): ActiveSession | null {
	if (!isRecord(value)) return null;
	const kind = value.kind;
	if (kind !== "lesson" && kind !== "review" && kind !== "checkpoint" && kind !== "final") return null;
	if (!isString(value.id) || !isString(value.target) || !isString(value.startedAt) || !Number.isInteger(value.index)) return null;
	if (!Array.isArray(value.queue) || !value.queue.every(isString) || !Array.isArray(value.fromReview) || !value.fromReview.every(isString)) return null;
	if (!Array.isArray(value.answers)) return null;
	const answers = value.answers.filter((answer): answer is SessionAnswer => isRecord(answer) && isString(answer.ex) && typeof answer.ok === "boolean" && typeof answer.retry === "boolean");
	const index = value.index as number;
	if (index < 0 || index >= value.queue.length) return null;
	return { id: value.id, kind, target: value.target, queue: value.queue, fromReview: value.fromReview, index, answers, startedAt: value.startedAt };
}

export function emptyEnrollment(pathId: string, now: string): EnrollmentData {
	return { v: 1, pathId, startedAt: now, lessons: {}, checkpoints: {}, review: [], active: null, lastLesson: null };
}

/** Stored enrollment data, with anything malformed dropped rather than trusted. */
export function readEnrollment(value: unknown, pathId: string, now: string): EnrollmentData {
	if (!isRecord(value) || value.pathId !== pathId) return emptyEnrollment(pathId, now);
	const review = Array.isArray(value.review)
		? value.review.filter((entry): entry is ReviewEntry => isRecord(entry) && isString(entry.ex) && isString(entry.lesson) && isString(entry.at) && Number.isInteger(entry.misses))
		: [];
	const final = readScore(value.final);
	return {
		v: 1,
		pathId,
		startedAt: isString(value.startedAt) ? value.startedAt : now,
		lessons: readScores(value.lessons),
		checkpoints: readScores(value.checkpoints),
		review,
		active: readSession(value.active),
		lastLesson: isString(value.lastLesson) ? value.lastLesson : null,
		...(final ? { final } : {}),
	};
}

export function readLearner(value: unknown): LearnerData {
	const concepts: Record<string, ConceptStat> = {};
	if (isRecord(value) && isRecord(value.concepts)) {
		for (const [concept, raw] of Object.entries(value.concepts)) {
			if (!isRecord(raw) || !isString(raw.at)) continue;
			const [s, r, w] = [raw.s, raw.r, raw.w].map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0));
			concepts[concept] = { s: Math.min(MAX_STRENGTH, s), r, w, at: raw.at };
		}
	}
	return { v: 1, concepts };
}

/** The study store body for the learner item: what the Knowledge Vault indexes. */
export function learnerSummary(learner: LearnerData): string {
	const groups: Record<ConceptState, string[]> = { new: [], learning: [], growing: [], mastered: [] };
	for (const [concept, stat] of Object.entries(learner.concepts)) groups[conceptState(stat)].push(concept);
	const line = (label: string, list: string[]) => (list.length ? `${label}: ${list.sort().join(", ")}.` : "");
	return [line("Mastered", groups.mastered), line("Growing", groups.growing), line("Still learning", groups.learning)].filter(Boolean).join("\n");
}
