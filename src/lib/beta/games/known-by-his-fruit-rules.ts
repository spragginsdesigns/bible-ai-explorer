/**
 * Known by His Fruit (LC-17851, docs/beta/games.md), Matthew 12:33-35:
 * "Either make the tree good, and his fruit good; or else make the tree
 * corrupt, and his fruit corrupt: for the tree is known by his fruit" (v33).
 * Pure and seeded so the tests play it; no imports (Node's type stripping
 * loads it).
 *
 * Fruit buds on the tree, ripens bright, and if it is left it turns corrupt
 * and falls. Picking a ripe fruit puts it in the basket; picking a corrupt
 * one costs, and a third corrupt pick loses. Picking a bud does nothing. The
 * round runs its full time; enough good fruit by then wins.
 */

export const FRUIT_STEP = 1 / 60;
export const FRUIT_SECONDS = 15;
/** The basket must hold this much good fruit when the round ends. */
export const FRUIT_GOAL = 24;
/** A third corrupt pick loses. */
export const FRUIT_CORRUPT_LIMIT = 2;
/** Gathering is counted at the end of the round, so it can never be won sooner. */
export const FRUIT_MIN_SECONDS = FRUIT_SECONDS;
/** Seconds a fruit is a green bud before it ripens. */
export const FRUIT_BUD = 0.5;
/** Seconds a corrupt fruit hangs before it falls. */
export const FRUIT_HANG = 1.6;
/** How near (in picture units) a tap must land to pick a fruit. */
export const FRUIT_REACH = 27;

/** Where fruit grows on the tree, in the 400x400 picture. */
export const FRUIT_SPOTS: readonly { x: number; y: number }[] = [
	{ x: 110, y: 120 },
	{ x: 170, y: 88 },
	{ x: 236, y: 92 },
	{ x: 294, y: 122 },
	{ x: 84, y: 182 },
	{ x: 148, y: 160 },
	{ x: 206, y: 150 },
	{ x: 262, y: 168 },
	{ x: 318, y: 186 },
	{ x: 120, y: 236 },
	{ x: 186, y: 218 },
	{ x: 248, y: 228 },
	{ x: 302, y: 244 },
];

/** Seconds a fruit stays ripe and good, by when it budded. */
export function fruitRipe(at: number): number {
	return 1.3 - 0.6 * Math.min(1, at / FRUIT_SECONDS);
}

/** Seconds to the next bud, by when the last one came. */
export function fruitGap(at: number): number {
	return 0.52 - 0.2 * Math.min(1, at / 12);
}

export interface Fruit {
	id: number;
	spot: number;
	born: number;
	ripeAt: number;
	corruptAt: number;
	fallsAt: number;
	picked: { at: number; good: boolean } | null;
}

export type FruitLook = "bud" | "ripe" | "corrupt" | "fallen" | "picked";

export interface FruitState {
	t: number;
	fruits: Fruit[];
	nextAt: number;
	nextId: number;
	good: number;
	corrupt: number;
	/** Fruit that ripened during the round (what a perfect picker could have had). */
	ripened: number;
	seed: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type FruitEvent =
	| { type: "bud" }
	| { type: "ripe" }
	| { type: "pick"; good: boolean }
	| { type: "unripe" }
	| { type: "turn" }
	| { type: "fall" }
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

export function newFruit(seed: number): FruitState {
	return { t: 0, fruits: [], nextAt: 0.15, nextId: 0, good: 0, corrupt: 0, ripened: 0, seed: seed >>> 0 || 1, phase: "playing", endedAt: null };
}

export function fruitLook(fruit: Fruit, t: number): FruitLook {
	if (fruit.picked) return "picked";
	if (t < fruit.ripeAt) return "bud";
	if (t < fruit.corruptAt) return "ripe";
	if (t < fruit.fallsAt) return "corrupt";
	return "fallen";
}

/** The fruit a tap at (x, y) reaches: the nearest one hanging within reach. */
export function fruitAt(state: FruitState, x: number, y: number): Fruit | null {
	let best: Fruit | null = null;
	let bestDistance = FRUIT_REACH;
	for (const fruit of state.fruits) {
		const look = fruitLook(fruit, state.t);
		if (look === "picked" || look === "fallen") continue;
		const spot = FRUIT_SPOTS[fruit.spot];
		const distance = Math.hypot(spot.x - x, spot.y - y);
		if (distance <= bestDistance) {
			best = fruit;
			bestDistance = distance;
		}
	}
	return best;
}

export function stepFruit(state: FruitState, input: { tap: { x: number; y: number } | null }, events: FruitEvent[] = []): FruitState {
	if (state.phase !== "playing") return state;
	if (input.tap) {
		const fruit = fruitAt(state, input.tap.x, input.tap.y);
		if (fruit) {
			const look = fruitLook(fruit, state.t);
			if (look === "bud") events.push({ type: "unripe" });
			else {
				const good = look === "ripe";
				fruit.picked = { at: state.t, good };
				if (good) state.good += 1;
				else state.corrupt += 1;
				events.push({ type: "pick", good });
			}
		}
	}
	const before = state.t;
	state.t += FRUIT_STEP;
	if (state.t >= state.nextAt - 1e-9 && state.t < FRUIT_SECONDS - FRUIT_BUD - 0.3) {
		const next = random(state.seed + state.nextId * 31337);
		const taken = new Set(state.fruits.filter((fruit) => !fruit.picked && state.t < fruit.fallsAt).map((fruit) => fruit.spot));
		const free = FRUIT_SPOTS.map((_, index) => index).filter((index) => !taken.has(index));
		if (free.length) {
			const spot = free[Math.floor(next() * free.length)];
			const ripeAt = state.t + FRUIT_BUD;
			const corruptAt = ripeAt + fruitRipe(state.t) * (0.85 + next() * 0.3);
			state.fruits.push({ id: state.nextId, spot, born: state.t, ripeAt, corruptAt, fallsAt: corruptAt + FRUIT_HANG, picked: null });
			state.nextId += 1;
			events.push({ type: "bud" });
		}
		state.nextAt = state.t + fruitGap(state.t);
	}
	for (const fruit of state.fruits) {
		if (fruit.picked) continue;
		if (before < fruit.ripeAt && state.t >= fruit.ripeAt) {
			state.ripened += 1;
			events.push({ type: "ripe" });
		}
		if (before < fruit.corruptAt && state.t >= fruit.corruptAt) events.push({ type: "turn" });
		if (before < fruit.fallsAt && state.t >= fruit.fallsAt) events.push({ type: "fall" });
	}
	state.fruits = state.fruits.filter((fruit) => (fruit.picked ? state.t - fruit.picked.at < 1 : state.t - fruit.fallsAt < 1));
	if (state.corrupt > FRUIT_CORRUPT_LIMIT) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= FRUIT_SECONDS - 1e-9) {
		state.phase = state.good >= FRUIT_GOAL ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: state.phase === "won" ? "won" : "lost" });
	}
	return state;
}

/** The round's result once it has ended: the share of ripe fruit gathered, less the corrupt picked. */
export function fruitResult(state: FruitState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.max(0, Math.min(100, Math.round((100 * state.good) / Math.max(1, state.ripened) - 12 * state.corrupt))) : 0;
	return { won: state.phase === "won", score, count: state.good, seconds };
}
