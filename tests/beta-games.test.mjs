/**
 * Chapter Games (LC-17850, docs/beta/games.md): Peter's Water Walk's
 * simulation is winnable by a steady player and lost by one who does nothing,
 * its awards grade and merge as documented, a reported run is checked, and
 * the game's routes stay behind the founders-only gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	WALK_GOAL,
	WALK_JUMP_AIR,
	WALK_MIN_SECONDS,
	WALK_STEP,
	WALK_TOP_SPEED,
	newWalk,
	stepWalk,
	walkResult,
} from "../src/lib/beta/games/water-walk-rules.ts";
import {
	CHAPTER_GAMES,
	chapterGameGroups,
	chapterGamesFor,
	checkGameRun,
	findChapterGame,
	gameHref,
	gradeFor,
	mergeGameAward,
	readGameAward,
} from "../src/lib/beta/games/games-rules.ts";
import { findBetaModule } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const NOTHING = { lean: 0, jump: false, cry: false };
const LIMIT = 60 * 240;

/** Plays one walk with `policy(state)` until it ends or four minutes pass. */
function play(seed, policy) {
	const state = newWalk(seed);
	const events = [];
	for (let tick = 0; state.phase === "walking" && tick < LIMIT; tick++) stepWalk(state, policy(state), events);
	return { state, events };
}

/** Leans against the tilt and steps up as each crest comes close: a steady player. */
function steady(state) {
	const lean = Math.max(-1, Math.min(1, state.tilt * 3 + state.tiltVel));
	const next = state.swells.find((swell) => swell.outcome === null && swell.x > state.x);
	return { lean, jump: !!next && next.x - state.x < 6 && state.air === 0, cry: false };
}

/** The same player reacting a quarter second late, on keys (full lean or none). */
function late(delaySteps) {
	const seen = [];
	return (state) => {
		seen.push({ tilt: state.tilt, tiltVel: state.tiltVel });
		const then = seen[Math.max(0, seen.length - 1 - delaySteps)];
		const want = then.tilt * 3 + then.tiltVel * 0.6;
		return { ...steady(state), lean: Math.abs(want) < 0.25 ? 0 : Math.sign(want) };
	};
}

test("the same seed and inputs play the same walk", () => {
	const a = play(42, steady).state;
	const b = play(42, steady).state;
	assert.deepEqual(a, b);
});

test("a steady player reaches Jesus on every seed, inside the time a walk can take", () => {
	for (let seed = 1; seed <= 40; seed++) {
		const { state, events } = play(seed * 7919, steady);
		assert.equal(state.phase, "arrived", `seed ${seed}`);
		assert.equal(state.x, WALK_GOAL);
		assert.ok(state.t >= WALK_MIN_SECONDS, `seed ${seed}: ${state.t}s is faster than the game allows`);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		const result = walkResult(state);
		assert.ok(result && result.faithKept >= 70, `seed ${seed}: a clean walk earns gold (${result?.faithKept})`);
		assert.ok(result.swellsCleared >= 3, `seed ${seed}: the walk has swells to step over`);
	}
});

test("standing still sinks him, and only a cry for help brings the rescue", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const { state, events } = play(seed, () => NOTHING);
		assert.equal(state.phase, "sinking", `seed ${seed}`);
		assert.equal(walkResult(state), null);
		assert.ok(events.some((event) => event.type === "sinking"));
		for (let i = 0; i < 300; i++) stepWalk(state, NOTHING);
		assert.equal(state.phase, "sinking", "no rescue without the cry");
		assert.equal(state.sink, 1);
		const after = [];
		stepWalk(state, { ...NOTHING, cry: true }, after);
		assert.equal(state.phase, "rescued");
		assert.deepEqual(after, [{ type: "rescued" }]);
	}
});

test("the game asks for skill: no leaning, or no stepping up, rarely finishes and never well", () => {
	let leanOnlyWins = 0;
	for (let seed = 1; seed <= 30; seed++) {
		const noLean = play(seed * 31, (state) => ({ ...steady(state), lean: 0 })).state;
		assert.notEqual(noLean.phase, "arrived", `seed ${seed}: walked without ever leaning`);
		const noJump = play(seed * 31, (state) => ({ ...steady(state), jump: false })).state;
		if (noJump.phase === "arrived") {
			leanOnlyWins += 1;
			assert.notEqual(gradeFor(walkResult(noJump).faithKept), "gold", `seed ${seed}: gold without stepping over a swell`);
		}
	}
	assert.ok(leanOnlyWins <= 18, `${leanOnlyWins} of 30 walks finished without stepping over a swell`);
});

