/**
 * The Caravan (LC-17851, docs/beta/games.md), Matthew 2:1-12, a fifteen
 * second run under the star: the journey replays exactly from a seed, a
 * player who reads each hazard reaches the house on every seed with gold and
 * never before the fifteen seconds, doing nothing, mashing or flailing loses
 * the star, a careless (late) player sometimes does, and each hazard asks for
 * the one control the stage shows over it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	CARAVAN_END,
	CARAVAN_FOOT,
	CARAVAN_HITS,
	CARAVAN_MIN_SECONDS,
	CARAVAN_SECONDS,
	CARAVAN_SPEED,
	CARAVAN_STEP,
	GRAVITY,
	JUMP_SPEED,
	RAVINE_LIP,
	caravanResult,
	hazardAction,
	newCaravan,
	nextHazard,
	stepCaravan,
} from "../src/lib/beta/games/the-caravan-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-caravan");
const SEEDS = 200;
const AIR = (2 * JUMP_SPEED) / GRAVITY;

/** Plays one round with `policy(state, tick)` until it ends. */
function play(seed, policy) {
	const state = newCaravan(seed);
	const events = [];
	for (let tick = 0; tick < 60 * 30 && state.phase === "running"; tick++) stepCaravan(state, policy(state, tick), events);
	return { state, events, result: caravanResult(state) };
}

/** The tests' own seeded random (mulberry32), apart from the game's. */
function rng(seed) {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let r = Math.imul(s ^ (s >>> 15), 1 | s);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A player who reads each hazard as it comes: jumps so the arc is centred
 * over a rock or across a ravine, and ducks just before a ledge or gust.
 * `offset()` is how late (positive) or early this player is on each hazard,
 * in seconds.
 */
function planner(offset = () => 0) {
	let planned = -1;
	let off = 0;
	const jumped = new Set();
	return (state) => {
		let jump = false;
		let duck = false;
		const hazard = nextHazard(state);
		if (hazard) {
			if (hazard.id !== planned) {
				planned = hazard.id;
				off = offset();
			}
			if (hazardAction(hazard.kind) === "jump") {
				const reach = state.speed * AIR;
				if (state.x >= hazard.x + hazard.w / 2 - reach / 2 + state.speed * off && !jumped.has(hazard.id)) {
					jump = true;
					jumped.add(hazard.id);
				}
			} else {
				const closing = state.speed + (hazard.kind === "gust" ? 4 : 0);
				if (hazard.x - CARAVAN_FOOT - state.x < closing * (0.15 - off)) duck = true;
			}
		}
		return { jump, duck };
	};
}

const late = (seed, most) => {
	const r = rng(seed);
	return planner(() => -0.04 + (most + 0.04) * r());
};

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, CARAVAN_SECONDS);
	assert.ok(GAME.minSeconds <= CARAVAN_MIN_SECONDS);
	assert.equal(CARAVAN_STEP, 1 / 60);
	assert.ok(Math.abs(CARAVAN_END - CARAVAN_SPEED * CARAVAN_SECONDS) < 1e-9);
	// Only the registry's controls: jump on Up or Space, duck on Down.
	assert.deepEqual(GAME.controls.map((control) => control.keys), [["↑", "Space"], ["↓"]]);
});

test("the same seed and inputs play the same journey", () => {
	const a = play(7, late(3, 0.2));
	const b = play(7, late(3, 0.2));
	assert.deepEqual(a.state, b.state);
	assert.deepEqual(a.events, b.events);
});

test("a player who reads each hazard reaches the house on every seed, with gold, never before the fifteen seconds", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state, events } = play(seed * 7919, planner());
		assert.equal(result.won, true, `seed ${seed}`);
		assert.equal(gradeFor(result.score), "gold", `seed ${seed}: ${result.score}`);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(result.count, state.hazards.length);
		assert.ok(state.x >= CARAVAN_END - 1e-6);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
});

