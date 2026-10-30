/**
 * Go and Shew John (LC-17908, docs/beta/games.md), Matthew 11:2-6: John,
 * in the prison, sends two of his disciples: "Art thou he that should come,
 * or do we look for another?" Jesus answers, "Go and shew John again those
 * things which ye do hear and see: The blind receive their sight, and the
 * lame walk, the lepers are cleansed, and the deaf hear, the dead are raised
 * up, and the poor have the gospel preached to them" (11:3-5). A flip-pairs
 * memory game (Concentration).
 *
 * Twelve cards in a four-by-three grid are six pairs, each a subject of 11:5
 * and its work ("The blind" and "receive their sight"), at places random per
 * seed. They lie face up for a moment, then face down. Turn two over: a pair
 * stays up (that work is shewn); two that differ turn back after a moment,
 * and nothing can be turned while they show. The round is won when all six
 * are shewn and lost when the time runs out. Pure and seeded so the tests
 * play it; no imports (Node's type stripping loads it).
 */

export const SHEW_STEP = 1 / 60;
export const SHEW_SECONDS = 15;
export const SHEW_COLUMNS = 4;
export const SHEW_ROWS = 3;
export const SHEW_CARDS = SHEW_COLUMNS * SHEW_ROWS;
/** Ticks every card lies face up before the round's first turn. */
export const SHEW_PREVIEW = 72;
/** Ticks a card takes to turn over. */
export const SHEW_FLIP = 12;
/** Turns closer together than this count once. */
export const SHEW_GAP = 8;
/** Ticks two cards that differ stay up before they turn back. */
export const SHEW_MISS_SHOW = 45;
/** The fastest a round can be won: every card turned the moment it can be, each pair together. */
export const SHEW_MIN_SECONDS = (SHEW_PREVIEW + SHEW_FLIP + (SHEW_CARDS - 1) * SHEW_GAP) / 60;

/** The six works of 11:5, each a subject and what is done, in the KJV's words and order. */
export const SHEW_WORKS: readonly { subject: string; work: string }[] = [
	{ subject: "The blind", work: "receive their sight" },
	{ subject: "the lame", work: "walk" },
	{ subject: "the lepers", work: "are cleansed" },
	{ subject: "the deaf", work: "hear" },
	{ subject: "the dead", work: "are raised up" },
	{ subject: "the poor", work: "have the gospel preached to them" },
];

/** Card centres in the 400 x 400 stage, by place (row by row), and their size. */
export const SHEW_CARD_W = 88;
export const SHEW_CARD_H = 100;
export const SHEW_PLACES: readonly { x: number; y: number }[] = Array.from({ length: SHEW_CARDS }, (_, place) => ({
	x: 56 + (place % SHEW_COLUMNS) * 96,
	y: 128 + Math.floor(place / SHEW_COLUMNS) * 108,
}));

export interface ShewCard {
	/** Which work of 11:5, 0-5. */
	pair: number;
	/** 0 the subject ("The blind"), 1 the work ("receive their sight"). */
	half: 0 | 1;
	up: boolean;
	matched: boolean;
	/** The tick it last turned (either way), for the turning picture. */
	turnedAt: number;
}

