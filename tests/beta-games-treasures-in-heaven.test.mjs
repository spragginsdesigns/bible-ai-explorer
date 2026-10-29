/**
 * Treasures in Heaven (LC-17851, docs/beta/games.md), Matthew 6:19-21: the
 * round replays exactly from a seed, a careful player lays up enough on
 * nearly every seed with gold, a greedy late one that ignores the moths and
 * rust sometimes falls short, a masher or an idle chest does not, and the
 * round lasts as long as the registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	TREASURE_CHEST_HALF,
	TREASURE_CHEST_SPEED,
	TREASURE_CORRUPT,
	TREASURE_MIN_SECONDS,
	TREASURE_RADIUS,
	TREASURE_SECONDS,
	TREASURE_STEP,
	TREASURE_TARGET,
	TREASURE_VALUE,
	newTreasure,
	stepTreasure,
	treasureAt,
	treasureResult,
} from "../src/lib/beta/games/treasures-in-heaven-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("treasures-in-heaven");
const SEEDS = 200;
const HALF = TREASURE_CHEST_HALF;

/** Where a player who can see what is falling would hold the chest. `react`: how long after it appears they notice it; `care`: how much they mind the moths and rust. */
function plan(state, { react = 0, care = 1 } = {}) {
	let best = state.chestX;
	let bestValue = -Infinity;
	for (let spot = HALF; spot <= 400 - HALF; spot += 5) {
		let value = -0.0004 * Math.abs(spot - state.chestX);
		for (const item of state.items) {
			if (item.outcome !== null || state.t - item.born < react) continue;
			const ahead = item.landAt - state.t;
			if (ahead <= 0 || ahead > 1.6) continue;
			const reach = TREASURE_CHEST_SPEED * ahead;
			const at = Math.max(HALF, Math.min(400 - HALF, state.chestX + Math.max(-reach, Math.min(reach, spot - state.chestX))));
			const off = Math.abs(at - item.landX);
			const good = TREASURE_VALUE[item.kind] > 0;
			const edge = HALF + TREASURE_RADIUS[item.kind] * 0.6;
			if (good ? off <= edge - 3 : off <= edge + 6) value += (good ? TREASURE_VALUE[item.kind] : -TREASURE_CORRUPT * care) / (1 + 2 * ahead);
		}
		if (value > bestValue) {
			bestValue = value;
			best = spot;
		}
	}
	return best;
}

function play(seed, player) {
	const state = newTreasure(seed);
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
		if (player === "greedy") {
			if (state.t >= planAt) {
				aim = plan(state, { react: 0.5, care: 0 });
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
		stepTreasure(state, input, events);
	}
	return { state, events, result: treasureResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, TREASURE_SECONDS);
	assert.ok(GAME.minSeconds <= TREASURE_MIN_SECONDS);
	assert.equal(TREASURE_STEP, 1 / 60);
});

test("the same seed and moves play the same round", () => {
	assert.deepEqual(play(13, "skilled").state, play(13, "skilled").state);
	assert.deepEqual(play(13, "masher").state, play(13, "masher").state);
});

test("every round offers more than enough treasure, with moths and rust among it, and it comes faster later", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { items } = newTreasure(seed);
		const offered = items.reduce((sum, item) => sum + TREASURE_VALUE[item.kind], 0);
		assert.ok(offered >= TREASURE_TARGET * 1.3, `seed ${seed}: ${offered}`);
		assert.ok(items.filter((item) => item.kind === "moth").length >= 3);
		assert.ok(items.filter((item) => item.kind === "rust").length >= 2);
		const fall = (late) => items.filter((item) => item.kind === "coin" && (late ? item.landAt > 11 : item.landAt < 4)).map((item) => item.fall);
		assert.ok(Math.min(...fall(true)) > Math.max(...fall(false)), `seed ${seed}: the coins fall faster later`);
		// The moths and rust really wobble: their path swings off the straight line down.
		for (const threat of items.filter((item) => item.kind === "moth" || item.kind === "rust")) {
			const xs = [];
			for (let at = threat.born; at <= threat.landAt; at += 0.05) xs.push(treasureAt(threat, at).x - threat.drift * (at - threat.born));
			assert.ok(Math.max(...xs) - Math.min(...xs) >= 20, `seed ${seed}: ${threat.kind} ${threat.id} hardly wobbles`);
		}
	}
});

test("a careful player lays up enough on at least 95% of seeds, mostly gold, never sooner than the round's end, and the server accepts it", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, "skilled");
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= TREASURE_TARGET);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.8, `${gold} gold of ${won}`);
});

test("an idle chest never wins and a masher rarely does", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		assert.equal(play(seed, "idle").result.won, false, `seed ${seed}`);
		if (play(seed, "masher").result.won) mashed++;
	}
	assert.ok(mashed < SEEDS * 0.2, `${mashed} mashed wins`);
});

test("a greedy, late player who ignores the moths and rust sometimes falls short (it is hard enough)", () => {
	let won = 0;
	let corrupted = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state } = play(seed * 7919, "greedy");
		if (result.won) won++;
		corrupted += state.corruptions;
	}
	assert.ok(won < SEEDS * 0.9, `${won} won`);
	assert.ok(won > 0);
	assert.ok(corrupted > SEEDS, `${corrupted} corruptions`);
});

test("a moth or rust in the chest corrupts what is laid up, never below nothing", () => {
	const state = newTreasure(3);
	state.treasure = 5;
	const moth = state.items.find((item) => item.kind === "moth");
	state.items = [moth];
	const events = [];
	while (state.phase === "playing") stepTreasure(state, { dir: 0, target: moth.landX }, events);
	const corrupt = events.find((event) => event.type === "corrupt");
	assert.ok(corrupt);
	assert.equal(corrupt.lost, 5);
	assert.equal(state.treasure, 0);
});
