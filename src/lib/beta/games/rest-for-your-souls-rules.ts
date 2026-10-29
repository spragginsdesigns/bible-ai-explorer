/**
 * Rest for Your Souls (LC-17851, docs/beta/games.md), Matthew 11:28-30: "Come
 * unto me, all ye that labour and are heavy laden, and I will give you rest."
 * Pure and seeded so the tests play it; no imports (Node's type stripping
 * loads it).
 *
 * Weary travellers walk a road, two on each of four paths at different distances. Burdens
 * drop onto their backs and grow heavier; a traveller under a full burden
 * falls. A tap on a burden lifts it away. Three falls and the round is lost;
 * keep them walking to the end and it is won.
 */

export const REST_STEP = 1 / 60;
export const REST_SECONDS = 15;
/** A round is only won by keeping the travellers up to the end. */
export const REST_MIN_SECONDS = REST_SECONDS;
/** Three travellers fallen and the round is lost. */
export const REST_FALL_LIMIT = 3;
/** How near (in stage units) a tap must land to a burden to lift it. */
export const REST_REACH = 34;
/** Seconds a burden takes to grow from nothing to too heavy, at the start and at the end. */
export const REST_GROW_START = 2;
export const REST_GROW_END = 1.3;
/** Seconds a burden takes to land on a traveller's back. */
export const REST_DROP = 0.25;
/** A burden at this weight or more glows red. */
export const REST_HEAVY = 0.65;
/** How far (radians) a traveller stoops forward under a full burden. */
export const REST_LEAN = 0.5;
/** How long a fallen traveller lies on the road before another comes. */
export const REST_LIE = 1.3;

/** The four paths across the road: the feet's y and the figure's scale (nearer is bigger). */
export const REST_LANES: readonly { y: number; scale: number }[] = [
	{ y: 218, scale: 0.86 },
	{ y: 264, scale: 0.98 },
	{ y: 316, scale: 1.12 },
	{ y: 376, scale: 1.28 },
];

export interface RestBurden {
	born: number;
	/** 0 (just landed) to 1 (he falls). */
	weight: number;
	/** Weight gained per second. */
	grow: number;
}

export interface RestTraveller {
	id: number;
	lane: number;
	x: number;
	speed: number;
	burden: RestBurden | null;
	/** When he fell, if he has. */
	fellAt: number | null;
	/** When he can enter the road (after the one before him fell). */
	enters: number;
	/** A look of his own: robe and head-cloth colours by index. */
	look: number;
}

export interface RestState {
	t: number;
	travellers: RestTraveller[];
	nextBurden: number;
	nextId: number;
	lifted: number;
	/** Sum of the weights the lifted burdens had grown to. */
	weightSum: number;
	falls: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	rng: number;
}

export type RestEvent =
	| { type: "burden"; lane: number }
	| { type: "lift"; lane: number; x: number; y: number; weight: number }
	| { type: "miss"; x: number; y: number }
	| { type: "fall"; lane: number; x: number }
	| { type: "won" }
	| { type: "lost" };

