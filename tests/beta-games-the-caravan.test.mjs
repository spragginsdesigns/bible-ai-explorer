/**
 * The Caravan (LC-17851, docs/beta/games.md), Matthew 2's side-scroller: the
 * simulation replays exactly from a seed, a clean player reaches the house
 * with gold and never faster than the soonest finish, doing nothing or
 * mashing never earns it, and a player who is a little late still usually
 * makes it (slightly challenging, not cruel).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	CARAVAN_END,
	CARAVAN_FOOT,
	CARAVAN_JERUSALEM,
	CARAVAN_MIN_SECONDS,
	CARAVAN_STEP,
	CARAVAN_TOP_SPEED,
	RAVINE_LIP,
	STAR_LEAD,
	caravanResult,
	newCaravan,
	nextHazard,
	stepCaravan,
} from "../src/lib/beta/games/the-caravan-rules.ts";
import { checkGameRun, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const NOTHING = { jump: false, duck: false, go: false };
const LIMIT = 60 * 300;

/** Plays one journey with `policy(state, tick)` until it ends or five minutes pass. */
function play(seed, policy) {
	const state = newCaravan(seed);
	const events = [];
	for (let tick = 0; tick < LIMIT && (state.phase === "east" || state.phase === "bethlehem" || state.phase === "jerusalem"); tick++) {
		stepCaravan(state, policy(state, tick), events);
	}
	return { state, events };
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
 * over a rock or across a ravine (holding for a tall rock or a wide ravine),
 * and ducks just before a ledge or a gust. `offset()` is how late (positive)
 * or early this player is on each hazard, in seconds; `hold()` scales a held
 * jump.
 */
function planner({ offset = () => 0, hold = () => 1 } = {}) {
	let holdSteps = 0;
	let plannedFor = -1;
	let off = 0;
	let scale = 1;
	const jumped = new Set();
	return (state) => {
		let jump = false;
		let duck = false;
		if (holdSteps > 0) {
			holdSteps -= 1;
			jump = true;
		}
		const hazard = nextHazard(state);
		if (hazard) {
			if (hazard.id !== plannedFor) {
				plannedFor = hazard.id;
				off = offset();
				scale = hold();
			}
			const pace = Math.max(state.speed, 1);
			if (hazard.kind === "rock" || hazard.kind === "ravine") {
				const long = hazard.kind === "rock" ? hazard.h > 0.8 : hazard.w > 3.5;
				const reach = pace * (long ? 0.85 : 0.633);
				const centred = hazard.kind === "rock" ? hazard.x + hazard.w / 2 - reach / 2 : (hazard.x + hazard.w - RAVINE_LIP - reach + hazard.x + RAVINE_LIP) / 2;
				if (state.grounded && state.x >= centred + pace * off && !jumped.has(hazard.id)) {
					jump = true;
					holdSteps = long ? Math.round(14 * scale) : 0;
					jumped.add(hazard.id);
				}
			} else if (hazard.x - CARAVAN_FOOT - state.x < (hazard.kind === "gust" ? 2.6 : 1) - pace * off) duck = true;
		}
		return { jump, duck, go: state.phase === "jerusalem" };
	};
}

const steady = () => planner();
/** Late by up to `late` seconds and early by up to `early`, a different amount on every hazard; holds loosely. */
const sloppy = (seed, late = 0.16, early = 0.08) => {
	const r = rng(seed);
	return planner({ offset: () => -early + (late + early) * r(), hold: () => 0.6 + 0.5 * r() });
};
const mash = () => (state, tick) => ({ jump: tick % 2 === 0, duck: false, go: state.phase === "jerusalem" });
const ducker = () => (state) => ({ jump: false, duck: true, go: state.phase === "jerusalem" });
const idle = () => (state) => ({ ...NOTHING, go: state.phase === "jerusalem" });
const flail = (seed) => {
	const r = rng(seed);
	let duckFor = 0;
	return (state) => {
		if (duckFor > 0) duckFor -= 1;
		else if (r() < 0.012) duckFor = 30;
		return { jump: r() < 0.04, duck: duckFor > 0, go: state.phase === "jerusalem" };
	};
};

test("the same seed and inputs play the same journey", () => {
	const a = play(42, steady());
	const b = play(42, steady());
	assert.deepEqual(a.state, b.state);
	assert.deepEqual(a.events, b.events);
	const c = play(42, sloppy(9));
	const d = play(42, sloppy(9));
	assert.deepEqual(c.state, d.state);
	assert.notDeepEqual(newCaravan(1).hazards, newCaravan(2).hazards, "each seed lays its own course");
});

test("a clean player reaches the house on every seed with gold, never faster than the soonest finish", () => {
	for (let seed = 1; seed <= 60; seed++) {
		const { state, events } = play(seed * 7919, steady());
		assert.equal(state.phase, "arrived", `seed ${seed}`);
		assert.equal(state.x, CARAVAN_END);
		assert.equal(events.filter((event) => event.type === "jerusalem").length, 1, "one halt at Jerusalem");
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		const result = caravanResult(state);
		assert.ok(result.seconds >= CARAVAN_MIN_SECONDS, `seed ${seed}: ${result.seconds}s is faster than the game allows`);
		assert.ok(result.seconds <= 90, `seed ${seed}: ${result.seconds}s is too long a journey`);
		assert.equal(gradeFor(result.faithKept), "gold", `seed ${seed}: a clean journey earns gold (${result.faithKept})`);
		assert.equal(result.stumbles, 0);
		assert.ok(result.swellsCleared >= 30, `seed ${seed}: the journey has hazards to pass (${result.swellsCleared})`);
		assert.equal(result.swellsCleared, state.hazards.length, "every hazard passed clean");
		assert.equal(checkGameRun(result, CARAVAN_MIN_SECONDS).ok, true);
	}
});

test("doing nothing, or only ducking, never reaches Bethlehem", () => {
	for (let seed = 1; seed <= 30; seed++) {
		const still = play(seed, idle()).state;
		assert.equal(still.phase, "fell", `seed ${seed}: the first ravine takes a caravan that never jumps`);
		assert.ok(still.x < CARAVAN_JERUSALEM);
		assert.equal(caravanResult(still), null);
		assert.notEqual(play(seed, ducker()).state.phase, "arrived");
	}
});

test("mashing jump, or pressing at random, rarely finishes and never with gold", () => {
	let wins = 0;
	for (let seed = 1; seed <= 60; seed++) {
		for (const policy of [mash(), flail(seed)]) {
			const { state } = play(seed * 131, policy);
			const result = caravanResult(state);
			if (result) {
				wins += 1;
				assert.notEqual(gradeFor(result.faithKept), "gold", `seed ${seed}: gold without reading the road`);
			}
		}
	}
	assert.ok(wins <= 3, `${wins} of 120 skill-less journeys finished`);
});

test("a player a little late (and early) on each hazard still usually makes it: slightly challenging, not cruel", () => {
	let wins = 0;
	let gold = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const result = caravanResult(play(seed * 104729, sloppy(seed)).state);
		if (result) {
			wins += 1;
			if (gradeFor(result.faithKept) === "gold") gold += 1;
		}
	}
	assert.ok(wins >= 50, `only ${wins} of 60 a little late finished`);
	assert.ok(gold < wins, "loose play does not always earn gold");

	// Later still, and it is a real journey: some make it, many do not.
	let sloppier = 0;
	for (let seed = 1; seed <= 60; seed++) if (caravanResult(play(seed * 104729, sloppy(seed, 0.22, 0.12)).state)) sloppier += 1;
	assert.ok(sloppier >= 10 && sloppier <= 50, `${sloppier} of 60 of the sloppiest finished`);
});

