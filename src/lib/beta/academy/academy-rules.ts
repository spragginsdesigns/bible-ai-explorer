/**
 * Pure rules for SureWord Academy (LC-17660, docs/beta/academy.md): what each
 * part of a course lesson stands at, when a lesson, a unit and a course are
 * complete, which milestones that reaches, and what a founder's Academy items
 * in the study store hold.
 *
 * A course is a Learning Path (`PathDef` with `course`), so its questions,
 * review, checkpoints and final review are Paths' own (`progress-rules.ts`).
 * Academy adds two parts to every lesson, each kept by the module that owns
 * it: a close reading with the Socratic Tutor (done once a conclusion has been
 * checked against the text) and the lesson's verses in Scripture Memory (done
 * once every one is in the founder's cards). A milestone records that a
 * lesson, a unit or a course was finished, and when; it never grades anyone.
 *
 * Type imports only, so the tests load this with Node's type stripping.
 */
import type { PathDef, PathLesson, SessionScore } from "../paths/paths-types";
import type { LessonState, PathProgress } from "../paths/progress-rules";

/** Where one part of a lesson stands. */
export type PartState = "locked" | "open" | "started" | "done";

/** A milestone: `lesson:<lesson id>`, `unit:<unit id>` or `course`. */
export type MilestoneKey = string;

export const COURSE_MILESTONE = "course";

export function lessonMilestone(lessonId: string): MilestoneKey {
	return `lesson:${lessonId}`;
}

export function unitMilestone(unitId: string): MilestoneKey {
	return `unit:${unitId}`;
}

/* -------------------------------------------------------------------------
 * The founder's Academy items (BetaItem, module "academy")
 * ---------------------------------------------------------------------- */

/** kind "course": one per course a founder is enrolled in. */
export interface AcademyCourseData {
	v: 1;
	courseId: string;
	enrolledAt: string;
	/** Milestone key -> when it was reached. Kept until the founder starts the course over. */
	milestones: Record<MilestoneKey, string>;
}

/** One lesson as the record of a completed course keeps it. */
export interface RecordLesson {
	id: string;
	title: string;
	reading: string;
	memory: string[];
	tutor: string;
	/** The close reading the founder finished, when there was one. */
	tutorSessionId: string | null;
	completedAt: string | null;
}

