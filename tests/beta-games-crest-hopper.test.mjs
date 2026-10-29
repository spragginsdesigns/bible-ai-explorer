/**
 * Crest Hopper (LC-17851, docs/beta/games.md): the arcade way to play Matthew
 * 14:22-33. Its simulation replays exactly from a seed, a clean player reaches
 * Jesus with gold and never faster than the server allows, doing nothing or
 * hopping blind does not win, and a player who reacts late still usually
 * makes it: slightly challenging, not cruel.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	HOPPER_COLS,
	HOPPER_HOP_AIR,
	HOPPER_LIGHT_ROW,
	HOPPER_MIN_SECONDS,
	HOPPER_SEA_ROWS,
	HOPPER_SETTLE,
	HOPPER_SLIP_FAITH,
	HOPPER_START,
	HOPPER_STEP,
	hopLanding,
	hopperReady,
	hopperResult,
	newHopper,
	shoveLands,
	stepHopper,
} from "../src/lib/beta/games/crest-hopper-rules.ts";
import { checkGameRun, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const IDLE = { hop: null, cry: false };
const LIMIT = 60 * 300;
const SEEDS = 200;

/** Plays one run with `policy(state)` until it ends or five minutes pass. */
function play(seed, policy) {
	const state = newHopper(seed);
	const events = [];
	for (let tick = 0; state.phase === "playing" && tick < LIMIT; tick++) stepHopper(state, policy(state), events);
	return { state, events };
}

/** The wind that will reach him within `seconds`: a gust shown coming, or one waiting for him to land. */
function windWithin(state, seconds) {
	if (state.shove) return state.shove.dir;
	if (state.gust && state.gust.at - state.t <= seconds) return state.gust.dir;
	return 0;
}

/** Would where he stands, or where a hop lands him, be a trap: a trough downwind of a gust, or a crest about to carry him into the edge. */
function trapped(state, row, x, seconds) {
	if (row.kind !== "sea") return false;
	const wind = windWithin(state, seconds);
	if (wind && !shoveLands({ ...state, x, row: state.rows.indexOf(row) }, wind)) return true;
	const ahead = x + row.dir * row.speed * seconds;
	return ahead < 0 || ahead > HOPPER_COLS - 1;
}

/** A hop that lands on the body of a crest and not in a trap. */
function goodHop(state, dir) {
	const to = hopLanding(state, dir, 0.3);
	return !!to && !trapped(state, state.rows[to.row], to.x, 0.75);
}

/** Reads the sea, hops onto the body of a crest and steps out of the way of gusts and the edge of the sea: a clean player. */
function clean(state) {
	if (!hopperReady(state)) return IDLE;
	if (goodHop(state, "up")) return { hop: "up", cry: false };
	// Waited long for a perfect hop: take a fair one.
	if (state.t - state.lastForwardAt > 3 && hopLanding(state, "up", 0.2) && !trapped(state, state.rows[state.row + 1], state.x, 0.3)) return { hop: "up", cry: false };
	if (trapped(state, state.rows[state.row], state.x, 0.9)) {
		const wind = windWithin(state, 2);
		const upwind = wind === 1 ? "left" : wind === -1 ? "right" : null;
		const inward = state.x < (HOPPER_COLS - 1) / 2 ? "right" : "left";
		const choices = [upwind, inward, inward === "right" ? "left" : "right", "down"].filter(Boolean);
		for (const dir of choices) if (goodHop(state, dir)) return { hop: dir, cry: false };
		for (const dir of ["up", ...choices]) if (hopLanding(state, dir)) return { hop: dir, cry: false };
	}
	return IDLE;
}

/**
 * The same player seeing everything `delaySteps` late: each hop is the one the
 * clean player would have made that long ago, pressed now without looking
 * again. One press per decision: after a hop they wait to see it land.
 */
function late(delaySteps) {
	let decided = [];
	return (state) => {
		decided.push(clean(state).hop);
		if (decided.length <= delaySteps) return IDLE;
		const hop = decided.shift();
		if (!hop || !hopperReady(state)) return IDLE;
		decided = decided.map(() => null);
		return { hop, cry: false };
	};
}

