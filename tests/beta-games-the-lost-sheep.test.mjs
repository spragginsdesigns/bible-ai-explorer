/**
 * The Lost Sheep (LC-17851, docs/beta/games.md), Matthew 18:12-14: the round
 * replays exactly from a seed; a quick, careful seeker finds the sheep three
 * times on nearly every seed, mostly gold, never faster than the server
 * allows; a slow or careless one sometimes loses it to nightfall; a masher
 * and an idle player never find it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	SHEEP_DECOY_SPOTS,
	SHEEP_FINDS,
	SHEEP_MIN_SECONDS,
	SHEEP_SECONDS,
	SHEEP_STEP,
	newSheep,
	sheepHead,
	sheepResult,
	sheepVisible,
	stepSheep,
} from "../src/lib/beta/games/the-lost-sheep-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-lost-sheep");
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
 * Plays a round. A seeker taps the sheep `react(r)` seconds after it peeks
 * (too late and it has hidden); with chance `slip` it taps the goat or a
 * sheep-shaped rock first.
 */
function play(seed, { react = () => 0.4, slip = 0, masher = false, idle = false } = {}) {
	const state = newSheep(seed);
	const events = [];
	const next = rng(seed ^ 0x68e31da4);
	let peekAt = -1;
	let tapAt = Infinity;
	let slipped = false;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		let tap = null;
		const at = state.tick + 1;
		if (masher) {
			if (tick % 5 === 0) tap = { x: next() * 400, y: next() * 400 };
		} else if (!idle) {
			if (state.sheep.showAt !== peekAt) {
				peekAt = state.sheep.showAt;
				tapAt = peekAt + Math.round(react(next) * 60);
				slipped = next() < slip;
			}
			if (slipped && at === tapAt - 12) {
				const rock = SHEEP_DECOY_SPOTS[state.decoys[0]];
				tap = sheepVisible(state.goat, at) ? sheepHead(state.goat, at) : rock;
			} else if (at === tapAt && sheepVisible(state.sheep, at)) {
				const head = sheepHead(state.sheep, at);
				tap = { x: head.x + (next() - 0.5) * 20, y: head.y + (next() - 0.5) * 20 };
			} else if (at === tapAt) {
				// Too late: the tap lands where it was.
				const head = sheepHead(state.sheep, at);
				tap = { x: head.x, y: head.y + 40 };
			}
		}
		stepSheep(state, { tap }, events);
	}
	return { state, events, result: sheepResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, SHEEP_SECONDS);
	assert.ok(GAME.minSeconds <= SHEEP_MIN_SECONDS);
	assert.equal(SHEEP_STEP, 1 / 60);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7, { slip: 0.3, react: (r) => 0.4 + r() }).state, play(7, { slip: 0.3, react: (r) => 0.4 + r() }).state);
});

test("the fastest possible find is the minimum, and the server accepts it", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, { react: () => 0 });
		assert.equal(result.won, true);
		assert.ok(Math.abs(result.seconds - SHEEP_MIN_SECONDS) < 0.05, `${result.seconds}`);
		assert.ok(result.seconds >= GAME.minSeconds);
	}
});

test("the sheep, the goat and the rocks never share a place", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newSheep(seed);
		assert.notEqual(state.decoys[0], state.decoys[1]);
		for (let tick = 0; tick < 60 * 15; tick++) {
			stepSheep(state, {});
			if (sheepVisible(state.sheep, state.tick) && sheepVisible(state.goat, state.tick)) assert.notEqual(state.sheep.spot, state.goat.spot);
		}
	}
});

test("a quick, careful seeker finds it on nearly every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, { react: (r) => 0.35 + r() * 0.3, slip: 0.05 });
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(result.count, SHEEP_FINDS);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.7, `${gold} gold of ${won}`);
});

test("a slow, careless seeker sometimes loses it to nightfall", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, { react: (r) => 0.6 + r() * 0.6, slip: 0.35 }).result.won) won++;
	assert.ok(won > 0 && won < SEEDS * 0.8, `${won} won`);
});

test("a masher rarely finds it and an idle player never does", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { masher: true }).result.won) won++;
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - SHEEP_SECONDS) < 0.05);
	}
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});
