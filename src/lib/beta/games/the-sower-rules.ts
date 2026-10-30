/**
 * The Sower (LC-17908, docs/beta/games.md), Matthew 13:3-9: "Behold, a sower
 * went forth to sow." A top-down field laid out from the seed as a patchwork:
 * the way side (a trodden path where the fowls wait), stony places, thorns,
 * and good ground in irregular plots. The sower's hand moves over the field
 * and, while it sows, scatters seed on the ground under it. Pure and seeded
 * so the tests play it; no imports (Node's type stripping loads it).
 *
 * Coverage painting: every step of sowing spends one step of the seed bag and
 * drops seed on the cells under the hand. Good ground that has taken enough
 * seed is sown and springs up; seed on the way side, the stones or the thorns
 * is wasted (the fowls devour it, it withers, it is choked). The round ends
 * when the bag runs dry or the time is up; it is won when enough of the good
 * ground is sown. The score is how much was sown, and how little wasted.
 */

export const SOWER_STEP = 1 / 60;
export const SOWER_SECONDS = 15;
/** The seed bag holds this many seconds of sowing. */
export const SOWER_BAG_SECONDS = 7;
export const SOWER_BAG = Math.round(SOWER_BAG_SECONDS * 60);
/**
 * A round ends only when the bag runs dry or the time is up, and the bag only
 * drains while the hand sows, one step at a time: so the fastest a round can
 * end (and be won) is sowing without a pause until the bag is empty.
 */
export const SOWER_MIN_SECONDS = SOWER_BAG_SECONDS;

/** The field: COLS x ROWS cells of CELL units, from FIELD_TOP down to FIELD_BOTTOM of the 400 picture. */
export const SOWER_CELL = 10;
export const SOWER_COLS = 40;
export const SOWER_ROWS = 32;
export const SOWER_FIELD_TOP = 44;
export const SOWER_FIELD_BOTTOM = SOWER_FIELD_TOP + SOWER_ROWS * SOWER_CELL;
/** Seed falls on the cells within this many cells of the hand's cell (a disc of 13 cells). */
export const SOWER_SPRAY = 2;
/** Seed each cell under the hand takes a step; good ground is sown at 1. */
export const SOWER_SEED = 0.25;
/** Seed on bad ground meets its fate (devoured, withered, choked) once it holds this much. */
export const SOWER_FATE = 0.4;
/** The hand's speed on the arrows, and its fastest following a finger or the mouse (units a second). */
export const SOWER_KEY_SPEED = 180;
export const SOWER_POINTER_SPEED = 240;
/**
 * A finger or the mouse put down away from the hand sends it there with the
 * seed held: it sows only once it has come within this many units of the
 * point, and from then on until the finger lifts. So lifting the finger over
 * bad ground and putting it down on the next plot wastes nothing on the way.
 */
export const SOWER_CATCH = 14;
/** Winning: at least this share of the good ground sown when the round ends. */
export const SOWER_WIN_SHARE = 0.6;
/** Sowing this share of the good ground earns the whole of the score's share part. */
export const SOWER_FULL_SHARE = 0.9;
/** Waste at this share of the seed spent (or more) earns nothing for a clean hand. */
export const SOWER_WASTE_REF = 0.45;
/** Good ground in a field, in cells: kept in this range so every field is fair and the count fits 0-500. */
export const SOWER_GOOD_MIN = 340;
export const SOWER_GOOD_MAX = 460;

export type SowerGround = "wayside" | "stony" | "thorns" | "good";
export const SOWER_GROUND_CODE: Record<SowerGround, string> = { wayside: "w", stony: "s", thorns: "t", good: "g" };

export interface SowerInput {
	/** Arrow keys: -1, 0 or 1 on each axis. */
	dx: number;
	dy: number;
	/** A finger or the mouse: where the hand is heading (wins over the arrows); null once it lifts. */
	target: { x: number; y: number } | null;
	/** Space held, or a finger or the mouse button down. */
	sow: boolean;
}

