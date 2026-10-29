/**
 * The Sower (LC-17851, docs/beta/games.md), Matthew 13:3-9: a sower went forth
 * to sow, and the field passes beneath him: the way side where the fowls wait,
 * stony places, thorns, and the good ground. Pure and seeded so the tests play
 * it; no imports (Node's type stripping loads it).
 *
 * The field is a row of cells. Each throw scatters seed on the cell the
 * marker just ahead of the sower is over at that moment (or on the good ground
 * it left within SOWER_GRACE). A cell of good ground is sown once; seed
 * anywhere else is wasted (the fowls devour it, it withers on the stones, the
 * thorns choke it). The round runs its full time; the score is how much of the
 * good ground was sown, less the wasted throws.
 */

export const SOWER_STEP = 1 / 60;
export const SOWER_SECONDS = 15;
/** The round always runs its full time, so the fastest win is the whole round. */
export const SOWER_MIN_SECONDS = SOWER_SECONDS;
/** One cell of the field, in picture units. */
export const SOWER_CELL = 30;
/** The field's speed under the sower: SPEED + RAMP * t units a second. */
export const SOWER_SPEED = 110;
export const SOWER_RAMP = 4;
/** Where the seed lands, this far ahead of the sower's feet. */
export const SOWER_AHEAD = 70;
/** How long a handful of seed is in the air (the drawing only; it lands where the marker was). */
export const SOWER_FLIGHT = 0.3;
/** The sower's arm: a throw sooner than this after the last one waits for it (one press is held, the rest dropped). */
export const SOWER_COOLDOWN = 0.16;
/**
 * A throw this soon after the marker leaves good ground still lands on it, so
 * a player reacting to the green arrow is not charged for the moment it takes
 * to see it turn.
 */
export const SOWER_GRACE = 0.15;
/** Winning: at least this share of the good ground sown, with at most this many wasted throws. */
export const SOWER_WIN_SHARE = 0.7;
export const SOWER_MAX_WASTED = 3;
/** Each wasted throw costs this much of the score. */
export const SOWER_WASTE_COST = 7;

export type SowerGround = "wayside" | "stony" | "thorns" | "good";

export interface SowerThrow {
	/** When it was thrown, where it lands (field units) and on what. */
	t: number;
	at: number;
	ground: SowerGround;
	/** True when it sowed a fresh cell of good ground. */
	sowed: boolean;
}

export interface SowerState {
	t: number;
	/** The field's cells, from field x 0, each SOWER_CELL wide. */
	cells: SowerGround[];
	sown: boolean[];
	/** Good cells the marker passes over during the round. */
	goodTotal: number;
	sownCount: number;
	wasted: number;
	throws: SowerThrow[];
	lastThrow: number;
	/** A press made while the arm was still swinging, thrown as soon as it is ready. */
	queued: boolean;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type SowerEvent = { type: "throw"; ground: SowerGround; sowed: boolean; at: number } | { type: "end"; won: boolean };

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

/** How far the field has moved under the sower's feet at time t. */
export function sowerGroundX(t: number): number {
	return SOWER_SPEED * t + (SOWER_RAMP / 2) * t * t;
}

/** The field x the marker (where the next throw lands) is over at time t. */
export function sowerMarkX(t: number): number {
	return sowerGroundX(t) + SOWER_AHEAD;
}

export function sowerCellAt(x: number): number {
	return Math.floor(x / SOWER_CELL);
}

export function newSower(seed: number): SowerState {
	const next = random(seed);
	const reach = sowerMarkX(SOWER_SECONDS);
	const cells: SowerGround[] = [];
	// A short stretch of the way side first, so the first good ground comes at the marker after a breath.
	for (let i = 0; i < 4; i++) cells.push("wayside");
	const bad: SowerGround[] = ["wayside", "stony", "thorns"];
	let lastBad: SowerGround = "wayside";
	while (cells.length * SOWER_CELL < reach + 10 * SOWER_CELL) {
		const good = 3 + Math.floor(next() * 4);
		for (let i = 0; i < good; i++) cells.push("good");
		const stretches = next() < 0.35 ? 2 : 1;
		for (let s = 0; s < stretches; s++) {
			let kind = bad[Math.floor(next() * 3)];
			if (kind === lastBad) kind = bad[(bad.indexOf(kind) + 1) % 3];
			lastBad = kind;
			const length = 2 + Math.floor(next() * 2);
			for (let i = 0; i < length; i++) cells.push(kind);
		}
	}
	const first = sowerCellAt(sowerMarkX(0));
	const last = sowerCellAt(reach);
	let goodTotal = 0;
	for (let i = first; i <= last; i++) if (cells[i] === "good") goodTotal++;
	return {
		t: 0,
		cells,
		sown: cells.map(() => false),
		goodTotal,
		sownCount: 0,
		wasted: 0,
		throws: [],
		lastThrow: -1,
		queued: false,
		phase: "playing",
		endedAt: null,
	};
}

/** The ground under the marker now, and whether that cell is already sown. */
export function sowerMarkCell(state: SowerState, t = state.t) {
	const index = sowerCellAt(sowerMarkX(t));
	return { index, ground: state.cells[index] ?? "wayside", sown: !!state.sown[index] };
}

export function stepSower(state: SowerState, input: { sow: boolean }, events: SowerEvent[] = []): SowerState {
	if (state.phase !== "playing") return state;
	const ready = state.t - state.lastThrow >= SOWER_COOLDOWN - 1e-9;
	if (input.sow && !ready) state.queued = true;
	if (ready && (input.sow || state.queued)) {
		state.queued = false;
		let at = sowerMarkX(state.t);
		let index = sowerCellAt(at);
		if (state.cells[index] !== "good") {
			const late = sowerCellAt(sowerMarkX(Math.max(0, state.t - SOWER_GRACE)));
			if (state.cells[late] === "good") {
				index = late;
				at = (late + 0.5) * SOWER_CELL;
			}
		}
		const ground = state.cells[index] ?? "wayside";
		let sowed = false;
		if (ground === "good") {
			if (!state.sown[index]) {
				state.sown[index] = true;
				state.sownCount++;
				sowed = true;
			}
		} else state.wasted++;
		state.lastThrow = state.t;
		state.throws.push({ t: state.t, at, ground, sowed });
		events.push({ type: "throw", ground, sowed, at });
	}
	state.t += SOWER_STEP;
	if (state.t >= SOWER_SECONDS - 1e-9) {
		state.phase = sowerShare(state) >= SOWER_WIN_SHARE && state.wasted <= SOWER_MAX_WASTED ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: "end", won: state.phase === "won" });
	}
	return state;
}

/** The share of the round's good ground sown so far, 0-1. */
export function sowerShare(state: SowerState): number {
	return state.goodTotal ? state.sownCount / state.goodTotal : 0;
}

export function sowerScore(state: SowerState): number {
	return Math.max(0, Math.min(100, Math.round(100 * sowerShare(state) - SOWER_WASTE_COST * state.wasted)));
}

/** The round's result once it has ended: the score is the good ground sown, less the waste. */
export function sowerResult(state: SowerState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	return {
		won: state.phase === "won",
		score: sowerScore(state),
		count: state.sownCount,
		seconds: Math.round(state.endedAt * 10) / 10,
	};
}
