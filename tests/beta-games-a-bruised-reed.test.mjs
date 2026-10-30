/**
 * A Bruised Reed (LC-17908, docs/beta/games.md), Matthew 12:14-21: the round
 * replays exactly from a seed; hands that turn to each gust as it shows keep
 * the smoking flax burning on every seed, gold, for the whole round and never
 * faster than the server allows (with the arrows or by a held finger); slow,
 * careless hands sometimes let it be quenched; idle hands, hands turning
 * round and round, and a masher never keep it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	REED_ARC,
	REED_LIVES,
	REED_MIN_SECONDS,
	REED_SECONDS,
	REED_STEP,
	newReed,
	reedAngle,
	reedResult,
	reedTurn,
	stepReed,
} from "../src/lib/beta/games/a-bruised-reed-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("a-bruised-reed");
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
 * Plays a round. The hands see the gusts `react` seconds late and turn to
 * the soonest one still coming (a feint fools them until it dies away), with
 * the arrows or, with `tap`, by holding a finger toward it; with `lag` they
 * take that long more to move on to the next one. Each gust is misjudged by
 * up to `noise / 2` degrees, and with chance `miss` read from the wrong side.
 * A masher picks ←, nothing or → every sixth of a second; `spin` holds one
 * arrow the whole round.
 */
function play(seed, { react = 0.12, lag = 0, dead = 5, noise = 0, miss = 0, tap = false, idle = false, mash = false, spin = 0 } = {}) {
	const state = newReed(seed);
	const events = [];
	const next = rng(seed ^ 0x51ed27);
	let mashed = 0;
	let target = null;
	let error = 0;
	let soonest = null;
	let soonestAt = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		let input = {};
		if (mash) {
			if (tick % 10 === 0) mashed = Math.floor(next() * 3) - 1;
			input = { dir: mashed };
		} else if (spin) input = { dir: spin };
		else if (!idle) {
			const seen = state.t - react;
			let coming = state.gusts
				.filter((gust) => gust.outcome === null && seen >= gust.warn && !(gust.feint && seen >= gust.dies))
				.sort((a, b) => a.hit - b.hit)[0];
			if (coming !== soonest) {
				soonest = coming;
				soonestAt = state.t;
			}
			if (state.t - soonestAt < lag) coming = target && target.outcome === null ? target : null;
			if (coming) {
				if (coming !== target) {
					target = coming;
					error = (next() - 0.5) * noise + (miss && next() < miss ? 180 : 0);
				}
				const want = reedAngle(coming.dir) + error;
				if (tap) input = { toward: want };
				else if (Math.abs(reedTurn(state.shield, want)) > dead) input = { dir: Math.sign(reedTurn(state.shield, want)) };
			}
		}
		stepReed(state, input, events);
	}
	return { state, events, result: reedResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, REED_SECONDS);
	assert.ok(GAME.minSeconds <= REED_MIN_SECONDS);
	assert.equal(REED_MIN_SECONDS, REED_SECONDS);
	assert.equal(REED_STEP, 1 / 60);
});

test("the same seed and hands play the same round", () => {
	assert.deepEqual(play(7, { react: 0.22, noise: 40 }).state, play(7, { react: 0.22, noise: 40 }).state);
	assert.deepEqual(newReed(99), newReed(99));
	assert.notDeepEqual(newReed(1).gusts, newReed(2).gusts);
});

test("quick hands keep the flame on every seed, gold, for the whole round, by keys or by a held finger", () => {
	for (const hands of [{}, { tap: true }]) {
		let gold = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const { result, events } = play(seed * 7919, hands);
			assert.equal(result.won, true, `seed ${seed}`);
			if (gradeFor(result.score) === "gold") gold++;
			assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
			assert.equal(events.filter((event) => event.type === "victory").length, 1);
			assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
		}
		assert.ok(gold >= SEEDS * 0.95, `${gold} gold`);
	}
});

test("hands a beat late on each gust still keep it on every seed, mostly gold", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919, { lag: 0.15 });
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(gold >= SEEDS * 0.8, `${gold} gold`);
});

test("idle hands, hands turning round and round, and a masher never keep it", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false, `idle seed ${seed}`);
		assert.equal(idle.events.filter((event) => event.type === "through").length, REED_LIVES);
		assert.equal(play(seed, { spin: 1 }).result.won, false, `spin seed ${seed}`);
		assert.equal(play(seed, { spin: -1 }).result.won, false);
		assert.equal(play(seed, { mash: true }).result.won, false, `mash seed ${seed}`);
	}
});

test("slow, careless hands sometimes let it be quenched, and rarely keep enough for gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919, { lag: 0.22, noise: 30, miss: 0.05 });
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(won > SEEDS * 0.3 && won < SEEDS * 0.9, `${won} won`);
	assert.ok(gold < won * 0.25, `${gold} gold of ${won}`);
});

test("gusts come from all round, faster and more often from the opposite side later, with feints that never arrive", () => {
	let opposite = { early: 0, late: 0 };
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newReed(seed);
		const real = state.gusts.filter((gust) => !gust.feint).sort((a, b) => a.hit - b.hit);
		assert.ok(real.length >= 12, `seed ${seed}: ${real.length} gusts`);
		assert.ok(state.gusts.some((gust) => gust.feint), `seed ${seed}: no feint`);
		// The first gust needs the hands turned from where they start.
		assert.ok(Math.abs(reedTurn(state.shield, reedAngle(real[0].dir))) > REED_ARC / 2 + 10);
		for (const gust of state.gusts) {
			assert.ok(gust.warn < gust.hit && gust.hit - gust.warn >= 0.6, `seed ${seed}: lead ${gust.hit - gust.warn}`);
			if (gust.feint) assert.ok(gust.dies > gust.warn && gust.dies < gust.hit);
		}
		for (let i = 1; i < real.length; i++) {
			assert.notEqual(real[i].dir, real[i - 1].dir);
			const half = real[i].hit < REED_SECONDS / 2 ? "early" : "late";
			if ((real[i].dir - real[i - 1].dir + 8) % 8 === 4) opposite[half]++;
		}
		const gaps = real.slice(1).map((gust, i) => gust.hit - real[i].hit);
		assert.ok(gaps.at(-1) < gaps[0], `seed ${seed}: gusts do not quicken`);
	}
	assert.ok(opposite.late > opposite.early, JSON.stringify(opposite));
	const { events } = play(5);
	assert.ok(events.some((event) => event.type === "fade"));
	assert.ok(!events.some((event) => event.type === "through"));
});
