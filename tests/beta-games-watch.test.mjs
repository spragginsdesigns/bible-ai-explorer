/**
 * Watch! (LC-17851, docs/beta/games.md), Matthew 24:42-44, 27: the round
 * replays exactly from a seed, a watchful player catches the lightning on
 * nearly every seed and never faster than the server allows, a slow or jumpy
 * one often does not, and a masher or an idle one never wins.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	WATCH_FLASHES,
	WATCH_MIN_SECONDS,
	WATCH_SECONDS,
	WATCH_STEP,
	WATCH_WINDOW,
	newWatch,
	stepWatch,
	watchDecoyAt,
	watchLit,
	watchResult,
} from "../src/lib/beta/games/watch-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("watch");
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

/** Taps `min`-`max` seconds after each lightning, and at a decoy with chance `jumpy`. */
function watcher(min, max, jumpy = 0) {
	return (seed) => {
		const r = rng(seed * 31 + 5);
		const state = newWatch(seed);
		let pending = null;
		let seenFlash = -1;
		let seenDecoy = null;
		while (state.phase === "playing") {
			const lit = watchLit(state);
			const decoy = watchDecoyAt(state);
			if (lit && lit.index !== seenFlash) {
				seenFlash = lit.index;
				pending = state.t + min + r() * (max - min);
			}
			if (decoy && decoy !== seenDecoy) {
				seenDecoy = decoy;
				if (r() < jumpy) pending = state.t + 0.2 + r() * 0.2;
			}
			const tap = pending !== null && state.t >= pending;
			if (tap) pending = null;
			stepWatch(state, { tap });
		}
		return { state, result: watchResult(state) };
	};
}

function masher(rate) {
	return (seed) => {
		const r = rng(seed);
		const state = newWatch(seed);
		let next = 0;
		while (state.phase === "playing") {
			const tap = rate > 0 && state.t >= next;
			if (tap) next = state.t + (rate >= 30 ? 0 : (0.5 + r()) / rate);
			stepWatch(state, { tap });
		}
		return { state, result: watchResult(state) };
	};
}

function tally(play) {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919).result.won) won++;
	return won;
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WATCH_SECONDS);
	assert.ok(GAME.minSeconds <= WATCH_MIN_SECONDS);
	assert.equal(WATCH_STEP, 1 / 60);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(watcher(0.25, 0.4, 0.3)(7).state, watcher(0.25, 0.4, 0.3)(7).state);
});

test("four flashes, all inside the round, with decoys between and never on a flash", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newWatch(seed);
		assert.equal(state.flashes.length, WATCH_FLASHES);
		assert.ok(state.flashes[WATCH_FLASHES - 1].at + WATCH_WINDOW < WATCH_SECONDS - 0.5);
		assert.ok(state.decoys.length >= 3, `seed ${seed}: ${state.decoys.length} decoys`);
		for (const decoy of state.decoys) for (const flash of state.flashes) assert.ok(decoy.until < flash.at - 0.5 || decoy.at > flash.at + WATCH_WINDOW);
	}
});

test("a watchful player wins on at least 95% of seeds, mostly gold, and the server accepts the run", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = watcher(0.2, 0.32)(seed * 7919);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("tapping on the lightning's very first instant is still never faster than the minimum", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = watcher(0, 0)(seed);
		assert.equal(result.won, true);
		assert.ok(result.seconds >= WATCH_MIN_SECONDS, `${result.seconds}`);
	}
});

test("a slow, jumpy watcher often misses; a merely slow one is rarely gold", () => {
	const sloppy = tally(watcher(0.3, 0.55, 0.3));
	assert.ok(sloppy < SEEDS * 0.5 && sloppy > 0, `${sloppy} won`);
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = watcher(0.32, 0.44)(seed * 7919);
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(gold < SEEDS * 0.2, `${gold} gold`);
});

test("tapping all the time is early every time; an idle watcher never wins", () => {
	for (const rate of [60, 4, 2, 1]) assert.ok(tally(masher(rate)) < SEEDS * 0.05, `rate ${rate}`);
	assert.equal(tally(masher(0)), 0);
});
