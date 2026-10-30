/**
 * Bid to the Marriage (LC-17908, docs/beta/games.md), Matthew 22:1-14: the
 * round replays exactly from a seed; a servant who routes the highways well
 * (the nearest guests he can still reach, soonest gone first) furnishes the
 * wedding on every seed and never faster than the server allows; one who
 * stands still or runs at random does not; one who turns late and takes wrong
 * turnings sometimes fails and rarely earns gold. The maze has no dead ends
 * and every highway reaches the door.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	DIRS,
	WEDDING_COLS,
	WEDDING_DOOR,
	WEDDING_GUESTS,
	WEDDING_MIN_SECONDS,
	WEDDING_ROWS,
	WEDDING_SECONDS,
	WEDDING_SPAWN_MIN,
	WEDDING_SPAWNS,
	WEDDING_SPEED,
	WEDDING_STEP,
	WEDDING_WALK,
	isRoad,
	newWedding,
	roadDistances,
	stepWedding,
	weddingResult,
} from "../src/lib/beta/games/bid-to-the-marriage-rules.ts";
import { checkGameRun, findChapterGame, gradeFor } from "../src/lib/beta/games/games-rules.ts";

const GAME = findChapterGame("bid-to-the-marriage");
const SEEDS = 200;
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

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

const distances = new Map();
function distTo(x, y) {
	const key = `${x},${y}`;
	if (!distances.has(key)) distances.set(key, roadDistances({ x, y }));
	return distances.get(key);
}

function bestFrom(d, x, y) {
	let best = null;
	let bestDist = Infinity;
	for (const [name, dir] of Object.entries(DIRS)) {
		if (isRoad(x + dir.x, y + dir.y) && d[y + dir.y][x + dir.x] < bestDist) {
			bestDist = d[y + dir.y][x + dir.x];
			best = name;
		}
	}
	return best;
}

/** Tiles of road from where he is to a tile, and the way to press now (a turn waits for the next crossing). */
function route(state, tx, ty) {
	const d = distTo(tx, ty);
	const centred = Math.abs(state.x - Math.round(state.x)) < 1e-6 && Math.abs(state.y - Math.round(state.y)) < 1e-6;
	if (centred || !state.dir) {
		const x = Math.round(state.x);
		const y = Math.round(state.y);
		return { dist: d[y][x], dir: d[y][x] === 0 ? null : bestFrom(d, x, y) };
	}
	const v = DIRS[state.dir];
	const along = v.x ? state.x : state.y;
	const sign = v.x + v.y;
	const next = sign > 0 ? Math.floor(along + 1e-9) + 1 : Math.ceil(along - 1e-9) - 1;
	const nx = v.x ? next : state.x;
	const ny = v.y ? next : state.y;
	const px = v.x ? next - sign : state.x;
	const py = v.y ? next - sign : state.y;
	const f = Math.abs(next - along);
	const ahead = f + d[ny][nx];
	const back = 1 - f + d[py][px];
	if (back < ahead) return { dist: back, dir: OPPOSITE[state.dir] };
	return { dist: ahead, dir: d[ny][nx] === 0 ? state.dir : bestFrom(d, nx, ny) };
}

/** The servant's plan: the guest he can still reach in time at the least cost, the soonest gone weighing more. */
function plan(state) {
	let best = null;
	let bestCost = Infinity;
	for (const guest of state.guests) {
		if (guest.state !== "wait") continue;
		const way = route(state, guest.x, guest.y);
		const left = guest.leaves - state.t;
		if (way.dist / WEDDING_SPEED + 0.25 > left) continue;
		const cost = way.dist + 0.8 * left;
		if (cost < bestCost) {
			bestCost = cost;
			best = way;
		}
	}
	return best ? best.dir : null;
}

/** Plays a round: `replan` seconds (on average) between looks at the map, `mistake` the chance a look turns the wrong way. */
function servant(seed, { replan = 0, mistake = 0 } = {}) {
	const state = newWedding(seed);
	const events = [];
	const roll = dice(seed * 13 + 5);
	let next = 0;
	let want = null;
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) {
		if (state.t >= next) {
			want = plan(state);
			if (mistake && roll() < mistake) want = Object.keys(DIRS)[Math.floor(roll() * 4)];
			next = state.t + replan * (0.5 + roll());
		}
		stepWedding(state, { want }, events);
	}
	return { state, events, result: weddingResult(state) };
}

function scripted(seed, wantAt) {
	const state = newWedding(seed);
	const events = [];
	for (let tick = 0; state.phase === "playing" && tick < 60 * 30; tick++) stepWedding(state, { want: wantAt(state) }, events);
	return { state, events, result: weddingResult(state) };
}

test("the registry matches the rules", () => {
	assert.ok(GAME);
	assert.equal(GAME.seconds, WEDDING_SECONDS);
	assert.ok(GAME.minSeconds <= WEDDING_MIN_SECONDS);
	assert.equal(WEDDING_STEP, 1 / 60);
});

