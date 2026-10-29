/**
 * Lord, Save Us (LC-17851, docs/beta/games.md), Matthew 8:23-27: a great
 * tempest covers the ship with the waves while Jesus sleeps. Pure and seeded
 * so the tests play it; no imports (Node's type stripping loads it).
 *
 * Water pours in all the time, a little faster as the storm builds, and big
 * waves (warned by a rising wall of water) pour in a surge. Each bail must
 * come from the other side than the last press: left, right, left, right. A
 * press on the same side fumbles the bucket, slops some water back in and
 * loses a moment. Keep the ship from filling until he arises and rebukes the
 * winds and the sea (v26).
 */

export const SAVE_STEP = 1 / 60;
/** The storm lasts this long; he arises at the end of it. */
export const SAVE_SECONDS = 12;
/** The only win is surviving the whole storm. */
export const SAVE_MIN_SECONDS = SAVE_SECONDS;
/** Water in the hull, 0-100; full sinks the ship. */
export const SAVE_START_WATER = 12;
export const SAVE_FULL = 100;
/** The meter's danger line. */
export const SAVE_DANGER = 70;
/** Water the waves pour in each second, from the start to the end of the storm. */
export const SAVE_INFLOW_START = 13;
export const SAVE_INFLOW_END = 21;
/** Water one bail throws out. */
export const SAVE_BAIL = 5;
/** A fumble slops this much back in and the bucket is out of hand this long. */
export const SAVE_FUMBLE_WATER = 2;
export const SAVE_FUMBLE_STUN = 0.35;
/** A big wave: seconds of warning (the wall rises), then the surge pours in over this long. */
export const SAVE_WAVE_WARN = 0.9;
export const SAVE_WAVE_SURGE = 0.5;
export const SAVE_WAVE_WATER = 20;

export type SaveSide = "left" | "right";

export interface SaveWave {
	side: SaveSide;
	/** When the wall starts rising, and when its surge pours in. */
	warn: number;
	hit: number;
}

export interface SaveState {
	t: number;
	water: number;
	peak: number;
	/** Sum of water over the steps, for the average. */
	total: number;
	steps: number;
	/** The side of the last press (bail or fumble); the next bail must be the other. */
	last: SaveSide | null;
	/** The bucket is fumbled until this time. */
	stunUntil: number;
	bails: number;
	fumbles: number;
	waves: SaveWave[];
	/** When lightning flashes (seeded so a replay matches). */
	lightning: number[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type SaveEvent =
	| { type: "bail"; side: SaveSide }
	| { type: "fumble"; side: SaveSide }
	| { type: "warn"; side: SaveSide }
	| { type: "surge"; side: SaveSide }
	| { type: "thunder" }
	| { type: "calm" }
	| { type: "sank" };

function random(seed: number) {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function newSave(seed: number): SaveState {
	const next = random(seed);
	const waves: SaveWave[] = [];
	let side: SaveSide = next() < 0.5 ? "left" : "right";
	for (let warn = 1.6 + next() * 0.6; warn + SAVE_WAVE_WARN < SAVE_SECONDS - 0.6; warn += 1.9 + next() * 0.9) {
		waves.push({ side, warn, hit: warn + SAVE_WAVE_WARN });
		if (next() < 0.7) side = side === "left" ? "right" : "left";
	}
	const lightning: number[] = [];
	for (let at = 0.5 + next() * 0.8; at < SAVE_SECONDS - 0.3; at += 1.3 + next() * 1.6) lightning.push(at);
	return {
		t: 0,
		water: SAVE_START_WATER,
		peak: SAVE_START_WATER,
		total: 0,
		steps: 0,
		last: null,
		stunUntil: 0,
		bails: 0,
		fumbles: 0,
		waves,
		lightning,
		phase: "playing",
		endedAt: null,
	};
}

/** Water pouring in each second at time `t` (the storm builds). */
export function inflowAt(t: number): number {
	return SAVE_INFLOW_START + (SAVE_INFLOW_END - SAVE_INFLOW_START) * Math.min(1, t / SAVE_SECONDS);
}

/** The wave warning or surging at `t`, if any. */
export function waveAt(state: SaveState, t = state.t): SaveWave | null {
	return state.waves.find((wave) => t >= wave.warn && t < wave.hit + SAVE_WAVE_SURGE) ?? null;
}

/** The side whose bail comes next (null: either). */
export function nextSide(state: SaveState): SaveSide | null {
	return state.last === null ? null : state.last === "left" ? "right" : "left";
}

/** The storm's calm after a win, 0 (storm) to 1 (still), over two seconds. */
export function calmAmount(state: SaveState, t: number): number {
	if (state.phase !== "won" || state.endedAt === null) return 0;
	return Math.max(0, Math.min(1, (t - state.endedAt) / 2));
}

export function stepSave(state: SaveState, input: { presses: SaveSide[] }, events: SaveEvent[] = []): SaveState {
	if (state.phase !== "playing") return state;
	const dt = SAVE_STEP;
	for (const side of input.presses) {
		if (state.t < state.stunUntil) continue;
		if (side === state.last) {
			state.water = Math.min(SAVE_FULL, state.water + SAVE_FUMBLE_WATER);
			state.stunUntil = state.t + SAVE_FUMBLE_STUN;
			state.fumbles += 1;
			events.push({ type: "fumble", side });
		} else {
			state.water = Math.max(0, state.water - SAVE_BAIL);
			state.bails += 1;
			events.push({ type: "bail", side });
		}
		state.last = side;
	}
	let pour = inflowAt(state.t) * dt;
	for (const wave of state.waves) {
		if (state.t >= wave.hit && state.t < wave.hit + SAVE_WAVE_SURGE) pour += (SAVE_WAVE_WATER / SAVE_WAVE_SURGE) * dt;
	}
	state.water = Math.min(SAVE_FULL, state.water + pour);
	const before = state.t;
	state.t += dt;
	for (const wave of state.waves) {
		if (before < wave.warn && state.t >= wave.warn) events.push({ type: "warn", side: wave.side });
		if (before < wave.hit && state.t >= wave.hit) events.push({ type: "surge", side: wave.side });
	}
	if (state.lightning.some((at) => before < at && state.t >= at)) events.push({ type: "thunder" });
	state.peak = Math.max(state.peak, state.water);
	state.total += state.water;
	state.steps += 1;
	if (state.water >= SAVE_FULL - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "sank" });
	} else if (state.t >= SAVE_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "calm" });
	}
	return state;
}

/** The round's result once it has ended: the lower the water was kept, the higher the score. */
export function saveResult(state: SaveState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const average = state.total / Math.max(1, state.steps);
	const score = state.phase === "won" ? Math.round(Math.max(10, Math.min(100, 100 - average * 0.9 - state.peak * 0.35))) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.bails), seconds };
}
