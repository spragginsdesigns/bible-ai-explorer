/**
 * Let Your Light Shine (LC-17908, docs/beta/games.md), Matthew 5:14-16: "Ye
 * are the light of the world ... Neither do men light a candle, and put it
 * under a bushel, but on a candlestick; and it giveth light unto all that are
 * in the house." Pure and seeded so the tests play it; no imports (Node's
 * type stripping loads it).
 *
 * A house at night seen from above as a grid of rooms. A candle on its
 * candlestick at one wall casts a beam straight into the house; brass mirrors
 * stand in some rooms, each on one diagonal or the other, and turn to the
 * other diagonal with each press, turning the beam through a right angle.
 * Unlit lamps stand in some rooms; the beam lights every lamp it passes
 * through and keeps going. When every lamp in the house is lit the house
 * shines, and the next, larger house comes. Three houses in the round.
 *
 * Each house is laid from the seed: a real route from the candle through the
 * rooms with a mirror at each of its turns, lamps along it, then some of the
 * route's mirrors turned wrong and decoy mirrors set off the route. No house
 * starts lit, and none can be lit in fewer turns than the mirrors set wrong
 * (checked when it is laid), so a house's fewest turns are known.
 */

export const LIGHT_STEP = 1 / 60;
/** The round's length. */
export const LIGHT_SECONDS = 16;
/** The houses of a round: rooms on a side, mirrors set wrong on the route, decoys off it, the route's least length. */
export const LIGHT_HOUSES: readonly { size: number; wrong: number; decoys: number; minPath: number; minTurns: number; maxTurns: number }[] = [
	{ size: 3, wrong: 2, decoys: 2, minPath: 5, minTurns: 2, maxTurns: 4 },
	{ size: 4, wrong: 2, decoys: 3, minPath: 8, minTurns: 3, maxTurns: 5 },
	{ size: 5, wrong: 3, decoys: 4, minPath: 11, minTurns: 4, maxTurns: 7 },
];
/** A mirror swings for this long; a turn pressed while one swings waits for it (one at most). */
export const LIGHT_TURN_GAP = 0.25;
/** The lamps catch once every one of them has been in the beam this long. */
export const LIGHT_KINDLE = 0.5;
/** How long a lit house shines before the next one comes. */
export const LIGHT_SHINE = 1.1;
/**
 * The fastest a round can be won: each house's fewest turns as fast as they
 * swing, the first of each the moment the house comes, its lamps kindling, and
 * every house but the last shining before the next.
 */
export const LIGHT_MIN_SECONDS =
	Math.floor(
		(LIGHT_HOUSES.reduce((sum, house) => sum + (house.wrong - 1) * LIGHT_TURN_GAP + LIGHT_KINDLE, 0) + (LIGHT_HOUSES.length - 1) * LIGHT_SHINE) * 10 + 1e-6,
	) / 10;

/** Directions: 0 east, 1 south, 2 west, 3 north (rows run down the screen). */
export const LIGHT_DIRS: readonly { dc: number; dr: number }[] = [
	{ dc: 1, dr: 0 },
	{ dc: 0, dr: 1 },
	{ dc: -1, dr: 0 },
	{ dc: 0, dr: -1 },
];

/** A mirror's tilt: 0 is "/" and 1 is "\". */
export type LightTilt = 0 | 1;

export interface LightMirror {
	r: number;
	c: number;
	tilt: LightTilt;
}

export interface LightLamp {
	r: number;
	c: number;
}

export interface LightBoard {
	size: number;
	/** The room the candle's beam enters first, and its heading as it enters. */
	entry: { r: number; c: number; dir: number };
	mirrors: LightMirror[];
	lamps: LightLamp[];
	/** The fewest turns that light every lamp. */
	need: number;
}

/** The beam through a house: the rooms it passes in order (with its heading leaving each), and which lamps it lights. */
export interface LightBeam {
	cells: { r: number; c: number; dir: number }[];
	lit: boolean[];
}

