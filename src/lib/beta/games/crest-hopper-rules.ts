/**
 * Crest Hopper (LC-17851, docs/beta/games.md), the arcade way to play
 * Matthew 14:22-33. This is the whole simulation: the page draws it and feeds
 * it input, and the tests play it tick by tick. Pure on purpose (no imports,
 * no DOM, no clock, its own seeded random), so a seed and a list of inputs
 * always play the same run.
 *
 * Seen from above, Peter comes down out of the ship at the bottom of the sea
 * and hops toward Jesus, who waits in his light at the top. Every row of the
 * sea between is a line of swells rolling across, crests and troughs. Peter
 * hops a lane at a time (up, down, left or right) and rides the crest he lands
 * on; a trough under his feet is a slip. Gusts of the boisterous wind are
 * shown a moment before they shove him one lane downwind. A slip costs faith
 * and steady hopping wins it back; at no faith he begins to sink, and crying
 * "Lord, save me" brings the rescue of verse 31. Reaching Jesus' light
 * finishes the run. The run's lowest faith grades the award.
 */

/** The simulation runs in fixed steps; the page accumulates frame time into them. */
export const HOPPER_STEP = 1 / 60;
/** Lanes across the sea. Peter starts in the middle one. */
export const HOPPER_COLS = 9;
/** Rows of swells between the ship (row 0) and Jesus' light. */
export const HOPPER_SEA_ROWS = 40;
/** The row of Jesus' light: landing on it finishes the run. */
export const HOPPER_LIGHT_ROW = HOPPER_SEA_ROWS + 1;
/** Rows of one long, calm swell to catch his breath on: crest all the way across, and still. */
export const HOPPER_REST_ROWS: readonly number[] = [13, 27];
/** The lanes the ship's deck covers (row 0). */
export const HOPPER_SHIP_LANES: readonly [number, number] = [2, 6];
/** Seconds in the air on a hop, and on the ground after landing before the next one. */
export const HOPPER_HOP_AIR = 0.2;
export const HOPPER_SETTLE = 0.05;
/** Seconds before the first hop: "when Peter was come down out of the ship" (v29). */
export const HOPPER_START = 1.2;
/** How long a gust is shown before it shoves. */
export const HOPPER_GUST_WARN = 1.15;
/** Cells in one row's repeating line of crests and troughs (wider than the view, so it never looks tiled). */
export const HOPPER_PATTERN = 12;
/** Faith at the start, and what a slip costs. */
export const HOPPER_START_FAITH = 100;
export const HOPPER_SLIP_FAITH = 24;

const HOP_FAITH = 3; // each clean hop toward Jesus wins this much back
const SHOVE_AIR = 0.16;
const GRACE = 0.2; // a row hop landing this close to a crest's edge is nudged onto it
const STUN = 0.8; // seconds floundering in the trough after a slip
const GUARD = 0.45; // seconds safe after climbing back onto a crest
const SHOVE_WINDOW = 0.6; // a gust that finds him in the air shoves him when he lands, if soon enough
const COMBO_WINDOW = 1.3; // hops toward Jesus this close together build the combo
const COMBO_MAX = 9;
/** How far past the outer lanes' centres he can stand before the edge of the sea stops him. */
export const HOPPER_EDGE = 0.4;

export type HopDir = "up" | "down" | "left" | "right";
export type HopperPhase = "playing" | "sinking" | "rescued" | "arrived";
export type HopperRowKind = "ship" | "sea" | "rest" | "light";

export interface HopperRow {
	kind: HopperRowKind;
	/** -1 rolls left, 1 rolls right. */
	dir: -1 | 1;
	/** Cells a second. */
	speed: number;
	/** 1 a crest, 0 a trough; cell k of the row sits at lane `k + offset`. */
	pattern: number[];
	offset: number;
}

export interface HopperHop {
	kind: "row" | "side" | "shove";
	fromRow: number;
	toRow: number;
	fromX: number;
	/** A row hop lands on this lane; a side hop or a shove on this cell of the row's pattern. */
	target: number;
}