/** Hops toward Jesus as fast as the game allows, never looking at the sea. */
function blind(state) {
	return { hop: hopperReady(state) ? "up" : null, cry: false };
}

/** Hops toward Jesus every half second without looking. */
function hopEvery(seconds) {
	let next = HOPPER_START;
	return (state) => {
		if (state.t < next) return IDLE;
		next = state.t + seconds;
		return { hop: "up", cry: false };
	};
}

function rate(policyFor, seedBase) {
	let wins = 0;
	let gold = 0;
	let silver = 0;
	const times = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { state } = play(seed * seedBase, policyFor());
		const result = hopperResult(state);
		if (!result) continue;
		wins += 1;
		times.push(result.seconds);
		const grade = gradeFor(result.faithKept);
		if (grade === "gold") gold += 1;
		if (grade === "silver") silver += 1;
	}
	times.sort((a, b) => a - b);
	return { wins, gold, silver, median: times[Math.floor(times.length / 2)] ?? null, fastest: times[0] ?? null, slowest: times.at(-1) ?? null };
}

test("the same seed and inputs play the same run", () => {
	const a = play(42, late(12)).state;
	const b = play(42, late(12)).state;
	assert.deepEqual(a, b);
	assert.notDeepEqual(newHopper(42).rows, newHopper(43).rows, "a different seed rolls a different sea");
});

test("a clean player reaches Jesus on every seed with gold, never faster than the game allows", () => {
	const measured = rate(() => clean, 7919);
	console.log(`clean: ${measured.wins}/${SEEDS} won, ${measured.gold} gold, times ${measured.fastest}-${measured.slowest}s (median ${measured.median}s)`);
	assert.equal(measured.wins, SEEDS);
	assert.ok(measured.gold >= SEEDS * 0.97, `${measured.gold} gold`);
	assert.ok(measured.fastest >= HOPPER_MIN_SECONDS, `${measured.fastest}s is faster than the game allows`);
	assert.ok(measured.median >= 30 && measured.median <= 90, `a clean run takes ${measured.median}s`);
	for (let seed = 1; seed <= 20; seed++) {
		const { state, events } = play(seed * 7919, clean);
		const result = hopperResult(state);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		assert.ok(result.swellsCleared >= HOPPER_SEA_ROWS + 1, "every row is a clean hop");
		assert.equal(checkGameRun({ faithKept: result.faithKept, seconds: result.seconds, swellsCleared: result.swellsCleared }, HOPPER_MIN_SECONDS).ok, true);
	}
});

test("a player who reacts late still usually makes it: slightly challenging, not cruel", () => {
	const quarter = rate(() => late(15), 104729);
	console.log(`a quarter second late: ${quarter.wins}/${SEEDS} won, ${quarter.gold} gold, ${quarter.silver} silver, median ${quarter.median}s`);
	assert.ok(quarter.wins >= SEEDS * 0.8, `only ${quarter.wins} late runs finished`);
	assert.ok(quarter.gold < quarter.wins, "late play does not always earn gold");
	const third = rate(() => late(20), 15485863);
	console.log(`a third of a second late: ${third.wins}/${SEEDS} won, ${third.gold} gold, ${third.silver} silver`);
	assert.ok(third.wins >= SEEDS * 0.4, `only ${third.wins} later runs finished`);
	assert.ok(third.wins < SEEDS, "very late play loses some runs");
});

test("hopping blind rarely reaches Jesus and never with gold; doing nothing never does", () => {
	const mash = rate(() => blind, 31);
	const steady = rate(() => hopEvery(0.5), 37);
	console.log(`blind as fast as allowed: ${mash.wins}/${SEEDS} won (${mash.gold} gold); blind every half second: ${steady.wins}/${SEEDS} (${steady.gold} gold)`);
	assert.ok(mash.wins <= SEEDS * 0.05 && mash.gold === 0);
	assert.ok(steady.wins <= SEEDS * 0.05 && steady.gold === 0);
	for (let seed = 1; seed <= 20; seed++) {
		const { state } = play(seed, () => IDLE);
		assert.equal(state.phase, "playing", "standing in the ship never finishes");
		assert.equal(state.row, 0);
		assert.equal(hopperResult(state), null);
	}
});

