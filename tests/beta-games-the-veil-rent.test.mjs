/**
 * The Veil Was Rent (LC-17851, docs/beta/games.md), Matthew 27:50-54: the
 * round replays exactly from a seed; a steady hand keeps the seam from the
 * top to the bottom on nearly every seed, mostly gold, never faster than the
 * server allows; a late or unsteady hand sometimes loses it in the quake; a
 * masher and an idle player never rend it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	VEIL_MIN_SECONDS,
	VEIL_SECONDS,
	VEIL_STEP,
	newVeil,
	stepVeil,
	veilResult,
	veilSeam,
	veilY,
} from "../src/lib/beta/games/the-veil-rent-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-veil-rent");
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
 * Plays a round with the arrows. The hand sees the seam `delay` seconds late,
 * a little ahead of the point, and steers when it is more than `dead` units
 * off it. `drag` follows the seam with a finger instead.
 */
function play(seed, { delay = 0.12, dead = 4, ahead = 0, drag = false, masher = false, idle = false } = {}) {
	const state = newVeil(seed);
	const events = [];
	const next = rng(seed ^ 0x1b873593);
	let mash = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		let input = {};
		if (masher) {
			if (tick % 12 === 0) mash = Math.floor(next() * 3) - 1;
			input = { dir: mash };
		} else if (!idle) {
			const target = veilSeam(state, veilY(state) + ahead, Math.max(0, state.t - delay));
			if (drag) input = { toward: target + (next() - 0.5) * 8 };
			else if (Math.abs(target - state.x) > dead) input = { dir: Math.sign(target - state.x) };
		}
		stepVeil(state, input, events);
	}
	return { state, events, result: veilResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, VEIL_SECONDS);
	assert.ok(GAME.minSeconds <= VEIL_MIN_SECONDS);
	assert.equal(VEIL_STEP, 1 / 60);
});

test("the same seed and steering play the same round", () => {
	assert.deepEqual(play(7, { delay: 0.3 }).state, play(7, { delay: 0.3 }).state);
});

test("the veil is never rent faster than the minimum, and the fastest rending is accepted", () => {
	let fastest = Infinity;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { delay: 0, dead: 1, ahead: 0, drag: true });
		if (!result.won) continue;
		fastest = Math.min(fastest, result.seconds);
		assert.ok(result.seconds >= VEIL_MIN_SECONDS - 0.05, `${result.seconds}`);
	}
	assert.ok(fastest >= GAME.minSeconds);
	assert.equal(checkGameRun({ faithKept: 100, seconds: fastest, swellsCleared: 100 }, GAME.minSeconds).ok, true);
});

test("a steady hand on the arrows rends it on nearly every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, { delay: 0.12, dead: 4 });
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "rent").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.7, `${gold} gold of ${won}`);
});

test("a finger dragging along the seam rends it too", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, { delay: 0.15, drag: true }).result.won) won++;
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
});

test("a late, unsteady hand sometimes loses it in the quake", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, { delay: 0.28, dead: 9 }).result.won) won++;
	assert.ok(won > 0 && won < SEEDS * 0.8, `${won} won`);
});

test("a masher rarely rends it and an idle player never does", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { masher: true }).result.won) won++;
		assert.equal(play(seed, { idle: true }).result.won, false);
	}
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});

test("the earth quakes during every round", () => {
	for (let seed = 1; seed <= 50; seed++) assert.ok(newVeil(seed).quakes.filter((quake) => quake.at < VEIL_MIN_SECONDS).length >= 2);
});
