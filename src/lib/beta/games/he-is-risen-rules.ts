/**
 * He Is Risen (LC-17908, docs/beta/games.md), Matthew 28:1-20: "He is not
 * here: for he is risen, as he said ... go quickly, and tell his disciples
 * that he is risen from the dead" (v6-7). Pure and seeded so the tests play
 * it; no imports (Node's type stripping loads it).
 *
 * A chain reaction. People walk about the garden at dawn, among them the
 * eleven disciples in twos and threes, some coming in from the edges as the
 * round begins. The player has a few tellings: each one, where it is aimed,
 * is a ring of light that grows, holds and fades; everyone it touches stops
 * and, a moment later, sends a ring of their own, passing the word on. A ring
 * that catches nobody fades away. The word must reach all eleven disciples
 * before the round ends, so the skill is where and when: wait for people to
 * gather, then tell.
 */

export const RISEN_STEP = 1 / 60;
/** How long the round runs. */
export const RISEN_SECONDS = 15;
/** Tellings the player has. */
export const RISEN_TELLINGS = 3;
export const RISEN_DISCIPLES = 11;
export const RISEN_FOLK = 20;
/** A ring grows to its full size, holds it, then shrinks away. */
export const RISEN_RING_R = 36;
export const RISEN_GROW = 0.5;
export const RISEN_HOLD = 0.8;
export const RISEN_FADE = 0.35;
/** How long someone who hears takes to pass the word on. */
export const RISEN_PASS_DELAY = 0.22;
/** A walker's size: a ring touches them when it reaches this close. */
export const RISEN_BODY = 7;
/** Where people walk (the garden below the sepulchre and the skyline). */
export const RISEN_LEFT = 14;
export const RISEN_RIGHT = 386;
export const RISEN_TOP = 150;
export const RISEN_BOTTOM = 386;
/**
 * The disciples walk in small companies: two in the garden at the start, the
 * rest coming in from the edges, the last at RISEN_ARRIVE_LAST.
 */
export const RISEN_COMPANIES: readonly { size: number; arrive: number }[] = [
	{ size: 2, arrive: 0 },
	{ size: 2, arrive: 0 },
	{ size: 2, arrive: 0.8 },
	{ size: 2, arrive: 1.9 },
	{ size: 3, arrive: 3 },
];
export const RISEN_ARRIVE_LAST = 3;
/** How far apart companions walk. */
export const RISEN_COMPANION_GAP = 15;
/**
 * The fastest a round can be won: the last disciple only comes into the
 * garden at RISEN_ARRIVE_LAST, and nobody hears before they arrive.
 */
export const RISEN_MIN_SECONDS = RISEN_ARRIVE_LAST;

export interface Walker {
	id: number;
	disciple: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** When they come into the garden (0 for those already in it). */
	arrive: number;
	/** When they heard the word, or null. */
	told: number | null;
	/** Whether they have passed it on yet. */
	passed: boolean;
	/** How many hands the word passed through to reach them (1: told by the player). */
	depth: number;
}

export interface Ring {
	x: number;
	y: number;
	born: number;
	/** -1 for the player's telling, else the walker who passed it on. */
	by: number;
	/** The teller's depth (0 for the player). */
	depth: number;
	/** People this ring told. */
	caught: number;
}

export interface RisenState {
	t: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	tellings: number;
	walkers: Walker[];
	rings: Ring[];
	/** Disciples and others who have heard. */
	disciples: number;
	folk: number;
	/** The longest chain of passing-on (hops from a telling). */
	deepest: number;
}

export type RisenEvent =
	| { type: "tell"; x: number; y: number }
	| { type: "heard"; id: number; disciple: boolean; x: number; y: number; depth: number }
	| { type: "pass"; id: number; x: number; y: number }
	| { type: "faded"; caught: number; player: boolean }
	| { type: "arrive"; id: number }
	| { type: "won" }
	| { type: "lost" };

export interface RisenInput {
	/** Tell the word here (stage units), or nothing this step. */
	tell?: { x: number; y: number } | null;
}

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