export interface SowerState {
	t: number;
	/** The field's cells, row by row. */
	ground: SowerGround[];
	/** Seed fallen on each cell. */
	seed: number[];
	/** When each cell of good ground was sown (-1 not yet), and when the seed on bad ground met its fate. */
	sownAt: number[];
	fateAt: number[];
	goodTotal: number;
	sownCount: number;
	hand: { x: number; y: number };
	/** The hand has reached the finger (or the mouse) since it was put down: it may sow. */
	caught: boolean;
	sowing: boolean;
	/** Steps of sowing left in the bag. */
	bag: number;
	/** Steps of seed spent, and how much of it fell on bad ground. */
	used: number;
	wasted: number;
	/** Where the fowls wait on the way side (picture units). */
	fowls: { x: number; y: number }[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type SowerEvent =
	| { type: "sown"; cell: number; x: number; y: number }
	| { type: "fate"; cell: number; ground: Exclude<SowerGround, "good">; x: number; y: number }
	| { type: "low" }
	| { type: "end"; won: boolean };

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

/** The cells the seed falls on, relative to the hand's cell. */
export const SOWER_STENCIL: [number, number][] = [];
for (let dy = -SOWER_SPRAY; dy <= SOWER_SPRAY; dy++) {
	for (let dx = -SOWER_SPRAY; dx <= SOWER_SPRAY; dx++) if (dx * dx + dy * dy <= SOWER_SPRAY * SOWER_SPRAY + 0.5) SOWER_STENCIL.push([dx, dy]);
}

/** The hand keeps the whole spray on the field. */
const HAND_MIN_X = SOWER_SPRAY * SOWER_CELL;
const HAND_MAX_X = (SOWER_COLS - SOWER_SPRAY) * SOWER_CELL - 0.01;
const HAND_MIN_Y = SOWER_FIELD_TOP + SOWER_SPRAY * SOWER_CELL;
const HAND_MAX_Y = SOWER_FIELD_TOP + (SOWER_ROWS - SOWER_SPRAY) * SOWER_CELL - 0.01;

export function sowerCellOf(x: number, y: number): { col: number; row: number } {
	return { col: Math.floor(x / SOWER_CELL), row: Math.floor((y - SOWER_FIELD_TOP) / SOWER_CELL) };
}

/** The centre of a cell in picture units. */
export function sowerCellCentre(cell: number): { x: number; y: number } {
	const col = cell % SOWER_COLS;
	const row = Math.floor(cell / SOWER_COLS);
	return { x: (col + 0.5) * SOWER_CELL, y: SOWER_FIELD_TOP + (row + 0.5) * SOWER_CELL };
}

/** The cells under the hand at (x, y), on the field. */
export function sowerSprayCells(x: number, y: number): number[] {
	const { col, row } = sowerCellOf(x, y);
	const cells: number[] = [];
	for (const [dx, dy] of SOWER_STENCIL) {
		const c = col + dx;
		const r = row + dy;
		if (c >= 0 && c < SOWER_COLS && r >= 0 && r < SOWER_ROWS) cells.push(r * SOWER_COLS + c);
	}
	return cells;
}

/** A smooth seeded wobble (value noise), so the plots' edges are irregular. */
function noiseField(next: () => number) {
	const size = 12;
	const grid = Array.from({ length: (size + 1) * (size + 1) }, () => next());
	return (x: number, y: number) => {
		const gx = (x / SOWER_COLS) * (size - 1);
		const gy = (y / SOWER_ROWS) * (size - 1);
		const ix = Math.floor(gx);
		const iy = Math.floor(gy);
		const fx = gx - ix;
		const fy = gy - iy;
		const sx = fx * fx * (3 - 2 * fx);
		const sy = fy * fy * (3 - 2 * fy);
		const at = (i: number, j: number) => grid[j * (size + 1) + i];
		const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
		const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
		return top + (bottom - top) * sy;
	};
}

/** The patchwork: a jittered grid of plots, so many of them good ground, their edges wobbled this many cells. */
const SITES_ACROSS = 6;
const SITES_DOWN = 5;
const GOOD_PLOTS = 11;
const WOBBLE = 4;

function layField(next: () => number): SowerGround[] {
	// Plots: each cell goes to its nearest site (a patchwork), the edges wobbled.
	const sites: { x: number; y: number; kind: SowerGround }[] = [];
	for (let j = 0; j < SITES_DOWN; j++) {
		for (let i = 0; i < SITES_ACROSS; i++) {
			sites.push({ x: ((i + 0.2 + next() * 0.6) / SITES_ACROSS) * SOWER_COLS, y: ((j + 0.2 + next() * 0.6) / SITES_DOWN) * SOWER_ROWS, kind: "stony" });
		}
	}
	// Good plots apart from one another where they can be, the rest stones and thorns.
	const order = sites.map((_, index) => index);
	for (let i = order.length - 1; i > 0; i--) {
		const k = Math.floor(next() * (i + 1));
		[order[i], order[k]] = [order[k], order[i]];
	}
	let plots = 0;
	for (const index of order) {
		if (plots >= GOOD_PLOTS) break;
		const i = index % SITES_ACROSS;
		const j = Math.floor(index / SITES_ACROSS);
		const touching = [
			[i - 1, j],
			[i + 1, j],
			[i, j - 1],
			[i, j + 1],
		].some(([a, b]) => a >= 0 && b >= 0 && a < SITES_ACROSS && b < SITES_DOWN && sites[b * SITES_ACROSS + a].kind === "good");
		if (touching) continue;
		sites[index].kind = "good";
		plots++;
	}
	for (const site of sites) if (site.kind !== "good") site.kind = next() < 0.5 ? "stony" : "thorns";
	const wobbleX = noiseField(next);
	const wobbleY = noiseField(next);
	const ground: SowerGround[] = [];
	for (let r = 0; r < SOWER_ROWS; r++) {
		for (let c = 0; c < SOWER_COLS; c++) {
			const x = c + 0.5 + (wobbleX(c, r) - 0.5) * WOBBLE;
			const y = r + 0.5 + (wobbleY(c, r) - 0.5) * WOBBLE;
			let best = 0;
			let bestDistance = Infinity;
			sites.forEach((site, index) => {
				const d = (site.x - x) ** 2 + (site.y - y) ** 2;
				if (d < bestDistance) {
					bestDistance = d;
					best = index;
				}
			});
			ground.push(sites[best].kind);
		}
	}
	// The way side: a trodden path winding across the field, three cells wide.
	const base = SOWER_ROWS * (0.3 + next() * 0.4);
	const sway = 3 + next() * 4;
	const turn = 0.08 + next() * 0.08;
	const phase = next() * Math.PI * 2;
	for (let c = 0; c < SOWER_COLS; c++) {
		const centre = base + Math.sin(c * turn + phase) * sway;
		for (let r = 0; r < SOWER_ROWS; r++) if (Math.abs(r + 0.5 - centre) <= 1.6) ground[r * SOWER_COLS + c] = "wayside";
	}
	return ground;
}

export function newSower(seed: number): SowerState {
	const next = random(seed);
	let ground = layField(next);
	let good = ground.filter((kind) => kind === "good").length;
	for (let tries = 0; tries < 40 && (good < SOWER_GOOD_MIN || good > SOWER_GOOD_MAX); tries++) {
		ground = layField(next);
		good = ground.filter((kind) => kind === "good").length;
	}
	// A last resort that never trips on the seeds tried: trim or grow the good ground to the range.
	for (let i = 0; good > SOWER_GOOD_MAX && i < ground.length; i++) {
		if (ground[i] === "good") {
			ground[i] = "stony";
			good--;
		}
	}
	for (let i = ground.length - 1; good < SOWER_GOOD_MIN && i >= 0; i--) {
		if (ground[i] === "stony" || ground[i] === "thorns") {
			ground[i] = "good";
			good++;
		}
	}
	const fowls: { x: number; y: number }[] = [];
	const path = ground.map((kind, index) => (kind === "wayside" ? index : -1)).filter((index) => index >= 0);
	for (let i = 0; i < 5 && path.length; i++) {
		const cell = path[Math.floor(((i + next() * 0.6 + 0.2) / 5) * path.length)];
		fowls.push(sowerCellCentre(cell));
	}
	return {
		t: 0,
		ground,
		seed: ground.map(() => 0),
		sownAt: ground.map(() => -1),
		fateAt: ground.map(() => -1),
		goodTotal: good,
		sownCount: 0,
		hand: { x: 200, y: SOWER_FIELD_BOTTOM - 30 },
		caught: false,
		sowing: false,
		bag: SOWER_BAG,
		used: 0,
		wasted: 0,
		fowls,
		phase: "playing",
		endedAt: null,
	};
}

export function stepSower(state: SowerState, input: SowerInput, events: SowerEvent[] = []): SowerState {
	if (state.phase !== "playing") return state;
	const hand = state.hand;
	if (input.target) {
		const gx = input.target.x - hand.x;
		const gy = input.target.y - hand.y;
		const distance = Math.hypot(gx, gy);
		const reach = SOWER_POINTER_SPEED * SOWER_STEP;
		if (distance > 0) {
			const k = Math.min(1, reach / distance);
			hand.x += gx * k;
			hand.y += gy * k;
		}
	} else if (input.dx || input.dy) {
		const length = Math.hypot(input.dx, input.dy);
		hand.x += (input.dx / length) * SOWER_KEY_SPEED * SOWER_STEP;
		hand.y += (input.dy / length) * SOWER_KEY_SPEED * SOWER_STEP;
	}
	hand.x = Math.max(HAND_MIN_X, Math.min(HAND_MAX_X, hand.x));
	hand.y = Math.max(HAND_MIN_Y, Math.min(HAND_MAX_Y, hand.y));
	if (!input.target) state.caught = false;
	else if (!state.caught) {
		// The point may lie past the hand's reach at the field's edge: caught once the hand can go no nearer.
		const tx = Math.max(HAND_MIN_X, Math.min(HAND_MAX_X, input.target.x));
		const ty = Math.max(HAND_MIN_Y, Math.min(HAND_MAX_Y, input.target.y));
		state.caught = Math.hypot(tx - hand.x, ty - hand.y) <= SOWER_CATCH;
	}

	state.sowing = input.sow && state.bag > 0 && (!input.target || state.caught);
	if (state.sowing) {
		const before = state.bag;
		state.bag--;
		state.used++;
		const cells = sowerSprayCells(hand.x, hand.y);
		let bad = 0;
		for (const cell of cells) {
			const kind = state.ground[cell];
			state.seed[cell] += SOWER_SEED;
			if (kind === "good") {
				if (state.sownAt[cell] < 0 && state.seed[cell] >= 1 - 1e-9) {
					state.sownAt[cell] = state.t;
					state.sownCount++;
					events.push({ type: "sown", cell, ...sowerCellCentre(cell) });
				}
			} else {
				bad++;
				if (state.fateAt[cell] < 0 && state.seed[cell] >= SOWER_FATE - 1e-9) {
					state.fateAt[cell] = state.t;
					events.push({ type: "fate", cell, ground: kind, ...sowerCellCentre(cell) });
				}
			}
		}
		state.wasted += bad / cells.length;
		if (before > SOWER_BAG / 4 && state.bag <= SOWER_BAG / 4) events.push({ type: "low" });
	}
	state.t += SOWER_STEP;
	if (state.bag <= 0 || state.t >= SOWER_SECONDS - 1e-9) {
		state.phase = sowerShare(state) >= SOWER_WIN_SHARE ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: "end", won: state.phase === "won" });
	}
	return state;
}