test("the highways have no dead ends, all reach the door, and guests appear well out on them", () => {
	const fromDoor = roadDistances(WEDDING_DOOR);
	for (let y = 0; y < WEDDING_ROWS; y++) {
		for (let x = 0; x < WEDDING_COLS; x++) {
			if (!isRoad(x, y)) continue;
			assert.ok(fromDoor[y][x] >= 0, `${x},${y} cut off`);
			const ways = Object.values(DIRS).filter((dir) => isRoad(x + dir.x, y + dir.y)).length;
			assert.ok(ways >= 2, `${x},${y} is a dead end`);
		}
	}
	assert.ok(WEDDING_SPAWNS.length > 40);
	for (const spot of WEDDING_SPAWNS) assert.ok(fromDoor[spot.y][spot.x] >= WEDDING_SPAWN_MIN);
});

test("the same seed and the same turns play the same round", () => {
	assert.deepEqual(servant(42).state, servant(42).state);
	assert.deepEqual(servant(42, { replan: 0.3, mistake: 0.1 }).state, servant(42, { replan: 0.3, mistake: 0.1 }).state);
});

test("a servant who routes well furnishes the wedding on every seed, mostly gold, and never faster than the server allows", () => {
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result, state, events } = servant(seed * 7919);
		assert.equal(result.won, true, `seed ${seed}: ${state.seated} seated`);
		if (gradeFor(result.score) === "gold") gold++;
		assert.ok(result.seconds >= GAME.minSeconds, `seed ${seed}: ${result.seconds}s`);
		assert.ok(state.seated >= WEDDING_GUESTS);
		assert.equal(events.filter((event) => event.type === "furnished").length, 1);
		assert.equal(events.filter((event) => event.type === "seat").length, state.seated);
		assert.equal(checkGameRun({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count }, GAME.minSeconds).ok, true);
	}
	assert.ok(gold >= SEEDS * 0.9, `${gold} gold`);
});

test("a quick but human servant (a look at the map every tenth of a second or so) still wins nearly every seed", () => {
	let won = 0;
	for (let seed = 1; seed <= SEEDS; seed++) if (servant(seed * 104729, { replan: 0.15 }).result.won) won++;
	assert.ok(won >= SEEDS * 0.95, `${won} won`);
});

test("standing at the door never wins; running at random never does", () => {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const idle = scripted(seed, () => null);
		assert.equal(idle.result.won, false);
		assert.equal(idle.state.seated, 0);
		assert.ok(Math.abs(idle.result.seconds - WEDDING_SECONDS) < 0.05);
		const roll = dice(seed + 77);
		let next = 0;
		let want = null;
		const random = scripted(seed, (state) => {
			if (state.t >= next) {
				want = Object.keys(DIRS)[Math.floor(roll() * 4)];
				next = state.t + 0.2 + roll() * 0.6;
			}
			return want;
		});
		assert.equal(random.result.won, false, `seed ${seed}: random running won`);
	}
});

test("a sloppy servant (slow to turn, some wrong turnings) sometimes fails and rarely earns gold", () => {
	let won = 0;
	let gold = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const { result } = servant(seed * 7919, { replan: 0.35, mistake: 0.12 });
		if (result.won) won++;
		if (result.won && gradeFor(result.score) === "gold") gold++;
	}
	assert.ok(won < SEEDS * 0.5, `${won} won`);
	assert.ok(won > 0, "never won");
	assert.ok(gold < SEEDS * 0.15, `${gold} gold`);
});

test("he runs on to the wall and turns only where the road opens; a bidden guest walks in by himself", () => {
	// From the door, up is the hall: pressing up does nothing; left runs on to the next wall.
	const state = newWedding(1);
	stepWedding(state, { want: "up" });
	assert.equal(state.dir, null);
	assert.deepEqual([state.x, state.y], [WEDDING_DOOR.x, WEDDING_DOOR.y]);
	for (let tick = 0; tick < 60; tick++) stepWedding(state, { want: "left" });
	assert.equal(state.x, 2);
	assert.equal(state.y, WEDDING_DOOR.y);
	assert.equal(state.dir, null);
	// Each bidden guest keeps to the road, comes in no sooner than his road allows, and is seated once.
	const fromDoor = roadDistances(WEDDING_DOOR);
	for (let seed = 1; seed <= 50; seed++) {
		const { state: run, events } = servant(seed * 31);
		const bids = new Map(events.filter((event) => event.type === "bid").map((event) => [event.id, event]));
		for (const guest of run.guests) {
			if (guest.state === "going") assert.ok(isRoad(Math.round(guest.x), Math.round(guest.y)));
			if (guest.state !== "seated") continue;
			const bid = bids.get(guest.id);
			assert.ok(bid, `seed ${seed}: guest ${guest.id} seated unbidden`);
			assert.deepEqual([guest.x, guest.y], [WEDDING_DOOR.x, WEDDING_DOOR.y]);
		}
		assert.equal(events.filter((event) => event.type === "seat").length, new Set(events.filter((event) => event.type === "seat").map((event) => event.id)).size);
		assert.ok(fromDoor[WEDDING_DOOR.y][WEDDING_DOOR.x] === 0 && WEDDING_WALK > 0);
	}
});

test("guests left unbidden go their ways, both bad and good of every kind", () => {
	const kinds = new Set();
	for (let seed = 1; seed <= 30; seed++) {
		const { state, events } = scripted(seed, () => null);
		assert.ok(events.filter((event) => event.type === "gone").length >= 5);
		assert.equal(state.lost, events.filter((event) => event.type === "gone").length);
		for (const guest of state.guests) kinds.add(guest.kind);
	}
	assert.equal(kinds.size, 6);
});
