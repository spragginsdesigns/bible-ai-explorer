/**
 * Lord, Save Us (LC-17851, docs/beta/games.md), Matthew 8:23-27: the round
 * replays exactly from a seed, a steady alternating bailer keeps the ship
 * afloat on every seed (and never faster than the server allows, since the
 * only win is outlasting the storm), a masher, a random presser and an idle
 * one sink, and a slow or gappy bailer sometimes sinks.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	SAVE_FULL,
	SAVE_MIN_SECONDS,
	SAVE_SECONDS,
	SAVE_STEP,
	newSave,
	saveResult,
	stepSave,
} from "../src/lib/beta/games/lord-save-us-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("lord-save-us");
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
 * Plays a round pressing `rate` times a second. `how`: "alternate" (left,
 * right, ...), "masher" (always left), "random" (either side), "gaps"
 * (alternate, but now and then pausing for 0.6 s).
 */
function play(seed, rate, how = "alternate") {
	const state = newSave(seed);
	const events = [];
	const chance = random(seed * 31 + 7);
	let next = 0;
	let side = "left";
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const presses = [];
		if (rate > 0 && state.t >= next) {
			next = state.t + 1 / rate + (how === "gaps" && chance() < 0.15 ? 0.6 : 0);
			if (how === "masher") presses.push("left");
			else if (how === "random") presses.push(chance() < 0.5 ? "left" : "right");
			else {
				presses.push(side);
				side = side === "left" ? "right" : "left";
			}
		}
		stepSave(state, { presses }, events);
	}
	return { state, events, result: saveResult(state) };
}

function wins(rate, how) {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919, rate, how).result.won) won++;
	return won;
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, SAVE_SECONDS);
	assert.ok(GAME.minSeconds <= SAVE_MIN_SECONDS);
	assert.equal(SAVE_STEP, 1 / 60);
});

test("the same seed and presses play the same round", () => {
	assert.deepEqual(play(7, 7).state, play(7, 7).state);
	assert.deepEqual(play(9, 7, "random").state, play(9, 7, "random").state);
});

test("bailing left and right six or seven times a second keeps the ship afloat on every seed, with gold, never faster than the server allows", () => {
	for (const rate of [6, 7]) {
		for (let seed = 1; seed <= SEEDS; seed++) {
			const { result, events } = play(seed * 7919, rate);
			assert.equal(result.won, true, `rate ${rate} seed ${seed}`);
			assert.equal(gradeFor(result.score), "gold", `rate ${rate} seed ${seed}: ${result.score}`);
			assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
			assert.equal(events.filter((event) => event.type === "calm").length, 1);
			assert.equal(events.filter((event) => event.type === "fumble").length, 0);
			assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
		}
	}
});

test("bailing as fast as anyone can still lasts the whole storm", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, 30);
		assert.equal(result.won, true);
		assert.ok(result.seconds >= SAVE_MIN_SECONDS - 0.05, `${result.seconds}`);
	}
});

test("a masher pressing one side never wins; an idle crew always sinks", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const masher = play(seed, 10, "masher");
		assert.equal(masher.result.won, false, `seed ${seed}`);
		assert.ok(masher.state.fumbles > 0);
		const idle = play(seed, 0);
		assert.equal(idle.result.won, false);
		assert.ok(idle.state.water >= SAVE_FULL - 1e-9);
		assert.ok(idle.result.seconds < SAVE_SECONDS);
	}
});

test("pressing either side at random rarely wins", () => {
	for (const rate of [7, 10, 14]) assert.ok(wins(rate, "random") < SEEDS * 0.2, `rate ${rate}`);
});

test("a slow or gappy bailer sometimes sinks", () => {
	assert.ok(wins(3) < SEEDS, "three a second");
	assert.ok(wins(5, "gaps") < SEEDS, "five a second with gaps");
	assert.ok(wins(5, "gaps") > 0, "five a second with gaps can still make it");
});

test("big waves come during every storm, each warned before it pours in", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const { waves } = newSave(seed);
		assert.ok(waves.length >= 3, `seed ${seed}: ${waves.length}`);
		for (const wave of waves) assert.ok(wave.hit - wave.warn >= 0.8 && wave.hit < SAVE_SECONDS);
	}
});
