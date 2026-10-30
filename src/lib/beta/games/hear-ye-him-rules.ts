/**
 * Hear Ye Him (LC-17908, docs/beta/games.md), Matthew 17:1-8: "Jesus taketh
 * Peter, James, and John his brother, and bringeth them up into an high
 * mountain apart" (v1). Pure and seeded so the tests play it; no imports
 * (Node's type stripping loads it).
 *
 * A bounce-climb. Peter springs up by himself each time he lands on a ledge
 * of rock while falling, and the player only steers him left and right; he
 * passes up through ledges from below. The view climbs with him and never
 * comes back down. Ledges are wide, narrow, loose stones that crumble after
 * one landing, or wind-swept and drifting, and they spread further apart
 * higher up; no ledge lies straight above another within a spring, so every
 * bounce must be steered. Falling past the bottom of the view is a stumble:
 * he is set back on the last good ledge he stood on and one of three marks of
 * faith is lost; the third stumble loses. Climbing into the bright cloud at
 * the summit wins.
 */

export const HEAR_STEP = 1 / 60;
/** The round's length. */
export const HEAR_SECONDS = 15;
/** The stage's width, and how wide Peter is from his middle. */
export const HEAR_WIDTH = 400;
export const HEAR_HALF = 9;
/** Units per second squared, the spring's speed, and the highest a spring rises. */
export const HEAR_GRAVITY = 1300;
export const HEAR_SPRING = 640;
export const HEAR_APEX = (HEAR_SPRING * HEAR_SPRING) / (2 * HEAR_GRAVITY);
/** Steering: top speed sideways, and how quickly he reaches it or stops. */
export const HEAR_RUN = 240;
export const HEAR_ACCEL = 2200;
/** Where the bright cloud begins: climbing into it wins. */
export const HEAR_SUMMIT = 1500;
/** Peter is kept no higher than this above the bottom of the view; the view is HEAR_WIDTH tall. */
export const HEAR_CAMERA = 230;
/** How far below the view's bottom he may fall before it is a stumble. */
export const HEAR_FALL = 24;
export const HEAR_MARKS = 3;

export type LedgeKind = "ground" | "wide" | "narrow" | "loose" | "wind";

export interface Ledge {
	kind: LedgeKind;
	/** Its middle (for a wind-swept ledge, the middle of its drift) and its top. */
	x: number;
	y: number;
	w: number;
	/** A wind-swept ledge drifts `amp * sin(omega * t + phase)` about its middle. */
	amp: number;
	omega: number;
	phase: number;
	/** When a loose ledge crumbled, or null. */
	broken: number | null;
}

