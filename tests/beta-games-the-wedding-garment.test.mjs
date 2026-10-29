/**
 * The Wedding Garment (LC-17851, docs/beta/games.md), Matthew 22:1-14: the
 * round replays exactly from a seed, a quick and careful player clothes every
 * guest on every seed and never wins faster than the server allows, a
 * careless one sometimes loses, and an idle or random tapper never wins.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	WEDDING_MIN_SECONDS,
	WEDDING_SECONDS,
	WEDDING_STEP,
	guestAt,
	isClothed,
	newWedding,
	stepWedding,
	weddingResult,
} from "../src/lib/beta/games/the-wedding-garment-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-wedding-garment");
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

/**
 * Plays a round. A player sees a guest `react` seconds after he comes in,
 * taps at most every `gap` seconds, the unclothed guest nearest the door
 * first, within `aim` units, and misreads a clothed guest for one in road
 * clothes `misread` of the time; a masher taps anywhere `mash` times a second.
 */
function play(seed, { react = 0.3, gap = 0.16, aim = 5, misread = 0, mash = 0, idle = false } = {}) {
	const state = newWedding(seed);
	const next = random(seed * 31 + 7);
	const events = [];
	const seenAt = new Map();
	let last = -9;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		for (const guest of state.guests) if (!seenAt.has(guest.id)) seenAt.set(guest.id, state.t);
		const taps = [];
		if (mash > 0) {
			if (next() < mash / 60) taps.push({ x: next() * 400, y: next() * 400 });
		} else if (!idle && state.t - last >= gap) {
			const due = state.guests
				.filter((guest) => !isClothed(guest) && state.t - seenAt.get(guest.id) >= react)
				.sort((a, b) => b.along / b.length - a.along / a.length);
			if (due.length) {
				let pick = due[0];
				const clothed = state.guests.filter(isClothed);
				if (misread && clothed.length && next() < misread) pick = clothed[Math.floor(next() * clothed.length)];
				const at = guestAt(pick);
				taps.push({ x: at.cx + (next() * 2 - 1) * aim, y: at.cy + (next() * 2 - 1) * aim });
				last = state.t;
			}
		}
		stepWedding(state, { taps }, events);
	}
	return { state, events, result: weddingResult(state) };
}

function wins(options) {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed * 7919, options).result.won) won++;
	return won;
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WEDDING_SECONDS);
	assert.ok(GAME.minSeconds <= WEDDING_MIN_SECONDS);
	assert.equal(WEDDING_STEP, 1 / 60);
});

test("the same seed and taps play the same round", () => {
	assert.deepEqual(play(7).state, play(7).state);
	assert.deepEqual(play(11, { misread: 0.1 }).events, play(11, { misread: 0.1 }).events);
});

test("a quick, careful player clothes every guest on every seed, gold, never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events, state } = play(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= 12, `seed ${seed}: ${result.count} clothed`);
		assert.equal(state.mistakes, 0);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.95, `${gold} gold`);
});

test("guests come both in road clothes and already clothed, and faster as the feast fills", () => {
	const state = newWedding(5);
	const events = [];
	while (state.phase === "playing") stepWedding(state, { taps: [] }, events);
	const arrivals = events.filter((event) => event.type === "arrive").length;
	assert.ok(arrivals >= 8, `${arrivals} arrived`);
	let drab = 0;
	let white = 0;
	for (let seed = 1; seed <= 50; seed++) {
		const run = newWedding(seed);
		for (let tick = 0; tick < 600; tick++) stepWedding(run, { taps: [] });
		for (const guest of run.guests) guest.drab ? drab++ : white++;
	}
	assert.ok(drab > 0 && white > 0 && drab > white, `${drab} drab, ${white} white`);
});

test("tapping a guest already clothed is a mistake, and three end the round", () => {
	const state = newWedding(9);
	const events = [];
	let mistakes = 0;
	while (state.phase === "playing") {
		const white = state.guests.find(isClothed);
		const taps = white ? [{ x: guestAt(white).cx, y: guestAt(white).cy }] : [];
		stepWedding(state, { taps }, events);
		mistakes = state.mistakes;
	}
	assert.equal(state.phase, "lost");
	assert.ok(mistakes === 3 || state.unclothed === 2);
});

test("a careless player sometimes loses; a late one sometimes too", () => {
	const careless = wins({ react: 0.7, gap: 0.35, aim: 10, misread: 0.06 });
	assert.ok(careless < SEEDS * 0.9 && careless > SEEDS * 0.2, `careless won ${careless}`);
	assert.ok(wins({ react: 1.0, gap: 0.45, aim: 10 }) < SEEDS);
});

test("an idle player never wins, and tapping at random rarely does", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { idle: true });
		assert.equal(idle.result.won, false);
		assert.ok(idle.state.unclothed >= 2);
	}
	assert.ok(wins({ mash: 3 }) < SEEDS * 0.2);
	assert.ok(wins({ mash: 8 }) < SEEDS * 0.2);
});
