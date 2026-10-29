/**
 * Crest Hopper (LC-17851, docs/beta/games.md), Matthew 14:22-33, the fifteen
 * second chapter game: the round replays exactly from a seed, a skilled
 * player reaches Jesus on nearly every seed with gold and never faster than
 * the server allows, an idle player never does, blind hopping rarely does,
 * a player who reacts late sometimes sinks or runs out of time, and a player
 * who hops whenever the ring turns gold, a human reaction late, still gets
 * there on nearly every seed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	CREST_COLS,
	CREST_FAITH,
	CREST_LIGHT_ROW,
	CREST_MIN_SECONDS,
	CREST_SECONDS,
	CREST_STEP,
	crestReady,
	crestResult,
	hopLanding,
	hopUpHolds,
	newCrest,
	shoveLands,
	stepCrest,
} from "../src/lib/beta/games/crest-hopper-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("crest-hopper");
const SEEDS = 200;
const IDLE = { hop: null };

function play(seed, policy) {
	const state = newCrest(seed);
	const events = [];
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepCrest(state, policy(state), events);
	return { state, events, result: crestResult(state) };
}

function windWithin(state, seconds) {
	if (state.shove) return state.shove.dir;
	if (state.gust && state.gust.at - state.t <= seconds) return state.gust.dir;
	return 0;
}

function trapped(state, row, x, seconds) {
	if (row.kind !== "sea") return false;
	const wind = windWithin(state, seconds);
	return !!wind && !shoveLands({ ...state, x, row: state.rows.indexOf(row) }, wind);
}

function goodHop(state, dir, margin = 0.3) {
	const to = hopLanding(state, dir, margin);
	return !!to && !trapped(state, state.rows[to.row], to.x, 0.75);
}

function skilled(state) {
	if (!crestReady(state)) return IDLE;
	if (state.row + 1 === CREST_LIGHT_ROW) return { hop: "up" };
	if (goodHop(state, "up")) return { hop: "up" };
	// Waited a while for a perfect hop: take a fair one.
	if (state.t - state.landedAt > 1 && goodHop(state, "up", 0.1)) return { hop: "up" };
	// Pinned at the edge of the sea a while: hop back in.
	if (state.t - state.landedAt > 0.6 && (state.x < 0.2 || state.x > CREST_COLS - 1.2)) {
		const inward = state.x < 1 ? "right" : "left";
		if (goodHop(state, inward)) return { hop: inward };
	}
	if (trapped(state, state.rows[state.row], state.x, 0.9)) {
		const wind = windWithin(state, 2);
		const upwind = wind === 1 ? "left" : wind === -1 ? "right" : null;
		const inward = state.x < (CREST_COLS - 1) / 2 ? "right" : "left";
		const choices = [upwind, inward, inward === "right" ? "left" : "right"].filter(Boolean);
		for (const dir of choices) if (goodHop(state, dir)) return { hop: dir };
		if (goodHop(state, "up", 0)) return { hop: "up" };
		for (const dir of choices) if (goodHop(state, dir, 0)) return { hop: dir };
	}
	return IDLE;
}

/** The skilled player seeing everything `delaySteps` late, one press per decision. */
function late(delaySteps) {
	let decided = [];
	return (state) => {
		decided.push(skilled(state).hop);
		if (decided.length <= delaySteps) return IDLE;
		const hop = decided.shift();
		if (!hop || !crestReady(state)) return IDLE;
		decided = decided.map(() => null);
		return { hop };
	};
}

/** What the ring on the next row shows (`ringState` in crest-hopper-scene.ts): "hop" is gold, "wait" red. */
function ring(state) {
	if (state.phase !== "playing" || state.air > 0 || state.stun > 0 || state.row >= CREST_LIGHT_ROW) return null;
	return hopUpHolds(state) ? "hop" : "wait";
}

/**
 * Hops only when the ring is gold, and steps aside when the gust's marker says
 * move, seeing everything `delaySteps` late: one press per sight, once the
 * last press has played out.
 */
function goldFollower(delaySteps) {
	const seen = [];
	let pressed = -Infinity;
	return (state) => {
		const step = seen.length;
		const settled = state.air === 0 && state.stun === 0;
		seen.push({
			step,
			settled,
			ring: ring(state),
			move: !!state.gust && settled && state.rows[state.row].kind === "sea" && !shoveLands(state, state.gust.dir),
			side: hopLanding(state, "left") ? "left" : hopLanding(state, "right") ? "right" : null,
		});
		const old = seen.length > delaySteps ? seen[seen.length - 1 - delaySteps] : null;
		if (!old || !old.settled || old.step <= pressed + 16) return IDLE;
		if (old.move && old.side) {
			pressed = step;
			return { hop: old.side };
		}
		if (old.ring !== "hop") return IDLE;
		pressed = step;
		return { hop: "up" };
	};
}

/** Hops toward Jesus every `seconds` without looking at the sea. */
function masher(seconds) {
	let next = 0;
	return (state) => {
		if (state.t < next) return IDLE;
		next = state.t + seconds;
		return { hop: "up" };
	};
}

/** Presses a random hop now and then. */
function randomPlayer(seed) {
	let a = seed >>> 0 || 1;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return () => {
		if (next() > 0.12) return IDLE;
		const r = next();
		return { hop: r < 0.6 ? "up" : r < 0.8 ? "left" : "right" };
	};
}

