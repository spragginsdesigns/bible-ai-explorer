/**
 * The Hem of His Garment (LC-17851, docs/beta/games.md), Matthew 9:20-22:
 * the round replays exactly from a seed, a woman who waits for the gaps and
 * slips through reaches the hem on nearly every seed and never faster than
 * the server allows, a careless or idle one does not, and the round lasts as
 * long as the registry says.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	HEM_LANES,
	HEM_MIN_SECONDS,
	HEM_RADIUS,
	HEM_REACH,
	HEM_SECONDS,
	HEM_SPEED,
	HEM_START,
	HEM_STEP,
	PERSON_RADIUS,
	crowdAt,
	hemPoint,
	hemResult,
	newHem,
	stepHem,
} from "../src/lib/beta/games/hem-of-his-garment-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("hem-of-his-garment");
const SEEDS = 200;
/** Would following `plan` ([direction, ticks] pairs), then standing a moment, bump into anyone? */
function bumps(state, plan, margin) {
	let { x, y } = state;
	let tick = 0;
	for (const [dir, ticks] of [...plan, [{ x: 0, y: 0 }, 12]]) {
		for (let i = 0; i < ticks; i++) {
			tick++;
			x = Math.max(HEM_RADIUS, Math.min(400 - HEM_RADIUS, x + dir.x * HEM_SPEED * HEM_STEP));
			y = Math.max(52, Math.min(400 - HEM_RADIUS, y + dir.y * HEM_SPEED * HEM_STEP));
			if (tick % 2) continue;
			const t = state.t + tick * HEM_STEP;
			if (crowdAt(state, t).some((p) => Math.hypot(p.x - x, p.y - y) < PERSON_RADIUS + HEM_RADIUS + margin)) return true;
		}
	}
	return false;
}
const UP = { x: 0, y: -1 };
/**
 * A skilled player: heads for the hem, waits in the space between two rows
 * (sliding toward the hem) until the gap above stays open all the way across,
 * then steps straight up through it. `look` is extra foresight, `margin` how
 * much room she leaves.
 */
function skilled(look = 0.45, margin = 2) {
	return (state) => {
		const strip = [339, 293, 247, 201, 155, 100].find((y) => y < state.y - 2) ?? 100;
		const cross = Math.ceil((state.y - strip) / (HEM_SPEED * HEM_STEP)) + Math.round((look - 0.45) / HEM_STEP);
		const hem = hemPoint(state.t + 0.6);
		const dx = hem.x - state.x;
		if (state.y <= hem.y + 14) { const l = Math.hypot(dx, hem.y - state.y) || 1; return { x: dx / l, y: (hem.y - state.y) / l }; }
		const side = Math.sign(dx) || 1;
		let best = null;
		for (const wait of [0, 6, 12, 18, 24, 36, 48]) {
			for (const h of [side, 0, -side]) {
				if (wait === 0 && h !== side) continue;
				const plan = [[{ x: h, y: 0 }, wait], [UP, cross]];
				if (!bumps(state, plan, margin)) { best = wait === 0 ? UP : { x: h, y: 0 }; break; }
			}
			if (best) break;
		}
		if (best) return best;
		return bumps(state, [], margin) ? { x: 0, y: 1 } : { x: 0, y: 0 };
	};
}
/** A careless player: straight at the hem, through whoever is in the way. */
const careless = (state) => {
	const hem = hemPoint(state.t);
	return { x: hem.x - state.x, y: hem.y - state.y };
};

/** Plays a round with a steering function. */
function play(seed, steer) {
	const state = newHem(seed);
	const events = [];
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepHem(state, steer(state, tick), events);
	return { state, events, result: hemResult(state) };
}

function masher(seed) {
	let s = seed >>> 0 || 1;
	const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
	let dir = { x: 0, y: 0 };
	return (state, tick) => {
		if (tick % 12 === 0) {
			const options = [-1, 0, 1];
			dir = { x: options[Math.floor(rand() * 3)], y: options[Math.floor(rand() * 3)] };
		}
		return dir;
	};
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, HEM_SECONDS);
	assert.ok(GAME.minSeconds <= HEM_MIN_SECONDS, `registry ${GAME.minSeconds} > fastest ${HEM_MIN_SECONDS}`);
	assert.equal(HEM_STEP, 1 / 60);
});

test("no woman can reach the hem before the fastest win, whatever she does", () => {
	for (let t = 0; t < HEM_MIN_SECONDS; t += HEM_STEP) {
		const hem = hemPoint(t);
		assert.ok(Math.hypot(hem.x - HEM_START.x, hem.y - HEM_START.y) > HEM_SPEED * t + HEM_REACH, `${t}`);
	}
});

test("the same seed and steering play the same round", () => {
	assert.deepEqual(play(7, skilled()).state, play(7, skilled()).state);
	assert.deepEqual(play(9, masher(3)).state, play(9, masher(3)).state);
});

test("a skilled player reaches the hem on nearly every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	const times = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, skilled());
		if (!result.won) continue;
		won++;
		times.push(result.seconds);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= HEM_MIN_SECONDS, `seed ${seed}: ${result.seconds}s`);
		assert.equal(events.filter((event) => event.type === "touched").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, HEM_MIN_SECONDS).ok, true);
	}
	times.sort((a, b) => a - b);
	console.log(`skilled: ${won}/${SEEDS} won, ${gold} gold, fastest ${times[0]}s, median ${times[times.length >> 1]}s`);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= won * 0.6, `${gold} gold of ${won}`);
});

test("an idle woman never reaches the hem, and the round lasts its seconds", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = play(seed, () => ({ x: 0, y: 0 }));
		assert.equal(idle.result.won, false);
		assert.ok(Math.abs(idle.result.seconds - HEM_SECONDS) < 0.05);
	}
});

test("wandering at random rarely reaches the hem", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (play(seed, masher(seed * 31)).result.won) won++;
	console.log(`masher: ${won}/${SEEDS} won`);
	assert.ok(won < SEEDS * 0.2, `${won} won`);
});

test("a sloppy player, short-sighted, sometimes loses; a careless one is bumped back and is never gold", () => {
	let sloppyWon = 0;
	let carelessWon = 0;
	let carelessGold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, skilled(0.12, -6)).result.won) sloppyWon++;
		const run = play(seed, careless);
		if (run.result.won) carelessWon++;
		if (run.result.won && gradeFor(run.result.score) === "gold") carelessGold++;
	}
	console.log(`sloppy: ${sloppyWon}/${SEEDS} won; careless: ${carelessWon}/${SEEDS} won, ${carelessGold} gold`);
	assert.ok(sloppyWon < SEEDS * 0.95, `${sloppyWon} won`);
	assert.ok(carelessGold < SEEDS * 0.2, `${carelessGold} careless gold`);
});
