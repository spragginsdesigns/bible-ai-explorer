/**
 * Let Your Light Shine (LC-17851, docs/beta/games.md), Matthew 5:14-16: the
 * round replays exactly from a seed, a quick lifter keeps the house lit on
 * every seed and never wins faster than the server allows, a slow lifter
 * sometimes lets the house go dark, and an idle or random tapper never keeps
 * it lit, nor does one who taps the candlesticks in turn without looking.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	LIGHT_CANDLES,
	LIGHT_MIN_SECONDS,
	LIGHT_MISS_LIMIT,
	LIGHT_OUT_LIMIT,
	LIGHT_SECONDS,
	LIGHT_STEP,
	bushelAt,
	lightResult,
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

/**
 * Plays a round. A lifter sees a bushel `react` seconds after it starts to
 * fall, taps at most every `gap` seconds, the most urgent bushel first, within
 * `aim` units; a masher taps anywhere `mash` times a second; a blind player
 * taps the six candles' bushel spots in turn `rotate` times a second; `idle`
 * never taps.
 */
function play(seed, { react = 0.3, gap = 0.16, aim = 6, mash = 0, rotate = 0, idle = false } = {}) {
	const state = newLight(seed);
	const next = random(seed * 31 + 7);
	const events = [];
	let last = -9;
	let turn = 0;
	let due = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const taps = [];
		if (rotate > 0) {
			due += rotate * LIGHT_STEP;
			if (due >= 1) {
				due -= 1;
				const candle = LIGHT_CANDLES[turn++ % LIGHT_CANDLES.length];
				taps.push({ x: candle.x, y: candle.y - 30 });
			}
		} else if (mash > 0) {
			if (next() < mash / 60) taps.push({ x: next() * 400, y: next() * 400 });
		} else if (!idle && state.t - last >= gap) {
			const seen = state.bushels.filter((bushel) => state.t - bushel.born >= react).sort((a, b) => a.smothers - b.smothers);
			if (seen.length) {
				const at = bushelAt(seen[0], state.t);
				taps.push({ x: at.x + (next() * 2 - 1) * aim, y: at.y + (next() * 2 - 1) * aim });
				last = state.t;
			}
		}
		stepLight(state, { taps }, events);
	}
	return { state, events, result: lightResult(state) };
}

function wins(options) {
	return tally(options).won;
}

function tally(options) {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919, options);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
	}
	return { won, gold };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, LIGHT_SECONDS);
	assert.ok(GAME.minSeconds <= LIGHT_MIN_SECONDS);
	assert.equal(LIGHT_STEP, 1 / 60);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7).state, play(7).state);
	assert.deepEqual(play(11, { react: 0.8, gap: 0.4 }).events, play(11, { react: 0.8, gap: 0.4 }).events);
});

test("a quick lifter keeps the house lit on every seed, mostly gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("the bushels come faster: more fall in the last five seconds than the first five", () => {
	let early = 0;
	let late = 0;
	for (let seed = 1; seed <= 50; seed++) {
		const state = newLight(seed);
		for (let tick = 0; tick < LIGHT_SECONDS * 60 && state.phase === "playing"; tick++) {
			const events = [];
			const taps = state.bushels.map((bushel) => bushelAt(bushel, state.t));
			stepLight(state, { taps }, events);
			const drops = events.filter((event) => event.type === "drop").length;
			if (state.t < 5) early += drops;
			if (state.t > 10) late += drops;
		}
	}
	assert.ok(late > early * 1.6, `${early} early, ${late} late`);
});

test("a slow lifter sometimes lets the house go dark; a late one mostly does", () => {
	const sloppy = wins({ react: 0.8, gap: 0.4 });
	assert.ok(sloppy < SEEDS * 0.9 && sloppy > SEEDS * 0.2, `sloppy won ${sloppy}`);
	assert.ok(wins({ react: 1.0, gap: 0.45 }) < SEEDS * 0.3);
});

test("an idle player never wins, and tapping at random rarely does", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.equal(idle.state.outs, LIGHT_OUT_LIMIT);
	}
	assert.ok(wins({ mash: 6 }) < SEEDS * 0.2);
	assert.ok(wins({ mash: 12 }) < SEEDS * 0.2);
});

test("every tenth miss puts out the lit candle nearest it", () => {
	const state = newLight(3);
	const events = [];
	const spot = { x: LIGHT_CANDLES[0].x, y: 40 };
	for (let i = 1; i < LIGHT_MISS_LIMIT; i++) stepLight(state, { taps: [spot] }, events);
	assert.equal(state.outs, 0);
	assert.equal(events.filter((event) => event.type === "miss").length, LIGHT_MISS_LIMIT - 1);
	stepLight(state, { taps: [spot] }, events);
	assert.equal(state.misses, LIGHT_MISS_LIMIT);
	assert.equal(state.outs, 1);
	assert.equal(state.candles[0].lit, false);
	assert.deepEqual(events.filter((event) => event.type === "out"), [{ type: "out", candle: 0 }]);
});

test("tapping the candlesticks in turn without looking rarely keeps the light, and never mostly gold", () => {
	for (const rotate of [4, 5, 6]) {
		const { won, gold } = tally({ rotate });
		assert.ok(won < SEEDS * 0.2, `${rotate} taps/s won ${won}`);
		assert.ok(gold <= won / 2, `${rotate} taps/s: ${gold} gold of ${won}`);
	}
});
