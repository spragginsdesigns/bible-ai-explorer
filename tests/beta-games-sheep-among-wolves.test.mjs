/**
 * Sheep Among Wolves (LC-17851, docs/beta/games.md), Matthew 10:16-31: the
 * round replays exactly from a seed, a sheep that watches the crouching
 * wolves and steps out of their lines survives nearly every seed, a sheep
 * that stands still or wanders does not, and the round lasts as long as the
 * registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { WOLVES_MIN_SECONDS, WOLVES_SECONDS, WOLVES_STEP, newWolves, stepWolves, wolvesResult } from "../src/lib/beta/games/sheep-among-wolves-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("sheep-among-wolves");
const SEEDS = 200;
const DIRECTIONS = [{ x: 0, y: 0 }];
for (let i = 0; i < 16; i++) DIRECTIONS.push({ x: Math.cos((i / 16) * Math.PI * 2), y: Math.sin((i / 16) * Math.PI * 2) });

/** How good it is to move `dir` for `horizon` ticks from here: bitten is worst, then near wolves and walls. */
function judge(state, dir, horizon) {
	const trial = structuredClone(state);
	trial.safeUntil = 0;
	let worst = 200;
	for (let tick = 1; tick <= horizon; tick++) {
		const events = [];
		stepWolves(trial, dir, events);
		if (events.some((event) => event.type === "bite")) return -1000 + tick;
		for (const wolf of trial.wolves) {
			if (trial.t < wolf.enters) continue;
			const near = Math.hypot(wolf.x - trial.x, wolf.y - trial.y);
			worst = Math.min(worst, near * (wolf.mode === "crouch" || wolf.mode === "lunge" ? 0.6 : 1));
		}
	}
	const wall = Math.min(trial.x, trial.y, 400 - trial.x, 400 - trial.y);
	return Math.min(worst, 120) + Math.min(wall, 70) * 0.8;
}

/** A careful sheep: every `every` ticks, picks the way that keeps it furthest from bites over `horizon` ticks. */
function careful(every = 4, horizon = 36) {
	let dir = { x: 0, y: 0 };
	return (state, tick) => {
		if (tick % every === 0) {
			let best = -Infinity;
			for (const option of DIRECTIONS) {
				const score = judge(state, option, horizon);
				if (score > best) {
					best = score;
					dir = option;
				}
			}
		}
		return dir;
	};
}

function wanderer(seed) {
	let s = seed >>> 0 || 1;
	const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
	let dir = { x: 0, y: 0 };
	return (state, tick) => {
		if (tick % 12 === 0) {
			const options = [-1, 0, 1];
			dir = { x: options[Math.floor(rand() * 3)], y: options[Math.floor(rand() * 3)] };
		}
		return dir;
	};
}

function play(seed, steer) {
	const state = newWolves(seed);
	const events = [];
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepWolves(state, steer(state, tick), events);
	return { state, events, result: wolvesResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WOLVES_SECONDS);
	assert.ok(GAME.minSeconds <= WOLVES_MIN_SECONDS);
	assert.equal(WOLVES_STEP, 1 / 60);
});

test("the same seed and steering play the same round", () => {
	assert.deepEqual(play(7, wanderer(5)).state, play(7, wanderer(5)).state);
	assert.deepEqual(play(11, careful()).state, play(11, careful()).state);
});

test("a careful sheep survives nearly every seed, mostly gold, and only at the end of the round", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, careful());
		assert.ok(events.filter((event) => event.type === "crouch").length >= 10, `seed ${seed}: few lunges`);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	console.log(`careful: ${won}/${SEEDS} won, ${gold} gold`);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.6, `${gold} gold of ${won}`);
});

test("a sheep that stands still is always caught", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, () => ({ x: 0, y: 0 }));
		assert.equal(result.won, false, `seed ${seed}`);
		assert.ok(result.seconds < WOLVES_SECONDS);
	}
});

test("a wandering sheep rarely survives", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, wanderer(seed * 31)).result.won) won++;
	console.log(`wanderer: ${won}/${SEEDS} won`);
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});

test("a slow-reacting sheep sometimes loses", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, careful(24, 12)).result.won) won++;
	console.log(`slow: ${won}/${SEEDS} won`);
	assert.ok(won < SEEDS * 0.9, `${won} won`);
	assert.ok(won > 0, "nobody slow survives");
});
