/**
 * Fishers of Men (LC-17851, docs/beta/games.md), Matthew 4:18-22: the round
 * replays exactly from a seed, a skilled fisher fills the net on nearly every
 * seed with gold, a late one sometimes falls short, a masher or an idle net
 * does not, and the round lasts as long as the registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	FISH_ITEM_R,
	FISH_LEAPS,
	FISH_MIN_SECONDS,
	FISH_NET_SPEED,
	FISH_SECONDS,
	FISH_STEP,
	FISH_TARGET,
	fishResult,
	netHalf,
	newFish,
	stepFish,
} from "../src/lib/beta/games/fishers-of-men-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("fishers-of-men");
const SEEDS = 200;

/**
 * Where a fisher who can see what is in the air would hold the net: the spot
 * that catches the most fish soonest and tears on nothing. `react` is how long
 * after a leap the fisher notices it.
 */
function plan(state, { react = 0, debrisWeight = 3 } = {}) {
	const half = netHalf(state.tears);
	let best = state.netX;
	let bestValue = -Infinity;
	for (let spot = half; spot <= 400 - half; spot += 5) {
		let value = -0.0004 * Math.abs(spot - state.netX);
		for (const item of state.items) {
			if (item.outcome !== null || state.t - item.born < react) continue;
			const ahead = item.landAt - state.t;
			if (ahead <= 0 || ahead > 1.6) continue;
			const reach = FISH_NET_SPEED * ahead;
			const at = Math.max(half, Math.min(400 - half, state.netX + Math.max(-reach, Math.min(reach, spot - state.netX))));
			const off = Math.abs(at - item.landX);
			if (item.kind === "fish" ? off <= half + FISH_ITEM_R - 3 : off <= half + FISH_ITEM_R + 5) value += (item.kind === "fish" ? 1 : -debrisWeight) / (1 + 2 * ahead);
		}
		if (value > bestValue) {
			bestValue = value;
			best = spot;
		}
	}
	return best;
}

/** Plays a round: "skilled", "late" (notices each leap half a second late and minds the debris less), "masher" or "idle". */
function play(seed, player) {
	const state = newFish(seed);
	const events = [];
	let roll = (seed % 9973) + 1;
	const rand = () => (roll = (roll * 16807) % 2147483647) / 2147483647;
	let dir = 0;
	let switchAt = 0;
	let aim = 200;
	let planAt = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const input = { dir: 0, target: null };
		if (player === "skilled") input.target = plan(state);
		if (player === "late") {
			if (state.t >= planAt) {
				aim = plan(state, { react: 0.55, debrisWeight: 1.2 });
				planAt = state.t + 0.25;
			}
			input.target = aim;
		}
		if (player === "masher") {
			if (state.t >= switchAt) {
				dir = Math.floor(rand() * 3) - 1;
				switchAt = state.t + 0.15 + rand() * 0.5;
			}
			input.dir = dir;
		}
		stepFish(state, input, events);
	}
	return { state, events, result: fishResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, FISH_SECONDS);
	assert.ok(GAME.minSeconds <= FISH_MIN_SECONDS);
	assert.equal(FISH_STEP, 1 / 60);
});

test("the same seed and moves play the same round", () => {
	assert.deepEqual(play(11, "skilled").state, play(11, "skilled").state);
	assert.deepEqual(play(11, "masher").state, play(11, "masher").state);
});

test("every round has the same number of fish, more drops than fish, and gets faster and denser", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { items } = newFish(seed);
		assert.equal(items.filter((item) => item.kind === "fish").length, FISH_LEAPS);
		assert.ok(items.some((item) => item.kind !== "fish"));
		const lands = items.map((item) => item.landAt).sort((a, b) => a - b);
		const early = lands.filter((at) => at < 5).length;
		const late = lands.filter((at) => at >= 10).length;
		assert.ok(late > early, `seed ${seed}: ${early} early, ${late} late`);
		const flight = (at) => items.filter((item) => item.kind === "fish" && (at ? item.landAt > 10 : item.landAt < 4)).map((item) => item.landAt - item.born);
		assert.ok(Math.max(...flight(true)) < Math.min(...flight(false)), `seed ${seed}: the leaps quicken`);
	}
});

test("a skilled fisher wins on at least 95% of seeds, mostly gold, never sooner than the round's end, and the server accepts it", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, "skilled");
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= FISH_TARGET);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.8, `${gold} gold of ${won}`);
});

test("an idle net never wins and a masher rarely does", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, "idle").result;
		assert.equal(idle.won, false, `seed ${seed}`);
		if (play(seed, "masher").result.won) mashed++;
	}
	assert.ok(mashed < SEEDS * 0.2, `${mashed} mashed wins`);
});

test("a late fisher sometimes falls short (it is hard enough)", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919, "late").result.won) won++;
	assert.ok(won < SEEDS * 0.95, `${won} won`);
	assert.ok(won > 0, "but it can be won late");
});

test("three tears break the net and end the round at once", () => {
	const state = newFish(5);
	for (const item of state.items) item.kind = "stone";
	const events = [];
	while (state.phase === "playing") {
		const next = state.items.find((item) => item.outcome === null);
		stepFish(state, { dir: 0, target: next ? next.landX : null }, events);
	}
	assert.equal(state.phase, "lost");
	assert.ok(state.endedAt < FISH_SECONDS);
	assert.equal(events.filter((event) => event.type === "broken").length, 1);
	assert.equal(fishResult(state).won, false);
});
