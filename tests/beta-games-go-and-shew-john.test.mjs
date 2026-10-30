/**
 * Go and Shew John (LC-17908, docs/beta/games.md), Matthew 11:2-6: the six
 * pairs are 11:5's words exactly; every seed deals each subject and its work
 * once; the round replays exactly from a seed; a player who remembers what
 * they have seen shews all six on nearly every seed, mostly gold, by touch or
 * by keys, and never faster than the server allows; an idle player and one
 * pressing Space in place never win, a masher rarely does, and a forgetful,
 * slow one sometimes loses and rarely earns gold.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	SHEW_CARDS,
	SHEW_COLUMNS,
	SHEW_FLIP,
	SHEW_MIN_SECONDS,
	SHEW_PLACES,
	SHEW_PREVIEW,
	SHEW_SECONDS,
	SHEW_STEP,
	SHEW_WORKS,
	newShew,
	shewCanTurn,
	shewPlaceAt,
	shewResult,
	stepShew,
} from "../src/lib/beta/games/go-and-shew-john-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("go-and-shew-john");
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

/** The arrow presses that carry the highlight from one place to another. */
function path(from, to) {
	const moves = [];
	const dx = (to % SHEW_COLUMNS) - (from % SHEW_COLUMNS);
	const dy = Math.floor(to / SHEW_COLUMNS) - Math.floor(from / SHEW_COLUMNS);
	for (let i = 0; i < Math.abs(dx); i++) moves.push(dx > 0 ? "right" : "left");
	for (let i = 0; i < Math.abs(dy); i++) moves.push(dy > 0 ? "down" : "up");
	return moves;
}

/**
 * Plays a round as a person with a memory: each card glimpsed in the preview
 * is kept with chance `glimpse`, each card seen turned with chance `keep`.
 * They turn a known pair when they know one, else an unknown card, then its
 * known partner or another unknown. `think` is the seconds before each turn;
 * with `keys` they walk the highlight with the arrows (`stride` seconds a
 * press) and press Space, else they tap the card.
 */
function play(seed, { glimpse = 0.3, keep = 0.95, think = () => 0.3, keys = false, stride = 0.09, mode = "player" } = {}) {
	const state = newShew(seed);
	const events = [];
	const next = rng(seed ^ 0x2f6b9d1);
	const known = new Map();
	for (let place = 0; place < SHEW_CARDS; place++) if (next() < glimpse) known.set(place, state.cards[place].pair);
	let plan = [];
	let waitUntil = 0;
	let target = null;
	const choose = () => {
		const live = (place) => !state.cards[place].matched && !state.cards[place].up;
		const open = state.open.length === 1 ? state.open[0] : null;
		if (open !== null) {
			const pair = state.cards[open].pair;
			for (const [place, seen] of known) if (place !== open && seen === pair && live(place)) return place;
		} else {
			const byPair = new Map();
			for (const [place, seen] of known) {
				if (!live(place)) continue;
				if (byPair.has(seen)) return byPair.get(seen);
				byPair.set(seen, place);
			}
		}
		const unknown = [];
		for (let place = 0; place < SHEW_CARDS; place++) if (live(place) && !known.has(place)) unknown.push(place);
		if (unknown.length) return unknown[Math.floor(next() * unknown.length)];
		const any = [];
		for (let place = 0; place < SHEW_CARDS; place++) if (live(place)) any.push(place);
		return any[Math.floor(next() * any.length)];
	};
	for (let tick = 0; state.phase === "playing" && tick < 60 * 40; tick++) {
		let input = {};
		if (mode === "masher") {
			if (tick % 8 === 0) input = { place: Math.floor(next() * SHEW_CARDS) };
		} else if (mode === "keymasher") {
			if (tick % 5 === 0) {
				const pick = Math.floor(next() * 5);
				input = pick === 4 ? { turn: true } : { move: ["left", "right", "up", "down"][pick] };
			}
		} else if (mode === "space") {
			if (tick % 6 === 0) input = { turn: true };
		} else if (mode === "fastest") {
			if (shewCanTurn(state)) {
				const open = state.open[0];
				const place =
					open === undefined
						? state.cards.findIndex((card) => !card.matched)
						: state.cards.findIndex((card, at) => at !== open && !card.matched && card.pair === state.cards[open].pair);
				input = { place };
			}
		} else if (mode === "player") {
			// They choose the next card (and walk the highlight to it) even while a miss still shows.
			if (state.tick + 1 >= waitUntil && state.tick + 1 >= SHEW_PREVIEW + SHEW_FLIP) {
				if (target === null) {
					target = choose();
					plan = keys ? path(state.cursor, target) : [];
					waitUntil = state.tick + 1 + Math.round(think(next) * 60);
				} else if (plan.length) {
					input = { move: plan.shift() };
					waitUntil = state.tick + 1 + Math.round(stride * 60);
				} else if (shewCanTurn(state)) {
					input = keys ? { turn: true } : { place: target };
					target = null;
				}
			}
		}
		const before = events.length;
		stepShew(state, input, events);
		for (const event of events.slice(before)) {
			if (event.type === "turn" && next() < keep) known.set(event.place, state.cards[event.place].pair);
		}
	}
	return { state, events, result: shewResult(state) };
}

