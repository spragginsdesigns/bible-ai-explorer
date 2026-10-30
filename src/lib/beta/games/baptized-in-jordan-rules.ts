/**
 * Baptized in Jordan (LC-17908, docs/beta/games.md), Matthew 3:1-17: John the
 * Baptist in the wilderness of Judaea, and the people "baptized of him in
 * Jordan, confessing their sins" (v6). Pure and seeded so the tests play it;
 * no imports (Node's type stripping loads it).
 *
 * A hold-and-release power meter. The penitents come down the bank one after
 * another. For each, holding lowers them back under the water, faster the
 * longer it is held, at a pace of their own; letting go raises them. Let go
 * inside the band (under the water, before the line) and they are baptized;
 * let go too soon, or hold past the line, and they come up to be done again.
 * The band narrows from one to the next. When all are baptized the round is
 * won, and the stage plays the closing scene: Jesus comes from Galilee, goes
 * up straightway out of the water, the heavens are opened and the Spirit
 * descends like a dove (vv13-16). His baptism is never a skill check.
 */

export const JORDAN_STEP = 1 / 60;
/** The round's length. */
export const JORDAN_SECONDS = 15;
/** How many come down to be baptized. */
export const JORDAN_COUNT = 5;
/** Seconds for each to come down the bank into the water. */
export const JORDAN_WALK = 0.55;
/** Seconds to raise them up out of the water once let go. */
export const JORDAN_RISE = 0.4;
/** The depth gauge runs from 0 (standing) to this (as deep as he can lay them). */
export const JORDAN_DEPTH = 100;
/** The band's width, in gauge units, for each in turn: it narrows. */
export const JORDAN_WIDTHS = [27, 23, 19, 16, 13] as const;
/** Where the band starts (the water closes over them), drawn per penitent. */
export const JORDAN_LOW = [50, 64] as const;
/** The lowering pace: depth per second is `pace * (JORDAN_BASE + surge * held seconds)`. */
export const JORDAN_PACE = [64, 96] as const;
export const JORDAN_SURGE = [0.4, 1.7] as const;
export const JORDAN_BASE = 0.55;

export interface Penitent {
	pace: number;
	surge: number;
	/** The band: under the water from `low`, too long at `high`. */
	low: number;
	high: number;
}

export type JordanStage = "walk" | "ready" | "lower" | "rise";
export type JordanMark = "baptized" | "short" | "long";