/** A flat road with one hazard on it, the caravan setting out from a standstill. */
function road(hazard) {
	const state = newCaravan(3);
	state.hazards = [{ id: 1, leg: 1, outcome: null, touched: false, h: 0, ...hazard }];
	return state;
}

function run(state, input, until) {
	const events = [];
	for (let i = 0; i < 60 * 20 && !until(state); i++) stepCaravan(state, typeof input === "function" ? input(state) : input, events);
	return events;
}

test("a rock is passed only from the air, and a stumble lets the star draw ahead", () => {
	const walked = road({ kind: "rock", x: 30, w: 1, h: 0.6 });
	const events = run(walked, NOTHING, (state) => state.x > 50);
	assert.ok(events.some((event) => event.type === "stumble" && event.kind === "rock"));
	assert.equal(walked.hazards[0].outcome, "hit");
	assert.ok(walked.minKeep < 90 && walked.minKeep > 60, `one stumble costs some, not all (${walked.minKeep})`);
	assert.equal(walked.cleared, 0);

	const jumped = road({ kind: "rock", x: 30, w: 1, h: 0.6 });
	run(jumped, (state) => ({ ...NOTHING, jump: state.x > 28.2 && state.x < 28.4 }), (state) => state.x > 50);
	assert.equal(jumped.hazards[0].outcome, "cleared");
	assert.equal(jumped.cleared, 1);
	assert.equal(jumped.minKeep, 100);
});

