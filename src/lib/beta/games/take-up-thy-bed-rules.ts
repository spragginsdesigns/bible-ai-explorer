/**
 * Take Up Thy Bed (LC-17908, docs/beta/games.md), Matthew 9:2-8: "they
 * brought to him a man sick of the palsy, lying on a bed ... Arise, take up
 * thy bed, and go unto thine house. And he arose, and departed to his house."
 * Pure and seeded so the tests play it; no imports (Node's type stripping
 * loads it).
 *
 * The bearers carry the bed down the street of his own city toward Jesus at
 * their own pace. The bed balances like an inverted pendulum: once it leans,
 * it leans further unless it is leaned back, and it carries its momentum, so
 * too hard a correction tips it the other way. Rough places in the road (a
 * stone, a rut, a step, a press of the crowd) show a moment before the front
 * bearer meets them, then jolt it. Past the limit the bearers stumble: they
 * stop and steady the bed (the man is never thrown), losing time; three
 * stumbles lose. Reaching Jesus wins.
 *
 * Tilt is in degrees: positive leans the bed forward (its front, the right
 * end, lower), negative leans it back.
 */

export const BED_STEP = 1 / 60;
/** The round's length. */
export const BED_SECONDS = 15;
/** Ticks of walking from the start of the street to Jesus. */
export const BED_WALK_TICKS = 690;
/** The fastest a round can be won: walking the whole way without a stumble. */
export const BED_MIN_SECONDS = BED_WALK_TICKS / 60;
/** How far the bed may lean, either way, before the bearers stumble. */
export const BED_LIMIT = 24;
/** The lean feeds itself: degrees a second squared for each degree of lean. */
export const BED_FALL = 3.1;
/** The bearers' arms soak up some swing: per second. */
export const BED_DAMP = 0.8;
/** Degrees a second squared that a held lean pushes. */
export const BED_PUSH = 150;
/** How long a stumble stops them. */
export const BED_STUMBLE_TICKS = 66;
export const BED_STUMBLES = 3;
/** Seconds of walking that a rough place shows its jolt before the front bearer meets it. */
export const BED_WARN = 0.75;
/** A lean this small or less counts as level, for the score. */
export const BED_LEVEL = 3;

export type BedKind = "stone" | "rut" | "step-up" | "step-down" | "press";

export interface BedBump {
	/** The walked tick at which the front bearer meets it. */
	at: number;
	kind: BedKind;
	/** The jolt to the bed's swing, in degrees a second (negative tips it back). */
	kick: number;
	/** It has jolted the bed. */
	done: boolean;
}

