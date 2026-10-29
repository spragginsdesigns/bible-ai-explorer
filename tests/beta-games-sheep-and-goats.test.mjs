/**
 * The Sheep and the Goats (LC-17851, docs/beta/games.md), Matthew 25:31-40:
 * the round replays exactly from a seed, a quick and careful shepherd keeps
 * the gate on nearly every seed with gold, a sloppy one sometimes loses, a
 * masher and an idle player do not win, and the round lasts as long as the
 * registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { FLOCK_MIN_SECONDS, FLOCK_SECONDS, FLOCK_STEP, flockAtGate, flockResult, flockSideFor, newFlock, stepFlock } from "../src/lib/beta/games/sheep-and-goats-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("sheep-and-goats");
const SEEDS = 200;

function random(seed) {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A shepherd who parts the animal at the gate `reaction` seconds after it gets there, wrong `slip` of the time; or a masher pressing a random side `mash` times a second. */
function play(seed, { reaction = 0.3, slip = 0, mash = 0 } = {}) {
	const state = newFlock(seed);
	const chance = random(seed ^ 0x5eed);
	const events = [];
	let front = -1;
	let since = 0;
	let last = -1;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		let side = null;
		if (mash) {
			if (state.t - last >= 1 / mash) {
				last = state.t;
				side = chance() < 0.5 ? "left" : "right";
			}
		} else {
			const animal = flockAtGate(state);
			if (animal) {
				if (animal.id !== front) {
					front = animal.id;
					since = state.t;
				}
				if (state.t - since >= reaction) {
					side = flockSideFor(animal.kind);
					if (chance() < slip) side = side === "left" ? "right" : "left";
				}
			}
		}
		stepFlock(state, { side }, events);
	}
	return { state, events, result: flockResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, FLOCK_SECONDS);
	assert.ok(GAME.minSeconds <= FLOCK_MIN_SECONDS);
	assert.equal(FLOCK_STEP, 1 / 60);
	assert.deepEqual(GAME.controls.map((control) => control.keys), [["←"], ["→"]]);
});

test("sheep on the right hand, goats on the left (v33)", () => {
	assert.equal(flockSideFor("sheep"), "right");
	assert.equal(flockSideFor("goat"), "left");
});

test("the same seed and presses play the same round", () => {
	assert.deepEqual(play(7, { reaction: 0.4, slip: 0.1 }).state, play(7, { reaction: 0.4, slip: 0.1 }).state);
});

test("a quick, careful shepherd keeps the gate on every seed, mostly gold, and never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= 12, `seed ${seed}: ${result.count} parted`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("pressing before an animal reaches the gate parts no one", () => {
	const state = newFlock(3);
	const events = [];
	stepFlock(state, { side: "right" }, events);
	assert.deepEqual(events.filter((event) => event.type !== "come"), [{ type: "early" }]);
	assert.equal(state.mistakes, 0);
});

test("a sloppy shepherd sometimes loses; a masher and an idle player never win", () => {
	let sloppy = 0;
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { reaction: 0.5, slip: 0.1 }).result.won) sloppy++;
		if (play(seed, { mash: 7 }).result.won) mashed++;
		const idle = play(seed, { reaction: 99 });
		assert.equal(idle.result.won, false);
		assert.ok(idle.result.seconds < FLOCK_SECONDS);
	}
	assert.ok(sloppy > 0 && sloppy < SEEDS * 0.9, `${sloppy} sloppy wins`);
	assert.ok(mashed < SEEDS * 0.2, `${mashed} masher wins`);
});
