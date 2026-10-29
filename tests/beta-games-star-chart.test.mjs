/**
 * Star Chart (LC-17851, docs/beta/games.md): the puzzle way to play Matthew
 * 2:1-12. A seed and its actions replay the same chart; a player who knows
 * the way charts every seed with gold and never faster than the floor the
 * server holds runs to; doing nothing lets the dawn come; tapping at random
 * almost never charts it and never well; a slow, careless player still
 * usually finishes; and the road may not skip the star or go home through
 * Jerusalem.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	CHART_HINT_COST,
	CHART_LEGS,
	CHART_LEG_COUNT,
	CHART_MIN_SECONDS,
	CHART_STEP,
	CHART_TRAVEL_SECONDS,
	CHART_TURN_SECONDS,
	chartResult,
	fewestTurns,
	hintCell,
	isTurnable,
	newChart,
	roadTurns,
	stepChart,
	traceRoute,
	turnsToOpen,
} from "../src/lib/beta/games/star-chart-rules.ts";
import { checkGameRun, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const LIMIT = 60 * 60 * 20; // twenty minutes of play

/** Plays a chart with `policy(state, rng)` (a list of actions per step) until it ends. */
function play(seed, policy, limit = LIMIT) {
	const state = newChart(seed);
	const events = [];
	let r = seed ^ 0x5bd1e995;
	const rng = () => {
		r = (Math.imul(r, 1103515245) + 12345) | 0;
		return ((r >>> 8) & 0xffffff) / 0x1000000;
	};
	for (let tick = 0; tick < limit && state.phase !== "done" && state.phase !== "dawn"; tick++) {
		if (state.phase === "between") {
			stepChart(state, [{ type: "next" }], events);
			continue;
		}
		stepChart(state, policy(state, rng), events);
	}
	return { state, events, result: chartResult(state) };
}

const idle = (state) => state.phase === "charting" && state.busy === 0 && state.queue.length === 0;
const turnables = (state) => state.cells.map((cell, index) => (isTurnable(cell) ? index : -1)).filter((index) => index >= 0);

/** Knows the way: turns the next tile of the road that is out of place, every `gap` seconds. */
function knowing(gap) {
	let wait = 0;
	return (state) => {
		wait -= CHART_STEP;
		if (!idle(state) || wait > 0) return [];
		wait = gap;
		const cell = hintCell(state);
		return cell >= 0 ? [{ type: "turn", cell }] : [];
	};
}

/** Thinks `gap` seconds a move; a `slip` share of moves turn some other tile, and half of those are caught with Undo. */
function careless(gap, slip) {
	let wait = 0;
	let slipped = false;
	return (state, rng) => {
		wait -= CHART_STEP;
		if (!idle(state) || wait > 0) return [];
		wait = gap;
		if (slipped && rng() < 0.5) {
			slipped = false;
			return [{ type: "undo" }];
		}
		slipped = false;
		if (rng() < slip) {
			const all = turnables(state);
			slipped = true;
			return [{ type: "turn", cell: all[Math.floor(rng() * all.length)] }];
		}
		const cell = hintCell(state);
		return cell >= 0 ? [{ type: "turn", cell }] : [];
	};
}

/** Taps any tile, twice a second, with no idea of the way. */
function tapper(state, rng) {
	if (!idle(state) || rng() > 2 * CHART_STEP) return [];
	const all = turnables(state);
	return [{ type: "turn", cell: all[Math.floor(rng() * all.length)] }];
}

/** Turns a decoy tile and back, so the game retraces the road after a test set tiles by hand. */
function retrace(state) {
	const decoy = state.cells.findIndex((cell) => isTurnable(cell) && !cell.road);
	stepChart(state, [{ type: "turn", cell: decoy }]);
	for (let i = 0; i < 20; i++) stepChart(state);
	stepChart(state, [{ type: "undo" }]);
	for (let i = 0; i < 20 && state.busy > 0; i++) stepChart(state);
}

/** Puts every tile of the leg's own road in place by hand. */
function placeRoad(state) {
	for (const cell of state.cells) if (cell.road) cell.rot = (cell.rot + turnsToOpen(cell.kind, cell.rot, cell.road)) % 4;
	retrace(state);
}

/** Charts legs by hand until `leg` is the one in play. */
function skipTo(state, leg) {
	while (state.leg < leg) {
		placeRoad(state);
		for (let i = 0; i < 400 && state.phase !== "between"; i++) stepChart(state);
		stepChart(state, [{ type: "next" }]);
	}
}

