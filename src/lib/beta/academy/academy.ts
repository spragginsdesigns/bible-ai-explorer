import "server-only";

import type { BetaItem } from "@prisma/client";
import { memoryOverview } from "@/lib/beta/memory/memory";
import { WRITTEN_COURSES, writtenCourse } from "@/lib/beta/paths/catalog";
import type { PathDef, PathLesson } from "@/lib/beta/paths/paths-types";
import { formatPassage } from "@/lib/beta/paths/content-rules";
import { LESSON_SIZE, lessonsOf, pathProgress, type PathProgress } from "@/lib/beta/paths/progress-rules";
import { listEnrollments, loadChapters, passageOf, restartPath } from "@/lib/beta/paths/server";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import { listSessions, loadSession, type LoadedSession } from "@/lib/beta/tutor/tutor";
import type { TutorSessionSummary } from "@/lib/beta/tutor/tutor-rules";
import {
	COURSE_MILESTONE,
	lessonMilestone,
	lessonParts,
	lessonPlace,
	milestoneTitle,
	newCourseData,
	nextStep,
	reachedMilestones,
	readCourseData,
	readRecordData,
	recordKey,
	recordIsMissing,
	recordMilestones,
	splitDuplicateRecords,
	unitMilestone,
	unrecordedMilestones,
	type AcademyCourseData,
	type AcademyRecordData,
	type LessonParts,
	type MilestoneKey,
} from "./academy-rules";
import type { AcademyMilestoneView, AcademyRecordView, CourseCardView, CoursePageView, LessonPageView, MemoryVerseView } from "./academy-types";

/**
 * SureWord Academy's server half (LC-17660, docs/beta/academy.md). A course
 * is a Learning Path, so its questions, review, checkpoints and final review
 * run through Paths' own sessions (`src/lib/beta/paths/server.ts`); a lesson's
 * close reading is a Socratic Tutor session and its memory verses are cards in
 * Scripture Memory, each read here through the module that owns it. What
 * Academy keeps of its own lives in the study store, module "academy": one
 * "course" item per enrolled course (its milestones) and one "record" item per
 * completed course, kept when the course is started over.
 */

export const ACADEMY_MODULE = "academy";
const COURSE_KIND = "course";
const RECORD_KIND = "record";

export type AcademyError = { error: string; status: number };

const asRecord = (data: unknown): Record<string, unknown> => data as Record<string, unknown>;

/* -------------------------------------------------------------------------
 * What the founder has, read once per page
 * ---------------------------------------------------------------------- */

interface StoredCourse {
	item: BetaItem;
	data: AcademyCourseData;
}

interface Context {
	enrollments: Awaited<ReturnType<typeof listEnrollments>>;
	courses: Map<string, StoredCourse>;
	records: StoredRecord[];
	/** The founder's close readings by passage ("Genesis 3:1-15"), newest first. */
	tutor: Map<string, TutorSessionSummary[]>;
	/** Every verse in the founder's Scripture Memory cards, as "book.chapter.verse". */
	deck: Set<string>;
}

async function loadCourses(userId: string): Promise<Map<string, StoredCourse>> {
	const items = await listBetaItems(userId, { module: ACADEMY_MODULE, kind: COURSE_KIND, take: 50 });
	const out = new Map<string, StoredCourse>();
	// Newest change first: should a double tap have made two, the one in use wins.
	for (const item of items) {
		const data = readCourseData(item.data);
		if (data && writtenCourse(data.courseId) && !out.has(data.courseId)) out.set(data.courseId, { item, data });
	}
	return out;
}

interface StoredRecord {
	item: BetaItem;
	data: AcademyRecordData;
	id: string;
	createdAt: string;
	key: string;
}

/** Every record and, apart, any second copy of one completion (see `splitDuplicateRecords`). */
async function loadAllRecords(userId: string): Promise<{ keep: StoredRecord[]; drop: StoredRecord[] }> {
	const items = await listBetaItems(userId, { module: ACADEMY_MODULE, kind: RECORD_KIND, take: 100 });
	const records = items.flatMap((item) => {
		const data = readRecordData(item.data);
		return data ? [{ item, data, id: item.id, createdAt: item.createdAt.toISOString(), key: recordKey(data) }] : [];
	});
	return splitDuplicateRecords(records);
}

/** The founder's records of completed courses, one per completion, newest change first. */
async function loadRecords(userId: string): Promise<StoredRecord[]> {
	return (await loadAllRecords(userId)).keep.sort((a, b) => b.item.updatedAt.getTime() - a.item.updatedAt.getTime());
}

