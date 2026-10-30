/**
 * He Is Risen (LC-17908, docs/beta/games.md), Matthew 28:1-20: a chain
 * reaction. The round replays exactly from a seed; a teller who waits for
 * people to gather and then tells reaches all eleven disciples on every seed,
 * mostly with gold, and never faster than the server allows; a hasty, careless
 * one sometimes falls short and rarely earns gold; telling at random or all
 * at once in one place almost never reaches them, and staying silent never
 * does.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	RISEN_ARRIVE_LAST,
	RISEN_BOTTOM,
	RISEN_COMPANIES,
	RISEN_DISCIPLES,
	RISEN_LEFT,
	RISEN_MIN_SECONDS,
	RISEN_RIGHT,
	RISEN_RING_LIFE,
	RISEN_RING_R,
	RISEN_SECONDS,
	RISEN_STEP,
	RISEN_TELLINGS,
	RISEN_TOP,
	arrived,
	newRisen,
	ringRadius,
	risenResult,
	risenSpreading,
	stepRisen,
} from "../src/lib/beta/games/he-is-risen-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("he-is-risen");
const SEEDS = 200;

function copy(state) {
	return { ...state, walkers: state.walkers.map((walker) => ({ ...walker })), rings: state.rings.map((ring) => ({ ...ring })) };
}

/** Plays the word out on a copy, telling at `point` now (or not), until it dies down: who it reaches. */
function foresee(state, point) {
	const ahead = copy(state);
	ahead.tellings = Math.max(ahead.tellings, 1);
	const until = ahead.t + 2.6;
	stepRisen(ahead, { tell: point });
	while (ahead.phase === "playing" && ahead.t < until && risenSpreading(ahead)) stepRisen(ahead, {});
	return { disciples: ahead.disciples - state.disciples, folk: ahead.folk - state.folk, won: ahead.phase === "won" };
}

/** Where a watching teller would consider telling: on each walker, between neighbours, and on any disciple left alone. */
function spots(state) {
	const live = state.walkers.filter((walker) => walker.told === null && arrived(walker, state.t));
	const points = live.map((walker) => ({ x: walker.x + walker.vx * 0.2, y: walker.y + walker.vy * 0.2 }));
	for (let i = 0; i < live.length; i++) {
		for (let j = i + 1; j < live.length; j++) {
			const a = live[i];
			const b = live[j];
			if (Math.hypot(a.x - b.x, a.y - b.y) < RISEN_RING_R * 1.6) points.push({ x: (a.x + b.x) / 2 + (a.vx + b.vx) * 0.1, y: (a.y + b.y) / 2 + (a.vy + b.vy) * 0.1 });
		}
	}
	const crowded = points.map((point) => {
		let n = 0;
		for (const walker of live) if (Math.hypot(walker.x + walker.vx * 0.3 - point.x, walker.y + walker.vy * 0.3 - point.y) < RISEN_RING_R) n += walker.disciple ? 2 : 1;
		return { point, n };
	});
	crowded.sort((a, b) => b.n - a.n);
	const disciples = live.filter((walker) => walker.disciple);
	const alone = disciples.length <= 3 ? disciples.map((walker) => ({ x: walker.x + walker.vx * 0.2, y: walker.y + walker.vy * 0.2 })) : [];
	return [...crowded.slice(0, 4).map((entry) => entry.point), ...alone];
}

/**
 * A teller's judgement: where telling now would reach the most, and whether
 * that is worth a telling. A patient one waits for a good gathering early on
 * and keeps the last telling for one straggler; a hasty one tells at the
 * first chance.
 */
function decide(state, patient) {
	if (state.tellings <= 0) return null;
	if (state.rings.some((ring) => ring.by < 0 && state.t - ring.born < 0.9)) return null;
	const need = RISEN_DISCIPLES - state.disciples;
	const left = RISEN_SECONDS - state.t;
	const already = risenSpreading(state) ? foresee(state, null) : { disciples: 0, folk: 0, won: false };
	if (already.won) return null;
	let best = null;
	for (const point of spots(state)) {
		const reach = foresee(state, point);
		const gain = reach.disciples - already.disciples;
		const value = reach.won ? 1000 + reach.folk : gain * 3 + (reach.folk - already.folk);
		if (!best || value > best.value) best = { value, point, reach, gain };
	}
	if (!best) return null;
	if (best.reach.won) return best.point;
	if (state.t < RISEN_ARRIVE_LAST + 0.2 && state.tellings === 1) return null;
	const share = (need - already.disciples) / state.tellings;
	const patience = patient ? 1 + 1.1 * Math.max(0, (9 - state.t) / 9) : 0.01;
	if (patient && state.tellings === 2 && state.t < 10 && need - already.disciples - best.gain > 1) return null;
	if (best.gain >= share * patience || (left < 1.5 + state.tellings * 1.2 && best.gain > 0)) return best.point;
	return null;
}

/**
 * Plays a round. `skilled` looks four times a second; `sloppy` is hasty, its
 * aim off by up to `jitter` units and its telling up to `late` steps late.
 * `masher` tells everything at once in the middle, `random` taps anywhere.
 */
