import "server-only";

import { randomUUID } from "node:crypto";
import type { BetaItem } from "@prisma/client";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import { BOOKS } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import {
	answerIsGrounded,
	answerStandsOut,
	arrangeOptions,
	distractorContradictsVerse,
	foldWords,
	overlapWithVerse,
	seedHash,
} from "@/lib/quiz-rules";
import { WRITTEN_PATHS, writtenPath } from "./catalog";
import { formatPassage, parsePassage, readCurriculum, splitAroundBlank, type BookInfo, type ContentDeps, type Passage } from "./content-rules";
import type { EnrollmentData, LearnerData, PathDef, PathExercise, SessionKind } from "./paths-types";
import {
	arrangedOptions,
	buildSession,
	canStart,
	conceptState,
	emptyEnrollment,
	exerciseIndex,
	gradeResponse,
	learnerSummary,
	lessonsOf,
	matchDisplay,
	orderDisplay,
	pathConcepts,
	pathProgress,
	readEnrollment,
	readLearner,
	recordAnswer,
	type Arrange,
} from "./progress-rules";
import type { AnswerResult, ExerciseView, PathCardView, PathPageView, SessionSummary, SessionView, VerseView } from "./view-types";

/**
 * The server half of Learning Paths (LC-17648, docs/beta/paths.md): progress
 * in the shared study store (module "paths": one "learner" item with mastery
 * per concept, one "enrollment" per started path, one "curriculum" per
 * personal path), Scripture from the bundled KJV, and the views the pages and
 * API hand the browser. Every call is scoped to the founder through
 * `src/lib/beta/store.ts`.
 */

export const PATHS_MODULE = "paths";
const ARRANGE: Arrange = { arrangeOptions, seedHash };

export type PathsError = { error: string; status: number };

export function isPathsError(value: unknown): value is PathsError {
	return typeof value === "object" && value !== null && "error" in value && "status" in value;
}

/* -------------------------------------------------------------------------
 * Scripture
 * ---------------------------------------------------------------------- */

const BOOK_INFO = new Map<string, BookInfo>(BOOKS.map((book) => [book.name, { order: book.order, name: book.name, chapters: book.chapters }]));
BOOK_INFO.set("Psalm", BOOK_INFO.get("Psalms")!);

export function resolveBook(name: string): BookInfo | null {
	return BOOK_INFO.get(name) ?? null;
}

export function passageOf(ref: string | null | undefined): Passage | null {
	return ref ? parsePassage(ref, resolveBook) : null;
}

type Chapters = Map<string, string[]>;
const chapterKey = (passage: { book: number; chapter: number }) => `${passage.book}.${passage.chapter}`;

/** The plain KJV chapters these references fall in, each loaded once. */
export async function loadChapters(refs: readonly (string | null | undefined)[]): Promise<Chapters> {
	const wanted = new Map<string, Passage>();
	for (const ref of refs) {
		const passage = passageOf(ref);
		if (passage) wanted.set(chapterKey(passage), passage);
	}
	const chapters: Chapters = new Map();
	await Promise.all(
		[...wanted].map(async ([key, passage]) => {
			chapters.set(key, (await getKjvChapter(passage.book, passage.chapter)).map((raw) => bibleVersePlainText(raw).trim()));
		})
	);
	return chapters;
}

function versesOf(chapters: Chapters, passage: Passage): string[] | null {
	const chapter = chapters.get(chapterKey(passage));
	if (!chapter || passage.end > chapter.length) return null;
	return chapter.slice(passage.start - 1, passage.end);
}

/** The content rules' view of the KJV, over chapters already loaded. */
export function contentDeps(chapters: Chapters): ContentDeps {
	return {
		resolveBook,
		verses: (passage) => versesOf(chapters, passage),
		answerIsGrounded,
		distractorContradictsVerse,
		answerStandsOut,
		foldWords,
		overlapWithVerse,
	};
}

function verseView(chapters: Chapters, ref: string): VerseView | null {
	const passage = passageOf(ref);
	const verses = passage && versesOf(chapters, passage);
	if (!passage || !verses) return null;
	return { ref: formatPassage(passage), text: verses.join(" "), book: passage.book, chapter: passage.chapter, verse: passage.start };
}

/* -------------------------------------------------------------------------
 * Paths, written and personal
 * ---------------------------------------------------------------------- */

