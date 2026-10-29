/**
 * Through the Storm (LC-17851, docs/beta/games.md), the first-person way to
 * play Matthew 14:22-33. This is the whole simulation: the page draws it and
 * feeds it input, and the tests play it tick by tick. Pure on purpose (no
 * imports, no DOM, no clock, its own seeded random), so a seed and a list of
 * inputs always play the same walk.
 *
 * The player sees the storm through Peter's eyes. Jesus stands ahead on the
 * water; the wind and the sea keep dragging the gaze off him, and the player
 * steers it back. While Jesus is inside the focus ring Peter walks toward him
 * and faith holds or builds; looking away stops him, drains faith and lowers
 * him into the sea. Great swells roll in and he braces as each one reaches
 * him; one that catches him unbraced throws his eyes off Jesus. At no faith he
 * begins to sink, and crying "Lord, save me" brings the rescue of verse 31.
 * Reaching Jesus completes the walk.
 *
 * Gaze is measured in focus-ring radii: `gazeX`/`gazeY` are where Jesus is
 * from the centre of the view (x to the right, y downward), so he is in the
 * ring while their length is under 1.
 */

/**
 * The walk's length in the game's own units. Matthew 14 gives no distance, so
 * the player is only ever shown how much of the way is walked.
 */
export const STORM_GOAL = 130;
/** The simulation runs in fixed steps; the page accumulates frame time into them. */
export const STORM_STEP = 1 / 60;
/** Peter's best pace, units a second: eyes dead on Jesus at full faith. */
export const STORM_TOP_SPEED = 3;
/** Seconds a great swell takes from rising on the sea to reaching Peter. */
export const SWELL_WARNING = 2.8;
/** Seconds Peter stays braced after the brace control goes down. */
export const BRACE_HOLD = 0.42;
/** How far (in ring radii) the view can be dragged from Jesus before it stops. */
export const GAZE_LIMIT_X = 5;
export const GAZE_LIMIT_Y = 3.5;

const START_FAITH = 80;
const TURN = 2.6; // ring radii a second at a full look
const DRAG_STEP_LIMIT = 0.4; // ring radii one step of dragging may move the view
const DRIFT_X = 0.35; // an off-centre gaze keeps sliding away
const DRIFT_Y = 0.3;
const KICK_DECAY = 3.5;
const BRACE_COOLDOWN = 0.4;
const BRACED_PACE = 0.3;
const SWELL_STRIKE_FAITH = 25;
const SWELL_BRACED_FAITH = 3;
const FOUND_INSIDE = 0.9; // hysteresis for the lost/found announcements

export type StormPhase = "walking" | "sinking" | "rescued" | "arrived";

export interface StormInput {
	/** Turn the view: -1 left, 1 right; -1 up, 1 down. Keys and look buttons give whole numbers. */
	lookX: number;
	lookY: number;
	/** Direct drag this step, in ring radii, moving Jesus with the finger (x right, y down). */
	dragX: number;
	dragY: number;
	/** True on the step the brace control went down. */
	brace: boolean;
	/** True on the step "Lord, save me" was pressed. */
	cry: boolean;
}

export interface StormSwell {
	id: number;
	/** Seconds until its crest reaches Peter. */
	eta: number;
	outcome: "braced" | "struck" | null;
}

export interface StormState {
	phase: StormPhase;
	/** Seconds since he stepped out of the ship. */
	t: number;
	/** Units walked toward Jesus. */
	x: number;
	faith: number;
	/** The lowest faith of this walk, which grades the award. */
	minFaith: number;
	/** Where Jesus is from the centre of the view, in ring radii. */
	gazeX: number;
	gazeY: number;
	/** What a crest or a landing threw the view by, dying away. */
	kickX: number;
	kickY: number;
	/** The wind's drag on the view right now, and the drag it is building toward. */
	wind: number;
	gustTarget: number;
	gustUntil: number;
	nextGustAt: number;
	/** Eyes on Jesus, for the announcements: lost on leaving the ring, found again well inside it. */
	onTarget: boolean;
	/** 0-1: how squarely he is looking at Jesus, which sets the pace. */
	focus: number;
	/** 0-1: how low in the water the view has dropped. */
	dip: number;
	/** Seconds left braced, and before he can brace again. */
	brace: number;
	braceCooldown: number;
	swells: StormSwell[];
	nextSwellAt: number;
	nextSwellId: number;
	swellsBraced: number;
	swellsStruck: number;
	/** How far under he has gone once sinking, 0-1. */
	sink: number;
	/** Seconds since the walk ended (sinking, rescued or arrived), for the scenes. */
	ended: number;
	seed: number;
}

