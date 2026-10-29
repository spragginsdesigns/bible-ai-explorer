/**
 * The Sheep and the Goats (LC-17851, docs/beta/games.md), Matthew 25:31-40:
 * "And he shall set the sheep on his right hand, but the goats on the left"
 * (v33). Pure and seeded so the tests play it; no imports (Node's type
 * stripping loads it).
 *
 * The flock comes down the path from the throne of glory, one animal at a
 * time and faster as the round goes on. Each animal can be parted only once
 * it reaches the gate at the shepherd's crook: sheep to the right hand, goats
 * to the left. A wrong parting, or an animal let past the crook, is a
 * mistake; the third mistake loses. Keep the gate for the whole round to win.
 */

export const FLOCK_STEP = 1 / 60;
export const FLOCK_SECONDS = 15;
/** Surviving the round is the win, so it can never be won sooner. */
export const FLOCK_MIN_SECONDS = FLOCK_SECONDS;
export const FLOCK_MISTAKES = 3;
/** Where on the path (0 at the throne, 1 past the crook) the gate opens. */
export const FLOCK_GATE = 0.6;
export const FLOCK_FIRST = 0.2;

/** Seconds an animal takes down the whole path, by when it set out. */
export function flockWalk(at: number): number {
	return 2.9 - 1.05 * Math.min(1, at / FLOCK_SECONDS);
}

/** Seconds to the next animal, by when the last one set out. */
export function flockGap(at: number): number {
	return 1.0 - 0.5 * Math.min(1, at / 13);
}

export type FlockKind = "sheep" | "goat";
export type FlockSide = "left" | "right";

export interface FlockAnimal {
	id: number;
	kind: FlockKind;
	born: number;
	walk: number;
	parted: { side: FlockSide; at: number; right: boolean } | null;
	strayed: number | null;
}

export interface FlockState {
	t: number;
	animals: FlockAnimal[];
	nextAt: number;
	nextId: number;
	right: number;
	mistakes: number;
	/** Presses made before anyone reached the gate (they do nothing, the stage says "wait"). */
	early: number;
	seed: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type FlockEvent =
	| { type: "come"; kind: FlockKind }
	| { type: "parted"; kind: FlockKind; side: FlockSide; right: boolean }
	| { type: "early" }
	| { type: "strayed"; kind: FlockKind }
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

export function newFlock(seed: number): FlockState {
	return { t: 0, animals: [], nextAt: FLOCK_FIRST, nextId: 0, right: 0, mistakes: 0, early: 0, seed: seed >>> 0 || 1, phase: "playing", endedAt: null };
}

/** How far an animal is down the path, 0 at the throne to 1 at the crook. */
export function flockAlong(animal: FlockAnimal, t: number): number {
	return Math.max(0, (t - animal.born) / animal.walk);
}

/** The animal a press parts now: the foremost one at the gate. */
export function flockAtGate(state: FlockState): FlockAnimal | null {
	return state.animals.find((animal) => !animal.parted && animal.strayed === null && flockAlong(animal, state.t) >= FLOCK_GATE) ?? null;
}

/** Sheep on the right hand, goats on the left (v33). */
export function flockSideFor(kind: FlockKind): FlockSide {
	return kind === "sheep" ? "right" : "left";
}

export function stepFlock(state: FlockState, input: { side: FlockSide | null }, events: FlockEvent[] = []): FlockState {
	if (state.phase !== "playing") return state;
	if (input.side) {
		const animal = flockAtGate(state);
		if (animal) {
			const right = flockSideFor(animal.kind) === input.side;
			animal.parted = { side: input.side, at: state.t, right };
			if (right) state.right += 1;
			else state.mistakes += 1;
			events.push({ type: "parted", kind: animal.kind, side: input.side, right });
		} else {
			state.early += 1;
			events.push({ type: "early" });
		}
	}
	state.t += FLOCK_STEP;
	if (state.t >= state.nextAt - 1e-9 && state.t < FLOCK_SECONDS - 0.9) {
		const next = random(state.seed + state.nextId * 104729);
		const kind: FlockKind = next() < 0.5 ? "sheep" : "goat";
		state.animals.push({ id: state.nextId, kind, born: state.t, walk: flockWalk(state.t), parted: null, strayed: null });
		state.nextId += 1;
		state.nextAt = state.t + flockGap(state.t) * (0.85 + next() * 0.3);
		events.push({ type: "come", kind });
	}
	for (const animal of state.animals) {
		if (!animal.parted && animal.strayed === null && flockAlong(animal, state.t) >= 1) {
			animal.strayed = state.t;
			state.mistakes += 1;
			events.push({ type: "strayed", kind: animal.kind });
		}
	}
	state.animals = state.animals.filter((animal) => (animal.parted ? state.t - animal.parted.at < 1.2 : animal.strayed === null || state.t - animal.strayed < 1.2));
	if (state.mistakes >= FLOCK_MISTAKES) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= FLOCK_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: every mistake costs. */
export function flockResult(state: FlockState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const handled = state.right + state.mistakes;
	const score = state.phase === "won" ? Math.max(0, Math.min(100, Math.round((100 * state.right) / Math.max(1, handled) - 12 * state.mistakes))) : 0;
	return { won: state.phase === "won", score, count: state.right, seconds };
}
