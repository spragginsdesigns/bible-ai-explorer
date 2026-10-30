/**
 * The Generations (LC-17908, docs/beta/games.md), Matthew 1:1-25: the line is
 * the KJV's own and its ages are 1:17's; every age lays six names of that age
 * and lights a run of consecutive generations; the round replays exactly from
 * a seed; a player who remembers the lights keeps the line on nearly every
 * seed, mostly gold, and never faster than the server allows; an idle player,
 * a masher and one pressing the same tablet never win; a forgetful, slow one
 * sometimes loses and rarely earns gold.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	GENERATIONS_AGES,
	GENERATIONS_LINE,
	GENERATIONS_MIN_SECONDS,
	GENERATIONS_RUNS,
	GENERATIONS_SECONDS,
	GENERATIONS_SLOTS,
	GENERATIONS_STEP,
	GENERATIONS_TABLETS,
	generationsCanPick,
	generationsLit,
	generationsResult,
	generationsSlotAt,
	newGenerations,
	stepGenerations,
} from "../src/lib/beta/games/the-generations-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-generations");
const SEEDS = 200;
const matthew = JSON.parse(readFileSync(new URL("../src/data/kjv/40-matthew.json", import.meta.url), "utf8"));

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
 * Plays a round. A player who watched the run picks its places in order:
 * `first` seconds after the tablets turn down, then `then` seconds apart;
 * `slip` is the chance a pick goes to a place they misremember. `mode`
 * "masher" picks a random place every few ticks, "one" presses the first
 * tablet every few ticks, "fastest" picks the right place every tick, and
 * "idle" never picks.
 */
function play(seed, { mode = "player", first = () => 0.45, then = () => 0.32, slip = 0, tap = false } = {}) {
	const state = newGenerations(seed);
	const events = [];
	const next = rng(seed ^ 0x5bd1e995);
	let dueAt = Infinity;
	let stageAt = -1;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		let slot = null;
		if (mode === "masher") slot = tick % 5 === 0 ? Math.floor(next() * GENERATIONS_TABLETS) : null;
		else if (mode === "one") slot = tick % 5 === 0 ? 0 : null;
		else if (mode === "fastest") slot = state.run[state.progress];
		else if (mode === "player") {
			if (state.stage === "recall" && state.stageAt !== stageAt) {
				stageAt = state.stageAt;
				dueAt = state.tick + Math.round(first(next) * 60);
			}
			if (generationsCanPick(state) && state.tick + 1 >= dueAt) {
				const right = state.run[state.progress];
				slot = next() < slip ? (right + 1 + Math.floor(next() * (GENERATIONS_TABLETS - 1))) % GENERATIONS_TABLETS : right;
				dueAt = state.tick + 1 + Math.round(then(next) * 60);
			}
		}
		const input = slot === null ? {} : tap ? { tap: { x: GENERATIONS_SLOTS[slot].x + (next() - 0.5) * 80, y: GENERATIONS_SLOTS[slot].y + (next() - 0.5) * 70 } } : { slot };
		stepGenerations(state, input, events);
	}
	return { state, events, result: generationsResult(state) };
}

const skilled = { first: (r) => 0.35 + r() * 0.25, then: (r) => 0.25 + r() * 0.15, slip: 0.02 };
const sloppy = { first: (r) => 0.55 + r() * 0.35, then: (r) => 0.4 + r() * 0.25, slip: 0.12 };

test("the line is Matthew 1:2-16 as the bundled KJV reads it, and the ages are 1:17's", () => {
	const pairs = [];
	for (let verse = 2; verse <= 16; verse++) {
		for (const match of matthew[0][verse - 1].matchAll(/([A-Z][a-z]+)(?: the king)? begat ([A-Z][a-z]+)/g)) pairs.push([match[1], match[2]]);
	}
	assert.equal(pairs.length, GENERATIONS_LINE.length - 1);
	pairs.forEach(([father, son], index) => {
		assert.equal(GENERATIONS_LINE[index], father, `link ${index}`);
		assert.equal(GENERATIONS_LINE[index + 1], son, `link ${index}`);
	});
	assert.equal(GENERATIONS_LINE[GENERATIONS_AGES[0].to], "David");
	assert.equal(GENERATIONS_LINE[GENERATIONS_AGES[1].to], "Jechonias");
	assert.equal(GENERATIONS_LINE[GENERATIONS_AGES[2].to], "Joseph");
	for (const age of GENERATIONS_AGES) assert.ok(matthew[0][16].includes(age.label), age.label);
	for (const verse of [16, 21, 25]) assert.match(matthew[0][verse - 1], /JESUS|Jesus/);
});

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, GENERATIONS_SECONDS);
	assert.ok(GAME.minSeconds <= GENERATIONS_MIN_SECONDS);
	assert.ok(GAME.minSeconds >= GENERATIONS_MIN_SECONDS - 0.2, "minSeconds is the fastest win, not a guess");
	assert.equal(GENERATIONS_STEP, 1 / 60);
});