export interface HopperGust {
	dir: -1 | 1;
	/** When it shoves. */
	at: number;
}

export interface HopperState {
	phase: HopperPhase;
	/** Seconds since the run began. */
	t: number;
	/** The row he is on (or leaving, in the air). */
	row: number;
	/** His lane, as a position across the sea (0 is the leftmost lane's centre). */
	x: number;
	/** Seconds left in the air, 0 when he is on his feet. */
	air: number;
	hop: HopperHop | null;
	settle: number;
	/** Seconds left floundering after a slip. */
	stun: number;
	guard: number;
	/** The latest hop pressed and not yet made (pressed in the air, it is made on landing). */
	queued: HopDir | null;
	faith: number;
	/** The lowest faith of this run, which grades the award. */
	minFaith: number;
	score: number;
	combo: number;
	lastForwardAt: number;
	cleanHops: number;
	slips: number;
	/** The furthest row reached. */
	maxRow: number;
	gust: HopperGust | null;
	nextGustAt: number;
	shove: { dir: -1 | 1; until: number } | null;
	rows: HopperRow[];
	/** How far under he has gone once sinking, 0-1. */
	sink: number;
	/** Seconds since the run ended (sinking, rescued or arrived), for the scenes. */
	ended: number;
	seed: number;
}

export interface HopperInput {
	/** The hop pressed on this step, if any. */
	hop: HopDir | null;
	/** True on the step "Lord, save me" was pressed. */
	cry: boolean;
}

export type HopperEvent =
	| { type: "hop"; dir: HopDir; combo: number }
	| { type: "land"; row: number; x: number; forward: boolean; combo: number; points: number }
	| { type: "rest"; row: number }
	| { type: "slip"; row: number; x: number; faith: number }
	| { type: "climb" }
	| { type: "gustWarn"; dir: -1 | 1 }
	| { type: "gust"; dir: -1 | 1 }
	| { type: "shoved"; dir: -1 | 1 }
	| { type: "sinking" }
	| { type: "rescued" }
	| { type: "arrived"; bonus: number };

export interface HopperResult {
	/** The lowest faith of the run, rounded: what grades the award. */
	faithKept: number;
	seconds: number;
	/** Clean hops: every hop that landed on a crest. */
	swellsCleared: number;
	slips: number;
	score: number;
}

