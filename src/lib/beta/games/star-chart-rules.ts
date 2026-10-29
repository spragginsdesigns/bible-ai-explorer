/**
 * Star Chart (LC-17851, docs/beta/games.md), the puzzle way to play Matthew
 * 2:1-12. This is the whole game: the page draws it and feeds it input, and
 * the tests play it step by step. Pure on purpose (no imports, no DOM, no
 * clock, its own seeded random), so a seed and a list of actions always play
 * the same chart.
 *
 * The passage is charted in four legs, each a small handcrafted map of road
 * tiles. A tile is turned a quarter turn at a time until one unbroken road
 * runs from where the leg begins to where it ends: from the east to
 * Jerusalem (vv1-2), the scribes' answer from Jerusalem to Bethlehem
 * (vv5-8), beneath the star that went before them to the house (vv9-11), and
 * home another way that does not pass back through Jerusalem (v12). The seed
 * only chooses how the tiles start turned; the maps never change.
 *
 * Every turn spends a little of the night, and the night also passes slowly
 * while the chart waits. If dawn comes before a leg is charted the stars fade
 * and the run is over. Turning back with Undo spends nothing; a Hint turns one
 * tile of the road into place for a cost to the score. The score, how well the
 * chart "kept to the star", counts turns beyond the fewest the leg needed and
 * the hints taken.
 */

/** The simulation runs in fixed steps; the page accumulates frame time into them. */
export const CHART_STEP = 1 / 60;
/**
 * A quarter turn takes this long, and actions wait their turn behind it. Five
 * turns a second is as fast as a person taps a tile that they already know is
 * wrong, so it is the floor a flawless run is held to.
 */
export const CHART_TURN_SECONDS = 0.2;
/** A hint turns its tile slowly, so it is never quicker than turning it by hand (three turns at most). */
export const CHART_HINT_SECONDS = 0.6;
/** Once a leg's road is unbroken the travellers walk it before the next leg. */
export const CHART_TRAVEL_SECONDS = 2.5;
/** Seconds of waiting that pass as much of the night as one turn. */
export const CHART_NIGHT_SECONDS_PER_TURN = 15;
/** Turns of night each leg has beyond the fewest its tiles needed: a few, and more for a leg that needs many. */
export const CHART_NIGHT_SPARE_TURNS = 10;
export const CHART_NIGHT_SPARE_SHARE = 0.5;
/** Score lost for each turn beyond a leg's fewest, and for each hint. */
export const CHART_EXTRA_TURN_COST = 3;
export const CHART_HINT_COST = 12;
/** Most actions waiting at once; a burst of taps past this is dropped. */
const QUEUE_LIMIT = 6;

/** Directions as bits: north, east, south, west. */
const N = 1;
const E = 2;
const S = 4;
const W = 8;
const DIRS = [N, E, S, W] as const;
const STEP_ROW: Record<number, number> = { [N]: -1, [E]: 0, [S]: 1, [W]: 0 };
const STEP_COL: Record<number, number> = { [N]: 0, [E]: 1, [S]: 0, [W]: -1 };
const OPPOSITE: Record<number, number> = { [N]: S, [E]: W, [S]: N, [W]: E };

export type ChartCellKind = "straight" | "bend" | "start" | "goal" | "city" | "mountain" | "wadi" | "desert";

export interface ChartLeg {
	/** "From the east to Jerusalem". */
	title: string;
	/** What the player is asked to do, in the game's own words. */
	objective: string;
	/** Where the leg begins and ends, as the passage names them. */
	from: string;
	to: string;
	cols: number;
	rows: number;
	/**
	 * The map, one string per row. `-` `|` and `L` `F` `7` `J` are the road the
	 * leg is charted by, in place (`L` opens north and east, `F` east and south,
	 * `7` south and west, `J` west and north); `s` and `b` are straight and bent
	 * tiles off that road; `S` begins the leg, `G` ends it, `X` is Jerusalem on
	 * the way home (a crossroads that may not be used); `#` mountains, `~` a
	 * wadi, `,` open desert.
	 */
	map: readonly string[];
	/** The side of `S` the road leaves by. */
	startSide: "north" | "east" | "south" | "west";
	/** Cells the road must pass beneath (the star went before them), as [row, col]. */
	stars: readonly (readonly [number, number])[];
	/** True when the road may not pass through Jerusalem (`X`). */
	avoidCity: boolean;
	/** The fewest turns any start of this leg needs (the seed's turns are held to it). */
	minTurns: number;
}

