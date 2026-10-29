/**
 * Watch! (LC-17851, docs/beta/games.md), Matthew 24:42-44 and v27: watch
 * therefore, for ye know not what hour your Lord doth come; as the lightning
 * cometh out of the east, and shineth even unto the west. Pure and seeded so
 * the tests play it; no imports (Node's type stripping loads it).
 *
 * A night watch over a house. Four times in the round the lightning streaks
 * from the east across to the west; a tap inside its window catches it, and
 * sooner scores more. Lamps flicker, a torch passes, heat-lightning glows on
 * the horizon: those are not the sign, and a tap when there is no lightning is
 * an early miss. Win with at least three caught and at most one early miss;
 * a second early miss or a second lightning missed ends the round.
 */

export const WATCH_STEP = 1 / 60;
export const WATCH_SECONDS = 14;
export const WATCH_FLASHES = 4;
/** The strike window from the lightning's first instant. */
export const WATCH_WINDOW = 0.45;
/** Taps this soon after a catch are the same tap. */
export const WATCH_DEBOUNCE = 0.3;
/** The first flash comes FIRST_MIN to FIRST_MAX seconds in, then GAP_MIN to GAP_MAX apart. */
export const WATCH_FIRST_MIN = 1.6;
export const WATCH_FIRST_MAX = 2.8;
export const WATCH_GAP_MIN = 2.0;
export const WATCH_GAP_MAX = 3.1;
/** Winning: this many caught, at most this many early misses. */
export const WATCH_NEED = 3;
export const WATCH_MAX_EARLY = 1;
/** A catch inside FULL seconds scores the most; later ones less, down to LEAST at the window's end. */
export const WATCH_FULL = 0.22;
export const WATCH_MOST = 25;
export const WATCH_LEAST = 10;
export const WATCH_EARLY_COST = 10;
/**
 * The fastest a round can be won: every flash at its soonest and caught on its
 * first instant (the round ends when the fourth flash is caught).
 */
export const WATCH_MIN_SECONDS = WATCH_FIRST_MIN + (WATCH_FLASHES - 1) * WATCH_GAP_MIN;

export interface WatchFlash {
	at: number;
	/** The reaction time when caught, else null. */
	caught: number | null;
	missed: boolean;
}

export type WatchDecoyKind = "lamp" | "torch" | "heat";

export interface WatchDecoy {
	kind: WatchDecoyKind;
	at: number;
	until: number;
	/** Where it shows, 0-1 across the picture. */
	x: number;
}

