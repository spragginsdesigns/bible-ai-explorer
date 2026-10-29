/**
 * Let Your Light Shine (LC-17851, docs/beta/games.md), Matthew 5:14-16: "Neither
 * do men light a candle, and put it under a bushel, but on a candlestick; and
 * it giveth light unto all that are in the house." Pure and seeded so the tests
 * play it; no imports (Node's type stripping loads it).
 *
 * Six candles burn in a house at night. Bushels drop over them, faster and
 * faster; a tap on a bushel lifts it off. A candle left under its bushel too
 * long goes out for good. A tap that lifts nothing is a miss, and every tenth
 * miss (LIGHT_MISS_LIMIT) puts out the lit candle nearest it, so tapping the
 * candlesticks blind does not keep the light. The house must still be lit at
 * the end: three candles out and it has gone dark.
 */

export const LIGHT_STEP = 1 / 60;
export const LIGHT_SECONDS = 15;
/** A round is only won by keeping the light to the end. */
export const LIGHT_MIN_SECONDS = LIGHT_SECONDS;
/** How long a bushel takes to fall onto its candle. */
export const LIGHT_FALL = 0.35;
/** How long a candle burns under a bushel, at the start and at the end of the round. */
export const LIGHT_SMOTHER_START = 1.4;
export const LIGHT_SMOTHER_END = 1.05;
/** Three candles out and the house is dark. */
export const LIGHT_OUT_LIMIT = 3;
/** How near (in stage units) a tap must land to a bushel to lift it. */
export const LIGHT_REACH = 42;
/** Every this many missed taps put out the lit candle nearest the last one. */
export const LIGHT_MISS_LIMIT = 10;

/** The candlesticks: where each stands on the shelf or the table, in the 400x400 picture. */
export const LIGHT_CANDLES: readonly { x: number; y: number }[] = [
	{ x: 72, y: 222 },
	{ x: 200, y: 222 },
	{ x: 328, y: 222 },
	{ x: 95, y: 338 },
	{ x: 200, y: 338 },
	{ x: 305, y: 338 },
];

export interface LightBushel {
	id: number;
	candle: number;
	/** When it began to fall, and when it lands. */
	born: number;
	lands: number;
	/** When the candle goes out if it is not lifted. */
	smothers: number;
}

export interface LightCandle {
	lit: boolean;
	/** When it went out, if it has. */
	outAt: number | null;
}

export interface LightState {
	t: number;
	candles: LightCandle[];
	bushels: LightBushel[];
	/** Bushels left lying over a candle that went out. */
	dead: LightBushel[];
	nextDrop: number;
	nextId: number;
	lifted: number;
	/** Taps that lifted no bushel. */
	misses: number;
	/** Sum of how far each lifted bushel had smothered its candle (0 to 1). */
	smotherSum: number;
	outs: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	seed: number;
	rng: number;
}

export type LightEvent =
	| { type: "drop"; candle: number }
	| { type: "lift"; candle: number; x: number; y: number }
	| { type: "miss"; x: number; y: number }
	| { type: "out"; candle: number }
	| { type: "won" }
	| { type: "dark" };

