/**
 * SureWord Academy (LC-17660, docs/beta/academy.md): courses as deeper
 * Learning Paths. A lesson's three parts and when it is complete, the
 * milestones for each lesson, unit and course, what comes next, the final
 * review Paths gained for courses, the course content's own checks, and the
 * source contracts that keep Academy on the foundations it builds on.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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
	recordIsMissing,
	recordKey,
	recordMilestones,
	splitDuplicateRecords,
	unitMilestone,
	unrecordedMilestones,
} from "../src/lib/beta/academy/academy-rules.ts";
import { COURSE_LIMITS, courseLessonProblems, pathProblems } from "../src/lib/beta/paths/content-rules.ts";
import { FINAL_SIZE, buildSession, canStart, emptyEnrollment, pathProgress, readEnrollment, recordAnswer } from "../src/lib/beta/paths/progress-rules.ts";
import { answerIsGrounded, answerStandsOut, distractorContradictsVerse, foldWords, overlapWithVerse } from "../src/lib/quiz-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const NOW = "2026-10-27T10:00:00.000Z";
const LATER = "2026-10-28T10:00:00.000Z";

const books = JSON.parse(read("src/data/books.json"));
const byName = new Map(books.map((book) => [book.name, book]));
byName.set("Psalm", byName.get("Psalms"));
const kjvCache = new Map();
const deps = {
	resolveBook: (name) => byName.get(name) ?? null,
	verses: (passage) => {
		if (!kjvCache.has(passage.book)) kjvCache.set(passage.book, JSON.parse(read(join("src/data/kjv", books.find((book) => book.order === passage.book).file))));
		const chapter = kjvCache.get(passage.book)[passage.chapter - 1];
		return chapter && passage.end <= chapter.length ? chapter.slice(passage.start - 1, passage.end) : null;
	},
	answerIsGrounded,
	distractorContradictsVerse,
	answerStandsOut,
	foldWords,
	overlapWithVerse,
};

async function writtenCourses() {
	const dir = join(repoRoot, "src/lib/beta/paths/content");
	const out = [];
	for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
		const module = await import(pathToFileURL(join(dir, file)).href);
		for (const value of Object.values(module)) if (value?.units && value.course) out.push(value);
	}
	return out;
}

const ex = (id, type, extra = {}) => ({ id, type, concept: "faith", level: 2, ...extra });
const pool = (lessonId) => [
	ex(`${lessonId}.1`, "choice", { level: 1 }),
	ex(`${lessonId}.2`, "blank"),
	ex(`${lessonId}.3`, "order"),
	ex(`${lessonId}.4`, "match", { level: 3 }),
	ex(`${lessonId}.5`, "choice"),
];
const lesson = (id) => ({ id, title: `Lesson ${id}`, summary: "s", reading: "John 3:1-8", teaching: "t", keyVerse: "John 3:3", exercises: pool(id), reflection: { prompt: "p", answer: "John 3:3" }, course: { tutor: "John 3:1-8", focus: "f", memory: ["John 3:3"] } });
/** Two units of two lessons, as a course. */
function sampleCourse() {
	return {
		id: "c",
		title: "Sample Course",
		tagline: "t",
		description: "d",
		audience: "Growing",
		topics: ["faith"],
		readAlong: null,
		course: { outcomes: ["a", "b", "c"] },
		units: [
			{ id: "u1", title: "First", summary: "", lessons: [lesson("c-01"), lesson("c-02")] },
			{ id: "u2", title: "Second", summary: "", lessons: [lesson("c-03"), lesson("c-04")] },
		],
	};
}
const score = { at: NOW, right: 5, total: 6 };
/** An enrollment with these lessons and checkpoints answered. */
function enrollmentWith(lessons, checkpoints = [], final = false) {
	return {
		...emptyEnrollment("c", NOW),
		lessons: Object.fromEntries(lessons.map((id) => [id, score])),
		checkpoints: Object.fromEntries(checkpoints.map((id) => [id, score])),
		...(final ? { final: score } : {}),
	};
}