test("every road has enough to do: rocks, ravines and ledges, eight or more hazards", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { hazards } = newCaravan(seed);
		assert.ok(hazards.length >= 8, `seed ${seed}: ${hazards.length}`);
		for (const kind of ["rock", "ravine", "ledge"]) assert.ok(hazards.some((hazard) => hazard.kind === kind), `seed ${seed} has no ${kind}`);
	}
});

test("doing nothing, only ducking, only jumping or mashing loses the star", () => {
	const policies = {
		idle: () => () => ({ jump: false, duck: false }),
		duck: () => () => ({ jump: false, duck: true }),
		jump: () => (state, tick) => ({ jump: tick % 2 === 0, duck: false }),
		hop: () => (state, tick) => ({ jump: tick % 8 === 0, duck: false }),
	};
	for (const [name, make] of Object.entries(policies)) {
		let won = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const { result, state } = play(seed, make());
			if (result.won) won++;
			else assert.equal(state.hits, CARAVAN_HITS);
		}
		assert.ok(won <= SEEDS * 0.02, `${name}: ${won} won`);
	}
});

test("pressing at random rarely reaches the house (under 20%)", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const r = rng(seed);
		let duckFor = 0;
		const { result } = play(seed, () => {
			if (duckFor > 0) duckFor -= 1;
			else if (r() < 0.02) duckFor = 25;
			return { jump: r() < 0.05, duck: duckFor > 0 };
		});
		if (result.won) won++;
	}
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});

test("a careless player, late by up to a fifth of a second, stumbles and sometimes loses the star", () => {
	let won = 0;
	let stumbled = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state } = play(seed * 31, late(seed, 0.22));
		if (result.won) won++;
		if (state.hits > 0) stumbled++;
	}
	assert.ok(won < SEEDS * 0.85, `${won} won`);
	assert.ok(won > SEEDS * 0.2, `${won} won: too cruel`);
	assert.ok(stumbled > SEEDS / 2, `${stumbled} stumbled`);
});

test("a player who jumps the ledges instead of ducking loses the star", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const reads = planner();
		const { result } = play(seed, (state, tick) => {
			const move = reads(state, tick);
			return { jump: move.jump || move.duck, duck: false };
		});
		if (result.won) won++;
	}
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});

test("each stumble costs the star a part, and the last loses it at once", () => {
	const { state, result, events } = play(1, () => ({ jump: false, duck: false }));
	const stumbles = events.filter((event) => event.type === "stumble");
	assert.equal(stumbles.length, CARAVAN_HITS);
	assert.deepEqual(
		stumbles.map((event) => event.hits),
		[1, 2, 3],
	);
	assert.equal(state.phase, "lost");
	assert.equal(result.won, false);
	assert.equal(result.score, 0);
	assert.ok(result.seconds < CARAVAN_SECONDS);
});

test("a rock is passed only from the air; a ledge only ducking; a ravine walked into is a stumble and a scramble out", () => {
	const kinds = new Map();
	for (let seed = 1; seed <= 40; seed++) {
		const { events, state } = play(seed, () => ({ jump: false, duck: false }));
		for (const event of events) if (event.type === "stumble") kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);
		// Never left in the ravine.
		assert.ok(state.y > -2, `seed ${seed}: ${state.y}`);
	}
	assert.ok(kinds.get("rock") > 0 && kinds.get("ledge") > 0 && kinds.get("ravine") > 0, JSON.stringify([...kinds]));
	// Ducking under every ledge and gust but never jumping: only rocks and ravines strike.
	for (let seed = 1; seed <= 40; seed++) {
		const { events } = play(seed, () => ({ jump: false, duck: true }));
		for (const event of events) if (event.type === "stumble") assert.ok(event.kind === "rock" || event.kind === "ravine", event.kind);
	}
	assert.ok(RAVINE_LIP > CARAVAN_FOOT);
});

test("one stumble is still gold, two is silver", () => {
	const scores = new Map();
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state } = play(seed * 31, late(seed, 0.22));
		if (result.won) scores.set(state.hits, result.score);
	}
	assert.equal(gradeFor(scores.get(0)), "gold");
	assert.equal(gradeFor(scores.get(1)), "gold");
	assert.equal(gradeFor(scores.get(2)), "silver");
});
