/**
 * The Last Shall Be First (LC-17908, docs/beta/games.md), Matthew 20:1-16:
 * the householder hires labourers early in the morning, about the third
 * hour, the sixth, the ninth and the eleventh (vv1-7). "So when even was
 * come, the lord of the vineyard saith unto his steward, Call the labourers,
 * and give them their hire, beginning from the last unto the first" (v8), and
 * they received every man a penny (vv9-10). Pure and seeded so the tests play
 * it; no imports (Node's type stripping loads it).
 *
 * A line of labourers stands before the steward in a jumbled order, each
 * with the sign of the hour he was hired. Put the line in order from the last
 * unto the first, the eleventh hour at the front by the steward and the early
 * at the back, by swapping two at a time: choose one, then another, and they
 * change places. When the line is right the steward pays every man a penny
 * and a longer line comes: four, then five, then six (two of the six share an
 * hour, and either of them may stand first). Each line's fewest swaps are
 * worked out when it is laid, so swaps beyond them are known.
 */

export const LAST_STEP = 1 / 60;
/** The round's length. */
export const LAST_SECONDS = 16;
/** The hours, in the order they were hired (v1, v3, v5, v6): rank 0 is early, 4 the eleventh hour. */
export const LAST_HOURS = ["early", "third", "sixth", "ninth", "eleventh"] as const;
/** The lines of a round: how many labourers, and the fewest swaps each may need. */
export const LAST_LINES: readonly { men: number; minSwaps: number; maxSwaps: number }[] = [
	{ men: 4, minSwaps: 2, maxSwaps: 2 },
	{ men: 5, minSwaps: 2, maxSwaps: 3 },
	{ men: 6, minSwaps: 3, maxSwaps: 3 },
];
/** Two men take this long to change places; a choice made meanwhile waits for them (one at most). */
export const LAST_SWAP_GAP = 0.2;
/** How long the steward takes to pay a line before the next one comes. */
export const LAST_PAY = 1.1;
/**
 * The fastest a round can be won: each line's fewest swaps, the first the
 * moment the line comes and each other one as soon as the last has swapped,
 * and every line but the last paid before the next.
 */
export const LAST_MIN_SECONDS =
	Math.floor((LAST_LINES.reduce((sum, line) => sum + (line.minSwaps - 1) * LAST_SWAP_GAP, 0) + (LAST_LINES.length - 1) * LAST_PAY) * 10 + 1e-6) / 10;

export interface Labourer {
	/** Who he is, for the picture: the same man keeps his id as he moves. */
	id: number;
	/** The hour he was hired, 0 (early) to 4 (eleventh). */
	hour: number;
}

