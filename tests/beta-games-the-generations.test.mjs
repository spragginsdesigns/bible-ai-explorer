/**
 * The Generations (LC-17851, docs/beta/games.md), Matthew 1:1-17: the line is
 * the KJV's own, in order; the round replays exactly from a seed; a reader
 * who knows the line keeps it on nearly every seed and never faster than the
 * server allows; a masher, an idle player and a careless one fall short.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	GENERATIONS_LINE,
	GENERATIONS_LINKS,
	GENERATIONS_MIN_SECONDS,
	GENERATIONS_SECONDS,
	GENERATIONS_STEP,
	generationsReady,
	generationsResult,
	generationsTilePosition,
	newGenerations,
	stepGenerations,
} from "../src/lib/beta/games/the-generations-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-generations");
const SEEDS = 200;

function rng(seed) {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Plays a round. `react` gives the seconds a player takes to read each link
 * once its tablets land; `slip` the chance a tap takes a wrong tablet.
 */
function play(seed, { react = () => 0.4, slip = 0, masher = false, idle = false } = {}) {
	const state = newGenerations(seed);
	const events = [];
	const next = rng(seed ^ 0x5bd1e995);
	let link = -1;
	let readyAt = Infinity;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		let input = {};
		if (masher) {
			if (tick % 4 === 0) input = { tap: { x: next() * 400, y: next() * 400 } };
		} else if (!idle) {
			if (state.link !== link) {
				link = state.link;
				readyAt = state.arrivedAt + 30 + Math.round(react(next) * 60);
			}
			if (state.tick + 1 >= readyAt && generationsReady({ ...state, tick: state.tick + 1 })) {
				const wrongs = state.tiles.filter((tile) => !tile.correct && tile.gone === null);
				const tile = wrongs.length && next() < slip ? wrongs[Math.floor(next() * wrongs.length)] : state.tiles.find((item) => item.correct);
				const at = generationsTilePosition(state, tile, state.tick + 1);
				input = { tap: { x: at.x + (next() - 0.5) * 40, y: at.y + (next() - 0.5) * 20 } };
				readyAt = state.tick + 1 + Math.round(react(next) * 60 * 0.6);
			}
		}
		stepGenerations(state, input, events);
	}
	return { state, events, result: generationsResult(state) };
}

test("the line is Matthew 1:2-16 as the bundled KJV reads it", () => {
	const matthew = JSON.parse(readFileSync(new URL("../src/data/kjv/40-matthew.json", import.meta.url), "utf8"));
	const pairs = [];
	for (let verse = 2; verse <= 16; verse++) {
		for (const match of matthew[0][verse - 1].matchAll(/([A-Z][a-z]+)(?: the king)? begat ([A-Z][a-z]+)/g)) pairs.push([match[1], match[2]]);
	}
	assert.equal(pairs.length, GENERATIONS_LINE.length - 1);
	pairs.forEach(([father, son], index) => {
		assert.equal(GENERATIONS_LINE[index], father, `link ${index}`);
		assert.equal(GENERATIONS_LINE[index + 1], son, `link ${index}`);
	});
	assert.equal(GENERATIONS_LINE[0], "Abraham");
	assert.equal(GENERATIONS_LINE.at(-1), "Joseph");
	assert.equal(GENERATIONS_LINE.filter((name) => name === "Jacob").length, 2);
});

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, GENERATIONS_SECONDS);
	assert.ok(GAME.minSeconds <= GENERATIONS_MIN_SECONDS);
	assert.equal(GENERATIONS_STEP, 1 / 60);
});

test("every link offers the right name once, never the other Jacob's son, and no name twice", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newGenerations(seed * 31);
		for (let link = 0; link < GENERATIONS_LINKS; link++) {
			const index = state.start + link;
			const answer = GENERATIONS_LINE[index + 1];
			const names = state.tiles.map((tile) => tile.name);
			assert.equal(new Set(names).size, names.length);
			assert.equal(state.tiles.filter((tile) => tile.correct).length, 1);
			assert.equal(state.tiles.find((tile) => tile.correct).name, answer);
			if (GENERATIONS_LINE[index] === "Jacob") assert.ok(!names.includes("Judas") || !names.includes("Joseph"));
			assert.ok(!names.includes(GENERATIONS_LINE[index]));
			const tile = state.tiles.find((item) => item.correct);
			while (!generationsReady(state)) stepGenerations(state, {});
			stepGenerations(state, { slot: tile.slot });
		}
		assert.equal(state.phase, "won");
	}
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7, { slip: 0.2 }).state, play(7, { slip: 0.2 }).state);
});

test("the fastest possible win is the minimum, and the server accepts it", () => {
	const fastest = play(11, { react: () => 0 });
	assert.equal(fastest.result.won, true);
	assert.ok(Math.abs(fastest.result.seconds - GENERATIONS_MIN_SECONDS) < 0.05, `${fastest.result.seconds}`);
	assert.ok(fastest.result.seconds >= GAME.minSeconds);
});

test("a reader who knows the line keeps it on nearly every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, { react: (r) => 0.45 + r() * 0.35, slip: 0.04 });
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.7, `${gold} gold of ${won}`);
});

test("a careless reader sometimes loses the line", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, { react: (r) => 0.9 + r() * 0.8, slip: 0.3 }).result.won) won++;
	assert.ok(won > 0 && won < SEEDS * 0.8, `${won} won`);
});

test("a masher rarely wins and an idle player never does", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { masher: true }).result.won) won++;
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - GENERATIONS_SECONDS) < 0.05);
	}
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});
