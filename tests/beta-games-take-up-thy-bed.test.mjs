/**
 * Take Up Thy Bed (LC-17908, docs/beta/games.md), Matthew 9:2-8: the round
 * replays exactly from a seed; a steady pair of hands that leans the bed back
 * against its tilt, and eases off as it comes level, carries the man to Jesus
 * on every seed, mostly gold, never faster than the server allows; late,
 * unsteady hands sometimes stumble three times; an idle player, one leaning
 * one way, and a masher never get him there.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	BED_LIMIT,
	BED_MIN_SECONDS,
	BED_SECONDS,
	BED_STEP,
	BED_STUMBLE_TICKS,
	BED_WARN,
	bedResult,
	newBed,
	stepBed,
} from "../src/lib/beta/games/take-up-thy-bed-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("take-up-thy-bed");
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
 * Plays a round. The hands see the bed `delay` ticks late and lean it back
 * whenever its tilt, plus `gain` seconds of its swing (easing off before it
 * comes level), is more than `dead` degrees off, misjudging by up to
 * `noise / 2` degrees. A masher picks ←, nothing or → every sixth of a
 * second; `constant` holds one arrow the whole round.
 */
function play(seed, { delay = 6, gain = 0.35, dead = 1.2, noise = 0, idle = false, mash = false, constant = 0 } = {}) {
	const state = newBed(seed);
	const events = [];
	const next = rng(seed ^ 0x9e3779b9);
	const seen = [];
	let mashed = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		seen.push({ tilt: state.tilt, swing: state.swing });
		let dir = 0;
		if (mash) {
			if (tick % 10 === 0) mashed = Math.floor(next() * 3) - 1;
			dir = mashed;
		} else if (constant) dir = constant;
		else if (!idle) {
			const late = seen[Math.max(0, seen.length - 1 - delay)];
			const lean = late.tilt + gain * late.swing + (next() - 0.5) * noise;
			if (Math.abs(lean) > dead) dir = -Math.sign(lean);
		}
		stepBed(state, { dir }, events);
	}
	return { state, events, result: bedResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, BED_SECONDS);
	assert.ok(GAME.minSeconds <= BED_MIN_SECONDS);
	assert.equal(BED_STEP, 1 / 60);
});

test("the same seed and hands play the same round", () => {
	assert.deepEqual(play(7, { delay: 12, noise: 4 }).state, play(7, { delay: 12, noise: 4 }).state);
	assert.deepEqual(newBed(99), newBed(99));
	assert.notDeepEqual(newBed(1).bumps, newBed(2).bumps);
});

test("steady hands bring him to Jesus on every seed, mostly gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("no hands are quicker than the walk: every win takes the whole street", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		for (const hands of [{ delay: 0, dead: 0.3 }, { delay: 3, gain: 0.5 }]) {
			const { result } = play(seed, hands);
			if (result.won) assert.ok(result.seconds >= BED_MIN_SECONDS - 0.05, `${result.seconds}`);
		}
	}
});

test("a stumble stops them and costs time; the bed is steadied, never thrown", () => {
	let seenStumble = false;
	for (let seed = 1; seed <= 60 && !seenStumble; seed++) {
		const { state, events, result } = play(seed, { delay: 12, gain: 0.25, noise: 4 });
		const stumbles = events.filter((event) => event.type === "stumble").length;
		if (!result.won || stumbles === 0) continue;
		seenStumble = true;
		assert.ok(result.seconds >= BED_MIN_SECONDS + (stumbles * BED_STUMBLE_TICKS) / 60 - 0.05, `${result.seconds}`);
		assert.equal(events.filter((event) => event.type === "steady").length, stumbles);
		assert.ok(Math.abs(state.tilt) < BED_LIMIT);
	}
	assert.ok(seenStumble);
});

test("idle hands, one held arrow and a masher never get him there", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false, `idle seed ${seed}`);
		assert.equal(idle.events.filter((event) => event.type === "stumble").length, 3);
		assert.equal(play(seed, { constant: 1 }).result.won, false);
		assert.equal(play(seed, { constant: -1 }).result.won, false);
		if (play(seed, { mash: true }).result.won) mashed++;
	}
	assert.ok(mashed <= SEEDS * 0.02, `${mashed} mashed wins`);
});

test("late, unsteady hands sometimes stumble out, and rarely keep it level enough for gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919, { delay: 12, gain: 0.25, noise: 4 });
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(won > SEEDS * 0.2 && won < SEEDS * 0.9, `${won} won`);
	assert.ok(gold < won * 0.25, `${gold} gold of ${won}`);
});

test("every street has rough places both ways and a press of the crowd, each shown before it jolts", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { bumps } = newBed(seed);
		assert.ok(bumps.length >= 8, `seed ${seed}: ${bumps.length}`);
		assert.ok(bumps.some((bump) => bump.kick < 0) && bumps.some((bump) => bump.kick > 0));
		assert.ok(bumps.some((bump) => bump.kind === "press"));
		for (let i = 1; i < bumps.length; i++) assert.ok(bumps[i].at - bumps[i - 1].at >= 28, `seed ${seed}: bumps too close`);
	}
	const { events } = play(3);
	const warns = events.filter((event) => event.type === "warn").length;
	const jolts = events.filter((event) => event.type === "jolt").length;
	assert.ok(warns >= jolts && jolts > 0);
	assert.ok(BED_WARN >= 0.5);
});
