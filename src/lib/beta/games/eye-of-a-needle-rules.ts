/**
 * The Eye of a Needle (LC-17851, docs/beta/games.md), Matthew 19:23-26: "It
 * is easier for a camel to go through the eye of a needle ... With God all
 * things are possible." Pure and seeded so the tests play it; no imports
 * (Node's type stripping loads it).
 *
 * A golden thread is drawn across a linen cloth. Holding lifts it, letting go
 * lets it fall. Giant brass needles stand across the cloth from hem to hem,
 * each with one eye, and the eyes narrow as the round goes on. Touching a
 * needle snags one of three strands (with a moment's grace after, so one
 * needle never costs two). The needles come at a fixed pace, so the last one
 * is behind the thread just before the round's 15 seconds run out; the round
 * is won at 15 seconds with a strand left, lost the moment the last strand
 * snaps. The cloth's hems top and bottom stop the thread without cost: every
 * needle spans the whole cloth, so the hem is never a way around one.
 */

export const NEEDLE_STEP = 1 / 60;
/** The round's length; the win is declared when it runs out with a strand left. */
export const NEEDLE_SECONDS = 15;
/** The fastest win: every win lands at the end of the round. */
export const NEEDLE_MIN_SECONDS = NEEDLE_SECONDS;
export const NEEDLE_COUNT = 10;
/** The thread's head, fixed on screen; the cloth and needles scroll past it. */
export const NEEDLE_HEAD_X = 110;
/** How fast the needles come, picture units a second. */
export const NEEDLE_SPEED = 135;
/** When the first needle's shaft is at the head, and the seconds between needles. */
export const NEEDLE_FIRST = 1.9;
export const NEEDLE_GAP = 1.41;
export const NEEDLE_WIDTH = 22;
export const NEEDLE_THREAD_RADIUS = 4;
/** The eye's half-height, widest at the first needle and narrowest at the last. */
export const NEEDLE_EYE_FIRST = 50;
export const NEEDLE_EYE_LAST = 25;
/** Where eye centres may sit, and how far one may sit from the last. */
export const NEEDLE_EYE_MIN = 105;
export const NEEDLE_EYE_MAX = 295;
const EYE_JUMP = 125;
/** The hems: the thread's head stays between them. */
export const NEEDLE_TOP = 16;
export const NEEDLE_BOTTOM = 384;
/** Rise while held, fall otherwise (units/s^2), and the top speeds either way. */
export const NEEDLE_LIFT = 1150;
export const NEEDLE_GRAVITY = 720;
export const NEEDLE_MAX_RISE = 210;
export const NEEDLE_MAX_FALL = 230;
export const NEEDLE_START_Y = 190;
export const NEEDLE_STRANDS = 3;
/** Seconds of grace after a snag. */
export const NEEDLE_GUARD = 0.8;

export interface Needle {
	/** Second its shaft's centre is at the head. */
	at: number;
	eyeY: number;
	half: number;
	state: "ahead" | "threaded" | "snagged";
}

export interface NeedleState {
	t: number;
	y: number;
	vy: number;
	held: boolean;
	strands: number;
	/** Grace runs until this second. */
	guardUntil: number;
	needles: Needle[];
	threaded: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type NeedleEvent = { type: "thread"; index: number } | { type: "snag"; index: number } | { type: "won" } | { type: "lost" };

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

export function newNeedle(seed: number): NeedleState {
	const next = random(seed);
	const needles: Needle[] = [];
	let last = NEEDLE_START_Y;
	for (let i = 0; i < NEEDLE_COUNT; i++) {
		const half = NEEDLE_EYE_FIRST + ((NEEDLE_EYE_LAST - NEEDLE_EYE_FIRST) * i) / (NEEDLE_COUNT - 1);
		const low = Math.max(NEEDLE_EYE_MIN, last - EYE_JUMP);
		const high = Math.min(NEEDLE_EYE_MAX, last + EYE_JUMP);
		// Lean away from the last eye so the thread always has to move.
		let eyeY = low + next() * (high - low);
		if (Math.abs(eyeY - last) < 45) eyeY = last + (eyeY >= last ? 1 : -1) * 45;
		if (eyeY > NEEDLE_EYE_MAX) eyeY = last - 45 - next() * 40;
		if (eyeY < NEEDLE_EYE_MIN) eyeY = last + 45 + next() * 40;
		eyeY = Math.round(Math.max(NEEDLE_EYE_MIN, Math.min(NEEDLE_EYE_MAX, eyeY)));
		needles.push({ at: NEEDLE_FIRST + i * NEEDLE_GAP, eyeY, half, state: "ahead" });
		last = eyeY;
	}
	return { t: 0, y: NEEDLE_START_Y, vy: 0, held: false, strands: NEEDLE_STRANDS, guardUntil: 0, needles, threaded: 0, phase: "playing", endedAt: null };
}

/** A needle's shaft centre on screen at second `t`. */
export function needleX(needle: Needle, t: number): number {
	return NEEDLE_HEAD_X + (needle.at - t) * NEEDLE_SPEED;
}

/** The first needle still ahead of the thread's head, or null once all are behind it. */
export function nextNeedle(state: NeedleState): Needle | null {
	return state.needles.find((needle) => needle.state === "ahead") ?? null;
}

const REACH = NEEDLE_WIDTH / 2 + NEEDLE_THREAD_RADIUS;

export function stepNeedle(state: NeedleState, input: { hold: boolean }, events: NeedleEvent[] = []): NeedleState {
	if (state.phase !== "playing") return state;
	const dt = NEEDLE_STEP;
	state.held = input.hold;
	state.vy += (input.hold ? -NEEDLE_LIFT : NEEDLE_GRAVITY) * dt;
	state.vy = Math.max(-NEEDLE_MAX_RISE, Math.min(NEEDLE_MAX_FALL, state.vy));
	state.y += state.vy * dt;
	if (state.y < NEEDLE_TOP) {
		state.y = NEEDLE_TOP;
		state.vy = Math.abs(state.vy) * 0.25;
	} else if (state.y > NEEDLE_BOTTOM) {
		state.y = NEEDLE_BOTTOM;
		state.vy = 0;
	}
	state.t += dt;

	for (let index = 0; index < state.needles.length; index++) {
		const needle = state.needles[index];
		if (needle.state !== "ahead") continue;
		const x = needleX(needle, state.t);
		if (x > NEEDLE_HEAD_X + REACH) break;
		const inEye = Math.abs(state.y - needle.eyeY) <= needle.half - NEEDLE_THREAD_RADIUS;
		if (x >= NEEDLE_HEAD_X - REACH) {
			if (!inEye && state.t >= state.guardUntil) {
				needle.state = "snagged";
				state.strands -= 1;
				state.guardUntil = state.t + NEEDLE_GUARD;
				events.push({ type: "snag", index });
			}
		} else {
			needle.state = "threaded";
			state.threaded += 1;
			events.push({ type: "thread", index });
		}
	}

	if (state.strands <= 0) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= NEEDLE_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: seven a clean eye, ten a strand kept (100 for a clean run). */
export function needleResult(state: NeedleState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const score = won ? Math.min(100, state.threaded * 7 + state.strands * 10) : Math.min(39, state.threaded * 4);
	return { won, score, count: state.threaded, seconds };
}
