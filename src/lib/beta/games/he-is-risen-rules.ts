/**
 * He Is Risen (LC-17851, docs/beta/games.md), Matthew 28:1-10: at the dawn
 * of the first day of the week the women find the sepulchre empty and "did
 * run to bring his disciples word" (v8). Pure and seeded so the tests play
 * it; no imports (Node's type stripping loads it).
 *
 * The runner keeps her own pace through the garden; the player only leaps
 * (a press leaps, holding while rising floats a little longer). Stones and
 * roots lie on the way. Running into one is a stumble: a short slowdown, and
 * the third ends the run. Reaching the disciples when the round's 15 seconds
 * are up is the win; joy (the score) falls with each stumble and with leaps
 * wasted on open ground.
 */

export const RISEN_STEP = 1 / 60;
/** The round: she reaches the disciples as it ends. */
export const RISEN_SECONDS = 15;
/** A won run always lasts the whole round. */
export const RISEN_MIN_SECONDS = RISEN_SECONDS;
/** Her running pace, picture units a second. */
export const RISEN_SPEED = 210;
/** The third stumble ends the run. */
export const RISEN_STUMBLES = 3;
/** Half her footing, picture units. */
export const RISEN_FOOT = 7;

const JUMP_SPEED = 620;
const GRAVITY = 2200;
/** Holding the leap while rising floats it, for up to HOLD_MAX seconds. */
const HOLD_GRAVITY = 1100;
const HOLD_MAX = 0.16;
/** A press this soon before landing still leaps on landing. */
const BUFFER = 0.06;
/** A stumble slows her to this share of her pace, recovering over STUMBLE_TIME. */
const STUMBLE_PACE = 0.4;
export const STUMBLE_TIME = 0.6;
/** Leaps over open ground that cost no joy. */
const FREE_LEAPS = 2;

export type RisenKind = "stone" | "root" | "rock";

/** Width and height of each kind, picture units. */
export const RISEN_SIZES: Record<RisenKind, { w: number; h: number }> = {
	stone: { w: 26, h: 22 },
	root: { w: 44, h: 13 },
	rock: { w: 30, h: 29 },
};

export interface RisenObstacle {
	id: number;
	kind: RisenKind;
	/** Centre, picture units along the way. */
	x: number;
	w: number;
	h: number;
	state: "ahead" | "cleared" | "hit";
}

