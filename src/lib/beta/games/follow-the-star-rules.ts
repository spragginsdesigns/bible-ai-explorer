/**
 * Follow the Star (LC-17851, docs/beta/games.md), a night-sky way to play
 * Matthew 2:1-12. This is the whole simulation: the page draws it and feeds
 * it input, and the tests play it tick by tick. Pure on purpose (no imports,
 * no DOM, no clock, its own seeded random), so a seed and a list of inputs
 * always play the same journey.
 *
 * The company travels in two legs. First from the east to Jerusalem (verse 1),
 * steering for the city on the horizon: a short leg that teaches the reins and
 * is not scored, because Matthew never says the star led them there. Then,
 * after Jerusalem (verses 3-8), "lo, the star, which they saw in the east,
 * went before them" (verse 9): the player steers the company's heading to
 * keep the star before them. A desert wind turns the company off its line,
 * cloud banks hide the star for a while (hold the course from memory; the
 * star waits where it was last seen), and ravines and rocky rises lie across
 * the way, so going around them takes the company off the star and it must
 * find it again. The score is how closely the company kept to the star over
 * the second leg. Losing sight of it for too long and the company is lost in
 * the night. The leg ends where the star "came and stood over where the
 * young child was".
 */

/** Simulation step, seconds; the page accumulates frame time into these. */
export const STAR_STEP = 1 / 60;
/** The company's best pace on clean ground, in the game's own units a second. */
export const STAR_TOP_SPEED = 4.6;
/** The two legs' lengths in the same units. Matthew gives no distances, so the player only sees how much of the way is done. */
export const EAST_LENGTH = 46;
export const STAR_LENGTH = 190;
/** How far off the heading (radians) the star can be and still be in view. */
export const STAR_VIEW_HALF = 0.55;
/** Seconds the star may be out of view before the company is lost. */
export const STAR_LOST_LIMIT = 5;
/** Within this the company is on the star (full credit); past STAR_NO_CREDIT it earns none. */
export const STAR_FULL_CREDIT = 0.045;
export const STAR_NO_CREDIT = 0.3;

const TURN_ACC = 1.7; // a held rein's turning push
const TURN_DAMP = 3; // the company turns steadily, never spins
const COMPANY_HALF = 0.7; // half the company's width
const ROUGH_SLOW = 0.32; // pace on rough ground
const ROUGH_PUSH = 2.8; // units a second the rough ground turns them along its edge
const SPAWN_AHEAD = 22; // a ravine or rise comes into sight this far ahead
const CLOUD_ROLL = 1.3; // seconds for a cloud bank to roll fully over the star
const STAR_WANDER = 0.24; // how far the star's bearing wanders either side of the way
/** Where the second leg's first ravine or rise lies: after verses 9 and 10 have been read. */
const FIRST_STAR_OBSTACLE = 52;
/** No cloud before this many seconds into the second leg. */
const FIRST_CLOUD = 13;

export type StarPhase = "east" | "jerusalem" | "star" | "arrived" | "lost";
export type StarObstacleKind = "ravine" | "rise";

export interface StarObstacle {
	id: number;
	kind: StarObstacleKind;
	/** Along the leg, and across it (right is positive), in units. */
	s: number;
	lat: number;
	/** Half its width across the way, and its depth along it. */
	half: number;
	depth: number;
	/** Set when the company has passed it: cleanly, or by blundering onto it. */
	outcome: "passed" | "struck" | null;
}

export interface StarInput {
	/** -1 turns left, 1 turns right, anything between is a lighter rein. */
	steer: number;
	/** True to depart from Jerusalem for Bethlehem. */
	go: boolean;
}

