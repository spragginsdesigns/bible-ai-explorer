/**
 * Fishers of Men (LC-17908, docs/beta/games.md), Matthew 4:18-22: aim and
 * lead. The round replays exactly from a seed; a fisher who glides the net to
 * where a shoal will be (or taps it there) fills the net on every seed with
 * gold and never faster than the server allows; one who aims at where the
 * shoal is now, late and shakily, sometimes falls short and rarely earns
 * gold; casting over and over without aiming, or an idle boat, does not.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	FISH_AIM_MAX,
	FISH_AIM_SPEED,
	FISH_BOAT_X,
	FISH_BOAT_Y,
	FISH_FAR,
	FISH_FLIGHT,
	FISH_HAUL,
	FISH_LOG_R,
	FISH_MIN_CASTS,
	FISH_MIN_SECONDS,
	FISH_NEAR,
	FISH_NET_HOLD,
	FISH_NET_R,
	FISH_QUOTA,
	FISH_SECONDS,
	FISH_SNAG_HAUL,
	FISH_STEP,
	clampAim,
	fishAt,
	fishResult,
	logAt,
	newFish,
	shoalAt,
	stepFish,
} from "../src/lib/beta/games/fishers-of-men-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("fishers-of-men");
const SEEDS = 200;
const STEP_GLIDE = FISH_AIM_SPEED * FISH_STEP;

/** How many fish a net landing at (x, y) at time t would haul, as a fisher watching the water judges it. */
function catchAt(state, x, y, t) {
	for (const log of state.logs) {
		const at = logAt(log, t);
		if (Math.hypot(at.x - x, at.y - y) < FISH_LOG_R + 4) return 0;
	}
	let n = 0;
	for (const shoal of state.shoals) {
		const centre = shoalAt(shoal, t);
		if (Math.hypot(centre.x - x, centre.y - y) > FISH_NET_R + 40) continue;
		for (const one of shoal.fish) {
			const at = fishAt(shoal, one, t);
			if (Math.hypot(at.x - x, at.y - y) <= FISH_NET_R - 4) n++;
		}
	}
	return Math.min(n, FISH_NET_HOLD);
}

/** When the net will next be in Peter's hands. */
function readyAt(state) {
	const cast = state.cast;
	if (cast.stage === "ready") return state.t;
	if (cast.stage === "flight") return cast.since + FISH_FLIGHT + FISH_HAUL;
	return cast.since + (cast.snag ? FISH_SNAG_HAUL : FISH_HAUL);
}

/** Seconds for held arrows (eight ways) to glide the aim from one point to another. */
function glideTime(from, to) {
	const dx = Math.abs(to.x - from.x);
	const dy = Math.abs(to.y - from.y);
	return (Math.max(dx, dy) - Math.min(dx, dy) + Math.min(dx, dy) * Math.SQRT2) / FISH_AIM_SPEED;
}

const WAITS = [0, 0.2, 0.45, 0.8];
const NUDGES = [
	[0, 0],
	[10, 0],
	[-10, 0],
	[0, 10],
	[0, -10],
];

/**
 * A fisher's next cast: for each shoal (and a little either side of it), when
 * to cast and where, so the net comes down on it. `lead` aims at where the
 * shoal will be when the net lands; without it, at where it is when the net
 * is thrown. `glide` counts the time the arrows take to get there (a finger
 * takes none). The best is the most fish soonest.
 */
function plan(state, { lead = true, glide = true } = {}) {
	const need = FISH_QUOTA - state.caught;
	const ready = readyAt(state);
	const from = { x: state.aimX, y: state.aimY };
	let best = null;
	for (const shoal of state.shoals) {
		for (const wait of WAITS) {
			let castAt = Math.max(ready, state.t + wait);
			let aim = null;
			for (let i = 0; i < 3; i++) {
				const centre = shoalAt(shoal, lead ? castAt + FISH_FLIGHT : castAt);
				aim = clampAim(centre.x, centre.y);
				castAt = Math.max(ready, state.t + wait, state.t + (glide ? glideTime(from, aim) : 0));
			}
			const lands = castAt + FISH_FLIGHT;
			if (lands > FISH_SECONDS - 0.05) continue;
			for (const [nx, ny] of NUDGES) {
				const at = clampAim(aim.x + nx, aim.y + ny);
				// What the fisher expects: the true catch if he leads, or what is under the aim when he throws if he does not.
				const n = catchAt(state, at.x, at.y, lead ? lands : castAt);
				if (!n) continue;
				const value = Math.min(n, need) / (lands - state.t + (n >= need ? 0 : FISH_HAUL));
				if (!best || value > best.value + 1e-9) best = { value, castAt, x: at.x, y: at.y };
			}
		}
	}
	return best;
}