export interface JordanState {
	t: number;
	tick: number;
	penitents: Penitent[];
	/** Who is in the water now (0-based). */
	index: number;
	stage: JordanStage;
	/** Seconds in the current stage. */
	stageT: number;
	/** How long the current lowering has been held. */
	held: number;
	depth: number;
	/** Depth when let go (or when the line was passed), for the gauge's mark and the rise. */
	released: number;
	/** A new lowering waits for the hold to be let go first. */
	armed: boolean;
	/** How the last lowering ended. */
	mark: JordanMark | null;
	misses: number;
	/** 0-1 per baptism: how near the band's centre they were raised. */
	accuracy: number[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type JordanEvent =
	| { type: "come"; index: number }
	| { type: "lower"; index: number }
	| { type: "under"; index: number }
	| { type: "baptized"; index: number; accuracy: number }
	| { type: "short"; index: number }
	| { type: "long"; index: number }
	| { type: "won" }
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

const between = (range: readonly [number, number], r: number) => range[0] + (range[1] - range[0]) * r;

export function newJordan(seed: number, penitents?: Penitent[]): JordanState {
	const next = random(seed);
	const drawn =
		penitents ??
		JORDAN_WIDTHS.map((width) => {
			const low = Math.round(between(JORDAN_LOW, next()));
			return { pace: between(JORDAN_PACE, next()), surge: between(JORDAN_SURGE, next()), low, high: low + width };
		});
	return {
		t: 0,
		tick: 0,
		penitents: drawn,
		index: 0,
		stage: "walk",
		stageT: 0,
		held: 0,
		depth: 0,
		released: 0,
		armed: true,
		mark: null,
		misses: 0,
		accuracy: [],
		phase: "playing",
		endedAt: null,
	};
}

/** Depth per second for a penitent after `held` seconds of holding. */
export function jordanRate(penitent: Penitent, held: number): number {
	return penitent.pace * (JORDAN_BASE + penitent.surge * held);
}

export function jordanPenitent(state: JordanState): Penitent | null {
	return state.penitents[state.index] ?? null;
}

/** How near the band's centre a depth is, 1 at the centre and 0 at its edges. */
export function jordanAccuracy(penitent: Penitent, depth: number): number {
	const half = (penitent.high - penitent.low) / 2;
	return Math.max(0, 1 - Math.abs(depth - (penitent.low + half)) / half);
}

export function stepJordan(state: JordanState, input: { hold: boolean }, events: JordanEvent[] = []): JordanState {
	if (state.phase !== "playing") return state;
	const dt = JORDAN_STEP;
	const penitent = state.penitents[state.index];
	if (state.tick === 0) events.push({ type: "come", index: 0 });
	state.stageT += dt;
	if (state.stage === "walk") {
		if (state.stageT >= JORDAN_WALK - 1e-9) {
			state.stage = "ready";
			state.stageT = 0;
		}
	} else if (state.stage === "ready") {
		if (input.hold && state.armed) {
			state.stage = "lower";
			state.stageT = 0;
			state.held = 0;
			state.depth = 0;
			state.mark = null;
			state.armed = false;
			events.push({ type: "lower", index: state.index });
		}
	} else if (state.stage === "lower") {
		if (!input.hold) {
			state.released = state.depth;
			state.stage = "rise";
			state.stageT = 0;
			if (state.depth >= penitent.low) {
				const accuracy = jordanAccuracy(penitent, state.depth);
				state.accuracy.push(accuracy);
				state.mark = "baptized";
				events.push({ type: "baptized", index: state.index, accuracy });
				if (state.accuracy.length >= JORDAN_COUNT) {
					state.phase = "won";
					state.endedAt = state.t + dt;
					events.push({ type: "won" });
				}
			} else {
				state.misses += 1;
				state.mark = "short";
				events.push({ type: "short", index: state.index });
			}
		} else {
			const before = state.depth;
			state.depth += jordanRate(penitent, state.held) * dt;
			state.held += dt;
			if (before < penitent.low && state.depth >= penitent.low) events.push({ type: "under", index: state.index });
			if (state.depth >= penitent.high) {
				// Held past the line: he raises them, to be done again.
				state.depth = Math.min(JORDAN_DEPTH, state.depth);
				state.released = state.depth;
				state.misses += 1;
				state.mark = "long";
				state.stage = "rise";
				state.stageT = 0;
				events.push({ type: "long", index: state.index });
			}
		}
	} else if (state.stage === "rise") {
		state.depth = Math.max(0, state.released * (1 - state.stageT / JORDAN_RISE));
		if (state.stageT >= JORDAN_RISE - 1e-9) {
			state.depth = 0;
			state.stageT = 0;
			if (state.mark === "baptized") {
				state.index += 1;
				state.stage = "walk";
				events.push({ type: "come", index: state.index });
			} else state.stage = "ready";
		}
	}
	if (!input.hold) state.armed = true;
	state.t += dt;
	state.tick += 1;
	if (state.phase === "playing" && state.t >= JORDAN_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/**
 * The soonest a round can be won: every penitent at the quickest pace and
 * surge, the band at its shallowest, each let go the moment the water is over
 * them. Played through `stepJordan` itself, so it counts every step.
 */
function fastestWin(): number {
	const quickest = JORDAN_WIDTHS.map((width) => ({ pace: JORDAN_PACE[1], surge: JORDAN_SURGE[1], low: JORDAN_LOW[0], high: JORDAN_LOW[0] + width }));
	const state = newJordan(1, quickest);
	for (let tick = 0; state.phase === "playing" && tick < 60 * 60; tick++) {
		const penitent = jordanPenitent(state);
		stepJordan(state, { hold: !(state.stage === "lower" && penitent && state.depth >= penitent.low) });
	}
	return state.endedAt ?? JORDAN_SECONDS;
}

/** The fastest possible win, rounded down to a tenth. */
export const JORDAN_MIN_SECONDS = Math.floor(fastestWin() * 10) / 10;

/** The round's result once it has ended: raised nearer the band's centre, with fewer misses, scores higher. */
export function jordanResult(state: JordanState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const mean = state.accuracy.length ? state.accuracy.reduce((sum, value) => sum + value, 0) / state.accuracy.length : 0;
	const score = state.phase === "won" ? Math.round(Math.max(5, Math.min(100, 20 + 80 * mean - 9 * state.misses))) : 0;
	return { won: state.phase === "won", score, count: state.accuracy.length, seconds };
}
