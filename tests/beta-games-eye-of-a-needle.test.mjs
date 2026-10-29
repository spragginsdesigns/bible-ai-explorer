/**
 * The Eye of a Needle (LC-17851, docs/beta/games.md), Matthew 19:23-26: the
 * round replays exactly from a seed, a steady hand threads every eye on
 * nearly every seed and never wins faster than the server allows, an idle,
 * held-down or mashing thread snaps, and a late hand sometimes does too.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	NEEDLE_COUNT,
	NEEDLE_GUARD,
	NEEDLE_HEAD_X,
	NEEDLE_MIN_SECONDS,
	NEEDLE_SECONDS,
	NEEDLE_SPEED,
	NEEDLE_STEP,
	NEEDLE_STRANDS,
	needleResult,
	newNeedle,
	nextNeedle,
	stepNeedle,
} from "../src/lib/beta/games/eye-of-a-needle-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("eye-of-a-needle");
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

/** Plays a round; `control(state, history, next)` says whether the thread is held this tick. */
function play(seed, control) {
	const state = newNeedle(seed);
	const events = [];
	const history = [];
	const next = random(seed * 31 + 7);
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		history.push({ y: state.y, vy: state.vy, target: (nextNeedle(state) ?? { eyeY: 200 }).eyeY });
		stepNeedle(state, { hold: control(state, history, next) }, events);
	}
	return { state, events, result: needleResult(state) };
}

/** Aims at the next eye's centre, braking a little early. */
const skilled = () => (state) => state.y + state.vy * 0.12 > (nextNeedle(state)?.eyeY ?? 200);
/** Sees the thread about a tenth of a second late and aims loosely. */
const sloppy = () => {
	let jitter = 0;
	return (state, history, next) => {
		const seen = history[Math.max(0, history.length - 8)];
		if (history.length % 6 === 0) jitter = (next() * 2 - 1) * 15;
		return seen.y + seen.vy * 0.12 > seen.target + jitter;
	};
};
/** Holds or lets go at random, a new choice every tenth of a second. */
const masher = () => {
	let held = false;
	return (state, history, next) => {
		if (history.length % 6 === 0) held = next() < 0.5;
		return held;
	};
};

function rates(make) {
	let won = 0;
	let gold = 0;
	const results = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const run = play(seed * 7919, make());
		results.push(run);
		if (run.result.won) {
			won++;
			if (gradeFor(run.result.score) === "gold") gold++;
		}
	}
	return { won, gold, results };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, NEEDLE_SECONDS);
	assert.ok(GAME.minSeconds <= NEEDLE_MIN_SECONDS);
	assert.equal(NEEDLE_STEP, 1 / 60);
	assert.deepEqual(GAME.controls[0].keys, ["Space", "↑"]);
});

test("the last needle is behind the thread before the round runs out, and a snag's grace never reaches the next needle", () => {
	const state = newNeedle(1);
	const last = state.needles[NEEDLE_COUNT - 1];
	assert.ok(last.at + 20 / NEEDLE_SPEED < NEEDLE_SECONDS - 0.1);
	const firstX = state.needles[0].at * NEEDLE_SPEED + NEEDLE_HEAD_X;
	assert.ok(firstX > 300 && firstX < 400 - 11, "the first needle and its eye are in view from the first frame");
	assert.ok(NEEDLE_GUARD + 0.3 < state.needles[1].at - state.needles[0].at);
});

test("the same seed and hand play the same round", () => {
	assert.deepEqual(play(7, skilled()).state, play(7, skilled()).state);
	assert.deepEqual(play(11, masher()).state, play(11, masher()).state);
});

test("a steady hand threads nearly every seed, mostly gold, never faster than the server allows", () => {
	const { won, gold, results } = rates(skilled);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.8, `${gold} gold of ${won}`);
	for (const { result, events } of results) {
		if (!result.won) continue;
		assert.ok(result.seconds >= GAME.minSeconds, `${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	const clean = results.find(({ result }) => result.score === 100);
	assert.ok(clean, "a clean run scores 100");
	assert.equal(clean.result.count, NEEDLE_COUNT);
});

test("an idle thread and a held-down one never win, and snap well before the end", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		for (const hold of [false, true]) {
			const { result, state } = play(seed, () => hold);
			assert.equal(result.won, false, `seed ${seed} hold ${hold}`);
			assert.equal(state.strands, 0);
			assert.ok(result.seconds < NEEDLE_SECONDS - 3);
		}
	}
});

test("a masher rarely wins", () => {
	const { won } = rates(masher);
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});

test("a late, loose hand is hard: some rounds win, some snap", () => {
	const { won } = rates(sloppy);
	assert.ok(won > 0 && won < SEEDS, `${won} won`);
});

test("one needle costs at most one strand, and three snags lose", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const { events, state } = play(seed, () => false);
		const snags = events.filter((event) => event.type === "snag");
		assert.equal(new Set(snags.map((event) => event.index)).size, snags.length);
		assert.equal(snags.length, NEEDLE_STRANDS);
		assert.equal(state.phase, "lost");
	}
});
