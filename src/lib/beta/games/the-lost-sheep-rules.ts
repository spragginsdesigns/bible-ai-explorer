/**
 * The Lost Sheep (LC-17851, docs/beta/games.md), Matthew 18:12-14: the one
 * that went astray, sought in the mountains. The sheep peeks out from behind
 * a rock, a bush or a ravine's lip for a moment, then hides somewhere else;
 * a goat peeks too, and two rocks are shaped like sheep. Tap the sheep while
 * it shows, three times, as it flees and hides. A wrong tap costs time. Pure
 * and seeded so the tests play it; no imports (Node's type stripping loads
 * it).
 */

export const SHEEP_STEP = 1 / 60;
export const SHEEP_SECONDS = 15;
export const SHEEP_FINDS = 3;
/** The sheep first peeks at this tick, and after a find it runs and hides for this many ticks. */
export const SHEEP_FIRST_TICKS = 48;
export const SHEEP_FLEE_TICKS = 66;
/** Ticks it stays out, by finds so far: shorter as it grows wary. */
export const SHEEP_WINDOWS = [66, 54, 44] as const;
/** Seconds a tap on the goat or a sheep-shaped rock costs, and a tap on nothing. */
export const SHEEP_DECOY_PENALTY = 1.2;
export const SHEEP_MISS_PENALTY = 0.5;
/** The fastest a round can be won: each find the moment the sheep peeks. */
export const SHEEP_MIN_SECONDS = (SHEEP_FIRST_TICKS + (SHEEP_FINDS - 1) * SHEEP_FLEE_TICKS) / 60;

export type SheepCover = "rock" | "bush" | "ravine";

/** Hiding places over the mountain: where the cover's top is, how near (scale), and what hides it. */
export const SHEEP_SPOTS: readonly { x: number; y: number; scale: number; cover: SheepCover }[] = [
	{ x: 62, y: 176, scale: 0.68, cover: "rock" },
	{ x: 196, y: 166, scale: 0.64, cover: "bush" },
	{ x: 330, y: 184, scale: 0.7, cover: "rock" },
	{ x: 120, y: 248, scale: 0.84, cover: "ravine" },
	{ x: 262, y: 240, scale: 0.84, cover: "bush" },
	{ x: 360, y: 276, scale: 0.9, cover: "rock" },
	{ x: 56, y: 322, scale: 1, cover: "bush" },
	{ x: 200, y: 336, scale: 1, cover: "ravine" },
	{ x: 330, y: 360, scale: 1.05, cover: "rock" },
];
/** Where the sheep-shaped rocks may lie (two of them a round). */
export const SHEEP_DECOY_SPOTS: readonly { x: number; y: number; scale: number }[] = [
	{ x: 140, y: 196, scale: 0.72 },
	{ x: 272, y: 300, scale: 0.95 },
	{ x: 112, y: 378, scale: 1 },
	{ x: 382, y: 212, scale: 0.7 },
];

export interface SheepPeek {
	spot: number;
	showAt: number;
	hideAt: number;
}

