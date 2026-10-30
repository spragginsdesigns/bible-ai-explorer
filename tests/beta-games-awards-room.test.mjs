/**
 * The Awards Room (LC-17906, docs/beta/games.md): a chapter is complete when
 * it is read whole, its game won and its quiz taken; a trophy when every
 * chapter of its passage is; the grade averages the best game and quiz
 * scores. The room's page stays behind the founders-only gate and is reached
 * from the games list and a game's page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CHAPTER_GAMES } from "../src/lib/beta/games/games-rules.ts";
import {
	AWARDS_ROOM_HREF,
	MATTHEW_TROPHIES,
	bestQuiz,
	chapterStandings,
	letterGrade,
	quizPercent,
	roomScorecard,
	trophyStandings,
} from "../src/lib/beta/games/awards-room-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");
const matthew = JSON.parse(read("src/data/kjv/40-matthew.json"));

const award = (game, grade, bestFaith) => ({ game, grade, bestFaith, bestSeconds: 10, completions: 1, firstAt: "2026-10-30T00:00:00.000Z", lastAt: "2026-10-30T00:00:00.000Z" });
const slugOf = (chapter) => CHAPTER_GAMES.find((game) => game.chapter === chapter).slug;
const empty = { awards: {}, quizzes: {}, read: {} };

/** Every part of chapters `from`..`to` done, game scores `faith`, quizzes `correct` of 5. */
function doneThrough(from, to, faith = 90, correct = 5) {
	const input = { awards: {}, quizzes: {}, read: {} };
	for (let chapter = from; chapter <= to; chapter++) {
		input.awards[slugOf(chapter)] = award(slugOf(chapter), faith >= 70 ? "gold" : faith >= 40 ? "silver" : "bronze", faith);
		input.quizzes[chapter] = { correct, total: 5 };
		input.read[chapter] = "complete";
	}
	return input;
}

test("a founder with nothing has 28 empty plaques, no trophies and no grade", () => {
	const chapters = chapterStandings(CHAPTER_GAMES, empty);
	assert.equal(chapters.length, 28);
	assert.deepEqual(chapters.map((standing) => standing.chapter), Array.from({ length: 28 }, (_, index) => index + 1));
	assert.ok(chapters.every((standing) => standing.parts === 0 && !standing.complete));
	assert.ok(trophyStandings(MATTHEW_TROPHIES, chapters).every((standing) => !standing.earned && standing.done === 0));
	const card = roomScorecard(chapters);
	assert.deepEqual(
		{ complete: card.complete, read: card.read, quizzes: card.quizzes, quizAverage: card.quizAverage, score: card.score, grade: card.grade },
		{ complete: 0, read: 0, quizzes: 0, quizAverage: null, score: null, grade: null },
	);
	assert.deepEqual(card.medals, { gold: 0, silver: 0, bronze: 0 });
});

test("a chapter is complete only with all three parts, and a started reading is not read", () => {
	const slug = slugOf(3);
	const cases = [
		[{ awards: { [slug]: award(slug, "gold", 80) }, quizzes: {}, read: {} }, 1],
		[{ awards: { [slug]: award(slug, "gold", 80) }, quizzes: { 3: { correct: 4, total: 5 } }, read: { 3: "started" } }, 2],
		[{ awards: {}, quizzes: { 3: { correct: 4, total: 5 } }, read: { 3: "complete" } }, 2],
		[{ awards: { [slug]: award(slug, "gold", 80) }, quizzes: { 3: { correct: 0, total: 5 } }, read: { 3: "complete" } }, 3],
	];
	for (const [input, parts] of cases) {
		const standing = chapterStandings(CHAPTER_GAMES, input)[2];
		assert.equal(standing.parts, parts);
		assert.equal(standing.complete, parts === 3);
	}
});

test("a trophy is earned only when every chapter of its passage is complete", () => {
	const sermon = MATTHEW_TROPHIES.find((trophy) => trophy.slug === "sermon-on-the-mount");
	const almost = trophyStandings([sermon], chapterStandings(CHAPTER_GAMES, doneThrough(5, 6)))[0];
	assert.deepEqual({ done: almost.done, of: almost.of, earned: almost.earned }, { done: 2, of: 3, earned: false });
	const whole = trophyStandings([sermon], chapterStandings(CHAPTER_GAMES, doneThrough(5, 7)))[0];
	assert.equal(whole.earned, true);
	// Chapters either side of the passage do not count toward it.
	const outside = trophyStandings([sermon], chapterStandings(CHAPTER_GAMES, { ...doneThrough(4, 4), ...{} }))[0];
	assert.equal(outside.done, 0);
	const book = trophyStandings(MATTHEW_TROPHIES, chapterStandings(CHAPTER_GAMES, doneThrough(1, 28)));
	assert.ok(book.every((standing) => standing.earned));
	const missingLast = trophyStandings(MATTHEW_TROPHIES, chapterStandings(CHAPTER_GAMES, doneThrough(1, 27)));
	assert.equal(missingLast.find((standing) => standing.trophy.slug === "gospel-of-matthew").earned, false);
	assert.equal(missingLast.find((standing) => standing.trophy.slug === "he-is-risen").done, 2);
});