export interface HearState {
	t: number;
	tick: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** The view's bottom, in the mountain's height. */
	camera: number;
	ledges: Ledge[];
	/** The last good (not loose) ledge he stood on, where a stumble sets him back. */
	lastGood: number;
	/** Ledges landed on, each counted once. */
	landed: number[];
	springs: number;
	stumbles: number;
	highest: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type HearEvent =
	| { type: "spring"; kind: LedgeKind; index: number }
	| { type: "crumble"; index: number }
	| { type: "stumble"; marksLeft: number }
	| { type: "summit" }
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

const WIDTHS: Record<LedgeKind, number> = { ground: HEAR_WIDTH, wide: 92, narrow: 46, loose: 62, wind: 66 };

/** Seconds from a spring until he falls back through `rise` above where he sprang. */
export function hearFallTime(rise: number, vy = HEAR_SPRING, y = 0): number {
	const under = vy * vy - 2 * HEAR_GRAVITY * (rise - y);
	return under < 0 ? Infinity : (vy + Math.sqrt(under)) / HEAR_GRAVITY;
}

/** The left and right edge a ledge can ever reach (its drift included). */
function span(ledge: Ledge): [number, number] {
	return [ledge.x - ledge.amp - ledge.w / 2, ledge.x + ledge.amp + ledge.w / 2];
}

export function newHear(seed: number): HearState {
	const next = random(seed);
	const ground: Ledge = { kind: "ground", x: HEAR_WIDTH / 2, y: 0, w: HEAR_WIDTH, amp: 0, omega: 0, phase: 0, broken: null };
	const ledges: Ledge[] = [ground];
	/** Nothing may lie over a ledge within a spring of it, so that steering is always needed. */
	const clear = (candidate: Ledge, strict: boolean) => {
		const [left, right] = span(candidate);
		return ledges.every((other) => {
			if (candidate.y - other.y > HEAR_APEX + 12 || other.y > candidate.y) return true;
			// Never over where he stands at the start, so standing still never climbs.
			if (other.kind === "ground") return right < HEAR_WIDTH / 2 - HEAR_HALF - 4 || left > HEAR_WIDTH / 2 + HEAR_HALF + 4;
			if (!strict) return true;
			const [otherLeft, otherRight] = span(other);
			return right + HEAR_HALF + 4 < otherLeft || left - HEAR_HALF - 4 > otherRight;
		});
	};
	/** Places a ledge at height `y`, beside the ledge at `from` (whose half-width and drift are `fromSpan`) and within `reach` of it. */
	const place = (y: number, kind: LedgeKind, from: number, fromSpan: number, reach: number, strict = true) => {
		const w = WIDTHS[kind];
		let amp = kind === "wind" ? 18 + next() * 18 : 0;
		const omega = kind === "wind" ? 1.1 + next() * 0.8 : 0;
		const phase = kind === "wind" ? next() * Math.PI * 2 : 0;
		let best: Ledge | null = null;
		for (let attempt = 0; attempt < 24; attempt++) {
			const low = w / 2 + amp + 8;
			const high = HEAR_WIDTH - low;
			const side = next() < 0.5 ? -1 : 1;
			// Clear of the ledge below it, and no further than he can be steered (a drift takes from that).
			const near = fromSpan + w / 2 + amp + HEAR_HALF + 6;
			const far = Math.max(near, reach + w / 2 - amp);
			const x = Math.max(low, Math.min(high, from + side * (near + next() * (far - near))));
			const ledge: Ledge = { kind, x, y, w, amp, omega, phase, broken: null };
			if (clear(ledge, strict) && Math.abs(x - from) <= far + 0.5) {
				best = ledge;
				break;
			}
			if (kind === "wind") amp = Math.max(12, amp * 0.92);
		}
		if (best) ledges.push(best);
		return best;
	};
	let y = 0;
	let x = HEAR_WIDTH / 2;
	let shrink = 0;
	let drift = 0;
	let fromSpan = 9;
	while (y < HEAR_SUMMIT - 40) {
		const climb = Math.min(1, y / HEAR_SUMMIT);
		const roll = next();
		// The way up is never loose: a crumbled stone must not leave him no way on.
		let kind: LedgeKind = "wide";
		if (climb > 0.12) {
			if (roll < 0.28) kind = "narrow";
			else if (roll < 0.62) kind = "wind";
			else if (roll < 0.86 - climb * 0.4) kind = "wide";
			else kind = "narrow";
		}
		// A wind-swept ledge comes a little closer, for the drift takes from the reach.
		const gap = Math.max(48, Math.min(kind === "wind" ? 104 : 140, 84 + 46 * climb + next() * 20) - shrink);
		// How far sideways he can be steered while falling back to this ledge.
		const reach = Math.min(170, HEAR_RUN * hearFallTime(gap) * 0.62) - drift;
		const placed =
			place(y + gap, kind, x, fromSpan, reach) ??
			place(y + gap, "narrow", x, fromSpan, reach) ??
			(shrink > 90 ? place(y + gap, "narrow", x, fromSpan, reach, false) : null);
		if (!placed) {
			// No room at this height: try a little lower, so the way up never opens a gap too high to spring.
			shrink += 15;
			continue;
		}
		shrink = 0;
		y = placed.y;
		x = placed.x;
		drift = placed.amp;
		fromSpan = placed.w / 2 + placed.amp;
		// Often a second ledge to one side: loose stones that crumble, or a narrow ledge, another way up.
		if (next() < 0.65) place(y - gap * (0.3 + next() * 0.4), next() < 0.6 ? "loose" : "narrow", x, fromSpan, 200);
	}
	ledges.sort((a, b) => a.y - b.y);
	return {
		t: 0,
		tick: 0,
		x: HEAR_WIDTH / 2,
		y: 0,
		vx: 0,
		vy: HEAR_SPRING,
		camera: -60,
		ledges,
		lastGood: 0,
		landed: [],
		springs: 0,
		stumbles: 0,
		highest: 0,
		phase: "playing",
		endedAt: null,
	};
}

/** Where a ledge's middle is at time `t`. */
export function ledgeX(ledge: Ledge, t: number): number {
	return ledge.amp ? ledge.x + ledge.amp * Math.sin(ledge.omega * t + ledge.phase) : ledge.x;
}

export function stepHear(state: HearState, input: { dir: number }, events: HearEvent[] = []): HearState {
	if (state.phase !== "playing") return state;
	const dt = HEAR_STEP;
	const dir = Math.sign(input.dir || 0);
	// Steering: toward full speed the way he is held, or to a stop.
	const want = dir * HEAR_RUN;
	const change = HEAR_ACCEL * dt;
	state.vx = state.vx < want ? Math.min(want, state.vx + change) : Math.max(want, state.vx - change);
	state.x += state.vx * dt;
	if (state.x < HEAR_HALF) {
		state.x = HEAR_HALF;
		state.vx = 0;
	} else if (state.x > HEAR_WIDTH - HEAR_HALF) {
		state.x = HEAR_WIDTH - HEAR_HALF;
		state.vx = 0;
	}
	const before = state.y;
	state.vy -= HEAR_GRAVITY * dt;
	state.y += state.vy * dt;
	state.t += dt;
	state.tick += 1;
	if (state.vy <= 0) {
		// Landing: the highest ledge whose top he fell through this step, under his feet.
		let hit = -1;
		state.ledges.forEach((ledge, index) => {
			// Ledges already below the view are out of sight and out of reach: he has stumbled.
			if (ledge.broken !== null || ledge.y > before || ledge.y < state.y || ledge.y < state.camera - HEAR_FALL) return;
			if (Math.abs(state.x - ledgeX(ledge, state.t)) > ledge.w / 2 + HEAR_HALF * 0.7) return;
			if (hit < 0 || ledge.y > state.ledges[hit].y) hit = index;
		});
		if (hit >= 0) {
			const ledge = state.ledges[hit];
			state.y = ledge.y;
			state.vy = HEAR_SPRING;
			state.springs += 1;
			if (!state.landed.includes(hit)) state.landed.push(hit);
			events.push({ type: "spring", kind: ledge.kind, index: hit });
			if (ledge.kind === "loose") {
				ledge.broken = state.t;
				events.push({ type: "crumble", index: hit });
			} else state.lastGood = hit;
		}
	}
	state.highest = Math.max(state.highest, state.y);
	state.camera = Math.max(state.camera, state.y - HEAR_CAMERA);
	if (state.y >= HEAR_SUMMIT) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "summit" });
		return state;
	}
	if (state.y < state.camera - HEAR_FALL) {
		state.stumbles += 1;
		events.push({ type: "stumble", marksLeft: Math.max(0, HEAR_MARKS - state.stumbles) });
		if (state.stumbles >= HEAR_MARKS) {
			state.phase = "lost";
			state.endedAt = state.t;
			events.push({ type: "lost" });
			return state;
		}
		// Set back on the last good ledge, springing again.
		const ledge = state.ledges[state.lastGood];
		state.x = ledgeX(ledge, state.t);
		state.y = ledge.y;
		state.vx = 0;
		state.vy = HEAR_SPRING;
		state.camera = Math.min(state.camera, ledge.y - 60);
	}
	if (state.t >= HEAR_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/**
 * The soonest the summit can be reached: every spring landing at the very top
 * of the one before, the moment he stops rising. No spring can be shorter or
 * climb higher, so no round is faster. Stepped as `stepHear` steps.
 */
function fastestSummit(): number {
	let y = 0;
	let vy = HEAR_SPRING;
	let t = 0;
	while (y < HEAR_SUMMIT && t < 60) {
		const before = y;
		vy -= HEAR_GRAVITY * HEAR_STEP;
		y += vy * HEAR_STEP;
		t += HEAR_STEP;
		if (vy <= 0) {
			// The highest a ledge he falls onto this step can be is where he stood a step ago.
			y = before;
			vy = HEAR_SPRING;
		}
	}
	return t;
}

/** The fastest possible win, rounded down to a tenth. */
export const HEAR_MIN_SECONDS = Math.floor(fastestSummit() * 10) / 10;

/** The round's result once it has ended: marks of faith kept, and a quick climb, score higher. */
export function hearResult(state: HearState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const slow = Math.max(0, state.endedAt - (HEAR_MIN_SECONDS + 3.5));
	const score = state.phase === "won" ? Math.round(Math.max(10, Math.min(100, 100 - 24 * state.stumbles - 6 * slow))) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.landed.length), seconds };
}