export interface BedState {
	tick: number;
	/** Ticks walked (0 to BED_WALK_TICKS). */
	walked: number;
	tilt: number;
	swing: number;
	bumps: BedBump[];
	/** Where the bed sits after each stumble, so a steadied bed still needs a hand. */
	resets: number[];
	stumbles: number;
	/** Ticks left of the stumble now under way. */
	stopped: number;
	/** Walking ticks, and the sum of each one's levelness (1 level, 0 at the limit). */
	walkTicks: number;
	levelSum: number;
	/** Rough places ridden out. */
	ridden: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type BedEvent =
	| { type: "warn"; kind: BedKind; kick: number }
	| { type: "jolt"; kind: BedKind; kick: number }
	| { type: "stumble"; stumbles: number }
	| { type: "steady" }
	| { type: "arrived" }
	| { type: "lost" };

/** Lean the bed: -1 leans it back (←), 1 forward (→), 0 lets it be. */
export interface BedInput {
	dir: number;
}

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

/** Which way each rough place tips the bed as the front bearer meets it. */
const KICK_SIGN: Record<Exclude<BedKind, "press">, number> = { stone: -1, "step-up": -1, rut: 1, "step-down": 1 };

export function newBed(seed: number): BedState {
	const next = random(seed);
	const bumps: BedBump[] = [];
	const kinds: Exclude<BedKind, "press">[] = ["stone", "rut", "step-up", "step-down"];
	// A press of the crowd somewhere in the second half: two or three quick shoves.
	const pressFrom = 330 + Math.floor(next() * 140);
	let at = 70 + Math.floor(next() * 30);
	while (at < BED_WALK_TICKS - 40) {
		const along = at / BED_WALK_TICKS;
		if (at >= pressFrom && !bumps.some((bump) => bump.kind === "press")) {
			let side = next() < 0.5 ? -1 : 1;
			const shoves = 2 + (next() < 0.5 ? 1 : 0);
			for (let i = 0; i < shoves; i++) {
				bumps.push({ at, kind: "press", kick: side * (26 + next() * 14), done: false });
				side = -side;
				at += 30 + Math.floor(next() * 10);
			}
			at += 34 + Math.floor(next() * 16);
			continue;
		}
		const kind = kinds[Math.floor(next() * kinds.length)];
		const size = 32 + along * 20 + next() * 12;
		bumps.push({ at, kind, kick: KICK_SIGN[kind] * size, done: false });
		at += Math.round(64 - along * 14 + next() * 24);
	}
	const lean = () => (next() < 0.5 ? -1 : 1) * (0.8 + next() * 0.8);
	return {
		tick: 0,
		walked: 0,
		tilt: lean(),
		swing: 0,
		bumps,
		resets: [lean(), lean(), lean()],
		stumbles: 0,
		stopped: 0,
		walkTicks: 0,
		levelSum: 0,
		ridden: 0,
		phase: "playing",
		endedAt: null,
	};
}

/** How far along the street they are, 0 to 1. */
export function bedAlong(state: BedState): number {
	return Math.min(1, state.walked / BED_WALK_TICKS);
}

/** The rough place about to jolt the bed, while it shows its warning. */
export function bedComing(state: BedState): BedBump | null {
	return state.bumps.find((bump) => !bump.done && bump.at - state.walked <= BED_WARN * 60) ?? null;
}

export function stepBed(state: BedState, input: BedInput, events: BedEvent[] = []): BedState {
	if (state.phase !== "playing") return state;
	const dt = BED_STEP;
	state.tick += 1;
	if (state.stopped > 0) {
		// The bearers have stopped and steady the bed: it settles back toward level.
		state.stopped -= 1;
		state.tilt *= 0.9;
		state.swing = 0;
		if (state.stopped === 0) {
			state.tilt = state.resets[state.stumbles - 1] ?? 0;
			events.push({ type: "steady" });
		}
	} else {
		const dir = Math.max(-1, Math.min(1, Math.round(input.dir) || 0));
		state.swing += (BED_FALL * state.tilt + BED_PUSH * dir - BED_DAMP * state.swing) * dt;
		state.tilt += state.swing * dt;
		const before = state.walked;
		state.walked += 1;
		for (const bump of state.bumps) {
			if (bump.done) continue;
			const warnAt = bump.at - BED_WARN * 60;
			if (before < warnAt && state.walked >= warnAt) events.push({ type: "warn", kind: bump.kind, kick: bump.kick });
			if (state.walked >= bump.at) {
				bump.done = true;
				state.swing += bump.kick;
				state.ridden += 1;
				events.push({ type: "jolt", kind: bump.kind, kick: bump.kick });
			}
		}
		state.walkTicks += 1;
		state.levelSum += Math.max(0, 1 - Math.max(0, Math.abs(state.tilt) - BED_LEVEL) / (BED_LIMIT - BED_LEVEL));
		if (Math.abs(state.tilt) >= BED_LIMIT) {
			state.tilt = Math.sign(state.tilt) * BED_LIMIT;
			state.swing = 0;
			state.stumbles += 1;
			// The jolt that tipped it is not ridden out.
			state.ridden = Math.max(0, state.ridden - 1);
			events.push({ type: "stumble", stumbles: state.stumbles });
			if (state.stumbles >= BED_STUMBLES) {
				state.phase = "lost";
				state.endedAt = state.tick / 60;
				events.push({ type: "lost" });
				return state;
			}
			state.stopped = BED_STUMBLE_TICKS;
		}
		if (state.walked >= BED_WALK_TICKS) {
			state.phase = "won";
			state.endedAt = state.tick / 60;
			events.push({ type: "arrived" });
			return state;
		}
	}
	if (state.tick >= BED_SECONDS * 60) {
		state.phase = "lost";
		state.endedAt = state.tick / 60;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: how level the bed was kept, less each stumble. */
export function bedResult(state: BedState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const level = state.walkTicks ? state.levelSum / state.walkTicks : 0;
	const score = state.phase === "won" ? Math.round(Math.max(5, Math.min(100, 100 * level - 24 * state.stumbles))) : 0;
	return { won: state.phase === "won", score, count: state.ridden, seconds };
}
