/**
 * Fishers of Men (LC-17851, docs/beta/games.md), Matthew 4:18-22: Peter and
 * Andrew cast a net into the sea of Galilee at dawn. Pure and seeded so the
 * tests play it; no imports (Node's type stripping loads it).
 *
 * Fish leap out of the sea in arcs and fall toward the brothers' net; the
 * net slides left and right along the front of the boat. Driftwood tossed up
 * by the swell and stones falling from the shore fall too, and catching one
 * tears the net (it narrows; the third tear breaks it). The leaps come faster
 * and closer together as the round goes on. Won: enough fish by the end of
 * the round with the net still whole.
 */

export const FISH_STEP = 1 / 60;
export const FISH_SECONDS = 15;
/** A round is played to the end, so it is never won sooner. */
export const FISH_MIN_SECONDS = FISH_SECONDS;
/** Fish to catch by the end of the round. */
export const FISH_TARGET = 18;
/** Fish that leap toward the net in a round; the rest of the drops are driftwood and stones. */
export const FISH_LEAPS = 23;
/** The height the net hangs at, in the 400-unit picture. */
export const FISH_NET_Y = 330;
/** Where the fish leap from: the sea's face in front of the boat. */
export const FISH_SEA_Y = 236;
export const FISH_NET_SPEED = 300;
/** Half the net's width when whole; each tear narrows it. */
export const FISH_NET_HALF = 44;
export const FISH_TEAR_SHRINK = 9;
export const FISH_TEARS_TO_BREAK = 3;
/** How near the net's edge an item may land and still be caught. */
export const FISH_ITEM_R = 9;
export const FISH_GRAVITY = 620;

export type FishKind = "fish" | "wood" | "stone";

export interface FishItem {
	id: number;
	kind: FishKind;
	born: number;
	x0: number;
	y0: number;
	vx: number;
	vy: number;
	/** When and where it comes down through the net's height. */
	landAt: number;
	landX: number;
	/** Set when it has come down: caught in the net, torn it, or fallen into the sea. */
	outcome: "caught" | "tore" | "missed" | null;
}

