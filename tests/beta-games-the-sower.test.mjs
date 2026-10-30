/**
 * The Sower (LC-17908, docs/beta/games.md), Matthew 13:3-9, coverage
 * painting: the round replays exactly from a seed; a careful sower who
 * steers the hand over the good plots and lifts it over the rest wins on
 * nearly every field (on the keys and by touch), mostly an hundredfold; a
 * sloppy one sometimes fails and rarely earns gold; one who never lifts the
 * hand mostly runs the bag dry first; scattering everywhere or idling never
 * wins; and no round ends sooner than the bag can empty.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	SOWER_BAG_SECONDS,
	SOWER_CATCH,
	SOWER_CELL,
	SOWER_COLS,
	SOWER_FIELD_BOTTOM,
	SOWER_FIELD_TOP,
	SOWER_GOOD_MAX,
	SOWER_GOOD_MIN,
	SOWER_MIN_SECONDS,
	SOWER_ROWS,
	SOWER_SECONDS,
	SOWER_STEP,
	newSower,
	sowerCellCentre,
	sowerResult,
	sowerSprayCells,
	stepSower,
} from "../src/lib/beta/games/the-sower-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("the-sower");
const SEEDS = 200;
const IDLE = { dx: 0, dy: 0, target: null, sow: false };

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

/** How much of the spray at (x, y) falls on good ground, and how many of its good cells are still unsown. */
function underHand(state, x, y) {
	const cells = sowerSprayCells(x, y);
	let good = 0;
	let open = 0;
	for (const cell of cells) {
		if (state.ground[cell] !== "good") continue;
		good++;
		if (state.sownAt[cell] < 0) open++;
	}
	return { good: good / cells.length, open };
}

const inReach = (p) => p.x >= 20 && p.x <= 380 && p.y >= SOWER_FIELD_TOP + 20 && p.y <= SOWER_FIELD_BOTTOM - 20;

/**
 * A careful sower on the arrow keys: heads for the nearest spot where the
 * whole spray falls mostly on unsown good ground, and holds Space only while
 * it does.
 */
function carefulKeys(seed) {
	const state = newSower(seed);
	let target = -1;
	while (state.phase === "playing") {
		const aim = target >= 0 ? sowerCellCentre(target) : null;
		if (!aim || underHand(state, aim.x, aim.y).open === 0) {
			let best = Infinity;
			target = -1;
			for (let cell = 0; cell < state.ground.length; cell++) {
				const p = sowerCellCentre(cell);
				if (!inReach(p)) continue;
				const here = underHand(state, p.x, p.y);
				if (here.good < 0.7 || here.open === 0) continue;
				const cost = Math.hypot(p.x - state.hand.x, p.y - state.hand.y) - 4 * here.open;
				if (cost < best) {
					best = cost;
					target = cell;
				}
			}
		}
		const input = { ...IDLE };
		if (target >= 0) {
			const p = sowerCellCentre(target);
			input.dx = Math.abs(p.x - state.hand.x) > 2 ? Math.sign(p.x - state.hand.x) : 0;
			input.dy = Math.abs(p.y - state.hand.y) > 2 ? Math.sign(p.y - state.hand.y) : 0;
			const here = underHand(state, state.hand.x, state.hand.y);
			input.sow = here.good >= 0.7 && here.open > 0;
		}
		stepSower(state, input);
	}
	return { state, result: sowerResult(state) };
}

/** The good ground's plots (four-connected), the small scraps left out. */
function plots(state) {
	const seen = new Array(state.ground.length).fill(false);
	const found = [];
	for (let start = 0; start < state.ground.length; start++) {
		if (seen[start] || state.ground[start] !== "good") continue;
		const stack = [start];
		const cells = [];
		seen[start] = true;
		while (stack.length) {
			const cell = stack.pop();
			cells.push(cell);
			const c = cell % SOWER_COLS;
			const r = Math.floor(cell / SOWER_COLS);
			for (const [dc, dr] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			]) {
				const nc = c + dc;
				const nr = r + dr;
				const next = nr * SOWER_COLS + nc;
				if (nc < 0 || nr < 0 || nc >= SOWER_COLS || nr >= SOWER_ROWS || seen[next] || state.ground[next] !== "good") continue;
				seen[next] = true;
				stack.push(next);
			}
		}
		if (cells.length >= 10) found.push(cells);
	}
	return found;
}

