/**
 * The Last Shall Be First (LC-17908, docs/beta/games.md), Matthew 20:1-16:
 * every line is laid jumbled with known fewest swaps, the round replays
 * exactly from a seed, a skilled player has all three lines paid on every
 * seed and never faster than the server allows, an idle or mashing one does
 * not, and a sloppy one sometimes runs out of time and rarely earns gold.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	LAST_LINES,
	LAST_MIN_SECONDS,
	LAST_PAY,
	LAST_SECONDS,
	LAST_STEP,
	LAST_SWAP_GAP,
	lastFewestSwaps,
	lastHours,
	lastInOrder,
	lastPaying,
	lastResult,
	lastTarget,
	newLast,
	stepLast,
} from "../src/lib/beta/games/the-last-shall-be-first-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-last-shall-be-first");
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

/** A swap that brings the line one swap nearer to order. */
function bestSwap(hours) {
	const fewest = lastFewestSwaps(hours);
	for (let a = 0; a < hours.length; a++) {
		for (let b = a + 1; b < hours.length; b++) {
			if (hours[a] === hours[b]) continue;
			const swapped = [...hours];
			[swapped[a], swapped[b]] = [swapped[b], swapped[a]];
			if (lastFewestSwaps(swapped) === fewest - 1) return [a, b];
		}
	}
	return null;
}

/**
 * Plays a round. `look` is how long the player studies a new line, `gap` the
 * time between choices, `slip` the chance a choice goes to the wrong man.
 */
function play(seed, { look = 0.5, gap = 0.3, slip = 0, idle = false, mash = null } = {}) {
	const state = newLast(seed);
	const events = [];
	const next = random(seed ^ 0x5bd1e995);
	let line = -1;
	let nextChoice = 0;
	let plan = [];
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		const input = {};
		if (lastPaying(state)) {
			line = -1;
			plan = [];
		} else if (line !== state.line) {
			line = state.line;
			nextChoice = state.t + look;
		}
		if (mash === "random" && !lastPaying(state)) input.select = Math.floor(next() * state.men.length);
		else if (mash === "first") input.select = 0;
		else if (!idle && !mash && !lastPaying(state) && state.t >= nextChoice - 1e-9 && state.queued === null) {
			if (!plan.length) {
				if (state.picked !== null) plan = [state.picked];
				else {
					const swap = bestSwap(lastHours(state));
					if (swap) plan = next() < 0.5 ? swap : [swap[1], swap[0]];
				}
			}
			if (next() < slip) {
				input.select = Math.floor(next() * state.men.length);
				plan = [];
			} else if (plan.length) input.select = plan.shift();
			nextChoice = state.t + gap;
		}
		stepLast(state, input, events);
	}
	return { state, events, result: lastResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, LAST_SECONDS);
	assert.ok(GAME.minSeconds <= LAST_MIN_SECONDS, `${GAME.minSeconds} > ${LAST_MIN_SECONDS}`);
	assert.equal(LAST_STEP, 1 / 60);
	assert.equal(LAST_LINES.length, 3);
});

test("the line in order is the last hired first, and two who share an hour may stand either way", () => {
	assert.deepEqual(lastTarget([0, 4, 2, 1, 3]), [4, 3, 2, 1, 0]);
	assert.equal(lastInOrder([4, 3, 3, 2, 1, 0]), true);
	assert.equal(lastInOrder([0, 1, 2, 3, 4]), false);
	assert.equal(lastFewestSwaps([4, 3, 2, 1, 0]), 0);
	assert.equal(lastFewestSwaps([3, 4, 2, 1, 0]), 1);
	assert.equal(lastFewestSwaps([0, 1, 2, 3, 4]), 2);
	assert.equal(lastFewestSwaps([2, 4, 3, 3, 1, 0]), 2);
});

