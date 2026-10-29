/**
 * The Caravan (LC-17851, docs/beta/games.md), Matthew 2:1-12: a fifteen
 * second side-scroller under the star. Pure and seeded so the tests play it;
 * no imports (Node's type stripping loads it), so a seed and a list of inputs
 * always play the same journey.
 *
 * The caravan goes on at the star's own pace; the player only jumps (rocks
 * and ravines) and ducks (low ledges and gusts of a sandstorm). Every hazard
 * struck is a stumble and lets the star draw ahead; the third loses it. If
 * the star is still kept to when the fifteen seconds are up, it stands over
 * the house in Bethlehem: that is the win. Jerusalem passes far off midway,
 * without a halt.
 */

/** The simulation's fixed step, in seconds. */
export const CARAVAN_STEP = 1 / 60;
/** How long the journey runs; reaching the house at the end is the win. */
export const CARAVAN_SECONDS = 15;
/** A survive round: it can only be won when the fifteen seconds are up. */
export const CARAVAN_MIN_SECONDS = CARAVAN_SECONDS;
/** The caravan's pace, paces a second: the star's own. */
export const CARAVAN_SPEED = 7.6;
/** Where the road ends, at the house in Bethlehem. */
export const CARAVAN_END = CARAVAN_SPEED * CARAVAN_SECONDS;
/** Where Jerusalem stands off the road, passed midway. */
export const CARAVAN_JERUSALEM = 54;
/** The stumble that loses the star. */
export const CARAVAN_HITS = 3;
/** What each stumble costs of the star (the score). */
export const CARAVAN_HIT_COST = 28;

/** The leader's height standing and ducking, and the underside of a ledge or gust. */
export const STAND_HEIGHT = 2;
export const DUCK_HEIGHT = 1;
export const OVERHEAD_CLEARANCE = 1.35;
/** Half the leader's footing, and the lip of a ravine he can still stand on. */
export const CARAVAN_FOOT = 0.3;
export const RAVINE_LIP = 0.42;

export const JUMP_SPEED = 10.5;
export const GRAVITY = 34;
/** Ducking in the air drops him faster. */
const FAST_FALL = 2.4;
/** A press just before landing still jumps; so does one just after walking off a lip. */
const BUFFER = 0.1;
const COYOTE = 0.08;
/** How deep he drops into a ravine before he scrambles out of it. */
const SCRAMBLE_DEPTH = 0.7;
const SCRAMBLE_SPEED = 9;
/** A stumble staggers him: no jumping for a moment. */
const STAGGER = 0.15;

const GUST_SPEED = 4;
/** A gust starts blowing toward the caravan this far ahead of it. */
export const GUST_WAKE = 26;

export type CaravanPhase = "running" | "arrived" | "lost";
export type HazardKind = "rock" | "ravine" | "ledge" | "gust";

export interface CaravanHazard {
	id: number;
	kind: HazardKind;
	/** Left edge, in paces from the east (a gust's moves as it blows). */
	x: number;
	w: number;
	/** A rock's height; 0 for the others. */
	h: number;
	outcome: "cleared" | "hit" | null;
	/** Set once it has struck the leader. */
	touched: boolean;
}

export interface CaravanInput {
	/** True on the step jump was pressed. */
	jump: boolean;
	/** True while duck is held. */
	duck: boolean;
}

export interface CaravanState {
	phase: CaravanPhase;
	/** Seconds on the road. */
	t: number;
	x: number;
	/** Height of the leader's feet above the road; below 0 in a ravine. */
	y: number;
	vy: number;
	speed: number;
	grounded: boolean;
	ducking: boolean;
	buffer: number;
	coyote: number;
	stagger: number;
	/** Kept to the star, 0-100: 100 less each stumble's cost. */
	keep: number;
	hits: number;
	cleared: number;
	jumps: number;
	hazards: CaravanHazard[];
	/** Sim times of the last landing and stumble, for the dust. */
	landedAt: number;
	stumbledAt: number;
	/** Seconds since the round ended, for the scenes. */
	ended: number;
	endedAt: number | null;
}

export type CaravanEvent =
	| { type: "jump" }
	| { type: "land" }
	| { type: "cleared"; kind: HazardKind; id: number }
	| { type: "stumble"; kind: HazardKind; id: number; hits: number }
	| { type: "arrived" }
	| { type: "lost" };

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

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

/** The road, laid out from the seed: one of each kind to start, then harder going. */
function layCourse(seed: number): CaravanHazard[] {
	const next = random(seed);
	const between = (low: number, high: number) => low + (high - low) * next();
	const hazards: CaravanHazard[] = [];
	const add = (kind: HazardKind, x: number, w: number, h: number) => hazards.push({ id: hazards.length + 1, kind, x, w, h, outcome: null, touched: false });
	// First steps: a rock to jump, a ledge to duck, a ravine to jump, each alone.
	add("rock", 13 + between(0, 1.5), between(0.8, 1), between(0.5, 0.6));
	add("ledge", 23 + between(0, 1.5), between(2.6, 3.2), 0);
	add("ravine", 33 + between(0, 1.5), between(2.2, 2.6), 0);
	let cursor = 42.5 + between(0, 1.5);
	const stop = CARAVAN_END - 9;
	while (cursor < stop) {
		const difficulty = clamp(cursor / CARAVAN_END, 0, 1);
		const roll = next();
		let after: number;
		if (roll < 0.2 && cursor > 40) {
			// It meets the caravan about nine paces before where it starts.
			const w = between(2.4, 3.2);
			add("gust", cursor + 9, w, 0);
			after = w + 4.5;
		} else if (roll < 0.5) {
			const w = between(0.7, 1.2);
			add("rock", cursor, w, between(0.45, 0.6 + 0.35 * difficulty));
			after = w + 5.4;
		} else if (roll < 0.76) {
			const w = between(2.2, 2.8 + 0.6 * difficulty);
			add("ravine", cursor, w, 0);
			after = w + 5.6;
		} else {
			const w = between(2.6, 4.4);
			add("ledge", cursor, w, 0);
			after = w + 4.2;
		}
		cursor += after + between(0.6, 4.2) * (1 - 0.5 * difficulty);
	}
	return hazards;
}

