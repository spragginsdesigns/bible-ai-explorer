/**
 * Watch with Me (LC-17851, docs/beta/games.md), Matthew 26:36-41: "tarry ye
 * here, and watch with me" (v38); "What, could ye not watch with me one hour?"
 * (v40). Pure and seeded so the tests play it; no imports (Node's type
 * stripping loads it).
 *
 * Peter, James and John sit in Gethsemane. Each one's wakefulness drains, at
 * his own pace and faster as the night goes on. Waking one whose eyes are
 * heavy fills him again; shaking one who is still wide awake is a slip. One
 * fast asleep, or three slips, and the round is lost; keep the watch to the
 * end and it is won.
 */

export const VIGIL_STEP = 1 / 60;
export const VIGIL_SECONDS = 15;
/** A round is only won by keeping the watch to the end. */
export const VIGIL_MIN_SECONDS = VIGIL_SECONDS;
/** Below this a disciple's eyes are heavy and he can be woken; at or above it he is wide awake. */
export const VIGIL_HEAVY = 0.62;
/** Below this he is nodding off (the meter turns red). */
export const VIGIL_NODDING = 0.25;
/** Waking a disciple who is wide awake is a slip; this many and the round is lost. */
export const VIGIL_SLIP_LIMIT = 3;
/** Wakefulness lost per second at the start and at the end of the round, before each disciple's own pace. */
export const VIGIL_DRAIN_START = 0.2;
export const VIGIL_DRAIN_END = 0.62;
/** The three disciples, left to right, and their key. */
export const VIGIL_NAMES = ["Peter", "James", "John"] as const;

export interface VigilDisciple {
	/** 1 wide awake, 0 fast asleep. */
	awake: number;
	/** His own pace, re-rolled each time he is woken. */
	pace: number;
	/** When he was last woken, for the stage's flash. */
	wokenAt: number;
	/** When he was last shaken while awake, for the stage's flash. */
	slipAt: number;
}

export interface VigilState {
	t: number;
	disciples: VigilDisciple[];
	wakes: number;
	slips: number;
	/** Wakes made while the disciple was already nodding (below VIGIL_NODDING). */
	close: number;
	/** The disciple who fell asleep, if one did. */
	asleep: number | null;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	rng: number;
}

export type VigilEvent =
	| { type: "wake"; disciple: number; awake: number }
	| { type: "slip"; disciple: number }
	| { type: "nodding"; disciple: number }
	| { type: "asleep"; disciple: number }
	| { type: "won" }
	| { type: "lost" };

/** One step of the seeded generator, kept in the state so a round replays exactly. */
function nextRandom(state: { rng: number }) {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pace(state: VigilState) {
	return 0.72 + nextRandom(state) * 0.62;
}

export function newVigil(seed: number): VigilState {
	const state: VigilState = { t: 0, disciples: [], wakes: 0, slips: 0, close: 0, asleep: null, phase: "playing", endedAt: null, rng: seed >>> 0 || 1 };
	// They start at staggered depths of sleepiness, in a seeded order.
	const starts = [1, 0.86, 0.72];
	for (let i = starts.length - 1; i > 0; i--) {
		const j = Math.floor(nextRandom(state) * (i + 1));
		[starts[i], starts[j]] = [starts[j], starts[i]];
	}
	for (const awake of starts) state.disciples.push({ awake, pace: 0, wokenAt: -9, slipAt: -9 });
	for (const disciple of state.disciples) disciple.pace = pace(state);
	return state;
}

/** Wakefulness lost per second now, before a disciple's own pace. */
export function vigilDrain(t: number) {
	const p = Math.min(1, t / VIGIL_SECONDS);
	return VIGIL_DRAIN_START + (VIGIL_DRAIN_END - VIGIL_DRAIN_START) * p;
}

export function stepVigil(state: VigilState, input: { wake: number[] }, events: VigilEvent[] = []): VigilState {
	if (state.phase !== "playing") return state;
	const dt = VIGIL_STEP;
	for (const index of input.wake) {
		const disciple = state.disciples[index];
		if (!disciple) continue;
		if (disciple.awake >= VIGIL_HEAVY) {
			disciple.slipAt = state.t;
			state.slips += 1;
			events.push({ type: "slip", disciple: index });
			continue;
		}
		if (disciple.awake < VIGIL_NODDING) state.close += 1;
		events.push({ type: "wake", disciple: index, awake: disciple.awake });
		disciple.awake = 1;
		disciple.pace = pace(state);
		disciple.wokenAt = state.t;
		state.wakes += 1;
	}
	state.t += dt;
	const drain = vigilDrain(state.t);
	state.disciples.forEach((disciple, index) => {
		const before = disciple.awake;
		disciple.awake = Math.max(0, disciple.awake - drain * disciple.pace * dt);
		if (before >= VIGIL_NODDING && disciple.awake < VIGIL_NODDING) events.push({ type: "nodding", disciple: index });
		if (disciple.awake <= 0 && state.asleep === null) {
			state.asleep = index;
			events.push({ type: "asleep", disciple: index });
		}
	});
	if (state.asleep !== null || state.slips >= VIGIL_SLIP_LIMIT) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= VIGIL_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: no slips and no close calls is a perfect watch. */
export function vigilResult(state: VigilState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.slips * 18 - state.close * 5))) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.wakes), seconds };
}
