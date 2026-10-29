/**
 * He Is Risen (LC-17851, docs/beta/games.md), Matthew 28:1-10: the round
 * replays exactly from a seed, a runner who leaps on time reaches the
 * disciples on every seed with gold and never faster than the server allows,
 * an idle or mashing one does not, a late one sometimes stumbles out, and the
 * round lasts as long as the registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	RISEN_APEX,
	RISEN_MIN_SECONDS,
	RISEN_SECONDS,
	RISEN_STEP,
	RISEN_STUMBLES,
	leapClears,
	newRisen,
	nextObstacle,
	risenResult,
	stepRisen,
} from "../src/lib/beta/games/he-is-risen-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("he-is-risen");
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
 * Plays a round. "skilled" leaps when the next stone is a leap's rise away;
 * "late" plans each leap with a timing error of up to `error` seconds (and a
 * little late on average); "masher" presses at random about fifteen times a
 * second; "idle" never presses.
 */
function play(seed, player, error = 0.12) {
	const state = newRisen(seed);
	const events = [];
	const next = random(seed * 31 + 7);
	let planned = null;
	let lastId = -1;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		let leap = false;
		const item = nextObstacle(state);
		if (player === "skilled" && item && state.grounded && item.id !== lastId && item.x - state.d <= state.speed * RISEN_APEX + 2) {
			leap = true;
			lastId = item.id;
		}
		if (player === "late") {
			if (item && item.id !== lastId && planned === null && item.x - state.d <= state.speed * RISEN_APEX + 200) {
				planned = state.t + (item.x - state.d - state.speed * RISEN_APEX) / state.speed + (next() * 2 - 1) * error + 0.04;
				lastId = item.id;
			}
			if (planned !== null && state.t >= planned) {
				leap = true;
				planned = null;
			}
		}
		if (player === "masher") leap = next() < 0.25;
		stepRisen(state, { leap }, events);
	}
	return { state, events, result: risenResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, RISEN_SECONDS);
	assert.ok(GAME.minSeconds <= RISEN_MIN_SECONDS);
	assert.equal(RISEN_STEP, 1 / 60);
});

test("the same seed and leaps play the same round", () => {
	assert.deepEqual(play(7, "late").state, play(7, "late").state);
	assert.deepEqual(play(11, "masher").events, play(11, "masher").events);
});

test("a runner who leaps on time reaches the disciples on every seed, with gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events, state } = play(seed * 7919, "skilled");
		assert.equal(result.won, true, `seed ${seed}`);
		assert.equal(result.seconds, RISEN_SECONDS, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(result.count, state.obstacles.length, `seed ${seed}`);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("the leap marker is honest: leaping the moment it lights always clears", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const state = newRisen(seed);
		let lastId = -1;
		while (state.phase === "playing") {
			const item = nextObstacle(state);
			const leap = !!item && state.grounded && item.id !== lastId && leapClears(state, item);
			if (leap) lastId = item.id;
			stepRisen(state, { leap });
		}
		assert.equal(state.stumbles, 0, `seed ${seed}`);
	}
});

test("an idle runner always stumbles out; a masher rarely arrives", () => {
	let masherWon = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, "idle");
		assert.equal(idle.result.won, false, `seed ${seed}`);
		assert.equal(idle.state.stumbles, RISEN_STUMBLES);
		assert.ok(idle.result.seconds < RISEN_SECONDS);
		if (play(seed, "masher").result.won) masherWon++;
	}
	assert.ok(masherWon < SEEDS * 0.2, `${masherWon} won`);
});

test("a sloppy, late runner sometimes stumbles out and seldom keeps gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, "late", 0.15);
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(won < SEEDS, `${won} won`);
	assert.ok(won > 0, "a sloppy runner can still arrive");
	assert.ok(gold < won, `${gold} gold of ${won}`);
});

test("a stumble slows her and the third ends the run", () => {
	const state = newRisen(3);
	const events = [];
	while (state.phase === "playing" && state.stumbles === 0) stepRisen(state, { leap: false }, events);
	stepRisen(state, { leap: false }, events);
	assert.ok(state.speed < 210);
	while (state.phase === "playing") stepRisen(state, { leap: false }, events);
	assert.equal(state.phase, "lost");
	assert.equal(events.filter((event) => event.type === "stumble").length, RISEN_STUMBLES);
	assert.equal(events.at(-1).type, "fell");
});

test("every round has stones and roots to leap", () => {
	for (let seed = 1; seed <= 50; seed++) assert.ok(newRisen(seed).obstacles.length >= 9);
});
