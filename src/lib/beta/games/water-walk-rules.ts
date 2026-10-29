/**
 * Peter's Water Walk (LC-17850, docs/beta/games.md), the chapter game for
 * Matthew 14:22-33. This is the whole simulation: the page draws it and feeds
 * it input, and the tests play it tick by tick. Pure on purpose (no imports,
 * no DOM, no clock, its own seeded random), so a seed and a list of inputs
 * always play the same walk.
 *
 * Peter walks from the ship toward Jesus across a storm. Gusts of the
 * "wind boisterous" push him off balance and he leans against them; swells
 * roll in from Jesus' side and he steps up over each crest. Standing steady
 * (eyes on Jesus) builds faith; tipping and being struck by a swell drain it.
 * At no faith he begins to sink, and crying "Lord, save me" brings the rescue
 * of verse 31. Reaching Jesus completes the walk.
 */

/** Cubits from the ship to Jesus. */
export const WALK_GOAL = 150;
/** The simulation runs in fixed steps; the page accumulates frame time into them. */
export const WALK_STEP = 1 / 60;
/** Peter's best pace, cubits a second (steady, full faith). */
export const WALK_TOP_SPEED = 5.6;
/** Faith below this and the water starts to climb his legs. */
export const SINK_SHOWS_BELOW = 45;

const TIP = 1.7; // he is upright on the water, not anchored: tilt grows on its own
const LEAN = 5.2; // how hard a held lean pushes back
const DAMP = 2.9;
const TILT_LIMIT = 1.15;
/** Seconds off the water when he steps up. */
export const WALK_JUMP_AIR = 0.56;
const JUMP_COOLDOWN = 0.25;
const SWELL_SPEED = 8.5; // cubits a second, rolling toward the ship
const SWELL_SPAWN_AHEAD = 30;
const SWELL_HIT_FAITH = 26;
const SWELL_CLEAR_FAITH = 4;

export type WalkPhase = "walking" | "sinking" | "rescued" | "arrived";

export interface WalkInput {
	/** -1 leans toward the ship (left), 1 toward Jesus (right), 0 stands. */
	lean: number;
	/** True on the step the step-up control went down. */
	jump: boolean;
	/** True on the step "Lord, save me" was pressed. */
	cry: boolean;
}

export interface WalkSwell {
	id: number;
	/** The crest's position in cubits from the ship. */
	x: number;
	/** Set once the crest has passed Peter. */
	outcome: "cleared" | "hit" | null;
}

export interface WalkState {
	phase: WalkPhase;
	/** Seconds since he stepped out of the ship. */
	t: number;
	/** Cubits walked. */
	x: number;
	/** Balance: 0 upright, past +-1 he is falling. Positive leans toward Jesus. */
	tilt: number;
	tiltVel: number;
	faith: number;
	/** The lowest faith of this walk, which grades the award. */
	minFaith: number;
	/** Seconds left in the air on a step up, 0 on the water. */
	air: number;
	jumpCooldown: number;
	/** The wind's push on his balance right now, and the push it is building toward. */
	wind: number;
	gustTarget: number;
	gustUntil: number;
	nextGustAt: number;
	swells: WalkSwell[];
	nextSwellAt: number;
	nextSwellId: number;
	swellsCleared: number;
	swellsHit: number;
	/** How far under he has gone once sinking, 0-1. */
	sink: number;
	/** Seconds since the walk ended (sinking, rescued or arrived), for the scenes. */
	ended: number;
	seed: number;
}

export type WalkEvent =
	| { type: "gust"; side: -1 | 1; strength: number }
	| { type: "swell"; id: number }
	| { type: "jump" }
	| { type: "cleared"; id: number }
	| { type: "hit"; id: number }
	| { type: "sinking" }
	| { type: "rescued" }
	| { type: "arrived" };

export interface WalkResult {
	/** The lowest faith of the walk, rounded: what grades the award. */
	faithKept: number;
	seconds: number;
	swellsCleared: number;
	swellsHit: number;
}