/** A small seeded generator for a player's own mistakes. */
function noiseFor(seed) {
	let noise = (seed * 2654435761) >>> 0 || 1;
	return () => {
		noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
		return noise / 4294967296;
	};
}

/**
 * Plays a round.
 * - `keys`: a skilled keyboard fisher, gliding the aim with the arrows to where the best shoal will be and casting on arrival.
 * - `touch`: a skilled fisher on a phone, tapping where the best shoal will be.
 * - `sloppy`: a keyboard fisher who aims at where a shoal is (no lead), with a shaky aim and slow to cast.
 * - `masher`: casts every step without moving the aim; `centre`: the same with the aim parked mid-reach, where the
 *   shoals' paths cross most; `scatter`: casts every step at random spots; `idle` does nothing.
 */
function play(seed, kind, { shake = 14, lag = 24 } = {}) {
	const state = newFish(seed);
	const events = [];
	const rnd = noiseFor(seed);
	let target = null;
	let wobble = { x: 0, y: 0 };
	let waited = 0;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const input = { move: { x: 0, y: 0 }, to: null, cast: false };
		if (kind === "masher") input.cast = true;
		else if (kind === "centre") {
			input.to = { x: 200, y: 191 };
			input.cast = true;
		}
		else if (kind === "scatter") {
			input.to = { x: 40 + rnd() * 320, y: 90 + rnd() * 260 };
			input.cast = true;
		} else if (kind === "touch") {
			// Re-judge every few steps; tap the moment the cast should go.
			if (tick % 5 === 0 || !target) target = plan(state, { glide: false });
			if (target && state.cast.stage === "ready" && target.castAt <= state.t + 1e-9) {
				input.to = { x: target.x, y: target.y };
				input.cast = true;
				target = null;
			}
		} else if (kind === "keys" || kind === "sloppy") {
			const sloppy = kind === "sloppy";
			// The sloppy fisher looks again less often.
			if (tick % (sloppy ? 8 : 4) === 0 || !target) {
				target = plan(state, { lead: !sloppy });
				if (sloppy && tick % 20 === 0) wobble = { x: (rnd() * 2 - 1) * shake, y: (rnd() * 2 - 1) * shake };
			}
			if (target) {
				const gx = target.x + wobble.x;
				const gy = target.y + wobble.y;
				const dx = gx - state.aimX;
				const dy = gy - state.aimY;
				input.move.x = Math.abs(dx) > STEP_GLIDE / 2 ? Math.sign(dx) : 0;
				input.move.y = Math.abs(dy) > STEP_GLIDE / 2 ? Math.sign(dy) : 0;
				const there = Math.hypot(dx, dy) < 6;
				if (state.cast.stage === "ready" && there && target.castAt <= state.t + FISH_STEP) {
					// The sloppy fisher hesitates before the throw.
					if (!sloppy || waited >= Math.floor(rnd() * lag)) {
						input.cast = true;
						target = null;
						waited = 0;
					} else waited++;
				}
			}
		}
		stepFish(state, input, events);
	}
	return { state, events, result: fishResult(state) };
}

/** Wins, golds and the fastest win of a player over the seeds. */
function tally(kind, salt, options) {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = play(seed * salt, kind, options);
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	return { won, gold };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, FISH_SECONDS);
	assert.ok(GAME.minSeconds <= FISH_MIN_SECONDS);
	assert.equal(FISH_STEP, 1 / 60);
	assert.ok(GAME.controls.length <= 2);
	assert.ok(GAME.controls.some((control) => control.keys.includes("Space")));
	assert.ok(GAME.controls.some((control) => control.keys.includes("←") && control.keys.includes("↑")));
});

test("the same seed and inputs play the same round", () => {
	assert.deepEqual(play(7, "keys").state, play(7, "keys").state);
	assert.deepEqual(play(11, "sloppy").state, play(11, "sloppy").state);
	assert.deepEqual(play(13, "scatter").state, play(13, "scatter").state);
});