test("the maps are sound: each leg's own road runs unbroken from its start to its end and keeps its rules", () => {
	for (const [index, leg] of CHART_LEGS.entries()) {
		assert.equal(leg.map.length, leg.rows, `leg ${index + 1} rows`);
		for (const row of leg.map) assert.equal(row.length, leg.cols, `leg ${index + 1} cols`);
		const state = newChart(index + 1);
		skipTo(state, index);
		assert.equal(state.leg, index);
		for (const cell of state.cells) if (cell.road) cell.rot = (cell.rot + turnsToOpen(cell.kind, cell.rot, cell.road)) % 4;
		const traced = traceRoute(leg, state.cells);
		assert.ok(traced.reaches, `leg ${index + 1}: its road reaches the end`);
		assert.equal(roadTurns(state.cells), 0);
		assert.equal(fewestTurns(leg, state.cells), 0);
		assert.equal(hintCell(state), -1);
		for (const [r, c] of leg.stars) assert.ok(traced.route.includes(r * leg.cols + c), `leg ${index + 1}: the road passes the star mark`);
		if (leg.avoidCity) assert.ok(!traced.route.some((cell) => leg.map.join("")[cell] === "X"), "the way home keeps out of Jerusalem");
	}
});

test("the same seed and actions play the same chart", () => {
	const a = play(42, careless(0.9, 0.3));
	const b = play(42, careless(0.9, 0.3));
	assert.deepEqual(a.state, b.state);
	assert.deepEqual(a.events, b.events);
});

test("every start is held to its leg's fewest turns, never already charted, never a slog", () => {
	for (let seed = 1; seed <= 1500; seed++) {
		const state = newChart(seed * 2654435761);
		for (let leg = 0; leg < CHART_LEG_COUNT; leg++) {
			skipTo(state, leg);
			const def = CHART_LEGS[leg];
			const fewest = fewestTurns(def, state.cells);
			assert.ok(fewest >= def.minTurns, `seed ${seed} leg ${leg + 1}: ${fewest} turns is under the floor ${def.minTurns}`);
			assert.ok(state.par <= def.minTurns + 9 && state.par >= fewest, `seed ${seed} leg ${leg + 1}: par ${state.par}`);
			assert.ok(!state.reaches);
		}
	}
});

test("a player who knows the way charts every seed with gold, never faster than the floor", () => {
	let fastest = Infinity;
	for (let seed = 1; seed <= 60; seed++) {
		// Flat out: a turn as soon as the last one settles.
		const { state, events, result } = play(seed * 7919, knowing(0));
		assert.equal(state.phase, "done", `seed ${seed}`);
		assert.ok(result, `seed ${seed}`);
		assert.ok(result.seconds >= CHART_MIN_SECONDS, `seed ${seed}: ${result.seconds}s is faster than the floor ${CHART_MIN_SECONDS}s`);
		assert.equal(result.faithKept, 100, `seed ${seed}: a clean chart keeps to the star`);
		assert.equal(gradeFor(result.faithKept), "gold");
		assert.equal(events.filter((event) => event.type === "finished").length, 1);
		assert.equal(events.filter((event) => event.type === "charted").length, CHART_LEG_COUNT);
		assert.ok(checkGameRun(result, CHART_MIN_SECONDS).ok, `seed ${seed}: the server takes the run`);
		fastest = Math.min(fastest, result.seconds);
		// At a person's pace it lands in the brief's 30-90 seconds.
		const paced = play(seed * 7919, knowing(1.1)).result;
		assert.ok(paced && paced.seconds >= 25 && paced.seconds <= 90, `seed ${seed}: ${paced?.seconds}s at a person's pace`);
	}
	console.log(`fastest flawless chart ${fastest}s, floor ${CHART_MIN_SECONDS}s`);
	// The floor is the turn pace and the walks, exactly.
	const floor = CHART_LEGS.reduce((sum, leg) => sum + leg.minTurns, 0) * CHART_TURN_SECONDS + CHART_LEG_COUNT * CHART_TRAVEL_SECONDS;
	assert.ok(CHART_MIN_SECONDS <= floor && CHART_MIN_SECONDS > floor - 0.1);
});

test("doing nothing lets the dawn come on the first leg, and nothing is recorded", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const { state, events, result } = play(seed, () => []);
		assert.equal(state.phase, "dawn", `seed ${seed}`);
		assert.equal(state.leg, 0);
		assert.equal(result, null);
		assert.deepEqual(events.map((event) => event.type), ["dawn"]);
		// About a quarter hour of night at most, never instantly.
		assert.ok(state.t > 60 && state.t < 15 * 60, `seed ${seed}: dawn after ${state.t}s`);
		stepChart(state, [{ type: "turn", cell: hintCell(state) }]);
		assert.equal(state.phase, "dawn", "the dawn does not undo");
	}
});