export interface FishState {
	t: number;
	netX: number;
	tears: number;
	caught: number;
	/** Fish that have come down so far (caught or not). */
	leapt: number;
	items: FishItem[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export interface FishInput {
	/** Held direction, -1 left, 1 right. */
	dir: number;
	/** A dragged position the net slides toward (wins over `dir`), or null. */
	target: number | null;
}

export type FishEvent = { type: "catch"; x: number } | { type: "tear"; x: number; tears: number } | { type: "splash"; x: number; kind: FishKind } | { type: "broken" } | { type: "won" } | { type: "lost" };

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

/** The net's half-width after `tears` tears. */
export function netHalf(tears: number): number {
	return FISH_NET_HALF - FISH_TEAR_SHRINK * Math.min(tears, FISH_TEARS_TO_BREAK - 1);
}

/** Where an item is at time `t`. */
export function itemAt(item: FishItem, t: number): { x: number; y: number } {
	const age = t - item.born;
	return { x: item.x0 + item.vx * age, y: item.y0 + item.vy * age + 0.5 * FISH_GRAVITY * age * age };
}

/** The gap between leaps at time `t`: from 0.62 s down to 0.3 s. */
function gapAt(t: number): number {
	return 0.62 - 0.32 * Math.min(1, t / 13);
}

export function newFish(seed: number): FishState {
	const next = random(seed);
	const items: FishItem[] = [];
	// When things come down: closer together as the round goes on.
	const lands: number[] = [];
	for (let land = 1.0 + next() * 0.2; land < FISH_SECONDS - 0.15; land += gapAt(land) * (0.75 + next() * 0.5)) lands.push(land);
	// Which of them are driftwood or stones: none in the first moments, then about three in ten.
	const late = lands.map((land, index) => (land > 1.8 ? index : -1)).filter((index) => index >= 0);
	const debrisCount = Math.min(late.length, Math.max(0, lands.length - FISH_LEAPS));
	const debrisAt = new Set<number>();
	while (debrisAt.size < debrisCount) debrisAt.add(late[Math.floor(next() * late.length)]);
	let lastFishX = 200;
	let lastFishAt = 0;
	let id = 0;
	for (let index = 0; index < lands.length; index++) {
		const land = lands[index];
		const progress = land / FISH_SECONDS;
		const kind: FishKind = debrisAt.has(index) ? (next() < 0.5 ? "wood" : "stone") : "fish";
	let landX = 200;
		for (let attempt = 0; attempt < 12; attempt++) {
			if (kind === "fish") {
				// Mostly within reach of the last fish; now and then anywhere.
				const reach = FISH_NET_SPEED * Math.max(0.15, land - lastFishAt) * 0.8 + 30;
				landX = next() < 0.18 ? 40 + next() * 320 : lastFishX + (next() * 2 - 1) * reach;
			} else landX = 36 + next() * 328;
			landX = Math.max(36, Math.min(364, landX));
			// Keep fish and debris apart when they come down close together.
			const clash = items.some((item) => (item.kind === "fish") !== (kind === "fish") && Math.abs(item.landAt - land) < 0.4 && Math.abs(item.landX - landX) < 2 * FISH_NET_HALF + 4);
			if (!clash) break;
		}
		// Fish and driftwood leap from the sea; stones fall from the shore above.
		const flight = (kind === "stone" ? 1.05 : 1.25) - 0.3 * progress;
		const y0 = kind === "stone" ? -16 : FISH_SEA_Y;
		const x0 = kind === "stone" ? landX + (next() * 2 - 1) * 20 : Math.max(30, Math.min(370, landX + (next() * 2 - 1) * 150));
		const vx = (landX - x0) / flight;
		const vy = (FISH_NET_Y - y0 - 0.5 * FISH_GRAVITY * flight * flight) / flight;
		items.push({ id: id++, kind, born: land - flight, x0, y0, vx, vy, landAt: land, landX, outcome: null });
		if (kind === "fish") {
			lastFishX = landX;
			lastFishAt = land;
		}
	}
	items.sort((a, b) => a.born - b.born);
	return { t: 0, netX: 200, tears: 0, caught: 0, leapt: 0, items, phase: "playing", endedAt: null };
}

/** Items in the air now (born and not yet come down, or falling into the sea for a moment after). */
export function airborne(state: FishState): FishItem[] {
	return state.items.filter((item) => item.born <= state.t && (item.outcome === null || item.outcome === "missed") && state.t < item.landAt + 0.4);
}

export function stepFish(state: FishState, input: FishInput, events: FishEvent[] = []): FishState {
	if (state.phase !== "playing") return state;
	const dt = FISH_STEP;
	const half = netHalf(state.tears);
	const move = FISH_NET_SPEED * dt;
	if (input.target !== null && Number.isFinite(input.target)) {
		const gap = input.target - state.netX;
		state.netX += Math.max(-move, Math.min(move, gap));
	} else if (input.dir) state.netX += Math.sign(input.dir) * move;
	state.netX = Math.max(half, Math.min(400 - half, state.netX));
	state.t += dt;
	for (const item of state.items) {
		if (item.outcome !== null || item.landAt > state.t + 1e-9) continue;
		if (item.kind === "fish") state.leapt += 1;
		const inNet = Math.abs(item.landX - state.netX) <= half + FISH_ITEM_R;
		if (!inNet) {
			item.outcome = "missed";
			events.push({ type: "splash", x: item.landX, kind: item.kind });
		} else if (item.kind === "fish") {
			item.outcome = "caught";
			state.caught += 1;
			events.push({ type: "catch", x: item.landX });
		} else {
			item.outcome = "tore";
			state.tears += 1;
			events.push({ type: "tear", x: item.landX, tears: state.tears });
		}
	}
	if (state.tears >= FISH_TEARS_TO_BREAK) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "broken" });
	} else if (state.t >= FISH_SECONDS - 1e-9) {
		state.phase = state.caught >= FISH_TARGET ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: state.phase === "won" ? "won" : "lost" });
	}
	return state;
}

/** The round's result once it has ended: the share of the leaping fish caught, less a little for each tear. */
export function fishResult(state: FishState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const share = state.caught / Math.max(1, state.leapt);
	const score = Math.round(Math.max(0, Math.min(100, share * 112 - state.tears * 12)));
	return { won: state.phase === "won", score, count: state.caught, seconds };
}
