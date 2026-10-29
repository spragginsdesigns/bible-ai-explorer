/**
 * The Generations (LC-17851, docs/beta/games.md), Matthew 1:1-17: who begat
 * whom. The prompt reads "<Name> begat …" and three or four name tablets
 * float and shuffle; tap the next name in the line. A run of eight links
 * from a random point in the line must be kept within the round; a wrong
 * name costs time and crumbles away. Pure and seeded so the tests play it; no imports (Node's
 * type stripping loads it).
 */

export const GENERATIONS_STEP = 1 / 60;
export const GENERATIONS_SECONDS = 15;
/** Links in a run. */
export const GENERATIONS_LINKS = 8;
/** Ticks the tablets take to float in; they cannot be taken before. */
export const GENERATIONS_ARRIVE_TICKS = 30;
/** Ticks a shuffle takes to carry two tablets across. */
export const GENERATIONS_SWAP_TICKS = 18;
/** Seconds a wrong name costs. */
export const GENERATIONS_PENALTY = 1.2;
/** The fastest a round can be won: every link taken the moment its tablets land. */
export const GENERATIONS_MIN_SECONDS = (GENERATIONS_LINKS * GENERATIONS_ARRIVE_TICKS) / 60;

/**
 * The line of Matthew 1:2-16, in the KJV's spellings and order, from Abraham
 * to Joseph the husband of Mary, "of whom was born Jesus, who is called
 * Christ" (v16). Jacob appears twice (v2 and v15-16). The tests check it
 * against the bundled KJV.
 */
export const GENERATIONS_LINE = [
	"Abraham",
	"Isaac",
	"Jacob",
	"Judas",
	"Phares",
	"Esrom",
	"Aram",
	"Aminadab",
	"Naasson",
	"Salmon",
	"Booz",
	"Obed",
	"Jesse",
	"David",
	"Solomon",
	"Roboam",
	"Abia",
	"Asa",
	"Josaphat",
	"Joram",
	"Ozias",
	"Joatham",
	"Achaz",
	"Ezekias",
	"Manasses",
	"Amon",
	"Josias",
	"Jechonias",
	"Salathiel",
	"Zorobabel",
	"Abiud",
	"Eliakim",
	"Azor",
	"Sadoc",
	"Achim",
	"Eliud",
	"Eleazar",
	"Matthan",
	"Jacob",
	"Joseph",
] as const;

/** Where the tablets float: four places in a two-by-two field. */
export const GENERATIONS_SLOTS: readonly { x: number; y: number }[] = [
	{ x: 108, y: 232 },
	{ x: 292, y: 232 },
	{ x: 108, y: 334 },
	{ x: 292, y: 334 },
];
export const GENERATIONS_TILE_W = 164;
export const GENERATIONS_TILE_H = 74;

export interface GenerationsTile {
	name: string;
	correct: boolean;
	/** The place it is in, and the place it is leaving (equal when still). */
	slot: number;
	from: number;
	/** The tick its last move started. */
	movedAt: number;
	/** A wrong name, once taken, crumbles away (the tick it was taken). */
	gone: number | null;
}