test("tapping tiles at random rarely charts it, and never with gold", () => {
	let wins = 0;
	let legsCharted = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const { state, events, result } = play(seed * 104729, tapper);
		legsCharted += events.filter((event) => event.type === "charted").length;
		if (result) {
			wins += 1;
			assert.notEqual(gradeFor(result.faithKept), "gold", `seed ${seed}: gold by tapping at random`);
		} else assert.equal(state.phase, "dawn");
	}
	console.log(`random tapping: ${wins}/60 charts finished, ${legsCharted} legs charted of ${60 * CHART_LEG_COUNT}`);
	assert.ok(wins <= 3, `${wins} of 60 random charts finished`);
});

test("a slow, careless player still usually finishes: slightly challenging, not cruel", () => {
	let wins = 0;
	const grades = { gold: 0, silver: 0, bronze: 0 };
	for (let seed = 1; seed <= 60; seed++) {
		const { result } = play(seed * 15485863, careless(1.6, 0.3));
		if (result) {
			wins += 1;
			grades[gradeFor(result.faithKept)] += 1;
		}
	}
	console.log(`careless (1.6s a move, 30% slips, half caught): ${wins}/60 finished`, grades);
	assert.ok(wins >= 48, `only ${wins} of 60 careless charts finished`);
	assert.ok(grades.gold + grades.silver >= wins * 0.6, "careless play mostly earns silver or better");
	assert.ok(grades.gold < wins, "careless play does not always earn gold");
});

test("hints always finish a chart but cost the score; Undo turns back without spending", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const { state, result } = play(seed, (s) => (idle(s) ? [{ type: "hint" }] : []));
		assert.equal(state.phase, "done", `seed ${seed}: hints alone chart it`);
		assert.equal(result.swellsCleared, 0, "a hint is not a turn");
		assert.equal(result.faithKept, Math.max(0, 100 - CHART_HINT_COST * state.hints));
		assert.ok(result.seconds >= CHART_MIN_SECONDS, `seed ${seed}: hints are never quicker than the floor`);
	}
	const state = newChart(7);
	const cell = state.cells.findIndex((c) => isTurnable(c));
	const rot = state.cells[cell].rot;
	stepChart(state, [{ type: "turn", cell }]);
	const night = state.night;
	for (let i = 0; i < 20; i++) stepChart(state);
	stepChart(state, [{ type: "undo" }]);
	for (let i = 0; i < 20; i++) stepChart(state);
	assert.equal(state.cells[cell].rot, rot);
	assert.equal(state.cells[cell].spin, 0);
	assert.equal(state.turns, 1, "the turn was made; Undo turns it back");
	assert.ok(state.night > night - 0.1, "Undo spends no night");
});

/** Sets a leg's tiles to a road given as [row, col, openings] and lets them settle. */
function setRoad(state, road) {
	const leg = CHART_LEGS[state.leg];
	for (const [r, c, mask] of road) {
		const cell = state.cells[r * leg.cols + c];
		cell.rot = (cell.rot + turnsToOpen(cell.kind, cell.rot, mask)) % 4;
	}
	retrace(state);
}

test("the road to the house must pass beneath the star, and the way home may not go through Jerusalem", () => {
	const [N, E, S, W] = [1, 2, 4, 8];
	const star = newChart(11);
	skipTo(star, 2);
	assert.equal(star.leg, 2);
	const events = [];
	// The short way: straight down from Jerusalem's road to the house, missing the star.
	setRoad(star, [
		[1, 1, W | S],
		[2, 1, N | S],
	]);
	assert.ok(star.reaches, "the short road reaches the house");
	assert.equal(star.astray, "star");
	for (let i = 0; i < 120; i++) stepChart(star, [], events);
	assert.equal(star.phase, "charting", "a road that skips the star is not charted");

	const home = newChart(12);
	skipTo(home, 3);
	assert.equal(home.leg, 3);
	// The old road: back up through Jerusalem and on east.
	setRoad(home, [
		[3, 1, W | N],
		[2, 1, S | E],
		[2, 3, E | W],
		[2, 4, E | W],
	]);
	assert.ok(home.reaches, "the old road reaches their own country");
	assert.equal(home.astray, "city");
	for (let i = 0; i < 120; i++) stepChart(home);
	assert.equal(home.phase, "charting", "a way home through Jerusalem is not charted");
});
