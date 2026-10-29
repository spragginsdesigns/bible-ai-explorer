/**
 * The Veil Was Rent (LC-17851, docs/beta/games.md), Matthew 27:50-54: "the
 * veil of the temple was rent in twain from the top to the bottom; and the
 * earth did quake". A glowing seam wavers down the veil; the rending point
 * descends on its own while it is kept on the seam, steered left and right.
 * The earth quakes and shoves the seam aside. Off the seam the rending stops,
 * and too long off it is lost. Pure and seeded so the tests play it; no
 * imports (Node's type stripping loads it).
 */

export const VEIL_STEP = 1 / 60;
export const VEIL_SECONDS = 12;
/** The veil's top and bottom, where the rending starts and ends. */
export const VEIL_TOP = 40;
export const VEIL_BOTTOM = 370;
/** Ticks on the seam it takes to rend the veil from the top to the bottom. */
export const VEIL_DESCENT_TICKS = 360;
/** How near the seam counts as on it. */
export const VEIL_TOLERANCE = 15;
/** Seconds off the seam, together, before the rending is lost. */
export const VEIL_OFF_LIMIT = 0.6;
/** How far the seam sways with time. */
export const VEIL_SWAY = 12;
/** Units a second the point moves on a held arrow, and at most on a drag. */
export const VEIL_KEY_SPEED = 210;
export const VEIL_DRAG_SPEED = 420;
export const VEIL_LEFT = 70;
export const VEIL_RIGHT = 330;
/** The fastest a round can be won: always on the seam. */
export const VEIL_MIN_SECONDS = VEIL_DESCENT_TICKS / 60;

export interface VeilQuake {
	at: number;
	length: number;
	/** Which way it shoves the seam, and how far. */
	push: number;
}

export interface VeilState {
	tick: number;
	t: number;
	x: number;
	/** Ticks of rending done (0 to VEIL_DESCENT_TICKS). */
	progress: number;
	/** The seam's shape: two waves, their phases and sizes. */
	waves: { length: number; size: number; phase: number }[];
	quakes: VeilQuake[];
	/** Seconds off the seam now, and in all. */
	off: number;
	offTotal: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type VeilEvent = { type: "quake" } | { type: "slip" } | { type: "back" } | { type: "rent" } | { type: "lost" };

/** Steer: -1 left, 1 right, or move toward `toward` (a drag), in stage units. */
export interface VeilInput {
	dir?: number;
	toward?: number | null;
}

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

/** How far down the veil the rending has come. */
export function veilY(state: VeilState): number {
	return VEIL_TOP + ((VEIL_BOTTOM - VEIL_TOP) * state.progress) / VEIL_DESCENT_TICKS;
}

/** The quake's shove on the seam at time `t`, with a fine tremor. */
export function veilQuakeOffset(state: VeilState, t = state.t): number {
	let offset = 0;
	for (const quake of state.quakes) {
		const k = (t - quake.at) / quake.length;
		if (k < 0 || k > 1) continue;
		offset += quake.push * Math.sin(Math.PI * k) + 4 * Math.sin(t * 57);
	}
	return offset;
}

export function veilQuaking(state: VeilState, t = state.t): boolean {
	return state.quakes.some((quake) => t >= quake.at && t <= quake.at + quake.length);
}

/** The seam's x at height `y` (waves grow toward the bottom), shoved by the quake at time `t`. */
export function veilSeam(state: VeilState, y: number, t = state.t): number {
	const depth = (y - VEIL_TOP) / (VEIL_BOTTOM - VEIL_TOP);
	let x = 200;
	for (const wave of state.waves) x += wave.size * (0.45 + 0.75 * depth) * Math.sin((2 * Math.PI * (y - VEIL_TOP)) / wave.length + wave.phase);
	// The seam breathes from side to side even while the rending waits.
	x += VEIL_SWAY * Math.sin(1.7 * t + state.waves[0].phase) + VEIL_SWAY * 0.6 * Math.sin(3.1 * t + state.waves[1].phase);
	return x + veilQuakeOffset(state, t);
}

export function newVeil(seed: number): VeilState {
	const next = random(seed);
	const quakes: VeilQuake[] = [];
	for (let at = 1.1 + next() * 0.6; at < VEIL_SECONDS - 1.5; at += 1.9 + next() * 0.9) {
		quakes.push({ at, length: 0.8 + next() * 0.3, push: (next() < 0.5 ? -1 : 1) * (30 + next() * 14) });
	}
	const state: VeilState = {
		tick: 0,
		t: 0,
		x: 200,
		progress: 0,
		waves: [
			{ length: 210 + next() * 40, size: 46 + next() * 12, phase: next() * Math.PI * 2 },
			{ length: 86 + next() * 20, size: 16 + next() * 6, phase: next() * Math.PI * 2 },
		],
		quakes,
		off: 0,
		offTotal: 0,
		phase: "playing",
		endedAt: null,
	};
	state.x = veilSeam(state, VEIL_TOP, 0);
	return state;
}

export function veilOnSeam(state: VeilState): boolean {
	return Math.abs(state.x - veilSeam(state, veilY(state))) <= VEIL_TOLERANCE;
}

export function stepVeil(state: VeilState, input: VeilInput, events: VeilEvent[] = []): VeilState {
	if (state.phase !== "playing") return state;
	const wasOn = veilOnSeam(state);
	const quakingBefore = veilQuaking(state);
	state.tick += 1;
	state.t = state.tick / 60;
	if (input.toward !== undefined && input.toward !== null) {
		const room = input.toward - state.x;
		state.x += Math.sign(room) * Math.min(Math.abs(room), VEIL_DRAG_SPEED * VEIL_STEP);
	} else if (input.dir) {
		state.x += Math.sign(input.dir) * VEIL_KEY_SPEED * VEIL_STEP;
	}
	state.x = Math.max(VEIL_LEFT - 30, Math.min(VEIL_RIGHT + 30, state.x));
	if (!quakingBefore && veilQuaking(state)) events.push({ type: "quake" });
	const on = veilOnSeam(state);
	if (on) {
		state.progress += 1;
		state.off = 0;
		if (!wasOn) events.push({ type: "back" });
	} else {
		state.off += VEIL_STEP;
		state.offTotal += VEIL_STEP;
		if (wasOn) events.push({ type: "slip" });
	}
	if (state.progress >= VEIL_DESCENT_TICKS) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "rent" });
	} else if (state.off >= VEIL_OFF_LIMIT - 1e-9 || state.t >= VEIL_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: the less time off the seam, and the sooner, the higher. */
export function veilResult(state: VeilState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.offTotal * 16 - Math.max(0, state.endedAt - 7.5) * 8))) : 0;
	const count = Math.round((100 * state.progress) / VEIL_DESCENT_TICKS);
	return { won: state.phase === "won", score, count, seconds };
}
