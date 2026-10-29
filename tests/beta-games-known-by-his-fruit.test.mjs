/**
 * Known by His Fruit (LC-17851, docs/beta/games.md), Matthew 12:33-35: the
 * round replays exactly from a seed, a quick picker fills the basket on every
 * seed with gold, a slow or careless one sometimes loses, picking corrupt
 * fruit costs, a masher and an idle player never win, and the round lasts as
 * long as the registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	FRUIT_CORRUPT_LIMIT,
	FRUIT_GOAL,
	FRUIT_MIN_SECONDS,
	FRUIT_SECONDS,
	FRUIT_SPOTS,
	FRUIT_STEP,
	fruitLook,
	fruitResult,
	newFruit,
	stepFruit,
} from "../src/lib/beta/games/known-by-his-fruit-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("known-by-his-fruit");
const SEEDS = 200;

function random(seed) {
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
 * A picker who taps the ripe fruit nearest to turning, `reaction` seconds
 * after it ripened, at most one tap every `gap` seconds, reaching for a
 * corrupt one instead `slip` of the time; or a masher tapping the tree at
 * random `mash` times a second.
 */
function play(seed, { reaction = 0.3, gap = 0.28, slip = 0, mash = 0 } = {}) {
	const state = newFruit(seed);
	const chance = random(seed ^ 0x5eed);
	const events = [];
	let last = -1;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		let tap = null;
		if (mash) {
			if (state.t - last >= 1 / mash) {
				last = state.t;
				tap = { x: 70 + chance() * 270, y: 70 + chance() * 200 };
			}
		} else if (state.t - last >= gap) {
			const ripe = state.fruits.filter((fruit) => fruitLook(fruit, state.t) === "ripe" && state.t - fruit.ripeAt >= reaction).sort((a, b) => a.corruptAt - b.corruptAt);
			let fruit = ripe[0];
			if (fruit && chance() < slip) fruit = state.fruits.find((other) => fruitLook(other, state.t) === "corrupt") ?? fruit;
			if (fruit) {
				last = state.t;
				const spot = FRUIT_SPOTS[fruit.spot];
				tap = { x: spot.x + (chance() - 0.5) * 16, y: spot.y + (chance() - 0.5) * 16 };
			}
		}
		stepFruit(state, { tap }, events);
	}
	return { state, events, result: fruitResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, FRUIT_SECONDS);
	assert.ok(GAME.minSeconds <= FRUIT_MIN_SECONDS);
	assert.equal(FRUIT_STEP, 1 / 60);
	assert.equal(FRUIT_CORRUPT_LIMIT, 2);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7, { reaction: 0.5, slip: 0.1 }).state, play(7, { reaction: 0.5, slip: 0.1 }).state);
});

test("a fruit buds, ripens, turns corrupt and falls; picking a bud does nothing, a corrupt one costs", () => {
	const state = newFruit(9);
	const events = [];
	while (!state.fruits.length) stepFruit(state, { tap: null }, events);
	const fruit = state.fruits[0];
	const spot = FRUIT_SPOTS[fruit.spot];
	assert.equal(fruitLook(fruit, state.t), "bud");
	stepFruit(state, { tap: spot }, events);
	assert.equal(events.at(-1)?.type === "unripe" || events.some((event) => event.type === "unripe"), true);
	assert.equal(state.good + state.corrupt, 0);
	while (fruitLook(fruit, state.t) !== "corrupt") stepFruit(state, { tap: null }, events);
	stepFruit(state, { tap: spot }, events);
	assert.equal(state.corrupt, 1);
	assert.equal(fruitLook(fruit, state.t), "picked");
});

test("a quick picker fills the basket on every seed, mostly gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		assert.ok(result.count >= FRUIT_GOAL);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("a careless picker sometimes loses, a slow one does not fill the basket, and three corrupt picks lose at once", () => {
	let careless = 0;
	let slow = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { reaction: 0.6, gap: 0.45, slip: 0.08 }).result.won) careless++;
		if (play(seed, { reaction: 0.9, gap: 0.5 }).result.won) slow++;
	}
	assert.ok(careless > 0 && careless < SEEDS, `${careless} careless wins`);
	assert.ok(slow < SEEDS * 0.2, `${slow} slow wins`);
	const greedy = play(5, { reaction: 1.1, slip: 1 });
	assert.equal(greedy.result.won, false);
	assert.ok(greedy.state.corrupt > FRUIT_CORRUPT_LIMIT);
	assert.ok(greedy.result.seconds < FRUIT_SECONDS);
});

test("a masher and an idle player never win", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { mash: 8 }).result.won) mashed++;
		const idle = play(seed, { reaction: 99 });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - FRUIT_SECONDS) < 0.05);
	}
	assert.ok(mashed < SEEDS * 0.2, `${mashed} masher wins`);
});
