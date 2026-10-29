/**
 * The Caravan (LC-17851, docs/beta/games.md), a side-scrolling way to play
 * Matthew 2:1-12. This is the whole simulation: the page draws it and feeds
 * it input, and the tests play it tick by tick. Pure on purpose (no imports,
 * no DOM, no clock, its own seeded random), so a seed and a list of inputs
 * always play the same journey.
 *
 * The travellers go on at their own pace; the player only jumps (held for a
 * longer leap) and ducks. Rocks and ravines are jumped, low ledges and gusts
 * of a sandstorm are ducked under. The star goes on ahead at its own pace:
 * a stumble costs pace and lets it draw ahead, and the gap is the measure,
 * "kept to the star" (100 while close behind it, 0 when it is lost from
 * sight). Falling into a ravine or losing the star ends the run. Two legs:
 * from the east to Jerusalem, where the journey halts for the story of
 * verses 3-8, then from Jerusalem to the house in Bethlehem.
 *
 * Matthew gives no distances, so the game's units (paces below) are never
 * shown; the player sees only how much of each leg is behind them.
 */

/** The simulation runs in fixed steps; the page accumulates frame time into them. */
export const CARAVAN_STEP = 1 / 60;
/** Where the first leg ends, before Jerusalem. */
export const CARAVAN_JERUSALEM = 240;
/** Where the second ends, at the house in Bethlehem. */
export const CARAVAN_END = 510;

/** The star's own pace, paces a second; the caravan matches it when clean. */
export const STAR_SPEED = 7.2;
/** Extra pace while pressing on to catch up with the star. */
const CATCH_UP = 1.6;
/** Extra pace at full stride (a run of clean clears). */
const STRIDE_BONUS = 1.2;
/** Clean clears in a row for full stride. */
export const STRIDE_FULL = 6;
/** The fastest the caravan can ever go. */
export const CARAVAN_TOP_SPEED = STAR_SPEED + CATCH_UP + STRIDE_BONUS;
const ACCEL = 7;
const BRAKE = 5;
const STUMBLE_SPEED = 1.6;
const STAGGER = 0.3;
const SHIELD = 0.7;
const DUCK_PACE = 0.82;

/** The leader's height standing and ducking, and the underside of a ledge or gust. */
export const STAND_HEIGHT = 2;
export const DUCK_HEIGHT = 1;
export const OVERHEAD_CLEARANCE = 1.35;
/** Half the leader's footing, and the lip of a ravine he can still stand on. */
export const CARAVAN_FOOT = 0.3;
export const RAVINE_LIP = 0.42;

const JUMP_SPEED = 10.5;
const GRAVITY = 34;
/** Holding jump while rising floats a longer leap, for up to HOLD_MAX seconds. */
const HOLD_GRAVITY = 14;
const HOLD_MAX = 0.22;
const FAST_FALL = 2.4;
/** A press just before landing still jumps; so does one just after walking off a lip. */
const BUFFER = 0.11;
const COYOTE = 0.09;
const FALL_DEPTH = 2.2;

/** How far ahead the star goes when kept to, and how much further it can draw before it is lost. */
export const STAR_LEAD = 14;
const STAR_FREE = 1;
const STAR_SPAN = 14;

const GUST_SPEED = 4;
/** A gust starts blowing toward the caravan this far ahead of it. */
export const GUST_WAKE = 26;

export type CaravanPhase = "east" | "jerusalem" | "bethlehem" | "arrived" | "fell" | "lost";
export type HazardKind = "rock" | "ravine" | "ledge" | "gust";

export interface CaravanHazard {
	id: number;
	kind: HazardKind;
	/** Left edge, in paces from the east (a gust's moves as it blows). */
	x: number;
	w: number;
	/** A rock's height; 0 for the others. */
	h: number;
	/** 1 from the east to Jerusalem, 2 from Jerusalem to Bethlehem. */
	leg: 1 | 2;
	outcome: "cleared" | "hit" | null;
	/** Set once it has struck the leader, even under the shield of a stumble. */
	touched: boolean;
}

export interface CaravanInput {
	/** True while jump is held (the press is its first step). */
	jump: boolean;
	/** True while duck is held. */
	duck: boolean;
	/** True on the step the player sets out from Jerusalem. */
	go: boolean;
}