export interface WatchState {
	t: number;
	flashes: WatchFlash[];
	decoys: WatchDecoy[];
	caught: number;
	missed: number;
	early: number;
	lastTap: number;
	lastCatch: number;
	points: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type WatchEvent =
	| { type: "flash"; index: number }
	| { type: "catch"; index: number; reaction: number }
	| { type: "early" }
	| { type: "missed"; index: number }
	| { type: "decoy"; kind: WatchDecoyKind }
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

export function newWatch(seed: number): WatchState {
	const next = random(seed);
	const flashes: WatchFlash[] = [];
	let at = WATCH_FIRST_MIN + next() * (WATCH_FIRST_MAX - WATCH_FIRST_MIN);
	for (let i = 0; i < WATCH_FLASHES; i++) {
		flashes.push({ at, caught: null, missed: false });
		at += WATCH_GAP_MIN + next() * (WATCH_GAP_MAX - WATCH_GAP_MIN);
	}
	// Decoys in the quiet between flashes: never within half a second before one, nor during its window.
	const decoys: WatchDecoy[] = [];
	const kinds: WatchDecoyKind[] = ["heat", "lamp", "torch"];
	const clear = (from: number, until: number) => flashes.every((flash) => until < flash.at - 0.5 || from > flash.at + WATCH_WINDOW + 0.15);
	for (let tries = 0; decoys.length < 6 && tries < 300; tries++) {
		const kind = kinds[(decoys.length + Math.floor(tries / 4)) % 3];
		const length = kind === "torch" ? 0.9 : kind === "lamp" ? 0.5 : 0.35;
		const from = 0.6 + next() * (flashes[WATCH_FLASHES - 1].at - 0.6);
		if (!clear(from, from + length) || decoys.some((decoy) => from < decoy.until + 0.25 && from + length > decoy.at - 0.25)) continue;
		decoys.push({ kind, at: from, until: from + length, x: 0.15 + next() * 0.7 });
	}
	decoys.sort((a, b) => a.at - b.at);
	return { t: 0, flashes, decoys, caught: 0, missed: 0, early: 0, lastTap: -9, lastCatch: -9, points: 0, phase: "playing", endedAt: null };
}

/** The flash whose window is open now (its index), or -1. */
export function watchOpen(state: WatchState, t = state.t): number {
	return state.flashes.findIndex((flash) => flash.caught === null && !flash.missed && t >= flash.at && t < flash.at + WATCH_WINDOW);
}

/** The lightning showing now (caught or not), for the drawing: its index and age, or null. */
export function watchLit(state: WatchState, t = state.t): { index: number; age: number } | null {
	const index = state.flashes.findIndex((flash) => t >= flash.at && t < flash.at + 0.6);
	return index < 0 ? null : { index, age: t - state.flashes[index].at };
}

export function watchDecoyAt(state: WatchState, t = state.t): WatchDecoy | null {
	return state.decoys.find((decoy) => t >= decoy.at && t < decoy.until) ?? null;
}

function pointsFor(reaction: number) {
	if (reaction <= WATCH_FULL) return WATCH_MOST;
	const late = Math.min(1, (reaction - WATCH_FULL) / (WATCH_WINDOW - WATCH_FULL));
	return WATCH_MOST - (WATCH_MOST - WATCH_LEAST) * late;
}

export function stepWatch(state: WatchState, input: { tap: boolean }, events: WatchEvent[] = []): WatchState {
	if (state.phase !== "playing") return state;
	const decoyBefore = watchDecoyAt(state);
	if (input.tap) {
		const open = watchOpen(state);
		if (open >= 0) {
			const reaction = state.t - state.flashes[open].at;
			state.flashes[open].caught = reaction;
			state.caught++;
			state.points += pointsFor(reaction);
			state.lastCatch = state.t;
			events.push({ type: "catch", index: open, reaction });
		} else if (state.t - state.lastCatch >= WATCH_DEBOUNCE - 1e-9) {
			state.early++;
			events.push({ type: "early" });
		}
		state.lastTap = state.t;
	}
	const litBefore = watchLit(state);
	state.t += WATCH_STEP;
	const lit = watchLit(state);
	if (lit && (!litBefore || litBefore.index !== lit.index)) events.push({ type: "flash", index: lit.index });
	const decoy = watchDecoyAt(state);
	if (decoy && decoy !== decoyBefore) events.push({ type: "decoy", kind: decoy.kind });
	state.flashes.forEach((flash, index) => {
		if (flash.caught === null && !flash.missed && state.t >= flash.at + WATCH_WINDOW - 1e-9) {
			flash.missed = true;
			state.missed++;
			events.push({ type: "missed", index });
		}
	});
	const resolved = state.flashes.every((flash) => flash.caught !== null || flash.missed);
	const lost = state.early > WATCH_MAX_EARLY || state.missed > WATCH_FLASHES - WATCH_NEED;
	if (lost || resolved || state.t >= WATCH_SECONDS - 1e-9) {
		state.phase = !lost && state.caught >= WATCH_NEED ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: "end", won: state.phase === "won" });
	}
	return state;
}

export function watchScore(state: WatchState): number {
	return Math.max(0, Math.min(100, Math.round(state.points - WATCH_EARLY_COST * state.early)));
}

/** The round's result once it has ended: quicker catches and no early taps score more. */
export function watchResult(state: WatchState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	return { won: state.phase === "won", score: watchScore(state), count: state.caught, seconds: Math.round(state.endedAt * 10) / 10 };
}
