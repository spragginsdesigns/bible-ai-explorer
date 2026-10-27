/**
 * Learning Paths progress and personal curricula (LC-17648,
 * docs/beta/paths.md): the adaptive choice of questions, grading on the
 * server and in the browser agreeing for every written exercise, mastery and
 * the review list, the path map's locks, and the checks a generated
 * curriculum must pass before it reaches a founder.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	buildSession,
	canStart,
	conceptState,
	emptyEnrollment,
	exerciseIndex,
	gradeResponse,
	LESSON_SIZE,
	learnerSummary,
	matchDisplay,
	orderDisplay,
	arrangedOptions,
	pathProgress,
	readEnrollment,
	readLearner,
	recordAnswer,
	reviewPicks,
	scramble,
	selectExercises,
	targetLevel,
	updateConcept,
} from "../src/lib/beta/paths/progress-rules.ts";
import { answeredCount, conceptTitle, draftResponse, emptyDraft, groupAnswers, isRetry, localGrade, placeTruth, toggleOrder } from "../src/lib/beta/paths/player-rules.ts";
import { checkLessonDraft, checkOutline, cleanTopic, conceptLabel, lessonConcept, parsePassage, plainText, readCurriculum, withWrittenLesson } from "../src/lib/beta/paths/content-rules.ts";
import { answerIsGrounded, answerStandsOut, arrangeOptions, distractorContradictsVerse, foldWords, overlapWithVerse, seedHash } from "../src/lib/quiz-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARRANGE = { arrangeOptions, seedHash };
const NOW = "2026-10-27T10:00:00.000Z";
const LATER = "2026-10-27T10:05:00.000Z";

const books = JSON.parse(readFileSync(join(repoRoot, "src/data/books.json"), "utf8"));
const byName = new Map(books.map((book) => [book.name, book]));
byName.set("Psalm", byName.get("Psalms"));
const deps = {
	resolveBook: (name) => byName.get(name) ?? null,
	verses: (passage) => {
		const book = books.find((entry) => entry.order === passage.book);
		const chapter = JSON.parse(readFileSync(join(repoRoot, "src/data/kjv", book.file), "utf8"))[passage.chapter - 1];
		return chapter && passage.end <= chapter.length ? chapter.slice(passage.start - 1, passage.end) : null;
	},
	answerIsGrounded,
	distractorContradictsVerse,
	answerStandsOut,
	foldWords,
	overlapWithVerse,
};

async function writtenPaths() {
	const dir = join(repoRoot, "src/lib/beta/paths/content");
	const out = [];
	for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
		const module = await import(pathToFileURL(join(dir, file)).href);
		for (const value of Object.values(module)) if (value?.units) out.push(value);
	}
	return out;
}

const ex = (id, type, concept, level, extra = {}) => ({ id, type, concept, level, ...extra });
const choice = (id, concept, level) => ex(id, "choice", concept, level, { prompt: "q", correct: "a", wrong: ["b", "c", "d"], answer: "John 3:16" });
const blank = (id, concept, level) => ex(id, "blank", concept, level, { answer: "John 3:16", word: "world", wrong: ["earth", "land", "people"] });
const order = (id, concept, level) => ex(id, "order", concept, level, { prompt: "q", steps: [{ text: "a", answer: "John 3:16" }, { text: "b", answer: "John 3:16" }, { text: "c", answer: "John 3:16" }] });
const match = (id, concept, level) => ex(id, "match", concept, level, { prompt: "q", pairs: [{ answer: "John 3:16", truth: "a" }, { answer: "John 3:17", truth: "b" }, { answer: "John 3:18", truth: "c" }] });

const POOL = [choice("p-01.1", "faith", 1), blank("p-01.2", "faith", 1), choice("p-01.3", "faith", 2), order("p-01.4", "grace", 2), choice("p-01.5", "grace", 1), blank("p-01.6", "faith", 3), match("p-01.7", "grace", 3), choice("p-01.8", "faith", 3)];

function samplePath() {
	const lesson = (n, pool) => ({ id: `p-0${n}`, title: `Lesson ${n}`, summary: "s", reading: "John 3:14-18", teaching: "t", keyVerse: "John 3:16", exercises: pool, reflection: { prompt: "r", answer: "John 3:16" } });
	const relabel = (n) => POOL.map((entry) => ({ ...entry, id: entry.id.replace("p-01", `p-0${n}`) }));
	return {
		id: "p",
		title: "Sample",
		tagline: "t",
		description: "d",
		audience: "Growing",
		topics: ["sample"],
		readAlong: null,
		units: [
			{ id: "u1", title: "One", summary: "", lessons: [lesson(1, relabel(1)), lesson(2, relabel(2))] },
			{ id: "u2", title: "Two", summary: "", lessons: [lesson(3, relabel(3))] },
		],
	};
}

test("a concept is asked at its level: foundations first, deeper once mastered", () => {
	assert.equal(targetLevel(undefined), 1);
	assert.equal(targetLevel({ s: 2, r: 2, w: 0, at: NOW }), 2);
	assert.equal(targetLevel({ s: 4, r: 4, w: 0, at: NOW }), 3);
	assert.equal(conceptState(undefined), "new");
	assert.equal(conceptState({ s: 0, r: 0, w: 1, at: NOW }), "learning");
	assert.equal(conceptState({ s: 5, r: 6, w: 1, at: NOW }), "mastered");
	assert.deepEqual(updateConcept(undefined, true, NOW), { s: 1, r: 1, w: 0, at: NOW });
	assert.deepEqual(updateConcept({ s: 3, r: 3, w: 0, at: NOW }, false, LATER), { s: 1, r: 3, w: 1, at: LATER });
	assert.equal(updateConcept({ s: 5, r: 9, w: 0, at: NOW }, true, NOW).s, 5, "strength tops out at 5");
	assert.equal(updateConcept({ s: 1, r: 1, w: 0, at: NOW }, false, NOW).s, 0, "and never goes below 0");
});

test("a new learner gets every exercise type at the foundation level", () => {
	const chosen = selectExercises(POOL, {}, LESSON_SIZE);
	assert.equal(chosen.length, LESSON_SIZE);
	assert.deepEqual(new Set(chosen.map((entry) => entry.type)), new Set(["choice", "blank", "order", "match"]));
	assert.deepEqual(chosen.map((entry) => entry.id), [...chosen.map((entry) => entry.id)].sort(), "kept in the order the lesson was written");
	assert.ok(chosen.some((entry) => entry.id === "p-01.1") && chosen.some((entry) => entry.id === "p-01.5"), "level 1 questions are asked");
	assert.ok(!chosen.some((entry) => entry.id === "p-01.8"), "the deepest choice waits");
});

test("mastered concepts advance: their first rung is skipped and the deeper ones asked", () => {
	const mastered = { faith: { s: 5, r: 8, w: 0, at: NOW }, grace: { s: 5, r: 8, w: 0, at: NOW } };
	const chosen = selectExercises(POOL, mastered, LESSON_SIZE).map((entry) => entry.id);
	for (const id of ["p-01.6", "p-01.7", "p-01.8", "p-01.3", "p-01.4"]) assert.ok(chosen.includes(id), `${id} asked`);
	assert.ok(!chosen.includes("p-01.1") || !chosen.includes("p-01.5"), "level 1 is only used to fill");
	const mixed = selectExercises(POOL, { grace: { s: 5, r: 8, w: 0, at: NOW } }, 4).map((entry) => entry.id);
	assert.ok(mixed.includes("p-01.1"), "faith is still new, so its foundation question comes first");
	assert.ok(!mixed.includes("p-01.5"), "grace is mastered, so its foundation question does not");
});

test("missed questions come back in later lessons, oldest first, never from the lesson itself", () => {
	const review = [
		{ ex: "p-01.3", lesson: "p-01", at: "2026-10-27T09:00:00.000Z", misses: 1 },
		{ ex: "p-02.4", lesson: "p-02", at: "2026-10-27T08:00:00.000Z", misses: 2 },
		{ ex: "p-01.6", lesson: "p-01", at: "2026-10-27T09:30:00.000Z", misses: 1 },
		{ ex: "gone.1", lesson: "gone", at: "2026-10-27T07:00:00.000Z", misses: 1 },
	];
	const index = exerciseIndex(samplePath());
	assert.deepEqual(reviewPicks(review, "p-03", 2, (id) => index.has(id)), ["p-02.4", "p-01.3"]);
	assert.deepEqual(reviewPicks(review, "p-01", 5, (id) => index.has(id)), ["p-02.4"]);
	const enrollment = { ...emptyEnrollment("p", NOW), lessons: { "p-01": { at: NOW, right: 5, total: 6 }, "p-02": { at: NOW, right: 6, total: 6 } }, review };
	const session = buildSession({ id: "s1", now: NOW, path: samplePath(), kind: "lesson", target: "p-03", learner: { v: 1, concepts: {} }, enrollment });
	assert.equal(session.queue.length, LESSON_SIZE + 2);
	assert.deepEqual(session.fromReview, ["p-02.4", "p-01.3"]);
	const reviewSession = buildSession({ id: "s2", now: NOW, path: samplePath(), kind: "review", target: "anything", learner: { v: 1, concepts: {} }, enrollment });
	assert.deepEqual(reviewSession.queue, ["p-02.4", "p-01.3", "p-01.6"]);
	assert.equal(reviewSession.target, "");
	const checkpoint = buildSession({ id: "s3", now: NOW, path: samplePath(), kind: "checkpoint", target: "u1", learner: { v: 1, concepts: {} }, enrollment });
	assert.equal(checkpoint.queue.length, 8);
	assert.ok(checkpoint.queue.every((id) => id.startsWith("p-01.") || id.startsWith("p-02.")), "a checkpoint asks only its own unit");
	assert.equal(buildSession({ id: "s4", now: NOW, path: samplePath(), kind: "lesson", target: "nope", learner: { v: 1, concepts: {} }, enrollment }), null);
	assert.equal(buildSession({ id: "s5", now: NOW, path: samplePath(), kind: "review", target: "", learner: { v: 1, concepts: {} }, enrollment: emptyEnrollment("p", NOW) }), null);
});

test("a miss is asked again once, goes on the review list, and only a first-try right clears it", () => {
	const path = samplePath();
	const index = exerciseIndex(path);
	let learner = { v: 1, concepts: {} };
	let enrollment = { ...emptyEnrollment("p", NOW), active: { id: "s1", kind: "lesson", target: "p-01", queue: ["p-01.1", "p-01.2"], fromReview: [], index: 0, answers: [], startedAt: NOW } };
	const answer = (id, ok, now = NOW) => {
		const outcome = recordAnswer({ learner, enrollment, exercise: index.get(id).ex, lessonId: index.get(id).lesson.id, ok, now });
		learner = outcome.learner;
		enrollment = outcome.enrollment;
		return outcome;
	};
	let outcome = answer("p-01.1", false);
	assert.equal(outcome.again, true);
	assert.deepEqual(enrollment.active.queue, ["p-01.1", "p-01.2", "p-01.1"]);
	assert.deepEqual(enrollment.review.map((entry) => entry.ex), ["p-01.1"]);
	assert.equal(learner.concepts.faith.w, 1);
	outcome = answer("p-01.2", true);
	assert.equal(outcome.finished, null);
	outcome = answer("p-01.1", true, LATER);
	assert.equal(outcome.retry, true);
	assert.equal(learner.concepts.faith.r, 1, "the second try does not count toward mastery");
	assert.deepEqual(enrollment.review.map((entry) => entry.ex), ["p-01.1"], "seeing the answer and repeating it does not clear the miss");
	assert.deepEqual(outcome.finished.score, { at: LATER, right: 1, total: 2 });
	assert.equal(enrollment.active, null);
	assert.deepEqual(enrollment.lessons["p-01"], { at: LATER, right: 1, total: 2 });
	assert.equal(enrollment.lastLesson, "p-01");

	enrollment = { ...enrollment, active: { id: "s2", kind: "review", target: "", queue: ["p-01.1"], fromReview: ["p-01.1"], index: 0, answers: [], startedAt: LATER } };
	outcome = answer("p-01.1", true, LATER);
	assert.deepEqual(enrollment.review, [], "answered right the first time in review, it is cleared");
	assert.equal(outcome.finished.kind, "review");
	assert.deepEqual(enrollment.lessons["p-01"], { at: LATER, right: 1, total: 2 }, "a review does not rewrite the lesson score");
});

test("the map opens lessons one after another, then the unit checkpoint", () => {
	const path = samplePath();
	let progress = pathProgress(path, null);
	assert.deepEqual(progress.units.flatMap((unit) => unit.lessons.map((lesson) => lesson.state)), ["current", "locked", "locked"]);
	assert.equal(progress.next.id, "p-01");
	assert.equal(progress.units[0].checkpoint, "locked");
	assert.equal(canStart(progress, "lesson", "p-02"), false);
	assert.equal(canStart(progress, "review", ""), false);
	const enrollment = { ...emptyEnrollment("p", NOW), lessons: { "p-01": { at: NOW, right: 6, total: 6 }, "p-02": { at: NOW, right: 4, total: 6 } }, review: [{ ex: "p-02.1", lesson: "p-02", at: NOW, misses: 1 }] };
	progress = pathProgress(path, enrollment);
	assert.deepEqual(progress.units.flatMap((unit) => unit.lessons.map((lesson) => lesson.state)), ["done", "done", "current"]);
	assert.equal(progress.units[0].checkpoint, "open");
	assert.equal(progress.percent, 67);
	assert.equal(progress.reviewCount, 1);
	assert.equal(canStart(progress, "lesson", "p-01"), true, "a done lesson can be taken again");
	assert.equal(canStart(progress, "checkpoint", "u1"), true);
	assert.equal(canStart(progress, "checkpoint", "u2"), false);
	assert.equal(canStart(progress, "review", ""), true);
});

test("stored progress is read defensively: junk and foreign paths start clean", () => {
	assert.deepEqual(readEnrollment(null, "p", NOW), emptyEnrollment("p", NOW));
	assert.deepEqual(readEnrollment({ pathId: "other", lessons: { "p-01": { at: NOW, right: 1, total: 1 } } }, "p", NOW), emptyEnrollment("p", NOW));
	const read = readEnrollment(
		{
			pathId: "p",
			startedAt: NOW,
			lessons: { "p-01": { at: NOW, right: 5, total: 6 }, bad: { right: "x" } },
			review: [{ ex: "p-01.1", lesson: "p-01", at: NOW, misses: 1 }, { ex: 3 }],
			active: { id: "s", kind: "lesson", target: "p-01", queue: ["p-01.1"], fromReview: [], index: 4, answers: [], startedAt: NOW },
		},
		"p",
		NOW
	);
	assert.deepEqual(Object.keys(read.lessons), ["p-01"]);
	assert.equal(read.review.length, 1);
	assert.equal(read.active, null, "a session past its own end is dropped");
	assert.deepEqual(readLearner({ concepts: { faith: { s: 9, r: 2.7, w: -1, at: NOW }, bad: 1 } }), { v: 1, concepts: { faith: { s: 5, r: 2, w: 0, at: NOW } } });
	assert.match(learnerSummary({ v: 1, concepts: { faith: { s: 5, r: 5, w: 0, at: NOW }, grace: { s: 2, r: 2, w: 0, at: NOW } } }), /Mastered: faith\.\nGrowing: grace\./);
});

test("the browser's instant grade agrees with the server's for every written exercise", async () => {
	const paths = await writtenPaths();
	assert.ok(paths.length >= 1);
	let checked = 0;
	for (const path of paths) {
		for (const lesson of path.units.flatMap((unit) => unit.lessons)) {
			for (const exercise of lesson.exercises) {
				const view = { type: exercise.type };
				const responses = [];
				if (exercise.type === "choice" || exercise.type === "blank") {
					const arranged = arrangedOptions(exercise, ARRANGE);
					view.answerIndex = arranged.answerIndex;
					assert.equal(arranged.options[arranged.answerIndex], exercise.type === "choice" ? exercise.correct : exercise.word);
					responses.push({ choice: arranged.answerIndex }, { choice: (arranged.answerIndex + 1) % 4 });
				} else if (exercise.type === "order") {
					view.itemPlaces = orderDisplay(exercise, ARRANGE);
					view.items = view.itemPlaces.map((place) => exercise.steps[place].text);
					assert.notDeepEqual(view.itemPlaces, view.itemPlaces.map((_, i) => i), `${exercise.id} is never shown already in order`);
					const right = view.itemPlaces.map((_, place) => view.itemPlaces.indexOf(place));
					responses.push({ order: right }, { order: [...right].reverse() });
				} else {
					view.truthPairs = matchDisplay(exercise, ARRANGE);
					view.verses = exercise.pairs.map((pair) => pair.answer);
					const right = exercise.pairs.map((_, pair) => view.truthPairs.indexOf(pair));
					responses.push({ pairs: right }, { pairs: [right[1], right[0], ...right.slice(2)] });
				}
				for (const [index, response] of responses.entries()) {
					const server = gradeResponse(exercise, response, ARRANGE);
					const browser = localGrade(view, response);
					assert.deepEqual(browser, { correct: server.ok, parts: server.parts }, `${exercise.id} response ${index}`);
					assert.equal(server.ok, index === 0, `${exercise.id}: the right response is right and the other is not`);
				}
				checked += 1;
			}
		}
	}
	assert.ok(checked >= 90, `checked ${checked} exercises`);
});

test("the server refuses responses that do not fit the question", () => {
	const orderEx = { id: "x.1", type: "order", concept: "c", level: 1, prompt: "p", steps: [{ text: "a", answer: "John 3:16" }, { text: "b", answer: "John 3:16" }, { text: "c", answer: "John 3:16" }] };
	for (const bad of [null, {}, { order: [0, 1] }, { order: [0, 0, 1] }, { order: [0, 1, 7] }, { choice: 1 }, { order: "012" }]) {
		assert.equal(gradeResponse(orderEx, bad, ARRANGE), null, JSON.stringify(bad));
	}
	const choiceEx = { id: "x.2", type: "choice", concept: "c", level: 1, prompt: "p", correct: "a", wrong: ["b", "c", "d"], answer: "John 3:16" };
	for (const bad of [{ choice: 4 }, { choice: -1 }, { choice: 1.5 }, { choice: "1" }]) assert.equal(gradeResponse(choiceEx, bad, ARRANGE), null, JSON.stringify(bad));
	assert.deepEqual(scramble(1, "seed", ARRANGE), [0]);
	assert.equal(new Set(scramble(5, "seed", ARRANGE)).size, 5);
});

test("the player's taps build the response the API takes", () => {
	assert.deepEqual(toggleOrder([2, 0], 1), [2, 0, 1]);
	assert.deepEqual(toggleOrder([2, 0, 1], 0), [2, 1]);
	assert.deepEqual(placeTruth([null, null, null], 2, null), [2, null, null], "no verse chosen fills the first empty one");
	assert.deepEqual(placeTruth([2, null, null], 2, 1), [null, 2, null], "a truth moves rather than belonging to two verses");
	assert.deepEqual(placeTruth([0, 1, 2], 1, null), [0, 1, 2], "with every verse full and none chosen, nothing moves");
	const orderView = { type: "order", items: ["a", "b", "c"], itemPlaces: [2, 0, 1] };
	assert.equal(draftResponse(orderView, { type: "order", order: [1, 2] }), null);
	assert.deepEqual(draftResponse(orderView, { type: "order", order: [1, 2, 0] }), { order: [1, 2, 0] });
	assert.deepEqual(localGrade(orderView, { order: [1, 2, 0] }), { correct: true, parts: [true, true, true] });
	const matchView = { type: "match", verses: ["A", "B", "C"], truths: ["x", "y", "z"], truthPairs: [1, 2, 0] };
	assert.deepEqual(emptyDraft(matchView), { type: "match", pairs: [null, null, null] });
	assert.equal(draftResponse(matchView, { type: "match", pairs: [2, null, 1] }), null);
	assert.deepEqual(localGrade(matchView, { pairs: [2, 0, 1] }), { correct: true, parts: [true, true, true] });
	assert.deepEqual(localGrade(matchView, { pairs: [0, 2, 1] }), { correct: false, parts: [false, false, true] });
	assert.equal(isRetry(["a", "b", "a"], 2), true);
	assert.equal(isRetry(["a", "b", "a"], 1), false);
	assert.equal(answeredCount(["a", "b", "a"], 3), 2);
});

test("a topic is tidied, and nonsense or overlong topics are refused", () => {
	assert.equal(cleanTopic("  the   Holy Spirit "), "the Holy Spirit");
	assert.equal(cleanTopic("<script>covenants</script>"), "script covenants /script");
	for (const bad of ["", "  ", "ab", "1234", "!!!", "x".repeat(81), null, 7]) assert.equal(cleanTopic(bad), null, String(bad));
	assert.equal(plainText("Grace **alone** — through faith", 100), "Grace alone, through faith");
	assert.equal(conceptLabel("The Holy Spirit!", "x"), "the holy spirit");
	assert.equal(conceptLabel("??", "Covenants"), "covenants");
});

test("a generated outline keeps only real passages, foundations first, and needs four lessons", () => {
	const lesson = (title, reading, keyVerse = "", concept = "covenant") => ({ title, summary: `${title}.`, reading, keyVerse, concept });
	const draft = {
		title: "The Covenants",
		description: "Foundations first.",
		units: [
			{ title: "Foundations", summary: "Who God is", lessons: [lesson("God keeps covenant", "Deuteronomy 7:6-11", "Deuteronomy 7:9"), lesson("Made up", "Hezekiah 1:1-5"), lesson("Too long", "Psalms 119:1-40")] },
			{ title: "The covenants", summary: "", lessons: [lesson("Noah", "Genesis 9:8-17", "Genesis 9:13"), lesson("Abraham", "Genesis 15:1-6", "John 3:16"), lesson("A new covenant", "Jeremiah 31:31-34", "Jeremiah 31:33", "The NEW covenant")] },
		],
	};
	const checked = checkOutline(draft, "the covenants", deps, "model-x");
	assert.equal("error" in checked, false);
	assert.deepEqual(checked.units.map((unit) => unit.lessons.map((entry) => entry.reading)), [["Deuteronomy 7:6-11"], ["Genesis 9:8-17", "Genesis 15:1-6", "Jeremiah 31:31-34"]]);
	assert.deepEqual(checked.units.flatMap((unit) => unit.lessons.map((entry) => entry.id)), ["lesson-01", "lesson-02", "lesson-03", "lesson-04"]);
	assert.equal(checked.units[1].lessons[1].keyVerse, "Genesis 15:1", "a key verse outside its passage falls back to the passage's first verse");
	assert.equal(checked.units[1].lessons[2].concept, "the new covenant");
	assert.equal(checked.units[0].id, "unit-1");
	const thin = checkOutline({ ...draft, units: [draft.units[0]] }, "the covenants", deps, null);
	assert.deepEqual(thin, { error: "too_few_lessons" });
	const read = readCurriculum(checked, "c-abc12345");
	assert.equal(read.path.id, "c-abc12345");
	assert.equal(read.path.units[1].lessons.length, 3);
	assert.equal(lessonConcept(read.path.units[0].lessons[0], "the covenants"), "covenant");
	assert.equal(readCurriculum({ v: 2 }, "c-x"), null);
	assert.equal(readCurriculum(null, "c-x"), null);
});

test("a generated lesson keeps only questions the verse answers, from inside its reading", () => {
	const outline = checkOutline(
		{
			title: "Love",
			description: "d",
			units: [{ title: "F", summary: "", lessons: ["1 John 4:7-12", "1 John 4:13-19", "John 3:14-18", "Romans 5:6-11"].map((reading, n) => ({ title: `L${n}`, summary: "s", reading, keyVerse: "", concept: "love" })) }],
		},
		"love",
		deps,
		null
	);
	const lesson = outline.units[0].lessons[0];
	const draft = {
		teaching: "John writes that love comes from God, because God is love. He showed it by sending His Son to be the propitiation for our sins.",
		choice: [
			{ prompt: "Where is love of, according to John?", correct: "Love is of God", wrong: ["Love is of man", "Love is of the law", "Love is of the world"], verses: [7], level: 1, note: null },
			{ prompt: "What is God, according to verse 8?", correct: "God is love", wrong: ["God is distant", "God is silent", "God is unknown"], verses: [8], level: 1, note: null },
			{ prompt: "Why did God send His Son?", correct: "To be the propitiation for our sins", wrong: ["To condemn the world for its sin", "To found an earthly kingdom", "To judge the angels that fell"], verses: [10], level: 2, note: "Love is seen at the cross." },
			{ prompt: "Outside the reading", correct: "For God so loved the world", wrong: ["a", "b", "c"], verses: [2], level: 1, note: null },
			{ prompt: "Ungrounded", correct: "The angels asked him to", wrong: ["The prophets foretold it", "The elders begged him", "The people cried out"], verses: [9], level: 1, note: null },
		],
		blank: [{ verse: 8, word: "love", wrong: ["light", "life", "truth"], level: 1 }, { verse: 9, word: "only begotten Son", wrong: ["firstborn", "servant", "prophet"], level: 2 }],
		order: { prompt: "In the order John gives them", steps: [{ text: "Love is of God", verse: 7 }, { text: "God is love", verse: 8 }, { text: "God sent his only begotten Son", verse: 9 }], level: 2 },
		match: { prompt: "Match each verse", pairs: [{ verse: 7, truth: "Every one that loveth is born of God" }, { verse: 12, truth: "No man hath seen God at any time" }, { verse: 10, truth: "He loved us and sent his Son" }], level: 3 },
		reflection: { verse: 11, prompt: "Who could you love today as God has loved you?" },
	};
	const result = checkLessonDraft(draft, lesson, "love", deps);
	assert.equal("error" in result, false, JSON.stringify(result));
	const kept = result.lesson.exercises;
	assert.deepEqual(kept.map((entry) => entry.type), ["choice", "choice", "choice", "blank", "blank", "order", "match"]);
	assert.ok(kept.every((entry) => entry.concept === "love" && entry.id.startsWith("lesson-01.")));
	assert.ok(result.dropped.some((reason) => /outside the reading/.test(reason)));
	assert.ok(result.dropped.some((reason) => /The angels asked him to/.test(reason)));
	assert.equal(kept.find((entry) => entry.type === "choice" && entry.note).note, "Love is seen at the cross.");
	assert.deepEqual(result.lesson.reflection, { prompt: "Who could you love today as God has loved you?", answer: "1 John 4:11" });
	assert.equal(parsePassage(kept[0].answer, deps.resolveBook).start, 7);

	const thin = checkLessonDraft({ ...draft, choice: draft.choice.slice(3) }, lesson, "love", deps);
	assert.deepEqual(thin, { error: "too_few_questions" });
	assert.deepEqual(checkLessonDraft({ ...draft, teaching: "Too short." }, lesson, "love", deps), { error: "bad_teaching" });

	const written = withWrittenLesson(outline, result.lesson);
	assert.deepEqual(written.written, ["lesson-01"]);
	assert.equal(written.units[0].lessons[0].exercises.length, kept.length);
	assert.equal(written.units[0].lessons[0].concept, "love");
	assert.deepEqual(withWrittenLesson(written, result.lesson).written, ["lesson-01"], "writing twice does not list it twice");
});

test("after Check a verse shared by several steps is shown once, with its steps numbered above it", () => {
	const answers = [
		{ ref: "2 Timothy 3:16", text: "All scripture", label: "For doctrine" },
		{ ref: "2 Timothy 3:16", text: "All scripture", label: "For reproof" },
		{ ref: "2 Timothy 3:17", text: "That the man of God", label: "Furnished" },
		{ ref: "2 Timothy 3:16", text: "All scripture", label: "For correction" },
	];
	assert.deepEqual(
		groupAnswers(answers).map((group) => [group.ref, group.labels.map((item) => `${item.n}. ${item.label}`)]),
		[["2 Timothy 3:16", ["1. For doctrine", "2. For reproof", "4. For correction"]], ["2 Timothy 3:17", ["3. Furnished"]]]
	);
	assert.deepEqual(groupAnswers([{ ref: "John 3:16", text: "For God so loved", label: null }])[0].labels, []);
});

test("concept labels read with their proper nouns", () => {
	assert.equal(conceptTitle("who god is"), "Who God is");
	assert.equal(conceptTitle("god's word"), "God's word");
	assert.equal(conceptTitle("jesus christ"), "Jesus Christ");
	assert.equal(conceptTitle("the holy spirit"), "The Holy Spirit");
	assert.equal(conceptTitle("paul's calling"), "Paul's calling");
	assert.equal(conceptTitle("the gentiles"), "The Gentiles");
	assert.equal(conceptTitle("new life"), "New life");
	assert.equal(conceptTitle("godliness"), "Godliness", "only whole words");
});

test("the review count only counts questions the path still has", () => {
	const enrollment = { ...emptyEnrollment("p", NOW), review: [{ ex: "p-01.1", lesson: "p-01", at: NOW, misses: 1 }, { ex: "retired.9", lesson: "retired", at: NOW, misses: 1 }] };
	assert.equal(pathProgress(samplePath(), enrollment).reviewCount, 1);
});
