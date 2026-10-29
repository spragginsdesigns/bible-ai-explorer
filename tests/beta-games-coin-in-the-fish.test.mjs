/**
 * The Coin in the Fish (LC-17851, docs/beta/games.md), Matthew 17:24-27: the
 * round replays exactly from a seed, a quick striker brings the fish up on
 * nearly every seed and never faster than the server allows, a late or jumpy
 * one mostly does not, and a masher or an idle one never does.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { COIN_MIN_SECONDS, COIN_SECONDS, COIN_STEP, COIN_STRIKES, coinCueAt, coinResult, newCoin, stepCoin } from "../src/lib/beta/games/coin-in-the-fish-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("coin-in-the-fish");
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

/** Strikes `min`-`max` seconds after each bite shows, and on a nibble with chance `jumpy`. */
function striker(min, max, jumpy = 0) {
	return (seed) => {
		const r = rng(seed * 31 + 5);
		const state = newCoin(seed);
		const events = [];
		let pending = null;
		let seen = null;
		while (state.phase !== "won" && state.phase !== "lost") {
			const cue = coinCueAt(state);
			if (cue && cue !== seen) {
				seen = cue;
				if (cue.kind === "bite") pending = state.t + min + r() * (max - min);
				else if (r() < jumpy) pending = state.t + 0.15 + r() * 0.2;
			}
			const strike = pending !== null && state.t >= pending;
			if (strike) pending = null;
			stepCoin(state, { strike }, events);
		}
		return { state, events, result: coinResult(state) };
	};
}

/** Strikes `rate` times a second whatever the float does (0 never strikes). */
function masher(rate) {
	return (seed) => {
		const r = rng(seed);
		const state = newCoin(seed);
		let next = 0;
		while (state.phase !== "won" && state.phase !== "lost") {
			const strike = rate > 0 && state.t >= next;
			if (strike) next = state.t + (rate >= 30 ? 0 : (0.5 + r()) / rate);
			stepCoin(state, { strike });
		}
		return { state, result: coinResult(state) };
	};
}

function tally(play) {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919).result.won) won++;
	return won;
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, COIN_SECONDS);
	assert.ok(GAME.minSeconds <= COIN_MIN_SECONDS);
	assert.equal(COIN_STEP, 1 / 60);
});

test("the same seed and strikes play the same round", () => {
	assert.deepEqual(striker(0.2, 0.4, 0.3)(7).state, striker(0.2, 0.4, 0.3)(7).state);
	assert.deepEqual(masher(3)(9).state, masher(3)(9).state);
});

test("a quick striker brings the coin fish up on at least 95% of seeds, mostly gold, and the server accepts the run", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = striker(0.18, 0.28)(seed * 7919);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(result.count, COIN_STRIKES);
		assert.equal(events.filter((event) => event.type === "up").length, 1);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.8, `${gold} gold`);
});

test("striking on the bite's very first instant is still never faster than the minimum", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = striker(0, 0)(seed);
		assert.equal(result.won, true);
		assert.ok(result.seconds >= COIN_MIN_SECONDS - 0.05, `${result.seconds}`);
	}
});

test("a late or jumpy striker usually loses the fish; a late one almost always", () => {
	const late = tally(striker(0.3, 0.55, 0.15));
	assert.ok(late < SEEDS * 0.1, `${late} won`);
	const jumpy = tally(striker(0.22, 0.45, 0.25));
	assert.ok(jumpy < SEEDS * 0.5 && jumpy > 0, `${jumpy} won`);
});

test("striking at everything scares the fish away every time; an idle line never takes it", () => {
	for (const rate of [60, 6, 3, 1]) assert.equal(tally(masher(rate)), 0, `rate ${rate}`);
	const idle = masher(0)(1).result;
	assert.equal(idle.won, false);
	assert.ok(Math.abs(idle.seconds - COIN_SECONDS) < 0.05);
});