async function loadDeck(userId: string): Promise<Set<string>> {
	const overview = await memoryOverview(userId);
	const deck = new Set<string>();
	for (const book of overview.books) for (const unit of book.units) for (const verse of unit.verses) deck.add(`${book.book}.${unit.chapter}.${verse.verse}`);
	return deck;
}

async function loadTutor(userId: string): Promise<Map<string, TutorSessionSummary[]>> {
	const byPassage = new Map<string, TutorSessionSummary[]>();
	for (const session of await listSessions(userId)) byPassage.set(session.reference, [...(byPassage.get(session.reference) ?? []), session]);
	return byPassage;
}

async function loadContext(userId: string): Promise<Context> {
	const [enrollments, courses, records, tutor, deck] = await Promise.all([listEnrollments(userId), loadCourses(userId), loadRecords(userId), loadTutor(userId), loadDeck(userId)]);
	return { enrollments, courses, records, tutor, deck };
}

/* -------------------------------------------------------------------------
 * A course's state
 * ---------------------------------------------------------------------- */

/** The canonical reference a passage is written as, the same way the tutor writes its sessions'. */
function canonical(ref: string): string {
	const passage = passageOf(ref);
	return passage ? formatPassage(passage) : ref;
}

/** Each verse of a reference ("Ephesians 2:8-9") as "book.chapter.verse". */
function verseKeys(ref: string): string[] {
	const passage = passageOf(ref);
	if (!passage) return [];
	return Array.from({ length: passage.end - passage.start + 1 }, (_, offset) => `${passage.book}.${passage.chapter}.${passage.start + offset}`);
}

function tutorSessionsFor(ctx: Context, lesson: PathLesson): TutorSessionSummary[] {
	return lesson.course ? (ctx.tutor.get(canonical(lesson.course.tutor)) ?? []) : [];
}

function memoryInDeck(ctx: Context, ref: string): boolean {
	const keys = verseKeys(ref);
	return keys.length > 0 && keys.every((key) => ctx.deck.has(key));
}

interface CourseState {
	def: PathDef;
	stored: StoredCourse | null;
	progress: PathProgress;
	parts: Map<string, LessonParts>;
	complete: (lessonId: string) => boolean;
	reached: MilestoneKey[];
	unrecorded: MilestoneKey[];
	recordMissing: boolean;
}

function courseState(def: PathDef, ctx: Context): CourseState {
	const enrollment = ctx.enrollments.get(def.id)?.data ?? null;
	const stored = ctx.courses.get(def.id) ?? null;
	const progress = pathProgress(def, enrollment);
	const recorded = stored?.data.milestones ?? {};
	const parts = new Map<string, LessonParts>();
	for (const unit of progress.units) {
		for (const node of unit.lessons) {
			const lesson = lessonsOf(def).find((entry) => entry.id === node.id)!;
			parts.set(
				node.id,
				lessonParts({
					state: node.state,
					score: node.score,
					quizUnderWay: enrollment?.active?.kind === "lesson" && enrollment.active.target === node.id,
					tutor: tutorSessionsFor(ctx, lesson),
					memory: (lesson.course?.memory ?? [lesson.keyVerse]).map((ref) => ({ inDeck: memoryInDeck(ctx, ref) })),
					completedAt: recorded[lessonMilestone(node.id)] ?? null,
				})
			);
		}
	}
	const complete = (lessonId: string) => parts.get(lessonId)?.complete ?? false;
	const reached = reachedMilestones(progress, complete);
	return {
		def,
		stored,
		progress,
		parts,
		complete,
		reached,
		unrecorded: stored ? unrecordedMilestones(reached, recorded) : [],
		recordMissing: recordIsMissing(stored?.data ?? null, ctx.records.map((record) => record.key)),
	};
}

function lastCompletion(ctx: Context, courseId: string): string | null {
	return ctx.records.filter((record) => record.data.courseId === courseId).map((record) => record.data.completedAt).sort().at(-1) ?? null;
}

