/**
 * Under Her Wings (LC-17851, docs/beta/games.md), Matthew 23:37-39: the round
 * replays exactly from a seed, a hen that plans her route gathers all six on
 * nearly every seed with gold and never sooner than the provable minimum, a
 * slow keyboard hen sometimes loses to the storm, a masher or an idle hen
 * does not, and the chicks keep to their own sixth of the courtyard, never
 * wandering nearer the nest (what the minimum rests on).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	WINGS_CHICKS,
	WINGS_HEN_SPEED,
	WINGS_MIN_SECONDS,
	WINGS_NEST,
	WINGS_SECONDS,
	WINGS_START_R,
	WINGS_STEP,
	WINGS_WEDGE,
	newWings,
	stepWings,
	wanderSpeed,
	wedgeOffset,
	wingsResult,
} from "../src/lib/beta/games/under-her-wings-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("under-her-wings");
const SEEDS = 200;
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function orders(list) {
	if (list.length <= 1) return [list];
	return list.flatMap((first, index) => orders([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [first, ...rest]));
}

/** The shortest route from the hen through every wandering chick and home. */
function route(state) {
	let best = [];
	let shortest = Infinity;
	for (const order of orders(state.chicks.filter((chick) => chick.state === "wander"))) {
		let length = 0;
		let at = state.hen;
		for (const chick of order) {
			length += gap(at, chick);
			at = chick;
		}
		length += gap(at, WINGS_NEST);
		if (length < shortest) {
			shortest = length;
			best = order;
		}
	}
	return best;
}

/**
 * "planner": runs the shortest route, leading each chick a little;
 * "keyboard": runs at the nearest chick with the arrows only, looking up every
 * 0.7 s; "masher": random arrows; "idle": stands in the nest.
 */
function play(seed, player) {
	const state = newWings(seed);
	const events = [];
	let roll = (seed % 9973) + 1;
	const rand = () => (roll = (roll * 16807) % 2147483647) / 2147483647;
	let order = [];
	let planAt = 0;
	let aim = { ...WINGS_NEST };
	let dx = 0;
	let dy = 0;
	let switchAt = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const input = { dx: 0, dy: 0, target: null };
		if (player === "planner") {
			if (state.t >= planAt) {
				order = route(state);
				planAt = state.t + 0.2;
			}
			const next = order.find((chick) => chick.state === "wander");
			if (next) {
				const lead = ((gap(state.hen, next) / WINGS_HEN_SPEED) * wanderSpeed(state.t)) / 2;
				input.target = { x: next.x + Math.cos(next.heading) * lead, y: next.y + Math.sin(next.heading) * lead };
			} else input.target = { ...WINGS_NEST };
		}
		if (player === "keyboard") {
			if (state.t >= planAt) {
				const nearest = state.chicks.filter((chick) => chick.state === "wander").sort((a, b) => gap(state.hen, a) - gap(state.hen, b))[0];
				aim = nearest ? { x: nearest.x, y: nearest.y } : { ...WINGS_NEST };
				planAt = state.t + 0.7;
			}
			input.dx = Math.abs(aim.x - state.hen.x) > 8 ? Math.sign(aim.x - state.hen.x) : 0;
			input.dy = Math.abs(aim.y - state.hen.y) > 8 ? Math.sign(aim.y - state.hen.y) : 0;
		}
		if (player === "masher") {
			if (state.t >= switchAt) {
				dx = Math.floor(rand() * 3) - 1;
				dy = Math.floor(rand() * 3) - 1;
				switchAt = state.t + 0.15 + rand() * 0.5;
			}
			input.dx = dx;
			input.dy = dy;
		}
		stepWings(state, input, events);
	}
	return { state, events, result: wingsResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WINGS_SECONDS);
	assert.equal(WINGS_STEP, 1 / 60);
	assert.ok(WINGS_MIN_SECONDS >= 2, `${WINGS_MIN_SECONDS}`);
});

test("the same seed and moves play the same round", () => {
	assert.deepEqual(play(19, "planner").state, play(19, "planner").state);
	assert.deepEqual(play(19, "masher").state, play(19, "masher").state);
});

test("wandering chicks keep to their own sixth and never come nearer the nest than they start out (the minimum rests on it)", () => {
	for (let seed = 1; seed <= 60; seed++) {
		for (const player of ["masher", "idle", "keyboard"]) {
			const state = newWings(seed);
			let roll = seed;
			while (state.phase === "playing") {
				stepWings(state, { dx: player === "idle" ? 0 : (roll = (roll * 16807) % 2147483647) % 3 - 1, dy: player === "idle" ? 0 : (roll = (roll * 16807) % 2147483647) % 3 - 1, target: null });
				for (const chick of state.chicks) {
					if (chick.state !== "wander") continue;
					assert.ok(Math.abs(wedgeOffset(chick, chick.x, chick.y)) <= WINGS_WEDGE + 1e-6, `seed ${seed}: chick ${chick.id} left its sixth`);
					assert.ok(gap(chick, WINGS_NEST) >= WINGS_START_R[0] - 1e-6, `seed ${seed}: chick ${chick.id} came near the nest`);
				}
			}
		}
	}
});

test("a planning hen gathers all six on at least 95% of seeds, mostly gold, never sooner than the minimum, and the server accepts it", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, "planner");
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= WINGS_MIN_SECONDS && result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.seconds < WINGS_SECONDS);
		assert.equal(result.count, WINGS_CHICKS);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.8, `${gold} gold of ${won}`);
});

test("an idle hen never wins and a masher rarely does", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, "idle").result;
		assert.equal(idle.won, false);
		assert.ok(Math.abs(idle.seconds - WINGS_SECONDS) < 0.05);
		if (play(seed, "masher").result.won) mashed++;
	}
	assert.ok(mashed < SEEDS * 0.2, `${mashed} mashed wins`);
});

test("a slow keyboard hen chasing the nearest chick sometimes loses to the storm, and never earns gold (it is hard enough)", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919, "keyboard");
		if (!result.won) continue;
		won++;
		assert.notEqual(gradeFor(result.score), "gold");
	}
	assert.ok(won < SEEDS * 0.95, `${won} won`);
	assert.ok(won > 0);
});

test("the chicks wander quicker as the storm nears", () => {
	assert.ok(wanderSpeed(WINGS_SECONDS) > wanderSpeed(0) * 2);
});
