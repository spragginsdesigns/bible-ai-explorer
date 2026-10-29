/**
 * The Coin in the Fish (LC-17851, docs/beta/games.md), Matthew 17:24-27: go
 * thou to the sea, and cast an hook, and take up the fish that first cometh
 * up. Pure and seeded so the tests play it; no imports (Node's type stripping
 * loads it).
 *
 * One fish is below the float, the one with the piece of money. It nibbles
 * (small bobs) and then bites (the float dips under, with a flash). A strike
 * inside a bite is clean and draws the fish up a fathom; three clean strikes
 * bring it up out of the water. A strike on a nibble or on still water scares
 * it: it slips back a fathom and swims off for a moment. A bite left alone
 * lets go, and the fish starts nibbling again.
 */

export const COIN_STEP = 1 / 60;
export const COIN_SECONDS = 15;
/** Clean strikes that bring the fish up. */
export const COIN_STRIKES = 3;
/** How long a nibble bobs the float, and how long a bite holds it under (the strike window). */
export const COIN_NIBBLE = 0.22;
export const COIN_BITE = 0.4;
/** Quiet water between nibbles and bites. */
export const COIN_GAP_MIN = 0.38;
export const COIN_GAP_MAX = 0.85;
/** After the cast settles, after a clean strike (drawing the fish up), and after a scare. */
export const COIN_SETTLE = 0.5;
export const COIN_HAUL = 0.6;
export const COIN_SCARE = 1;
/** The last haul, the fish coming up out of the water with the coin. */
export const COIN_LAND = 0.8;
/**
 * The fastest a round can be won: the cast settles, each of the three bites
 * comes after one nibble with the shortest gaps, every strike lands on the
 * bite's first instant, then the fish comes up.
 */
export const COIN_MIN_SECONDS = COIN_SETTLE + COIN_STRIKES * (2 * COIN_GAP_MIN + COIN_NIBBLE) + (COIN_STRIKES - 1) * COIN_HAUL + COIN_LAND;

export interface CoinCue {
	kind: "nibble" | "bite";
	from: number;
	to: number;
}

export interface CoinState {
	t: number;
	/** Fathoms drawn up, 0 to COIN_STRIKES. */
	level: number;
	strikes: number;
	scares: number;
	/** Bites let go by. */
	letGo: number;
	/** The current run of nibbles ending in a bite. */
	cues: CoinCue[];
	/** Hauling, scared or landing until this time; strikes then do nothing. */
	busyUntil: number;
	busy: "settle" | "haul" | "scare" | "land";
	/** When the last strike was, and whether it was clean, for the drawing. */
	lastStrike: number;
	lastClean: boolean;
	phase: "playing" | "landing" | "won" | "lost";
	endedAt: number | null;
	seed: number;
}

export type CoinEvent =
	| { type: "nibble" }
	| { type: "bite" }
	| { type: "strike"; level: number }
	| { type: "scare" }
	| { type: "letgo" }
	| { type: "up" }
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

/** Plans the next nibbles and the bite, from `from`, drawing from the round's own generator. */
function plan(state: CoinState, from: number, next: () => number) {
	const gap = () => COIN_GAP_MIN + next() * (COIN_GAP_MAX - COIN_GAP_MIN);
	const nibbles = 1 + Math.floor(next() * 3);
	const cues: CoinCue[] = [];
	let at = from;
	for (let i = 0; i < nibbles; i++) {
		at += gap();
		cues.push({ kind: "nibble", from: at, to: at + COIN_NIBBLE });
		at += COIN_NIBBLE;
	}
	at += gap();
	cues.push({ kind: "bite", from: at, to: at + COIN_BITE });
	state.cues = cues;
}

/** The generator for the next plan: from the seed and the strikes, scares and let-gos so far, so a round replays exactly. */
function generator(state: CoinState) {
	return random(state.seed + 7919 * (state.strikes + 31 * state.scares + 977 * state.letGo));
}

export function newCoin(seed: number): CoinState {
	const state: CoinState = {
		t: 0,
		level: 0,
		strikes: 0,
		scares: 0,
		letGo: 0,
		cues: [],
		busyUntil: COIN_SETTLE,
		busy: "settle",
		lastStrike: -9,
		lastClean: false,
		phase: "playing",
		endedAt: null,
		seed: seed >>> 0 || 1,
	};
	plan(state, COIN_SETTLE, generator(state));
	return state;
}

/** The cue showing now, if any. */
export function coinCueAt(state: CoinState, t = state.t): CoinCue | null {
	return state.cues.find((cue) => t >= cue.from && t < cue.to) ?? null;
}

function replan(state: CoinState, from: number) {
	plan(state, from, generator(state));
}

export function stepCoin(state: CoinState, input: { strike: boolean }, events: CoinEvent[] = []): CoinState {
	if (state.phase === "won" || state.phase === "lost") return state;
	if (state.phase === "playing") {
		const before = coinCueAt(state);
		if (input.strike && state.t >= state.busyUntil - 1e-9) {
			state.lastStrike = state.t;
			if (before && before.kind === "bite") {
				state.strikes++;
				state.level++;
				state.lastClean = true;
				events.push({ type: "strike", level: state.level });
				if (state.level >= COIN_STRIKES) {
					state.phase = "landing";
					state.busy = "land";
					state.busyUntil = state.t + COIN_LAND;
					state.cues = [];
					events.push({ type: "up" });
				} else {
					state.busy = "haul";
					state.busyUntil = state.t + COIN_HAUL;
					replan(state, state.busyUntil);
				}
			} else {
				state.scares++;
				state.level = Math.max(0, state.level - 1);
				state.lastClean = false;
				state.busy = "scare";
				state.busyUntil = state.t + COIN_SCARE;
				events.push({ type: "scare" });
				replan(state, state.busyUntil);
			}
		}
	}
	const was = coinCueAt(state);
	state.t += COIN_STEP;
	if (state.phase === "landing") {
		if (state.t >= state.busyUntil - 1e-9) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "end", won: true });
		}
		return state;
	}
	const now = coinCueAt(state);
	if (now && now !== was) events.push({ type: now.kind });
	const bite = state.cues[state.cues.length - 1];
	if (bite && state.t >= bite.to - 1e-9) {
		state.letGo++;
		events.push({ type: "letgo" });
		replan(state, state.t);
	}
	if (state.t >= COIN_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "end", won: false });
	}
	return state;
}

/** The round's result once it has ended: up sooner and with fewer scares is a higher score. */
export function coinResult(state: CoinState): { won: boolean; score: number; count: number; seconds: number } | null {
	if ((state.phase !== "won" && state.phase !== "lost") || state.endedAt === null) return null;
	const won = state.phase === "won";
	const score = won ? Math.round(Math.max(25, Math.min(100, 100 - 6 * Math.max(0, state.endedAt - 7) - 12 * state.scares))) : Math.round((100 * state.strikes) / (COIN_STRIKES + 1));
	return { won, score, count: state.strikes, seconds: Math.round(state.endedAt * 10) / 10 };
}