export function newCaravan(seed: number): CaravanState {
	return {
		phase: "running",
		t: 0,
		x: 0,
		y: 0,
		vy: 0,
		speed: CARAVAN_SPEED,
		grounded: true,
		ducking: false,
		buffer: 0,
		coyote: 0,
		stagger: 0,
		keep: 100,
		hits: 0,
		cleared: 0,
		jumps: 0,
		hazards: layCourse(seed),
		landedAt: -10,
		stumbledAt: -10,
		ended: 0,
		endedAt: null,
	};
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

/** How far along the road, 0 in the east, 1 at the house. */
export function journeyProgress(state: Pick<CaravanState, "x">): number {
	return clamp(state.x / CARAVAN_END, 0, 1);
}

/** Whether a hazard is jumped (rock, ravine) or ducked (ledge, gust). */
export function hazardAction(kind: HazardKind): "jump" | "duck" {
	return kind === "rock" || kind === "ravine" ? "jump" : "duck";
}

function stumble(state: CaravanState, hazard: CaravanHazard, events: CaravanEvent[]) {
	if (hazard.touched) return;
	hazard.touched = true;
	state.hits += 1;
	state.keep = Math.max(0, 100 - CARAVAN_HIT_COST * state.hits);
	state.stagger = STAGGER;
	state.stumbledAt = state.t;
	events.push({ type: "stumble", kind: hazard.kind, id: hazard.id, hits: state.hits });
}

/** Advances the journey by one fixed step. Mutates and returns `state`; events say what happened. */
export function stepCaravan(state: CaravanState, input: CaravanInput, events: CaravanEvent[] = []): CaravanState {
	if (state.phase !== "running") {
		state.ended += CARAVAN_STEP;
		return state;
	}
	const dt = CARAVAN_STEP;
	state.t += dt;
	state.stagger = Math.max(0, state.stagger - dt);
	if (input.jump) state.buffer = BUFFER;
	state.x += state.speed * dt;

	// Walking off a lip: a moment to still jump clear.
	if (state.grounded && ravineAt(state, state.x)) {
		state.grounded = false;
		state.vy = 0;
		state.coyote = COYOTE;
	}
	const canJump = state.grounded || (state.coyote > 0 && state.y > -0.3);
	if (state.buffer > 0 && canJump && state.stagger === 0) {
		state.grounded = false;
		state.y = Math.max(0, state.y);
		state.vy = JUMP_SPEED;
		state.buffer = 0;
		state.coyote = 0;
		state.jumps += 1;
		events.push({ type: "jump" });
	}
	state.buffer = Math.max(0, state.buffer - dt);
	state.coyote = Math.max(0, state.coyote - dt);

	if (!state.grounded) {
		state.vy -= GRAVITY * (input.duck && state.vy < 6 ? FAST_FALL : 1) * dt;
		state.y += state.vy * dt;
		const ravine = ravineAt(state, state.x);
		if (ravine) {
			// Over the drop: down into it, and a scramble up the far side, a stumble.
			if (state.y < -SCRAMBLE_DEPTH) {
				stumble(state, ravine, events);
				state.vy = SCRAMBLE_SPEED;
				state.coyote = 0;
			}
		} else if (state.y <= 0 && state.vy <= 0) {
			state.y = 0;
			state.vy = 0;
			state.grounded = true;
			state.landedAt = state.t;
			events.push({ type: "land" });
		}
	}
	state.ducking = input.duck && state.grounded;

	// Hazards near him: struck, or passed clean.
	const head = state.y + (state.ducking ? DUCK_HEIGHT : STAND_HEIGHT);
	for (const hazard of state.hazards) {
		if (hazard.kind === "gust" && hazard.x - state.x < GUST_WAKE && hazard.x + hazard.w > state.x - 30) hazard.x -= GUST_SPEED * dt;
		if (hazard.outcome !== null) continue;
		const from = hazard.x - CARAVAN_FOOT;
		const to = hazard.x + hazard.w + CARAVAN_FOOT;
		if (from > state.x + 1) continue;
		const over = state.x >= from && state.x <= to;
		if (over && hazard.kind === "rock" && state.y < hazard.h) {
			stumble(state, hazard, events);
			// Stumbling over it.
			if (state.grounded) {
				state.grounded = false;
				state.vy = 6;
			}
		}
		if (over && (hazard.kind === "ledge" || hazard.kind === "gust") && head > OVERHEAD_CLEARANCE) stumble(state, hazard, events);
		if (state.x > to && state.y >= -0.05) {
			if (hazard.touched) hazard.outcome = "hit";
			else {
				hazard.outcome = "cleared";
				state.cleared += 1;
				events.push({ type: "cleared", kind: hazard.kind, id: hazard.id });
			}
		}
	}

	if (state.hits >= CARAVAN_HITS) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= CARAVAN_SECONDS - 1e-9) {
		state.phase = "arrived";
		state.endedAt = state.t;
		events.push({ type: "arrived" });
	}
	return state;
}

/** The round's result once it has ended: kept to the star is the score, hazards passed clean the count. */
export function caravanResult(state: CaravanState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "running" || state.endedAt === null) return null;
	const won = state.phase === "arrived";
	return { won, score: won ? Math.round(state.keep) : 0, count: state.cleared, seconds: Math.round(state.endedAt * 10) / 10 };
}