/** The share of the good ground sown so far, 0-1. */
export function sowerShare(state: SowerState): number {
	return state.goodTotal ? state.sownCount / state.goodTotal : 0;
}

/** The share of the seed spent so far that fell on bad ground, 0-1. */
export function sowerWaste(state: SowerState): number {
	return state.used ? state.wasted / state.used : 0;
}

/**
 * 0-100: a bare win (the share just reached, much seed wasted) is a little
 * over 15; sowing the good ground nearly whole with a clean hand reaches 100.
 * A loss scores under 40, by the share sown.
 */
export function sowerScore(state: SowerState): number {
	const share = sowerShare(state);
	const clean = Math.max(0, Math.min(1, 1 - sowerWaste(state) / SOWER_WASTE_REF));
	if (share < SOWER_WIN_SHARE) return Math.round((39 * share) / SOWER_WIN_SHARE);
	const cover = Math.max(0, Math.min(1, (share - SOWER_WIN_SHARE) / (SOWER_FULL_SHARE - SOWER_WIN_SHARE)));
	return Math.max(0, Math.min(100, Math.round(15 + 60 * cover + 25 * clean)));
}

/** The round's result once it has ended. */
export function sowerResult(state: SowerState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	return {
		won: state.phase === "won",
		score: sowerScore(state),
		count: Math.min(500, state.sownCount),
		seconds: Math.round(state.endedAt * 10) / 10,
	};
}