function cardView(state: CourseState, ctx: Context): CourseCardView {
	const { def, stored, progress } = state;
	const done = progress.units.reduce((sum, unit) => sum + unit.lessons.filter((lesson) => state.complete(lesson.id)).length, 0);
	return {
		id: def.id,
		title: def.title,
		tagline: def.tagline,
		audience: def.audience,
		lessonCount: progress.total,
		unitCount: def.units.length,
		enrolled: Boolean(stored),
		complete: done,
		percent: progress.total ? Math.round((done / progress.total) * 100) : 0,
		next: stored ? nextStep(progress, state.complete) : null,
		completedAt: lastCompletion(ctx, def.id),
		updatedAt: stored ? [stored.item.updatedAt, ctx.enrollments.get(def.id)?.item.updatedAt].filter((at): at is Date => Boolean(at)).sort((a, b) => b.getTime() - a.getTime())[0].toISOString() : null,
	};
}

/* -------------------------------------------------------------------------
 * Views
 * ---------------------------------------------------------------------- */

/** The hub: every course with the founder's progress, and the record of completed courses. */
export async function academyHub(userId: string): Promise<{ courses: CourseCardView[]; records: { id: string; courseId: string; title: string; completedAt: string }[] }> {
	const ctx = await loadContext(userId);
	return {
		courses: WRITTEN_COURSES.map((def) => cardView(courseState(def, ctx), ctx)),
		records: ctx.records
			.map(({ item, data }) => ({ id: item.id, courseId: data.courseId, title: data.title, completedAt: data.completedAt }))
			.sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
	};
}

/** One course's page: its units, every lesson's parts, milestones, checkpoints and the final review. */
export async function coursePage(userId: string, def: PathDef): Promise<CoursePageView> {
	const ctx = await loadContext(userId);
	const state = courseState(def, ctx);
	const recorded = state.stored?.data.milestones ?? {};
	const milestones: AcademyMilestoneView[] = Object.entries(recorded)
		.map(([key, at]) => ({ key, title: milestoneTitle(def, key), at }))
		.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
	return {
		...cardView(state, ctx),
		description: def.description,
		outcomes: def.course?.outcomes ?? [],
		readAlong: def.readAlong,
		units: state.progress.units.map((unit, index) => ({
			id: unit.id,
			number: index + 1,
			title: unit.title,
			summary: unit.summary,
			checkpoint: unit.checkpoint,
			checkpointScore: unit.checkpointScore,
			milestoneAt: recorded[unitMilestone(unit.id)] ?? null,
			lessons: unit.lessons.map((node) => {
				const parts = state.parts.get(node.id)!;
				return {
					id: node.id,
					number: node.number,
					title: node.title,
					summary: node.summary,
					reading: node.reading,
					state: node.state,
					quiz: parts.quiz,
					tutor: parts.tutor,
					memory: parts.memory,
					complete: parts.complete,
					completedAt: recorded[lessonMilestone(node.id)] ?? null,
				};
			}),
		})),
		final: { state: state.progress.final === "none" ? "locked" : state.progress.final, score: state.progress.finalScore },
		reviewCount: state.progress.reviewCount,
		milestones,
		unrecorded: state.unrecorded,
		recordMissing: state.recordMissing,
		records: ctx.records.filter((record) => record.data.courseId === def.id).map((record) => ({ id: record.item.id, completedAt: record.data.completedAt })),
	};
}

/** One lesson's page: its three parts and where each stands. Null for a lesson the course does not have. */
export async function lessonPage(userId: string, def: PathDef, lessonId: string): Promise<LessonPageView | null> {
	const place = lessonPlace(def, lessonId);
	const courseParts = place?.lesson.course;
	if (!place || !courseParts) return null;
	const { lesson } = place;
	const ctx = await loadContext(userId);
	const state = courseState(def, ctx);
	const unitNode = state.progress.units[place.unitIndex];
	const node = unitNode.lessons.find((entry) => entry.id === lessonId)!;
	const parts = state.parts.get(lessonId)!;
	const memoryRefs = courseParts.memory;
	const chapters = await loadChapters(memoryRefs);
	const verses: MemoryVerseView[] = memoryRefs.map((ref) => {
		const passage = passageOf(ref)!;
		const chapter = chapters.get(`${passage.book}.${passage.chapter}`) ?? [];
		return { ref: formatPassage(passage), text: chapter.slice(passage.start - 1, passage.end).join(" "), inDeck: memoryInDeck(ctx, ref) };
	});
	const sessions = tutorSessionsFor(ctx, lesson);
	// Pick up the close reading still open, else show the newest finished one.
	const session = sessions.find((entry) => !entry.finished) ?? sessions[0] ?? null;
	const nextNode = place.next ? state.progress.units.flatMap((unit) => unit.lessons).find((entry) => entry.id === place.next!.id) : null;
	const unitDone = unitNode.lessons.every((entry) => state.complete(entry.id));
	return {
		courseId: def.id,
		courseTitle: def.title,
		enrolled: Boolean(state.stored),
		unit: { id: unitNode.id, number: place.unitIndex + 1, title: unitNode.title },
		lesson: { id: lesson.id, number: place.number, total: place.total, title: lesson.title, summary: lesson.summary, reading: lesson.reading, state: node.state },
		quiz: { state: parts.quiz, score: node.score, questions: Math.min(LESSON_SIZE, lesson.exercises.length) },
		tutor: { state: parts.tutor, passage: canonical(courseParts.tutor), focus: courseParts.focus, sessionId: session?.id ?? null, answered: session?.answered ?? 0 },
		memory: { state: parts.memory, verses },
		complete: parts.complete,
		completedAt: state.stored?.data.milestones[lessonMilestone(lessonId)] ?? null,
		next: place.next && nextNode ? { id: place.next.id, title: place.next.title, open: nextNode.state !== "locked" } : null,
		checkpoint: unitDone ? { unitId: unitNode.id, title: unitNode.title, state: unitNode.checkpoint } : null,
		unrecorded: state.unrecorded,
		recordMissing: state.recordMissing,
	};
}

