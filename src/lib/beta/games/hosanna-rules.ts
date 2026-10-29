/**
 * Hosanna! (LC-17851, docs/beta/games.md), Matthew 21:1-11: Jesus rides the
 * colt into Jerusalem, and a very great multitude spread their garments in the
 * way; others cut down branches from the trees and strawed them in the way.
 * Pure and seeded so the tests play it; no imports (Node's type stripping
 * loads it).
 *
 * The road comes toward the colt with bare patches on it. A press lays a
 * garment or a branch on whatever is in the "lay here" zone just in front of
 * the colt: a bare patch there is covered; nothing there drops it in the dust
 * (wasted) and the hands are empty for a moment. A patch that passes the zone
 * bare stays bare. The round runs its full time.
 */

export const HOSANNA_STEP = 1 / 60;
export const HOSANNA_SECONDS = 15;
/** The round always runs its full time, so the fastest win is the whole round. */
export const HOSANNA_MIN_SECONDS = HOSANNA_SECONDS;
/** The road's speed under the colt: SPEED + RAMP * t units a second. */
export const HOSANNA_SPEED = 125;
export const HOSANNA_RAMP = 4.5;
/** The "lay here" zone: its centre this far ahead of the colt, and its half width. */
export const HOSANNA_AHEAD = 80;
export const HOSANNA_ZONE = 17;
/** A bare patch's half width (the drawing). */
export const HOSANNA_PATCH = 15;
/** After a branch falls in the dust, the hands are empty this long. */
export const HOSANNA_REFILL = 0.4;
/** Winning: at least this share of the patches covered, with at most this many branches wasted. */
export const HOSANNA_WIN_SHARE = 0.7;
export const HOSANNA_MAX_WASTED = 5;
export const HOSANNA_WASTE_COST = 3;

export type HosannaCover = "bare" | "garment" | "palm" | "missed";

export interface HosannaPatch {
	/** Road x of its centre. */
	x: number;
	cover: HosannaCover;
}

export interface HosannaState {
	t: number;
	patches: HosannaPatch[];
	covered: number;
	missed: number;
	wasted: number;
	streak: number;
	bestStreak: number;
	/** Hands empty until this time. */
	emptyUntil: number;
	/** The last wasted press, for its flash. */
	lastWaste: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type HosannaEvent =
	| { type: "lay"; cover: "garment" | "palm"; streak: number; index: number }
	| { type: "waste" }
	| { type: "missed"; index: number }
	| { type: "end"; won: boolean };

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

/** How far the road has moved under the colt at time t. */
export function hosannaRoadX(t: number): number {
	return HOSANNA_SPEED * t + (HOSANNA_RAMP / 2) * t * t;
}

/** The road x at the centre of the "lay here" zone at time t. */
export function hosannaZoneX(t: number): number {
	return hosannaRoadX(t) + HOSANNA_AHEAD;
}

export function newHosanna(seed: number): HosannaState {
	const next = random(seed);
	const patches: HosannaPatch[] = [];
	// The first patch reaches the zone a little after a second; the last one before the end.
	const lastX = hosannaZoneX(HOSANNA_SECONDS) - HOSANNA_ZONE - 4;
	for (let x = hosannaZoneX(1.2); x < lastX; x += 72 + next() * 88) patches.push({ x, cover: "bare" });
	return { t: 0, patches, covered: 0, missed: 0, wasted: 0, streak: 0, bestStreak: 0, emptyUntil: 0, lastWaste: -9, phase: "playing", endedAt: null };
}

/** The bare patch in the zone now, if any (its index). */
export function hosannaInZone(state: HosannaState, t = state.t): number {
	const zone = hosannaZoneX(t);
	return state.patches.findIndex((patch) => patch.cover === "bare" && Math.abs(patch.x - zone) <= HOSANNA_ZONE);
}

export function stepHosanna(state: HosannaState, input: { lay: boolean }, events: HosannaEvent[] = []): HosannaState {
	if (state.phase !== "playing") return state;
	if (input.lay && state.t >= state.emptyUntil - 1e-9) {
		const index = hosannaInZone(state);
		if (index >= 0) {
			const cover = state.covered % 3 === 2 ? "garment" : "palm";
			state.patches[index].cover = cover;
			state.covered++;
			state.streak++;
			state.bestStreak = Math.max(state.bestStreak, state.streak);
			events.push({ type: "lay", cover, streak: state.streak, index });
		} else {
			state.wasted++;
			state.streak = 0;
			state.emptyUntil = state.t + HOSANNA_REFILL;
			state.lastWaste = state.t;
			events.push({ type: "waste" });
		}
	}
	state.t += HOSANNA_STEP;
	const zone = hosannaZoneX(state.t);
	state.patches.forEach((patch, index) => {
		if (patch.cover === "bare" && patch.x < zone - HOSANNA_ZONE) {
			patch.cover = "missed";
			state.missed++;
			state.streak = 0;
			events.push({ type: "missed", index });
		}
	});
	if (state.t >= HOSANNA_SECONDS - 1e-9) {
		state.phase = hosannaShare(state) >= HOSANNA_WIN_SHARE && state.wasted <= HOSANNA_MAX_WASTED ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: "end", won: state.phase === "won" });
	}
	return state;
}

export function hosannaShare(state: HosannaState): number {
	return state.patches.length ? state.covered / state.patches.length : 0;
}

export function hosannaScore(state: HosannaState): number {
	return Math.max(0, Math.min(100, Math.round(100 * hosannaShare(state) - HOSANNA_WASTE_COST * state.wasted)));
}

/** The round's result once it has ended: the way covered, less the branches wasted. */
export function hosannaResult(state: HosannaState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	return { won: state.phase === "won", score: hosannaScore(state), count: state.covered, seconds: Math.round(state.endedAt * 10) / 10 };
}
