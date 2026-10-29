/**
 * The Sower (LC-17851, docs/beta/games.md), Matthew 13:3-9: the round replays
 * exactly from a seed, a careful sower sows the good ground on nearly every
 * seed, one following the green arrow a reaction late still wins, a sloppy one
 * sometimes fails, and a scatterer or an idle one never wins. The round runs
 * its full time.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	SOWER_CELL,
	SOWER_COOLDOWN,
	SOWER_GRACE,
	SOWER_MIN_SECONDS,
	SOWER_SECONDS,
	SOWER_STEP,
	newSower,
	sowerCellAt,
	sowerMarkCell,
	sowerMarkX,
	sowerResult,
	stepSower,
} from "../src/lib/beta/games/the-sower-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-sower");
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

/** Aims each throw at the centre of the next unsown cell of good ground, off by up to `jitter` seconds. */
function aimer(jitter) {
	return (seed) => {
		const r = rng(seed * 31 + 5);
		const state = newSower(seed);
		let target = null;
		while (state.phase === "playing") {
			if (target === null) {
				const mark = sowerMarkX(state.t);
				let i = sowerCellAt(mark);
				while (i < state.cells.length && !(state.cells[i] === "good" && !state.sown[i] && (i + 0.5) * SOWER_CELL >= mark)) i++;
				let at = state.t;
				while (sowerMarkX(at) < (i + 0.5) * SOWER_CELL) at += 1 / 600;
				target = at + (r() * 2 - 1) * jitter;
			}
			const sow = state.t >= target;
			if (sow) target = null;
			stepSower(state, { sow });
		}
		return { state, result: sowerResult(state) };
	};
}

/** Throws `rate` times a second whatever the ground (0 never throws). */
function scatterer(rate) {
	return (seed) => {
		const r = rng(seed);
		const state = newSower(seed);
		let next = 0;
		while (state.phase === "playing") {
			const sow = rate > 0 && state.t >= next;
			if (sow) next = state.t + (0.5 + r()) / rate;
			stepSower(state, { sow });
		}
		return { state, result: sowerResult(state) };
	};
}

/** Follows the on-screen cue: taps while the arrow was green `reaction` seconds ago, at most `rate` taps a second. */
function cueFollower(reaction, rate) {
	const lag = Math.round(reaction / SOWER_STEP);
	return (seed) => {
		const state = newSower(seed);
		const green = [];
		let last = -Infinity;
		while (state.phase === "playing") {
			const mark = sowerMarkCell(state);
			green.push(mark.ground === "good" && !mark.sown);
			const sow = green.length > lag && green[green.length - 1 - lag] && state.t - last >= 1 / rate;
			if (sow) last = state.t;
			stepSower(state, { sow });
		}
		return { state, result: sowerResult(state) };
	};
}

/** Steps a fresh round to the first moment the marker leaves good ground for bad. */
function toEndOfGood(seed) {
	const state = newSower(seed);
	let wasGood = false;
	while (state.phase === "playing") {
		const good = sowerMarkCell(state).ground === "good";
		if (wasGood && !good) return state;
		wasGood = good;
		stepSower(state, { sow: false });
	}
	throw new Error("no good ground");
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
	assert.equal(GAME.seconds, SOWER_SECONDS);
	assert.ok(GAME.minSeconds <= SOWER_MIN_SECONDS);
	assert.equal(SOWER_STEP, 1 / 60);
});

test("the same seed and throws play the same round", () => {
	assert.deepEqual(aimer(0.1)(7).state, aimer(0.1)(7).state);
	assert.deepEqual(scatterer(4)(9).state, scatterer(4)(9).state);
});

test("every field has good ground to sow and every kind of bad ground", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const state = newSower(seed);
		assert.ok(state.goodTotal >= 25, `${state.goodTotal}`);
		for (const kind of ["wayside", "stony", "thorns"]) assert.ok(state.cells.includes(kind), kind);
		assert.equal(state.cells[sowerCellAt(sowerMarkX(0))], "wayside");
	}
});

test("a careful sower wins on at least 95% of seeds, mostly an hundredfold, and the server accepts the run", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = aimer(0.03)(seed * 7919);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("following the green arrow a reaction late (0.2 to 0.3 s, five or six taps a second) mostly wins", () => {
	for (const reaction of [0.2, 0.25, 0.3]) {
		for (const rate of [5, 6]) {
			const { won } = tally(cueFollower(reaction, rate));
			assert.ok(won >= SEEDS * 0.75, `reaction ${reaction}s, ${rate}/s: ${won} won`);
		}
	}
});

test("a throw just after the marker leaves good ground sows it; one past the grace is wasted", () => {
	const late = toEndOfGood(7919);
	const last = sowerCellAt(sowerMarkX(late.t - SOWER_STEP));
	stepSower(late, { sow: true });
	assert.equal(late.wasted, 0);
	assert.equal(late.sown[last], true);
	assert.equal(late.throws[0].sowed, true);

	const tooLate = toEndOfGood(7919);
	while (tooLate.t < late.t + SOWER_GRACE) stepSower(tooLate, { sow: false });
	stepSower(tooLate, { sow: true });
	assert.equal(tooLate.wasted, 1);
});

test("a press while the arm is still swinging is held and thrown when it is ready; one press, not more", () => {
	const state = newSower(7919);
	stepSower(state, { sow: true });
	for (let i = 0; i < 6; i++) stepSower(state, { sow: i === 2 || i === 4 });
	while (state.t < SOWER_COOLDOWN + 0.2) stepSower(state, { sow: false });
	assert.equal(state.throws.length, 2);
	assert.ok(Math.abs(state.throws[1].t - state.throws[0].t - SOWER_COOLDOWN) < SOWER_STEP + 1e-9, `${state.throws[1].t}`);
});

test("a sloppy sower (a fifth of a second off) sometimes loses and earns gold far less often than a careful one", () => {
	const { won, gold } = tally(aimer(0.2));
	assert.ok(won < SEEDS && won > 0, `${won} won`);
	assert.ok(gold < SEEDS * 0.75, `${gold} gold`);
});

test("scattering everywhere wastes the seed: as fast as possible, or three a second, never wins; idle never", () => {
	for (const rate of [60, 10, 6, 3, 0]) assert.equal(tally(scatterer(rate)).won, 0, `rate ${rate}`);
	const idle = scatterer(0)(1).result;
	assert.equal(idle.score, 0);
	assert.ok(Math.abs(idle.seconds - SOWER_SECONDS) < 0.05);
});
