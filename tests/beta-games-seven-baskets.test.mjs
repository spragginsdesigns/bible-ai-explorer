/**
 * Seven Baskets Full (LC-17851, docs/beta/games.md), Matthew 15:32-38: the
 * round replays exactly from a seed, a skilled gatherer fills all seven
 * baskets on nearly every seed and never sooner than the server allows, a
 * late one sometimes runs out of time, a masher or an idle basket does not.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	BASKETS_COUNT,
	BASKETS_HALF,
	BASKETS_ITEM_R,
	BASKETS_MIN_SECONDS,
	BASKETS_NEEDED,
	BASKETS_SECONDS,
	BASKETS_SPEED,
	BASKETS_STEP,
	basketsResult,
	newBaskets,
	stepBaskets,
} from "../src/lib/beta/games/seven-baskets-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("seven-baskets");
const SEEDS = 200;
const HALF = BASKETS_HALF;

/** Where a gatherer who can see the fragments would hold the basket; `react` is how late they notice each one. */
function plan(state, react = 0) {
	let best = state.basketX;
	let bestValue = -Infinity;
	for (let spot = HALF; spot <= 400 - HALF; spot += 4) {
		let value = -0.0004 * Math.abs(spot - state.basketX);
		for (const fragment of state.fragments) {
			if (fragment.outcome !== null || state.t - fragment.born < react) continue;
			const ahead = fragment.landAt - state.t;
			if (ahead <= 0 || ahead > 1.6) continue;
			const reach = BASKETS_SPEED * ahead;
			const at = Math.max(HALF, Math.min(400 - HALF, state.basketX + Math.max(-reach, Math.min(reach, spot - state.basketX))));
			if (Math.abs(at - fragment.landX) <= HALF + BASKETS_ITEM_R - 3) value += 1 / (1 + 2 * ahead);
		}
		if (value > bestValue) {
			bestValue = value;
			best = spot;
		}
	}
	return best;
}

/** "perfect" teleports the basket under each fragment as it lands (no one can do better). */
function play(seed, player) {
	const state = newBaskets(seed);
	const events = [];
	let roll = (seed % 9973) + 1;
	const rand = () => (roll = (roll * 16807) % 2147483647) / 2147483647;
	let dir = 0;
	let switchAt = 0;
	let aim = 200;
	let planAt = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const input = { dir: 0, target: null };
		if (player === "skilled") input.target = plan(state);
		if (player === "late") {
			if (state.t >= planAt) {
				aim = plan(state, 0.5);
				planAt = state.t + 0.25;
			}
			input.target = aim;
		}
		if (player === "masher") {
			if (state.t >= switchAt) {
				dir = Math.floor(rand() * 3) - 1;
				switchAt = state.t + 0.15 + rand() * 0.5;
			}
			input.dir = dir;
		}
		if (player === "perfect") {
			const due = state.fragments.find((fragment) => fragment.outcome === null && fragment.landAt <= state.t + BASKETS_STEP + 1e-9);
			if (due) state.basketX = due.landX;
		}
		stepBaskets(state, input, events);
	}
	return { state, events, result: basketsResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, BASKETS_SECONDS);
	assert.ok(GAME.minSeconds <= BASKETS_MIN_SECONDS);
	assert.equal(BASKETS_STEP, 1 / 60);
});

test("the same seed and moves play the same round", () => {
	assert.deepEqual(play(17, "skilled").state, play(17, "skilled").state);
	assert.deepEqual(play(17, "masher").state, play(17, "masher").state);
});

test("no round lets the last fragment needed come down sooner than the minimum, and the fragments come quicker later", () => {
	for (let seed = 1; seed <= 1000; seed++) {
		const { fragments } = newBaskets(seed);
		const lands = fragments.map((fragment) => fragment.landAt).sort((a, b) => a - b);
		assert.ok(lands[BASKETS_NEEDED - 1] >= BASKETS_MIN_SECONDS, `seed ${seed}: ${lands[BASKETS_NEEDED - 1]}`);
		assert.ok(lands.filter((at) => at >= 10).length > lands.filter((at) => at < 5).length, `seed ${seed}`);
	}
});

test("catching every fragment the moment it lands is never faster than the minimum, and the server accepts it", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state } = play(seed, "perfect");
		assert.equal(result.won, true);
		assert.equal(state.lost, 0);
		assert.ok(result.seconds >= BASKETS_MIN_SECONDS, `seed ${seed}: ${result.seconds}s`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, BASKETS_MIN_SECONDS).ok, true);
	}
});

test("a skilled gatherer fills all seven on at least 95% of seeds, mostly gold, never faster than the minimum", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, "skilled");
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds && result.seconds >= BASKETS_MIN_SECONDS, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.seconds < BASKETS_SECONDS);
		assert.equal(events.filter((event) => event.type === "full").length, BASKETS_COUNT);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.6, `${gold} gold of ${won}`);
});

test("an idle basket never wins and a masher rarely does", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, "idle").result;
		assert.equal(idle.won, false);
		assert.ok(Math.abs(idle.seconds - BASKETS_SECONDS) < 0.05);
		if (play(seed, "masher").result.won) mashed++;
	}
	assert.ok(mashed < SEEDS * 0.2, `${mashed} mashed wins`);
});

test("a late gatherer misses more and sometimes runs out of time (it is hard enough)", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919, "late").result.won) won++;
	assert.ok(won < SEEDS * 0.95, `${won} won`);
	assert.ok(won > 0);
});
