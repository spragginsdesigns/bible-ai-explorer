/**
 * Have Mercy on Us (LC-17851, docs/beta/games.md), Matthew 20:29-34: two blind
 * men by the way side cry out as Jesus passes by, and the multitude rebukes
 * them. Pure and seeded so the tests play it; no imports (Node's type
 * stripping loads it).
 *
 * Each cry raises the men's voice; the voice falls away all the time and
 * faster while the crowd rebukes them. Once Jesus is near enough to hear,
 * holding the voice above the line long enough makes him stand still (v32).
 * He passes by at the end of the round.
 */

export const MERCY_STEP = 1 / 60;
/** How long Jesus takes to pass by. */
export const MERCY_SECONDS = 12;
/** He can hear them from this second on. */
export const MERCY_HEAR_FROM = 2;
/** Seconds the voice must stay above the line, while he can hear, to be heard. */
export const MERCY_HOLD = 2.5;
export const MERCY_LINE = 75;
export const MERCY_GAIN = 8;
/** Cries closer together than this count once (twelve a second at most). */
export const MERCY_MIN_GAP = 1 / 12;
export const MERCY_DECAY = 32;
export const MERCY_REBUKE_DECAY = 48;
/** How long the crowd raises its hands before a rebuke, and how long a rebuke lasts. */
export const MERCY_WARN = 0.5;
export const MERCY_REBUKE = 1.3;
/** The fastest a round can be won: heard from the moment he can hear. */
export const MERCY_MIN_SECONDS = MERCY_HEAR_FROM + MERCY_HOLD;

export interface MercyRebuke {
	/** When the crowd's hands go up, and the rebuke's start and end. */
	warn: number;
	from: number;
	to: number;
}

export interface MercyState {
	t: number;
	voice: number;
	heard: number;
	cries: number;
	lastCry: number;
	rebukes: MercyRebuke[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type MercyEvent = { type: "cry" } | { type: "rebuke" } | { type: "heard" } | { type: "passed" };

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

export function newMercy(seed: number): MercyState {
	const next = random(seed);
	const rebukes: MercyRebuke[] = [];
	for (let at = 1.6 + next() * 0.8; at < MERCY_SECONDS - 1; at += MERCY_REBUKE + 1.1 + next() * 1.1) {
		rebukes.push({ warn: at, from: at + MERCY_WARN, to: at + MERCY_WARN + MERCY_REBUKE });
	}
	return { t: 0, voice: 0, heard: 0, cries: 0, lastCry: -1, rebukes, phase: "playing", endedAt: null };
}

export function rebukeAt(state: MercyState, t = state.t): MercyRebuke | null {
	return state.rebukes.find((rebuke) => t >= rebuke.from && t < rebuke.to) ?? null;
}

/** Where Jesus is on the road, 0 (just come into view) to 1 (passed by). */
export function jesusAlong(state: MercyState): number {
	return Math.min(1, (state.endedAt ?? state.t) / MERCY_SECONDS);
}

export function stepMercy(state: MercyState, input: { cry: boolean }, events: MercyEvent[] = []): MercyState {
	if (state.phase !== "playing") return state;
	const dt = MERCY_STEP;
	if (input.cry && state.t - state.lastCry >= MERCY_MIN_GAP - 1e-9) {
		state.voice = Math.min(100, state.voice + MERCY_GAIN);
		state.cries += 1;
		state.lastCry = state.t;
		events.push({ type: "cry" });
	}
	const before = rebukeAt(state);
	state.voice = Math.max(0, state.voice - (before ? MERCY_REBUKE_DECAY : MERCY_DECAY) * dt);
	if (state.t >= MERCY_HEAR_FROM && state.voice >= MERCY_LINE) state.heard += dt;
	state.t += dt;
	const now = rebukeAt(state);
	if (now && now !== before) events.push({ type: "rebuke" });
	if (state.heard >= MERCY_HOLD - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "heard" });
	} else if (state.t >= MERCY_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "passed" });
	}
	return state;
}

/** The round's result once it has ended: heard sooner is a higher score. */
export function mercyResult(state: MercyState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - (state.endedAt - 4.5) * 9))) : 0;
	return { won: state.phase === "won", score, count: state.cries, seconds };
}