test("a player a quarter second late still usually makes it: slightly challenging, not cruel", () => {
	let wins = 0;
	for (let seed = 1; seed <= 40; seed++) if (play(seed * 104729, late(15)).state.phase === "arrived") wins += 1;
	assert.ok(wins >= 28, `only ${wins} of 40 late walks finished`);
	assert.ok(wins <= 40);
});

test("a swell is cleared only from the air, and a hit costs faith and balance", () => {
	const state = newWalk(5);
	state.swells.push({ id: 99, x: state.x + 0.05, outcome: null });
	const before = state.faith;
	const events = [];
	stepWalk(state, NOTHING, events);
	assert.ok(events.some((event) => event.type === "hit" && event.id === 99));
	assert.ok(state.faith < before - 20);
	assert.ok(state.tiltVel < 0, "the crest shoves him back toward the ship");

	const air = newWalk(5);
	stepWalk(air, { ...NOTHING, jump: true });
	assert.ok(air.air > 0 && air.air <= WALK_JUMP_AIR);
	air.swells.push({ id: 7, x: air.x + 0.05, outcome: null });
	const cleared = [];
	stepWalk(air, NOTHING, cleared);
	assert.ok(cleared.some((event) => event.type === "cleared" && event.id === 7));
	assert.equal(air.swellsCleared, 1);
});

test("the soonest finish is the walk at his top pace", () => {
	assert.equal(WALK_MIN_SECONDS, Math.floor(WALK_GOAL / WALK_TOP_SPEED));
	assert.ok(WALK_STEP > 0 && WALK_STEP < 0.05);
});

test("grades follow the faith kept", () => {
	assert.equal(gradeFor(100), "gold");
	assert.equal(gradeFor(70), "gold");
	assert.equal(gradeFor(69), "silver");
	assert.equal(gradeFor(40), "silver");
	assert.equal(gradeFor(39), "bronze");
	assert.equal(gradeFor(0), "bronze");
});

test("an award keeps the best grade, faith and time and counts every finish", () => {
	const first = mergeGameAward(null, "water-walk", { faithKept: 45, seconds: 41.2, swellsCleared: 6 }, "2026-10-28T10:00:00.000Z");
	assert.deepEqual(first, { game: "water-walk", grade: "silver", bestFaith: 45, bestSeconds: 41.2, completions: 1, firstAt: "2026-10-28T10:00:00.000Z", lastAt: "2026-10-28T10:00:00.000Z" });
	const second = mergeGameAward(first, "water-walk", { faithKept: 80, seconds: 44, swellsCleared: 8 }, "2026-10-28T11:00:00.000Z");
	assert.equal(second.grade, "gold");
	assert.equal(second.bestFaith, 80);
	assert.equal(second.bestSeconds, 41.2, "a slower finish never replaces the best time");
	assert.equal(second.completions, 2);
	assert.equal(second.firstAt, first.firstAt);
	const third = mergeGameAward(second, "water-walk", { faithKept: 10, seconds: 30, swellsCleared: 2 }, "2026-10-28T12:00:00.000Z");
	assert.equal(third.grade, "gold", "a worse finish never lowers the grade");
	assert.equal(third.bestSeconds, 30);
	assert.equal(third.completions, 3);
	assert.deepEqual(readGameAward({ ...third }, "water-walk"), third);
	assert.equal(readGameAward({ ...third }, "other-game"), null);
	assert.equal(readGameAward({ ...third, grade: "platinum" }, "water-walk"), null);
	assert.equal(readGameAward(null, "water-walk"), null);
	assert.equal(readGameAward([], "water-walk"), null);
});

test("a reported run is checked before it counts", () => {
	const ok = checkGameRun({ faithKept: 72, seconds: 33.27, swellsCleared: 7 }, WALK_MIN_SECONDS);
	assert.deepEqual(ok, { ok: true, value: { faithKept: 72, seconds: 33.3, swellsCleared: 7 } });
	const bad = [
		null,
		[],
		"run",
		{},
		{ faithKept: 101, seconds: 40, swellsCleared: 1 },
		{ faithKept: -1, seconds: 40, swellsCleared: 1 },
		{ faithKept: 50.5, seconds: 40, swellsCleared: 1 },
		{ faithKept: "50", seconds: 40, swellsCleared: 1 },
		{ faithKept: 50, seconds: WALK_MIN_SECONDS - 1, swellsCleared: 1 },
		{ faithKept: 50, seconds: Number.NaN, swellsCleared: 1 },
		{ faithKept: 50, seconds: 4000, swellsCleared: 1 },
		{ faithKept: 50, seconds: 40, swellsCleared: -2 },
		{ faithKept: 50, seconds: 40, swellsCleared: 1.5 },
	];
	for (const input of bad) assert.equal(checkGameRun(input, WALK_MIN_SECONDS).ok, false, JSON.stringify(input));
});