export interface LoadedPath {
	def: PathDef;
	/** The curriculum item, for a personal path. */
	curriculum: BetaItem | null;
	topic: string | null;
	/** Lessons whose questions exist; every lesson of a written path. */
	written: ReadonlySet<string>;
}

const CURRICULUM_PATH_ID = /^c-([a-z0-9]{8,40})$/;

export function curriculumPathId(itemId: string): string {
	return `c-${itemId}`;
}

export function loadedCurriculum(item: BetaItem): LoadedPath | null {
	if (item.module !== PATHS_MODULE || item.kind !== "curriculum") return null;
	const read = readCurriculum(item.data, curriculumPathId(item.id));
	return read ? { def: read.path, curriculum: item, topic: read.topic, written: new Set(read.written) } : null;
}

/** A written path, or one of the founder's own curricula ("c-<item id>"); null for anything else. */
export async function loadPath(userId: string, pathId: string): Promise<LoadedPath | null> {
	const def = writtenPath(pathId);
	if (def) return { def, curriculum: null, topic: null, written: new Set(lessonsOf(def).map((lesson) => lesson.id)) };
	const match = CURRICULUM_PATH_ID.exec(pathId);
	if (!match) return null;
	const item = await getBetaItem(userId, match[1]);
	return item ? loadedCurriculum(item) : null;
}

/* -------------------------------------------------------------------------
 * Progress in the study store
 * ---------------------------------------------------------------------- */

interface StoredLearner {
	item: BetaItem | null;
	data: LearnerData;
}

interface StoredEnrollment {
	item: BetaItem;
	data: EnrollmentData;
}

const asRecord = (data: unknown): Record<string, unknown> => data as Record<string, unknown>;

export async function loadLearner(userId: string): Promise<StoredLearner> {
	const [item] = await listBetaItems(userId, { module: PATHS_MODULE, kind: "learner", take: 1 });
	return { item: item ?? null, data: readLearner(item?.data) };
}

async function saveLearner(userId: string, stored: StoredLearner, data: LearnerData): Promise<void> {
	const body = learnerSummary(data) || null;
	const topics = Object.entries(data.concepts)
		.filter(([, stat]) => conceptState(stat) === "mastered")
		.map(([concept]) => concept)
		.slice(0, 50);
	if (stored.item && (await updateBetaItem(userId, stored.item.id, { data: asRecord(data), body, topics }))) return;
	await createBetaItem(userId, { module: PATHS_MODULE, kind: "learner", title: "What you have shown you understand", data: asRecord(data), body, topics });
}

function storedPathId(item: BetaItem): string | null {
	const data = item.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	const pathId = (data as Record<string, unknown>).pathId;
	return typeof pathId === "string" ? pathId : null;
}

/** One enrollment per path, the most recently changed when there are two. */
export async function listEnrollments(userId: string): Promise<Map<string, StoredEnrollment>> {
	const items = await listBetaItems(userId, { module: PATHS_MODULE, kind: "enrollment", take: 500 });
	const now = new Date().toISOString();
	const out = new Map<string, StoredEnrollment>();
	for (const item of items) {
		const pathId = storedPathId(item);
		if (pathId && !out.has(pathId)) out.set(pathId, { item, data: readEnrollment(item.data, pathId, now) });
	}
	return out;
}

async function saveEnrollment(userId: string, loaded: LoadedPath, item: BetaItem | null, data: EnrollmentData): Promise<BetaItem> {
	const lessons = lessonsOf(loaded.def);
	const done = lessons.filter((lesson) => data.lessons[lesson.id]);
	const refs = done.flatMap((lesson) => {
		const passage = passageOf(lesson.reading);
		if (!passage) return [];
		return Array.from({ length: passage.end - passage.start + 1 }, (_, offset) => betaRefKey(passage.book, passage.chapter, passage.start + offset));
	});
	const next = lessons.find((lesson) => !data.lessons[lesson.id]);
	const body = [
		`${loaded.def.title}: ${done.length} of ${lessons.length} lessons done.`,
		done.length ? `Done: ${done.map((lesson) => `${lesson.title} (${lesson.reading})`).join("; ")}.` : "",
		next ? `Next: ${next.title} (${next.reading}).` : "Every lesson is done.",
	]
		.filter(Boolean)
		.join("\n");
	const topics = loaded.def.topics.slice(0, 50);
	if (item) {
		const updated = await updateBetaItem(userId, item.id, { data: asRecord(data), body, refs, topics });
		if (updated) return updated;
	}
	return createBetaItem(userId, {
		module: PATHS_MODULE,
		kind: "enrollment",
		title: loaded.def.title,
		parentId: loaded.curriculum?.id ?? null,
		data: asRecord(data),
		body,
		refs,
		topics,
	});
}

