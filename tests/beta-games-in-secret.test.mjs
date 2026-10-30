/**
 * In Secret (LC-17908, docs/beta/games.md), Matthew 6:1-6: the round replays
 * exactly from a seed; a disciple who freezes on every warning and walks
 * when the street is clear reaches his closet on every seed, unseen, and
 * never faster than the server allows; one who never walks, keeps walking or
 * walks at random does not; a careless one is sometimes seen and rarely
 * keeps it all in secret.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	SECRET_DOOR_X,
	SECRET_MIN_SECONDS,
	SECRET_SECONDS,
	SECRET_SPEED,
	SECRET_START_X,
	SECRET_STEP,
	newSecret,
	secretAlert,
	secretResult,
	stepSecret,
} from "../src/lib/beta/games/in-secret-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("in-secret");
const SEEDS = 200;

function dice(seed) {
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
 * A player who watches the street as drawn: he freezes `reaction` seconds
 * (plus up to `jitter` more) after a warning shows, or at once when someone
 * already looks, and walks again `resume` seconds after the street is clear.
 * `impatience` is the chance a second that he gives up waiting during a look.
 */
function watcher(seed, { reaction = 0.25, resume = 0.15, jitter = 0, impatience = 0 } = {}) {
	const state = newSecret(seed);
	const events = [];
	const roll = dice(seed * 31 + 7);
	let frozen = false;
	let warnSeen = null;
	let clearSince = null;
	let react = reaction;
	let rush = false;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		const alert = secretAlert(state);
		if (alert === "clear") {
			warnSeen = null;
			if (clearSince === null) {
				clearSince = state.t;
				rush = false;
			}
			if (frozen && state.t - clearSince >= resume) frozen = false;
		} else {
			clearSince = null;
			if (alert === "look") frozen = true;
			else {
				if (warnSeen === null) {
					warnSeen = state.t;
					react = reaction + roll() * jitter;
				}
				if (state.t - warnSeen >= react) frozen = true;
			}
			if (alert === "look" && impatience && !rush && roll() < impatience / 60) rush = true;
		}
		stepSecret(state, { walk: !frozen || rush }, events);
	}
	return { state, events, result: secretResult(state) };
}

function scripted(seed, walkAt) {
	const state = newSecret(seed);
	const events = [];
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepSecret(state, { walk: walkAt(state, tick) }, events);
	return { state, events, result: secretResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, SECRET_SECONDS);
	assert.ok(GAME.minSeconds <= SECRET_MIN_SECONDS);
	assert.equal(SECRET_STEP, 1 / 60);
	assert.equal(SECRET_MIN_SECONDS, Math.floor(((SECRET_DOOR_X - SECRET_START_X) / SECRET_SPEED) * 10) / 10);
});

test("the same seed and the same walking play the same round", () => {
	assert.deepEqual(watcher(42).state, watcher(42).state);
	assert.deepEqual(watcher(42, { jitter: 0.5, impatience: 0.8 }).state, watcher(42, { jitter: 0.5, impatience: 0.8 }).state);
});

test("freezing on every warning reaches the closet on every seed, unseen, gold, and never faster than the server allows", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state, events } = watcher(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}`);
		assert.equal(state.strikes, 0, `seed ${seed}`);
		assert.equal(state.alms, true);
		assert.equal(gradeFor(result.score), "gold", `seed ${seed}: ${result.score}`);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(result.seconds <= SECRET_SECONDS - 1, `seed ${seed}: ${result.seconds}s leaves under a second spare`);
		assert.equal(events.filter((event) => event.type === "alms").length, 1);
		assert.equal(events.filter((event) => event.type === "shut").length, 1);
		assert.ok(result.count >= 2, `seed ${seed}: ${result.count} looks stood through`);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
});

test("a slower watcher (a third of a second to freeze) still wins nearly every seed", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (watcher(seed * 104729, { reaction: 0.34, resume: 0.25 }).result.won) won++;
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
});

test("standing still never wins; walking on regardless, or at random, never does either", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = scripted(seed, () => false);
		assert.equal(idle.result.won, false);
		assert.equal(idle.state.strikes, 0);
		assert.ok(Math.abs(idle.result.seconds - SECRET_SECONDS) < 0.05);
		const onward = scripted(seed, () => true);
		assert.equal(onward.result.won, false, `seed ${seed}: walked straight through`);
		assert.ok(onward.events.some((event) => event.type === "reward"));
		const roll = dice(seed + 99);
		let walk = false;
		let next = 0;
		const random = scripted(seed, (state) => {
			if (state.t >= next) {
				walk = roll() < 0.6;
				next = state.t + 0.1 + roll() * 0.3;
			}
			return walk;
		});
		assert.equal(random.result.won, false, `seed ${seed}: random walking won`);
	}
});

test("a careless watcher (late to freeze, impatient) is sometimes seen and rarely keeps it in secret", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = watcher(seed * 7919, { reaction: 0.3, resume: 0.05, jitter: 0.5, impatience: 0.8 });
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(won < SEEDS * 0.6, `${won} won`);
	assert.ok(won > 0, "never won");
	assert.ok(gold < SEEDS * 0.1, `${gold} gold`);
});

test("being seen once costs the gold; a stumble steps him back", () => {
	for (let seed = 1; seed <= 50; seed++) {
		const state = newSecret(seed);
		const events = [];
		const look = state.looks[0];
		while (state.t < look.from + 0.05) stepSecret(state, { walk: state.t < look.warn || state.t >= look.from }, events);
		assert.equal(state.strikes, 1);
		assert.ok(events.some((event) => event.type === "seen"));
	}
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state } = watcher(seed * 7919, { reaction: 0.3, resume: 0.05, jitter: 0.5, impatience: 0.8 });
		if (result.won && state.strikes > 0) assert.notEqual(gradeFor(result.score), "gold");
	}
});

test("every round has feints, quick looks or two at once, and the first look comes early", () => {
	let feints = 0;
	let doubles = 0;
	for (let seed = 1; seed <= 100; seed++) {
		const { looks } = newSecret(seed);
		assert.ok(looks[0].warn < 1.7 && !looks[0].feint);
		assert.ok(looks.length >= 5);
		feints += looks.filter((look) => look.feint).length;
		for (let i = 1; i < looks.length; i++) if (looks[i].warn < looks[i - 1].to) doubles++;
	}
	assert.ok(feints > 50 && doubles > 50, `${feints} feints, ${doubles} doubles`);
});
