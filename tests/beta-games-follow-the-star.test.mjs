/**
 * Follow the Star (LC-17851, docs/beta/games.md): the night-sky way to play
 * Matthew 2:1-12. Its simulation replays exactly from a seed, a steady player
 * reaches the house with gold and never faster than the award allows, doing
 * nothing never gets there, a skill-less player rarely does and never with
 * gold, and a sloppy player (late, on keys, misjudging) still usually does:
 * slightly challenging, not cruel. Measured rates are printed with each test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	EAST_LENGTH,
	STAR_FULL_CREDIT,
	STAR_LENGTH,
	STAR_LOST_LIMIT,
	STAR_MIN_SECONDS,
	STAR_NO_CREDIT,
	STAR_STEP,
	STAR_TOP_SPEED,
	STAR_VIEW_HALF,
	journeyResult,
	keptCredit,
	newJourney,
	starOffset,
	stepJourney,
	wrapAngle,
} from "../src/lib/beta/games/follow-the-star-rules.ts";
import { gradeFor } from "../src/lib/beta/games/games-rules.ts";

const LIMIT = 60 * 300;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Plays one journey with `policy(state)` until it ends or five minutes pass. */
function play(seed, policy) {
	const state = newJourney(seed);
	const events = [];
	for (let tick = 0; state.phase !== "arrived" && state.phase !== "lost" && tick < LIMIT; tick++) stepJourney(state, policy(state), events);
	return { state, events, result: journeyResult(state) };
}

/** A small seeded random for the players' own mistakes. */
function wobble(seed) {
	let x = seed | 0;
	return () => {
		x = (Math.imul(x, 1103515245) + 12345) | 0;
		return ((x >>> 8) & 0xffff) / 0xffff;
	};
}

/** Where to steer: the star as last seen, or past the near edge of the ravine or rise ahead. */
function aim(view, memory, lookAhead, margin) {
	let target = memory;
	const next = view.obstacles.find((o) => o.outcome === null && o.s + o.depth / 2 > view.s && o.s - view.s < lookAhead);
	if (next) {
		const ahead = Math.max(0.6, next.s - next.depth / 2 - view.s);
		const predicted = view.lat + ahead * Math.tan(target);
		const reach = next.half + 0.7 + margin;
		if (Math.abs(predicted - next.lat) < reach) {
			const edge = predicted < next.lat ? next.lat - reach : next.lat + reach;
			target = Math.atan2(edge - view.lat, ahead);
		}
	}
	return target;
}

/** Keeps the star before them, holds the course under cloud, and goes around the ground early. */
function steady() {
	let memory = 0;
	return (state) => {
		if (state.phase === "jerusalem") return { steer: 0, go: true };
		if (!state.hidden) memory = state.bearing;
		const target = aim(state, memory, 16, 0.45);
		return { steer: clamp(wrapAngle(target - state.heading) * 12 - state.turnVel * 2.5, -1, 1), go: true };
	};
}

/**
 * A player who is late and loose: sees everything `delay` steps late, steers
 * on keys (full rein or none) and lets small errors ride (`slack` radians),
 * misjudges where the star is by up to `blur`, remembers it up to `memory`
 * wrong under cloud, and notices the ground only `lookAhead` units out.
 */
function sloppy(delay, seed, { slack = 0.06, blur = 0.06, memory: forget = 0.24, lookAhead = 9, margin = 0.1 } = {}) {
	const seen = [];
	const rand = wobble(seed);
	let memory = 0;
	let misjudge = 0;
	let wasHidden = false;
	return (state) => {
		if (state.phase === "jerusalem") {
			seen.length = 0;
			return { steer: 0, go: true };
		}
		seen.push({ heading: state.heading, turnVel: state.turnVel, bearing: state.bearing, hidden: state.hidden, s: state.s, lat: state.lat, obstacles: state.obstacles.map((o) => ({ ...o })) });
		const then = seen[Math.max(0, seen.length - 1 - delay)];
		if (then.hidden && !wasHidden) misjudge = (rand() - 0.5) * forget;
		wasHidden = then.hidden;
		if (!then.hidden) memory = then.bearing + (rand() - 0.5) * blur;
		const target = aim(then, then.hidden ? memory + misjudge : memory, lookAhead, margin);
		const want = wrapAngle(target - then.heading) - then.turnVel * 0.24;
		return { steer: Math.abs(want) < slack ? 0 : Math.sign(want), go: true };
	};
}

const NOTHING = { steer: 0, go: true };

