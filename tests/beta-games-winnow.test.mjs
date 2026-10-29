/**
 * Winnow the Floor (LC-17851, docs/beta/games.md), Matthew 3:11-17: the round
 * replays exactly from a seed, a quick and careful sorter keeps the floor on
 * nearly every seed with gold, a sloppy one sometimes loses, a late one, a
 * masher and an idle player do not win, and the round lasts as long as the
 * registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { WINNOW_MIN_SECONDS, WINNOW_SECONDS, WINNOW_STEP, newWinnow, stepWinnow, winnowFront, winnowResult, winnowSideFor } from "../src/lib/beta/games/winnow-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("winnow");
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

/** A sorter who sorts the lowest grain `reaction` seconds after it becomes the one to sort, wrong `slip` of the time; or a masher pressing a random side `mash` times a second. */
function play(seed, { reaction = 0.3, slip = 0, mash = 0 } = {}) {
	const state = newWinnow(seed);
	const chance = random(seed ^ 0x5eed);
	const events = [];
	let front = -1;
	let since = 0;
	let last = -1;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		let sort = null;
		if (mash) {
			if (state.t - last >= 1 / mash) {
				last = state.t;
				sort = chance() < 0.5 ? "left" : "right";
			}
		} else {
			const grain = winnowFront(state);
			if (grain) {
				if (grain.id !== front) {
					front = grain.id;
					since = state.t;
				}
				if (state.t - since >= reaction) {
					sort = winnowSideFor(grain.kind);
					if (chance() < slip) sort = sort === "left" ? "right" : "left";
				}
			}
		}
		stepWinnow(state, { sort }, events);
	}
	return { state, events, result: winnowResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WINNOW_SECONDS);
	assert.ok(GAME.minSeconds <= WINNOW_MIN_SECONDS);
	assert.equal(WINNOW_STEP, 1 / 60);
	assert.deepEqual(GAME.controls.map((control) => control.keys), [["←"], ["→"]]);
});

test("the same seed and presses play the same round", () => {
	assert.deepEqual(play(7, { reaction: 0.4, slip: 0.1 }).state, play(7, { reaction: 0.4, slip: 0.1 }).state);
	assert.notDeepEqual(play(7).events.filter((e) => e.type === "toss"), play(8).events.filter((e) => e.type === "toss"));
});

test("wheat goes to the garner on the left, chaff to the fire on the right", () => {
	assert.equal(winnowSideFor("wheat"), "left");
	assert.equal(winnowSideFor("chaff"), "right");
});

test("a quick, careful sorter keeps the floor on every seed, mostly gold, and never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= 15, `seed ${seed}: ${result.count} sorted`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("a good player who slips now and then still wins nearly always", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, { reaction: 0.4, slip: 0.03 }).result.won) won++;
	assert.ok(won >= SEEDS * 0.9, `${won} won`);
});

test("a sloppy sorter sometimes loses; a masher and an idle player never win", () => {
	let sloppy = 0;
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, { reaction: 0.5, slip: 0.1 }).result.won) sloppy++;
		if (play(seed, { mash: 7 }).result.won) mashed++;
		const idle = play(seed, { reaction: 99 });
		assert.equal(idle.result.won, false);
		assert.ok(idle.result.seconds < WINNOW_SECONDS);
	}
	assert.ok(sloppy > 0 && sloppy < SEEDS * 0.9, `${sloppy} sloppy wins`);
	assert.ok(mashed < SEEDS * 0.2, `${mashed} masher wins`);
});

test("it speeds up: more grain is tossed in the last five seconds than the first five", () => {
	const { events, state } = play(11);
	assert.equal(state.phase, "won");
	const tosses = [];
	const replay = newWinnow(11);
	for (let tick = 0; replay.phase === "playing"; tick++) {
		const out = [];
		const grain = winnowFront(replay);
		stepWinnow(replay, { sort: grain && replay.t - grain.born >= 0.3 ? winnowSideFor(grain.kind) : null }, out);
		for (const event of out) if (event.type === "toss") tosses.push(replay.t);
	}
	assert.ok(events.length > 0);
	assert.ok(tosses.filter((t) => t > 10).length > tosses.filter((t) => t < 5).length, JSON.stringify(tosses));
});