/** A ring's radius `age` seconds after it began (0 once it has faded). */
export function ringRadius(age: number): number {
	if (age < 0) return 0;
	if (age < RISEN_GROW) {
		const u = age / RISEN_GROW;
		return RISEN_RING_R * (1 - (1 - u) * (1 - u));
	}
	if (age < RISEN_GROW + RISEN_HOLD) return RISEN_RING_R;
	const fade = (age - RISEN_GROW - RISEN_HOLD) / RISEN_FADE;
	return fade >= 1 ? 0 : RISEN_RING_R * (1 - fade);
}

export const RISEN_RING_LIFE = RISEN_GROW + RISEN_HOLD + RISEN_FADE;

/** Is this walker in the garden now (and so able to hear)? */
export function arrived(walker: Walker, t: number): boolean {
	return t >= walker.arrive - 1e-9;
}

export function newRisen(seed: number): RisenState {
	const next = random(seed);
	const walkers: Walker[] = [];
	const width = RISEN_RIGHT - RISEN_LEFT;
	const height = RISEN_BOTTOM - RISEN_TOP;
	const heading = (speed: number) => {
		const angle = next() * Math.PI * 2;
		return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
	};
	// The eleven, company by company.
	for (const company of RISEN_COMPANIES) {
		const speed = 16 + next() * 20;
		let x: number;
		let y: number;
		let angle: number;
		if (company.arrive === 0) {
			x = RISEN_LEFT + 24 + next() * (width - 48);
			y = RISEN_TOP + 24 + next() * (height - 48);
			angle = next() * Math.PI * 2;
		} else {
			// Coming in from the left, right or bottom edge, walking inward.
			const side = Math.floor(next() * 3);
			const along = 0.2 + next() * 0.6;
			const spread = (next() - 0.5) * 1.1;
			if (side === 0) {
				x = RISEN_LEFT;
				y = RISEN_TOP + along * height;
				angle = spread;
			} else if (side === 1) {
				x = RISEN_RIGHT;
				y = RISEN_TOP + along * height;
				angle = Math.PI + spread;
			} else {
				x = RISEN_LEFT + along * width;
				y = RISEN_BOTTOM;
				angle = -Math.PI / 2 + spread;
			}
		}
		const vx = Math.cos(angle) * speed;
		const vy = Math.sin(angle) * speed;
		for (let k = 0; k < company.size; k++) {
			// Side by side across their way, the middle one a step ahead.
			const across = (k - (company.size - 1) / 2) * RISEN_COMPANION_GAP;
			const ahead = company.size === 3 && k === 1 ? 6 : 0;
			const px = x - Math.sin(angle) * across + Math.cos(angle) * ahead;
			const py = y + Math.cos(angle) * across + Math.sin(angle) * ahead;
			walkers.push({ id: walkers.length, disciple: true, x: px, y: py, vx, vy, arrive: company.arrive, told: null, passed: false, depth: 0 });
		}
	}
	for (let i = 0; i < RISEN_FOLK; i++) {
		const v = heading(16 + next() * 22);
		walkers.push({ id: walkers.length, disciple: false, x: RISEN_LEFT + 10 + next() * (width - 20), y: RISEN_TOP + 10 + next() * (height - 20), ...v, arrive: 0, told: null, passed: false, depth: 0 });
	}
	return { t: 0, phase: "playing", endedAt: null, tellings: RISEN_TELLINGS, walkers, rings: [], disciples: 0, folk: 0, deepest: 0 };
}

/** Where a walker is at time t: before they arrive, walking in from beyond the edge. */
export function walkerAt(walker: Walker, t: number): { x: number; y: number } {
	if (t >= walker.arrive) return { x: walker.x, y: walker.y };
	const before = walker.arrive - t;
	return { x: walker.x - walker.vx * before, y: walker.y - walker.vy * before };
}