export interface CaravanState {
	phase: CaravanPhase;
	/** Seconds on the road (the halt at Jerusalem does not count). */
	t: number;
	/** Seconds since the current leg began. */
	legT: number;
	x: number;
	/** Height of the leader's feet above the road; below 0 in a ravine. */
	y: number;
	vy: number;
	speed: number;
	grounded: boolean;
	falling: boolean;
	ducking: boolean;
	jumpHeld: boolean;
	holdLeft: number;
	buffer: number;
	coyote: number;
	stagger: number;
	shield: number;
	/** Clean clears in a row since the last stumble. */
	streak: number;
	starX: number;
	/** Kept to the star right now, 0-100, and its lowest of the run (the grade). */
	keep: number;
	minKeep: number;
	/** The lowest keep since the star last stood full ahead, for the chime when it is caught up. */
	dip: number;
	cleared: number;
	stumbles: number;
	hazards: CaravanHazard[];
	/** Sim times of the last landing and stumble, for the dust. */
	landedAt: number;
	stumbledAt: number;
	/** Seconds since the run halted or ended, for the scenes. */
	ended: number;
	seed: number;
}

export type CaravanEvent =
	| { type: "jump"; hold: boolean }
	| { type: "land" }
	| { type: "cleared"; kind: HazardKind; streak: number }
	| { type: "stumble"; kind: HazardKind }
	| { type: "star" }
	| { type: "slipping" }
	| { type: "jerusalem" }
	| { type: "depart" }
	| { type: "arrived" }
	| { type: "fell" }
	| { type: "lost" };

export interface CaravanResult {
	/** The lowest kept to the star of the run, rounded: what grades the award. */
	faithKept: number;
	seconds: number;
	/** Rocks, ravines, ledges and gusts passed cleanly. */
	swellsCleared: number;
	stumbles: number;
}