test("the trophies split Matthew into passages in order, then the whole book, each verse from the bundled KJV inside its passage", () => {
	const passages = MATTHEW_TROPHIES.slice(0, -1);
	let next = 1;
	for (const trophy of passages) {
		assert.equal(trophy.chapters[0], next, trophy.slug);
		next = trophy.chapters[1] + 1;
	}
	assert.equal(next, matthew.length + 1);
	assert.deepEqual(MATTHEW_TROPHIES.at(-1).chapters, [1, matthew.length]);
	assert.equal(new Set(MATTHEW_TROPHIES.map((trophy) => trophy.slug)).size, MATTHEW_TROPHIES.length);
	for (const trophy of MATTHEW_TROPHIES) {
		const [chapter, verse] = trophy.verse;
		assert.ok(chapter >= trophy.chapters[0] && chapter <= trophy.chapters[1], trophy.slug);
		const text = matthew[chapter - 1]?.[verse - 1];
		assert.ok(typeof text === "string" && text.length > 0, `${trophy.slug} verse ${chapter}:${verse}`);
		assert.match(text, /[.!?]$/, `${trophy.slug} verse ends a sentence`);
	}
});

test("the best quiz wins by share right, and an empty or broken quiz counts for nothing", () => {
	assert.deepEqual(bestQuiz([{ correct: 3, total: 5 }, { correct: 4, total: 5 }, { correct: 2, total: 5 }]), { correct: 4, total: 5 });
	assert.deepEqual(bestQuiz([{ correct: 5, total: 10 }, { correct: 3, total: 5 }]), { correct: 3, total: 5 });
	assert.equal(bestQuiz([]), null);
	assert.equal(bestQuiz([{ correct: 0, total: 0 }]), null);
	assert.equal(quizPercent({ correct: 7, total: 5 }), 100);
	assert.equal(quizPercent({ correct: 0, total: 0 }), 0);
});

test("the grade averages every best game score and best quiz score, on the school scale", () => {
	const input = doneThrough(1, 2, 90, 5);
	input.awards[slugOf(3)] = award(slugOf(3), "silver", 50);
	const card = roomScorecard(chapterStandings(CHAPTER_GAMES, input));
	// Scores: 90, 100, 90, 100, 50 -> 86.
	assert.equal(card.score, 86);
	assert.equal(card.grade, "B");
	assert.equal(card.quizAverage, 100);
	assert.deepEqual(card.medals, { gold: 2, silver: 1, bronze: 0 });
	assert.equal(card.complete, 2);
	assert.equal(card.read, 2);
	assert.equal(card.quizzes, 2);

	const quizOnly = roomScorecard(chapterStandings(CHAPTER_GAMES, { awards: {}, quizzes: { 9: { correct: 3, total: 5 } }, read: {} }));
	assert.deepEqual({ score: quizOnly.score, grade: quizOnly.grade, complete: quizOnly.complete }, { score: 60, grade: "D-", complete: 0 });

	// A stored award outside 0-100 cannot push the grade past either end.
	const broken = roomScorecard(chapterStandings(CHAPTER_GAMES, { awards: { [slugOf(1)]: award(slugOf(1), "gold", 250) }, quizzes: {}, read: {} }));
	assert.equal(broken.score, 100);

	const scale = [[100, "A+"], [97, "A+"], [96, "A"], [93, "A"], [90, "A-"], [89, "B+"], [83, "B"], [80, "B-"], [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"], [59, "F"], [0, "F"]];
	for (const [score, letter] of scale) assert.equal(letterGrade(score), letter, String(score));
});

test("the room is a founders-only page reached from the games list and a game's page", () => {
	const page = read("src/app/beta/bible/games/awards/page.tsx");
	assert.match(page, /await requireBetaPage\(\)/);
	assert.match(page, /betaMetadata\(/);
	assert.doesNotMatch(page, /export const metadata/);
	assert.equal(AWARDS_ROOM_HREF, "/beta/bible/games/awards");
	assert.match(read("src/components/beta/games/GamesHome.tsx"), /href=\{AWARDS_ROOM_HREF\}/);
	assert.match(read("src/components/beta/games/ChapterGameScreen.tsx"), /href=\{AWARDS_ROOM_HREF\}/);
	// The room reads what SureWord already records; it writes nothing and keeps nothing of its own.
	const loader = read("src/lib/beta/games/awards-room.ts");
	assert.doesNotMatch(loader, /\.(create|update|upsert|delete)(Many)?\(/);
	assert.doesNotMatch(loader, /createBetaItem|updateBetaItem/);
});