test("each game belongs to one chapter and opens under the Bible destination", () => {
	assert.ok(CHAPTER_GAMES.length >= 1);
	const slugs = new Set();
	for (const game of CHAPTER_GAMES) {
		assert.match(game.slug, /^[a-z][a-z0-9-]*$/);
		assert.equal(slugs.has(game.slug), false, `duplicate game ${game.slug}`);
		slugs.add(game.slug);
		assert.ok(game.verses[0] >= 1 && game.verses[0] <= game.verses[1]);
		assert.equal(findChapterGame(game.slug), game);
		assert.ok(chapterGamesFor(game.book, game.chapter).includes(game));
		assert.equal(gameHref(game), `/beta/bible/games/${game.slug}`);
		assert.ok(game.grades.gold && game.grades.silver && game.grades.bronze);
		assert.ok(game.style && game.measure && game.story && game.topics.length > 0, game.slug);
		assert.ok(game.emblem === "wave" || game.emblem === "star", game.slug);
	}
	assert.equal(chapterGamesFor(40, 14)[0]?.slug, "water-walk", "Matthew 14 opens with Peter's Water Walk");
	assert.deepEqual(chapterGamesFor(40, 13), []);
	assert.equal(findChapterGame("nope"), null);
	assert.equal(findBetaModule("bible", "games")?.issue, "LC-17850");
});

test("the ways to play one passage share its passage, story, award and grades, and each tells its style apart", () => {
	const groups = chapterGameGroups();
	assert.equal(groups.flat().length, CHAPTER_GAMES.length);
	assert.deepEqual(
		groups.map((group) => [group[0].reference, group.map((game) => game.slug)]),
		[
			["Matthew 14:22-33", ["water-walk", "through-the-storm", "crest-hopper"]],
			["Matthew 2:1-12", ["follow-the-star", "the-caravan", "star-chart"]],
		],
	);
	for (const group of groups) {
		const [first] = group;
		const styles = new Set();
		for (const game of group) {
			for (const field of ["book", "chapter", "reference", "story", "award", "measure", "emblem"]) assert.equal(game[field], first[field], `${game.slug}.${field}`);
			assert.deepEqual(game.verses, first.verses, game.slug);
			assert.deepEqual(game.grades, first.grades, game.slug);
			assert.equal(styles.has(game.style), false, `${game.slug} repeats a style`);
			styles.add(game.style);
		}
	}
});

test("every game has a component on the game page and a soonest finish for its award", () => {
	const player = read("src/components/beta/games/ChapterGamePlayer.tsx");
	const awards = read("src/lib/beta/games/awards.ts");
	assert.match(player, /^"use client";/, "next/dynamic splits each game's code only from a client component");
	for (const game of CHAPTER_GAMES) {
		assert.match(player, new RegExp(`"${game.slug}": dynamic\\(\\(\\) => import\\("\\./[A-Za-z]+"\\)\\)`), `${game.slug} has no component`);
		assert.match(awards, new RegExp(`"${game.slug}": [A-Z_]+_MIN_SECONDS`), `${game.slug} has no soonest finish`);
	}
});

test("the games' pages and award route stay behind the founders-only gate", () => {
	for (const page of ["src/app/beta/bible/games/page.tsx", "src/app/beta/bible/games/[game]/page.tsx"]) {
		const source = read(page);
		assert.match(source, /await requireBetaPage\(\)/, page);
		assert.match(source, /return betaMetadata\(/, page);
	}
	const route = read("src/app/api/beta/games/[game]/award/route.ts");
	assert.match(route, /const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;/);
	assert.match(route, /if \(!game\) return betaNotFound\(\);/, "an unknown game is the ordinary 404");
	const awards = read("src/lib/beta/games/awards.ts");
	assert.equal(/prisma\./.test(awards), false, "awards go through the study store, never prisma directly");
});
