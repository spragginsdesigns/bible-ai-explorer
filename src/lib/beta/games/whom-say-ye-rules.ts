/**
 * Whom Say Ye? (LC-17851, docs/beta/games.md), Matthew 16:13-18: "Whom do
 * men say that I the Son of man am?" Men said John the Baptist, Elias,
 * Jeremias, or one of the prophets (v14); Simon Peter answered "Thou art the
 * Christ, the Son of the living God" (v16). Pure and seeded so the tests play
 * it; no imports (Node's type stripping loads it).
 *
 * Each round shows the scrolls open, the true answer glowing; they roll up
 * and shuffle, swapping faster each round; then the player taps the true
 * one. A wrong answer shows where it was and the same round is shuffled
 * again, which costs about three seconds: one quick miss still fits in the
 * clock, a second does not. Three rounds answered true win.
 */

export const WHOM_STEP = 1 / 60;
export const WHOM_SECONDS = 15;
/** Seconds the scrolls take to roll up after being shown. */
export const WHOM_ROLL = 0.3;
/** Seconds the answer is shown after a right pick, and after a wrong one. */
export const WHOM_REVEAL_RIGHT = 0.45;
export const WHOM_REVEAL_WRONG = 0.8;

export interface WhomRound {
	/** How many scrolls, how long they are shown open, how many swaps and how long each swap takes. */
	scrolls: number;
	show: number;
	swaps: number;
	swap: number;
}

export const WHOM_ROUNDS: readonly WhomRound[] = [
	{ scrolls: 3, show: 0.9, swaps: 3, swap: 0.42 },
	{ scrolls: 4, show: 0.8, swaps: 4, swap: 0.34 },
	{ scrolls: 4, show: 0.7, swaps: 6, swap: 0.27 },
];

/** The words on the scrolls: the first is Peter's confession (v16), the rest what men said (v14). */
export const WHOM_TRUE = "Thou art the Christ, the Son of the living God";
export const WHOM_SAYINGS: readonly string[] = [WHOM_TRUE, "John the Baptist", "Elias", "Jeremias"];
/** The fourth answer in the four-scroll rounds may also be this one (v14). */
export const WHOM_PROPHETS = "One of the prophets";

/** Seconds a round takes before it can be answered. */
export function whomRoundSeconds(round: WhomRound): number {
	return round.show + WHOM_ROLL + round.swaps * round.swap;
}

/** The fastest a round can be won: every round answered the moment it can be, at the step's resolution. */
export const WHOM_MIN_SECONDS =
	WHOM_ROUNDS.reduce((sum, round) => sum + whomRoundSeconds(round), 0) + (WHOM_ROUNDS.length - 1) * WHOM_REVEAL_RIGHT;

export type WhomStage = "show" | "roll" | "shuffle" | "choose" | "reveal";