/** mulberry32: small, fast and the same on every engine. */
function random(state: WalkState): number {
	state.seed = (state.seed + 0x6d2b79f5) | 0;
	let r = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
	r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
	return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function between(state: WalkState, low: number, high: number): number {
	return low + (high - low) * random(state);
}

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

/** 0 at the ship, 1 at Jesus: the storm gets rougher the further he goes. */
export function walkProgress(state: Pick<WalkState, "x">): number {
	return clamp(state.x / WALK_GOAL, 0, 1);
}

export function newWalk(seed: number): WalkState {
	return {
		phase: "walking",
		t: 0,
		x: 0,
		tilt: 0,
		tiltVel: 0,
		faith: 80,
		minFaith: 80,
		air: 0,
		jumpCooldown: 0,
		wind: 0,
		gustTarget: 0,
		gustUntil: 0,
		// A calm first moment to find his feet.
		nextGustAt: 2.2,
		swells: [],
		nextSwellAt: 4,
		nextSwellId: 1,
		swellsCleared: 0,
		swellsHit: 0,
		sink: 0,
		ended: 0,
		seed: seed | 0,
	};
}

/** How steady he is, 0-1: the pace and the faith both follow it. */
export function steadiness(tilt: number): number {
	return clamp(1 - Math.abs(tilt) / 0.9, 0, 1);
}

/** Advances the walk by one fixed step. Mutates and returns `state`; events say what happened. */
export function stepWalk(state: WalkState, input: WalkInput, events: WalkEvent[] = []): WalkState {
	const dt = WALK_STEP;
	if (state.phase !== "walking") {
		state.ended += dt;
		if (state.phase === "sinking") {
			state.sink = Math.min(1, state.sink + dt * 0.55);
			if (input.cry) {
				state.phase = "rescued";
				state.ended = 0;
				events.push({ type: "rescued" });
			}
		}
		return state;
	}

	state.t += dt;
	const progress = walkProgress(state);

	// The wind: a gust builds over a moment (the rain shows it coming), holds, then dies away.
	if (state.t >= state.nextGustAt) {
		const side: -1 | 1 = random(state) < 0.5 ? -1 : 1;
		const strength = (1.9 + 2.3 * progress) * between(state, 0.8, 1.15);
		state.gustTarget = side * strength;
		state.gustUntil = state.t + between(state, 1.2, 2.3);
		state.nextGustAt = state.gustUntil + between(state, 1.4, 3.6) * (1 - 0.35 * progress);
		events.push({ type: "gust", side, strength });
	}
	if (state.gustTarget !== 0 && state.t >= state.gustUntil) state.gustTarget = 0;
	state.wind += (state.gustTarget - state.wind) * Math.min(1, dt * 2.6);

	// Balance: an upright body on moving water, the sea's own roll, the wind, and his lean.
	const roll = 0.55 * Math.sin(state.t * 1.3) + 0.35 * Math.sin(state.t * 2.7 + 1.1);
	const lean = clamp(input.lean, -1, 1);
	const acceleration = TIP * state.tilt + roll * (0.6 + 0.6 * progress) + state.wind - LEAN * lean - DAMP * state.tiltVel;
	state.tiltVel += acceleration * dt;
	state.tilt += state.tiltVel * dt;
	if (Math.abs(state.tilt) > TILT_LIMIT) {
		state.tilt = Math.sign(state.tilt) * TILT_LIMIT;
		state.tiltVel = 0;
	}

	// Stepping up over a crest.
	state.jumpCooldown = Math.max(0, state.jumpCooldown - dt);
	if (state.air > 0) {
		state.air = Math.max(0, state.air - dt);
		// Landing costs a little balance.
		if (state.air === 0) state.tiltVel += between(state, -0.45, 0.45);
	} else if (input.jump && state.jumpCooldown === 0) {
		state.air = WALK_JUMP_AIR;
		state.jumpCooldown = WALK_JUMP_AIR + JUMP_COOLDOWN;
		events.push({ type: "jump" });
	}

	// Faith follows where he is looking: steady builds it, tipping drains it.
	const off = Math.abs(state.tilt);
	if (off < 0.28) state.faith += 4.5 * dt;
	else if (off > 0.5) state.faith -= (off - 0.5) * 85 * dt;

	// Forward, as steady as he is.
	const pace = WALK_TOP_SPEED * steadiness(state.tilt) * (0.55 + 0.45 * clamp(state.faith, 0, 100) / 100);
	state.x += pace * dt;

	// Swells roll in from Jesus' side toward the ship.
	if (state.t >= state.nextSwellAt && state.x < WALK_GOAL - 18) {
		const swell = { id: state.nextSwellId++, x: state.x + SWELL_SPAWN_AHEAD, outcome: null };
		state.swells.push(swell);
		state.nextSwellAt = state.t + between(state, 3.4, 5.2) * (1 - 0.3 * progress);
		events.push({ type: "swell", id: swell.id });
	}
	for (const swell of state.swells) {
		swell.x -= SWELL_SPEED * dt;
		if (swell.outcome === null && swell.x <= state.x) {
			if (state.air > 0) {
				swell.outcome = "cleared";
				state.swellsCleared += 1;
				state.faith += SWELL_CLEAR_FAITH;
				events.push({ type: "cleared", id: swell.id });
			} else {
				swell.outcome = "hit";
				state.swellsHit += 1;
				state.faith -= SWELL_HIT_FAITH;
				// The crest shoves him back toward the ship.
				state.tiltVel -= 2;
				events.push({ type: "hit", id: swell.id });
			}
		}
	}
	// Forget crests well behind him.
	if (state.swells.length && state.swells[0].x < state.x - 40) state.swells.shift();

	state.faith = clamp(state.faith, 0, 100);
	state.minFaith = Math.min(state.minFaith, state.faith);

	if (state.x >= WALK_GOAL) {
		state.x = WALK_GOAL;
		state.phase = "arrived";
		state.ended = 0;
		events.push({ type: "arrived" });
	} else if (state.faith <= 0) {
		state.phase = "sinking";
		state.ended = 0;
		state.sink = Math.max(state.sink, 0.35);
		events.push({ type: "sinking" });
	}
	return state;
}

/** The finished walk's numbers, or null while it is not finished. */
export function walkResult(state: WalkState): WalkResult | null {
	if (state.phase !== "arrived") return null;
	return {
		faithKept: Math.round(state.minFaith),
		seconds: Math.round(state.t * 10) / 10,
		swellsCleared: state.swellsCleared,
		swellsHit: state.swellsHit,
	};
}

/** The soonest a walk can finish, flat out: anything faster was not walked. */
export const WALK_MIN_SECONDS = Math.floor(WALK_GOAL / WALK_TOP_SPEED);
