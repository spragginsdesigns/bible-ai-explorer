/**
 * Hosanna! (LC-17851, docs/beta/games.md), Matthew 21:1-11: the round replays
 * exactly from a seed, a steady hand covers the way on nearly every seed, a
 * sloppy one often leaves it bare, and a masher or an idle one never wins. The
 * round runs its full time.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	HOSANNA_MIN_SECONDS,
	HOSANNA_SECONDS,
	HOSANNA_STEP,
	hosannaResult,
	hosannaZoneX,
	newHosanna,
	stepHosanna,
} from "../src/lib/beta/games/hosanna-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("hosanna");
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

/** Lays a branch as each bare patch reaches the middle of the zone, off by up to `jitter` seconds. */
function layer(jitter) {
	return (seed) => {
		const r = rng(seed * 31 + 5);
		const state = newHosanna(seed);
		let target = null;
		let aim = -1;
		while (state.phase === "playing") {
			if (target === null) {
				aim = state.patches.findIndex((patch) => patch.cover === "bare" && patch.x >= hosannaZoneX(state.t) - 2);
				target = Infinity;
				if (aim >= 0) {
					let at = state.t;
					while (hosannaZoneX(at) < state.patches[aim].x) at += 1 / 600;
					target = at + (r() * 2 - 1) * jitter;
				}
			}
			const lay = state.t >= target;
			if (lay || (aim >= 0 && state.patches[aim].cover !== "bare")) target = null;
			stepHosanna(state, { lay });
		}
		return { state, result: hosannaResult(state) };
	};
}

/** Presses `rate` times a second whatever is on the road (0 never presses). */
function masher(rate) {
	return (seed) => {
		const r = rng(seed);
		const state = newHosanna(seed);
		let next = 0;
		while (state.phase === "playing") {
			const lay = rate > 0 && state.t >= next;
			if (lay) next = state.t + (rate >= 30 ? 0 : (0.5 + r()) / rate);
			stepHosanna(state, { lay });
		}
		return { state, result: hosannaResult(state) };
	};
}

function tally(play) {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919);
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	return { won, gold };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, HOSANNA_SECONDS);
	assert.ok(GAME.minSeconds <= HOSANNA_MIN_SECONDS);
	assert.equal(HOSANNA_STEP, 1 / 60);
});

test("the same seed and presses play the same round", () => {
	assert.deepEqual(layer(0.1)(7).state, layer(0.1)(7).state);
	assert.deepEqual(masher(5)(9).state, masher(5)(9).state);
});

test("every road has a good number of bare patches, the first after a breath", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const state = newHosanna(seed);
		assert.ok(state.patches.length >= 16 && state.patches.length <= 32, `${state.patches.length}`);
		assert.ok(state.patches[0].x >= hosannaZoneX(1));
	}
});

test("a steady hand wins on at least 95% of seeds, mostly gold, and the server accepts the run", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = layer(0.04)(seed * 7919);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("a sloppy hand (up to a seventh of a second off) often leaves the way bare", () => {
	const sloppy = tally(layer(0.15));
	assert.ok(sloppy.won < SEEDS * 0.8 && sloppy.won > 0, `${sloppy.won} won`);
	assert.ok(tally(layer(0.2)).won < SEEDS * 0.2);
});

test("mashing drops the branches in the dust and never wins; idle never", () => {
	for (const rate of [60, 8, 4]) assert.equal(tally(masher(rate)).won, 0, `rate ${rate}`);
	const idle = masher(0)(1).result;
	assert.equal(idle.won, false);
	assert.equal(idle.score, 0);
	assert.ok(Math.abs(idle.seconds - HOSANNA_SECONDS) < 0.05);
});