export interface SheepState {
	tick: number;
	t: number;
	rng: number;
	finds: number;
	sheep: SheepPeek;
	/** The last find: where it ran from and when. */
	fled: { spot: number; tick: number } | null;
	goat: SheepPeek;
	decoys: number[];
	penalty: number;
	mistakes: number;
	/** The last few taps, for the flash: what they hit. */
	taps: { x: number; y: number; tick: number; kind: "sheep" | "goat" | "rock" | "miss" }[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type SheepEvent = { type: "peek" } | { type: "goat" } | { type: "found" } | { type: "wrong"; kind: "goat" | "rock" | "miss" } | { type: "won" } | { type: "lost" };

function nextRandom(state: SheepState): number {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function otherSpot(state: SheepState, not: number[]): number {
	const choices = SHEEP_SPOTS.map((_, index) => index).filter((index) => !not.includes(index));
	return choices[Math.floor(nextRandom(state) * choices.length)];
}

export function newSheep(seed: number): SheepState {
	const state: SheepState = {
		tick: 0,
		t: 0,
		rng: seed >>> 0 || 1,
		finds: 0,
		sheep: { spot: 0, showAt: SHEEP_FIRST_TICKS, hideAt: SHEEP_FIRST_TICKS + SHEEP_WINDOWS[0] },
		fled: null,
		goat: { spot: 0, showAt: 0, hideAt: 0 },
		decoys: [],
		penalty: 0,
		mistakes: 0,
		taps: [],
		phase: "playing",
		endedAt: null,
	};
	const first = Math.floor(nextRandom(state) * SHEEP_DECOY_SPOTS.length);
	state.decoys = [first, (first + 1 + Math.floor(nextRandom(state) * (SHEEP_DECOY_SPOTS.length - 1))) % SHEEP_DECOY_SPOTS.length];
	state.sheep.spot = otherSpot(state, []);
	const goatAt = 70 + Math.floor(nextRandom(state) * 40);
	state.goat = { spot: otherSpot(state, [state.sheep.spot]), showAt: goatAt, hideAt: goatAt + 60 };
	return state;
}

export function sheepVisible(peek: SheepPeek, tick: number): boolean {
	return tick >= peek.showAt && tick < peek.hideAt;
}

/** Where a peeking head is, and how far it has risen (0-1), in stage units. */
export function sheepHead(peek: SheepPeek, tick: number): { x: number; y: number; r: number; rise: number } {
	const spot = SHEEP_SPOTS[peek.spot];
	const rise = sheepVisible(peek, tick) ? Math.min(1, (tick - peek.showAt + 1) / 8, (peek.hideAt - tick) / 8) : 0;
	return { x: spot.x, y: spot.y - 10 * spot.scale, r: 30 * spot.scale + 6, rise };
}

/** Seconds left on the clock, wrong taps taken off. */
export function sheepLeft(state: SheepState): number {
	return Math.max(0, SHEEP_SECONDS - state.t - state.penalty);
}

function hits(peek: SheepPeek, tick: number, x: number, y: number): boolean {
	if (!sheepVisible(peek, tick)) return false;
	const head = sheepHead(peek, tick);
	return Math.hypot(x - head.x, y - head.y) <= head.r;
}

export function stepSheep(state: SheepState, input: { tap?: { x: number; y: number } | null }, events: SheepEvent[] = []): SheepState {
	if (state.phase !== "playing") return state;
	state.tick += 1;
	state.t = state.tick / 60;
	const tick = state.tick;
	if (tick === state.sheep.showAt) events.push({ type: "peek" });
	if (tick === state.goat.showAt) events.push({ type: "goat" });

	if (input.tap) {
		const { x, y } = input.tap;
		let kind: "sheep" | "goat" | "rock" | "miss" = "miss";
		if (hits(state.sheep, tick, x, y)) kind = "sheep";
		else if (hits(state.goat, tick, x, y)) kind = "goat";
		else if (state.decoys.some((index) => Math.hypot((x - SHEEP_DECOY_SPOTS[index].x) / 1.4, y - SHEEP_DECOY_SPOTS[index].y) <= 24 * SHEEP_DECOY_SPOTS[index].scale + 4)) kind = "rock";
		state.taps.push({ x, y, tick, kind });
		if (state.taps.length > 6) state.taps.shift();
		if (kind === "sheep") {
			state.finds += 1;
			events.push({ type: "found" });
			if (state.finds >= SHEEP_FINDS) {
				state.phase = "won";
				state.endedAt = state.t;
				events.push({ type: "won" });
				return state;
			}
			// It flees and hides elsewhere.
			state.fled = { spot: state.sheep.spot, tick };
			const spot = otherSpot(state, [state.sheep.spot, state.goat.spot]);
			const showAt = tick + SHEEP_FLEE_TICKS;
			state.sheep = { spot, showAt, hideAt: showAt + SHEEP_WINDOWS[state.finds] };
		} else {
			state.penalty += kind === "miss" ? SHEEP_MISS_PENALTY : SHEEP_DECOY_PENALTY;
			state.mistakes += 1;
			events.push({ type: "wrong", kind });
		}
	}

	// Hidden again: it creeps to another place and peeks out there.
	if (tick >= state.sheep.hideAt) {
		const showAt = tick + 20 + Math.floor(nextRandom(state) * 24);
		state.sheep = { spot: otherSpot(state, [state.sheep.spot, state.goat.spot]), showAt, hideAt: showAt + SHEEP_WINDOWS[state.finds] };
	}
	if (tick >= state.goat.hideAt && tick >= state.goat.showAt) {
		const showAt = tick + 40 + Math.floor(nextRandom(state) * 50);
		state.goat = { spot: otherSpot(state, [state.sheep.spot, state.goat.spot]), showAt, hideAt: showAt + 54 + Math.floor(nextRandom(state) * 18) };
	}
	if (SHEEP_SECONDS - state.t - state.penalty <= 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: found sooner, with fewer wrong taps, is a higher score. */
export function sheepResult(state: SheepState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.mistakes * 10 - Math.max(0, state.endedAt - 5.5) * 7))) : 0;
	return { won: state.phase === "won", score, count: state.finds, seconds };
}