export interface WhomState {
	t: number;
	round: number;
	stage: WhomStage;
	/** When the current stage began. */
	since: number;
	/** `slots[i]` is the scroll standing in slot i; scroll 0 is the true answer. */
	slots: number[];
	/** The current shuffle's swaps, as pairs of slots. */
	swaps: [number, number][];
	/** The labels on this round's scrolls, by scroll. */
	labels: string[];
	/** The last pick: slot and whether it was true (for the reveal). */
	picked: { slot: number; right: boolean } | null;
	right: number;
	misses: number;
	draws: number;
	seed: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type WhomEvent =
	| { type: "show"; round: number }
	| { type: "roll" }
	| { type: "swap" }
	| { type: "choose" }
	| { type: "pick"; right: boolean }
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

/** Lays out a round: where each scroll starts, and a fresh shuffle (each draw is its own stream of the seed). */
function deal(state: WhomState) {
	const round = WHOM_ROUNDS[state.round];
	const next = random(state.seed + state.draws * 65537);
	state.draws += 1;
	const slots = Array.from({ length: round.scrolls }, (_, index) => index);
	for (let i = slots.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[slots[i], slots[j]] = [slots[j], slots[i]];
	}
	state.slots = slots;
	state.swaps = [];
	let trueSwaps = 0;
	for (let k = 0; k < round.swaps; k++) {
		// About half the swaps move the true scroll, so there is always something to follow.
		const trueSlot = currentSlotOfTrue(state.slots, state.swaps);
		let a: number;
		let b: number;
		if (next() < 0.55 || (k === round.swaps - 1 && trueSwaps === 0)) {
			a = trueSlot;
			b = (a + 1 + Math.floor(next() * (round.scrolls - 1))) % round.scrolls;
			trueSwaps++;
		} else {
			a = Math.floor(next() * round.scrolls);
			b = (a + 1 + Math.floor(next() * (round.scrolls - 1))) % round.scrolls;
		}
		state.swaps.push([Math.min(a, b), Math.max(a, b)]);
	}
	const labels = WHOM_SAYINGS.slice(0, round.scrolls);
	if (round.scrolls === 4 && next() < 0.5) labels[1 + Math.floor(next() * 3)] = WHOM_PROPHETS;
	state.labels = labels;
	state.stage = "show";
	state.since = state.t;
	state.picked = null;
}

function currentSlotOfTrue(slots: number[], swaps: [number, number][]): number {
	let at = slots.indexOf(0);
	for (const [a, b] of swaps) {
		if (at === a) at = b;
		else if (at === b) at = a;
	}
	return at;
}

export function newWhom(seed: number): WhomState {
	const state: WhomState = {
		t: 0,
		round: 0,
		stage: "show",
		since: 0,
		slots: [],
		swaps: [],
		labels: [],
		picked: null,
		right: 0,
		misses: 0,
		draws: 0,
		seed: seed >>> 0 || 1,
		phase: "playing",
		endedAt: null,
	};
	deal(state);
	return state;
}

/** Where the true scroll is once the shuffle is done (the answer). */
export function whomTrueSlot(state: WhomState): number {
	return currentSlotOfTrue(state.slots, state.swaps);
}

/**
 * Where each scroll stands now, for drawing: `x` is a slot position
 * (fractional while swapping) and `lift` is -1..1, how far it arcs up or down
 * while it swaps.
 */
export function whomLayout(state: WhomState): { scroll: number; x: number; lift: number }[] {
	const round = WHOM_ROUNDS[state.round];
	const where = state.slots.map((scroll, slot) => ({ scroll, slot }));
	const bySlot: number[] = [...state.slots];
	let done = 0;
	let progress = 0;
	if (state.stage === "shuffle") {
		const elapsed = state.t - state.since;
		done = Math.min(state.swaps.length, Math.floor(elapsed / round.swap));
		progress = done < state.swaps.length ? (elapsed - done * round.swap) / round.swap : 0;
	} else if (state.stage === "choose" || state.stage === "reveal") {
		done = state.swaps.length;
	}
	for (let k = 0; k < done; k++) {
		const [a, b] = state.swaps[k];
		[bySlot[a], bySlot[b]] = [bySlot[b], bySlot[a]];
	}
	for (const item of where) item.slot = bySlot.indexOf(item.scroll);
	const swapping = state.stage === "shuffle" && done < state.swaps.length ? state.swaps[done] : null;
	const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
	return where.map(({ scroll, slot }) => {
		if (swapping && (slot === swapping[0] || slot === swapping[1])) {
			const to = slot === swapping[0] ? swapping[1] : swapping[0];
			const up = slot === swapping[0] ? -1 : 1;
			return { scroll, x: slot + (to - slot) * eased, lift: up * Math.sin(Math.PI * progress) };
		}
		return { scroll, x: slot, lift: 0 };
	});
}

/** The pick goes to slot `pick` (0-based, left to right); picks outside the choosing do nothing. */
export function stepWhom(state: WhomState, input: { pick: number | null }, events: WhomEvent[] = []): WhomState {
	if (state.phase !== "playing") return state;
	const round = WHOM_ROUNDS[state.round];
	if (state.stage === "choose" && input.pick !== null && input.pick >= 0 && input.pick < round.scrolls) {
		const right = input.pick === whomTrueSlot(state);
		state.picked = { slot: input.pick, right };
		if (right) state.right += 1;
		else state.misses += 1;
		events.push({ type: "pick", right });
		if (right && state.round === WHOM_ROUNDS.length - 1) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "won" });
			return state;
		}
		state.stage = "reveal";
		state.since = state.t;
	}
	state.t += WHOM_STEP;
	const elapsed = state.t - state.since;
	if (state.stage === "show" && elapsed >= round.show - 1e-9) {
		state.stage = "roll";
		state.since = state.t;
		events.push({ type: "roll" });
	} else if (state.stage === "roll" && elapsed >= WHOM_ROLL - 1e-9) {
		state.stage = "shuffle";
		state.since = state.t;
		events.push({ type: "swap" });
	} else if (state.stage === "shuffle") {
		const swapsDone = Math.floor((elapsed + 1e-9) / round.swap);
		const before = Math.floor((elapsed - WHOM_STEP + 1e-9) / round.swap);
		if (swapsDone >= round.swaps) {
			state.stage = "choose";
			state.since = state.t;
			events.push({ type: "choose" });
		} else if (swapsDone > before) events.push({ type: "swap" });
	} else if (state.stage === "reveal" && elapsed >= (state.picked?.right ? WHOM_REVEAL_RIGHT : WHOM_REVEAL_WRONG) - 1e-9) {
		if (state.picked?.right) state.round += 1;
		deal(state);
		events.push({ type: "show", round: state.round });
	}
	if (state.t >= WHOM_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: a miss costs, and so does a slow answer. */
export function whomResult(state: WhomState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.max(0, Math.min(100, Math.round(100 - 30 * state.misses - 3 * Math.max(0, state.endedAt - 10)))) : 0;
	return { won: state.phase === "won", score, count: state.right, seconds };
}
