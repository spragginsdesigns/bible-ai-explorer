/**
 * Through the Storm (LC-17851, docs/beta/games.md): the first-person way to
 * play Matthew 14:22-33. Its simulation replays exactly from a seed, a steady
 * player reaches Jesus with gold and never faster than the server allows,
 * doing nothing sinks him, skill-less play never finishes well, and a player
 * who reacts late still usually makes it: slightly challenging, not cruel.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	BRACE_HOLD,
	STORM_GOAL,
	STORM_MIN_SECONDS,
	STORM_STEP,
	STORM_TOP_SPEED,
	SWELL_WARNING,
	gazeOff,
	newStorm,
	nextSwell,
	stepStorm,
	stormResult,
} from "../src/lib/beta/games/through-the-storm-rules.ts";
import { gradeFor } from "../src/lib/beta/games/games-rules.ts";

const NOTHING = { lookX: 0, lookY: 0, dragX: 0, dragY: 0, brace: false, cry: false };
const LIMIT = 60 * 240;
const clampUnit = (value) => Math.max(-1, Math.min(1, value));

/** Plays one walk with `policy(state)` until it ends or four minutes pass. */
function play(seed, policy) {
	const state = newStorm(seed);
	const events = [];
	for (let tick = 0; state.phase === "walking" && tick < LIMIT; tick++) stepStorm(state, policy(state), events);
	return { state, events };
}

/** Steers the view back onto Jesus as a thumb on the stage would, and braces as each crest arrives. */
function steady(state) {
	const swell = nextSwell(state);
	return { ...NOTHING, lookX: clampUnit(state.gazeX * 4), lookY: clampUnit(state.gazeY * 4), brace: !!swell && swell.eta < BRACE_HOLD * 0.8 && state.brace === 0 };
}

/**
 * A player on keys (a full turn or none) who sees the view `delaySteps` late,
 * and braces up to `jitter` seconds off the ideal moment, early or late.
 */
function onKeys(delaySteps, jitter, seed) {
	const seen = [];
	let r = seed * 48271 + 11;
	const rand = () => {
		r = (r * 1103515245 + 12345) % 2147483648;
		return r / 2147483648;
	};
	let planned = -1;
	let pressAt = 0;
	return (state) => {
		seen.push({ x: state.gazeX, y: state.gazeY });
		const then = seen[Math.max(0, seen.length - 1 - delaySteps)];
		const swell = nextSwell(state);
		let brace = false;
		if (swell && swell.id !== planned) {
			planned = swell.id;
			pressAt = BRACE_HOLD / 2 + (rand() * 2 - 1) * jitter;
		}
		if (swell && swell.eta <= pressAt) {
			brace = true;
			pressAt = -Infinity;
		}
		const key = (value) => (Math.abs(value) < 0.35 ? 0 : Math.sign(value));
		return { ...NOTHING, lookX: key(then.x), lookY: key(then.y), brace };
	};
}

function rate(seeds, makePolicy) {
	let wins = 0;
	let gold = 0;
	for (let seed = 1; seed <= seeds; seed++) {
		const result = stormResult(play(seed * 104729, makePolicy(seed)).state);
		if (!result) continue;
		wins += 1;
		if (gradeFor(result.faithKept) === "gold") gold += 1;
	}
	return { wins, gold };
}

test("the same seed and inputs play the same walk", () => {
	const a = play(42, steady);
	const b = play(42, steady);
	assert.deepEqual(a.state, b.state);
	assert.deepEqual(a.events, b.events);
	const c = play(42, onKeys(15, 0.3, 3));
	const d = play(42, onKeys(15, 0.3, 3));
	assert.deepEqual(c.state, d.state);
});

test("a steady player reaches Jesus on every seed with gold, never faster than the server allows", () => {
	for (let seed = 1; seed <= 60; seed++) {
		const { state, events } = play(seed * 7919, steady);
		assert.equal(state.phase, "arrived", `seed ${seed}`);
		assert.equal(state.x, STORM_GOAL);
		const result = stormResult(state);
		assert.ok(result.seconds >= STORM_MIN_SECONDS, `seed ${seed}: ${result.seconds}s is faster than ${STORM_MIN_SECONDS}s`);
		assert.ok(result.seconds <= 90, `seed ${seed}: ${result.seconds}s is too long a walk`);
		assert.ok(result.faithKept >= 70, `seed ${seed}: a clean walk earns gold (${result.faithKept})`);
		assert.ok(result.swellsCleared >= 5, `seed ${seed}: the walk has swells to brace for (${result.swellsCleared})`);
		assert.equal(result.swellsStruck, 0);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
	}
});

test("doing nothing sinks him, and only a cry for help brings the rescue", () => {
	for (let seed = 1; seed <= 30; seed++) {
		const { state, events } = play(seed, () => NOTHING);
		assert.equal(state.phase, "sinking", `seed ${seed}`);
		assert.equal(stormResult(state), null);
		assert.ok(state.t < 20, `seed ${seed}: sinks soon (${state.t}s)`);
		assert.ok(events.some((event) => event.type === "lost"), "the storm drags his eyes off Jesus");
		for (let i = 0; i < 300; i++) stepStorm(state, NOTHING);
		assert.equal(state.phase, "sinking", "no rescue without the cry");
		assert.equal(state.sink, 1);
		const after = [];
		stepStorm(state, { ...NOTHING, cry: true }, after);
		assert.equal(state.phase, "rescued");
		assert.deepEqual(after, [{ type: "rescued" }]);
	}
});