/** The close reading a lesson's tutor part opens: the one still under way, else the newest. */
export async function lessonTutorSession(userId: string, def: PathDef, lessonId: string): Promise<LoadedSession | null> {
	const lesson = lessonPlace(def, lessonId)?.lesson;
	if (!lesson?.course) return null;
	const sessions = (await loadTutor(userId)).get(canonical(lesson.course.tutor)) ?? [];
	const chosen = sessions.find((entry) => !entry.finished) ?? sessions[0];
	return chosen ? loadSession(userId, chosen.id) : null;
}

/** Whether the founder is enrolled in the course. */
export async function isEnrolled(userId: string, courseId: string): Promise<boolean> {
	return (await loadCourses(userId)).has(courseId);
}

/** A record of a completed course; null for a missing, foreign or other module's id. */
export async function recordPage(userId: string, id: string): Promise<AcademyRecordView | null> {
	const item = await getBetaItem(userId, id);
	if (!item || item.module !== ACADEMY_MODULE || item.kind !== RECORD_KIND) return null;
	const data = readRecordData(item.data);
	return data ? { id: item.id, ...data } : null;
}

/* -------------------------------------------------------------------------
 * Enrolling, leaving and milestones
 * ---------------------------------------------------------------------- */

function courseBody(def: PathDef, data: AcademyCourseData): string {
	const lessons = lessonsOf(def);
	const done = lessons.filter((lesson) => data.milestones[lessonMilestone(lesson.id)]);
	return [
		`Enrolled in ${def.title}: ${done.length} of ${lessons.length} lessons complete.`,
		done.length ? `Completed: ${done.map((lesson) => `${lesson.title} (${lesson.reading})`).join("; ")}.` : "",
		data.milestones[COURSE_MILESTONE] ? `Completed the course.` : "",
	]
		.filter(Boolean)
		.join("\n");
}

/** Every verse of the readings of these lessons, for the store's refs. */
function readingRefs(lessons: readonly PathLesson[]): string[] {
	return [
		...new Set(
			lessons.flatMap((lesson) => {
				const passage = passageOf(lesson.reading);
				return passage ? Array.from({ length: passage.end - passage.start + 1 }, (_, offset) => betaRefKey(passage.book, passage.chapter, passage.start + offset)) : [];
			})
		),
	].slice(0, 240);
}

/** Enroll in a course; enrolling again changes nothing. */
export async function enroll(userId: string, courseId: string): Promise<{ enrolled: true; created: boolean } | AcademyError> {
	const def = writtenCourse(courseId);
	if (!def) return { error: "Not found", status: 404 };
	if ((await loadCourses(userId)).has(courseId)) return { enrolled: true, created: false };
	const data = newCourseData(courseId, new Date().toISOString());
	await createBetaItem(userId, { module: ACADEMY_MODULE, kind: COURSE_KIND, title: def.title, data: asRecord(data), body: courseBody(def, data), topics: def.topics.slice(0, 50) });
	return { enrolled: true, created: true };
}

/**
 * Leave a course, which is also how it is started over: the enrollment, its
 * milestones and its Paths progress go. Records of completing it, the close
 * readings, the memory cards and what the founder has shown of each truth stay.
 */