test("every line is laid jumbled, four then five then six, with its fewest swaps in bounds", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newLast(seed * 104729);
		const ids = new Set();
		state.lines.forEach((line, index) => {
			const spec = LAST_LINES[index];
			assert.equal(line.length, spec.men);
			const hours = line.map((man) => man.hour);
			assert.equal(lastInOrder(hours), false, `seed ${seed} line ${index} starts in order`);
			const fewest = lastFewestSwaps(hours);
			assert.ok(fewest >= spec.minSwaps && fewest <= spec.maxSwaps, `seed ${seed} line ${index}: ${fewest}`);
			assert.equal(new Set(hours).size, Math.min(5, spec.men), "every hour is there once, and with six men one twice");
			for (const man of line) ids.add(man.id);
		});
		assert.equal(ids.size, 15);
	}
});

test("the same seed and choices play the same round", () => {
	assert.deepEqual(play(7, { slip: 0.3 }).state, play(7, { slip: 0.3 }).state);
	assert.deepEqual(newLast(99).lines, newLast(99).lines);
});

test("a skilled player has every line paid on every seed, mostly gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events, state } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "paid").length, 3);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(state.swaps, state.needed, "a skilled player makes only the swaps needed");
		assert.equal(result.count, 15);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("choosing flat out, as fast as men can change places, is never faster than the minimum", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { look: 0, gap: 0 });
		assert.equal(result.won, true);
		assert.ok(result.seconds >= LAST_MIN_SECONDS - 1e-9, `${result.seconds}`);
		assert.ok(result.seconds >= GAME.minSeconds);
	}
	assert.ok(LAST_MIN_SECONDS >= (LAST_LINES.length - 1) * LAST_PAY);
});

test("an idle player never wins and the round lasts as long as the registry says", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { idle: true });
		assert.equal(result.won, false);
		assert.equal(result.score, 0);
		assert.equal(result.count, 0);
		assert.ok(Math.abs(result.seconds - LAST_SECONDS) < 0.05);
	}
});

test("mashing rarely has the whole line paid, and choosing the front man over and over never does", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { mash: "random" }).result.won) won++;
		assert.equal(play(seed, { mash: "first" }).result.won, false);
	}
	assert.ok(won <= SEEDS * 0.1, `${won} won by mashing`);
});

test("a sloppy player, slower and choosing the wrong man now and then, sometimes runs out of time and rarely earns gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 31, { look: 1, gap: 0.55, slip: 0.2 });
		if (result.won) {
			won++;
			if (gradeFor(result.score) === "gold") gold++;
		}
	}
	assert.ok(won < SEEDS * 0.9, `${won} won`);
	assert.ok(won > SEEDS * 0.15, `${won} won`);
	assert.ok(gold <= SEEDS * 0.2, `${gold} gold`);
});

test("choosing a man twice puts him down, a choice made while two change places waits, and choices during the pay do nothing", () => {
	const state = newLast(5);
	stepLast(state, { select: 1 });
	assert.equal(state.picked, 1);
	stepLast(state, { select: 1 });
	assert.equal(state.picked, null, "chosen twice: put down");
	const [a, b] = bestSwap(lastHours(state));
	stepLast(state, { select: a });
	stepLast(state, { select: b });
	assert.equal(state.swaps, 1);
	const [c, d] = bestSwap(lastHours(state));
	stepLast(state, { select: c });
	assert.equal(state.picked, null, "the next choice waits while the two change places");
	assert.equal(state.queued, c);
	while (state.picked === null) stepLast(state, {});
	assert.ok(state.t - state.lastSwap >= LAST_SWAP_GAP - 1e-9);
	stepLast(state, { select: d });
	assert.equal(state.swaps, 2);
	assert.equal(state.paid, 1);
	assert.ok(lastPaying(state));
	const before = state.men.map((man) => man.id);
	stepLast(state, { select: 0 });
	assert.deepEqual(state.men.map((man) => man.id), before);
	while (lastPaying(state)) stepLast(state, {});
	assert.equal(state.line, 1);
	assert.equal(state.men.length, 5);
});
