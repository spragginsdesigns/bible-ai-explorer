/**
 * The Wedding Garment (LC-17851, docs/beta/games.md), Matthew 22:1-14: "Go ye
 * therefore into the highways, and as many as ye shall find, bid to the
 * marriage" (v9), both bad and good (v10); and the guest "which had not on a
 * wedding garment" (v11). Pure and seeded so the tests play it; no imports
 * (Node's type stripping loads it).
 *
 * Guests stream in from four highways toward the door of the wedding hall.
 * Some come in drab road clothes: a tap clothes one in a white wedding
 * garment. Tapping a guest already clothed is a mistake. Two guests reaching
 * the door unclothed, or three mistakes, and the round is lost.
 */

export const WEDDING_STEP = 1 / 60;
export const WEDDING_SECONDS = 15;
/** A round is only won by keeping the door to the end. */
export const WEDDING_MIN_SECONDS = WEDDING_SECONDS;
/** Guests reaching the door without a garment that end the round. */
export const WEDDING_UNCLOTHED_LIMIT = 2;
/** Mistakes (tapping a guest already clothed) that end the round. */
export const WEDDING_MISTAKE_LIMIT = 3;
/** How near (in stage units) a tap must land to a guest. */
export const WEDDING_REACH = 30;
/** The share of guests who come in road clothes. */
export const WEDDING_DRAB = 0.62;

/** The hall's door, where every highway ends. */
export const WEDDING_DOOR = { x: 200, y: 150 } as const;
/** Where the four highways come in from. */
export const WEDDING_HIGHWAYS: readonly { x: number; y: number }[] = [
	{ x: -24, y: 292 },
	{ x: 92, y: 424 },
	{ x: 308, y: 424 },
	{ x: 424, y: 292 },
];

export interface WeddingGuest {
	id: number;
	highway: number;
	/** Distance walked along the highway, and its whole length. */
	along: number;
	length: number;
	speed: number;
	/** Came in road clothes. */
	drab: boolean;
	/** When the player clothed him, if they did. */
	clothedAt: number | null;
	/** A look of his own (skin, cloak colour, hat): an index the stage reads. */
	look: number;
}

export interface WeddingState {
	t: number;
	guests: WeddingGuest[];
	nextGuest: number;
	nextId: number;
	clothed: number;
	welcomed: number;
	unclothed: number;
	mistakes: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	rng: number;
}

export type WeddingEvent =
	| { type: "arrive"; highway: number }
	| { type: "clothe"; x: number; y: number }
	| { type: "mistake"; x: number; y: number }
	| { type: "miss"; x: number; y: number }
	| { type: "welcome"; clothedByPlayer: boolean }
	| { type: "unclothed" }
	| { type: "won" }
	| { type: "lost" };

/** One step of the seeded generator, kept in the state so a round replays exactly. */
function nextRandom(state: { rng: number }) {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function progress(t: number) {
	return Math.min(1, t / WEDDING_SECONDS);
}

function addGuest(state: WeddingState, events: WeddingEvent[]) {
	const p = progress(state.t);
	const highway = Math.floor(nextRandom(state) * WEDDING_HIGHWAYS.length);
	const from = WEDDING_HIGHWAYS[highway];
	const drab = nextRandom(state) < WEDDING_DRAB;
	state.guests.push({
		id: state.nextId++,
		highway,
		along: 0,
		length: Math.hypot(WEDDING_DOOR.x - from.x, WEDDING_DOOR.y - from.y),
		speed: (88 + 72 * p) * (0.9 + nextRandom(state) * 0.2),
		drab,
		clothedAt: null,
		look: Math.floor(nextRandom(state) * 8),
	});
	events.push({ type: "arrive", highway });
}

export function newWedding(seed: number): WeddingState {
	const state: WeddingState = { t: 0, guests: [], nextGuest: 0, nextId: 1, clothed: 0, welcomed: 0, unclothed: 0, mistakes: 0, phase: "playing", endedAt: null, rng: seed >>> 0 || 1 };
	state.nextGuest = 0.3 + nextRandom(state) * 0.3;
	return state;
}

/** A guest's feet on the highway and his size (nearer the door is farther away, so smaller). */
export function guestAt(guest: WeddingGuest) {
	const from = WEDDING_HIGHWAYS[guest.highway];
	const f = Math.min(1, guest.along / guest.length);
	const x = from.x + (WEDDING_DOOR.x - from.x) * f;
	const y = from.y + (WEDDING_DOOR.y - from.y) * f;
	const scale = 0.72 + 0.6 * Math.max(0, Math.min(1, (y - WEDDING_DOOR.y) / 270));
	return { x, y, scale, cx: x, cy: y - 24 * scale };
}

export function isClothed(guest: WeddingGuest) {
	return !guest.drab || guest.clothedAt !== null;
}

export function stepWedding(state: WeddingState, input: { taps: { x: number; y: number }[] }, events: WeddingEvent[] = []): WeddingState {
	if (state.phase !== "playing") return state;
	const dt = WEDDING_STEP;
	for (const tap of input.taps) {
		let best: WeddingGuest | null = null;
		let bestDistance = WEDDING_REACH;
		for (const guest of state.guests) {
			const at = guestAt(guest);
			const distance = Math.hypot(at.cx - tap.x, at.cy - tap.y);
			if (distance <= bestDistance) {
				best = guest;
				bestDistance = distance;
			}
		}
		if (!best) {
			events.push({ type: "miss", x: tap.x, y: tap.y });
			continue;
		}
		const at = guestAt(best);
		if (isClothed(best)) {
			state.mistakes += 1;
			events.push({ type: "mistake", x: at.cx, y: at.cy });
		} else {
			best.clothedAt = state.t;
			state.clothed += 1;
			events.push({ type: "clothe", x: at.cx, y: at.cy });
		}
	}
	state.t += dt;
	while (state.t >= state.nextGuest - 1e-9) {
		const p = progress(state.t);
		addGuest(state, events);
		state.nextGuest += (0.52 + (0.21 - 0.52) * p) * (0.75 + nextRandom(state) * 0.5);
	}
	for (const guest of [...state.guests]) {
		guest.along += guest.speed * dt;
		if (guest.along < guest.length) continue;
		state.guests = state.guests.filter((item) => item !== guest);
		if (isClothed(guest)) {
			state.welcomed += 1;
			events.push({ type: "welcome", clothedByPlayer: guest.clothedAt !== null });
		} else {
			state.unclothed += 1;
			events.push({ type: "unclothed" });
		}
	}
	if (state.unclothed >= WEDDING_UNCLOTHED_LIMIT || state.mistakes >= WEDDING_MISTAKE_LIMIT) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	} else if (state.t >= WEDDING_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "won" });
	}
	return state;
}

/** The round's result once it has ended: every guest clothed with no mistakes is a perfect score. */
export function weddingResult(state: WeddingState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.unclothed * 32 - state.mistakes * 16))) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.clothed), seconds };
}
