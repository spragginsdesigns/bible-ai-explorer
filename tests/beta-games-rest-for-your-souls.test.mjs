/**
 * Rest for Your Souls (LC-17851, docs/beta/games.md), Matthew 11:28-30: the
 * round replays exactly from a seed, a quick lifter keeps every traveller up
 * on every seed and never wins faster than the server allows, a slow lifter
 * sometimes lets three fall, and an idle or random tapper never wins.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	REST_FALL_LIMIT,
	REST_MIN_SECONDS,
	REST_SECONDS,
	REST_STEP,
	burdenAt,
	newRest,
	restResult,
	stepRest,
} from "../src/lib/beta/games/rest-for-your-souls-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("rest-for-your-souls");
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
 * Plays a round. A lifter sees a burden `react` seconds after it drops, taps
 * at most every `gap` seconds, the heaviest first, within `aim` units; a
 * masher taps anywhere `mash` times a second; `idle` never taps.
 */
function play(seed, { react = 0.3, gap = 0.16, aim = 6, mash = 0, idle = false } = {}) {
	const state = newRest(seed);
	const next = random(seed * 31 + 7);
	const events = [];
	let last = -9;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const taps = [];
		if (mash > 0) {
			if (next() < mash / 60) taps.push({ x: next() * 400, y: next() * 400 });
		} else if (!idle && state.t - last >= gap) {
			const seen = state.travellers
				.filter((walker) => walker.burden && walker.fellAt === null && state.t - walker.burden.born >= react)
				.sort((a, b) => b.burden.weight - a.burden.weight);
			if (seen.length) {
				const at = burdenAt(state, seen[0]);
				taps.push({ x: at.x + (next() * 2 - 1) * aim, y: at.y + (next() * 2 - 1) * aim });
				last = state.t;
			}
		}
		stepRest(state, { taps }, events);
	}
	return { state, events, result: restResult(state) };
}

function wins(options) {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919, options).result.won) won++;
	return won;
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, REST_SECONDS);
	assert.ok(GAME.minSeconds <= REST_MIN_SECONDS);
	assert.equal(REST_STEP, 1 / 60);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7).state, play(7).state);
	assert.deepEqual(play(11, { react: 0.8, gap: 0.4 }).events, play(11, { react: 0.8, gap: 0.4 }).events);
});

test("a quick lifter keeps every traveller walking on every seed, mostly gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= 10, `seed ${seed}: ${result.count} lifted`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("a burden left on a traveller's back makes him fall", () => {
	const state = newRest(3);
	const events = [];
	while (state.phase === "playing" && !events.some((event) => event.type === "fall")) stepRest(state, { taps: [] }, events);
	assert.equal(state.falls, 1);
	assert.ok(state.t < 4, `first fall at ${state.t}s`);
});

test("a slow lifter sometimes lets three fall; a late one mostly does", () => {
	const sloppy = wins({ react: 0.8, gap: 0.4 });
	assert.ok(sloppy < SEEDS * 0.9 && sloppy > SEEDS * 0.2, `sloppy won ${sloppy}`);
	assert.ok(wins({ react: 1.0, gap: 0.45 }) < SEEDS * 0.4);
});

test("an idle player never wins, and tapping at random rarely does", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.equal(idle.state.falls, REST_FALL_LIMIT);
	}
	assert.ok(wins({ mash: 6 }) < SEEDS * 0.2);
	assert.ok(wins({ mash: 12 }) < SEEDS * 0.2);
});