export interface StarState {
	phase: StarPhase;
	/** Seconds of travel over both legs (the time at Jerusalem is not counted). */
	t: number;
	/** Seconds into the current leg. */
	legT: number;
	/** Along the current leg, and the drift across it. */
	s: number;
	lat: number;
	/** Every unit walked, for the dunes. */
	travel: number;
	/** The company's heading off the leg's way, radians (right is positive), and how fast it is turning. */
	heading: number;
	turnVel: number;
	/** The desert wind turning the company, the turn it is building to, and when it changes. */
	wind: number;
	/** The quarter the wind is blowing from: -1 or 1. */
	windSide: number;
	windTarget: number;
	windUntil: number;
	nextWindAt: number;
	/** Where the company steers for, off the leg's way: Jerusalem (0) on the first leg, the star on the second. */
	bearing: number;
	/** The star's own clock: it waits under cloud, so a course held from memory still finds it. */
	starClock: number;
	starPhaseA: number;
	starPhaseB: number;
	/** Cloud over the star, 0-1, the cover it is moving to, and when that changes. */
	cover: number;
	cloudTarget: 0 | 1;
	cloudUntil: number;
	nextCloudAt: number;
	hidden: boolean;
	obstacles: StarObstacle[];
	nextObstacleS: number;
	nextObstacleId: number;
	/** Seconds left on rough ground (slow going). */
	rough: number;
	/** Credit for keeping to the star, summed per step, and the steps counted. */
	keptSum: number;
	keptSteps: number;
	/** Seconds the star has been out of view. */
	lostFor: number;
	/** Set while the star is out of view, to announce it once. */
	astray: boolean;
	/** The star has come to stand over the house. */
	stood: boolean;
	passed: number;
	struck: number;
	/** Cloud banks weathered with the star still in view when it came out. */
	cloudsHeld: number;
	/** Seconds since the journey ended (arrived or lost), for the scenes. */
	ended: number;
	seed: number;
}

export type StarEvent =
	| { type: "obstacle"; id: number; kind: StarObstacleKind }
	| { type: "passed"; id: number }
	| { type: "struck"; id: number }
	| { type: "jerusalem" }
	| { type: "depart" }
	| { type: "clouded" }
	| { type: "cleared"; inView: boolean }
	| { type: "astray" }
	| { type: "found" }
	| { type: "stood" }
	| { type: "lost" }
	| { type: "arrived" };

export interface StarResult {
	/** How closely the company kept to the star, 0-100: what grades the award. */
	faithKept: number;
	seconds: number;
	/** Ravines and rises passed without blundering onto them. */
	swellsCleared: number;
	struck: number;
}