export interface RisenState {
	t: number;
	/** How far she has run. */
	d: number;
	speed: number;
	/** Height above the path, and its rate. */
	y: number;
	vy: number;
	grounded: boolean;
	/** Seconds into the current leap (for the hold), and when the last press came. */
	air: number;
	pressAt: number;
	stumbleAt: number;
	stumbles: number;
	cleared: number;
	leaps: number;
	obstacles: RisenObstacle[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type RisenEvent =
	| { type: "leap" }
	| { type: "land" }
	| { type: "clear"; id: number; streak: number }
	| { type: "stumble"; id: number }
	| { type: "arrived" }
	| { type: "fell" };

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

/** Where the first stone lies (seconds of running) and where the last may. */
const FIRST_AT = 1.9;
const LAST_AT = 13.2;

export function newRisen(seed: number): RisenState {
	const next = random(seed);
	const obstacles: RisenObstacle[] = [];
	let id = 0;
	for (let at = FIRST_AT + next() * 0.3; at <= LAST_AT; at += 0.78 + next() * 0.5) {
		const roll = next();
		const kind: RisenKind = id === 0 ? "stone" : roll < 0.45 ? "stone" : roll < 0.75 ? "root" : "rock";
		const size = RISEN_SIZES[kind];
		obstacles.push({ id: id++, kind, x: at * RISEN_SPEED, w: size.w, h: size.h, state: "ahead" });
	}
	return {
		t: 0,
		d: 0,
		speed: RISEN_SPEED,
		y: 0,
		vy: 0,
		grounded: true,
		air: 0,
		pressAt: -1,
		stumbleAt: -10,
		stumbles: 0,
		cleared: 0,
		leaps: 0,
		obstacles,
		phase: "playing",
		endedAt: null,
	};
}

/** The next obstacle she has not yet passed. */
export function nextObstacle(state: RisenState): RisenObstacle | null {
	return state.obstacles.find((item) => item.x + item.w / 2 > state.d - RISEN_FOOT && item.state === "ahead") ?? null;
}

/**
 * Whether a plain leap taken now, at her current pace, clears `item`: the
 * stage lights the leap marker exactly while this is true.
 */
export function leapClears(state: RisenState, item: RisenObstacle): boolean {
	let d = state.d;
	let y = 0;
	let vy = JUMP_SPEED;
	for (let i = 0; i < 60; i++) {
		vy -= GRAVITY * RISEN_STEP;
		y += vy * RISEN_STEP;
		d += state.speed * RISEN_STEP;
		if (y <= 0) return d - RISEN_FOOT >= item.x + item.w / 2;
		const over = d + RISEN_FOOT > item.x - item.w / 2 && d - RISEN_FOOT < item.x + item.w / 2;
		if (over && y < item.h) return false;
	}
	return false;
}

/** Seconds a plain leap takes to reach its height, for players and markers. */
export const RISEN_APEX = JUMP_SPEED / GRAVITY;

export function stepRisen(state: RisenState, input: { leap: boolean; hold?: boolean }, events: RisenEvent[] = []): RisenState {
	if (state.phase !== "playing") return state;
	const dt = RISEN_STEP;
	if (input.leap) state.pressAt = state.t;
	if (state.grounded && state.pressAt >= 0 && state.t - state.pressAt <= BUFFER + 1e-9) {
		state.grounded = false;
		state.vy = JUMP_SPEED;
		state.air = 0;
		state.pressAt = -1;
		state.leaps += 1;
		events.push({ type: "leap" });
	}
	const since = state.t - state.stumbleAt;
	state.speed = since < STUMBLE_TIME ? RISEN_SPEED * (STUMBLE_PACE + (1 - STUMBLE_PACE) * (since / STUMBLE_TIME)) : RISEN_SPEED;
	if (!state.grounded) {
		const floating = input.hold && state.vy > 0 && state.air < HOLD_MAX;
		state.vy -= (floating ? HOLD_GRAVITY : GRAVITY) * dt;
		state.y += state.vy * dt;
		state.air += dt;
		if (state.y <= 0) {
			state.y = 0;
			state.vy = 0;
			state.grounded = true;
			events.push({ type: "land" });
		}
	}
	state.d += state.speed * dt;
	state.t += dt;
	for (const item of state.obstacles) {
		if (item.state !== "ahead") continue;
		const left = item.x - item.w / 2;
		const right = item.x + item.w / 2;
		if (state.d + RISEN_FOOT <= left) break;
		if (state.d - RISEN_FOOT >= right) {
			item.state = "cleared";
			state.cleared += 1;
			let streak = 0;
			for (const other of state.obstacles) if (other.state === "cleared") streak++;
			else if (other.state === "hit") streak = 0;
			events.push({ type: "clear", id: item.id, streak });
		} else if (state.y < item.h) {
			item.state = "hit";
			state.stumbles += 1;
			state.stumbleAt = state.t;
			events.push({ type: "stumble", id: item.id });
		}
	}
	if (state.stumbles >= RISEN_STUMBLES) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "fell" });
	} else if (state.t >= RISEN_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "arrived" });
	}
	return state;
}

/** Joy: every stumble costs 28, every leap over open ground (after two) 4. */
export function risenJoy(state: RisenState): number {
	const wasted = Math.max(0, state.leaps - state.cleared - FREE_LEAPS);
	return Math.max(0, Math.min(100, Math.round(100 - state.stumbles * 28 - wasted * 4)));
}

/** The round's result once it has ended; count is the stones and roots leapt. */
export function risenResult(state: RisenState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const won = state.phase === "won";
	return { won, score: won ? risenJoy(state) : 0, count: state.cleared, seconds: Math.round(state.endedAt * 10) / 10 };
}
