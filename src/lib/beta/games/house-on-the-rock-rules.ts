/**
 * Built on the Rock (LC-17851, docs/beta/games.md), Matthew 7:24-27: the wise
 * man built his house upon a rock. A stone slides left and right above the
 * rock; drop it, and whatever hangs over the course below is cut away, so the
 * next stone is narrower. Lay eight courses and the roof goes on; then the
 * rain descends, the floods come and the winds blow, and it fell not. Pure
 * and seeded so the tests play it; no imports (Node's type stripping loads
 * it).
 */

export const HOUSE_STEP = 1 / 60;
export const HOUSE_SECONDS = 15;
export const HOUSE_COURSES = 8;
export const HOUSE_START_W = 132;
/** A course narrower than this cannot bear the next: the house falls. */
export const HOUSE_MIN_W = 34;
export const HOUSE_COURSE_H = 26;
/** The rock's top, its middle and its width. */
export const HOUSE_ROCK_Y = 344;
export const HOUSE_ROCK_X = 200;
export const HOUSE_ROCK_W = 160;
/** Where a stone's middle may slide between. */
export const HOUSE_LEFT = 40;
export const HOUSE_RIGHT = 360;
/** Ticks a new stone takes to be let down into place before it can be dropped, and to fall. */
export const HOUSE_ARRIVE_TICKS = 30;
export const HOUSE_FALL_TICKS = 15;
/** A drop this close to true sets square, with nothing cut. */
export const HOUSE_SNAP = 4;
/** The fastest a round can be won: every stone dropped the moment it may be. */
export const HOUSE_MIN_SECONDS = (HOUSE_COURSES * (HOUSE_ARRIVE_TICKS + HOUSE_FALL_TICKS)) / 60;

export interface HouseCourse {
	x: number;
	w: number;
	perfect: boolean;
}

export interface HouseStone {
	x: number;
	w: number;
	dir: 1 | -1;
	spawnedAt: number;
	droppedAt: number | null;
}

export interface HouseChip {
	x: number;
	w: number;
	y: number;
	side: -1 | 1;
	tick: number;
}

export interface HouseState {
	tick: number;
	t: number;
	courses: HouseCourse[];
	stone: HouseStone;
	chips: HouseChip[];
	perfects: number;
	/** 0 when the first stone comes from the left, 1 from the right (from the seed). */
	side: number;
	phase: "playing" | "won" | "lost";
	/** Why the round was lost. */
	fell: "narrow" | "time" | null;
	endedAt: number | null;
}

export type HouseEvent = { type: "drop" } | { type: "land"; perfect: boolean; cut: number } | { type: "fell" } | { type: "roof" } | { type: "time" };

export function houseSpeed(course: number): number {
	return 165 + course * 25;
}

/** The surface a stone lands on: the top course, or the rock. */
export function houseTop(state: HouseState): { x: number; w: number; y: number } {
	const top = state.courses.at(-1);
	const y = HOUSE_ROCK_Y - state.courses.length * HOUSE_COURSE_H;
	return top ? { x: top.x, w: top.w, y } : { x: HOUSE_ROCK_X, w: HOUSE_ROCK_W, y };
}

function spawn(state: HouseState) {
	const course = state.courses.length;
	const width = state.courses.at(-1)?.w ?? HOUSE_START_W;
	// Stones come in from alternate sides, a little in from the edge.
	const fromLeft = (course + state.side) % 2 === 0;
	state.stone = { x: fromLeft ? HOUSE_LEFT : HOUSE_RIGHT, w: width, dir: fromLeft ? 1 : -1, spawnedAt: state.tick, droppedAt: null };
}

export function newHouse(seed: number): HouseState {
	const state: HouseState = {
		tick: 0,
		t: 0,
		courses: [],
		stone: { x: HOUSE_LEFT, w: HOUSE_START_W, dir: 1, spawnedAt: 0, droppedAt: null },
		chips: [],
		perfects: 0,
		side: (seed >>> 0) % 2,
		phase: "playing",
		fell: null,
		endedAt: null,
	};
	spawn(state);
	return state;
}

/** True when the stone may be dropped now. */
export function houseReady(state: HouseState): boolean {
	return state.stone.droppedAt === null && state.tick - state.stone.spawnedAt >= HOUSE_ARRIVE_TICKS;
}

export function stepHouse(state: HouseState, input: { drop: boolean }, events: HouseEvent[] = []): HouseState {
	if (state.phase !== "playing") return state;
	state.tick += 1;
	state.t = state.tick / 60;
	const stone = state.stone;
	if (stone.droppedAt === null) {
		const speed = houseSpeed(state.courses.length) * HOUSE_STEP;
		stone.x += stone.dir * speed;
		if (stone.x >= HOUSE_RIGHT) {
			stone.x = HOUSE_RIGHT - (stone.x - HOUSE_RIGHT);
			stone.dir = -1;
		} else if (stone.x <= HOUSE_LEFT) {
			stone.x = HOUSE_LEFT + (HOUSE_LEFT - stone.x);
			stone.dir = 1;
		}
		if (input.drop && houseReady(state)) {
			stone.droppedAt = state.tick;
			events.push({ type: "drop" });
		}
	} else if (state.tick - stone.droppedAt >= HOUSE_FALL_TICKS) {
		const top = houseTop(state);
		let x = stone.x;
		const perfect = Math.abs(x - top.x) <= HOUSE_SNAP;
		if (perfect && state.courses.length > 0) x = top.x;
		const left = Math.max(x - stone.w / 2, top.x - top.w / 2);
		const right = Math.min(x + stone.w / 2, top.x + top.w / 2);
		const width = Math.max(0, right - left);
		const cut = stone.w - width;
		if (cut > 0.01) {
			const side = x > top.x ? 1 : -1;
			state.chips.push({ x: side > 0 ? (right + x + stone.w / 2) / 2 : (x - stone.w / 2 + left) / 2, w: cut, y: top.y - HOUSE_COURSE_H / 2, side, tick: state.tick });
		}
		if (width < HOUSE_MIN_W) {
			state.phase = "lost";
			state.fell = "narrow";
			state.endedAt = state.t;
			events.push({ type: "fell" });
			return state;
		}
		const square = perfect || cut <= 0.01;
		if (square) state.perfects += 1;
		state.courses.push({ x: (left + right) / 2, w: width, perfect: square });
		events.push({ type: "land", perfect: square, cut });
		if (state.courses.length >= HOUSE_COURSES) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "roof" });
			return state;
		}
		spawn(state);
	}
	if (state.t >= HOUSE_SECONDS - 1e-9) {
		state.phase = "lost";
		state.fell = "time";
		state.endedAt = state.t;
		events.push({ type: "time" });
	}
	return state;
}

/** The round's result once it has ended: the wider the house stands, the truer it was built. */
export function houseResult(state: HouseState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const width = state.courses.at(-1)?.w ?? 0;
	const score = state.phase === "won" ? Math.round(Math.max(10, Math.min(100, (width / HOUSE_START_W) * 100))) : 0;
	return { won: state.phase === "won", score, count: state.courses.length, seconds };
}