/** Start the path over: its progress goes, what the founder has shown of each concept stays. */
export async function restartPath(userId: string, pathId: string): Promise<boolean> {
	const items = await listBetaItems(userId, { module: PATHS_MODULE, kind: "enrollment", take: 500 });
	const mine = items.filter((item) => storedPathId(item) === pathId);
	const results = await Promise.all(mine.map((item) => deleteBetaItem(userId, item.id)));
	return results.some(Boolean);
}

/* -------------------------------------------------------------------------
 * Views
 * ---------------------------------------------------------------------- */

function resumeOf(def: PathDef, data: EnrollmentData): PathCardView["resume"] {
	const session = data.active;
	if (!session) return null;
	const title =
		session.kind === "lesson"
			? lessonsOf(def).find((lesson) => lesson.id === session.target)?.title ?? "Lesson"
			: session.kind === "checkpoint"
				? `${def.units.find((unit) => unit.id === session.target)?.title ?? "Unit"} checkpoint`
				: "Review";
	const of = new Set(session.queue).size;
	const answered = session.answers.filter((answer) => !answer.retry).length;
	return { kind: session.kind, target: session.target, title, at: Math.min(answered + 1, of), of };
}

export function cardView(loaded: LoadedPath, stored: StoredEnrollment | undefined): PathCardView {
	const { next, ...progress } = pathProgress(loaded.def, stored?.data ?? null);
	return {
		id: loaded.def.id,
		title: loaded.def.title,
		tagline: loaded.def.tagline,
		audience: loaded.def.audience,
		lessonCount: progress.total,
		done: progress.done,
		percent: progress.percent,
		started: Boolean(stored),
		personal: Boolean(loaded.curriculum),
		topic: loaded.topic,
		next: next ? { id: next.id, title: next.title, number: next.number } : null,
		resume: stored ? resumeOf(loaded.def, stored.data) : null,
		reviewCount: progress.reviewCount,
		updatedAt: (stored?.item.updatedAt ?? loaded.curriculum?.updatedAt)?.toISOString() ?? null,
	};
}

/** The hub: every written path and every personal curriculum, with the founder's progress. */
export async function hubView(userId: string): Promise<{ written: PathCardView[]; personal: PathCardView[] }> {
	const [enrollments, curricula] = await Promise.all([
		listEnrollments(userId),
		listBetaItems(userId, { module: PATHS_MODULE, kind: "curriculum", take: 50 }),
	]);
	const written = WRITTEN_PATHS.map((def) =>
		cardView({ def, curriculum: null, topic: null, written: new Set() }, enrollments.get(def.id))
	);
	const personal = curricula
		.map(loadedCurriculum)
		.filter((loaded): loaded is LoadedPath => loaded !== null)
		.map((loaded) => cardView(loaded, enrollments.get(loaded.def.id)));
	return { written, personal };
}

/** One path's map: units, lessons and their state, concepts and what is coming back. */
export async function pageView(userId: string, loaded: LoadedPath): Promise<PathPageView> {
	const [enrollments, learner] = await Promise.all([listEnrollments(userId), loadLearner(userId)]);
	const stored = enrollments.get(loaded.def.id);
	const progress = pathProgress(loaded.def, stored?.data ?? null);
	return {
		...cardView(loaded, stored),
		description: loaded.def.description,
		readAlong: loaded.def.readAlong,
		units: progress.units.map((unit) => ({
			...unit,
			lessons: unit.lessons.map((lesson) => ({
				id: lesson.id,
				number: lesson.number,
				title: lesson.title,
				summary: lesson.summary,
				reading: lesson.reading,
				state: lesson.state,
				score: lesson.score,
				written: loaded.written.has(lesson.id),
			})),
		})),
		concepts: pathConcepts(loaded.def, learner.data, stored?.data ?? null),
	};
}

function exerciseRefs(ex: PathExercise): string[] {
	if (ex.type === "order") return ex.steps.map((step) => step.answer);
	if (ex.type === "match") return ex.pairs.map((pair) => pair.answer);
	return [ex.answer];
}