export interface GenerationsState {
	tick: number;
	t: number;
	rng: number;
	/** Index in the line of the run's first name. */
	start: number;
	/** Links kept so far. */
	link: number;
	tiles: GenerationsTile[];
	/** The tick this link's tablets started floating in. */
	arrivedAt: number;
	nextSwap: number;
	penalty: number;
	mistakes: number;
	/** The last wrong tablet and when, for the shake. */
	wrong: { name: string; tick: number } | null;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type GenerationsEvent = { type: "right"; name: string } | { type: "wrong"; name: string } | { type: "shuffle" } | { type: "won" } | { type: "lost" };

/** Tap a point of the stage, or pick a place 0-3 (number keys). */
export interface GenerationsInput {
	tap?: { x: number; y: number } | null;
	slot?: number | null;
}

function nextRandom(state: GenerationsState): number {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The name the current link asks about and the one that answers it. */
export function generationsPrompt(state: GenerationsState): { name: string; answer: string; index: number } {
	const index = state.start + Math.min(state.link, GENERATIONS_LINKS - 1);
	return { name: GENERATIONS_LINE[index], answer: GENERATIONS_LINE[index + 1], index };
}

function shuffleIn<T>(state: GenerationsState, items: T[]): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(nextRandom(state) * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

function deal(state: GenerationsState) {
	const { index, name, answer } = generationsPrompt(state);
	// Every name that ever follows the prompt's name (Jacob begat Judas, and Jacob begat Joseph) is never a decoy.
	const followers = new Set<string>();
	GENERATIONS_LINE.forEach((item, at) => {
		if (item === name && at + 1 < GENERATIONS_LINE.length) followers.add(GENERATIONS_LINE[at + 1]);
	});
	const near: string[] = [];
	for (let at = Math.max(0, index - 5); at <= Math.min(GENERATIONS_LINE.length - 1, index + 6); at++) {
		const item = GENERATIONS_LINE[at];
		if (item === name || item === answer || followers.has(item) || near.includes(item)) continue;
		near.push(item);
	}
	const grandchild = GENERATIONS_LINE[index + 2];
	const count = state.link < 3 ? 3 : 4;
	const decoys: string[] = [];
	if (grandchild && near.includes(grandchild) && nextRandom(state) < 0.65) decoys.push(grandchild);
	for (const item of shuffleIn(state, near.filter((item) => item !== grandchild))) {
		if (decoys.length >= count - 1) break;
		decoys.push(item);
	}
	const slots = shuffleIn(state, [0, 1, 2, 3]);
	const names = shuffleIn(state, [answer, ...decoys]);
	state.tiles = names.map((item, at) => ({ name: item, correct: item === answer, slot: slots[at], from: slots[at], movedAt: -999, gone: null }));
	state.arrivedAt = state.tick;
	state.nextSwap = state.tick + GENERATIONS_ARRIVE_TICKS + 30 + Math.floor(nextRandom(state) * 18);
}

export function newGenerations(seed: number): GenerationsState {
	const state: GenerationsState = {
		tick: 0,
		t: 0,
		rng: seed >>> 0 || 1,
		start: 0,
		link: 0,
		tiles: [],
		arrivedAt: 0,
		nextSwap: 0,
		penalty: 0,
		mistakes: 0,
		wrong: null,
		phase: "playing",
		endedAt: null,
	};
	state.start = Math.floor(nextRandom(state) * (GENERATIONS_LINE.length - GENERATIONS_LINKS));
	deal(state);
	return state;
}

/** True once this link's tablets have landed and can be taken. */
export function generationsReady(state: GenerationsState): boolean {
	return state.tick - state.arrivedAt >= GENERATIONS_ARRIVE_TICKS;
}

/** Where a tablet is now, carried along a shuffle (eased). */
export function generationsTilePosition(state: GenerationsState, tile: GenerationsTile, tick = state.tick): { x: number; y: number } {
	const to = GENERATIONS_SLOTS[tile.slot];
	const from = GENERATIONS_SLOTS[tile.from];
	const k = Math.max(0, Math.min(1, (tick - tile.movedAt) / GENERATIONS_SWAP_TICKS));
	const e = k * k * (3 - 2 * k);
	return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

/** Seconds left on the clock, wrong names taken off. */
export function generationsLeft(state: GenerationsState): number {
	return Math.max(0, GENERATIONS_SECONDS - state.t - state.penalty);
}

function tileAt(state: GenerationsState, input: GenerationsInput): GenerationsTile | null {
	if (input.slot !== undefined && input.slot !== null) return state.tiles.find((tile) => tile.slot === input.slot && tile.gone === null) ?? null;
	if (!input.tap) return null;
	const { x, y } = input.tap;
	let best: GenerationsTile | null = null;
	let bestDistance = Infinity;
	for (const tile of state.tiles) {
		if (tile.gone !== null) continue;
		const at = generationsTilePosition(state, tile);
		const dx = Math.abs(x - at.x);
		const dy = Math.abs(y - at.y);
		if (dx <= GENERATIONS_TILE_W / 2 + 4 && dy <= GENERATIONS_TILE_H / 2 + 4 && dx + dy < bestDistance) {
			best = tile;
			bestDistance = dx + dy;
		}
	}
	return best;
}

export function stepGenerations(state: GenerationsState, input: GenerationsInput, events: GenerationsEvent[] = []): GenerationsState {
	if (state.phase !== "playing") return state;
	state.tick += 1;
	state.t = state.tick / 60;
	if (generationsReady(state)) {
		const tile = tileAt(state, input);
		if (tile && tile.correct) {
			state.link += 1;
			events.push({ type: "right", name: tile.name });
			if (state.link >= GENERATIONS_LINKS) {
				state.phase = "won";
				state.endedAt = state.t;
				events.push({ type: "won" });
				return state;
			}
			deal(state);
		} else if (tile) {
			state.penalty += GENERATIONS_PENALTY;
			state.mistakes += 1;
			state.wrong = { name: tile.name, tick: state.tick };
			tile.gone = state.tick;
			events.push({ type: "wrong", name: tile.name });
		}
		// The tablets shuffle: two places trade, faster as the line goes on.
		if (state.tick >= state.nextSwap) {
			const a = Math.floor(nextRandom(state) * 4);
			const b = (a + 1 + Math.floor(nextRandom(state) * 3)) % 4;
			for (const item of state.tiles) {
				if (item.slot !== a && item.slot !== b) continue;
				const here = generationsTilePosition(state, item);
				const nearest = GENERATIONS_SLOTS.findIndex((slot) => Math.abs(slot.x - here.x) < 1 && Math.abs(slot.y - here.y) < 1);
				item.from = nearest >= 0 ? nearest : item.slot;
				item.slot = item.slot === a ? b : a;
				item.movedAt = state.tick;
			}
			events.push({ type: "shuffle" });
			state.nextSwap = state.tick + GENERATIONS_SWAP_TICKS + Math.max(14, 40 - state.link * 3) + Math.floor(nextRandom(state) * 14);
		}
	}
	if (GENERATIONS_SECONDS - state.t - state.penalty <= 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: quick and true is a higher score. */
export function generationsResult(state: GenerationsState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.mistakes * 12 - Math.max(0, state.endedAt - 7) * 6))) : 0;
	return { won: state.phase === "won", score, count: state.link, seconds };
}