export interface ShewState {
	tick: number;
	t: number;
	rng: number;
	cards: ShewCard[];
	/** The keyboard's highlighted place. */
	cursor: number;
	/** Places turned up and not yet matched (at most two). */
	open: number[];
	/** Two that differ show until this tick. */
	lockUntil: number;
	lastTurn: number;
	/** Pairs shewn, in the order they were found. */
	shewn: number[];
	turns: number;
	misses: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type ShewEvent =
	| { type: "cover" }
	| { type: "move"; place: number }
	| { type: "turn"; place: number }
	| { type: "match"; pair: number; places: [number, number] }
	| { type: "miss"; places: [number, number] }
	| { type: "hide"; places: [number, number] }
	| { type: "won" }
	| { type: "lost" };

export type ShewMove = "left" | "right" | "up" | "down";

/** Move the highlight, turn the highlighted card (Space), or turn a card by place (a tap). */
export interface ShewInput {
	move?: ShewMove | null;
	turn?: boolean;
	place?: number | null;
}

function nextRandom(state: ShewState): number {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newShew(seed: number): ShewState {
	const state: ShewState = {
		tick: 0,
		t: 0,
		rng: seed >>> 0 || 1,
		cards: [],
		cursor: 0,
		open: [],
		lockUntil: 0,
		lastTurn: -999,
		shewn: [],
		turns: 0,
		misses: 0,
		phase: "playing",
		endedAt: null,
	};
	const deck: ShewCard[] = [];
	for (let pair = 0; pair < SHEW_WORKS.length; pair++) for (const half of [0, 1] as const) deck.push({ pair, half, up: false, matched: false, turnedAt: -999 });
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(nextRandom(state) * (i + 1));
		[deck[i], deck[j]] = [deck[j], deck[i]];
	}
	state.cards = deck;
	return state;
}

/** True while every card still lies face up at the start. */
export function shewPreviewing(state: ShewState): boolean {
	return state.tick < SHEW_PREVIEW;
}

/** True once cards can be turned: the preview is over and nothing is showing a miss. */
export function shewCanTurn(state: ShewState, tick = state.tick + 1): boolean {
	return state.phase === "playing" && tick >= SHEW_PREVIEW + SHEW_FLIP && state.open.length < 2 && tick - state.lastTurn >= SHEW_GAP;
}

/** How far a card shows its face, 0 (down) to 1 (up), for the turning picture. */
export function shewFace(state: ShewState, place: number, tick = state.tick): number {
	const card = state.cards[place];
	if (tick < SHEW_PREVIEW) return 1;
	if (tick < SHEW_PREVIEW + SHEW_FLIP && !card.up && card.turnedAt < SHEW_PREVIEW) return 1 - (tick - SHEW_PREVIEW) / SHEW_FLIP;
	const k = Math.min(1, (tick - card.turnedAt) / SHEW_FLIP);
	return card.up || card.matched ? k : 1 - k;
}

/** The card's place under a point of the stage, or null. */
export function shewPlaceAt(x: number, y: number): number | null {
	const index = SHEW_PLACES.findIndex((at) => Math.abs(x - at.x) <= SHEW_CARD_W / 2 + 4 && Math.abs(y - at.y) <= SHEW_CARD_H / 2 + 4);
	return index >= 0 ? index : null;
}

export function shewLeft(state: ShewState): number {
	return Math.max(0, SHEW_SECONDS - (state.endedAt ?? state.t));
}

export function stepShew(state: ShewState, input: ShewInput, events: ShewEvent[] = []): ShewState {
	if (state.phase !== "playing") return state;
	state.tick += 1;
	state.t = state.tick / 60;
	if (state.tick === SHEW_PREVIEW) events.push({ type: "cover" });
	// Two that differ turn back.
	if (state.open.length === 2 && state.tick >= state.lockUntil) {
		const places = state.open as [number, number];
		for (const place of places) {
			state.cards[place].up = false;
			state.cards[place].turnedAt = state.tick;
		}
		state.open = [];
		events.push({ type: "hide", places });
	}
	if (input.move) {
		const column = state.cursor % SHEW_COLUMNS;
		const row = Math.floor(state.cursor / SHEW_COLUMNS);
		const next =
			input.move === "left"
				? row * SHEW_COLUMNS + Math.max(0, column - 1)
				: input.move === "right"
					? row * SHEW_COLUMNS + Math.min(SHEW_COLUMNS - 1, column + 1)
					: input.move === "up"
						? Math.max(0, row - 1) * SHEW_COLUMNS + column
						: Math.min(SHEW_ROWS - 1, row + 1) * SHEW_COLUMNS + column;
		if (next !== state.cursor) {
			state.cursor = next;
			events.push({ type: "move", place: next });
		}
	}
	let place: number | null = null;
	if (input.place !== undefined && input.place !== null && input.place >= 0 && input.place < SHEW_CARDS) {
		place = input.place;
		state.cursor = place;
	} else if (input.turn) place = state.cursor;
	if (place !== null && shewCanTurn(state, state.tick)) {
		const card = state.cards[place];
		if (!card.up && !card.matched) {
			card.up = true;
			card.turnedAt = state.tick;
			state.lastTurn = state.tick;
			state.turns += 1;
			state.open.push(place);
			events.push({ type: "turn", place });
			if (state.open.length === 2) {
				const [a, b] = state.open as [number, number];
				if (state.cards[a].pair === state.cards[b].pair) {
					state.cards[a].matched = true;
					state.cards[b].matched = true;
					state.open = [];
					state.shewn.push(card.pair);
					events.push({ type: "match", pair: card.pair, places: [a, b] });
					if (state.shewn.length === SHEW_WORKS.length) {
						state.phase = "won";
						state.endedAt = state.t;
						events.push({ type: "won" });
						return state;
					}
				} else {
					state.misses += 1;
					state.lockUntil = state.tick + SHEW_MISS_SHOW;
					events.push({ type: "miss", places: [a, b] });
				}
			}
		}
	}
	if (state.t >= SHEW_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: few misses and quick is a higher score. */
export function shewResult(state: ShewState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 104 - state.misses * 5 - Math.max(0, state.endedAt - 7) * 5))) : 0;
	return { won: state.phase === "won", score, count: state.shewn.length, seconds };
}