/** mulberry32: small, fast and the same on every engine. */
function random(state: StarState): number {
	state.seed = (state.seed + 0x6d2b79f5) | 0;
	let r = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
	r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
	return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function between(state: StarState, low: number, high: number): number {
	return low + (high - low) * random(state);
}

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

function smooth(from: number, to: number, value: number): number {
	const x = clamp((value - from) / (to - from), 0, 1);
	return x * x * (3 - 2 * x);
}

/** An angle folded into -PI..PI. */
export function wrapAngle(angle: number): number {
	let a = angle % (Math.PI * 2);
	if (a > Math.PI) a -= Math.PI * 2;
	if (a < -Math.PI) a += Math.PI * 2;
	return a;
}

/** 0 at the leg's start, 1 at its end. */
export function legProgress(state: Pick<StarState, "phase" | "s">): number {
	const length = state.phase === "east" || state.phase === "jerusalem" ? EAST_LENGTH : STAR_LENGTH;
	return clamp(state.s / length, 0, 1);
}

/** How far the star is off the company's heading, radians (right is positive). */
export function starOffset(state: Pick<StarState, "heading" | "bearing">): number {
	return wrapAngle(state.bearing - state.heading);
}

/** The credit one step earns for being `off` radians from the star, 0-1. */
export function keptCredit(off: number): number {
	const a = Math.abs(off);
	return a <= STAR_FULL_CREDIT ? 1 : clamp(1 - (a - STAR_FULL_CREDIT) / (STAR_NO_CREDIT - STAR_FULL_CREDIT), 0, 1);
}

/** The score so far, 0-100. */
export function keptSoFar(state: Pick<StarState, "keptSum" | "keptSteps">): number {
	return state.keptSteps === 0 ? 100 : Math.round((100 * state.keptSum) / state.keptSteps);
}

function starBearing(state: StarState): number {
	// "Till it came and stood over where the young child was": it settles straight over the way's end.
	const amplitude = STAR_WANDER * (1 - smooth(0.78, 0.95, legProgress(state)));
	const c = state.starClock;
	return amplitude * (0.62 * Math.sin(0.23 * c + state.starPhaseA) + 0.38 * Math.sin(0.52 * c + state.starPhaseB));
}

function startLeg(state: StarState, phase: "east" | "star") {
	state.phase = phase;
	state.legT = 0;
	state.s = 0;
	state.lat = 0;
	state.heading = 0;
	state.turnVel = 0;
	state.wind = 0;
	state.windTarget = 0;
	state.windUntil = 0;
	state.nextWindAt = phase === "east" ? 2.5 : 3;
	state.obstacles = [];
	state.nextObstacleS = phase === "east" ? 16 : FIRST_STAR_OBSTACLE;
	state.rough = 0;
	state.cover = 0;
	state.cloudTarget = 0;
	state.cloudUntil = 0;
	state.nextCloudAt = FIRST_CLOUD;
	state.hidden = false;
	state.lostFor = 0;
	state.astray = false;
	state.starClock = 0;
	state.bearing = phase === "star" ? starBearing(state) : 0;
}

export function newJourney(seed: number): StarState {
	const state: StarState = {
		phase: "east",
		t: 0,
		legT: 0,
		s: 0,
		lat: 0,
		travel: 0,
		heading: 0,
		turnVel: 0,
		wind: 0,
		windSide: 1,
		windTarget: 0,
		windUntil: 0,
		nextWindAt: 0,
		bearing: 0,
		starClock: 0,
		starPhaseA: 0,
		starPhaseB: 0,
		cover: 0,
		cloudTarget: 0,
		cloudUntil: 0,
		nextCloudAt: 0,
		hidden: false,
		obstacles: [],
		nextObstacleS: 0,
		nextObstacleId: 1,
		rough: 0,
		keptSum: 0,
		keptSteps: 0,
		lostFor: 0,
		astray: false,
		stood: false,
		passed: 0,
		struck: 0,
		cloudsHeld: 0,
		ended: 0,
		seed: seed | 0,
	};
	state.starPhaseA = between(state, 0, Math.PI * 2);
	state.starPhaseB = between(state, 0, Math.PI * 2);
	state.windSide = random(state) < 0.5 ? -1 : 1;
	startLeg(state, "east");
	return state;
}

/** Advances the journey by one fixed step. Mutates and returns `state`; events say what happened. */
export function stepJourney(state: StarState, input: StarInput, events: StarEvent[] = []): StarState {
	const dt = STAR_STEP;
	if (state.phase === "jerusalem") {
		if (input.go) {
			startLeg(state, "star");
			events.push({ type: "depart" });
		}
		return state;
	}
	if (state.phase === "arrived" || state.phase === "lost") {
		state.ended += dt;
		return state;
	}

	const second = state.phase === "star";
	const length = second ? STAR_LENGTH : EAST_LENGTH;
	state.t += dt;
	state.legT += dt;
	const progress = legProgress(state);

	// The wind turns the company off its line: it builds, holds a while, then drops.
	if (state.legT >= state.nextWindAt) {
		// The wind keeps mostly to one quarter, so a company left to itself drifts away and stays away.
		const side = random(state) < 0.25 ? -state.windSide : state.windSide;
		state.windSide = side;
		const strength = (second ? 0.5 + 0.3 * progress : 0.22) * between(state, 0.8, 1.2);
		state.windTarget = side * strength;
		state.windUntil = state.legT + between(state, 2.6, 5);
		state.nextWindAt = state.windUntil + between(state, 0.8, 2.4);
	}
	if (state.windTarget !== 0 && state.legT >= state.windUntil) state.windTarget = 0;
	state.wind += (state.windTarget - state.wind) * Math.min(1, dt * 1.4);

	// The reins: a held turn pushes the heading round, the wind pushes it too, and it settles.
	const steer = clamp(input.steer, -1, 1);
	state.turnVel += (TURN_ACC * steer + state.wind - TURN_DAMP * state.turnVel) * dt;
	state.heading = wrapAngle(state.heading + state.turnVel * dt);

	// Cloud banks roll over the star and away again; the star waits under them.
	if (second) {
		if (state.cloudTarget === 0 && state.legT >= state.nextCloudAt && progress < 0.86) {
			state.cloudTarget = 1;
			state.cloudUntil = state.legT + CLOUD_ROLL + between(state, 2.2, 3.4) + 1.2 * progress;
		} else if (state.cloudTarget === 1 && state.legT >= state.cloudUntil) {
			state.cloudTarget = 0;
			state.nextCloudAt = state.legT + CLOUD_ROLL + between(state, 5.5, 9);
		}
		state.cover = clamp(state.cover + (state.cloudTarget === 1 ? dt : -dt) / CLOUD_ROLL, 0, 1);
		const hidden = state.cover >= 0.5;
		if (hidden !== state.hidden) {
			state.hidden = hidden;
			if (hidden) events.push({ type: "clouded" });
			else {
				const inView = Math.abs(starOffset(state)) <= STAR_VIEW_HALF;
				if (inView) state.cloudsHeld += 1;
				events.push({ type: "cleared", inView });
			}
		}
		if (!state.hidden) state.starClock += dt;
		state.bearing = starBearing(state);
	}

	// Forward along the heading; rough ground is slow going.
	state.rough = Math.max(0, state.rough - dt);
	const pace = STAR_TOP_SPEED * (state.rough > 0 ? ROUGH_SLOW : 1);
	state.s += pace * Math.cos(state.heading) * dt;
	state.lat += pace * Math.sin(state.heading) * dt;
	state.travel += pace * dt;

	// Ravines and rocky rises come into sight across the way the company should be going.
	if (state.s + SPAWN_AHEAD >= state.nextObstacleS && state.nextObstacleS < length - 12) {
		const kind: StarObstacleKind = random(state) < 0.5 ? "ravine" : "rise";
		const half = kind === "ravine" ? between(state, 1.4, 2) : between(state, 1, 1.4);
		const ahead = state.nextObstacleS - state.s;
		const obstacle: StarObstacle = {
			id: state.nextObstacleId++,
			kind,
			s: state.nextObstacleS,
			lat: state.lat + ahead * Math.tan(state.bearing) + between(state, -0.5, 0.5) * half,
			half,
			depth: kind === "ravine" ? 1.6 : 2.4,
			outcome: null,
		};
		state.obstacles.push(obstacle);
		state.nextObstacleS += (second ? between(state, 19, 26) : between(state, 14, 16)) * (1 - 0.2 * progress);
		events.push({ type: "obstacle", id: obstacle.id, kind });
	}
	for (const obstacle of state.obstacles) {
		const front = obstacle.s - obstacle.depth / 2;
		const back = obstacle.s + obstacle.depth / 2;
		if (state.s >= front && state.s <= back) {
			const gap = state.lat - obstacle.lat;
			if (Math.abs(gap) < obstacle.half + COMPANY_HALF) {
				const side = gap >= 0 ? 1 : -1;
				if (obstacle.outcome === null) {
					obstacle.outcome = "struck";
					state.struck += 1;
					// The ground turns them aside, off their line.
					state.turnVel += side * 1.1;
					events.push({ type: "struck", id: obstacle.id });
				}
				state.lat += side * ROUGH_PUSH * dt;
				state.rough = 0.5;
			}
		} else if (state.s > back && obstacle.outcome === null) {
			obstacle.outcome = "passed";
			state.passed += 1;
			events.push({ type: "passed", id: obstacle.id });
		}
	}
	if (state.obstacles.length && state.obstacles[0].s < state.s - 12) state.obstacles.shift();

	if (second) {
		// The score: how closely the company keeps to the star, step by step.
		// Blundering over rough ground is time off the way, so it earns nothing.
		const off = starOffset(state);
		state.keptSum += state.rough > 0 ? 0 : keptCredit(off);
		state.keptSteps += 1;
		// Out of view (cloud or not) the night closes in; back in view it lifts quickly.
		if (Math.abs(off) > STAR_VIEW_HALF) {
			state.lostFor += dt;
			if (!state.astray) {
				state.astray = true;
				events.push({ type: "astray" });
			}
		} else {
			state.lostFor = Math.max(0, state.lostFor - 2 * dt);
			if (state.astray) {
				state.astray = false;
				events.push({ type: "found" });
			}
		}
		if (!state.stood && progress >= 0.95) {
			state.stood = true;
			events.push({ type: "stood" });
		}
	}

	if (state.s >= length) {
		state.s = length;
		if (second) {
			state.phase = "arrived";
			state.ended = 0;
			state.cloudTarget = 0;
			events.push({ type: "arrived" });
		} else {
			state.phase = "jerusalem";
			events.push({ type: "jerusalem" });
		}
	} else if (second && state.lostFor >= STAR_LOST_LIMIT) {
		state.phase = "lost";
		state.ended = 0;
		events.push({ type: "lost" });
	}
	return state;
}

/** The finished journey's numbers, or null while it is not finished. */
export function journeyResult(state: StarState): StarResult | null {
	if (state.phase !== "arrived") return null;
	return {
		faithKept: keptSoFar(state),
		seconds: Math.round(state.t * 10) / 10,
		swellsCleared: state.passed,
		struck: state.struck,
	};
}

/** The soonest the journey can be finished, both legs at the top pace: anything faster was not travelled. */
export const STAR_MIN_SECONDS = Math.floor((EAST_LENGTH + STAR_LENGTH) / STAR_TOP_SPEED);