/**
 * A painter by touch: strokes back and forth across each plot in turn, three
 * cells apart, the finger down along a stroke and lifted between plots. Its
 * finger lifts (and comes down) `lag` steps after the spray leaves (or
 * reaches) good ground, and its strokes wander up to `noise` units.
 */
function painter({ lag = 0, noise = 0, threshold = 0.6, keys = false } = {}) {
	return (seed) => {
		const r = rng(seed * 17 + 3);
		const state = newSower(seed);
		const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
		const left = plots(state);
		const route = [];
		let hx = state.hand.x;
		let hy = state.hand.y;
		while (left.length) {
			let pick = 0;
			let near = Infinity;
			left.forEach((cells, index) => {
				for (const cell of cells) {
					const p = sowerCellCentre(cell);
					const d = Math.hypot(p.x - hx, p.y - hy);
					if (d < near) {
						near = d;
						pick = index;
					}
				}
			});
			const cells = left.splice(pick, 1)[0];
			const rows = cells.map((cell) => Math.floor(cell / SOWER_COLS));
			const stroke = [];
			let forward = true;
			for (let band = Math.min(...rows) + 1; band <= Math.max(...rows); band += 3) {
				const cols = cells.filter((cell) => Math.abs(Math.floor(cell / SOWER_COLS) - band) <= 1).map((cell) => cell % SOWER_COLS);
				if (!cols.length) continue;
				const y = clamp(SOWER_FIELD_TOP + (band + 0.5) * SOWER_CELL + (r() - 0.5) * noise, SOWER_FIELD_TOP + 21, SOWER_FIELD_BOTTOM - 21);
				const a = clamp((Math.min(...cols) + 1) * SOWER_CELL, 21, 379);
				const b = clamp(Math.max(...cols) * SOWER_CELL, 21, 379);
				stroke.push(...(forward ? [{ x: a, y }, { x: b, y }] : [{ x: b, y }, { x: a, y }]));
				forward = !forward;
			}
			if (!stroke.length) continue;
			if (Math.hypot(stroke.at(-1).x - hx, stroke.at(-1).y - hy) < Math.hypot(stroke[0].x - hx, stroke[0].y - hy)) stroke.reverse();
			route.push(...stroke);
			hx = stroke.at(-1).x;
			hy = stroke.at(-1).y;
		}
		// The strokes as points a few units apart, the way a finger or a held arrow traces them.
		const points = [];
		let from = { x: state.hand.x, y: state.hand.y };
		for (const point of route) {
			const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / 5));
			for (let i = 1; i <= steps; i++) points.push({ x: from.x + ((point.x - from.x) * i) / steps, y: from.y + ((point.y - from.y) * i) / steps });
			from = point;
		}
		const goodAt = (p) => {
			const here = underHand(state, p.x, p.y);
			return here.good >= threshold && here.open > 0;
		};
		let next = 0;
		let down = false;
		let dry = 0;
		while (state.phase === "playing") {
			while (next < points.length && Math.hypot(points[next].x - state.hand.x, points[next].y - state.hand.y) < 3) next++;
			const point = points[next];
			// It notices `lag` steps late that the spray has left the good ground.
			dry = goodAt(state.hand) ? 0 : dry + 1;
			const input = { ...IDLE };
			if (keys) {
				if (point) {
					input.dx = Math.abs(point.x - state.hand.x) > 2 ? Math.sign(point.x - state.hand.x) : 0;
					input.dy = Math.abs(point.y - state.hand.y) > 2 ? Math.sign(point.y - state.hand.y) : 0;
				}
				input.sow = dry <= lag && (dry === 0 || state.sowing);
			} else if (down && (!state.caught || dry <= lag) && point) {
				input.target = point;
				input.sow = true;
			} else if (down) {
				down = false;
			} else {
				// The finger is up: put it down again where the good ground resumes along the strokes.
				while (next < points.length && !goodAt(points[next])) next++;
				if (next < points.length) {
					down = true;
					input.target = points[next];
					input.sow = true;
				}
			}
			stepSower(state, input);
		}
		return { state, result: sowerResult(state) };
	};
}