/** mulberry32: small, fast and the same on every engine. */
function random(state: { seed: number }): number {
	state.seed = (state.seed + 0x6d2b79f5) | 0;
	let r = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
	r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
	return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function between(state: { seed: number }, low: number, high: number): number {
	return low + (high - low) * random(state);
}

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

/** The course, laid out from the seed: a few gentle teaching hazards, then harder going. */
function layCourse(state: CaravanState): CaravanHazard[] {
	const hazards: CaravanHazard[] = [];
	let id = 1;
	const add = (kind: HazardKind, x: number, w: number, h: number, leg: 1 | 2) => {
		hazards.push({ id: id++, kind, x, w, h, leg, outcome: null, touched: false });
	};
	// First steps: a rock, a ravine, a ledge, each alone.
	add("rock", 20, 0.8, 0.5, 1);
	add("ravine", 33, 2.4, 0, 1);
	add("ledge", 47, 3, 0, 1);
	add("rock", 58, 1, 0.6, 1);
	// Then each leg to a quiet stretch before its halt; the second starts with a quiet stretch out of Jerusalem.
	for (const [leg, from, stop] of [
		[1, 68, CARAVAN_JERUSALEM - 24],
		[2, CARAVAN_JERUSALEM + 36, CARAVAN_END - 26],
	] as const) {
		let cursor: number = from;
		while (cursor < stop) {
			const difficulty = clamp(cursor / CARAVAN_END, 0, 1);
			const roll = random(state);
			const loose = 1 - 0.45 * difficulty;
			let after: number;
			if (leg === 2 && roll < 0.16) {
				// It meets the caravan about nine paces before where it starts.
				const w = between(state, 2.4, 3.2);
				add("gust", cursor + 9, w, 0, leg);
				after = w + 5.5;
			} else if (roll < 0.42) {
				const tall = random(state) < 0.15 + 0.35 * difficulty;
				const w = tall ? between(state, 1, 1.4) : between(state, 0.7, 1.1);
				add("rock", cursor, w, tall ? between(state, 0.85, 1.05) : between(state, 0.42, 0.62), leg);
				after = w + 6;
			} else if (roll < 0.74) {
				const wide = random(state) < 0.12 + 0.4 * difficulty;
				const w = wide ? between(state, 3.9, 4.5) : between(state, 2.2, 3.1);
				add("ravine", cursor, w, 0, leg);
				after = w + 6.5;
			} else {
				const w = between(state, 2.6, 4.8);
				add("ledge", cursor, w, 0, leg);
				after = w + 5;
			}
			cursor += after + between(state, 0.5, 4.5) * loose;
		}
	}
	return hazards;
}

export function newCaravan(seed: number): CaravanState {
	const state: CaravanState = {
		phase: "east",
		t: 0,
		legT: 0,
		x: 0,
		y: 0,
		vy: 0,
		speed: 0,
		grounded: true,
		falling: false,
		ducking: false,
		jumpHeld: false,
		holdLeft: 0,
		buffer: 0,
		coyote: 0,
		stagger: 0,
		shield: 0,
		streak: 0,
		starX: STAR_LEAD,
		keep: 100,
		minKeep: 100,
		dip: 100,
		cleared: 0,
		stumbles: 0,
		hazards: [],
		landedAt: -10,
		stumbledAt: -10,
		ended: 0,
		seed: seed | 0,
	};
	state.hazards = layCourse(state);
	return state;
}

/** The ravine under x, if the leader's footing there would be over the drop. */
export function ravineAt(state: Pick<CaravanState, "hazards">, x: number): CaravanHazard | null {
	for (const hazard of state.hazards) {
		if (hazard.kind === "ravine" && x > hazard.x + RAVINE_LIP && x < hazard.x + hazard.w - RAVINE_LIP) return hazard;
	}
	return null;
}

/** The next hazard still to be passed, or null. */
export function nextHazard(state: Pick<CaravanState, "hazards" | "x">): CaravanHazard | null {
	for (const hazard of state.hazards) if (hazard.outcome === null && hazard.x + hazard.w + CARAVAN_FOOT >= state.x) return hazard;
	return null;
}

/** How far through its current leg the caravan is, 0-1. */
export function legProgress(state: Pick<CaravanState, "x" | "phase">): number {
	if (state.phase === "east" || (state.phase !== "bethlehem" && state.phase !== "arrived" && state.x <= CARAVAN_JERUSALEM)) return clamp(state.x / CARAVAN_JERUSALEM, 0, 1);
	return clamp((state.x - CARAVAN_JERUSALEM) / (CARAVAN_END - CARAVAN_JERUSALEM), 0, 1);
}

/** How far along the whole journey, 0 in the east, 1 at the house. */
export function journeyProgress(state: Pick<CaravanState, "x">): number {
	return clamp(state.x / CARAVAN_END, 0, 1);
}

/** 0-1: how far into its stride the caravan is (a run of clean clears). */
export function stride(state: Pick<CaravanState, "streak">): number {
	return Math.min(1, state.streak / STRIDE_FULL);
}

function stumble(state: CaravanState, hazard: CaravanHazard, events: CaravanEvent[]) {
	hazard.touched = true;
	if (state.shield > 0) return;
	state.stumbles += 1;
	state.speed = Math.min(state.speed, STUMBLE_SPEED);
	state.stagger = STAGGER;
	state.shield = SHIELD;
	state.streak = 0;
	state.stumbledAt = state.t;
	events.push({ type: "stumble", kind: hazard.kind });
}

/** Advances the journey by one fixed step. Mutates and returns `state`; events say what happened. */
export function stepCaravan(state: CaravanState, input: CaravanInput, events: CaravanEvent[] = []): CaravanState {
	const dt = CARAVAN_STEP;
	if (state.phase === "jerusalem") {
		state.ended += dt;
		if (input.go) {
			state.phase = "bethlehem";
			state.legT = 0;
			state.speed = 0;
			state.starX = state.x + STAR_LEAD;
			state.jumpHeld = input.jump;
			state.ended = 0;
			events.push({ type: "depart" });
		}
		return state;
	}
	if (state.phase !== "east" && state.phase !== "bethlehem") {
		state.ended += dt;
		if (state.phase === "fell") {
			state.vy -= GRAVITY * dt;
			state.y = Math.max(-8, state.y + state.vy * dt);
		}
		return state;
	}

	state.t += dt;
	state.legT += dt;
	const stop = state.phase === "east" ? CARAVAN_JERUSALEM : CARAVAN_END;
	const pressed = input.jump && !state.jumpHeld;
	state.jumpHeld = input.jump;
	if (pressed) state.buffer = BUFFER;

	// Pace: the star's, more at full stride, more again while catching up; braking into the halt.
	state.stagger = Math.max(0, state.stagger - dt);
	state.shield = Math.max(0, state.shield - dt);
	const behind = state.starX - state.x > STAR_LEAD + 0.05;
	let target = STAR_SPEED + STRIDE_BONUS * stride(state) + (behind ? CATCH_UP : 0);
	if (input.duck && state.grounded) target *= DUCK_PACE;
	target = Math.max(0.6, Math.min(target, Math.sqrt(2 * BRAKE * Math.max(0, stop - state.x))));
	if (state.falling) target = Math.min(target, 2);
	if (state.stagger === 0) state.speed = state.speed < target ? Math.min(target, state.speed + ACCEL * dt) : Math.max(target, state.speed - ACCEL * 1.6 * dt);
	state.x += state.speed * dt;

	// Walking off a lip: a moment to still jump clear.
	if (state.grounded && ravineAt(state, state.x)) {
		state.grounded = false;
		state.falling = true;
		state.vy = 0;
		state.coyote = COYOTE;
	}
	const canJump = state.grounded || (state.falling && state.coyote > 0 && state.y > -0.35);
	if (state.buffer > 0 && canJump && state.stagger === 0) {
		state.grounded = false;
		state.falling = false;
		state.y = Math.max(0, state.y);
		state.vy = JUMP_SPEED;
		state.holdLeft = HOLD_MAX;
		state.buffer = 0;
		state.coyote = 0;
		events.push({ type: "jump", hold: input.jump });
	}
	state.buffer = Math.max(0, state.buffer - dt);
	state.coyote = Math.max(0, state.coyote - dt);

	if (!state.grounded) {
		let gravity = GRAVITY;
		if (input.jump && state.holdLeft > 0 && state.vy > 0) {
			gravity = HOLD_GRAVITY;
			state.holdLeft = Math.max(0, state.holdLeft - dt);
		} else state.holdLeft = 0;
		if (input.duck && !state.falling) gravity *= FAST_FALL;
		state.vy -= gravity * dt;
		state.y += state.vy * dt;
		if (!state.falling && state.y <= 0) {
			if (ravineAt(state, state.x)) {
				// Came down short (or long) over the drop: no catching the lip from the air.
				state.falling = true;
				state.coyote = 0;
			} else {
				state.y = 0;
				state.vy = 0;
				state.grounded = true;
				state.landedAt = state.t;
				events.push({ type: "land" });
			}
		}
		if (state.falling) {
			// Into the ravine: the far wall stops him.
			const ravine = ravineAt(state, state.x) ?? state.hazards.find((hazard) => hazard.kind === "ravine" && state.x >= hazard.x && state.x <= hazard.x + hazard.w + RAVINE_LIP);
			if (ravine) state.x = Math.min(state.x, ravine.x + ravine.w - RAVINE_LIP - 0.01);
			if (state.y < -FALL_DEPTH) {
				state.phase = "fell";
				state.ended = 0;
				events.push({ type: "fell" });
				return state;
			}
		}
	}
	state.ducking = input.duck && state.grounded;

	// Hazards near him: struck, or passed clean.
	const head = state.y + (state.ducking ? DUCK_HEIGHT : STAND_HEIGHT);
	for (const hazard of state.hazards) {
		if (hazard.kind === "gust" && hazard.x - state.x < GUST_WAKE && hazard.x + hazard.w > state.x - 40) hazard.x -= GUST_SPEED * dt;
		if (hazard.outcome !== null) continue;
		const from = hazard.x - CARAVAN_FOOT;
		const to = hazard.x + hazard.w + CARAVAN_FOOT;
		if (from > state.x + 1) continue;
		const over = state.x >= from && state.x <= to;
		if (over && hazard.kind === "rock" && state.y < hazard.h) stumble(state, hazard, events);
		if (over && (hazard.kind === "ledge" || hazard.kind === "gust") && head > OVERHEAD_CLEARANCE) stumble(state, hazard, events);
		if (state.x > to && !state.falling) {
			if (hazard.touched) hazard.outcome = "hit";
			else {
				hazard.outcome = "cleared";
				state.cleared += 1;
				state.streak += 1;
				events.push({ type: "cleared", kind: hazard.kind, streak: state.streak });
			}
		}
	}

	// The star goes on at its own pace; it never comes back toward him, and stops over where it leads.
	const starStop = stop + STAR_LEAD;
	const starPace = Math.min(STAR_SPEED, ACCEL * state.legT, Math.sqrt(2 * BRAKE * Math.max(0, starStop - state.starX)));
	state.starX = Math.min(starStop, Math.max(state.starX + starPace * dt, state.x + STAR_LEAD));
	const was = state.keep;
	state.keep = 100 * clamp(1 - (state.starX - state.x - STAR_LEAD - STAR_FREE) / STAR_SPAN, 0, 1);
	state.minKeep = Math.min(state.minKeep, state.keep);
	state.dip = Math.min(state.dip, state.keep);
	if (was >= 50 && state.keep < 50) events.push({ type: "slipping" });
	if (state.keep >= 100 && state.dip < 92) {
		state.dip = 100;
		events.push({ type: "star" });
	}

	if (state.keep <= 0) {
		state.phase = "lost";
		state.ended = 0;
		events.push({ type: "lost" });
	} else if (state.x >= stop - 0.02) {
		state.x = stop;
		state.speed = 0;
		state.phase = stop === CARAVAN_END ? "arrived" : "jerusalem";
		state.ended = 0;
		events.push({ type: stop === CARAVAN_END ? "arrived" : "jerusalem" });
	}
	return state;
}

/** The finished journey's numbers, or null while it is not finished. */
export function caravanResult(state: CaravanState): CaravanResult | null {
	if (state.phase !== "arrived") return null;
	return {
		faithKept: Math.round(state.minKeep),
		seconds: Math.round(state.t * 10) / 10,
		swellsCleared: state.cleared,
		stumbles: state.stumbles,
	};
}

/** The soonest the journey can be finished, flat out at the caravan's top pace: anything faster was not travelled. */
export const CARAVAN_MIN_SECONDS = Math.floor(CARAVAN_END / CARAVAN_TOP_SPEED);