export interface LastState {
	t: number;
	/** The line being put in order, and every line of the round as it first stood. */
	line: number;
	lines: Labourer[][];
	/** The line as it stands now, front (by the steward) first. */
	men: Labourer[];
	/** The man chosen first, waiting for the second. */
	picked: number | null;
	/** A choice made while two men change places, done when they have. */
	queued: number | null;
	lastSwap: number;
	/** Every swap in the round, and the fewest swaps of the lines paid so far. */
	swaps: number;
	needed: number;
	paid: number;
	/** While the steward pays a line, when the next one comes. */
	payUntil: number | null;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export interface LastInput {
	/** The place in the line (0 is the front) chosen this step. */
	select?: number;
}

export type LastEvent =
	| { type: "pick"; at: number }
	| { type: "drop"; at: number }
	| { type: "swap"; a: number; b: number; settled: number }
	| { type: "paid"; line: number }
	| { type: "next"; line: number }
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

/** The line in order: the last hired first (v8). */
export function lastTarget(hours: readonly number[]): number[] {
	return [...hours].sort((a, b) => b - a);
}

export function lastInOrder(hours: readonly number[]): boolean {
	return hours.every((hour, index) => index === 0 || hours[index - 1] >= hour);
}

/** How many men stand where they belong. */
export function lastSettled(hours: readonly number[]): number {
	const target = lastTarget(hours);
	return hours.filter((hour, index) => hour === target[index]).length;
}

/** The fewest swaps that put the line in order (a search over the line's arrangements; six men at most). */
export function lastFewestSwaps(hours: readonly number[]): number {
	const start = hours.join("");
	const goal = lastTarget(hours).join("");
	if (start === goal) return 0;
	const seen = new Set([start]);
	let frontier = [start];
	for (let depth = 1; frontier.length; depth++) {
		const next: string[] = [];
		for (const line of frontier) {
			for (let a = 0; a < line.length; a++) {
				for (let b = a + 1; b < line.length; b++) {
					if (line[a] === line[b]) continue;
					const swapped = line.slice(0, a) + line[b] + line.slice(a + 1, b) + line[a] + line.slice(b + 1);
					if (swapped === goal) return depth;
					if (!seen.has(swapped)) {
						seen.add(swapped);
						next.push(swapped);
					}
				}
			}
		}
		frontier = next;
	}
	return 0;
}

function shuffle<T>(items: T[], next: () => number): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

/** Lays one line from the seed's stream: its hours jumbled so it needs between its fewest and most swaps. */
export function layLastLine(next: () => number, spec: (typeof LAST_LINES)[number], firstId: number): Labourer[] {
	const all = [0, 1, 2, 3, 4];
	let hours: number[];
	if (spec.men <= 5) hours = shuffle([...all], next).slice(0, spec.men);
	else hours = [...all, Math.floor(next() * 5)];
	for (let attempt = 0; attempt < 1000; attempt++) {
		shuffle(hours, next);
		const swaps = lastFewestSwaps(hours);
		if (swaps >= spec.minSwaps && swaps <= spec.maxSwaps) break;
	}
	return hours.map((hour, index) => ({ id: firstId + index, hour }));
}

export function newLast(seed: number): LastState {
	const next = random(seed);
	let id = 0;
	const lines = LAST_LINES.map((spec) => {
		const line = layLastLine(next, spec, id);
		id += line.length;
		return line;
	});
	return {
		t: 0,
		line: 0,
		lines,
		men: lines[0].map((man) => ({ ...man })),
		picked: null,
		queued: null,
		lastSwap: -1,
		swaps: 0,
		needed: 0,
		paid: 0,
		payUntil: null,
		phase: "playing",
		endedAt: null,
	};
}

export function lastHours(state: LastState): number[] {
	return state.men.map((man) => man.hour);
}

/** True while the steward pays a line and choices do nothing. */
export function lastPaying(state: LastState): boolean {
	return state.payUntil !== null;
}

export function stepLast(state: LastState, input: LastInput, events: LastEvent[] = []): LastState {
	if (state.phase !== "playing") return state;
	const dt = LAST_STEP;
	let inOrder = false;
	if (state.payUntil !== null) {
		if (state.t >= state.payUntil - 1e-9) {
			state.line += 1;
			state.payUntil = null;
			state.men = state.lines[state.line].map((man) => ({ ...man }));
			events.push({ type: "next", line: state.line });
		}
	} else {
		if (input.select !== undefined && state.queued === null && input.select >= 0 && input.select < state.men.length) state.queued = input.select;
		if (state.queued !== null && state.t - state.lastSwap >= LAST_SWAP_GAP - 1e-9) {
			const at = state.queued;
			state.queued = null;
			if (state.picked === null) {
				state.picked = at;
				events.push({ type: "pick", at });
			} else if (state.picked === at) {
				state.picked = null;
				events.push({ type: "drop", at });
			} else {
				const a = state.picked;
				[state.men[a], state.men[at]] = [state.men[at], state.men[a]];
				state.picked = null;
				state.swaps += 1;
				state.lastSwap = state.t;
				events.push({ type: "swap", a, b: at, settled: lastSettled(lastHours(state)) });
				inOrder = lastInOrder(lastHours(state));
			}
		}
	}
	state.t += dt;
	if (inOrder) {
		state.paid += 1;
		state.needed += lastFewestSwaps(state.lines[state.line].map((man) => man.hour));
		state.queued = null;
		events.push({ type: "paid", line: state.line });
		if (state.line >= state.lines.length - 1) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "won" });
			return state;
		}
		state.payUntil = state.t + LAST_PAY;
	}
	if (state.t >= LAST_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: every line paid sooner, and in fewer swaps, scores higher. */
export function lastResult(state: LastState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const extra = Math.max(0, state.swaps - state.needed);
	const score = won ? Math.round(Math.max(15, Math.min(100, 100 - extra * 8 - Math.max(0, state.endedAt - 7) * 5))) : 0;
	const count = state.lines.slice(0, state.paid).reduce((sum, line) => sum + line.length, 0);
	return { won, score, count, seconds };
}