function rate(policyFor, base = 7919) {
	const runs = [];
	for (let seed = 1; seed <= SEEDS; seed++) runs.push(play(seed * base, policyFor(seed)));
	const won = runs.filter((run) => run.result.won);
	return { runs, won, wins: won.length, gold: won.filter((run) => gradeFor(run.result.score) === "gold").length };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, CREST_SECONDS);
	assert.ok(GAME.minSeconds <= CREST_MIN_SECONDS, `minSeconds ${GAME.minSeconds} > fastest win ${CREST_MIN_SECONDS}`);
	assert.equal(CREST_STEP, 1 / 60);
	assert.deepEqual(
		GAME.controls.flatMap((control) => control.keys),
		["↑", "Space", "←", "→"],
	);
});

test("the same seed and hops play the same round", () => {
	const a = play(4242, skilled);
	const b = play(4242, skilled);
	assert.deepEqual(a.state, b.state);
	assert.deepEqual(a.events, b.events);
	assert.deepEqual(play(99, randomPlayer(5)).state, play(99, randomPlayer(5)).state);
});

test("a skilled player reaches Jesus on nearly every seed, mostly with gold, never faster than the server allows", () => {
	const { won, wins, gold } = rate(() => skilled);
	assert.ok(wins >= SEEDS * 0.95, `${wins} of ${SEEDS} won`);
	assert.ok(gold >= wins * 0.8, `${gold} gold of ${wins}`);
	for (const { result, events } of won) {
		assert.ok(result.seconds >= GAME.minSeconds && result.seconds >= CREST_MIN_SECONDS, `${result.seconds}s`);
		assert.ok(result.seconds <= CREST_SECONDS);
		assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
});

test("doing nothing never reaches Jesus: the round ends at fifteen seconds", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state } = play(seed, () => IDLE);
		assert.equal(result.won, false);
		assert.equal(state.lostBy, "time");
		assert.ok(Math.abs(result.seconds - CREST_SECONDS) < 0.05);
	}
});

test("hopping blind or at random rarely reaches Jesus", () => {
	for (const every of [0.25, 0.5, 0.8]) {
		const { wins, runs } = rate(() => masher(every));
		assert.ok(wins < SEEDS * 0.2, `hopping every ${every}s won ${wins}`);
		assert.ok(runs.some((run) => run.state.lostBy === "faith"));
	}
	assert.ok(rate((seed) => randomPlayer(seed)).wins < SEEDS * 0.2);
});

test("hopping blind is never faster than the soonest possible finish", () => {
	for (let seed = 1; seed <= 2000; seed++) {
		const { result } = play(seed, masher(0));
		if (result.won) assert.ok(result.seconds >= CREST_MIN_SECONDS, `${result.seconds}s`);
	}
});

test("the soonest finish is every hop made without a pause, on a sea of crests", () => {
	const state = newCrest(1);
	for (const row of state.rows) row.pattern = row.pattern.map(() => 1);
	state.nextGustAt = 99;
	while (state.phase === "playing") stepCrest(state, { hop: crestReady(state) ? "up" : null });
	const result = crestResult(state);
	assert.equal(result.won, true);
	assert.ok(result.seconds >= CREST_MIN_SECONDS, `${result.seconds}s`);
	assert.ok(result.seconds - CREST_MIN_SECONDS < 0.5, `${result.seconds}s`);
});

test("a player who reacts late sometimes sinks or runs out of time", () => {
	const quarter = rate(() => late(15));
	assert.ok(quarter.wins < SEEDS * 0.9, `${quarter.wins} won`);
	assert.ok(quarter.wins > SEEDS * 0.4, `${quarter.wins} won`);
	assert.ok(quarter.runs.some((run) => run.state.lostBy === "faith"));
	assert.ok(quarter.runs.some((run) => run.state.lostBy === "time"));
});

test("the gold ring holds for a human reaction: hopping on gold a quarter second late reaches Jesus on nearly every seed", () => {
	const { wins, runs } = rate(() => goldFollower(15));
	assert.ok(wins >= SEEDS * 0.85, `${wins} of ${SEEDS} won`);
	// Gold comes often enough that he is not left waiting out the clock.
	const timedOut = runs.filter((run) => run.state.lostBy === "time").length;
	assert.ok(timedOut < SEEDS * 0.1, `${timedOut} ran out of time`);
});

test("a trough is a slip, three slips lose the round, and a slip costs faith", () => {
	const state = newCrest(11);
	const events = [];
	// Hop blindly until the first slip.
	while (state.phase === "playing" && state.slips === 0) stepCrest(state, { hop: crestReady(state) ? "up" : null }, events);
	assert.equal(state.faith, CREST_FAITH - 1);
	assert.ok(events.some((event) => event.type === "slip"));
	const { state: sunk } = play(11, masher(0));
	if (sunk.lostBy === "faith") {
		assert.equal(sunk.faith, 0);
		assert.equal(sunk.slips, CREST_FAITH);
	}
});

test("a gust is shown before it shoves him a lane downwind", () => {
	let shown = 0;
	for (let seed = 1; seed <= 50; seed++) {
		const { events } = play(seed, skilled);
		const warn = events.findIndex((event) => event.type === "gustWarn");
		const gust = events.findIndex((event) => event.type === "gust");
		if (gust >= 0) {
			assert.ok(warn >= 0 && warn < gust);
			shown++;
		}
	}
	assert.ok(shown >= 40, `${shown}`);
});