test("the aim stays within the net's reach, and the arrows glide it at a steady pace", () => {
	for (const [x, y] of [
		[200, 400],
		[-50, 100],
		[450, 300],
		[200, -100],
		[FISH_BOAT_X, FISH_BOAT_Y],
	]) {
		const at = clampAim(x, y);
		const reach = Math.hypot(at.x - FISH_BOAT_X, FISH_BOAT_Y - at.y);
		assert.ok(reach >= FISH_NEAR - 1e-6 && reach <= FISH_FAR + 1e-6, `${x},${y} -> ${reach}`);
		assert.ok(Math.abs(Math.atan2(at.x - FISH_BOAT_X, FISH_BOAT_Y - at.y)) <= FISH_AIM_MAX + 1e-6);
	}
	const state = newFish(3);
	stepFish(state, { to: { x: 200, y: 191 } });
	assert.equal(state.aimY, 191);
	const x = state.aimX;
	for (let i = 0; i < 30; i++) stepFish(state, { move: { x: 1, y: 0 } });
	assert.ok(Math.abs(state.aimX - x - FISH_AIM_SPEED * 0.5) < 1e-6);
	// The aim moves while the net is out, but a cast then waits for the net.
	stepFish(state, { cast: true });
	assert.equal(state.cast.stage, "flight");
	const landX = state.cast.landX;
	stepFish(state, { move: { x: -1, y: 0 }, cast: true });
	assert.equal(state.cast.landX, landX);
	assert.equal(state.casts, 1);
	assert.ok(state.aimX < landX);
});

test("the flat-out fastest run is never sooner than the registry's minSeconds", () => {
	// Casting on the very step the net is ready: the quota's last cast lands no sooner than this.
	const state = newFish(1);
	const lands = [];
	for (let i = 0; i < 60 * 6; i++) {
		const events = [];
		stepFish(state, { cast: true }, events);
		if (events.some((event) => event.type === "land")) lands.push(state.t);
		if (state.phase !== "playing") break;
	}
	const last = lands[FISH_MIN_CASTS - 1];
	assert.ok(last !== undefined);
	assert.ok(Math.round(last * 10) / 10 >= GAME.minSeconds, `${last}`);
	assert.ok(last >= FISH_MIN_SECONDS - 1e-6, `${last}`);
});

test("a keyboard fisher who leads the shoals fills the net on every seed, mostly gold, never faster than the server allows", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, events } = play(seed * 7919, "keys");
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.count >= FISH_QUOTA);
		assert.equal(events.filter((event) => event.type === "won").length, 1);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	console.log(`keys: ${won}/${SEEDS} won, ${gold} gold`);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.75, `${gold} gold`);
});

test("a fisher on a phone, tapping where the shoal will be, wins nearly always", () => {
	const { won, gold } = tally("touch", 31);
	console.log(`touch: ${won}/${SEEDS} won, ${gold} gold`);
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.75, `${gold} gold`);
});

test("a sloppy fisher, aiming where the shoal is with a shaky hand and a slow throw, sometimes falls short and rarely earns gold", () => {
	const { won, gold } = tally("sloppy", 104729);
	console.log(`sloppy: ${won}/${SEEDS} won, ${gold} gold`);
	assert.ok(won < SEEDS * 0.85, `${won} won`);
	assert.ok(gold < SEEDS * 0.2, `${gold} gold`);
});

test("casting without aiming almost never fills the net; an idle boat never does", () => {
	let masher = 0;
	let centre = 0;
	let scatter = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		if (play(seed, "masher").result.won) masher++;
		if (play(seed, "centre").result.won) centre++;
		if (play(seed, "scatter").result.won) scatter++;
		const idle = play(seed, "idle");
		assert.equal(idle.result.won, false);
		assert.equal(idle.result.count, 0);
		assert.ok(Math.abs(idle.result.seconds - FISH_SECONDS) < 0.05);
	}
	console.log(`masher: ${masher}/${SEEDS} won, centre: ${centre}/${SEEDS} won, scatter: ${scatter}/${SEEDS} won`);
	assert.ok(masher < SEEDS * 0.1, `${masher} masher wins`);
	assert.ok(centre < SEEDS * 0.12, `${centre} centre wins`);
	assert.ok(scatter < SEEDS * 0.1, `${scatter} scatter wins`);
});

test("a cast takes real time: only a handful fit in a round", () => {
	const { state } = play(5, "masher");
	assert.ok(state.casts <= Math.ceil(FISH_SECONDS / (FISH_FLIGHT + FISH_HAUL)), `${state.casts} casts`);
});
