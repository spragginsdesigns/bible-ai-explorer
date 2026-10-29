/**
 * Seven Baskets Full (LC-17851, docs/beta/games.md), Matthew 15:32-38: the
 * seven loaves and a few little fishes, and the broken meat that was left,
 * seven baskets full. Pure and seeded so the tests play it; no imports
 * (Node's type stripping loads it).
 *
 * The disciples stand along the hillside at sunset and broken bread and
 * little fishes tumble from their hands; the basket slides left and right
 * beneath them. Every few fragments fill a basket, which is set down, and
 * the next one comes. The fragments come quicker as the round goes on, and
 * the ones that fall to the grass are lost, so a missed one makes the seventh
 * basket later. Won: all seven baskets full before the round ends; it ends as
 * soon as they are.
 */

export const BASKETS_STEP = 1 / 60;
export const BASKETS_SECONDS = 15;
export const BASKETS_COUNT = 7;
/** Fragments that fill one basket. */
export const BASKETS_PER = 3;
export const BASKETS_NEEDED = BASKETS_COUNT * BASKETS_PER;
/** The basket's mouth, where fragments are caught, in the 400-unit picture. */
export const BASKETS_Y = 332;
export const BASKETS_SPEED = 280;
export const BASKETS_HALF = 28;
export const BASKETS_ITEM_R = 7;
export const BASKETS_GRAVITY = 520;
/** Where the disciples stand on the hillside, and the height of their hands. */
export const BASKETS_DISCIPLES = [52, 124, 200, 276, 348] as const;
export const BASKETS_HANDS_Y = 104;
/** The first fragment comes down no sooner than this, and they never come closer together than GAP_FLOOR of the round's pace. */
const FIRST_LAND = 1.0;
const GAP_FLOOR = 0.8;

/** The pace of fragments at time `t`: one every 0.6 s at first, every 0.3 s by the end. */
function gapAt(t: number): number {
	return 0.6 - 0.3 * Math.min(1, t / 12);
}

/**
 * The fastest the round can be won: the needed-th fragment coming down as
 * soon as the pace allows and every one of them caught. A reported time is
 * rounded to tenths, so this is floored to the tenth below.
 */
export const BASKETS_MIN_SECONDS = (() => {
	let land = FIRST_LAND;
	for (let caught = 1; caught < BASKETS_NEEDED; caught++) land += gapAt(land) * GAP_FLOOR;
	return Math.floor((land - 0.05) * 10) / 10;
})();

export type FragmentKind = "bread" | "fish";

export interface Fragment {
	id: number;
	kind: FragmentKind;
	/** Which disciple let it fall. */
	from: number;
	born: number;
	x0: number;
	y0: number;
	vx: number;
	vy: number;
	landAt: number;
	landX: number;
	outcome: "gathered" | "lost" | null;
}

export interface BasketsState {
	t: number;
	basketX: number;
	/** Fragments in the basket being filled, and baskets already full. */
	inBasket: number;
	full: number;
	gathered: number;
	lost: number;
	fragments: Fragment[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export interface BasketsInput {
	dir: number;
	target: number | null;
}

export type BasketsEvent = { type: "gather"; x: number; kind: FragmentKind } | { type: "full"; full: number } | { type: "lost"; x: number } | { type: "won" } | { type: "timeup" };

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

export function fragmentAt(fragment: Fragment, t: number): { x: number; y: number } {
	const age = t - fragment.born;
	return { x: fragment.x0 + fragment.vx * age, y: fragment.y0 + fragment.vy * age + 0.5 * BASKETS_GRAVITY * age * age };
}

export function newBaskets(seed: number): BasketsState {
	const next = random(seed);
	const fragments: Fragment[] = [];
	let land = FIRST_LAND + next() * 0.2;
	let lastX = 200;
	for (let id = 0; land < BASKETS_SECONDS - 0.1; id++) {
		const progress = land / BASKETS_SECONDS;
		// A disciple near the last one most of the time, sometimes across the hill.
		const near = BASKETS_DISCIPLES.map((_, index) => index).filter((index) => Math.abs(BASKETS_DISCIPLES[index] - lastX) <= 160);
		const from = next() < 0.75 ? near[Math.floor(next() * near.length)] : Math.floor(next() * BASKETS_DISCIPLES.length);
		const x0 = BASKETS_DISCIPLES[from] + (next() * 2 - 1) * 8;
		const landX = Math.max(30, Math.min(370, x0 + (next() * 2 - 1) * 70));
		const kind: FragmentKind = next() < 0.35 ? "fish" : "bread";
		const flight = (kind === "fish" ? 1.1 : 1.25) - 0.3 * progress;
		const vy = (BASKETS_Y - BASKETS_HANDS_Y - 0.5 * BASKETS_GRAVITY * flight * flight) / flight;
		fragments.push({ id, kind, from, born: land - flight, x0, y0: BASKETS_HANDS_Y, vx: (landX - x0) / flight, vy, landAt: land, landX, outcome: null });
		lastX = landX;
		land += gapAt(land) * (GAP_FLOOR + next() * 0.45);
	}
	fragments.sort((a, b) => a.born - b.born);
	return { t: 0, basketX: 200, inBasket: 0, full: 0, gathered: 0, lost: 0, fragments, phase: "playing", endedAt: null };
}

/** Fragments in the air now, and lost ones for a moment as they fall to the grass. */
export function tumbling(state: BasketsState): Fragment[] {
	return state.fragments.filter((fragment) => fragment.born <= state.t && fragment.outcome !== "gathered" && state.t < fragment.landAt + 0.35);
}

export function stepBaskets(state: BasketsState, input: BasketsInput, events: BasketsEvent[] = []): BasketsState {
	if (state.phase !== "playing") return state;
	const move = BASKETS_SPEED * BASKETS_STEP;
	if (input.target !== null && Number.isFinite(input.target)) state.basketX += Math.max(-move, Math.min(move, input.target - state.basketX));
	else if (input.dir) state.basketX += Math.sign(input.dir) * move;
	state.basketX = Math.max(BASKETS_HALF, Math.min(400 - BASKETS_HALF, state.basketX));
	state.t += BASKETS_STEP;
	for (const fragment of state.fragments) {
		if (fragment.outcome !== null || fragment.landAt > state.t + 1e-9 || state.phase !== "playing") continue;
		if (Math.abs(fragment.landX - state.basketX) > BASKETS_HALF + BASKETS_ITEM_R) {
			fragment.outcome = "lost";
			state.lost += 1;
			events.push({ type: "lost", x: fragment.landX });
			continue;
		}
		fragment.outcome = "gathered";
		state.gathered += 1;
		state.inBasket += 1;
		events.push({ type: "gather", x: fragment.landX, kind: fragment.kind });
		if (state.inBasket >= BASKETS_PER) {
			state.inBasket = 0;
			state.full += 1;
			events.push({ type: "full", full: state.full });
			if (state.full >= BASKETS_COUNT) {
				state.phase = "won";
				state.endedAt = state.t;
				events.push({ type: "won" });
			}
		}
	}
	if (state.phase === "playing" && state.t >= BASKETS_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "timeup" });
	}
	return state;
}

/** The round's result once it has ended: the share of the fragments that came down that were gathered. */
export function basketsResult(state: BasketsState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const share = state.gathered / Math.max(1, state.gathered + state.lost);
	const score = Math.round(Math.max(0, Math.min(100, ((share - 0.45) / 0.45) * 100)));
	return { won: state.phase === "won", score, count: state.gathered, seconds };
}