export function stepRisen(state: RisenState, input: RisenInput, events: RisenEvent[] = []): RisenState {
	if (state.phase !== "playing") return state;
	if (input.tell && state.tellings > 0) {
		const x = Math.max(0, Math.min(400, input.tell.x));
		const y = Math.max(RISEN_TOP - 30, Math.min(400, input.tell.y));
		state.tellings--;
		state.rings.push({ x, y, born: state.t, by: -1, depth: 0, caught: 0 });
		events.push({ type: "tell", x, y });
	}
	const dt = RISEN_STEP;
	const before = state.t;
	state.t += dt;
	const t = state.t;
	for (const walker of state.walkers) {
		if (walker.told !== null || t < walker.arrive) continue;
		if (before < walker.arrive) events.push({ type: "arrive", id: walker.id });
		walker.x += walker.vx * dt;
		walker.y += walker.vy * dt;
		if (walker.x < RISEN_LEFT) {
			walker.x = RISEN_LEFT + (RISEN_LEFT - walker.x);
			walker.vx = Math.abs(walker.vx);
		} else if (walker.x > RISEN_RIGHT) {
			walker.x = RISEN_RIGHT - (walker.x - RISEN_RIGHT);
			walker.vx = -Math.abs(walker.vx);
		}
		if (walker.y < RISEN_TOP) {
			walker.y = RISEN_TOP + (RISEN_TOP - walker.y);
			walker.vy = Math.abs(walker.vy);
		} else if (walker.y > RISEN_BOTTOM) {
			walker.y = RISEN_BOTTOM - (walker.y - RISEN_BOTTOM);
			walker.vy = -Math.abs(walker.vy);
		}
	}
	// Every ring touches whoever it reaches; they stop where they are and hear.
	for (const ring of state.rings) {
		const radius = ringRadius(t - ring.born);
		if (radius <= 0) continue;
		const reach = (radius + RISEN_BODY) * (radius + RISEN_BODY);
		for (const walker of state.walkers) {
			if (walker.told !== null || t < walker.arrive) continue;
			const dx = walker.x - ring.x;
			const dy = walker.y - ring.y;
			if (dx * dx + dy * dy > reach) continue;
			walker.told = t;
			walker.vx = 0;
			walker.vy = 0;
			ring.caught++;
			if (walker.disciple) state.disciples++;
			else state.folk++;
			walker.depth = ring.depth + 1;
			state.deepest = Math.max(state.deepest, walker.depth);
			events.push({ type: "heard", id: walker.id, disciple: walker.disciple, x: walker.x, y: walker.y, depth: walker.depth });
		}
	}
	// Those who heard pass it on, a moment later.
	for (const walker of state.walkers) {
		if (walker.told === null || walker.passed || t < walker.told + RISEN_PASS_DELAY - 1e-9) continue;
		walker.passed = true;
		state.rings.push({ x: walker.x, y: walker.y, born: t, by: walker.id, depth: walker.depth, caught: 0 });
		events.push({ type: "pass", id: walker.id, x: walker.x, y: walker.y });
	}
	// Rings that have faded go.
	const alive: Ring[] = [];
	for (const ring of state.rings) {
		if (t - ring.born >= RISEN_RING_LIFE) events.push({ type: "faded", caught: ring.caught, player: ring.by < 0 });
		else alive.push(ring);
	}
	state.rings = alive;
	if (state.disciples >= RISEN_DISCIPLES) {
		state.phase = "won";
		state.endedAt = t;
		events.push({ type: "won" });
	} else if (t >= RISEN_SECONDS - 1e-9 || (state.tellings === 0 && !risenSpreading(state))) {
		state.phase = "lost";
		state.endedAt = t;
		events.push({ type: "lost" });
	}
	return state;
}

/** Is the word still going out: a ring alive, or someone about to pass it on? */
export function risenSpreading(state: RisenState): boolean {
	return state.rings.length > 0 || state.walkers.some((walker) => walker.told !== null && !walker.passed);
}

/** The round's result once it has ended: everyone who heard, the disciples counting most, and tellings to spare. */
export function risenResult(state: RisenState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const heard = state.disciples + state.folk;
	const score = won ? Math.round(Math.max(10, Math.min(100, 34 + (state.folk / RISEN_FOLK) * 40 + state.tellings * 24))) : 0;
	return { won, score, count: heard, seconds };
}