/** Sows all the time while steering for the good ground, never lifting the hand. */
function neverLifts(byTouch) {
	return (seed) => {
		const state = newSower(seed);
		let target = -1;
		while (state.phase === "playing") {
			const aim = target >= 0 ? sowerCellCentre(target) : null;
			if (!aim || underHand(state, aim.x, aim.y).open === 0) {
				let best = Infinity;
				target = -1;
				for (let cell = 0; cell < state.ground.length; cell++) {
					const p = sowerCellCentre(cell);
					if (!inReach(p)) continue;
					const here = underHand(state, p.x, p.y);
					if (here.open === 0) continue;
					const cost = Math.hypot(p.x - state.hand.x, p.y - state.hand.y) - 4 * here.open;
					if (cost < best) {
						best = cost;
						target = cell;
					}
				}
			}
			const p = target >= 0 ? sowerCellCentre(target) : state.hand;
			const input = byTouch
				? { ...IDLE, target: p, sow: true }
				: { ...IDLE, dx: Math.abs(p.x - state.hand.x) > 2 ? Math.sign(p.x - state.hand.x) : 0, dy: Math.abs(p.y - state.hand.y) > 2 ? Math.sign(p.y - state.hand.y) : 0, sow: true };
			stepSower(state, input);
		}
		return { state, result: sowerResult(state) };
	};
}

/** Scatters without looking: `kind` is "still" (Space held, hand still), "wander" (Space held, arrows at random), "sweep" (the whole field row by row) or "taps" (a finger put down anywhere at random). */
function scatterer(kind) {
	return (seed) => {
		const r = rng(seed);
		const state = newSower(seed);
		let dx = 1;
		let dy = 0;
		let point = null;
		let k = 0;
		while (state.phase === "playing") {
			k++;
			if (kind === "still") stepSower(state, { ...IDLE, sow: true });
			else if (kind === "wander") {
				if (k % 20 === 0) {
					dx = Math.floor(r() * 3) - 1;
					dy = Math.floor(r() * 3) - 1;
				}
				stepSower(state, { ...IDLE, dx, dy, sow: true });
			} else if (kind === "sweep") {
				const row = Math.floor(k / 120);
				stepSower(state, { ...IDLE, target: { x: row % 2 ? 20 : 380, y: SOWER_FIELD_TOP + 25 + ((row * 30) % 280) }, sow: true });
			} else {
				if (k % 30 === 0) point = r() < 0.8 ? { x: r() * 400, y: SOWER_FIELD_TOP + r() * (SOWER_FIELD_BOTTOM - SOWER_FIELD_TOP) } : null;
				stepSower(state, { ...IDLE, target: point, sow: !!point });
			}
		}
		return { state, result: sowerResult(state) };
	};
}

function idle(seed) {
	const state = newSower(seed);
	while (state.phase === "playing") stepSower(state, IDLE);
	return { state, result: sowerResult(state) };
}

function tally(play, seeds = SEEDS) {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= seeds; seed++) {
		const { result } = play(seed * 7919);
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	return { won, gold };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, SOWER_SECONDS);
	assert.ok(GAME.minSeconds <= SOWER_MIN_SECONDS);
	assert.equal(SOWER_MIN_SECONDS, SOWER_BAG_SECONDS);
	assert.equal(SOWER_STEP, 1 / 60);
});

test("the same seed and the same hand play the same round", () => {
	assert.deepEqual(carefulKeys(7).state, carefulKeys(7).state);
	assert.deepEqual(painter({ lag: 9, noise: 10 })(11).state, painter({ lag: 9, noise: 10 })(11).state);
	assert.deepEqual(scatterer("wander")(9).state, scatterer("wander")(9).state);
});

test("every field is a fair patchwork: good ground in range, the way side with its fowls, stones and thorns", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const state = newSower(seed * 7919);
		assert.ok(state.goodTotal >= SOWER_GOOD_MIN && state.goodTotal <= SOWER_GOOD_MAX, `seed ${seed}: ${state.goodTotal}`);
		assert.equal(state.ground.length, SOWER_COLS * SOWER_ROWS);
		for (const kind of ["wayside", "stony", "thorns", "good"]) assert.ok(state.ground.includes(kind), `seed ${seed}: ${kind}`);
		assert.ok(plots(state).length >= 3, `seed ${seed}: ${plots(state).length} plots`);
		assert.ok(state.fowls.length >= 3);
		for (const fowl of state.fowls) {
			const cell = Math.floor((fowl.y - SOWER_FIELD_TOP) / SOWER_CELL) * SOWER_COLS + Math.floor(fowl.x / SOWER_CELL);
			assert.equal(state.ground[cell], "wayside");
		}
	}
});

test("a careful sower on the keys wins on at least 95% of fields, mostly an hundredfold, and the server accepts the run", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = carefulKeys(seed * 7919);
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		if (!result.won) continue;
		won++;
		if (gradeFor(result.score) === "gold") gold++;
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.85, `${gold} gold`);
});