test("the same seed and inputs play the same journey", () => {
	const a = play(42, steady());
	const b = play(42, steady());
	assert.deepEqual(a.state, b.state);
	assert.deepEqual(a.events, b.events);
	const c = play(42, sloppy(18, 7));
	const d = play(42, sloppy(18, 7));
	assert.deepEqual(c.state, d.state);
});

test("a steady player reaches the house on every seed with gold, never faster than the award allows", () => {
	const scores = [];
	for (let seed = 1; seed <= 120; seed++) {
		const { state, events, result } = play(seed * 7919, steady());
		assert.equal(state.phase, "arrived", `seed ${seed}`);
		assert.ok(result, `seed ${seed}: a finished journey has a result`);
		assert.ok(state.t >= STAR_MIN_SECONDS, `seed ${seed}: ${state.t}s is faster than the game allows`);
		assert.ok(result.seconds >= STAR_MIN_SECONDS && result.seconds <= 3600);
		assert.equal(gradeFor(result.faithKept), "gold", `seed ${seed}: a clean journey earns gold (${result.faithKept})`);
		assert.ok(result.swellsCleared >= 6, `seed ${seed}: the way has ravines and rises to go around (${result.swellsCleared})`);
		assert.ok(Number.isInteger(result.faithKept) && result.faithKept <= 100);
		assert.equal(events.filter((event) => event.type === "arrived").length, 1);
		assert.equal(events.filter((event) => event.type === "jerusalem").length, 1);
		assert.ok(events.some((event) => event.type === "clouded"), `seed ${seed}: a cloud hides the star at least once`);
		assert.ok(events.some((event) => event.type === "stood"), `seed ${seed}: the star comes to stand over the house`);
		scores.push(result.faithKept);
	}
	console.log(`steady: 120/120 arrived with gold, kept to the star ${Math.min(...scores)}-${Math.max(...scores)}%`);
});

test("doing nothing never reaches the house: the wind turns the company away and it is lost", () => {
	for (let seed = 1; seed <= 120; seed++) {
		const { state, events, result } = play(seed * 31, () => NOTHING);
		assert.notEqual(state.phase, "arrived", `seed ${seed}`);
		assert.equal(result, null);
		assert.equal(state.phase, "lost", `seed ${seed}: left to itself the company is lost in the night`);
		assert.ok(events.some((event) => event.type === "astray"));
	}
	console.log("nothing: 0/120 arrived, 120/120 lost");
});

test("never departing Jerusalem never finishes", () => {
	const { state } = play(9, (s) => (s.phase === "jerusalem" ? { steer: 0, go: false } : steady()(s)));
	assert.equal(state.phase, "jerusalem");
	assert.equal(journeyResult(state), null);
});

test("skill-less play rarely reaches the house and never with gold", () => {
	let randomWins = 0;
	let edgeWins = 0;
	let edgeBest = 0;
	for (let seed = 1; seed <= 120; seed++) {
		// Reins pulled at random, a new choice every few moments.
		const rand = wobble(seed);
		let steer = 0;
		let n = 0;
		const random = play(seed * 131, () => {
			if (n++ % 50 === 0) steer = Math.floor(rand() * 3) - 1;
			return { steer, go: true };
		});
		if (random.result) {
			randomWins += 1;
			assert.notEqual(gradeFor(random.result.faithKept), "gold", `seed ${seed}: gold at random`);
		}
		// Turns for the star only once it is nearly out of view, and never minds the ground.
		const edge = play(seed * 131, (state) => {
			const off = starOffset(state);
			if (state.phase === "jerusalem" || state.hidden || Math.abs(off) < STAR_VIEW_HALF * 0.85) return NOTHING;
			return { steer: Math.sign(off), go: true };
		});
		if (edge.result) {
			edgeWins += 1;
			edgeBest = Math.max(edgeBest, edge.result.faithKept);
			assert.notEqual(gradeFor(edge.result.faithKept), "gold", `seed ${seed}: gold by only catching the star at the edge`);
		}
	}
	console.log(`random reins: ${randomWins}/120 arrived; only catching the star at the edge: ${edgeWins}/120 arrived, best ${edgeBest}%`);
	assert.ok(randomWins <= 6, `${randomWins} of 120 random journeys arrived`);
	assert.ok(edgeWins <= 72, `${edgeWins} of 120 edge-catching journeys arrived`);
});

/** Plays 120 journeys with `make(seed)` and returns how many arrived, how many with gold, and the scores. */
function measure(make) {
	let wins = 0;
	let gold = 0;
	const scores = [];
	for (let seed = 1; seed <= 120; seed++) {
		const { result } = play(seed * 104729, make(seed));
		if (!result) continue;
		wins += 1;
		scores.push(result.faithKept);
		if (gradeFor(result.faithKept) === "gold") gold += 1;
		assert.ok(result.seconds >= STAR_MIN_SECONDS);
	}
	return { wins, gold, low: Math.min(...scores), high: Math.max(...scores) };
}