test("a lesson's three parts: locked with the lesson, then each done by its own module's record", () => {
	const base = { state: "current", score: null, quizUnderWay: false, tutor: [], memory: [{ inDeck: false }], completedAt: null };
	assert.deepEqual(lessonParts({ ...base, state: "locked" }), { quiz: "locked", tutor: "locked", memory: "locked", complete: false, partsDone: 0 });
	assert.deepEqual(lessonParts(base), { quiz: "open", tutor: "open", memory: "open", complete: false, partsDone: 0 });
	assert.equal(lessonParts({ ...base, quizUnderWay: true }).quiz, "started");
	assert.equal(lessonParts({ ...base, tutor: [{ finished: false }] }).tutor, "started", "a close reading under way is not done");
	assert.equal(lessonParts({ ...base, tutor: [{ finished: false }, { finished: true }] }).tutor, "done", "any checked conclusion on the passage counts");
	assert.equal(lessonParts({ ...base, memory: [{ inDeck: true }, { inDeck: false }] }).memory, "started", "every memory verse must be in the cards");
	const all = lessonParts({ ...base, state: "done", score, tutor: [{ finished: true }], memory: [{ inDeck: true }, { inDeck: true }] });
	assert.deepEqual(all, { quiz: "done", tutor: "done", memory: "done", complete: true, partsDone: 3 });
	assert.equal(lessonParts({ ...base, state: "done", score, memory: [] }).memory, "open", "a lesson with no memory verse is never done by default");
	// Recorded complete stays complete, even if a card was later removed in Learn a verse.
	assert.equal(lessonParts({ ...base, state: "done", score, tutor: [{ finished: true }], completedAt: NOW }).complete, true);
});

test("milestones: a lesson with every part done, a unit with its checkpoint, the course with its final review", () => {
	const course = sampleCourse();
	const allComplete = () => true;
	const none = () => false;
	let progress = pathProgress(course, enrollmentWith(["c-01", "c-02"]));
	assert.deepEqual(reachedMilestones(progress, (id) => id === "c-01"), [lessonMilestone("c-01")]);
	assert.deepEqual(reachedMilestones(progress, none), []);
	assert.deepEqual(reachedMilestones(progress, (id) => id === "c-01" || id === "c-02"), ["lesson:c-01", "lesson:c-02"], "no unit milestone before its checkpoint");
	progress = pathProgress(course, enrollmentWith(["c-01", "c-02"], ["u1"]));
	assert.deepEqual(reachedMilestones(progress, (id) => id === "c-01" || id === "c-02"), ["lesson:c-01", "lesson:c-02", unitMilestone("u1")]);
	assert.deepEqual(reachedMilestones(progress, (id) => id === "c-01"), ["lesson:c-01"], "the checkpoint alone does not finish a unit whose lessons are not complete");
	progress = pathProgress(course, enrollmentWith(["c-01", "c-02", "c-03", "c-04"], ["u1", "u2"]));
	assert.equal(reachedMilestones(progress, allComplete).includes(COURSE_MILESTONE), false, "the course needs its final review");
	progress = pathProgress(course, enrollmentWith(["c-01", "c-02", "c-03", "c-04"], ["u1", "u2"], true));
	assert.deepEqual(reachedMilestones(progress, allComplete), ["lesson:c-01", "lesson:c-02", "unit:u1", "lesson:c-03", "lesson:c-04", "unit:u2", "course"]);
});

test("recording milestones keeps the first time each was reached and adds only new ones", () => {
	const data = newCourseData("c", NOW);
	const first = recordMilestones(data, ["lesson:c-01"], NOW);
	const second = recordMilestones(first, ["lesson:c-01", "lesson:c-02"], LATER);
	assert.deepEqual(second.milestones, { "lesson:c-01": NOW, "lesson:c-02": LATER });
	assert.deepEqual(unrecordedMilestones(["lesson:c-01", "lesson:c-02", "unit:u1"], second.milestones), ["unit:u1"]);
	assert.deepEqual(unrecordedMilestones([], second.milestones), []);
	assert.equal(data.milestones["lesson:c-01"], undefined, "recording never changes the data it was given");
});

test("two requests that each wrote a course's record end with the same single record", () => {
	const key = recordKey({ courseId: "c", enrolledAt: NOW });
	const other = recordKey({ courseId: "c", enrolledAt: LATER });
	assert.notEqual(key, other, "starting a course over is a new enrollment, so a new record");
	const a = { id: "b-first", createdAt: "2026-10-27T10:00:01.000Z", key };
	const b = { id: "a-second", createdAt: "2026-10-27T10:00:02.000Z", key };
	const tie = { id: "a-tie", createdAt: "2026-10-27T10:00:01.000Z", key };
	const kept = { id: "z", createdAt: NOW, key: other };
	for (const order of [[a, b, kept], [b, kept, a], [kept, b, a]]) {
		const { keep, drop } = splitDuplicateRecords(order);
		assert.deepEqual(keep.map((r) => r.id).sort(), ["b-first", "z"], "the oldest copy is kept whatever order the requests read them in");
		assert.deepEqual(drop.map((r) => r.id), ["a-second"]);
	}
	assert.deepEqual(splitDuplicateRecords([a, tie]).keep.map((r) => r.id), ["a-tie"], "a tie goes to the lowest id");
});