export const CHART_LEGS: readonly ChartLeg[] = [
	{
		title: "From the east to Jerusalem",
		objective: "Turn the tiles until one road runs from the east to Jerusalem.",
		from: "the east",
		to: "Jerusalem",
		cols: 6,
		rows: 5,
		map: ["#bF-7,", "G-J~|b", "#s#~LS", ",bs#b,", "#,bs~,"],
		startSide: "west",
		stars: [],
		avoidCity: false,
		minTurns: 5,
	},
	{
		title: "The scribes' answer",
		objective: "Chart the scribes' answer: a road from Jerusalem to Bethlehem.",
		from: "Jerusalem",
		to: "Bethlehem",
		cols: 5,
		rows: 4,
		map: [",,S#,", "bFJs,", "#|~b#", ",L-G,"],
		startSide: "south",
		stars: [],
		avoidCity: false,
		minTurns: 3,
	},
	{
		title: "The star went before them",
		objective: "Chart the road to the house, passing beneath the star at every mark.",
		from: "Jerusalem",
		to: "the house",
		cols: 6,
		rows: 5,
		map: ["#F--7,", "SJ#~|b", ",s#b|#", "~G--J,", ",#bs,~"],
		startSide: "east",
		stars: [
			[1, 4],
			[3, 3],
		],
		avoidCity: false,
		minTurns: 6,
	},
	{
		title: "Another way",
		objective: "Chart a way home to their own country that does not pass through Jerusalem.",
		from: "the house",
		to: "their own country",
		cols: 6,
		rows: 5,
		map: [",#b#~,", "#sb,#b", ",bXssG", "S7#~b|", "~L---J"],
		startSide: "east",
		stars: [],
		avoidCity: true,
		minTurns: 5,
	},
];

export const CHART_LEG_COUNT = CHART_LEGS.length;

/**
 * The soonest a chart can be finished: every leg's fewest turns at the turn's
 * own pace, plus the walk along each charted road. A real run is slower (it
 * has to find the turns); this only refuses a time no one could have played.
 */
export const CHART_MIN_SECONDS =
	Math.floor((CHART_LEGS.reduce((sum, leg) => sum + leg.minTurns, 0) * CHART_TURN_SECONDS + CHART_LEG_COUNT * CHART_TRAVEL_SECONDS) * 10) / 10;

export type ChartPhase = "charting" | "travelling" | "between" | "dawn" | "done";

export type ChartAction = { type: "turn"; cell: number } | { type: "undo" } | { type: "hint" } | { type: "next" };

export type ChartEvent =
	| { type: "turn"; cell: number }
	| { type: "undo"; cell: number }
	| { type: "hint"; cell: number }
	/** The road reaches the leg's end but breaks one of its rules. */
	| { type: "astray"; reason: "star" | "city" }
	/** The road is unbroken: the travellers set out along it. */
	| { type: "connected"; leg: number }
	/** The travellers reached the leg's end. */
	| { type: "charted"; leg: number }
	| { type: "next"; leg: number }
	| { type: "dawn"; leg: number }
	| { type: "finished" };

export interface ChartCell {
	kind: ChartCellKind;
	/** Quarter turns clockwise from the tile's drawn shape (straight north-south, bend north-east). */
	rot: number;
	/** Every turn ever made on this cell, signed (+1 a turn, -1 an undo), so the page can animate it the right way round. */
	spin: number;
	/** The openings the leg's road needs here, or 0 when the cell is off it. */
	road: number;
}