export interface LightState {
	t: number;
	house: number;
	boards: LightBoard[];
	beam: LightBeam;
	/** Every turn in the round, and the fewest turns of the houses lit so far. */
	turns: number;
	needed: number;
	lastTurn: number;
	/** A turn pressed while a mirror swings, done when it has swung. */
	queued: number | null;
	/** How long every lamp of the house has been in the beam. */
	kindle: number;
	/** Houses lit, and the lamps lit in them. */
	solved: number;
	lampsLit: number;
	/** While a lit house shines, when the next one comes. */
	shineUntil: number | null;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export interface LightInput {
	/** The mirror (its index in the house's `mirrors`) to turn this step. */
	turn?: number;
}

export type LightEvent =
	| { type: "turn"; mirror: number; tilt: LightTilt }
	| { type: "light"; lamp: number }
	| { type: "dim"; lamp: number }
	| { type: "house"; house: number }
	| { type: "next"; house: number }
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

/** The heading after a mirror: "/" sends east to north and south to west; "\" sends east to south and north to west. */
export function lightReflect(dir: number, tilt: LightTilt): number {
	if (tilt === 0) return [3, 2, 1, 0][dir];
	return [1, 0, 3, 2][dir];
}

/** The mirror's tilt that turns a beam heading `from` to heading `to`. */
function tiltFor(from: number, to: number): LightTilt {
	return lightReflect(from, 0) === to ? 0 : 1;
}

/** Traces the candle's beam through a house with the given tilts (the house's own when none are given). */
export function lightTrace(board: LightBoard, tilts: readonly number[] = board.mirrors.map((mirror) => mirror.tilt)): LightBeam {
	const { size } = board;
	const mirrorAt = new Map<number, number>();
	board.mirrors.forEach((mirror, index) => mirrorAt.set(mirror.r * size + mirror.c, index));
	const lampAt = new Map<number, number>();
	board.lamps.forEach((lamp, index) => lampAt.set(lamp.r * size + lamp.c, index));
	const lit = board.lamps.map(() => false);
	const cells: LightBeam["cells"] = [];
	let { r, c, dir } = board.entry;
	// A beam from a wall always leaves by a wall (mirrors are two-sided), so this bound is never reached.
	for (let guard = 0; guard < size * size * 4 + 4; guard++) {
		if (r < 0 || c < 0 || r >= size || c >= size) break;
		const key = r * size + c;
		const mirror = mirrorAt.get(key);
		if (mirror !== undefined) dir = lightReflect(dir, tilts[mirror] as LightTilt);
		const lamp = lampAt.get(key);
		if (lamp !== undefined) lit[lamp] = true;
		cells.push({ r, c, dir });
		r += LIGHT_DIRS[dir].dr;
		c += LIGHT_DIRS[dir].dc;
	}
	return { cells, lit };
}

export function lightAllLit(beam: LightBeam): boolean {
	return beam.lit.length > 0 && beam.lit.every(Boolean);
}

/** Every way of choosing `count` of `n` items, smallest first. */
function choose(n: number, count: number, from = 0, picked: number[] = [], out: number[][] = []): number[][] {
	if (picked.length === count) {
		out.push([...picked]);
		return out;
	}
	for (let i = from; i < n; i++) {
		picked.push(i);
		choose(n, count, i + 1, picked, out);
		picked.pop();
	}
	return out;
}

/** True when some choice of fewer than `need` turns lights every lamp. */
function solvableSooner(board: LightBoard, need: number): boolean {
	const base = board.mirrors.map((mirror) => mirror.tilt as number);
	for (let count = 0; count < need; count++) {
		for (const flips of choose(board.mirrors.length, count)) {
			const tilts = [...base];
			for (const index of flips) tilts[index] = 1 - tilts[index];
			if (lightAllLit(lightTrace(board, tilts))) return true;
		}
	}
	return false;
}

function shuffle<T>(items: T[], next: () => number): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

/** Lays one house from the seed's stream (see the top of the file). */
export function layLightHouse(next: () => number, spec: (typeof LIGHT_HOUSES)[number]): LightBoard {
	const { size } = spec;
	for (let attempt = 0; attempt < 20000; attempt++) {
		// The candle stands at the west, east or south wall (the north wall holds the window and the count).
		const side = Math.floor(next() * 3);
		const at = Math.floor(next() * size);
		const entry = side === 0 ? { r: at, c: 0, dir: 0 } : side === 1 ? { r: at, c: size - 1, dir: 2 } : { r: size - 1, c: at, dir: 3 };
		// The route: a walk from the entry that never enters a room twice, turning at mirrors, until it leaves by a wall.
		const route: { r: number; c: number; turn: boolean; from: number; to: number }[] = [];
		const seen = new Set<number>();
		let { r, c, dir } = entry;
		let ok = false;
		for (let guard = 0; guard < size * size + 1; guard++) {
			seen.add(r * size + c);
			const options = next() < 0.55 ? [dir, (dir + 1) % 4, (dir + 3) % 4] : next() < 0.5 ? [(dir + 1) % 4, (dir + 3) % 4, dir] : [(dir + 3) % 4, (dir + 1) % 4, dir];
			let chosen = -1;
			let leaves = false;
			for (const option of options) {
				const nr = r + LIGHT_DIRS[option].dr;
				const nc = c + LIGHT_DIRS[option].dc;
				const outside = nr < 0 || nc < 0 || nr >= size || nc >= size;
				if (outside) {
					if (route.length + 1 >= spec.minPath) {
						chosen = option;
						leaves = true;
						break;
					}
					continue;
				}
				if (!seen.has(nr * size + nc)) {
					chosen = option;
					break;
				}
			}
			if (chosen < 0) break;
			route.push({ r, c, turn: chosen !== dir, from: dir, to: chosen });
			if (leaves) {
				ok = true;
				break;
			}
			r += LIGHT_DIRS[chosen].dr;
			c += LIGHT_DIRS[chosen].dc;
			dir = chosen;
		}
		if (!ok) continue;
		const turns = route.map((cell, index) => (cell.turn ? index : -1)).filter((index) => index >= 0);
		if (turns.length < spec.minTurns || turns.length > spec.maxTurns || turns.length < spec.wrong) continue;
		// The mirrors set wrong, in route order, each with a lamp in a plain room after it and before the next wrong one.
		const wrong = shuffle([...turns], next)
			.slice(0, spec.wrong)
			.sort((a, b) => a - b);
		const lampCells: number[] = [];
		let placed = true;
		for (let k = 0; k < wrong.length; k++) {
			const end = k + 1 < wrong.length ? wrong[k + 1] : route.length;
			const plain: number[] = [];
			for (let index = wrong[k] + 1; index < end; index++) if (!route[index].turn) plain.push(index);
			if (!plain.length) {
				placed = false;
				break;
			}
			lampCells.push(plain[Math.floor(next() * plain.length)]);
		}
		if (!placed) continue;
		// A lamp before the first wrong mirror, already lit, when there is a room for it past the doorway.
		const early: number[] = [];
		for (let index = 1; index < wrong[0]; index++) if (!route[index].turn) early.push(index);
		if (early.length && next() < 0.7) lampCells.unshift(early[Math.floor(next() * early.length)]);

		const mirrors: LightMirror[] = [];
		for (const index of turns) {
			const cell = route[index];
			const right = tiltFor(cell.from, cell.to);
			mirrors.push({ r: cell.r, c: cell.c, tilt: (wrong.includes(index) ? 1 - right : right) as LightTilt });
		}
		const free = shuffle(
			Array.from({ length: size * size }, (_, index) => index).filter((index) => !seen.has(index)),
			next,
		);
		for (const index of free.slice(0, spec.decoys)) mirrors.push({ r: Math.floor(index / size), c: index % size, tilt: (next() < 0.5 ? 0 : 1) as LightTilt });
		mirrors.sort((a, b) => a.r * size + a.c - (b.r * size + b.c));
		const lamps = lampCells.map((index) => ({ r: route[index].r, c: route[index].c }));
		const board: LightBoard = { size, entry, mirrors, lamps, need: spec.wrong };
		if (solvableSooner(board, spec.wrong)) continue;
		return board;
	}
	throw new Error("let-your-light-shine: no house could be laid");
}

export function newLight(seed: number): LightState {
	const next = random(seed);
	const boards = LIGHT_HOUSES.map((spec) => layLightHouse(next, spec));
	return {
		t: 0,
		house: 0,
		boards,
		beam: lightTrace(boards[0]),
		turns: 0,
		needed: 0,
		lastTurn: -1,
		queued: null,
		kindle: 0,
		solved: 0,
		lampsLit: 0,
		shineUntil: null,
		phase: "playing",
		endedAt: null,
	};
}

/** The house being played (or the last one, once the round is over). */
export function lightBoard(state: LightState): LightBoard {
	return state.boards[Math.min(state.house, state.boards.length - 1)];
}

/** The mirror in a room, or -1. */
export function lightMirrorAt(board: LightBoard, r: number, c: number): number {
	return board.mirrors.findIndex((mirror) => mirror.r === r && mirror.c === c);
}

/** True while a lit house shines and turns do nothing. */
export function lightShining(state: LightState): boolean {
	return state.shineUntil !== null;
}

export function stepLight(state: LightState, input: LightInput, events: LightEvent[] = []): LightState {
	if (state.phase !== "playing") return state;
	const dt = LIGHT_STEP;
	let lit = false;
	if (state.shineUntil !== null) {
		if (state.t >= state.shineUntil - 1e-9) {
			state.house += 1;
			state.shineUntil = null;
			state.kindle = 0;
			state.beam = lightTrace(state.boards[state.house]);
			events.push({ type: "next", house: state.house });
		}
	} else {
		const board = state.boards[state.house];
		if (input.turn !== undefined && state.queued === null && board.mirrors[input.turn]) state.queued = input.turn;
		if (state.queued !== null && state.t - state.lastTurn >= LIGHT_TURN_GAP - 1e-9) {
			const index = state.queued;
			const mirror = board.mirrors[index];
			state.queued = null;
			mirror.tilt = (1 - mirror.tilt) as LightTilt;
			state.turns += 1;
			state.lastTurn = state.t;
			events.push({ type: "turn", mirror: index, tilt: mirror.tilt });
			const before = state.beam.lit;
			state.beam = lightTrace(board);
			state.beam.lit.forEach((on, lamp) => {
				if (on && !before[lamp]) events.push({ type: "light", lamp });
				if (!on && before[lamp]) events.push({ type: "dim", lamp });
			});
		}
		state.kindle = lightAllLit(state.beam) ? state.kindle + dt : 0;
		lit = state.kindle >= LIGHT_KINDLE - 1e-9;
	}
	state.t += dt;
	if (lit) {
		const board = state.boards[state.house];
		state.solved += 1;
		state.needed += board.need;
		state.lampsLit += board.lamps.length;
		state.queued = null;
		events.push({ type: "house", house: state.house });
		if (state.house >= state.boards.length - 1) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "won" });
			return state;
		}
		state.shineUntil = state.t + LIGHT_SHINE;
	}
	if (state.t >= LIGHT_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: every house lit sooner, and in fewer turns, scores higher. */
export function lightResult(state: LightState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const extra = Math.max(0, state.turns - state.needed);
	const score = won ? Math.round(Math.max(15, Math.min(100, 100 - extra * 7 - Math.max(0, state.endedAt - 7) * 4.5))) : 0;
	const count = state.lampsLit + (won ? 0 : state.beam.lit.filter(Boolean).length);
	return { won, score, count, seconds };
}