/** One step of the seeded generator, kept in the state so a round replays exactly. */
function nextRandom(state: { rng: number }) {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newLight(seed: number): LightState {
	const state: LightState = {
		t: 0,
		candles: LIGHT_CANDLES.map(() => ({ lit: true, outAt: null })),
		bushels: [],
		dead: [],
		nextDrop: 0,
		nextId: 1,
		lifted: 0,
		misses: 0,
		smotherSum: 0,
		outs: 0,
		phase: "playing",
		endedAt: null,
		seed,
		rng: seed >>> 0 || 1,
	};
	state.nextDrop = 0.45 + nextRandom(state) * 0.3;
	return state;
}

/** How far through the round, 0 to 1. */
function progress(t: number) {
	return Math.min(1, t / LIGHT_SECONDS);
}

/** Where a bushel is now: its centre, falling from above its candle. */
export function bushelAt(bushel: LightBushel, t: number) {
	const candle = LIGHT_CANDLES[bushel.candle];
	const fall = Math.min(1, Math.max(0, (t - bushel.born) / LIGHT_FALL));
	const eased = fall * fall;
	return { x: candle.x, y: candle.y - 30 - (1 - eased) * 150, landed: fall >= 1 };
}

/** How lit the house is, 0 to 1: the share of candles still burning and uncovered. */
export function lightLevel(state: LightState): number {
	let level = 0;
	for (let i = 0; i < state.candles.length; i++) {
		if (!state.candles[i].lit) continue;
		const bushel = state.bushels.find((item) => item.candle === i);
		if (!bushel) level += 1;
		else level += state.t < bushel.lands ? 1 : 0.35 * (1 - (state.t - bushel.lands) / Math.max(0.01, bushel.smothers - bushel.lands));
	}
	return level / state.candles.length;
}

/** A candle goes out for good; a bushel over it stays lying there. */
function putOut(state: LightState, candle: number, events: LightEvent[]) {
	const bushel = state.bushels.find((item) => item.candle === candle);
	if (bushel) {
		state.bushels = state.bushels.filter((item) => item !== bushel);
		state.dead.push(bushel);
	}
	state.candles[candle] = { lit: false, outAt: state.t };
	state.outs += 1;
	events.push({ type: "out", candle });
}

function drop(state: LightState, events: LightEvent[]) {
	const open: number[] = [];
	state.candles.forEach((candle, index) => {
		if (candle.lit && !state.bushels.some((bushel) => bushel.candle === index)) open.push(index);
	});
	if (!open.length) return;
	const candle = open[Math.floor(nextRandom(state) * open.length)];
	const smother = LIGHT_SMOTHER_START + (LIGHT_SMOTHER_END - LIGHT_SMOTHER_START) * progress(state.t);
	const lands = state.t + LIGHT_FALL;
	state.bushels.push({ id: state.nextId++, candle, born: state.t, lands, smothers: lands + smother });
	events.push({ type: "drop", candle });
}

export function stepLight(state: LightState, input: { taps: { x: number; y: number }[] }, events: LightEvent[] = []): LightState {
	if (state.phase !== "playing") return state;
	for (const tap of input.taps) {
		let best: LightBushel | null = null;
		let bestDistance = LIGHT_REACH;
		for (const bushel of state.bushels) {
			const at = bushelAt(bushel, state.t);
			const distance = Math.hypot(at.x - tap.x, at.y - tap.y);
			if (distance <= bestDistance) {
				best = bushel;
				bestDistance = distance;
			}
		}
		if (best) {
			const at = bushelAt(best, state.t);
			state.bushels = state.bushels.filter((bushel) => bushel !== best);
			state.lifted += 1;
			state.smotherSum += Math.max(0, (state.t - best.lands) / (best.smothers - best.lands));
			events.push({ type: "lift", candle: best.candle, x: at.x, y: at.y });
		} else {
			state.misses += 1;
			events.push({ type: "miss", x: tap.x, y: tap.y });
			if (state.misses % LIGHT_MISS_LIMIT === 0) {
				let nearest = -1;
				let nearestDistance = Infinity;
				state.candles.forEach((candle, index) => {
					const distance = Math.hypot(LIGHT_CANDLES[index].x - tap.x, LIGHT_CANDLES[index].y - tap.y);
					if (candle.lit && distance < nearestDistance) {
						nearest = index;
						nearestDistance = distance;
					}
				});
				if (nearest >= 0) putOut(state, nearest, events);
			}
		}
	}
	state.t += LIGHT_STEP;
	while (state.t >= state.nextDrop - 1e-9) {
		const p = progress(state.t);
		drop(state, events);
		// Later in the round a second bushel sometimes falls with the first.
		if (p > 0.35 && nextRandom(state) < 0.25 + 0.3 * p) drop(state, events);
		state.nextDrop += (0.9 + (0.34 - 0.9) * p) * (0.75 + nextRandom(state) * 0.5);
	}
	for (const bushel of [...state.bushels]) if (state.t >= bushel.smothers - 1e-9) putOut(state, bushel.candle, events);
	if (state.outs >= LIGHT_OUT_LIMIT) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "dark" });
	} else if (state.t >= LIGHT_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: every candle kept, lifted quickly, is a perfect score. */
export function lightResult(state: LightState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const slowness = state.lifted ? state.smotherSum / state.lifted : 0;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.outs * 18 - slowness * 22))) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.lifted), seconds };
}