test("a wide ravine needs a held jump; a tap falls short", () => {
	const take = (holdSteps) => {
		const state = road({ kind: "ravine", x: 30, w: 4.4 });
		let pressedAt = -1;
		run(
			state,
			(s) => {
				if (pressedAt < 0 && s.x >= 29.1) pressedAt = s.t;
				return { ...NOTHING, jump: pressedAt >= 0 && s.t - pressedAt < holdSteps * CARAVAN_STEP };
			},
			(s) => s.x > 45 || s.phase === "fell",
		);
		return state;
	};
	assert.equal(take(1).phase, "fell");
	const held = take(14);
	assert.equal(held.phase, "east");
	assert.equal(held.hazards[0].outcome, "cleared");
});

test("a ledge and a gust are passed ducking, and struck standing or jumping", () => {
	for (const kind of ["ledge", "gust"]) {
		const ducked = road({ kind, x: kind === "gust" ? 40 : 30, w: 3 });
		run(ducked, { ...NOTHING, duck: true }, (state) => state.x > 50);
		assert.equal(ducked.hazards[0].outcome, "cleared", kind);
		const stood = road({ kind, x: kind === "gust" ? 40 : 30, w: 3 });
		const events = run(stood, NOTHING, (state) => state.x > 50);
		assert.ok(events.some((event) => event.type === "stumble" && event.kind === kind), kind);
	}
});

test("the journey halts at Jerusalem until the caravan sets out, and the halt is not counted", () => {
	const state = newCaravan(11);
	const policy = steady();
	const events = [];
	for (let i = 0; i < LIMIT && state.phase === "east"; i++) stepCaravan(state, policy(state), events);
	assert.equal(state.phase, "jerusalem");
	assert.equal(state.x, CARAVAN_JERUSALEM);
	const t = state.t;
	for (let i = 0; i < 600; i++) stepCaravan(state, NOTHING, events);
	assert.equal(state.phase, "jerusalem", "it waits for the player");
	assert.equal(state.t, t, "the halt is not on the clock");
	stepCaravan(state, { ...NOTHING, go: true }, events);
	assert.equal(state.phase, "bethlehem");
	assert.equal(state.starX, CARAVAN_JERUSALEM + STAR_LEAD, "the star goes before them again");
	assert.equal(events.at(-1).type, "depart");
});

test("the soonest finish is the whole way at the caravan's top pace", () => {
	assert.equal(CARAVAN_MIN_SECONDS, Math.floor(CARAVAN_END / CARAVAN_TOP_SPEED));
	assert.ok(CARAVAN_MIN_SECONDS >= 30);
	assert.ok(CARAVAN_STEP > 0 && CARAVAN_STEP < 0.05);
	assert.equal(checkGameRun({ faithKept: 80, seconds: CARAVAN_MIN_SECONDS - 0.5, swellsCleared: 40 }, CARAVAN_MIN_SECONDS).ok, false);
});
