/**
 * Chapter Games (LC-17850, LC-17851, docs/beta/games.md): one quick game for
 * every chapter of Matthew, each with a stage, rules and tests; awards grade
 * and merge as documented; a reported run is checked; the games play in the
 * page (no separate game pages) and stay behind the founders-only gate. Each
 * game's own play is tested in tests/beta-games-<slug>.test.mjs.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	CHAPTER_GAMES,
	chapterGameFor,
	checkGameRun,
	findChapterGame,
	gameChapterHref,
	gradeFor,
	mergeGameAward,
	readGameAward,
} from "../src/lib/beta/games/games-rules.ts";
import { findBetaModule } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");
const pascal = (slug) => slug.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join("");
const matthew = JSON.parse(read("src/data/kjv/40-matthew.json"));

test("every chapter of Matthew has exactly one game, in order", () => {
	assert.equal(CHAPTER_GAMES.length, matthew.length);
	CHAPTER_GAMES.forEach((game, index) => {
		assert.equal(game.book, 40, game.slug);
		assert.equal(game.chapter, index + 1, game.slug);
		assert.equal(chapterGameFor(40, index + 1), game);
	});
	assert.equal(chapterGameFor(40, 29), null);
	assert.equal(chapterGameFor(41, 1), null);
	assert.equal(findChapterGame("nope"), null);
	assert.equal(findBetaModule("bible", "games")?.issue, "LC-17850");
	// Austin's picks for the two chapters that had several ways to play (LC-17851).
	assert.equal(chapterGameFor(40, 2)?.slug, "the-caravan");
	assert.equal(chapterGameFor(40, 14)?.slug, "crest-hopper");
});

test("each game is a short round with its command, controls, tips, voice and award from its passage", () => {
	const slugs = new Set();
	for (const game of CHAPTER_GAMES) {
		assert.match(game.slug, /^[a-z][a-z0-9-]*$/);
		assert.equal(slugs.has(game.slug), false, `duplicate game ${game.slug}`);
		slugs.add(game.slug);
		assert.equal(findChapterGame(game.slug), game);
		const verses = matthew[game.chapter - 1];
		assert.ok(game.verses[0] >= 1 && game.verses[0] <= game.verses[1] && game.verses[1] <= verses.length, game.slug);
		assert.equal(game.reference, `Matthew ${game.chapter}:${game.verses[0]}-${game.verses[1]}`, game.slug);
		for (const verse of [game.voice.intro, game.voice.win]) assert.ok(verse >= game.verses[0] && verse <= game.verses[1], `${game.slug} voices verse ${verse} outside its passage`);
		assert.ok(game.seconds >= 10 && game.seconds <= 20, `${game.slug} runs ${game.seconds}s`);
		assert.ok(game.minSeconds > 0 && game.minSeconds <= game.seconds, game.slug);
		assert.ok(game.command.length > 0 && game.command.length <= 12, game.slug);
		assert.ok(game.controls.length >= 1 && game.controls.length <= 2, game.slug);
		for (const control of game.controls) assert.ok(control.keys.length > 0 && control.touch && control.action, game.slug);
		assert.ok(game.tips.length >= 1 && game.tips.length <= 2, game.slug);
		assert.ok(game.grades.gold && game.grades.silver && game.grades.bronze);
		assert.ok(game.measure && game.story && game.award && game.tagline && game.topics.includes("chapter game"), game.slug);
		assert.equal(gameChapterHref(game), `/bible/chapter?book=40&chapter=${game.chapter}`);
	}
});

test("every game has its stage on the player, its rules and its own tests", () => {
	const player = read("src/components/beta/games/ChapterGamePlayer.tsx");
	assert.match(player, /^"use client";/, "next/dynamic splits each game's code only from a client component");
	for (const game of CHAPTER_GAMES) {
		assert.match(player, new RegExp(`"${game.slug}": dynamic\\(\\(\\) => import\\("\\./stages/${pascal(game.slug)}"\\)\\)`), `${game.slug} has no stage`);
		const stage = read(`src/components/beta/games/stages/${pascal(game.slug)}.tsx`);
		assert.equal(/Coming soon/.test(stage), false, `${game.slug} is still a placeholder`);
		assert.ok(existsSync(join(repoRoot, `src/lib/beta/games/${game.slug}-rules.ts`)), `${game.slug} has no rules`);
		assert.ok(existsSync(join(repoRoot, `tests/beta-games-${game.slug}.test.mjs`)), `${game.slug} has no tests`);
	}
	const awards = read("src/lib/beta/games/awards.ts");
	assert.match(awards, /CHAPTER_GAMES\.map\(\(game\) => \[game\.slug, game\.minSeconds\]\)/, "the server's minimums come from the registry");
});

test("grades follow the round's score", () => {
	assert.equal(gradeFor(100), "gold");
	assert.equal(gradeFor(70), "gold");
	assert.equal(gradeFor(69), "silver");
	assert.equal(gradeFor(40), "silver");
	assert.equal(gradeFor(39), "bronze");
	assert.equal(gradeFor(0), "bronze");
});

test("an award keeps the best grade, score and time and counts every win", () => {
	const first = mergeGameAward(null, "watch", { faithKept: 55, seconds: 9.2, swellsCleared: 3 }, "2026-10-29T01:00:00.000Z");
	assert.deepEqual(first, { game: "watch", grade: "silver", bestFaith: 55, bestSeconds: 9.2, completions: 1, firstAt: "2026-10-29T01:00:00.000Z", lastAt: "2026-10-29T01:00:00.000Z" });
	const second = mergeGameAward(first, "watch", { faithKept: 91, seconds: 11, swellsCleared: 4 }, "2026-10-29T02:00:00.000Z");
	assert.equal(second.grade, "gold");
	assert.equal(second.bestFaith, 91);
	assert.equal(second.bestSeconds, 9.2);
	assert.equal(second.completions, 2);
	const third = mergeGameAward(second, "watch", { faithKept: 20, seconds: 7.5, swellsCleared: 1 }, "2026-10-29T03:00:00.000Z");
	assert.equal(third.grade, "gold", "a worse win never lowers the grade");
	assert.equal(third.bestSeconds, 7.5);
	assert.equal(third.firstAt, "2026-10-29T01:00:00.000Z");
	assert.equal(third.completions, 3);
	assert.deepEqual(readGameAward({ ...third }, "watch"), third);
	assert.equal(readGameAward({ ...third }, "other-game"), null);
	assert.equal(readGameAward({ ...third, grade: "platinum" }, "watch"), null);
	assert.equal(readGameAward(null, "watch"), null);
	assert.equal(readGameAward([], "watch"), null);
});

test("a reported run is checked before it counts", () => {
	const ok = checkGameRun({ faithKept: 72, seconds: 13.27, swellsCleared: 7 }, 12);
	assert.deepEqual(ok, { ok: true, value: { faithKept: 72, seconds: 13.3, swellsCleared: 7 } });
	const bad = [
		null,
		[],
		"run",
		{},
		{ faithKept: 101, seconds: 14, swellsCleared: 1 },
		{ faithKept: -1, seconds: 14, swellsCleared: 1 },
		{ faithKept: 50.5, seconds: 14, swellsCleared: 1 },
		{ faithKept: "50", seconds: 14, swellsCleared: 1 },
		{ faithKept: 50, seconds: 11, swellsCleared: 1 },
		{ faithKept: 50, seconds: Number.NaN, swellsCleared: 1 },
		{ faithKept: 50, seconds: 4000, swellsCleared: 1 },
		{ faithKept: 50, seconds: 14, swellsCleared: -2 },
		{ faithKept: 50, seconds: 14, swellsCleared: 1.5 },
	];
	for (const input of bad) assert.equal(checkGameRun(input, 12).ok, false, JSON.stringify(input));
});

test("the games play in the page: no game pages, a player in the reader card and the games list", () => {
	assert.equal(existsSync(join(repoRoot, "src/app/beta/bible/games/[game]/page.tsx")), false, "games no longer open on their own page");
	const card = read("src/components/beta/games/ChapterGameCard.tsx");
	assert.match(card, /dynamic\(\(\) => import\("\.\/ChapterGamePlayer"\)/, "the reader loads the player only when Play is pressed");
	assert.equal(/href=\{gameHref|\/beta\/bible\/games\//.test(card), false, "the reader card links to no game page");
	const home = read("src/components/beta/games/GamesHome.tsx");
	assert.match(home, /dynamic\(\(\) => import\("\.\/ChapterGamePlayer"\)/);
	const player = read("src/components/beta/games/MicroGame.tsx");
	for (const piece of ["How to play", "game.command", "game.controls", "game.tips", "voice.say(game.voice.intro)", "voice.say(game.voice.win)"]) assert.ok(player.includes(piece), `the player shows ${piece}`);
});

test("the games page and award route stay behind the founders-only gate", () => {
	const page = read("src/app/beta/bible/games/page.tsx");
	assert.match(page, /await requireBetaPage\(\)/);
	assert.match(page, /return betaMetadata\(/);
	const route = read("src/app/api/beta/games/[game]/award/route.ts");
	const gates = route.match(/const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;/g) ?? [];
	assert.equal(gates.length, 2, "GET and POST are both gated");
	assert.equal((route.match(/if \(!game\) return betaNotFound\(\);/g) ?? []).length, 2, "an unknown game is the ordinary 404");
	const awards = read("src/lib/beta/games/awards.ts");
	assert.equal(/prisma\./.test(awards), false, "awards go through the study store, never prisma directly");
});

test("the voice plays the chapter's existing recording, never a generation", () => {
	const voice = read("src/components/beta/games/verse-voice.ts");
	assert.match(voice, /\/api\/bible\/audio\?book=\$\{book\}&chapter=\$\{chapter\}/);
	assert.equal(/fish|elevenlabs|tts/i.test(voice.replace(/full-cast|Fish Audio/g, "")), false);
});
