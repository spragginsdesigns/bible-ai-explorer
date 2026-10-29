/**
 * Built on the Rock (LC-17851, docs/beta/games.md), Matthew 7:24-27: the round
 * replays exactly from a seed; a builder who drops each stone square raises
 * the house on nearly every seed, mostly gold, and never faster than the
 * server allows; a careless one sometimes sees it fall; a masher and an idle
 * player never finish it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	HOUSE_ARRIVE_TICKS,
	HOUSE_COURSES,
	HOUSE_MIN_SECONDS,
	HOUSE_SECONDS,
	HOUSE_STEP,
	houseResult,
	houseSpeed,
	houseTop,
	newHouse,
	stepHouse,
} from "../src/lib/beta/games/house-on-the-rock-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("house-on-the-rock");
const SEEDS = 200;

function rng(seed) {
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
 * Plays a round. A builder aims each stone at the course below, off by up to
 * `error` units (a press a moment early or late); `masher` drops every few
 * ticks; `asap` drops the moment a stone may be dropped.
 */
function play(seed, { error = 0, masher = false, idle = false, asap = false } = {}) {
	const state = newHouse(seed);
	const events = [];
	const next = rng(seed ^ 0x2545f491);
	let course = -1;
	let aim = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		let drop = false;
		if (masher) drop = tick % 9 === 0;
		else if (asap) drop = true;
		else if (!idle && state.stone.droppedAt === null && state.tick + 1 - state.stone.spawnedAt >= HOUSE_ARRIVE_TICKS) {
			if (state.courses.length !== course) {
				course = state.courses.length;
				aim = (next() * 2 - 1) * error;
			}
			const target = houseTop(state).x + aim;
			const step = houseSpeed(state.courses.length) / 60;
			const x = state.stone.x + state.stone.dir * step;
			drop = Math.abs(x - target) <= step / 2 + 0.01;
		}
		stepHouse(state, { drop }, events);
	}
	return { state, events, result: houseResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, HOUSE_SECONDS);
	assert.ok(GAME.minSeconds <= HOUSE_MIN_SECONDS);
	assert.equal(HOUSE_STEP, 1 / 60);
});

test("the same seed and drops build the same house", () => {
	assert.deepEqual(play(7, { error: 12 }).state, play(7, { error: 12 }).state);
});

test("no house goes up faster than the minimum, however soon the stones are dropped", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		for (const run of [play(seed, { asap: true }), play(seed, { masher: true })]) {
			if (run.result.won) assert.ok(run.result.seconds >= HOUSE_MIN_SECONDS - 0.05, `${run.result.seconds}`);
			assert.ok(run.state.t >= Math.min(run.state.courses.length, HOUSE_COURSES) * 0.75 - 0.05);
		}
	}
});

test("a builder who drops each stone square raises the house on nearly every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, { error: 7 });
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(result.count, HOUSE_COURSES);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "roof").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.7, `${gold} gold of ${won}`);
});

test("a careless builder sometimes sees the house fall", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, { error: 26 }).result.won) won++;
	assert.ok(won > 0 && won < SEEDS * 0.8, `${won} won`);
});

test("a masher rarely builds it and an idle player never does", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { masher: true }).result.won) won++;
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - HOUSE_SECONDS) < 0.05);
	}
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});