/** One step of the seeded generator, kept in the state so a round replays exactly. */
function nextRandom(state: { rng: number }) {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function traveller(state: RestState, lane: number, x: number, enters: number): RestTraveller {
	return { id: state.nextId++, lane, x, speed: 20 + nextRandom(state) * 9, burden: null, fellAt: null, enters, look: Math.floor(nextRandom(state) * 6) };
}

export function newRest(seed: number): RestState {
	const state: RestState = { t: 0, travellers: [], nextBurden: 0, nextId: 1, lifted: 0, weightSum: 0, falls: 0, phase: "playing", endedAt: null, rng: seed >>> 0 || 1 };
	// Two travellers on each path, about half the road apart.
	const starts = [10, 120, 230, 65].map((x) => x + nextRandom(state) * 40 - 20);
	for (let lane = 0; lane < REST_LANES.length; lane++) {
		state.travellers.push(traveller(state, lane, starts[lane], 0));
		state.travellers.push(traveller(state, lane, starts[lane] + 200 + nextRandom(state) * 30, 0));
	}
	state.nextBurden = 0.4 + nextRandom(state) * 0.3;
	return state;
}

function progress(t: number) {
	return Math.min(1, t / REST_SECONDS);
}

/** Where a traveller's burden sits (its centre), dropping onto his back for its first moment. */
export function burdenAt(state: RestState, walker: RestTraveller) {
	const lane = REST_LANES[walker.lane];
	const lean = (walker.burden?.weight ?? 0) * REST_LEAN;
	const drop = walker.burden ? Math.max(0, 1 - (state.t - walker.burden.born) / REST_DROP) : 0;
	// On his back, (-10, -30) from the hips, turned with his stoop.
	const bx = -10 * lane.scale;
	const by = -30 * lane.scale;
	return {
		x: walker.x + bx * Math.cos(lean) - by * Math.sin(lean),
		y: lane.y - 20 * lane.scale + bx * Math.sin(lean) + by * Math.cos(lean) - drop * drop * 90,
	};
}

function onRoad(state: RestState, walker: RestTraveller) {
	return walker.fellAt === null && state.t >= walker.enters;
}

function addBurden(state: RestState, events: RestEvent[]) {
	const free = state.travellers.filter((walker) => onRoad(state, walker) && !walker.burden && walker.x > 18 && walker.x < 330);
	if (!free.length) return;
	const walker = free[Math.floor(nextRandom(state) * free.length)];
	const grow = REST_GROW_START + (REST_GROW_END - REST_GROW_START) * progress(state.t);
	walker.burden = { born: state.t, weight: 0, grow: 1 / (grow * (0.85 + nextRandom(state) * 0.3)) };
	events.push({ type: "burden", lane: walker.lane });
}

export function stepRest(state: RestState, input: { taps: { x: number; y: number }[] }, events: RestEvent[] = []): RestState {
	if (state.phase !== "playing") return state;
	const dt = REST_STEP;
	for (const tap of input.taps) {
		let best: RestTraveller | null = null;
		let bestDistance = REST_REACH;
		for (const walker of state.travellers) {
			if (!walker.burden || !onRoad(state, walker)) continue;
			const at = burdenAt(state, walker);
			const distance = Math.hypot(at.x - tap.x, at.y - tap.y);
			if (distance <= bestDistance) {
				best = walker;
				bestDistance = distance;
			}
		}
		if (best?.burden) {
			const at = burdenAt(state, best);
			state.lifted += 1;
			state.weightSum += best.burden.weight;
			events.push({ type: "lift", lane: best.lane, x: at.x, y: at.y, weight: best.burden.weight });
			best.burden = null;
		} else events.push({ type: "miss", x: tap.x, y: tap.y });
	}
	state.t += dt;
	while (state.t >= state.nextBurden - 1e-9) {
		const p = progress(state.t);
		addBurden(state, events);
		if (p > 0.4 && nextRandom(state) < 0.2 + 0.3 * p) addBurden(state, events);
		state.nextBurden += (0.8 + (0.4 - 0.8) * p) * (0.75 + nextRandom(state) * 0.5);
	}
	for (const walker of [...state.travellers]) {
		if (walker.fellAt !== null) {
			if (state.t - walker.fellAt >= REST_LIE) {
				state.travellers = state.travellers.filter((item) => item !== walker);
				state.travellers.push(traveller(state, walker.lane, -30, state.t + 0.3));
			}
			continue;
		}
		if (state.t < walker.enters) continue;
		const weight = walker.burden?.weight ?? 0;
		walker.x += walker.speed * (1 - 0.65 * weight) * dt;
		if (walker.burden) {
			walker.burden.weight = Math.min(1, walker.burden.weight + walker.burden.grow * dt);
			if (walker.burden.weight >= 1 - 1e-9) {
				walker.fellAt = state.t;
				walker.burden = null;
				state.falls += 1;
				events.push({ type: "fall", lane: walker.lane, x: walker.x });
				continue;
			}
		}
		if (walker.x > 430) {
			state.travellers = state.travellers.filter((item) => item !== walker);
			state.travellers.push(traveller(state, walker.lane, -30, state.t));
		}
	}
	if (state.falls >= REST_FALL_LIMIT) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= REST_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: no falls and light burdens lifted early score best. */
export function restResult(state: RestState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const heaviness = state.lifted ? state.weightSum / state.lifted : 0;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 104 - state.falls * 22 - heaviness * 30))) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.lifted), seconds };
}
