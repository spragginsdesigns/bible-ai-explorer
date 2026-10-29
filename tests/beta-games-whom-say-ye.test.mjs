/**
 * Whom Say Ye? (LC-17851, docs/beta/games.md), Matthew 16:13-18: the round
 * replays exactly from a seed, the true scroll is always Peter's confession
 * in the KJV's words, a player who follows it wins every seed with gold and
 * never faster than the server allows, one quick miss still fits, and a
 * guesser, a masher and an idle player rarely or never win.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { WHOM_MIN_SECONDS, WHOM_ROUNDS, WHOM_SAYINGS, WHOM_SECONDS, WHOM_STEP, WHOM_TRUE, newWhom, stepWhom, whomLayout, whomResult, whomTrueSlot } from "../src/lib/beta/games/whom-say-ye-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("whom-say-ye");
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

/** A player who taps `reaction` seconds after the scrolls stop, wrong `slip` of the time; or a masher tapping a random scroll `mash` times a second. */
function play(seed, { reaction = 0.5, slip = 0, mash = 0, missFirst = false } = {}) {
	const state = newWhom(seed);
	const chance = random(seed ^ 0x5eed);
	const events = [];
	let last = -1;
	let missed = false;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const count = WHOM_ROUNDS[state.round].scrolls;
		let pick = null;
		if (mash) {
			if (state.t - last >= 1 / mash) {
				last = state.t;
				pick = Math.floor(chance() * count);
			}
		} else if (state.stage === "choose" && state.t - state.since >= reaction - 1e-9) {
			pick = whomTrueSlot(state);
			if (chance() < slip || (missFirst && !missed)) {
				missed = true;
				pick = (pick + 1 + Math.floor(chance() * (count - 1))) % count;
			}
		}
		stepWhom(state, { pick }, events);
	}
	return { state, events, result: whomResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WHOM_SECONDS);
	assert.ok(GAME.minSeconds <= WHOM_MIN_SECONDS, `${GAME.minSeconds} > ${WHOM_MIN_SECONDS}`);
	assert.equal(WHOM_STEP, 1 / 60);
});

test("the true answer is Peter's confession in the KJV's words, the others what men said (v14, v16)", () => {
	assert.equal(WHOM_TRUE, "Thou art the Christ, the Son of the living God");
	assert.deepEqual(WHOM_SAYINGS.slice(1), ["John the Baptist", "Elias", "Jeremias"]);
	for (let seed = 1; seed <= 20; seed++) assert.equal(newWhom(seed).labels[0], WHOM_TRUE);
	assert.deepEqual(WHOM_ROUNDS.map((round) => round.scrolls), [3, 4, 4]);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7, { slip: 0.3 }).state, play(7, { slip: 0.3 }).state);
	assert.notDeepEqual(newWhom(7).swaps, newWhom(8).swaps);
});

test("the layout follows the swaps: the true scroll ends where the answer is", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const state = newWhom(seed);
		while (state.stage !== "choose") stepWhom(state, { pick: null });
		const layout = whomLayout(state);
		assert.equal(layout.find((item) => item.scroll === 0).x, whomTrueSlot(state));
		assert.deepEqual(layout.map((item) => item.x).sort(), [0, 1, 2]);
	}
});

test("taps while the scrolls are shown or shuffling do nothing", () => {
	const state = newWhom(5);
	for (let tick = 0; tick < 60 && state.stage !== "choose"; tick++) stepWhom(state, { pick: 0 });
	assert.equal(state.misses, 0);
	assert.equal(state.right, 0);
});

test("a player who follows the true scroll wins every seed with gold, never faster than the server allows", () => {
	let fastest = Infinity;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		assert.equal(gradeFor(result.score), "gold", `seed ${seed}: ${result.score}`);
		assert.equal(result.count, 3);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
		fastest = Math.min(fastest, play(seed, { reaction: 0 }).result.seconds);
	}
	assert.ok(fastest >= WHOM_MIN_SECONDS - 0.05, `${fastest}`);
});

test("one quick miss still fits in the clock, for silver at best", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { reaction: 0.45, missFirst: true });
		if (result.won) {
			won++;
			assert.notEqual(gradeFor(result.score), "gold");
		}
	}
	assert.ok(won >= SEEDS * 0.9, `${won} won`);
});

test("a sloppy player sometimes loses; a guesser and a masher rarely win; an idle player never", () => {
	let sloppy = 0;
	let guessed = 0;
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { reaction: 0.8, slip: 0.25 }).result.won) sloppy++;
		if (play(seed, { reaction: 0.6, slip: 0.7 }).result.won) guessed++;
		if (play(seed, { mash: 5 }).result.won) mashed++;
		const idle = play(seed, { reaction: 99 });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - WHOM_SECONDS) < 0.05);
	}
	assert.ok(sloppy > 0 && sloppy < SEEDS * 0.9, `${sloppy} sloppy wins`);
	assert.ok(guessed < SEEDS * 0.2, `${guessed} guesser wins`);
	assert.ok(mashed < SEEDS * 0.2, `${mashed} masher wins`);
});