const skilled = { glimpse: 0.3, keep: 0.95, think: (r) => 0.22 + r() * 0.16, stride: 0.11 };
const sloppy = { glimpse: 0.05, keep: 0.6, think: (r) => 0.4 + r() * 0.3, stride: 0.15 };

test("the pairs are Matthew 11:5 in the bundled KJV's words and order", () => {
	const verse = matthew[10][4];
	let from = 0;
	for (const { subject, work } of SHEW_WORKS) {
		const at = verse.indexOf(`${subject} ${work}`, from);
		assert.ok(at >= from, `${subject} ${work}`);
		from = at + subject.length;
	}
	assert.match(matthew[10][2], /Art thou he that should come, or do we look for another\?/);
	assert.match(matthew[10][5], /blessed is he, whosoever shall not be offended in me/);
});

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, SHEW_SECONDS);
	assert.ok(GAME.minSeconds <= SHEW_MIN_SECONDS);
	assert.ok(GAME.minSeconds >= SHEW_MIN_SECONDS - 0.2, "minSeconds is the fastest win, not a guess");
	assert.equal(SHEW_STEP, 1 / 60);
});

test("every seed deals each subject and its work once, at places that differ from seed to seed", () => {
	const layouts = new Set();
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { cards } = newShew(seed);
		assert.equal(cards.length, 12);
		for (let pair = 0; pair < 6; pair++) for (const half of [0, 1]) assert.equal(cards.filter((card) => card.pair === pair && card.half === half).length, 1);
		layouts.add(cards.map((card) => `${card.pair}${card.half}`).join(""));
	}
	assert.equal(layouts.size, SEEDS);
});

test("a tap lands on the card under it; the arrows stay inside the grid", () => {
	SHEW_PLACES.forEach((at, place) => assert.equal(shewPlaceAt(at.x, at.y), place));
	assert.equal(shewPlaceAt(200, 30), null);
	const state = newShew(3);
	for (const move of ["left", "up", "right", "right", "right", "right", "down", "down", "down"]) stepShew(state, { move });
	assert.equal(state.cursor, SHEW_CARDS - 1);
});

test("nothing turns during the preview, and two that differ turn back and block a third while they show", () => {
	const state = newShew(5);
	stepShew(state, { place: 0 });
	assert.equal(state.cards[0].up, false);
	while (!shewCanTurn(state)) stepShew(state, {});
	const a = 0;
	const b = state.cards.findIndex((card, at) => at !== a && card.pair !== state.cards[a].pair);
	const c = state.cards.findIndex((card, at) => at !== a && at !== b);
	stepShew(state, { place: a });
	while (!shewCanTurn(state) && state.open.length < 2) stepShew(state, {});
	stepShew(state, { place: b });
	assert.equal(state.misses, 1);
	stepShew(state, { place: c });
	assert.equal(state.cards[c].up, false, "nothing turns while a miss shows");
	while (state.open.length) stepShew(state, {});
	assert.equal(state.cards[a].up || state.cards[b].up, false);
});

test("the same seed and turns play the same round", () => {
	assert.deepEqual(play(7, sloppy).state, play(7, sloppy).state);
});

test("the fastest possible win is the minimum, and the server accepts it", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const fastest = play(seed, { mode: "fastest" });
		assert.equal(fastest.result.won, true);
		assert.ok(Math.abs(fastest.state.endedAt - SHEW_MIN_SECONDS) < 1e-9, `${fastest.state.endedAt}`);
		assert.equal(checkGameRun({ faithKept: fastest.result.score, seconds: fastest.result.seconds, swellsCleared: fastest.result.count }, GAME.minSeconds).ok, true);
	}
});

test("a player who remembers what they see shews all six on nearly every seed, mostly gold, by touch or keys, never faster than the server allows", () => {
	for (const keys of [false, true]) {
		let won = 0;
		let gold = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const { result, events } = play(seed * 7919, { ...skilled, keys });
			if (!result.won) continue;
			won++;
			if (gradeFor(result.score) === "gold") gold++;
			assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
			assert.equal(events.filter((event) => event.type === "won").length, 1);
			assert.equal(result.count, 6);
			assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
		}
		assert.ok(won >= SEEDS * 0.95, `${keys ? "keys" : "touch"}: ${won} won`);
		assert.ok(gold >= won * 0.7, `${keys ? "keys" : "touch"}: ${gold} gold of ${won}`);
	}
});

test("a forgetful, slow player sometimes loses and rarely earns gold", () => {
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

test("an idle player and one pressing Space in place never win; mashers rarely do", () => {
	let mashed = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, { mode: "idle" });
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - SHEW_SECONDS) < 0.05);
		assert.equal(play(seed, { mode: "space" }).result.won, false);
		if (play(seed, { mode: "masher" }).result.won) mashed++;
		if (play(seed, { mode: "keymasher" }).result.won) mashed++;
	}
	assert.ok(mashed < SEEDS * 2 * 0.1, `${mashed} mashed wins`);
});