export async function leave(userId: string, courseId: string): Promise<{ left: boolean } | AcademyError> {
	if (!writtenCourse(courseId)) return { error: "Not found", status: 404 };
	const items = await listBetaItems(userId, { module: ACADEMY_MODULE, kind: COURSE_KIND, take: 50 });
	const mine = items.filter((item) => readCourseData(item.data, courseId));
	const [removed, restarted] = await Promise.all([Promise.all(mine.map((item) => deleteBetaItem(userId, item.id))), restartPath(userId, courseId)]);
	return { left: removed.some(Boolean) || restarted };
}

function recordOf(def: PathDef, data: AcademyCourseData, ctx: Context, now: string): AcademyRecordData {
	return {
		v: 1,
		courseId: def.id,
		title: def.title,
		enrolledAt: data.enrolledAt,
		completedAt: now,
		units: def.units.map((unit) => ({
			id: unit.id,
			title: unit.title,
			completedAt: data.milestones[unitMilestone(unit.id)] ?? null,
			lessons: unit.lessons.map((lesson) => ({
				id: lesson.id,
				title: lesson.title,
				reading: lesson.reading,
				memory: lesson.course?.memory ?? [lesson.keyVerse],
				tutor: lesson.course ? canonical(lesson.course.tutor) : "",
				tutorSessionId: tutorSessionsFor(ctx, lesson).find((session) => session.finished)?.id ?? null,
				completedAt: data.milestones[lessonMilestone(lesson.id)] ?? null,
			})),
		})),
	};
}

/**
 * Record every milestone the founder has reached and not yet recorded, and
 * the record of the course once it is complete. Safe to call any number of
 * times: the write is conditional on the item being unchanged since it was
 * read, so two calls at once record each milestone, and the course, once.
 */
export async function syncMilestones(userId: string, courseId: string): Promise<{ added: AcademyMilestoneView[]; recordId: string | null } | AcademyError> {
	const def = writtenCourse(courseId);
	if (!def) return { error: "Not found", status: 404 };
	const createRecord = async (data: AcademyCourseData, ctx: Context, at: string): Promise<string> => {
		const record = recordOf(def, data, ctx, at);
		const item = await createBetaItem(userId, {
			module: ACADEMY_MODULE,
			kind: RECORD_KIND,
			title: `${def.title}, completed`,
			data: asRecord(record),
			body: [`Completed ${def.title}.`, ...record.units.map((unit) => `${unit.title}: ${unit.lessons.map((lesson) => `${lesson.title} (${lesson.reading})`).join("; ")}.`)].join("\n"),
			refs: readingRefs(lessonsOf(def)),
			topics: def.topics.slice(0, 50),
		});
		return item.id;
	};
	/** Delete any second copy of this completion's record; the one kept, for every caller alike. */
	const settleRecord = async (key: string): Promise<string | null> => {
		const { keep, drop } = await loadAllRecords(userId);
		await Promise.all(drop.filter((record) => record.key === key).map((record) => deleteBetaItem(userId, record.id)));
		return keep.find((record) => record.key === key)?.id ?? null;
	};
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const ctx = await loadContext(userId);
		const state = courseState(def, ctx);
		if (!state.stored) return { error: "Enroll in the course first.", status: 409 };
		if (state.unrecorded.length === 0) {
			if (!state.recordMissing) return { added: [], recordId: null };
			// The course was recorded complete but its record never landed (a failed write): make it now.
			await createRecord(state.stored.data, ctx, state.stored.data.milestones[COURSE_MILESTONE]);
			return { added: [], recordId: await settleRecord(recordKey(state.stored.data)) };
		}
		const now = new Date().toISOString();
		const data = recordMilestones(state.stored.data, state.unrecorded, now);
		const updated = await updateBetaItem(
			userId,
			state.stored.item.id,
			{ data: asRecord(data), body: courseBody(def, data), refs: readingRefs(lessonsOf(def).filter((lesson) => data.milestones[lessonMilestone(lesson.id)])) },
			{ ifUpdatedAt: state.stored.item.updatedAt }
		);
		if (!updated) continue;
		// The request whose write landed makes the record; one that saw the milestone before the record
		// existed may make a second, and both then keep the same one.
		let recordId: string | null = null;
		if (state.unrecorded.includes(COURSE_MILESTONE)) {
			await createRecord(data, ctx, now);
			recordId = await settleRecord(recordKey(data));
		}
		return { added: state.unrecorded.map((key) => ({ key, title: milestoneTitle(def, key), at: now })), recordId };
	}
	return { error: "Your progress changed while it was being saved. Please try again.", status: 409 };
}
