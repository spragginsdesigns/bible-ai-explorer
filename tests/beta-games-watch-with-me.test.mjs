/**
 * Watch with Me (LC-17851, docs/beta/games.md), Matthew 26:36-41: the round
 * replays exactly from a seed, a watchful player keeps all three awake on
 * every seed and never wins faster than the server allows, a slow one
 * sometimes lets one fall asleep, a masher slips, and an idle player never
 * keeps the watch.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	VIGIL_HEAVY,
	VIGIL_MIN_SECONDS,
	VIGIL_SECONDS,
	VIGIL_SLIP_LIMIT,
	VIGIL_STEP,
	newVigil,
	stepVigil,
	vigilDrain,
	vigilResult,
} from "../src/lib/beta/games/watch-with-me-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("watch-with-me");
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
 * Plays a round. A watcher notices a disciple `react` seconds after his eyes
 * grow heavy, presses at most every `gap` seconds, the sleepiest first, and
 * presses a wrong number `wrong` of the time; a masher presses a random
 * number `mash` times a second.
 */
function play(seed, { react = 0.25, gap = 0.15, wrong = 0, mash = 0, idle = false } = {}) {
	const state = newVigil(seed);
	const next = random(seed * 31 + 7);
	const events = [];
	const heavySince = [null, null, null];
	let last = -9;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		state.disciples.forEach((disciple, index) => {
			if (disciple.awake < VIGIL_HEAVY) heavySince[index] ??= state.t;
			else heavySince[index] = null;
		});
		const wake = [];
		if (mash > 0) {
			if (next() < mash / 60) wake.push(Math.floor(next() * 3));
		} else if (!idle && state.t - last >= gap) {
			const due = [0, 1, 2].filter((index) => heavySince[index] !== null && state.t - heavySince[index] >= react).sort((a, b) => state.disciples[a].awake - state.disciples[b].awake);
			if (due.length) {
				let pick = due[0];
				if (wrong && next() < wrong) pick = (pick + 1 + Math.floor(next() * 2)) % 3;
				wake.push(pick);
				last = state.t;
			}
		}
		stepVigil(state, { wake }, events);
	}
	return { state, events, result: vigilResult(state) };
}

function wins(options) {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919, options).result.won) won++;
	return won;
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, VIGIL_SECONDS);
	assert.ok(GAME.minSeconds <= VIGIL_MIN_SECONDS);
	assert.equal(VIGIL_STEP, 1 / 60);
	assert.deepEqual(GAME.controls[0].keys, ["1", "2", "3"]);
});

test("the same seed and presses play the same round", () => {
	assert.deepEqual(play(7).state, play(7).state);
	assert.deepEqual(play(11, { react: 0.6, wrong: 0.1 }).events, play(11, { react: 0.6, wrong: 0.1 }).events);
});

test("a watchful player keeps all three awake on every seed, gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.95, `${gold} gold`);
});

test("drowsiness speeds up over the round", () => {
	assert.ok(vigilDrain(14) > vigilDrain(1) * 2.5);
});

test("shaking one who is wide awake is a slip, and three slips end the round", () => {
	const state = newVigil(4);
	const wide = state.disciples.findIndex((disciple) => disciple.awake >= VIGIL_HEAVY);
	const events = [];
	for (let i = 0; i < VIGIL_SLIP_LIMIT; i++) stepVigil(state, { wake: [wide] }, events);
	assert.equal(state.slips, VIGIL_SLIP_LIMIT);
	assert.equal(state.phase, "lost");
});

test("a slow watcher sometimes lets one fall asleep; a late one mostly does", () => {
	const slow = wins({ react: 0.6, gap: 0.35, wrong: 0.05 });
	assert.ok(slow < SEEDS * 0.9 && slow > SEEDS * 0.2, `slow won ${slow}`);
	assert.ok(wins({ react: 0.8, gap: 0.4 }) < SEEDS * 0.4);
});

test("an idle player never keeps the watch, and pressing at random rarely does", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.notEqual(idle.state.asleep, null);
	}
	assert.ok(wins({ mash: 3 }) < SEEDS * 0.2);
	assert.ok(wins({ mash: 10 }) < SEEDS * 0.2);
});