export type StormEvent =
	| { type: "gust"; side: -1 | 1; strength: number }
	| { type: "swell"; id: number }
	| { type: "brace" }
	| { type: "braced"; id: number }
	| { type: "struck"; id: number }
	| { type: "lost" }
	| { type: "found" }
	| { type: "sinking" }
	| { type: "rescued" }
	| { type: "arrived" };

export interface StormResult {
	/** The lowest faith of the walk, rounded: what grades the award. */
	faithKept: number;
	seconds: number;
	/** Great swells braced against. */
	swellsCleared: number;
	swellsStruck: number;
}

/** mulberry32: small, fast and the same on every engine. */
function random(state: StormState): number {
	state.seed = (state.seed + 0x6d2b79f5) | 0;
	let r = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
	r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
	return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function between(state: StormState, low: number, high: number): number {
	return low + (high - low) * random(state);
}

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

/** 0 at the ship, 1 at Jesus: the storm gets rougher the further he goes. */
export function stormProgress(state: Pick<StormState, "x">): number {
	return clamp(state.x / STORM_GOAL, 0, 1);
}

/** How far Jesus is from the centre of the view, in ring radii. */
export function gazeOff(state: Pick<StormState, "gazeX" | "gazeY">): number {
	return Math.hypot(state.gazeX, state.gazeY);
}

/** The swell that reaches him next, if one is rolling in. */
export function nextSwell(state: Pick<StormState, "swells">): StormSwell | null {
	for (const swell of state.swells) if (swell.outcome === null) return swell;
	return null;
}

export function newStorm(seed: number): StormState {
	return {
		phase: "walking",
		t: 0,
		x: 0,
		faith: START_FAITH,
		minFaith: START_FAITH,
		gazeX: 0,
		gazeY: 0,
		kickX: 0,
		kickY: 0,
		wind: 0,
		gustTarget: 0,
		gustUntil: 0,
		// A calm first moment to find him on the water.
		nextGustAt: 2.4,
		onTarget: true,
		focus: 1,
		dip: 0,
		brace: 0,
		braceCooldown: 0,
		swells: [],
		nextSwellAt: 5.5,
		nextSwellId: 1,
		swellsBraced: 0,
		swellsStruck: 0,
		sink: 0,
		ended: 0,
		seed: seed | 0,
	};
}

/** Advances the walk by one fixed step. Mutates and returns `state`; events say what happened. */
export function stepStorm(state: StormState, input: StormInput, events: StormEvent[] = []): StormState {
	const dt = STORM_STEP;
	if (state.phase !== "walking") {
		state.ended += dt;
		if (state.phase === "sinking") {
			state.sink = Math.min(1, state.sink + dt * 0.5);
			state.dip = Math.min(1, state.dip + dt);
			if (input.cry) {
				state.phase = "rescued";
				state.ended = 0;
				events.push({ type: "rescued" });
			}
		}
		return state;
	}

	state.t += dt;
	const progress = stormProgress(state);
	const rough = 0.4 + 0.55 * progress;

	// The wind: a gust builds over a moment (the rain slants and the wind rises before it bites), holds, then dies away.
	if (state.t >= state.nextGustAt) {
		const side: -1 | 1 = random(state) < 0.5 ? -1 : 1;
		const strength = (1 + 1.4 * progress) * between(state, 0.8, 1.2);
		state.gustTarget = side * strength;
		state.gustUntil = state.t + between(state, 1.1, 2.2);
		state.nextGustAt = state.gustUntil + between(state, 1.2, 3.2) * (1 - 0.35 * progress);
		events.push({ type: "gust", side, strength });
	}
	if (state.gustTarget !== 0 && state.t >= state.gustUntil) state.gustTarget = 0;
	state.wind += (state.gustTarget - state.wind) * Math.min(1, dt * 2.4);

	// The view: the sea pitches and rolls it, the wind drags it aside, an off-centre gaze keeps sliding, and the player steers it back.
	const seaX = 0.35 * Math.sin(state.t * 0.7 + 0.4) * rough;
	const seaY = (0.7 * Math.sin(state.t * 1.2) + 0.45 * Math.sin(state.t * 2.5 + 1.3)) * rough;
	const lookX = clamp(input.lookX, -1, 1);
	const lookY = clamp(input.lookY, -1, 1);
	state.gazeX += (DRIFT_X * state.gazeX + state.wind + seaX + state.kickX - TURN * lookX) * dt;
	state.gazeY += (DRIFT_Y * state.gazeY + seaY + state.kickY - TURN * lookY) * dt;
	state.gazeX += clamp(input.dragX, -DRAG_STEP_LIMIT, DRAG_STEP_LIMIT);
	state.gazeY += clamp(input.dragY, -DRAG_STEP_LIMIT, DRAG_STEP_LIMIT);
	state.gazeX = clamp(state.gazeX, -GAZE_LIMIT_X, GAZE_LIMIT_X);
	state.gazeY = clamp(state.gazeY, -GAZE_LIMIT_Y, GAZE_LIMIT_Y);
	const decay = Math.exp(-KICK_DECAY * dt);
	state.kickX *= decay;
	state.kickY *= decay;

	const off = gazeOff(state);
	const inRing = off < 1;
	if (state.onTarget && !inRing) {
		state.onTarget = false;
		events.push({ type: "lost" });
	} else if (!state.onTarget && off < FOUND_INSIDE) {
		state.onTarget = true;
		events.push({ type: "found" });
	}
	state.focus = off <= 0.5 ? 1 : off < 1 ? 1 - (off - 0.5) * 0.8 : 0;

	// Bracing for a swell.
	state.braceCooldown = Math.max(0, state.braceCooldown - dt);
	if (state.brace > 0) {
		state.brace = Math.max(0, state.brace - dt);
		if (state.brace === 0) state.braceCooldown = BRACE_COOLDOWN;
	} else if (input.brace && state.braceCooldown === 0) {
		state.brace = BRACE_HOLD;
		events.push({ type: "brace" });
	}

	// Faith follows his eyes: on Jesus it builds, off him it drains, the further away the faster.
	if (inRing) state.faith += 5 * dt;
	else state.faith -= (9 + 10 * Math.min(3, off - 1)) * dt;

	// The sea climbs the view as he looks away and as his faith fails.
	const dipTarget = Math.max(inRing ? 0 : 0.75, clamp((50 - state.faith) / 50, 0, 1));
	state.dip += clamp(dipTarget - state.dip, -dt * 0.9, dt * 1.5);

	// Forward, only while his eyes are on Jesus.
	const pace = STORM_TOP_SPEED * state.focus * (0.7 + 0.3 * clamp(state.faith, 0, 100) / 100) * (state.brace > 0 ? BRACED_PACE : 1);
	state.x += pace * dt;

	// Great swells rise ahead and roll in toward him.
	if (state.t >= state.nextSwellAt && state.x < STORM_GOAL - 10) {
		const swell = { id: state.nextSwellId++, eta: SWELL_WARNING, outcome: null };
		state.swells.push(swell);
		state.nextSwellAt = state.t + between(state, 4.2, 6) * (1 - 0.3 * progress);
		events.push({ type: "swell", id: swell.id });
	}
	for (const swell of state.swells) {
		swell.eta -= dt;
		if (swell.outcome === null && swell.eta <= 0) {
			if (state.brace > 0) {
				swell.outcome = "braced";
				state.swellsBraced += 1;
				state.faith += SWELL_BRACED_FAITH;
				state.kickY += 0.8;
				events.push({ type: "braced", id: swell.id });
			} else {
				swell.outcome = "struck";
				state.swellsStruck += 1;
				state.faith -= SWELL_STRIKE_FAITH;
				// The crest throws his head back and aside: his eyes leave Jesus.
				state.kickY += 4.2;
				state.kickX += between(state, 0.6, 1) * (random(state) < 0.5 ? -2 : 2);
				events.push({ type: "struck", id: swell.id });
			}
		}
	}
	// Forget crests well past him.
	if (state.swells.length && state.swells[0].eta < -3) state.swells.shift();

	state.faith = clamp(state.faith, 0, 100);
	state.minFaith = Math.min(state.minFaith, state.faith);

	if (state.x >= STORM_GOAL) {
		state.x = STORM_GOAL;
		state.phase = "arrived";
		state.ended = 0;
		state.brace = 0;
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
export function stormResult(state: StormState): StormResult | null {
	if (state.phase !== "arrived") return null;
	return {
		faithKept: Math.round(state.minFaith),
		seconds: Math.round(state.t * 10) / 10,
		swellsCleared: state.swellsBraced,
		swellsStruck: state.swellsStruck,
	};
}

/** The soonest a walk can finish: every step at his top pace, eyes dead on Jesus at full faith. Anything faster was not walked. */
export const STORM_MIN_SECONDS = Math.floor(STORM_GOAL / STORM_TOP_SPEED);