test("a course recorded complete without its record asks for the record to be made", () => {
	const done = recordMilestones(newCourseData("c", NOW), ["lesson:c-01", "course"], LATER);
	assert.equal(recordIsMissing(done, []), true, "the record write failed");
	assert.equal(recordIsMissing(done, [recordKey(done)]), false, "its record exists");
	assert.equal(recordIsMissing(done, [recordKey({ courseId: "c", enrolledAt: "2026-01-01T00:00:00.000Z" })]), true, "a record of an earlier enrollment is not this one's");
	assert.equal(recordIsMissing(recordMilestones(newCourseData("c", NOW), ["lesson:c-01"], LATER), []), false, "not complete yet, nothing to make");
	assert.equal(recordIsMissing(null, []), false, "not enrolled");
});

test("milestones say what was finished, never how anyone is doing", () => {
	const course = sampleCourse();
	assert.equal(milestoneTitle(course, "lesson:c-03"), "Lesson 3 complete: Lesson c-03");
	assert.equal(milestoneTitle(course, "unit:u2"), "Unit 2 finished: Second");
	assert.equal(milestoneTitle(course, "course"), "You completed Sample Course");
	assert.equal(milestoneTitle(course, "unit:gone"), "Unit finished");
	const rules = read("src/lib/beta/academy/academy-rules.ts") + read("src/components/beta/academy/MilestoneSync.tsx") + read("src/components/beta/academy/RecordView.tsx");
	assert.equal(/\b(spiritual(ly)? (maturity|growth|level)|grade|ranking|mature believer)\b/i.test(rules.replace(/never grades anyone|never how/gi, "")), false, "no milestone grades anyone's walk");
});

test("what comes next: the first open lesson with a part left, then a checkpoint, then the final review", () => {
	const course = sampleCourse();
	let progress = pathProgress(course, null);
	assert.deepEqual(nextStep(progress, () => false), { kind: "lesson", lessonId: "c-01", number: 1, title: "Lesson c-01" });
	progress = pathProgress(course, enrollmentWith(["c-01"]));
	assert.deepEqual(nextStep(progress, () => false), { kind: "lesson", lessonId: "c-01", number: 1, title: "Lesson c-01" }, "lesson 1 still has its tutor and memory parts");
	assert.equal(nextStep(progress, (id) => id === "c-01").lessonId, "c-02");
	progress = pathProgress(course, enrollmentWith(["c-01", "c-02", "c-03", "c-04"]));
	assert.deepEqual(nextStep(progress, () => true), { kind: "checkpoint", unitId: "u1", title: "First" });
	progress = pathProgress(course, enrollmentWith(["c-01", "c-02", "c-03", "c-04"], ["u1", "u2"]));
	assert.deepEqual(nextStep(progress, () => true), { kind: "final" });
	progress = pathProgress(course, enrollmentWith(["c-01", "c-02", "c-03", "c-04"], ["u1", "u2"], true));
	assert.equal(nextStep(progress, () => true), null);
	assert.equal(lessonPlace(course, "c-03").number, 3);
	assert.equal(lessonPlace(course, "c-03").unitIndex, 1);
	assert.equal(lessonPlace(course, "c-04").next, null);
	assert.equal(lessonPlace(course, "nope"), null);
});

