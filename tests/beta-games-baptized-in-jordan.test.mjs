/**
 * Baptized in Jordan (LC-17908, docs/beta/games.md), Matthew 3:1-17: the
 * round replays exactly from a seed, a steady hand that lets go in the middle
 * of the band baptizes all five on every seed, with gold, and never faster
 * than the server allows; an idle hand, a held-down one and a masher never
 * win; a late, loose hand sometimes runs out of time and rarely earns gold.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	JORDAN_COUNT,
	JORDAN_MIN_SECONDS,
	JORDAN_SECONDS,
	JORDAN_STEP,
	JORDAN_WIDTHS,
	jordanPenitent,
	jordanRate,
	jordanResult,
	newJordan,
	stepJordan,
} from "../src/lib/beta/games/baptized-in-jordan-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("baptized-in-jordan");
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

/** Plays a round; `control(state, tick, next)` says whether the hold is down this step. */
function play(seed, control) {
	const state = newJordan(seed);
	const events = [];
	const next = random(seed * 31 + 7);
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepJordan(state, { hold: control(state, tick, next) }, events);
	return { state, events, result: jordanResult(state) };
}

/** Holds as each one is ready and lets go at the band's centre. */
const skilled = () => (state) => {
	if (state.stage !== "lower") return state.stage === "ready";
	const penitent = jordanPenitent(state);
	return state.depth < (penitent.low + penitent.high) / 2 - (jordanRate(penitent, state.held) * JORDAN_STEP) / 2;
};
/** Aims loosely anywhere around the band, and lets go up to a tenth of a second late. */
const sloppy = () => {
	let target = null;
	let releaseAt = null;
	return (state, tick, next) => {
		if (state.stage !== "lower") {
			target = null;
			releaseAt = null;
			return state.stage === "ready";
		}
		const penitent = jordanPenitent(state);
		if (target === null) target = (penitent.low + penitent.high) / 2 + (next() * 2 - 1) * (penitent.high - penitent.low) * 0.62;
		if (releaseAt === null && state.depth >= target) releaseAt = tick + Math.floor(next() * 7);
		return releaseAt === null || tick < releaseAt;
	};
};
/** Holds or lets go at random, a new choice every tenth of a second. */
const masher = () => {
	let held = false;
	return (state, tick, next) => {
		if (tick % 6 === 0) held = next() < 0.5;
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
	assert.equal(GAME.seconds, JORDAN_SECONDS);
	assert.ok(GAME.minSeconds <= JORDAN_MIN_SECONDS, `${GAME.minSeconds} > ${JORDAN_MIN_SECONDS}`);
	assert.ok(GAME.minSeconds >= JORDAN_MIN_SECONDS - 0.5, "the minimum is the fastest win, not a guess");
	assert.equal(JORDAN_STEP, 1 / 60);
	assert.equal(JORDAN_WIDTHS.length, JORDAN_COUNT);
});

test("the same seed and hold play the same round", () => {
	assert.deepEqual(play(7, skilled()).state, play(7, skilled()).state);
	assert.deepEqual(play(11, sloppy()).state, play(11, sloppy()).state);
});

test("every penitent has a band under the water, before the line, and the band narrows", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { penitents } = newJordan(seed);
		assert.equal(penitents.length, JORDAN_COUNT);
		penitents.forEach((penitent, index) => {
			assert.ok(penitent.low > 0 && penitent.high < 100 && penitent.high > penitent.low);
			if (index) assert.ok(penitent.high - penitent.low < penitents[index - 1].high - penitents[index - 1].low);
		});
	}
});

test("a steady hand baptizes all five on every seed, with gold, and never faster than the server allows", () => {
	const { won, gold, results } = rates(skilled);
	assert.equal(won, SEEDS);
	assert.ok(gold >= SEEDS * 0.95, `${gold} gold`);
	for (const { result, events, state } of results) {
		assert.equal(result.count, JORDAN_COUNT);
		assert.equal(state.misses, 0);
		assert.ok(result.seconds >= GAME.minSeconds, `${result.seconds}s`);
		assert.ok(result.seconds <= JORDAN_SECONDS - 3, `${result.seconds}s leaves time for Jesus's coming`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
});

test("letting go the instant the water closes over them is still never faster than the minimum", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, (state) => {
			if (state.stage !== "lower") return true;
			return state.depth < jordanPenitent(state).low;
		});
		assert.equal(result.won, true);
		assert.ok(result.seconds >= JORDAN_MIN_SECONDS, `${result.seconds}`);
	}
});

test("an idle hand, a held-down one and a masher never baptize them all", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, () => false);
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - JORDAN_SECONDS) < 0.05);
		const held = play(seed, () => true);
		assert.equal(held.result.won, false);
		assert.ok(held.events.some((event) => event.type === "long"), "holding on raises them, to be done again");
	}
	assert.ok(rates(masher).won <= SEEDS * 0.05, `${rates(masher).won} masher wins`);
});

test("a late, loose hand misses: it sometimes runs out of time and rarely earns gold", () => {
	const { won, gold, results } = rates(sloppy);
	assert.ok(won < SEEDS, `${won} won`);
	assert.ok(won > SEEDS * 0.2, `${won} won`);
	assert.ok(gold <= SEEDS * 0.1, `${gold} gold`);
	assert.ok(results.filter(({ state }) => state.misses > 0).length > SEEDS / 2, "most loose rounds miss at least once");
});

test("letting go too soon, or holding past the line, is a miss and they come up to be done again", () => {
	const short = newJordan(3);
	const events = [];
	for (let tick = 0; short.stage !== "lower" && tick < 120; tick++) stepJordan(short, { hold: true }, events);
	stepJordan(short, { hold: false }, events);
	assert.equal(short.mark, "short");
	assert.equal(short.misses, 1);
	assert.equal(short.index, 0);
	for (let tick = 0; short.stage !== "ready" && tick < 120; tick++) stepJordan(short, { hold: false }, events);
	assert.equal(short.index, 0, "the same one, again");
	assert.ok(events.some((event) => event.type === "short"));
});