test("skill-less play never finishes, and never bracing never earns gold", () => {
	for (let seed = 1; seed <= 40; seed++) {
		assert.equal(play(seed, () => ({ ...NOTHING, brace: true })).state.phase, "sinking", `seed ${seed}: bracing alone`);
		let r = seed;
		let look = [0, 0];
		const masher = () => {
			r = (r * 1103515245 + 12345) % 2147483648;
			if (r % 20 === 0) look = [(r % 3) - 1, ((r >> 3) % 3) - 1];
			return { ...NOTHING, lookX: look[0], lookY: look[1], brace: r % 10 === 0 };
		};
		assert.notEqual(play(seed, masher).state.phase, "arrived", `seed ${seed}: mashing`);
	}
	// Watching Jesus but never bracing: the swells strike every time.
	for (let seed = 1; seed <= 60; seed++) {
		const result = stormResult(play(seed * 31, (state) => ({ ...steady(state), brace: false })).state);
		if (result) assert.notEqual(gradeFor(result.faithKept), "gold", `seed ${seed}: gold without bracing (${result.faithKept})`);
	}
	const unbracedOnKeys = rate(100, (seed) => {
		const keys = onKeys(15, 0, seed);
		return (state) => ({ ...keys(state), brace: false });
	});
	assert.equal(unbracedOnKeys.gold, 0);
	assert.ok(unbracedOnKeys.wins <= 60, `${unbracedOnKeys.wins} of 100 unbraced walks on keys finished`);
});

test("a player who reacts late still usually makes it: slightly challenging, not cruel", () => {
	// A quarter second late on the view and within a fifth of a second on the swells: nearly always gold.
	const careful = rate(100, (seed) => onKeys(15, 0.2, seed));
	assert.ok(careful.wins >= 95, `only ${careful.wins} of 100 careful late walks finished`);
	assert.ok(careful.gold >= 85, `only ${careful.gold} of 100 careful late walks earned gold`);
	// Loose on the swells (about one in three braced too early or too late): still finishes, gold about half the time.
	const loose = rate(100, (seed) => onKeys(15, 0.3, seed));
	assert.ok(loose.wins >= 90, `only ${loose.wins} of 100 loose walks finished`);
	assert.ok(loose.gold >= 30 && loose.gold <= 75, `${loose.gold} of 100 loose walks earned gold`);
	// A third of a second late and loose: a real struggle, finished more often than not, gold rarely.
	const sloppy = rate(100, (seed) => onKeys(20, 0.35, seed));
	assert.ok(sloppy.wins >= 50, `only ${sloppy.wins} of 100 sloppy walks finished`);
	assert.ok(sloppy.gold <= 15, `${sloppy.gold} of 100 sloppy walks earned gold`);
});

test("a swell is braced only while bracing, and a strike costs faith and throws the eyes off Jesus", () => {
	const state = newStorm(5);
	state.swells.push({ id: 99, eta: STORM_STEP / 2, outcome: null });
	const before = state.faith;
	const events = [];
	stepStorm(state, NOTHING, events);
	assert.ok(events.some((event) => event.type === "struck" && event.id === 99));
	assert.ok(state.faith < before - 20);
	for (let i = 0; i < 30; i++) stepStorm(state, NOTHING);
	assert.ok(gazeOff(state) > 1, "the crest throws his gaze out of the ring");

	const braced = newStorm(5);
	const press = [];
	stepStorm(braced, { ...NOTHING, brace: true }, press);
	assert.deepEqual(press, [{ type: "brace" }]);
	assert.ok(braced.brace > 0 && braced.brace <= BRACE_HOLD);
	braced.swells.push({ id: 7, eta: STORM_STEP / 2, outcome: null });
	const cleared = [];
	stepStorm(braced, NOTHING, cleared);
	assert.ok(cleared.some((event) => event.type === "braced" && event.id === 7));
	assert.equal(braced.swellsBraced, 1);
	assert.ok(SWELL_WARNING > 2, "every swell is seen coming");
});

test("he walks only while Jesus is in the ring", () => {
	const state = newStorm(9);
	state.gazeX = 3;
	state.onTarget = false;
	const x = state.x;
	stepStorm(state, NOTHING);
	assert.equal(state.x, x, "looking away, he stands");
	const faith = state.faith;
	stepStorm(state, NOTHING);
	assert.ok(state.faith < faith, "and his faith drains");
	const dragged = [];
	stepStorm(state, { ...NOTHING, dragX: -0.4 }, dragged);
	assert.ok(state.gazeX < 3, "a drag brings Jesus back toward the ring");
});

test("the soonest finish is the walk at his top pace", () => {
	assert.equal(STORM_MIN_SECONDS, Math.floor(STORM_GOAL / STORM_TOP_SPEED));
	assert.ok(STORM_MIN_SECONDS >= 30 && STORM_MIN_SECONDS <= 60);
	assert.ok(STORM_STEP > 0 && STORM_STEP < 0.05);
});