test("Academy's stored items are read defensively", () => {
	assert.equal(readCourseData(null), null);
	assert.equal(readCourseData({ courseId: "c" }), null);
	assert.equal(readCourseData({ courseId: "c", enrolledAt: NOW }, "other"), null, "an enrollment for another course is not this one");
	const data = readCourseData({ courseId: "c", enrolledAt: NOW, milestones: { "lesson:c-01": NOW, "bogus key": NOW, "unit:u1": 7, course: LATER }, cohort: { roomId: "x" } });
	assert.deepEqual(data, { v: 1, courseId: "c", enrolledAt: NOW, milestones: { "lesson:c-01": NOW, course: LATER } }, "anything else stored is dropped");
	assert.equal(readRecordData({ courseId: "c" }), null);
	const record = readRecordData({ courseId: "c", title: "T", enrolledAt: NOW, completedAt: LATER, units: [{ id: "u1", title: "U", lessons: [{ id: "c-01", title: "L", reading: "John 3:1-8", memory: ["John 3:3", 4], tutor: "John 3:1-8" }, "junk"] }] });
	assert.deepEqual(record.units[0].lessons, [{ id: "c-01", title: "L", reading: "John 3:1-8", memory: ["John 3:3"], tutor: "John 3:1-8", tutorSessionId: null, completedAt: null }]);
});

test("Paths' final review: only on a course, only after every checkpoint, drawn from every unit", () => {
	const course = sampleCourse();
	const learner = { v: 1, concepts: {} };
	let enrollment = enrollmentWith(["c-01", "c-02", "c-03", "c-04"], ["u1"]);
	let progress = pathProgress(course, enrollment);
	assert.equal(progress.final, "locked");
	assert.equal(canStart(progress, "final", ""), false);
	enrollment = enrollmentWith(["c-01", "c-02", "c-03", "c-04"], ["u1", "u2"]);
	progress = pathProgress(course, enrollment);
	assert.equal(progress.final, "open");
	assert.equal(canStart(progress, "final", ""), true);
	const session = buildSession({ id: "s", now: NOW, path: course, kind: "final", target: "ignored", learner, enrollment });
	assert.equal(session.target, "");
	assert.equal(session.queue.length, Math.min(FINAL_SIZE, 20), "the sample has 20 questions, fewer than a full final review");
	for (const unit of course.units) {
		const ids = new Set(unit.lessons.flatMap((entry) => entry.exercises.map((item) => item.id)));
		assert.ok(session.queue.some((id) => ids.has(id)), `the final review asks from ${unit.id}`);
	}
	// Answering every question right records the final review's score.
	let state = { ...enrollment, active: session };
	let learnerState = learner;
	for (const id of session.queue) {
		const exercise = course.units.flatMap((unit) => unit.lessons).flatMap((entry) => entry.exercises).find((item) => item.id === id);
		const outcome = recordAnswer({ learner: learnerState, enrollment: state, exercise, lessonId: id.split(".")[0], ok: true, now: LATER });
		state = outcome.enrollment;
		learnerState = outcome.learner;
	}
	assert.deepEqual(state.final, { at: LATER, right: session.queue.length, total: session.queue.length });
	assert.equal(state.active, null);
	assert.equal(pathProgress(course, state).final, "done");
	assert.deepEqual(readEnrollment(JSON.parse(JSON.stringify(state)), "c", NOW).final, state.final, "the score survives the store");
	// A path is unchanged: it has no final review.
	const path = { ...course, course: undefined };
	assert.equal(pathProgress(path, enrollment).final, "none");
	assert.equal(buildSession({ id: "s", now: NOW, path, kind: "final", target: "", learner, enrollment }), null);
	assert.equal("final" in readEnrollment(emptyEnrollment("c", NOW), "c", NOW), false, "enrollments written before courses read the same");
});

test("the course content checks catch a lesson that would not work in Academy", () => {
	const good = { id: "x-01", keyVerse: "John 3:3", course: { tutor: "John 3:1-8", focus: "Notice what Jesus says a man must be before he can see the kingdom of God.", memory: ["John 3:3", "John 3:16"] } };
	assert.deepEqual(courseLessonProblems(good, deps), []);
	assert.match(courseLessonProblems({ id: "x-01", keyVerse: "John 3:3" }, deps).join(), /needs its tutor passage and memory verses/);
	const problems = (course) => courseLessonProblems({ ...good, course: { ...good.course, ...course } }, deps).join("\n");
	assert.match(problems({ tutor: "John 3:1-36" }), /longer than 30 verses/);
	assert.match(problems({ tutor: "John 3:1-2" }), /at least 3 verses/);
	assert.match(problems({ tutor: "John 3:30-40" }), /runs past the end of the chapter/);
	assert.match(problems({ memory: ["John 3:16"] }), /key verse John 3:3 must be one of the memory verses/);
	assert.match(problems({ memory: ["John 3:1-7"] }), /longer than 6 verses/);
	assert.match(problems({ memory: ["John 3:2-3", "John 3:3-4"] }), /overlaps another one/);
	assert.match(problems({ memory: [] }), /needs 1 to 3 memory verses/);
	assert.match(problems({ memory: ["John 3:3", "John 3:16", "John 3:17", "John 3:18"] }), /needs 1 to 3 memory verses/);
	assert.match(problems({ focus: "Too short" }), /shorter than 30/);
	assert.match(problems({ focus: "Notice the words — of Jesus in verse three, and what they mean for us." }), /dash or markdown/);
	assert.ok(COURSE_LIMITS.tutorMaxVerses === 30 && COURSE_LIMITS.memoryVerses === 6, "the limits are the tutor's and Scripture Memory's own");
});