test("every age lays six names of that age and lights a run of consecutive generations, longer each age", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newGenerations(seed * 31);
		const firsts = [];
		for (let age = 0; age < 3; age++) {
			assert.equal(state.age, age);
			const span = GENERATIONS_AGES[age];
			assert.equal(state.tablets.length, GENERATIONS_TABLETS);
			assert.equal(new Set(state.tablets).size, GENERATIONS_TABLETS);
			for (const index of state.tablets) assert.ok(index >= span.from && index <= span.to, `seed ${seed} age ${age}`);
			assert.equal(state.run.length, GENERATIONS_RUNS[age]);
			assert.equal(new Set(state.run).size, state.run.length);
			const line = state.run.map((place) => state.tablets[place]);
			line.forEach((index, at) => at && assert.equal(index, line[at - 1] + 1, `seed ${seed} age ${age} is consecutive`));
			firsts.push(state.run.join(""));
			// The lights show the run, in order, one tablet at a time.
			const lit = [];
			while (state.stage === "watch") {
				const now = generationsLit(state);
				if (now && lit.at(-1) !== now.slot) lit.push(now.slot);
				stepGenerations(state, {});
			}
			assert.deepEqual(lit, state.run);
			for (const place of [...state.run]) {
				while (!generationsCanPick(state)) stepGenerations(state, {});
				stepGenerations(state, { slot: place });
			}
			while (state.stage === "write") stepGenerations(state, {});
		}
		assert.equal(state.phase, "won");
		assert.deepEqual(
			state.kept.map((index) => GENERATIONS_LINE[index]).length,
			GENERATIONS_RUNS.reduce((sum, length) => sum + length, 0),
		);
	}
	// Places differ from seed to seed.
	const runs = new Set();
	for (let seed = 1; seed <= 40; seed++) runs.add(newGenerations(seed).run.join(""));
	assert.ok(runs.size > 20);
});

test("a tap lands on the tablet under it", () => {
	GENERATIONS_SLOTS.forEach((slot, place) => assert.equal(generationsSlotAt(slot.x, slot.y), place));
	assert.equal(generationsSlotAt(200, 40), null);
});

test("the same seed and picks play the same round", () => {
	assert.deepEqual(play(7, { ...sloppy }).state, play(7, { ...sloppy }).state);
});

test("the fastest possible win is the minimum, and the server accepts it", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const fastest = play(seed, { mode: "fastest" });
		assert.equal(fastest.result.won, true);
		assert.ok(Math.abs(fastest.state.endedAt - GENERATIONS_MIN_SECONDS) < 1e-9, `${fastest.state.endedAt}`);
		assert.ok(fastest.result.seconds >= GAME.minSeconds);
		assert.equal(checkGameRun({ faithKept: fastest.result.score, seconds: fastest.result.seconds, swellsCleared: fastest.result.count }, GAME.minSeconds).ok, true);
	}
});

test("a player who remembers the lights keeps the line on nearly every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	const times = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, { ...skilled, tap: seed % 2 === 0 });
		if (!result.won) continue;
		won++;
		times.push(result.seconds);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(result.count, 12);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	times.sort((a, b) => a - b);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.8, `${gold} gold of ${won}`);
	assert.ok(times[Math.floor(times.length / 2)] <= 12, `median ${times[Math.floor(times.length / 2)]}s leaves a margin`);
});

test("a forgetful, slow player sometimes loses the line and rarely earns gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed, sloppy);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(won > 0 && won < SEEDS * 0.85, `${won} won`);
	assert.ok(gold < won * 0.3, `${gold} gold of ${won}`);
});

test("a masher and a player pressing one tablet never win; an idle player never does and the round runs its length", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		assert.equal(play(seed, { mode: "masher" }).result.won, false, `masher seed ${seed}`);
		assert.equal(play(seed, { mode: "one" }).result.won, false, `one seed ${seed}`);
		const idle = play(seed, { mode: "idle" });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - GENERATIONS_SECONDS) < 0.05);
	}
});

test("a wrong pick cracks that tablet, shows the right one and replays the same run", () => {
	const state = newGenerations(99);
	const events = [];
	while (!generationsCanPick(state)) stepGenerations(state, {}, events);
	const run = [...state.run];
	const wrong = (run[0] + 1) % GENERATIONS_TABLETS;
	stepGenerations(state, { slot: wrong }, events);
	assert.equal(state.stage, "wrong");
	assert.deepEqual(state.wrong, { slot: wrong, right: run[0] });
	while (state.stage === "wrong") stepGenerations(state, {}, events);
	assert.equal(state.stage, "watch");
	assert.equal(state.replays, 1);
	assert.deepEqual(state.run, run);
	assert.ok(events.some((event) => event.type === "replay"));
});