/** kind "record": one per time a founder completes a course, kept when they start it over. */
export interface AcademyRecordData {
	v: 1;
	courseId: string;
	title: string;
	enrolledAt: string;
	completedAt: string;
	units: { id: string; title: string; completedAt: string | null; lessons: RecordLesson[] }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const MILESTONE_PATTERN = /^(?:course|lesson:[a-z0-9-]{1,60}|unit:[a-z0-9-]{1,60})$/;

export function newCourseData(courseId: string, now: string): AcademyCourseData {
	return { v: 1, courseId, enrolledAt: now, milestones: {} };
}

/** Stored course data, or null when it is not a course enrollment for this course. */
export function readCourseData(value: unknown, courseId?: string): AcademyCourseData | null {
	if (!isRecord(value) || !isString(value.courseId) || !isString(value.enrolledAt)) return null;
	if (courseId !== undefined && value.courseId !== courseId) return null;
	const milestones: Record<string, string> = {};
	if (isRecord(value.milestones)) {
		for (const [key, at] of Object.entries(value.milestones)) if (MILESTONE_PATTERN.test(key) && isString(at)) milestones[key] = at;
	}
	return { v: 1, courseId: value.courseId, enrolledAt: value.enrolledAt, milestones };
}

/** A stored record, or null when the data is not one. */
export function readRecordData(value: unknown): AcademyRecordData | null {
	if (!isRecord(value) || !isString(value.courseId) || !isString(value.title) || !isString(value.completedAt) || !isString(value.enrolledAt) || !Array.isArray(value.units)) return null;
	const units = value.units.filter(isRecord).map((unit) => ({
		id: isString(unit.id) ? unit.id : "",
		title: isString(unit.title) ? unit.title : "",
		completedAt: isString(unit.completedAt) ? unit.completedAt : null,
		lessons: (Array.isArray(unit.lessons) ? unit.lessons : []).filter(isRecord).map((lesson) => ({
			id: isString(lesson.id) ? lesson.id : "",
			title: isString(lesson.title) ? lesson.title : "",
			reading: isString(lesson.reading) ? lesson.reading : "",
			memory: Array.isArray(lesson.memory) ? lesson.memory.filter(isString) : [],
			tutor: isString(lesson.tutor) ? lesson.tutor : "",
			tutorSessionId: isString(lesson.tutorSessionId) ? lesson.tutorSessionId : null,
			completedAt: isString(lesson.completedAt) ? lesson.completedAt : null,
		})),
	}));
	return { v: 1, courseId: value.courseId, title: value.title, enrolledAt: value.enrolledAt, completedAt: value.completedAt, units };
}

/** One completion per enrollment (starting a course over makes a new one), so a record's key. */
export function recordKey(data: Pick<AcademyRecordData, "courseId" | "enrolledAt">): string {
	return `${data.courseId}@${data.enrolledAt}`;
}

/**
 * The course is recorded complete but no record of it exists (its write
 * failed): the next request to record milestones makes it.
 */
export function recordIsMissing(data: AcademyCourseData | null, recordKeys: readonly string[]): boolean {
	return data !== null && Boolean(data.milestones[COURSE_MILESTONE]) && !recordKeys.includes(recordKey(data));
}

/**
 * Records that share a key are one completion written twice (two requests at
 * once). Keep the oldest, then the lowest id: every request agrees on it, so
 * however the writes interleave they end with the same single record.
 */
export function splitDuplicateRecords<T extends { id: string; createdAt: string; key: string }>(records: readonly T[]): { keep: T[]; drop: T[] } {
	const sorted = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
	const seen = new Set<string>();
	const keep: T[] = [];
	const drop: T[] = [];
	for (const record of sorted) {
		if (seen.has(record.key)) drop.push(record);
		else {
			seen.add(record.key);
			keep.push(record);
		}
	}
	return { keep, drop };
}

/* -------------------------------------------------------------------------
 * A lesson's parts
 * ---------------------------------------------------------------------- */

export interface LessonPartsInput {
	/** The lesson's place on the Paths map: its questions open one lesson after another. */
	state: LessonState;
	/** The questions' score once taken. */
	score: SessionScore | null;
	/** The founder has a session of the lesson's questions under way. */
	quizUnderWay: boolean;
	/** The founder's close readings of the lesson's tutor passage. */
	tutor: { finished: boolean }[];
	/** Each memory verse, and whether all of its verses are in the founder's cards. */
	memory: { inDeck: boolean }[];
	/** When the lesson was recorded complete, if it was. */
	completedAt: string | null;
}

export interface LessonParts {
	quiz: PartState;
	tutor: PartState;
	memory: PartState;
	/** Every part done now, or recorded complete earlier. */
	complete: boolean;
	partsDone: number;
}

/**
 * Where each part of a lesson stands. A lesson the Paths map has locked has
 * every part locked; once it opens, the tutor and memory parts can be done in
 * any order beside its questions.
 */
export function lessonParts(input: LessonPartsInput): LessonParts {
	const locked = input.state === "locked";
	const quiz: PartState = input.score ? "done" : locked ? "locked" : input.quizUnderWay ? "started" : "open";
	const tutor: PartState = input.tutor.some((session) => session.finished) ? "done" : locked ? "locked" : input.tutor.length ? "started" : "open";
	const inDeck = input.memory.filter((verse) => verse.inDeck).length;
	const memory: PartState = input.memory.length > 0 && inDeck === input.memory.length ? "done" : locked ? "locked" : inDeck > 0 ? "started" : "open";
	const parts = [quiz, tutor, memory];
	const partsDone = parts.filter((part) => part === "done").length;
	return { quiz, tutor, memory, complete: partsDone === parts.length || input.completedAt !== null, partsDone };
}

/* -------------------------------------------------------------------------
 * Milestones
 * ---------------------------------------------------------------------- */

/**
 * Every milestone the founder has reached: each lesson whose parts are all
 * done, each unit whose lessons are complete and whose checkpoint is taken,
 * and the course once every unit is and its final review is taken.
 */
export function reachedMilestones(progress: PathProgress, complete: (lessonId: string) => boolean): MilestoneKey[] {
	const keys: MilestoneKey[] = [];
	let units = 0;
	for (const unit of progress.units) {
		for (const lesson of unit.lessons) if (complete(lesson.id)) keys.push(lessonMilestone(lesson.id));
		if (unit.checkpoint === "done" && unit.lessons.every((lesson) => complete(lesson.id))) {
			keys.push(unitMilestone(unit.id));
			units += 1;
		}
	}
	if (progress.units.length > 0 && units === progress.units.length && progress.final === "done") keys.push(COURSE_MILESTONE);
	return keys;
}

/** The reached milestones not yet recorded, in course order. */
export function unrecordedMilestones(reached: readonly MilestoneKey[], recorded: Readonly<Record<MilestoneKey, string>>): MilestoneKey[] {
	return reached.filter((key) => !recorded[key]);
}

/** The course data with these milestones recorded at `now`; ones already there keep their time. */
export function recordMilestones(data: AcademyCourseData, keys: readonly MilestoneKey[], now: string): AcademyCourseData {
	const milestones = { ...data.milestones };
	for (const key of keys) if (!milestones[key]) milestones[key] = now;
	return { ...data, milestones };
}

/** A milestone in words: what was finished, never how well anyone is doing. */
export function milestoneTitle(course: PathDef, key: MilestoneKey): string {
	if (key === COURSE_MILESTONE) return `You completed ${course.title}`;
	if (key.startsWith("unit:")) {
		const index = course.units.findIndex((unit) => unit.id === key.slice(5));
		return index >= 0 ? `Unit ${index + 1} finished: ${course.units[index].title}` : "Unit finished";
	}
	const lessons = course.units.flatMap((unit) => unit.lessons);
	const index = lessons.findIndex((lesson) => lesson.id === key.slice(7));
	return index >= 0 ? `Lesson ${index + 1} complete: ${lessons[index].title}` : "Lesson complete";
}

/* -------------------------------------------------------------------------
 * What comes next
 * ---------------------------------------------------------------------- */

export type NextStep =
	| { kind: "lesson"; lessonId: string; number: number; title: string }
	| { kind: "checkpoint"; unitId: string; title: string }
	| { kind: "final" };

/**
 * The founder's next step in a course: the first open lesson with a part left,
 * else the first unit checkpoint not yet taken, else the final review; null
 * when the course is done.
 */
export function nextStep(progress: PathProgress, complete: (lessonId: string) => boolean): NextStep | null {
	for (const unit of progress.units) {
		for (const lesson of unit.lessons) {
			if (lesson.state !== "locked" && !complete(lesson.id)) return { kind: "lesson", lessonId: lesson.id, number: lesson.number, title: lesson.title };
		}
	}
	const unit = progress.units.find((entry) => entry.checkpoint === "open");
	if (unit) return { kind: "checkpoint", unitId: unit.id, title: unit.title };
	if (progress.final === "open") return { kind: "final" };
	return null;
}

/** The lesson and unit before and after one lesson, for its page. */
export function lessonPlace(course: PathDef, lessonId: string): { unitIndex: number; number: number; total: number; lesson: PathLesson; next: PathLesson | null } | null {
	const lessons = course.units.flatMap((unit) => unit.lessons);
	const index = lessons.findIndex((lesson) => lesson.id === lessonId);
	if (index < 0) return null;
	const unitIndex = course.units.findIndex((unit) => unit.lessons.some((lesson) => lesson.id === lessonId));
	return { unitIndex, number: index + 1, total: lessons.length, lesson: lessons[index], next: lessons[index + 1] ?? null };
}