function play(seed, kind, { jitter = 26, late = 20, rate = 0.05 } = {}) {
	const state = newRisen(seed);
	const events = [];
	let noise = (seed * 2654435761) >>> 0 || 1;
	const rnd = () => {
		noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
		return noise / 4294967296;
	};
	let queued = null;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		let tell = null;
		if (kind === "masher") tell = { x: 200, y: 268 };
		else if (kind === "random") tell = rnd() < rate ? { x: RISEN_LEFT + rnd() * (RISEN_RIGHT - RISEN_LEFT), y: RISEN_TOP + rnd() * (RISEN_BOTTOM - RISEN_TOP) } : null;
		else if (kind === "skilled" || kind === "sloppy") {
			if (queued) {
				queued.wait--;
				if (queued.wait <= 0) {
					tell = queued.point;
					queued = null;
				}
			} else if (tick % 15 === 0) {
				const point = decide(state, kind === "skilled");
				if (point && kind === "skilled") tell = point;
				else if (point) queued = { point: { x: point.x + (rnd() * 2 - 1) * jitter, y: point.y + (rnd() * 2 - 1) * jitter }, wait: 1 + Math.round(rnd() * late) };
			}
		}
		stepRisen(state, { tell }, events);
	}
	return { state, events, result: risenResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, RISEN_SECONDS);
	assert.ok(GAME.minSeconds <= RISEN_MIN_SECONDS);
	assert.equal(RISEN_STEP, 1 / 60);
	assert.equal(RISEN_COMPANIES.reduce((sum, company) => sum + company.size, 0), RISEN_DISCIPLES);
	assert.equal(Math.max(...RISEN_COMPANIES.map((company) => company.arrive)), RISEN_ARRIVE_LAST);
	assert.ok(GAME.controls.some((control) => control.keys.includes("Space")));
});

test("the same seed and tellings play the same round", () => {
	assert.deepEqual(play(7, "skilled").state, play(7, "skilled").state);
	assert.deepEqual(play(11, "sloppy").state, play(11, "sloppy").state);
});

test("a ring grows, holds and fades; a ring that catches nobody fades away", () => {
	assert.equal(ringRadius(0), 0);
	assert.equal(ringRadius(0.6), RISEN_RING_R);
	assert.equal(ringRadius(RISEN_RING_LIFE + 0.01), 0);
	// Everyone far off in one corner: a telling in the other reaches nobody.
	const state = newRisen(3);
	for (const walker of state.walkers) Object.assign(walker, { x: RISEN_RIGHT, y: RISEN_BOTTOM, vx: 0, vy: 0 });
	const events = [];
	stepRisen(state, { tell: { x: RISEN_LEFT, y: RISEN_TOP } }, events);
	for (let i = 0; i < 200; i++) stepRisen(state, {}, events);
	assert.equal(state.rings.length, 0);
	assert.deepEqual(events.find((event) => event.type === "faded"), { type: "faded", caught: 0, player: true });
	assert.equal(state.tellings, RISEN_TELLINGS - 1);
});

test("nobody hears before they come into the garden", () => {
	const state = newRisen(9);
	const late = state.walkers.filter((walker) => walker.arrive > 0);
	assert.ok(late.length > 0);
	stepRisen(state, { tell: { x: late[0].x, y: late[0].y } });
	for (let i = 0; i < 20; i++) stepRisen(state, {});
	assert.ok(late.every((walker) => walker.told === null));
});

test("a patient teller reaches all eleven on nearly every seed, mostly with gold, and never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, "skilled");
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	if (process.env.RISEN_STATS) console.log(`patient: ${won} won, ${gold} gold`);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold > SEEDS / 2, `${gold} gold`);
});

test("a hasty, careless teller sometimes falls short and rarely earns gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * 104729, "sloppy");
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	if (process.env.RISEN_STATS) console.log(`hasty: ${won} won, ${gold} gold`);
	assert.ok(won < SEEDS * 0.85, `${won} won`);
	assert.ok(gold < SEEDS * 0.25, `${gold} gold`);
});

test("telling everything at once, or anywhere at random, almost never reaches the eleven; silence never does", () => {
	let masher = 0;
	let random = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, "masher").result.won) masher++;
		if (play(seed, "random", { rate: 0.02 }).result.won) random++;
		if (play(seed, "random", { rate: 0.1 }).result.won) random++;
		const idle = play(seed, "idle");
		assert.equal(idle.result.won, false);
		assert.equal(idle.result.count, 0);
		assert.ok(Math.abs(idle.result.seconds - RISEN_SECONDS) < 0.05);
	}
	if (process.env.RISEN_STATS) console.log(`masher: ${masher} won, random: ${random} won of ${SEEDS * 2}`);
	assert.ok(masher < SEEDS * 0.1, `${masher} masher wins`);
	assert.ok(random < SEEDS * 0.4, `${random} random wins of ${SEEDS * 2}`);
});