/** One question as the browser renders it, with the verse that answers it. */
function exerciseView(ex: PathExercise, chapters: Chapters, fromReview: boolean): ExerciseView {
	const answer = (ref: string, label: string | null) => {
		const view = verseView(chapters, ref);
		if (!view) throw new Error(`Learning Paths: ${ex.id} cites ${ref}, which is not in the KJV`);
		return { ...view, label };
	};
	const base = { id: ex.id, type: ex.type, concept: ex.concept, level: ex.level, fromReview };
	if (ex.type === "choice") {
		const arranged = arrangedOptions(ex, ARRANGE)!;
		return { ...base, prompt: ex.prompt, options: arranged.options, answerIndex: arranged.answerIndex, answers: [answer(ex.answer, null)], note: ex.note ?? null };
	}
	if (ex.type === "blank") {
		const arranged = arrangedOptions(ex, ARRANGE)!;
		const verse = answer(ex.answer, null);
		const split = splitAroundBlank(verse.text, ex.word);
		if (!split) throw new Error(`Learning Paths: ${ex.id} blanks a word ${ex.answer} does not have`);
		return {
			...base,
			prompt: `Fill in the missing ${ex.word.includes(" ") ? "words" : "word"}.`,
			options: arranged.options,
			answerIndex: arranged.answerIndex,
			blank: { ref: verse.ref, before: split.before, after: split.after },
			answers: [verse],
			note: null,
		};
	}
	if (ex.type === "order") {
		const display = orderDisplay(ex, ARRANGE);
		return {
			...base,
			prompt: ex.prompt,
			items: display.map((place) => ex.steps[place].text),
			itemPlaces: display,
			answers: ex.steps.map((step) => answer(step.answer, step.text)),
			note: null,
		};
	}
	const display = matchDisplay(ex, ARRANGE);
	return {
		...base,
		prompt: ex.prompt,
		verses: ex.pairs.map((pair) => formatPassage(passageOf(pair.answer)!)),
		truths: display.map((pair) => ex.pairs[pair].truth),
		truthPairs: display,
		answers: ex.pairs.map((pair) => answer(pair.answer, pair.truth)),
		note: null,
	};
}

async function sessionView(loaded: LoadedPath, data: EnrollmentData, resumed: boolean): Promise<SessionView> {
	const session = data.active!;
	const index = exerciseIndex(loaded.def);
	const lesson = session.kind === "lesson" ? lessonsOf(loaded.def).find((entry) => entry.id === session.target) ?? null : null;
	const entries = [...new Set(session.queue)].map((id) => index.get(id)).filter((entry) => entry !== undefined);
	const chapters = await loadChapters([lesson?.reading, lesson?.keyVerse, lesson?.reflection.answer, ...entries.flatMap(({ ex }) => exerciseRefs(ex))]);
	const exercises: Record<string, ExerciseView> = {};
	for (const { ex } of entries) exercises[ex.id] = exerciseView(ex, chapters, session.fromReview.includes(ex.id));
	const reading = lesson ? passageOf(lesson.reading) : null;
	const readingVerses = reading ? versesOf(chapters, reading) : null;
	const reflectionVerse = lesson?.reflection.prompt ? verseView(chapters, lesson.reflection.answer) : null;
	const unit = session.kind === "checkpoint" ? loaded.def.units.find((entry) => entry.id === session.target) : null;
	return {
		pathId: loaded.def.id,
		pathTitle: loaded.def.title,
		sessionId: session.id,
		kind: session.kind,
		target: session.target,
		title: lesson?.title ?? (unit ? `${unit.title} checkpoint` : "Review what you missed"),
		queue: session.queue,
		index: session.index,
		total: new Set(session.queue).size,
		exercises,
		reading:
			lesson && reading && readingVerses
				? {
						ref: formatPassage(reading),
						book: reading.book,
						chapter: reading.chapter,
						verses: readingVerses.map((text, offset) => ({ n: reading.start + offset, text })),
						teaching: lesson.teaching,
					}
				: null,
		keyVerse: lesson ? verseView(chapters, lesson.keyVerse) : null,
		reflection: lesson && reflectionVerse ? { prompt: lesson.reflection.prompt, verse: reflectionVerse } : null,
		resumed,
	};
}

