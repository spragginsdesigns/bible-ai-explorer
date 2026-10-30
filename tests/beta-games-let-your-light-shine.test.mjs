/**
 * Let Your Light Shine (LC-17908, docs/beta/games.md), Matthew 5:14-16: every
 * house is laid solvable and never starts lit, the round replays exactly from
 * a seed, a skilled player lights all three houses on every seed and never
 * faster than the server allows, an idle or mashing one does not, and a
 * sloppy one sometimes runs out of time and rarely earns gold.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	LIGHT_HOUSES,
	LIGHT_KINDLE,
	LIGHT_MIN_SECONDS,
	LIGHT_SECONDS,
	LIGHT_SHINE,
	LIGHT_STEP,
	LIGHT_TURN_GAP,
	lightAllLit,
	lightBoard,
	lightResult,
	lightShining,
	lightTrace,
	newLight,
	stepLight,
} from "../src/lib/beta/games/let-your-light-shine-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("let-your-light-shine");
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

function* subsets(n, count, from = 0, picked = []) {
	if (picked.length === count) {
		yield picked;
		return;
	}
	for (let i = from; i < n; i++) {
		picked.push(i);
		yield* subsets(n, count, i + 1, picked);
		picked.pop();
	}
}

/** The fewest mirrors to turn, from the house as it stands, to light every lamp. */
function solve(board) {
	const base = board.mirrors.map((mirror) => mirror.tilt);
	for (let count = 0; count <= board.mirrors.length; count++) {
		for (const flips of subsets(board.mirrors.length, count)) {
			const tilts = [...base];
			for (const index of flips) tilts[index] = 1 - tilts[index];
			if (lightAllLit(lightTrace(board, tilts))) return [...flips];
		}
	}
	return null;
}

/**
 * Plays a round. `look` is how long the player studies a new house, `gap` the
 * time between turns, `slip` the chance a turn goes to the wrong mirror.
 */
function play(seed, { look = 0.6, gap = 0.4, slip = 0, idle = false, mash = null } = {}) {
	const state = newLight(seed);
	const events = [];
	const next = random(seed ^ 0x5bd1e995);
	let houseFrom = 0;
	let house = -1;
	let nextTurn = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		const input = {};
		if (lightShining(state)) house = -1;
		else if (house !== state.house) {
			house = state.house;
			houseFrom = state.t;
			nextTurn = houseFrom + look;
		}
		const board = lightBoard(state);
		if (mash === "random" && !lightShining(state)) input.turn = Math.floor(next() * board.mirrors.length);
		else if (mash === "first") input.turn = 0;
		else if (!idle && !mash && !lightShining(state) && state.t >= nextTurn - 1e-9) {
			if (next() < slip) input.turn = Math.floor(next() * board.mirrors.length);
			else input.turn = solve(board)[0];
			nextTurn = state.t + gap;
		}
		stepLight(state, input, events);
	}
	return { state, events, result: lightResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, LIGHT_SECONDS);
	assert.ok(GAME.minSeconds <= LIGHT_MIN_SECONDS, `${GAME.minSeconds} > ${LIGHT_MIN_SECONDS}`);
	assert.equal(LIGHT_STEP, 1 / 60);
	assert.equal(LIGHT_HOUSES.length, 3);
});

test("every house is laid solvable, never starts lit, and needs exactly its fewest turns", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newLight(seed * 104729);
		state.boards.forEach((board, index) => {
			assert.equal(board.size, LIGHT_HOUSES[index].size);
			assert.equal(lightAllLit(lightTrace(board)), false, `seed ${seed} house ${index} starts lit`);
			const flips = solve(board);
			assert.ok(flips, `seed ${seed} house ${index} cannot be lit`);
			assert.equal(flips.length, board.need, `seed ${seed} house ${index}`);
			assert.ok(board.lamps.length >= board.need && board.mirrors.length > board.need);
			const cells = new Set(board.mirrors.map((m) => m.r * board.size + m.c));
			for (const lamp of board.lamps) assert.equal(cells.has(lamp.r * board.size + lamp.c), false, "a lamp never shares a room with a mirror");
		});
	}
});

test("the same seed and turns play the same round", () => {
	assert.deepEqual(play(7, { slip: 0.3 }).state, play(7, { slip: 0.3 }).state);
	assert.deepEqual(newLight(99).boards, newLight(99).boards);
});

test("a skilled player lights every house on every seed, mostly gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events, state } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "house").length, 3);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(state.turns, state.needed, "a skilled player turns only what is needed");
		assert.equal(result.count, state.boards.reduce((sum, board) => sum + board.lamps.length, 0));
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("turning flat out, as fast as turns count, is never faster than the minimum", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { look: 0, gap: LIGHT_TURN_GAP });
		assert.equal(result.won, true);
		assert.ok(result.seconds >= LIGHT_MIN_SECONDS - 1e-9, `${result.seconds}`);
		assert.ok(result.seconds >= GAME.minSeconds);
	}
	assert.ok(LIGHT_MIN_SECONDS >= (LIGHT_HOUSES.length - 1) * LIGHT_SHINE);
});

test("an idle player never wins and the round lasts as long as the registry says", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { idle: true });
		assert.equal(result.won, false);
		assert.equal(result.score, 0);
		assert.ok(Math.abs(result.seconds - LIGHT_SECONDS) < 0.05);
	}
});

test("mashing rarely lights the whole city, and turning one mirror over and over never does", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { mash: "random" }).result.won) won++;
		assert.equal(play(seed, { mash: "first" }).result.won, false);
	}
	assert.ok(won <= SEEDS * 0.1, `${won} won by mashing`);
});

test("a sloppy player, slower and turning the wrong mirror now and then, sometimes runs out of time and rarely earns gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 31, { look: 1.5, gap: 0.9, slip: 0.35 });
		if (result.won) {
			won++;
			if (gradeFor(result.score) === "gold") gold++;
		}
	}
	assert.ok(won < SEEDS, `${won} won`);
	assert.ok(won > SEEDS * 0.2, `${won} won`);
	assert.ok(gold <= SEEDS * 0.2, `${gold} gold`);
});

test("a turn pressed while a mirror swings waits for it, the lamps must kindle, and turns during the shine do nothing", () => {
	const state = newLight(5);
	const flips = solve(state.boards[0]);
	assert.equal(flips.length, 2);
	stepLight(state, { turn: flips[0] });
	stepLight(state, { turn: flips[1] });
	stepLight(state, { turn: flips[0] });
	assert.equal(state.turns, 1, "the second turn waits for the first mirror to swing");
	while (state.turns < 2) stepLight(state, {});
	assert.ok(state.t >= LIGHT_TURN_GAP);
	assert.equal(state.turns, 2, "only one turn waits; the third press was dropped");
	assert.equal(lightAllLit(state.beam), true);
	assert.equal(state.solved, 0, "the lamps have not caught yet");
	const litAt = state.t;
	while (!state.solved) stepLight(state, {});
	assert.ok(state.t - litAt >= LIGHT_KINDLE - LIGHT_STEP - 1e-9);
	assert.ok(lightShining(state));
	const before = state.boards[1].mirrors.map((m) => m.tilt);
	stepLight(state, { turn: 0 });
	assert.deepEqual(state.boards[1].mirrors.map((m) => m.tilt), before);
	assert.equal(state.turns, 2);
});
