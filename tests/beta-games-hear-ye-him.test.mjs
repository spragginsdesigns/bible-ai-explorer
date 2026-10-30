/**
 * Hear Ye Him (LC-17908, docs/beta/games.md), Matthew 17:1-8: the climb
 * replays exactly from a seed, a steady steerer reaches the bright cloud on
 * every seed, with gold, and never faster than the server allows; an idle
 * climber, one held to a side and a masher never do; a late, loose steerer
 * stumbles, sometimes loses and rarely earns gold. The mountain is always
 * climbable and never climbs itself.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	HEAR_ACCEL,
	HEAR_APEX,
	HEAR_FALL,
	HEAR_MARKS,
	HEAR_MIN_SECONDS,
	HEAR_RUN,
	HEAR_SECONDS,
	HEAR_STEP,
	HEAR_SUMMIT,
	hearFallTime,
	hearResult,
	ledgeX,
	newHear,
	stepHear,
} from "../src/lib/beta/games/hear-ye-him-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("hear-ye-him");
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

/** How far sideways he can go in `tau` seconds, starting at `v0` toward it. */
function reachDist(v0, tau) {
	const ta = Math.max(0, (HEAR_RUN - v0) / HEAR_ACCEL);
	if (tau <= ta) return v0 * tau + 0.5 * HEAR_ACCEL * tau * tau;
	return v0 * ta + 0.5 * HEAR_ACCEL * ta * ta + HEAR_RUN * (tau - ta);
}

/** The highest ledge he can steer onto from what he sees, preferring one with a way on from it. */
function plan(state, view, safety = 0.85) {
	const apex = view.vy > 0 ? view.y + (view.vy * view.vy) / (2 * 1300) : view.y;
	let best = null;
	for (const ledge of state.ledges) {
		if (ledge.broken !== null || ledge.y > apex - 6 || ledge.y < view.camera - HEAR_FALL + 4) continue;
		const tau = hearFallTime(ledge.y - view.y, view.vy);
		if (!Number.isFinite(tau)) continue;
		const lx = ledgeX(ledge, view.t + tau);
		const dx = lx - view.x;
		if (Math.max(0, Math.abs(dx) - (ledge.w / 2 - 4)) > reachDist(view.vx * Math.sign(dx || 1), tau) * safety - 6) continue;
		const onward =
			ledge.y > HEAR_SUMMIT - HEAR_APEX + 8 ||
			state.ledges.some(
				(other) =>
					other !== ledge &&
					other.broken === null &&
					other.y > ledge.y + 4 &&
					other.y <= ledge.y + HEAR_APEX - 6 &&
					Math.max(0, Math.abs(ledgeX(other, view.t + tau + 0.6) - ledgeX(ledge, view.t + tau)) - (other.w / 2 - 4)) <= reachDist(0, hearFallTime(other.y - ledge.y)) * 0.85 - 6,
			);
		const score = ledge.y - (ledge.kind === "loose" ? 25 : 0) - (onward ? 0 : 1000);
		if (!best || score > best.score) best = { ledge, score };
	}
	return best;
}

/** Steers toward `x`, letting go in time to stop over it. */
function steer(view, x) {
	const brake = (view.vx * Math.abs(view.vx)) / (2 * HEAR_ACCEL);
	return Math.abs(x - view.x - brake) < 3 ? 0 : Math.sign(x - view.x - brake);
}

/** Picks a ledge at each spring and steers to it, seeing `lag` steps late and aiming up to `noise` off. */
const climber = (lag = 0, noise = 0) => () => {
	const seen = [];
	let target = null;
	let springs = -1;
	let off = 0;
	return (state, next) => {
		seen.push({ x: state.x, y: state.y, vx: state.vx, vy: state.vy, t: state.t, camera: state.camera, springs: state.springs });
		const view = seen[Math.max(0, seen.length - 1 - lag)];
		if (view.springs !== springs || !target || target.ledge.broken !== null) {
			springs = view.springs;
			target = plan(state, view) ?? plan(state, view, 1);
			off = noise ? (next() * 2 - 1) * noise : 0;
		}
		if (!target) return 0;
		const tau = hearFallTime(target.ledge.y - view.y, view.vy);
		return steer(view, ledgeX(target.ledge, view.t + (Number.isFinite(tau) ? tau : 0)) + off);
	};
};
const skilled = climber(0, 0);
const sloppy = climber(6, 26);
/** Left, right or still at random, a new choice every tenth of a second. */
const masher = () => {
	let dir = 0;
	return (state, next) => {
		if (state.tick % 6 === 0) dir = Math.floor(next() * 3) - 1;
		return dir;
	};
};

/** Plays a round; `control(state, next)` is the steering this step (-1, 0 or 1). */
function play(seed, control) {
	const state = newHear(seed);
	const events = [];
	const next = random(seed * 31 + 7);
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepHear(state, { dir: control(state, next) }, events);
	return { state, events, result: hearResult(state) };
}