export interface ChartState {
	seed: number;
	phase: ChartPhase;
	/** Seconds played: charting and travelling, never the words between legs. */
	t: number;
	leg: number;
	cells: ChartCell[];
	/** Each leg's starting turns, chosen from the seed when the chart is made. */
	starts: number[][];
	/** Night left on this leg, in turns. */
	night: number;
	nightTotal: number;
	/** Turns on this leg and the fewest it needed from its start. */
	legTurns: number;
	par: number;
	/** Turns, hints and turns beyond the fewest, over the whole chart. */
	turns: number;
	hints: number;
	extra: number;
	queue: ChartAction[];
	/** Seconds left on the turn in hand; nothing else happens until it is 0. */
	busy: number;
	/** The cell being turned, or -1. */
	turning: number;
	/** This leg's turns, newest last, for Undo. */
	history: number[];
	/** The road as it runs from the start right now: cell indexes in order. */
	route: number[];
	/** True when the route reaches the leg's end. */
	reaches: boolean;
	/** Seconds into the walk along a charted road. */
	travel: number;
	/** The reason the route that reaches the end does not count, if one. */
	astray: "star" | "city" | null;
}

export interface ChartResult {
	faithKept: number;
	seconds: number;
	swellsCleared: number;
}

function random(state: { seed: number }): number {
	state.seed = (state.seed + 0x6d2b79f5) | 0;
	let r = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
	r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
	return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

const ROAD: Record<string, number> = { "-": E | W, "|": N | S, L: N | E, F: E | S, "7": S | W, J: W | N };
const SIDES: Record<ChartLeg["startSide"], number> = { north: N, east: E, south: S, west: W };

function rotateMask(mask: number, turns: number): number {
	let m = mask;
	for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = ((m << 1) | (m >> 3)) & 15;
	return m;
}

/** The sides a cell is open on, as bits (north 1, east 2, south 4, west 8). */
export function cellOpenings(cell: Pick<ChartCell, "kind" | "rot">): number {
	if (cell.kind === "straight") return rotateMask(N | S, cell.rot);
	if (cell.kind === "bend") return rotateMask(N | E, cell.rot);
	if (cell.kind === "city" || cell.kind === "goal") return N | E | S | W;
	return 0;
}

export function isTurnable(cell: Pick<ChartCell, "kind">): boolean {
	return cell.kind === "straight" || cell.kind === "bend";
}

/** The fewest clockwise quarter turns that open `kind` at `rot` on exactly `mask`, or -1 when it cannot. */
export function turnsToOpen(kind: ChartCellKind, rot: number, mask: number): number {
	for (let k = 0; k < 4; k++) if (cellOpenings({ kind, rot: (rot + k) % 4 }) === mask) return k;
	return -1;
}

function kindOf(char: string): ChartCellKind {
	if (char === "-" || char === "|" || char === "s") return "straight";
	if ("LF7Jb".includes(char)) return "bend";
	if (char === "S") return "start";
	if (char === "G") return "goal";
	if (char === "X") return "city";
	if (char === "#") return "mountain";
	if (char === "~") return "wadi";
	return "desert";
}

/** A leg's cells with the given starting turns (one per cell, row by row). */
export function legCells(leg: ChartLeg, rotations: readonly number[]): ChartCell[] {
	const cells: ChartCell[] = [];
	for (let r = 0; r < leg.rows; r++) {
		for (let c = 0; c < leg.cols; c++) {
			const char = leg.map[r][c];
			const kind = kindOf(char);
			const index = r * leg.cols + c;
			cells.push({ kind, rot: isTurnable({ kind }) ? rotations[index] : 0, spin: 0, road: ROAD[char] ?? 0 });
		}
	}
	return cells;
}

/** The road from the leg's start, following each tile's openings as far as they join up. */
export function traceRoute(leg: ChartLeg, cells: readonly ChartCell[]): { route: number[]; reaches: boolean } {
	const start = leg.map.join("").indexOf("S");
	const route = [start];
	let row = Math.floor(start / leg.cols);
	let col = start % leg.cols;
	let heading = SIDES[leg.startSide];
	for (let guard = 0; guard < cells.length * 2; guard++) {
		row += STEP_ROW[heading];
		col += STEP_COL[heading];
		if (row < 0 || col < 0 || row >= leg.rows || col >= leg.cols) break;
		const index = row * leg.cols + col;
		const cell = cells[index];
		const enter = OPPOSITE[heading];
		const open = cellOpenings(cell);
		if (!(open & enter)) break;
		route.push(index);
		if (cell.kind === "goal") return { route, reaches: true };
		if (cell.kind === "city") continue; // straight on through the crossroads
		const out = open & ~enter;
		if (route.indexOf(index) !== route.length - 1) break; // looped back on itself
		heading = out;
	}
	return { route, reaches: false };
}

function legRules(leg: ChartLeg, route: readonly number[]): "star" | "city" | null {
	if (leg.avoidCity && route.some((index) => leg.map[Math.floor(index / leg.cols)][index % leg.cols] === "X")) return "city";
	if (leg.stars.some(([r, c]) => !route.includes(r * leg.cols + c))) return "star";
	return null;
}

/** The turns that put every tile of the leg's own road in place: the leg's par. */
export function roadTurns(cells: readonly ChartCell[]): number {
	let sum = 0;
	for (const cell of cells) if (cell.road) sum += turnsToOpen(cell.kind, cell.rot, cell.road);
	return sum;
}

/**
 * The fewest turns ANY road through this leg could take from these tiles, a
 * lower bound: it searches every way through, passing every star mark and
 * keeping out of a forbidden Jerusalem, and lets a path cross itself (which
 * only makes it cheaper). The seed's starts are held to `leg.minTurns` by it,
 * so `CHART_MIN_SECONDS` is a floor no real run can beat.
 */
export function fewestTurns(leg: ChartLeg, cells: readonly ChartCell[]): number {
	const starIndex = new Map(leg.stars.map(([r, c], i) => [r * leg.cols + c, i] as const));
	const full = (1 << leg.stars.length) - 1;
	// A node: entering cell `index` heading `dir` (0-3), with the star marks passed so far.
	const key = (index: number, dir: number, marks: number) => (index * 4 + dir) * (full + 1) + marks;
	const best = new Map<number, number>();
	const open: [number, number, number, number][] = []; // cost, index, dir, marks
	const start = leg.map.join("").indexOf("S");
	const push = (cost: number, row: number, col: number, heading: number, marks: number) => {
		if (row < 0 || col < 0 || row >= leg.rows || col >= leg.cols) return;
		const index = row * leg.cols + col;
		const dir = DIRS.indexOf(heading as (typeof DIRS)[number]);
		const k = key(index, dir, marks);
		if ((best.get(k) ?? Infinity) <= cost) return;
		best.set(k, cost);
		open.push([cost, index, dir, marks]);
	};
	const startHeading = SIDES[leg.startSide];
	push(0, Math.floor(start / leg.cols) + STEP_ROW[startHeading], (start % leg.cols) + STEP_COL[startHeading], startHeading, 0);
	while (open.length) {
		open.sort((a, b) => a[0] - b[0]);
		const [cost, index, dir, entryMarks] = open.shift()!;
		if (cost > (best.get(key(index, dir, entryMarks)) ?? Infinity)) continue;
		const cell = cells[index];
		const heading = DIRS[dir];
		const enter = OPPOSITE[heading];
		const marks = starIndex.has(index) ? entryMarks | (1 << starIndex.get(index)!) : entryMarks;
		const row = Math.floor(index / leg.cols);
		const col = index % leg.cols;
		if (cell.kind === "goal") {
			if (marks === full) return cost;
			continue;
		}
		if (cell.kind === "city") {
			if (!leg.avoidCity) push(cost, row + STEP_ROW[heading], col + STEP_COL[heading], heading, marks);
			continue;
		}
		if (!isTurnable(cell)) continue;
		for (const out of DIRS) {
			if (out === enter) continue;
			const k = turnsToOpen(cell.kind, cell.rot, enter | out);
			if (k >= 0) push(cost + k, row + STEP_ROW[out], col + STEP_COL[out], out, marks);
		}
	}
	return Infinity;
}

function legStart(leg: ChartLeg, rng: { seed: number }): number[] {
	const size = leg.cols * leg.rows;
	for (let attempt = 0; attempt < 2000; attempt++) {
		const rotations = Array.from({ length: size }, () => Math.floor(random(rng) * 4));
		const cells = legCells(leg, rotations);
		const fewest = fewestTurns(leg, cells);
		// Never already joined up (even the wrong way), never quicker than the leg's floor, never a slog.
		if (fewest >= leg.minTurns && roadTurns(cells) <= leg.minTurns + 9 && !traceRoute(leg, cells).reaches) return rotations;
	}
	// Unreachable in practice (the tests try thousands of seeds): every road tile a turn short of its place.
	return legCells(leg, new Array(size).fill(0)).map((cell) => (cell.road ? (turnsToOpen(cell.kind, 0, cell.road) + 3) % 4 : 0));
}

function enterLeg(state: ChartState, leg: number) {
	const def = CHART_LEGS[leg];
	state.leg = leg;
	state.cells = legCells(def, state.starts[leg]);
	state.par = roadTurns(state.cells);
	state.legTurns = 0;
	state.nightTotal = state.par + CHART_NIGHT_SPARE_TURNS + Math.ceil(state.par * CHART_NIGHT_SPARE_SHARE);
	state.night = state.nightTotal;
	state.history = [];
	state.queue = [];
	state.busy = 0;
	state.turning = -1;
	state.travel = 0;
	state.astray = null;
	state.phase = "charting";
	retrace(state, undefined);
}

export function newChart(seed: number): ChartState {
	const rng = { seed: seed | 0 };
	const starts = CHART_LEGS.map((leg) => legStart(leg, rng));
	const state: ChartState = {
		seed: rng.seed,
		phase: "charting",
		t: 0,
		leg: 0,
		cells: [],
		starts,
		night: 0,
		nightTotal: 0,
		legTurns: 0,
		par: 0,
		turns: 0,
		hints: 0,
		extra: 0,
		queue: [],
		busy: 0,
		turning: -1,
		history: [],
		route: [],
		reaches: false,
		travel: 0,
		astray: null,
	};
	enterLeg(state, 0);
	return state;
}

/** The next tile of the leg's own road, from the start, that is not yet in place; -1 when all are. */
export function hintCell(state: Pick<ChartState, "leg" | "cells">): number {
	const def = CHART_LEGS[state.leg];
	const start = def.map.join("").indexOf("S");
	let row = Math.floor(start / def.cols);
	let col = start % def.cols;
	let heading = SIDES[def.startSide];
	for (let guard = 0; guard < state.cells.length; guard++) {
		row += STEP_ROW[heading];
		col += STEP_COL[heading];
		const index = row * def.cols + col;
		const cell = state.cells[index];
		if (!cell || !cell.road) return -1;
		if (turnsToOpen(cell.kind, cell.rot, cell.road) !== 0) return index;
		heading = cell.road & ~OPPOSITE[heading];
	}
	return -1;
}

function retrace(state: ChartState, events: ChartEvent[] | undefined) {
	const def = CHART_LEGS[state.leg];
	const traced = traceRoute(def, state.cells);
	state.route = traced.route;
	state.reaches = traced.reaches;
	const astray = traced.reaches ? legRules(def, traced.route) : null;
	if (astray && astray !== state.astray) events?.push({ type: "astray", reason: astray });
	state.astray = astray;
}

function apply(state: ChartState, action: ChartAction, events: ChartEvent[] | undefined) {
	if (action.type === "turn") {
		const cell = state.cells[action.cell];
		if (!cell || !isTurnable(cell)) return;
		cell.rot = (cell.rot + 1) % 4;
		cell.spin += 1;
		state.turns += 1;
		state.legTurns += 1;
		state.night = Math.max(0, state.night - 1);
		state.history.push(action.cell);
		state.busy = CHART_TURN_SECONDS;
		state.turning = action.cell;
		events?.push({ type: "turn", cell: action.cell });
	} else if (action.type === "undo") {
		const index = state.history.pop();
		if (index === undefined) return;
		const cell = state.cells[index];
		cell.rot = (cell.rot + 3) % 4;
		cell.spin -= 1;
		state.busy = CHART_TURN_SECONDS;
		state.turning = index;
		events?.push({ type: "undo", cell: index });
	} else if (action.type === "hint") {
		const index = hintCell(state);
		if (index < 0) return;
		const cell = state.cells[index];
		const k = turnsToOpen(cell.kind, cell.rot, cell.road);
		cell.rot = (cell.rot + k) % 4;
		cell.spin += k;
		state.hints += 1;
		// Undo would now turn tiles out from under the hint, so it starts over from here.
		state.history = [];
		state.busy = CHART_HINT_SECONDS;
		state.turning = index;
		events?.push({ type: "hint", cell: index });
	}
	retrace(state, events);
}

/** One fixed step. `actions` are this step's presses, queued behind the turn in hand. */
export function stepChart(state: ChartState, actions: readonly ChartAction[] = [], events?: ChartEvent[]): void {
	if (state.phase === "between") {
		if (actions.some((action) => action.type === "next")) {
			enterLeg(state, state.leg + 1);
			events?.push({ type: "next", leg: state.leg });
		}
		return;
	}
	if (state.phase === "dawn" || state.phase === "done") return;

	state.t += CHART_STEP;
	if (state.phase === "travelling") {
		state.travel += CHART_STEP;
		if (state.travel >= CHART_TRAVEL_SECONDS) {
			state.travel = CHART_TRAVEL_SECONDS;
			events?.push({ type: "charted", leg: state.leg });
			if (state.leg === CHART_LEG_COUNT - 1) {
				state.phase = "done";
				events?.push({ type: "finished" });
			} else state.phase = "between";
		}
		return;
	}

	for (const action of actions) {
		if (action.type !== "next" && state.queue.length < QUEUE_LIMIT) state.queue.push(action);
	}
	state.night = Math.max(0, state.night - CHART_STEP / CHART_NIGHT_SECONDS_PER_TURN);
	if (state.busy > 0) {
		state.busy = Math.max(0, state.busy - CHART_STEP);
		if (state.busy > 1e-9) return;
		state.busy = 0;
		state.turning = -1;
	}
	// The tile in hand has settled: is the road charted?
	if (state.reaches && !state.astray) {
		state.phase = "travelling";
		state.travel = 0;
		state.queue = [];
		state.extra += Math.max(0, state.legTurns - state.par);
		events?.push({ type: "connected", leg: state.leg });
		return;
	}
	if (state.night <= 0) {
		state.phase = "dawn";
		state.queue = [];
		events?.push({ type: "dawn", leg: state.leg });
		return;
	}
	const action = state.queue.shift();
	if (action) apply(state, action, events);
}

/** The finished chart as the award records it, or null until the last leg is walked. */
export function chartResult(state: ChartState): ChartResult | null {
	if (state.phase !== "done") return null;
	const kept = 100 - CHART_EXTRA_TURN_COST * state.extra - CHART_HINT_COST * state.hints;
	return {
		faithKept: Math.max(0, Math.min(100, Math.round(kept))),
		seconds: Math.round(state.t * 10) / 10,
		swellsCleared: Math.min(500, state.turns),
	};
}