test("the three courses the issue names exist, each complete and checked against the KJV", async () => {
	const courses = await writtenCourses();
	const titles = courses.map((course) => course.title);
	for (const title of ["Old Testament Survey", "New Testament Survey", "The Doctrines of the Faith"]) assert.ok(titles.includes(title), `missing course: ${title}`);
	for (const course of courses) {
		const lessons = course.units.flatMap((unit) => unit.lessons);
		assert.ok(lessons.length >= 8, `${course.id}: at least 8 lessons`);
		for (const entry of lessons) {
			assert.ok(entry.course, `${entry.id}: tutor passage and memory verses`);
			assert.ok(entry.exercises.length >= 7, `${entry.id}: a short quiz`);
		}
		const problems = pathProblems(course, deps);
		assert.deepEqual(problems, [], `${course.id}:\n  ${problems.join("\n  ")}`);
	}
	const catalog = read("src/lib/beta/paths/catalog.ts");
	assert.match(catalog, /WRITTEN_COURSES: readonly PathDef\[\] = \[OT_SURVEY_COURSE, NT_SURVEY_COURSE, DOCTRINES_COURSE\]/);
	assert.match(catalog, /WRITTEN_PATHS: readonly PathDef\[\] = \[FOUNDATIONS_PATH, ROMANS_PATH, READING_SCRIPTURE_PATH, LIFE_OF_PAUL_PATH\]/, "courses are not listed among the paths");
});

function filesUnder(relativeDir) {
	const root = join(repoRoot, relativeDir);
	if (!existsSync(root)) return [];
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else out.push(relative(repoRoot, full));
		}
	};
	walk(root);
	return out;
}

test("Academy builds on Paths, the tutor and Scripture Memory instead of beside them", () => {
	const own = [...filesUnder("src/lib/beta/academy"), ...filesUnder("src/components/beta/academy"), ...filesUnder("src/app/beta/learn/academy"), ...filesUnder("src/app/api/beta/academy")];
	assert.ok(own.length >= 15, "Academy's own files");
	for (const file of own) {
		const source = read(file);
		assert.equal(/from "@\/lib\/ai|generateText|streamText|withIncludedAiRequest/.test(source), false, `${file}: Academy calls no model of its own; the tutor's route does`);
		assert.equal(/prisma\./.test(source), false, `${file}: Academy reads and writes only through the study store and the modules it builds on`);
	}
	const server = read("src/lib/beta/academy/academy.ts");
	assert.match(server, /memoryOverview\(userId\)/, "memory verses are read from Scripture Memory");
	assert.match(server, /listSessions\(userId\)/, "close readings are read from the tutor");
	assert.match(server, /pathProgress\(def, enrollment\)/, "progress is Paths' own");
	assert.match(read("src/components/beta/academy/TutorPart.tsx"), /tutorApi\.start\(passage, level\)/, "a close reading starts through the tutor's own route");
	assert.match(read("src/components/beta/academy/MemoryPart.tsx"), /addCards\(ref, "suggestion"\)/, "a memory verse is added through Scripture Memory's own route");
	assert.match(read("src/app/beta/learn/academy/[courseId]/[step]/quiz/page.tsx"), /<LessonPlayer/, "a lesson's questions are Paths' own player");
	const tutor = read("src/components/beta/tutor/TutorSession.tsx");
	assert.match(tutor, /back = TUTOR_HOME/, "the tutor's own screen is unchanged by default");
	assert.match(tutor, /const TUTOR_HOME = \{ href: "\/beta\/study\/tutor", label: "Socratic Tutor" \}/);
	const sync = read("src/components/beta/academy/MilestoneSync.tsx");
	assert.match(sync, /useEffect/, "milestones are recorded by a request after the page opens, never while rendering");
});