function rates(make) {
	let won = 0;
	let gold = 0;
	const results = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const run = play(seed * 7919, make());
		results.push(run);
		if (run.result.won) {
			won++;
			if (gradeFor(run.result.score) === "gold") gold++;
		}
	}
	return { won, gold, results };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, HEAR_SECONDS);
	assert.ok(GAME.minSeconds <= HEAR_MIN_SECONDS, `${GAME.minSeconds} > ${HEAR_MIN_SECONDS}`);
	assert.ok(GAME.minSeconds >= HEAR_MIN_SECONDS - 0.5, "the minimum is the fastest climb, not a guess");
	assert.equal(HEAR_STEP, 1 / 60);
	assert.equal(HEAR_MARKS, 3);
});

test("the same seed and steering climb the same mountain", () => {
	assert.deepEqual(play(7, skilled()).state, play(7, skilled()).state);
	assert.deepEqual(play(11, sloppy()).state, play(11, sloppy()).state);
});

test("the way up is always within a spring, the ledges vary, and they spread apart higher up", () => {
	const seen = { wide: 0, narrow: 0, loose: 0, wind: 0 };
	const low = [];
	const high = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { ledges } = newHear(seed * 7919);
		for (const kind of Object.keys(seen)) if (ledges.some((ledge) => ledge.kind === kind)) seen[kind]++;
		// The firm ledges (never loose) climb to the cloud with every gap under a spring.
		const firm = ledges.filter((ledge) => ledge.kind !== "loose");
		for (let i = 1; i < firm.length; i++) assert.ok(firm[i].y - firm[i - 1].y < HEAR_APEX - 10, `seed ${seed}: gap ${firm[i].y - firm[i - 1].y}`);
		assert.ok(firm.at(-1).y > HEAR_SUMMIT - HEAR_APEX, `seed ${seed}: the cloud is out of reach`);
		firm.slice(1).forEach((ledge, i) => (ledge.y < HEAR_SUMMIT / 2 ? low : high).push(ledge.y - firm[i].y));
	}
	const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
	for (const [kind, count] of Object.entries(seen)) assert.ok(count >= SEEDS * 0.9, `${kind} on ${count} mountains`);
	assert.ok(mean(high) > mean(low) + 8, `gaps ${mean(low).toFixed(0)} low, ${mean(high).toFixed(0)} high`);
});

test("a steady steerer reaches the bright cloud on every seed, with gold, and never faster than the server allows", () => {
	const { won, gold, results } = rates(skilled);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.9, `${gold} gold`);
	for (const { result, events } of results) {
		if (!result.won) continue;
		assert.ok(result.seconds < HEAR_SECONDS, `${result.seconds}s`);
		assert.ok(result.seconds >= GAME.minSeconds, `${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "summit").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
});

test("an idle climber, one held to a side and a masher never reach the cloud", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed * 7919, () => 0);
		assert.equal(idle.result.won, false);
		assert.ok(idle.state.highest < HEAR_APEX + 1, "standing still, he only springs on the ground");
		assert.ok(Math.abs(idle.result.seconds - HEAR_SECONDS) < 0.05);
		assert.equal(play(seed * 7919, () => 1).result.won, false);
		assert.equal(play(seed * 7919, () => -1).result.won, false);
	}
	assert.ok(rates(masher).won <= SEEDS * 0.05, `${rates(masher).won} masher wins`);
});

test("a late, loose steerer stumbles: it sometimes loses and rarely earns gold", () => {
	const { won, gold, results } = rates(sloppy);
	assert.ok(won < SEEDS * 0.8, `${won} won`);
	assert.ok(won > SEEDS * 0.1, `${won} won`);
	assert.ok(gold <= SEEDS * 0.15, `${gold} gold`);
	assert.ok(results.some(({ state }) => state.stumbles >= HEAR_MARKS), "three stumbles lose");
});

test("a stumble sets him back on the last good ledge, and loose stones crumble after one landing", () => {
	let checked = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const state = newHear(seed * 7919);
		const control = sloppy();
		const next = random(seed * 31 + 7);
		for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
			const good = state.ledges[state.lastGood];
			const events = [];
			stepHear(state, { dir: control(state, next) }, events);
			const stumble = events.find((event) => event.type === "stumble");
			if (stumble && state.phase === "playing") {
				assert.notEqual(good.kind, "loose");
				assert.equal(state.y, good.y);
				assert.equal(state.x, ledgeX(good, state.t));
				assert.equal(stumble.marksLeft, HEAR_MARKS - state.stumbles);
				checked++;
			}
			for (const event of events.filter((item) => item.type === "crumble")) assert.notEqual(state.ledges[event.index].broken, null);
		}
	}
	assert.ok(checked > 10, `${checked} stumbles checked`);
	const crumbled = rates(skilled).results.flatMap(({ events: list }) => list.filter((event) => event.type === "crumble"));
	assert.ok(crumbled.length > 0, "someone springs off a loose stone");
});