/** mulberry32: small, fast and the same on every engine. */
function random(state: HopperState): number {
	state.seed = (state.seed + 0x6d2b79f5) | 0;
	let r = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
	r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
	return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function between(state: HopperState, low: number, high: number): number {
	return low + (high - low) * random(state);
}

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

const LANE_MIN = -HOPPER_EDGE;
const LANE_MAX = HOPPER_COLS - 1 + HOPPER_EDGE;

function onSea(x: number): boolean {
	return x >= LANE_MIN && x <= LANE_MAX;
}

/** Is cell `k` of the row a crest. */
export function crestAt(row: HopperRow, k: number): boolean {
	const n = row.pattern.length;
	return row.pattern[((k % n) + n) % n] === 1;
}

/** The row's cell nearest to lane position `x`, at `offset`. */
export function cellAt(row: HopperRow, x: number, offset = row.offset): number {
	return Math.round(x - offset);
}

/** The row's offset `seconds` from now. */
export function offsetAfter(row: HopperRow, seconds: number): number {
	return row.offset + row.dir * row.speed * seconds;
}

function onShip(x: number): boolean {
	return x >= HOPPER_SHIP_LANES[0] - 0.5 && x <= HOPPER_SHIP_LANES[1] + 0.5;
}

/**
 * Where a hop landing at lane position `x` puts him, or null for a trough.
 * A row hop that lands near a crest's edge is nudged onto it (`grace`).
 */
function landingOn(row: HopperRow, x: number, offset: number, grace: boolean): number | null {
	if (row.kind === "ship") return onShip(x) ? clamp(Math.round(x), HOPPER_SHIP_LANES[0], HOPPER_SHIP_LANES[1]) : null;
	if (row.kind !== "sea") return onSea(x) ? x : null;
	const p = x - offset;
	const k = Math.round(p);
	const landed = (cell: number) => {
		const at = cell + offset;
		return onSea(at) ? at : null;
	};
	if (crestAt(row, k)) return landed(k);
	if (!grace) return null;
	const d = p - k;
	const near = d >= 0 ? k + 1 : k - 1;
	if (0.5 - Math.abs(d) <= GRACE && crestAt(row, near)) return landed(near);
	return null;
}

/** Is he standing on something right now. */
function standingSafe(state: HopperState): boolean {
	const row = state.rows[state.row];
	if (row.kind !== "sea") return true;
	return crestAt(row, cellAt(row, state.x));
}

function makeRow(state: HopperState, r: number, dir: -1 | 1): HopperRow {
	const n = HOPPER_PATTERN;
	if (HOPPER_REST_ROWS.includes(r)) return { kind: "rest", dir, speed: 0, pattern: new Array(n).fill(1), offset: 0 };
	const progress = r / HOPPER_SEA_ROWS;
	// Rougher toward Jesus: faster swells, shorter crests, wider troughs.
	const speed = (0.8 + 1.3 * progress) * between(state, 0.85, 1.15);
	let pattern: number[] = [];
	for (let tries = 0; tries < 50; tries++) {
		pattern = [];
		while (pattern.length < n) {
			const crest = Math.floor(between(state, 2, 4.6 - 1.2 * progress));
			const trough = Math.floor(between(state, 2, 3.3 + 0.7 * progress));
			for (let i = 0; i < crest; i++) pattern.push(1);
			for (let i = 0; i < trough; i++) pattern.push(0);
		}
		pattern = pattern.slice(0, n);
		// Never a crest of one cell (round the wrap too), never a trough wider than three.
		let ok = pattern.includes(0) && pattern.filter((cell) => cell === 1).length >= 5;
		for (let k = 0; ok && k < n; k++) {
			if (pattern[k] === 1 && pattern[(k + n - 1) % n] === 0 && pattern[(k + 1) % n] === 0) ok = false;
			if (pattern[k] === 0 && pattern[(k + 1) % n] === 0 && pattern[(k + 2) % n] === 0 && pattern[(k + 3) % n] === 0) ok = false;
		}
		if (ok) break;
	}
	return { kind: "sea", dir, speed, pattern, offset: between(state, 0, n) };
}

export function newHopper(seed: number): HopperState {
	const state: HopperState = {
		phase: "playing",
		t: 0,
		row: 0,
		x: Math.floor(HOPPER_COLS / 2),
		air: 0,
		hop: null,
		settle: 0,
		stun: 0,
		guard: 0,
		queued: null,
		faith: HOPPER_START_FAITH,
		minFaith: HOPPER_START_FAITH,
		score: 0,
		combo: 0,
		lastForwardAt: -10,
		cleanHops: 0,
		slips: 0,
		maxRow: 0,
		gust: null,
		nextGustAt: 7,
		shove: null,
		rows: [],
		sink: 0,
		ended: 0,
		seed: seed | 0,
	};
	state.rows.push({ kind: "ship", dir: 1, speed: 0, pattern: new Array(HOPPER_PATTERN).fill(1), offset: 0 });
	let dir: -1 | 1 = random(state) < 0.5 ? -1 : 1;
	for (let r = 1; r <= HOPPER_SEA_ROWS; r++) {
		const row = makeRow(state, r, dir);
		// Two neighbouring rows rolling the same way never keep the same pace, or their crests could stay out of step for good.
		const below = state.rows[r - 1];
		if (row.kind === "sea" && below.kind === "sea" && below.dir === row.dir && Math.abs(row.speed - below.speed) < 0.4 * Math.max(row.speed, below.speed)) {
			row.speed = below.speed > 1.4 ? below.speed * 0.55 : below.speed * 1.6;
		}
		state.rows.push(row);
		// Mostly alternating, the way swells cross a lake in a contrary wind; now and then two alike.
		if (random(state) < 0.78) dir = dir === 1 ? -1 : 1;
	}
	state.rows.push({ kind: "light", dir: 1, speed: 0, pattern: new Array(HOPPER_PATTERN).fill(1), offset: 0 });
	return state;
}

/** 0 at the ship, 1 at Jesus. */
export function hopperProgress(state: Pick<HopperState, "maxRow">): number {
	return clamp(state.maxRow / HOPPER_LIGHT_ROW, 0, 1);
}

/** On his feet and free to hop. */
export function hopperReady(state: HopperState): boolean {
	return state.phase === "playing" && state.t >= HOPPER_START && state.air === 0 && state.stun === 0 && state.settle === 0;
}

/**
 * Where a hop in `dir` pressed on the next step would land, or null if it would
 * land in a trough or cannot be made. With a `margin` (in cells) a landing on a
 * row of swells must also clear the crest's edges by that much.
 */
export function hopLanding(state: HopperState, dir: HopDir, margin = 0): { row: number; x: number } | null {
	if (state.phase !== "playing") return null;
	const from = state.rows[state.row];
	if (dir === "up" || dir === "down") {
		const toRow = state.row + (dir === "up" ? 1 : -1);
		if (toRow < 0 || toRow > HOPPER_LIGHT_ROW) return null;
		const row = state.rows[toRow];
		const offset = offsetAfter(row, HOPPER_HOP_AIR + HOPPER_STEP);
		if (margin > 0 && row.kind === "sea" && !(crestAt(row, Math.round(state.x - offset - margin)) && crestAt(row, Math.round(state.x - offset + margin)))) return null;
		const x = landingOn(row, state.x, offset, true);
		return x === null ? null : { row: toRow, x };
	}
	const side = dir === "left" ? -1 : 1;
	if (from.kind === "ship") {
		const x = Math.round(state.x) + side;
		return x >= HOPPER_SHIP_LANES[0] && x <= HOPPER_SHIP_LANES[1] ? { row: state.row, x } : null;
	}
	const k = cellAt(from, state.x) + side;
	if (from.kind === "sea" && !crestAt(from, k)) return null;
	const x = k + offsetAfter(from, HOPPER_HOP_AIR + HOPPER_STEP);
	return onSea(x) ? { row: state.row, x } : null;
}

/**
 * Would a shove in `dir` (a gust) land him on a crest from where he stands:
 * true on the ship, a calm swell or against the edge of the sea (he braces).
 */
export function shoveLands(state: HopperState, dir: -1 | 1): boolean {
	const row = state.rows[state.row];
	if (row.kind !== "sea") return true;
	const target = cellAt(row, state.x) + dir;
	return crestAt(row, target) || !onSea(target + offsetAfter(row, SHOVE_AIR));
}

/** Can the hop be made at all (the ship's rail and the edge of the sea stop some). A hop into a trough can be made. */
function hopAllowed(state: HopperState, dir: HopDir): boolean {
	const from = state.rows[state.row];
	if (dir === "up") return state.row < HOPPER_LIGHT_ROW;
	if (dir === "down") return state.row === 1 ? onShip(state.x) : state.row > 1;
	const side = dir === "left" ? -1 : 1;
	if (from.kind === "ship") {
		const x = Math.round(state.x) + side;
		return x >= HOPPER_SHIP_LANES[0] && x <= HOPPER_SHIP_LANES[1];
	}
	return onSea(state.x + side);
}

function startHop(state: HopperState, dir: HopDir, events: HopperEvent[]) {
	const from = state.rows[state.row];
	if (dir === "up" || dir === "down") {
		const toRow = state.row + (dir === "up" ? 1 : -1);
		state.hop = { kind: "row", fromRow: state.row, toRow, fromX: state.x, target: state.x };
	} else {
		const side = dir === "left" ? -1 : 1;
		const target = from.kind === "ship" ? Math.round(state.x) + side : cellAt(from, state.x) + side;
		state.hop = { kind: "side", fromRow: state.row, toRow: state.row, fromX: state.x, target };
	}
	state.air = HOPPER_HOP_AIR;
	events.push({ type: "hop", dir, combo: state.combo });
}

function slip(state: HopperState, events: HopperEvent[]) {
	state.slips += 1;
	state.faith = Math.max(0, state.faith - HOPPER_SLIP_FAITH);
	state.minFaith = Math.min(state.minFaith, state.faith);
	state.combo = 0;
	state.stun = STUN;
	state.hop = null;
	state.air = 0;
	state.queued = null;
	state.shove = null;
	events.push({ type: "slip", row: state.row, x: state.x, faith: state.faith });
	if (state.faith <= 0) {
		state.phase = "sinking";
		state.ended = 0;
		state.sink = 0.3;
		events.push({ type: "sinking" });
	}
}

/** After a slip he climbs onto the nearest crest of his row, inside the lanes if he can. */
function climb(state: HopperState, events: HopperEvent[]) {
	const row = state.rows[state.row];
	if (row.kind === "sea") {
		const k = cellAt(row, state.x);
		let best: number | null = null;
		for (const inner of [true, false]) {
			for (let d = 0; d <= HOPPER_PATTERN && best === null; d++) {
				for (const cell of d === 0 ? [k] : [k - d, k + d]) {
					const at = cell + row.offset;
					const inside = inner ? at >= 0.3 && at <= HOPPER_COLS - 1.3 : onSea(at);
					if (best === null && crestAt(row, cell) && inside) best = at;
				}
			}
			if (best !== null) break;
		}
		if (best !== null) state.x = best;
	}
	state.guard = GUARD;
	events.push({ type: "climb" });
}

function land(state: HopperState, events: HopperEvent[]) {
	const hop = state.hop;
	if (!hop) return;
	state.hop = null;
	const row = state.rows[hop.toRow];
	state.row = hop.toRow;
	const x = hop.kind === "row" ? hop.target : row.kind === "ship" ? hop.target : hop.target + row.offset;
	if (row.kind === "light") {
		state.x = clamp(x, 0, HOPPER_COLS - 1);
		state.maxRow = HOPPER_LIGHT_ROW;
		state.phase = "arrived";
		state.ended = 0;
		const bonus = 1000 + Math.round(state.minFaith) * 10;
		state.score += bonus;
		events.push({ type: "arrived", bonus });
		return;
	}
	const landed = landingOn(row, x, row.offset, hop.kind === "row");
	if (landed === null) {
		state.x = clamp(x, LANE_MIN, LANE_MAX);
		slip(state, events);
		return;
	}
	state.x = landed;
	state.settle = HOPPER_SETTLE;
	if (hop.kind === "shove") return;
	state.cleanHops += 1;
	const forward = hop.toRow > hop.fromRow;
	let points = 0;
	if (forward) {
		state.faith = Math.min(100, state.faith + HOP_FAITH);
		if (hop.toRow > state.maxRow) {
			state.combo = state.t - state.lastForwardAt <= COMBO_WINDOW && state.combo > 0 ? Math.min(COMBO_MAX, state.combo + 1) : 1;
			state.lastForwardAt = state.t;
			state.maxRow = hop.toRow;
			points = 10 * state.combo;
			if (row.kind === "rest") {
				points += 100;
				events.push({ type: "rest", row: hop.toRow });
			}
			state.score += points;
		}
	}
	events.push({ type: "land", row: hop.toRow, x: state.x, forward, combo: state.combo, points });
}

/** Advances the run by one fixed step. Mutates and returns `state`; events say what happened. */
export function stepHopper(state: HopperState, input: HopperInput, events: HopperEvent[] = []): HopperState {
	const dt = HOPPER_STEP;
	if (state.phase !== "playing") {
		state.ended += dt;
		if (state.phase === "sinking") {
			state.sink = Math.min(1, state.sink + dt * 0.5);
			if (input.cry) {
				state.phase = "rescued";
				state.ended = 0;
				events.push({ type: "rescued" });
			}
		}
		return state;
	}

	state.t += dt;
	for (const row of state.rows) row.offset += row.dir * row.speed * dt;
	if (input.hop) state.queued = input.hop;

	// The wind: a gust is shown coming, then shoves him a lane downwind.
	const progress = hopperProgress(state);
	if (!state.gust && state.t >= state.nextGustAt - HOPPER_GUST_WARN) {
		if (state.maxRow < 2 || state.maxRow >= HOPPER_LIGHT_ROW - 1) state.nextGustAt = state.t + HOPPER_GUST_WARN + 0.5;
		else {
			const dir: -1 | 1 = random(state) < 0.5 ? -1 : 1;
			state.gust = { dir, at: state.nextGustAt };
			events.push({ type: "gustWarn", dir });
		}
	}
	if (state.gust && state.t >= state.gust.at) {
		const dir = state.gust.dir;
		state.shove = { dir, until: state.t + SHOVE_WINDOW };
		state.gust = null;
		state.nextGustAt = state.t + between(state, 4.6, 7.4) * (1 - 0.3 * progress);
		events.push({ type: "gust", dir });
	}
	if (state.shove && state.t > state.shove.until) state.shove = null;

	if (state.air > 0) {
		const hop = state.hop;
		state.air = state.air - dt < 1e-6 ? 0 : state.air - dt;
		if (hop) {
			const row = state.rows[hop.toRow];
			const to = hop.kind === "row" || row.kind === "ship" ? hop.target : hop.target + row.offset;
			state.x = hop.fromX + (to - hop.fromX) * (1 - state.air / (hop.kind === "shove" ? SHOVE_AIR : HOPPER_HOP_AIR));
		}
		if (state.air === 0) land(state, events);
	} else if (state.stun > 0) {
		state.stun = state.stun - dt < 1e-6 ? 0 : state.stun - dt;
		if (state.stun === 0) climb(state, events);
	} else {
		// On his feet: carried along by the crest under him.
		const row = state.rows[state.row];
		if (row.kind === "sea" || row.kind === "rest") state.x = clamp(state.x + row.dir * row.speed * dt, LANE_MIN, LANE_MAX);
		state.settle = state.settle - dt < 1e-6 ? 0 : state.settle - dt;
		state.guard = state.guard - dt < 1e-6 ? 0 : state.guard - dt;
		if (state.guard === 0 && !standingSafe(state)) slip(state, events);
		else if (state.shove && row.kind !== "ship") {
			const dir = state.shove.dir;
			state.shove = null;
			const target = cellAt(row, state.x) + dir;
			// Against the edge of the sea he braces and stays.
			if (onSea(target + offsetAfter(row, SHOVE_AIR))) {
				state.hop = { kind: "shove", fromRow: state.row, toRow: state.row, fromX: state.x, target };
				state.air = SHOVE_AIR;
				state.queued = null;
				events.push({ type: "shoved", dir });
			}
		} else if (state.queued && hopperReady(state)) {
			const dir = state.queued;
			state.queued = null;
			if (hopAllowed(state, dir)) startHop(state, dir, events);
		}
	}

	state.faith = clamp(state.faith, 0, 100);
	state.minFaith = Math.min(state.minFaith, state.faith);
	return state;
}

/** The finished run's numbers, or null while it is not finished. */
export function hopperResult(state: HopperState): HopperResult | null {
	if (state.phase !== "arrived") return null;
	return {
		faithKept: Math.round(state.minFaith),
		// An award takes at most an hour (checkGameRun); a longer run still counts.
		seconds: Math.min(3600, Math.round(state.t * 10) / 10),
		swellsCleared: Math.min(500, state.cleanHops),
		slips: state.slips,
		score: state.score,
	};
}

/**
 * The soonest a run can finish: the wait to come down out of the ship, then
 * every row a hop without a pause (each hop's time in the air, and the settle
 * after every landing but the last). Waiting for crests only adds to it.
 */
export const HOPPER_MIN_SECONDS = Math.floor(HOPPER_START + HOPPER_LIGHT_ROW * HOPPER_HOP_AIR + HOPPER_SEA_ROWS * HOPPER_SETTLE);
