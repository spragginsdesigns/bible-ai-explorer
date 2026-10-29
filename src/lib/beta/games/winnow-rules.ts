/**
 * Winnow the Floor (LC-17851, docs/beta/games.md), Matthew 3:11-17: "Whose
 * fan is in his hand, and he will throughly purge his floor, and gather his
 * wheat into the garner; but he will burn up the chaff with unquenchable
 * fire" (v12). Pure and seeded so the tests play it; no imports (Node's type
 * stripping loads it).
 *
 * The fan tosses grain up one at a time, faster as the round goes on. Each
 * toss is golden wheat or pale chaff; the lowest one in the air is the one a
 * press sorts: wheat to the garner (left), chaff to the fire (right). A wrong
 * sort, or a toss left to fall on the floor, is a mistake; the third mistake
 * loses. Keep the floor for the whole round to win.
 */

export const WINNOW_STEP = 1 / 60;
export const WINNOW_SECONDS = 15;
/** Surviving the round is the win, so it can never be won sooner. */
export const WINNOW_MIN_SECONDS = WINNOW_SECONDS;
export const WINNOW_MISTAKES = 3;
/** The first toss, after the countdown's "Sort!" has faded. */
export const WINNOW_FIRST = 0.35;

/** Seconds from a toss leaving the fan to it landing on the floor, by when it was tossed. */
export function winnowAir(at: number): number {
	return 2.2 - 0.85 * Math.min(1, at / WINNOW_SECONDS);
}

/** Seconds to the next toss, by when the last one was tossed. */
export function winnowGap(at: number): number {
	return 0.95 - 0.43 * Math.min(1, at / 13);
}

export type WinnowKind = "wheat" | "chaff";
export type WinnowSide = "left" | "right";

export interface WinnowGrain {
	id: number;
	kind: WinnowKind;
	born: number;
	/** When it lands on the floor if no one sorts it. */
	lands: number;
	/** -1..1, how far it drifts sideways in the air (drawing only). */
	drift: number;
	sorted: { side: WinnowSide; at: number; right: boolean } | null;
	fell: number | null;
}

export interface WinnowState {
	t: number;
	grains: WinnowGrain[];
	nextToss: number;
	nextId: number;
	right: number;
	mistakes: number;
	seed: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type WinnowEvent =
	| { type: "toss"; kind: WinnowKind }
	| { type: "sorted"; kind: WinnowKind; side: WinnowSide; right: boolean }
	| { type: "fell"; kind: WinnowKind }
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

export function newWinnow(seed: number): WinnowState {
	return { t: 0, grains: [], nextToss: WINNOW_FIRST, nextId: 0, right: 0, mistakes: 0, seed: seed >>> 0 || 1, phase: "playing", endedAt: null };
}

/** The grain a press sorts now: the oldest one still in the air. */
export function winnowFront(state: WinnowState): WinnowGrain | null {
	return state.grains.find((grain) => !grain.sorted && grain.fell === null) ?? null;
}

/** The side each kind belongs on: wheat to the garner on the left, chaff to the fire on the right. */
export function winnowSideFor(kind: WinnowKind): WinnowSide {
	return kind === "wheat" ? "left" : "right";
}

export function stepWinnow(state: WinnowState, input: { sort: WinnowSide | null }, events: WinnowEvent[] = []): WinnowState {
	if (state.phase !== "playing") return state;
	const dt = WINNOW_STEP;
	if (input.sort) {
		const front = winnowFront(state);
		if (front) {
			const right = winnowSideFor(front.kind) === input.sort;
			front.sorted = { side: input.sort, at: state.t, right };
			if (right) state.right += 1;
			else state.mistakes += 1;
			events.push({ type: "sorted", kind: front.kind, side: input.sort, right });
		}
	}
	state.t += dt;
	if (state.t >= state.nextToss - 1e-9 && state.t < WINNOW_SECONDS - 0.4) {
		// The seed's own stream, advanced once per toss, so the round replays.
		const next = random(state.seed + state.nextId * 7919);
		const kind: WinnowKind = next() < 0.5 ? "wheat" : "chaff";
		state.grains.push({ id: state.nextId, kind, born: state.t, lands: state.t + winnowAir(state.t), drift: next() * 2 - 1, sorted: null, fell: null });
		state.nextId += 1;
		state.nextToss = state.t + winnowGap(state.t);
		events.push({ type: "toss", kind });
	}
	for (const grain of state.grains) {
		if (!grain.sorted && grain.fell === null && state.t >= grain.lands - 1e-9) {
			grain.fell = state.t;
			state.mistakes += 1;
			events.push({ type: "fell", kind: grain.kind });
		}
	}
	// Forget grains long done with, so the list stays short.
	state.grains = state.grains.filter((grain) => (grain.sorted ? state.t - grain.sorted.at < 1 : grain.fell === null || state.t - grain.fell < 1));
	if (state.mistakes >= WINNOW_MISTAKES) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= WINNOW_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: every mistake costs. */
export function winnowResult(state: WinnowState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const handled = state.right + state.mistakes;
	const score = state.phase === "won" ? Math.max(0, Math.min(100, Math.round((100 * state.right) / Math.max(1, handled) - 12 * state.mistakes))) : 0;
	return { won: state.phase === "won", score, count: state.right, seconds };
}