test("at no faith he sinks, and only a cry for help brings the rescue", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const { state, events } = play(seed, blind);
		assert.equal(state.phase, "sinking", `seed ${seed}`);
		assert.equal(state.faith, 0);
		assert.equal(hopperResult(state), null);
		assert.ok(events.filter((event) => event.type === "slip").length >= Math.ceil(100 / HOPPER_SLIP_FAITH));
		for (let i = 0; i < 300; i++) stepHopper(state, IDLE);
		assert.equal(state.phase, "sinking", "no rescue without the cry");
		assert.equal(state.sink, 1);
		const after = [];
		stepHopper(state, { hop: null, cry: true }, after);
		assert.equal(state.phase, "rescued");
		assert.deepEqual(after, [{ type: "rescued" }]);
	}
});

test("a trough is a slip, a crest is a clean hop, and a slip costs faith", () => {
	const state = newHopper(9);
	while (state.t < HOPPER_START) stepHopper(state, IDLE);
	// Lay a trough across the first row of swells and hop onto it.
	state.rows[1].pattern = state.rows[1].pattern.map(() => 0);
	const events = [];
	stepHopper(state, { hop: "up", cry: false }, events);
	while (state.air > 0) stepHopper(state, IDLE, events);
	assert.ok(events.some((event) => event.type === "slip"));
	assert.equal(state.faith, 100 - HOPPER_SLIP_FAITH);
	assert.equal(state.minFaith, 100 - HOPPER_SLIP_FAITH);
	assert.equal(state.combo, 0);

	const fair = newHopper(9);
	while (fair.t < HOPPER_START) stepHopper(fair, IDLE);
	fair.rows[1].pattern = fair.rows[1].pattern.map(() => 1);
	const landed = [];
	stepHopper(fair, { hop: "up", cry: false }, landed);
	while (fair.air > 0) stepHopper(fair, IDLE, landed);
	assert.ok(landed.some((event) => event.type === "land" && event.forward && event.points === 10));
	assert.equal(fair.row, 1);
	assert.equal(fair.cleanHops, 1);
});

test("a gust is shown before it shoves him a lane downwind", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const { events } = play(seed * 13, clean);
		const warns = events.filter((event) => event.type === "gustWarn").length;
		assert.ok(warns >= 3, `seed ${seed}: ${warns} gusts`);
		let warned = null;
		for (const event of events) {
			if (event.type === "gustWarn") warned = event.dir;
			if (event.type === "gust") {
				assert.equal(event.dir, warned, "every gust was shown first");
				warned = null;
			}
		}
	}
});

test("the soonest finish is every hop made without a pause", () => {
	assert.equal(HOPPER_MIN_SECONDS, Math.floor(HOPPER_START + HOPPER_LIGHT_ROW * HOPPER_HOP_AIR + HOPPER_SEA_ROWS * HOPPER_SETTLE));
	assert.ok(HOPPER_STEP > 0 && HOPPER_STEP < 0.05);
	// A sea of crests from bank to bank, hopped flat out, still takes at least that long.
	const state = newHopper(3);
	for (const row of state.rows) row.pattern = row.pattern.map(() => 1);
	for (let tick = 0; state.phase === "playing" && tick < LIMIT; tick++) stepHopper(state, { hop: "up", cry: false });
	const result = hopperResult(state);
	assert.ok(result, "the flat-out run finishes");
	assert.ok(result.seconds >= HOPPER_MIN_SECONDS, `${result.seconds}s`);
	assert.ok(result.seconds < HOPPER_MIN_SECONDS + 2, `${result.seconds}s: the bound is tight`);
	assert.equal(result.faithKept, 100);
});
