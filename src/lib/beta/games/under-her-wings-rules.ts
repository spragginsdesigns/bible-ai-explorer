/**
 * Under Her Wings (LC-17851, docs/beta/games.md), Matthew 23:37-39: "how often
 * would I have gathered thy children together, even as a hen gathereth her
 * chickens under her wings". Pure and seeded so the tests play it; no imports
 * (Node's type stripping loads it).
 *
 * A courtyard in Jerusalem seen from above, a storm gathering. Six chicks
 * have scattered from the nest in the middle and keep wandering away from it,
 * quicker as the storm nears. The hen runs to each one, and it falls in
 * behind her in a line; when she comes back to the nest, every chick in her
 * line is gathered under her wings. Won: all six home before the storm breaks;
 * it ends as soon as they are.
 */

export const WINGS_STEP = 1 / 60;
export const WINGS_SECONDS = 15;
export const WINGS_CHICKS = 6;
/** The courtyard's walls, in the 400-unit picture. */
export const WINGS_WALL = 22;
export const WINGS_NEST = { x: 200, y: 200 } as const;
export const WINGS_NEST_R = 30;
export const WINGS_HEN_SPEED = 150;
/** How near the hen must come to a chick for it to follow her. */
export const WINGS_CATCH_R = 20;
/** How far out the chicks start, and how fast they wander at the start and at the end. */
export const WINGS_START_R = [118, 150] as const;
export const WINGS_WANDER = [28, 72] as const;
/** A wandering chick darts away when the hen comes this near, this much quicker. */
export const WINGS_SKITTISH_R = 50;
export const WINGS_DART = 1.8;
/** The gap a following chick keeps behind the one ahead of it. */
export const WINGS_SPACING = 15;
const FOLLOW_SPEED = 300;

/** Each chick keeps to its own sixth of the courtyard: within this many radians of its sixth's middle. */
export const WINGS_WEDGE = (12 * Math.PI) / 180;

/**
 * The fastest the round can be won, provably. Every chick starts at least
 * WINGS_START_R[0] from the nest, never wanders nearer to it, and keeps within
 * WINGS_WEDGE of the middle of its own sixth, so the six places the hen can
 * touch them lie at least `reach` out, no two neighbours more than `gap`
 * apart in angle. Her path from the nest through all six and back within the
 * nest, closed up, is a loop around those six places, at least as long as
 * their convex hull, which holds the circle of radius reach * cos(gap / 2).
 * A reported time is rounded to tenths, so this is floored to the tenth below.
 * (Real rounds take far longer: see the test's fastest planned rounds.)
 */
export const WINGS_MIN_SECONDS = (() => {
	const reach = WINGS_START_R[0] - WINGS_CATCH_R;
	const gap = Math.PI / 3 + 2 * (WINGS_WEDGE + Math.asin(WINGS_CATCH_R / WINGS_START_R[0]));
	const loop = 2 * Math.PI * reach * Math.cos(gap / 2) - WINGS_NEST_R;
	return Math.floor((loop / WINGS_HEN_SPEED - 0.05) * 10) / 10;
})();

export interface Chick {
	id: number;
	/** The middle of its sixth of the courtyard, as an angle around the nest. */
	home: number;
	x: number;
	y: number;
	heading: number;
	/** Wandering, following the hen (its place in her line), or home under her wings. */
	state: "wander" | "follow" | "home";
	place: number;
	hop: number;
}