/* -------------------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------------- */

/**
 * Start a lesson, a unit checkpoint or a review, or pick up the one already
 * under way at the question it stopped on. `restart` begins it afresh.
 */
export async function startSession(userId: string, pathId: string, kind: SessionKind, rawTarget: string, restart: boolean): Promise<SessionView | PathsError> {
	const loaded = await loadPath(userId, pathId);
	if (!loaded) return { error: "Not found", status: 404 };
	const target = kind === "review" ? "" : rawTarget;
	if (kind === "lesson") {
		if (!lessonsOf(loaded.def).some((lesson) => lesson.id === target)) return { error: "Not found", status: 404 };
		if (!loaded.written.has(target)) return { error: "This lesson has not been written yet.", status: 409 };
	}
	if (kind === "checkpoint" && !loaded.def.units.some((unit) => unit.id === target)) return { error: "Not found", status: 404 };
	const [enrollments, learner] = await Promise.all([listEnrollments(userId), loadLearner(userId)]);
	const stored = enrollments.get(loaded.def.id) ?? null;
	const now = new Date().toISOString();
	let data = stored?.data ?? emptyEnrollment(loaded.def.id, now);
	const active = data.active;
	const index = exerciseIndex(loaded.def);
	if (!restart && active && active.kind === kind && active.target === target && active.queue.every((id) => index.has(id))) {
		return sessionView(loaded, data, active.answers.length > 0);
	}
	if (!canStart(pathProgress(loaded.def, data), kind, target)) {
		return { error: kind === "review" ? "There is nothing to review." : "Finish the lessons before this one first.", status: 409 };
	}
	const session = buildSession({ id: randomUUID(), now, path: loaded.def, kind, target, learner: learner.data, enrollment: data });
	if (!session) return { error: "There is nothing to ask here yet.", status: 409 };
	data = { ...data, active: session };
	await saveEnrollment(userId, loaded, stored?.item ?? null, data);
	return sessionView(loaded, data, false);
}

/**
 * Grade the current question of the founder's session, server side, with the
 * same rules the browser used for its instant feedback, then record it.
 */
export async function answerQuestion(userId: string, pathId: string, sessionId: string, exerciseId: string, response: unknown): Promise<AnswerResult | PathsError> {
	const loaded = await loadPath(userId, pathId);
	if (!loaded) return { error: "Not found", status: 404 };
	const [enrollments, learner] = await Promise.all([listEnrollments(userId), loadLearner(userId)]);
	const stored = enrollments.get(loaded.def.id);
	const active = stored?.data.active;
	// A second tab or a double tap: the browser reloads the session and carries on.
	if (!stored || !active || active.id !== sessionId || active.queue[active.index] !== exerciseId) {
		return { error: "This session moved on. Reloading it.", status: 409 };
	}
	const index = exerciseIndex(loaded.def);
	const entry = index.get(exerciseId);
	if (!entry) return { error: "This session moved on. Reloading it.", status: 409 };
	const graded = gradeResponse(entry.ex, response, ARRANGE);
	if (!graded) return { error: "That answer does not fit the question.", status: 400 };
	const now = new Date().toISOString();
	const outcome = recordAnswer({ learner: learner.data, enrollment: stored.data, exercise: entry.ex, lessonId: entry.lesson.id, ok: graded.ok, now });
	await saveEnrollment(userId, loaded, stored.item, outcome.enrollment);
	if (!outcome.retry) await saveLearner(userId, learner, outcome.learner);

	let finished: SessionSummary | null = null;
	if (outcome.finished) {
		const { next, ...progress } = pathProgress(loaded.def, outcome.enrollment);
		const touched = [...new Set(active.queue.map((id) => index.get(id)?.ex.concept).filter((concept): concept is string => Boolean(concept)))];
		finished = {
			...outcome.finished,
			concepts: touched.map((concept) => ({ concept, state: conceptState(outcome.learner.concepts[concept]) })),
			reviewCount: progress.reviewCount,
			next: next ? { id: next.id, title: next.title } : null,
			pathDone: progress.total > 0 && progress.done === progress.total,
		};
	}
	const session = outcome.enrollment.active;
	return {
		correct: graded.ok,
		parts: graded.parts,
		again: outcome.again,
		queue: session?.queue ?? active.queue,
		index: session?.index ?? active.queue.length,
		finished,
	};
}