test("a careful painter by touch, lifting the finger between plots, wins on at least 95% of fields, mostly gold", () => {
	const { won, gold } = tally(painter());
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
	assert.ok(gold >= SEEDS * 0.6, `${gold} gold`);
});

test("a sloppy sower (a quarter second late to lift, strokes wandering) sometimes loses and never earns gold; a late keyboard one rarely does", () => {
	const touch = tally(painter({ lag: 15, noise: 10 }));
	assert.ok(touch.won < SEEDS && touch.won > SEEDS * 0.4, `${touch.won} won`);
	assert.equal(touch.gold, 0);
	const keys = tally(painter({ lag: 9, keys: true }));
	assert.ok(keys.won > SEEDS * 0.5, `${keys.won} won`);
	assert.ok(keys.gold < SEEDS * 0.1, `${keys.gold} gold`);
});

test("never lifting the hand runs the bag dry: on the keys it rarely wins, by touch it often loses, and never an hundredfold", () => {
	const keys = tally(neverLifts(false));
	assert.ok(keys.won < SEEDS * 0.2, `${keys.won} won`);
	assert.equal(keys.gold, 0);
	const touch = tally(neverLifts(true));
	assert.ok(touch.won < SEEDS * 0.75, `${touch.won} won`);
	assert.equal(touch.gold, 0);
});

test("scattering everywhere never wins, and an idle sower never wins", () => {
	for (const kind of ["still", "wander", "sweep", "taps"]) assert.equal(tally(scatterer(kind)).won, 0, kind);
	const { result } = idle(1);
	assert.equal(result.won, false);
	assert.equal(result.score, 0);
	assert.ok(Math.abs(result.seconds - SOWER_SECONDS) < 0.05);
});

test("no round ends before the bag can empty: sowing without a pause runs it dry at exactly the bag's seconds", () => {
	for (let seed = 1; seed <= 20; seed++) {
		const { result } = scatterer("still")(seed);
		assert.equal(result.seconds, SOWER_BAG_SECONDS);
	}
	const state = newSower(3);
	let steps = 0;
	while (state.phase === "playing") {
		stepSower(state, { ...IDLE, dx: 1, sow: steps % 2 === 0 });
		steps++;
	}
	assert.ok(state.endedAt >= SOWER_MIN_SECONDS - 1e-9);
});

test("a finger put down away from the hand carries the seed there before it sows", () => {
	const state = newSower(7919);
	const far = { x: 60, y: SOWER_FIELD_TOP + 60 };
	let steps = 0;
	while (!state.caught) {
		stepSower(state, { ...IDLE, target: far, sow: true });
		if (!state.caught) assert.equal(state.used, 0, "no seed spent on the way");
		steps++;
	}
	assert.ok(steps > 20, `${steps} steps`);
	assert.ok(Math.hypot(far.x - state.hand.x, far.y - state.hand.y) <= SOWER_CATCH);
	assert.equal(state.used, 1, "it sows from the step it arrives");
	stepSower(state, IDLE);
	assert.equal(state.caught, false, "lifting the finger lets go");
});

test("seed on the good ground springs up once it has enough; on the way side, the stones and the thorns it is wasted and meets its fate", () => {
	const state = newSower(7919);
	const find = (kind) => {
		for (let cell = 0; cell < state.ground.length; cell++) {
			const p = sowerCellCentre(cell);
			if (inReach(p) && sowerSprayCells(p.x, p.y).every((c) => state.ground[c] === kind)) return p;
		}
		return null;
	};
	const good = find("good");
	assert.ok(good);
	state.hand = { ...good };
	const events = [];
	for (let i = 0; i < 4; i++) stepSower(state, { ...IDLE, sow: true }, events);
	assert.equal(state.sownCount, sowerSprayCells(good.x, good.y).length);
	assert.equal(events.filter((event) => event.type === "sown").length, state.sownCount);
	assert.equal(state.wasted, 0);
	for (const kind of ["wayside", "stony", "thorns"]) {
		const spot = find(kind);
		if (!spot) continue;
		state.hand = { ...spot };
		const fates = [];
		const before = state.wasted;
		for (let i = 0; i < 2; i++) stepSower(state, { ...IDLE, sow: true }, fates);
		assert.ok(Math.abs(state.wasted - before - 2) < 1e-9, kind);
		assert.ok(fates.some((event) => event.type === "fate" && event.ground === kind), kind);
	}
});