export interface WingsState {
	t: number;
	hen: { x: number; y: number; facing: number };
	chicks: Chick[];
	followers: number;
	home: number;
	rng: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export interface WingsInput {
	/** Held arrows: -1, 0 or 1 on each axis. */
	dx: number;
	dy: number;
	/** A dragged point the hen runs toward (wins over the arrows), or null. */
	target: { x: number; y: number } | null;
}

export type WingsEvent = { type: "follow"; id: number; x: number; y: number } | { type: "home"; count: number; home: number } | { type: "won" } | { type: "storm" };

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

/** The round's own dice, kept in the state so a replay is exact. */
function roll(state: WingsState): number {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp = (value: number) => Math.max(WINGS_WALL, Math.min(400 - WINGS_WALL, value));

/** How far a point is, as an angle around the nest, from the middle of a chick's sixth (-pi..pi). */
export function wedgeOffset(chick: Pick<Chick, "home">, x: number, y: number): number {
	const angle = Math.atan2(y - WINGS_NEST.y, x - WINGS_NEST.x) - chick.home;
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function newWings(seed: number): WingsState {
	const next = random(seed);
	const turn = next() * Math.PI * 2;
	const chicks: Chick[] = [];
	for (let id = 0; id < WINGS_CHICKS; id++) {
		const middle = turn + (id * Math.PI * 2) / WINGS_CHICKS;
		const angle = middle + (next() * 2 - 1) * WINGS_WEDGE;
		const radius = WINGS_START_R[0] + next() * (WINGS_START_R[1] - WINGS_START_R[0]);
		chicks.push({
			id,
			home: middle,
			x: clamp(WINGS_NEST.x + Math.cos(angle) * radius),
			y: clamp(WINGS_NEST.y + Math.sin(angle) * radius),
			heading: angle + (next() * 2 - 1) * 1.2,
			state: "wander",
			place: -1,
			hop: next() * 6,
		});
	}
	return { t: 0, hen: { x: WINGS_NEST.x, y: WINGS_NEST.y, facing: -Math.PI / 2 }, chicks, followers: 0, home: 0, rng: (seed * 2654435761) >>> 0 || 7, phase: "playing", endedAt: null };
}

/** How fast a wandering chick goes at time `t`. */
export function wanderSpeed(t: number): number {
	return WINGS_WANDER[0] + (WINGS_WANDER[1] - WINGS_WANDER[0]) * Math.min(1, t / WINGS_SECONDS);
}

export function stepWings(state: WingsState, input: WingsInput, events: WingsEvent[] = []): WingsState {
	if (state.phase !== "playing") return state;
	const dt = WINGS_STEP;
	const hen = state.hen;
	// The hen runs.
	let mx = 0;
	let my = 0;
	if (input.target) {
		const gx = input.target.x - hen.x;
		const gy = input.target.y - hen.y;
		const gap = Math.hypot(gx, gy);
		if (gap > 0.5) {
			const go = Math.min(gap, WINGS_HEN_SPEED * dt);
			mx = (gx / gap) * go;
			my = (gy / gap) * go;
		}
	} else if (input.dx || input.dy) {
		const length = Math.hypot(input.dx, input.dy);
		mx = (input.dx / length) * WINGS_HEN_SPEED * dt;
		my = (input.dy / length) * WINGS_HEN_SPEED * dt;
	}
	if (mx || my) hen.facing = Math.atan2(my, mx);
	hen.x = clamp(hen.x + mx);
	hen.y = clamp(hen.y + my);
	state.t += dt;

	const speed = wanderSpeed(state.t);
	const line = state.chicks.filter((chick) => chick.state === "follow").sort((a, b) => a.place - b.place);
	for (const chick of state.chicks) {
		if (chick.state === "home") continue;
		if (chick.state === "follow") {
			const lead = chick.place === 0 ? hen : line[chick.place - 1];
			const gx = lead.x - chick.x;
			const gy = lead.y - chick.y;
			const gap = Math.hypot(gx, gy);
			if (gap > WINGS_SPACING) {
				const go = Math.min(gap - WINGS_SPACING, FOLLOW_SPEED * dt);
				chick.x += (gx / gap) * go;
				chick.y += (gy / gap) * go;
				chick.heading = Math.atan2(gy, gx);
			}
			continue;
		}
		// Wandering: a little turn each step, darting from the hen when she is near, never back toward the nest, off the walls.
		const near = Math.hypot(chick.x - hen.x, chick.y - hen.y) < WINGS_SKITTISH_R;
		if (near) chick.heading = Math.atan2(chick.y - hen.y, chick.x - hen.x) + (roll(state) - 0.5) * 0.4;
		else chick.heading += (roll(state) - 0.5) * 0.5;
		const pace = speed * (near ? WINGS_DART : 0.55 + 0.9 * Math.abs(Math.sin(chick.hop + state.t * 5)));
		let vx = Math.cos(chick.heading) * pace;
		let vy = Math.sin(chick.heading) * pace;
		const rx = chick.x - WINGS_NEST.x;
		const ry = chick.y - WINGS_NEST.y;
		const r = Math.hypot(rx, ry) || 1;
		const out = (vx * rx + vy * ry) / r;
		if (out < 0) {
			vx -= (out * rx) / r;
			vy -= (out * ry) / r;
			chick.heading = Math.atan2(vy, vx) + (roll(state) - 0.5) * 0.3;
		}
		let nx = chick.x + vx * dt;
		let ny = chick.y + vy * dt;
		if (nx < WINGS_WALL || nx > 400 - WINGS_WALL) chick.heading = Math.PI - chick.heading;
		if (ny < WINGS_WALL || ny > 400 - WINGS_WALL) chick.heading = -chick.heading;
		// Kept to its own sixth: turned back at the edge of it.
		const off = wedgeOffset(chick, nx, ny);
		if (Math.abs(off) > WINGS_WEDGE) {
			const edge = chick.home + Math.sign(off) * WINGS_WEDGE;
			const far = Math.hypot(nx - WINGS_NEST.x, ny - WINGS_NEST.y);
			nx = WINGS_NEST.x + Math.cos(edge) * far;
			ny = WINGS_NEST.y + Math.sin(edge) * far;
			chick.heading = edge + (roll(state) - 0.5) * 0.6;
		}
		nx = clamp(nx);
		ny = clamp(ny);
		if (Math.abs(wedgeOffset(chick, nx, ny)) <= WINGS_WEDGE + 1e-9) {
			chick.x = nx;
			chick.y = ny;
		} else chick.heading += Math.PI / 2;
		if (Math.hypot(chick.x - hen.x, chick.y - hen.y) <= WINGS_CATCH_R) {
			chick.state = "follow";
			chick.place = state.followers;
			state.followers += 1;
			line.push(chick);
			events.push({ type: "follow", id: chick.id, x: chick.x, y: chick.y });
		}
	}
	// Home: the hen in the nest gathers every chick in her line under her wings.
	if (state.followers > 0 && Math.hypot(hen.x - WINGS_NEST.x, hen.y - WINGS_NEST.y) <= WINGS_NEST_R) {
		const count = state.followers;
		for (const chick of state.chicks) {
			if (chick.state !== "follow") continue;
			chick.state = "home";
			chick.place = -1;
		}
		state.followers = 0;
		state.home += count;
		events.push({ type: "home", count, home: state.home });
		if (state.home >= WINGS_CHICKS) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "won" });
		}
	}
	if (state.phase === "playing" && state.t >= WINGS_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "storm" });
	}
	return state;
}

/** The round's result once it has ended: gathered sooner is a higher score. */
export function wingsResult(state: WingsState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - (state.endedAt - 6.5) * 9))) : Math.round((state.home / WINGS_CHICKS) * 30);
	return { won: state.phase === "won", score, count: state.home, seconds };
}
