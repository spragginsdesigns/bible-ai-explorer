/**
 * Have Mercy on Us (LC-17851, docs/beta/games.md), Matthew 20:29-34: the
 * round replays exactly from a seed, a steady crier is heard on every seed and
 * never faster than the server allows, a slow or idle one is not, and the
 * round lasts as long as the registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MERCY_MIN_SECONDS, MERCY_SECONDS, MERCY_STEP, mercyResult, newMercy, stepMercy } from "../src/lib/beta/games/have-mercy-on-us-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("have-mercy-on-us");
const SEEDS = 200;

/** Plays a round, crying `rate` times a second (0 never cries). */
function play(seed, rate) {
	const state = newMercy(seed);
	const events = [];
	let next = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const cry = rate > 0 && state.t >= next;
		if (cry) next = state.t + 1 / rate;
		stepMercy(state, { cry }, events);
	}
	return { state, events, result: mercyResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, MERCY_SECONDS);
	assert.ok(GAME.minSeconds <= MERCY_MIN_SECONDS);
	assert.equal(MERCY_STEP, 1 / 60);
});

test("the same seed and cries play the same round", () => {
	assert.deepEqual(play(7, 7).state, play(7, 7).state);
});

test("crying seven times a second is heard on every seed, with gold, and never faster than the server allows", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, 7);
		assert.equal(result.won, true, `seed ${seed}`);
		assert.equal(gradeFor(result.score), "gold", `seed ${seed}: ${result.score}`);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "heard").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
});

test("crying as fast as anyone can is still never faster than the minimum", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, 60);
		assert.equal(result.won, true);
		assert.ok(result.seconds >= MERCY_MIN_SECONDS - 0.05, `${result.seconds}`);
	}
});

test("a slow crier, three times a second, is never heard; an idle one never", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		assert.equal(play(seed, 3).result.won, false, `seed ${seed}`);
		const idle = play(seed, 0);
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - MERCY_SECONDS) < 0.05);
	}
});

test("five a second is hard: some rounds are heard late, some are not", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, 5);
		if (result.won) {
			won++;
			assert.notEqual(gradeFor(result.score), "gold");
		}
	}
	assert.ok(won < SEEDS, `${won} won`);
});

test("the crowd rebukes them during every round", () => {
	for (let seed = 1; seed <= 50; seed++) assert.ok(newMercy(seed).rebukes.length >= 2);
});