test("a late player still usually arrives, and a loose one usually does too: slightly challenging, not cruel", () => {
	const late = measure((seed) => sloppy(15, seed));
	console.log(`a quarter second late on keys: ${late.wins}/120 arrived, ${late.gold} with gold, kept ${late.low}-${late.high}%`);
	assert.ok(late.wins >= 112, `only ${late.wins} of 120 late journeys arrived`);
	const loose = measure((seed) => sloppy(20, seed, { slack: 0.12, blur: 0.12, memory: 0.5, lookAhead: 7, margin: 0 }));
	console.log(`a third of a second late and loose: ${loose.wins}/120 arrived, ${loose.gold} with gold, kept ${loose.low}-${loose.high}%`);
	assert.ok(loose.wins >= 90, `only ${loose.wins} of 120 loose journeys arrived`);
	assert.ok(loose.gold <= loose.wins / 2, `${loose.gold} of ${loose.wins} loose journeys earned gold`);
});

test("rough ground slows the company, turns it aside and earns nothing; going around it is counted", () => {
	const state = newJourney(5);
	state.obstacles.push({ id: 99, kind: "rise", s: state.s + 0.9, lat: state.lat, half: 1.4, depth: 2.4, outcome: null });
	const events = [];
	for (let i = 0; i < 30; i++) stepJourney(state, NOTHING, events);
	assert.ok(events.some((event) => event.type === "struck" && event.id === 99));
	assert.equal(state.struck, 1);
	assert.ok(state.rough > 0);
	assert.notEqual(state.lat, 0, "the ground turns them along its edge");

	const clear = newJourney(5);
	clear.obstacles.push({ id: 7, kind: "ravine", s: clear.s + 0.5, lat: clear.lat + 6, half: 2, depth: 1.6, outcome: null });
	const passed = [];
	for (let i = 0; i < 60; i++) stepJourney(clear, NOTHING, passed);
	assert.ok(passed.some((event) => event.type === "passed" && event.id === 7));
	assert.equal(clear.passed, 1);
});

test("under cloud the star waits where it was last seen, and out of view too long the company is lost", () => {
	const state = newJourney(11);
	const steadyPlayer = steady();
	while (state.phase !== "star") stepJourney(state, steadyPlayer(state));
	while (!state.hidden) stepJourney(state, steadyPlayer(state));
	const seen = state.bearing;
	const clock = state.starClock;
	for (let i = 0; i < 30 && state.hidden; i++) stepJourney(state, steadyPlayer(state));
	assert.equal(state.starClock, clock);
	assert.ok(Math.abs(state.bearing - seen) < 0.01, "the star is where it was");

	const lost = newJourney(11);
	while (lost.phase !== "star") stepJourney(lost, steadyPlayer(lost));
	const events = [];
	let steps = 0;
	while (lost.phase === "star" && steps < 60 * 30) {
		stepJourney(lost, { steer: Math.abs(starOffset(lost)) < 1.2 ? -1 : 0, go: true }, events);
		steps += 1;
	}
	assert.equal(lost.phase, "lost");
	assert.equal(journeyResult(lost), null);
	assert.ok(lost.lostFor >= STAR_LOST_LIMIT);
	assert.deepEqual(events.filter((event) => event.type === "lost"), [{ type: "lost" }]);
});

test("the score is how closely the company kept to the star", () => {
	assert.equal(keptCredit(0), 1);
	assert.equal(keptCredit(STAR_FULL_CREDIT), 1);
	assert.equal(keptCredit(-STAR_FULL_CREDIT), 1);
	assert.equal(keptCredit(STAR_NO_CREDIT), 0);
	assert.equal(keptCredit(STAR_VIEW_HALF), 0, "a star at the edge of the view earns nothing");
	assert.ok(keptCredit(0.15) > 0 && keptCredit(0.15) < 1);
	assert.ok(keptCredit(0.1) > keptCredit(0.2));
});

test("the soonest finish is both legs at the top pace", () => {
	assert.equal(STAR_MIN_SECONDS, Math.floor((EAST_LENGTH + STAR_LENGTH) / STAR_TOP_SPEED));
	assert.ok(STAR_MIN_SECONDS >= 30 && STAR_MIN_SECONDS <= 90, "a won game takes 30-90 seconds of play");
	assert.ok(STAR_STEP > 0 && STAR_STEP < 0.05);
});
