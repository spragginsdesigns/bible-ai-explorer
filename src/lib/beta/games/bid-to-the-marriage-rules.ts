/**
 * Bid to the Marriage (LC-17908, docs/beta/games.md), Matthew 22:1-14: "Go
 * ye therefore into the highways, and as many as ye shall find, bid to the
 * marriage. So those servants went out into the highways, and gathered
 * together all as many as they found, both bad and good: and the wedding was
 * furnished with guests." (22:9-10). Pure and seeded so the tests play it; no
 * imports (Node's type stripping loads it).
 *
 * A map of highways seen from above, the king's wedding hall in the middle
 * with its door on the south side. The servant runs the roads: he keeps
 * running in his direction until a wall, and a new direction is taken at the
 * next junction where it is open (a reverse is taken at once). Guests appear
 * at the highways over the round, wait a while, then go their way if no one
 * bids them. Running past a guest bids him, and he walks in to the wedding by
 * the nearest highway on his own; at the door he is seated. Won: the wedding
 * furnished with WEDDING_GUESTS guests within the round. The skill is the
 * routing, a maze run against the clock: which guests to reach, in what
 * order, before each goes his way. Nobody follows the servant and he never
 * has to go back to the door, which keeps it unlike Under Her Wings, where
 * the hen leads her chicks home in a line (LC-17908 review).
 */

export const WEDDING_STEP = 1 / 60;
export const WEDDING_SECONDS = 15;
/** The map: "." a highway, "D" the road at the hall's door, "H" the hall, "#" fields. */
export const WEDDING_MAP = [
	"...........",
	".###.#.###.",
	".#...#...#.",
	"...#...#...",
	"##.#HHH#.##",
	"...#HHH#...",
	".#.#HHH#.#.",
	".#...D...#.",
	"...#.#.#...",
	".###.#.###.",
	"...........",
] as const;
export const WEDDING_COLS = 11;
export const WEDDING_ROWS = 11;
export const WEDDING_DOOR = { x: 5, y: 7 } as const;
/** The servant's pace, in road tiles a second. */
export const WEDDING_SPEED = 6;
/** Guests to seat for the wedding to be furnished. */
export const WEDDING_GUESTS = 9;
/** A bidden guest's pace on his way in, in road tiles a second. */
export const WEDDING_WALK = 4;
/** Guests appear no nearer the door than this many tiles of road. */
export const WEDDING_SPAWN_MIN = 4;
/** The first guests are waiting at the start; after them one comes at least this often. */
export const WEDDING_FIRST_WAVE = 3;
export const WEDDING_SPAWN_GAP = [0.75, 1.15] as const;
export const WEDDING_TOTAL_GUESTS = 15;
/** How long a guest waits to be bidden before he goes his way. */
export const WEDDING_PATIENCE = [4.6, 6.4] as const;
/** How near (in tiles) he must pass to bid a guest. */
export const WEDDING_REACH = 0.45;
/** The finished time a round's score starts losing points from. */
export const WEDDING_PAR = 10;

export type Dir = "up" | "down" | "left" | "right";
export const DIRS: Record<Dir, { x: number; y: number }> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

export function isRoad(x: number, y: number): boolean {
	if (x < 0 || y < 0 || x >= WEDDING_COLS || y >= WEDDING_ROWS) return false;
	const cell = WEDDING_MAP[y][x];
	return cell === "." || cell === "D";
}

/** Tiles of road from every road tile to `from`, by the shortest highway (-1 off the road). */
export function roadDistances(from: { x: number; y: number }): number[][] {
	const dist = Array.from({ length: WEDDING_ROWS }, () => Array.from({ length: WEDDING_COLS }, () => -1));
	dist[from.y][from.x] = 0;
	const queue = [{ x: from.x, y: from.y }];
	for (let head = 0; head < queue.length; head++) {
		const at = queue[head];
		for (const dir of Object.values(DIRS)) {
			const x = at.x + dir.x;
			const y = at.y + dir.y;
			if (isRoad(x, y) && dist[y][x] < 0) {
				dist[y][x] = dist[at.y][at.x] + 1;
				queue.push({ x, y });
			}
		}
	}
	return dist;
}

const FROM_DOOR = roadDistances(WEDDING_DOOR);
/** Where guests may appear: every highway at least WEDDING_SPAWN_MIN tiles from the door. */
export const WEDDING_SPAWNS: { x: number; y: number }[] = [];
for (let y = 0; y < WEDDING_ROWS; y++) for (let x = 0; x < WEDDING_COLS; x++) if (FROM_DOOR[y][x] >= WEDDING_SPAWN_MIN) WEDDING_SPAWNS.push({ x, y });

/**
 * The fastest the round can be won. The wedding needs WEDDING_GUESTS different
 * guests, so the latest to appear of them is at best guest number
 * WEDDING_GUESTS by the spawn schedule, which appears no sooner than
 * (GUESTS - FIRST_WAVE) short gaps in; he then still walks at least
 * WEDDING_SPAWN_MIN tiles of road to the door. Floored to the tenth.
 */
export const WEDDING_MIN_SECONDS =
	Math.floor(((WEDDING_GUESTS - WEDDING_FIRST_WAVE) * WEDDING_SPAWN_GAP[0] + WEDDING_SPAWN_MIN / WEDDING_WALK) * 10) / 10;

export interface Guest {
	id: number;
	x: number;
	y: number;
	/** Which of the guests' looks: travellers, beggars, merchants, elders, both bad and good. */
	kind: number;
	appears: number;
	leaves: number;
	state: "coming" | "wait" | "going" | "seated" | "gone";
	/** When he was bidden, seated or went his way. */
	at: number;
	/** On his way in: the next road tile he walks to. */
	to: { x: number; y: number } | null;
}

export interface WeddingState {
	t: number;
	x: number;
	y: number;
	dir: Dir | null;
	want: Dir | null;
	facing: Dir;
	guests: Guest[];
	/** Guests bidden and walking in now. */
	going: number;
	seated: number;
	lost: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type WeddingEvent =
	| { type: "appear"; id: number }
	| { type: "bid"; id: number; x: number; y: number; bidden: number }
	| { type: "seat"; id: number; seated: number }
	| { type: "gone"; id: number }
	| { type: "turn"; dir: Dir }
	| { type: "furnished" }
	| { type: "time" };

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

export function newWedding(seed: number): WeddingState {
	const next = random(seed);
	const guests: Guest[] = [];
	let appears = 0;
	const taken: { x: number; y: number; until: number }[] = [];
	for (let id = 0; id < WEDDING_TOTAL_GUESTS; id++) {
		if (id >= WEDDING_FIRST_WAVE) appears += WEDDING_SPAWN_GAP[0] + next() * (WEDDING_SPAWN_GAP[1] - WEDDING_SPAWN_GAP[0]);
		const patience = WEDDING_PATIENCE[0] + next() * (WEDDING_PATIENCE[1] - WEDDING_PATIENCE[0]);
		// A highway no other guest waits on then, and not beside the last one.
		let spot = WEDDING_SPAWNS[0];
		for (let tries = 0; tries < 40; tries++) {
			spot = WEDDING_SPAWNS[Math.floor(next() * WEDDING_SPAWNS.length) % WEDDING_SPAWNS.length];
			const prev = guests[guests.length - 1];
			const near = prev && Math.abs(prev.x - spot.x) + Math.abs(prev.y - spot.y) < 3;
			if (!near && !taken.some((other) => other.x === spot.x && other.y === spot.y && other.until > appears)) break;
		}
		taken.push({ x: spot.x, y: spot.y, until: appears + patience });
		guests.push({ id, x: spot.x, y: spot.y, kind: Math.floor(next() * 6) % 6, appears, leaves: appears + patience, state: "coming", at: 0, to: null });
	}
	return {
		t: 0,
		x: WEDDING_DOOR.x,
		y: WEDDING_DOOR.y,
		dir: null,
		want: null,
		facing: "up",
		guests,
		going: 0,
		seated: 0,
		lost: 0,
		phase: "playing",
		endedAt: null,
	};
}

/** True when the servant stands on a tile's centre. */
function atCentre(state: WeddingState): boolean {
	return Math.abs(state.x - Math.round(state.x)) < 1e-6 && Math.abs(state.y - Math.round(state.y)) < 1e-6;
}

/** The servant's tile (the nearest centre). */
export function weddingTile(state: Pick<WeddingState, "x" | "y">): { x: number; y: number } {
	return { x: Math.round(state.x), y: Math.round(state.y) };
}

/** The road tile one nearer the door from a road tile (the first such in a fixed order, so it replays). */
function towardDoor(x: number, y: number): { x: number; y: number } {
	for (const dir of [DIRS.up, DIRS.left, DIRS.right, DIRS.down]) {
		const nx = x + dir.x;
		const ny = y + dir.y;
		if (isRoad(nx, ny) && FROM_DOOR[ny][nx] === FROM_DOOR[y][x] - 1) return { x: nx, y: ny };
	}
	return { x: WEDDING_DOOR.x, y: WEDDING_DOOR.y };
}

/** Walks a bidden guest `distance` tiles nearer the door by the shortest highway; true once he is there. */
function walkIn(guest: Guest, distance: number): boolean {
	let remaining = distance;
	for (let guard = 0; remaining > 1e-9 && guard < 8; guard++) {
		if (!guest.to) {
			if (guest.x === WEDDING_DOOR.x && guest.y === WEDDING_DOOR.y) return true;
			guest.to = towardDoor(guest.x, guest.y);
		}
		const dx = guest.to.x - guest.x;
		const dy = guest.to.y - guest.y;
		const gap = Math.abs(dx) + Math.abs(dy);
		if (gap <= remaining + 1e-9) {
			guest.x = guest.to.x;
			guest.y = guest.to.y;
			guest.to = null;
			remaining -= gap;
		} else {
			guest.x += Math.sign(dx) * remaining;
			guest.y += Math.sign(dy) * remaining;
			remaining = 0;
		}
	}
	return !guest.to && guest.x === WEDDING_DOOR.x && guest.y === WEDDING_DOOR.y;
}

/** Moves him `distance` tiles along the highways, turning where `want` opens. */
function run(state: WeddingState, distance: number, events: WeddingEvent[]) {
	let remaining = distance;
	if (state.dir && state.want === OPPOSITE[state.dir]) {
		state.dir = state.want;
		events.push({ type: "turn", dir: state.dir });
	}
	for (let guard = 0; remaining > 1e-9 && guard < 8; guard++) {
		let leg: number;
		if (atCentre(state)) {
			state.x = Math.round(state.x);
			state.y = Math.round(state.y);
			if (state.want && state.want !== state.dir && isRoad(state.x + DIRS[state.want].x, state.y + DIRS[state.want].y)) {
				state.dir = state.want;
				events.push({ type: "turn", dir: state.dir });
			} else if (state.dir && !isRoad(state.x + DIRS[state.dir].x, state.y + DIRS[state.dir].y)) state.dir = null;
			if (!state.dir) return;
			leg = Math.min(remaining, 1);
		} else {
			if (!state.dir) return;
			const along = DIRS[state.dir].x !== 0 ? state.x : state.y;
			const sign = DIRS[state.dir].x + DIRS[state.dir].y;
			const target = sign > 0 ? Math.floor(along + 1e-9) + 1 : Math.ceil(along - 1e-9) - 1;
			leg = Math.min(remaining, Math.abs(target - along));
		}
		state.x += DIRS[state.dir].x * leg;
		state.y += DIRS[state.dir].y * leg;
		state.facing = state.dir;
		remaining -= leg;
	}
}

export function stepWedding(state: WeddingState, input: { want: Dir | null }, events: WeddingEvent[] = []): WeddingState {
	if (state.phase !== "playing") return state;
	const dt = WEDDING_STEP;
	if (input.want) state.want = input.want;
	run(state, WEDDING_SPEED * dt, events);
	state.t += dt;
	const t = state.t;
	for (const guest of state.guests) {
		if (guest.state === "coming" && t >= guest.appears) {
			guest.state = "wait";
			events.push({ type: "appear", id: guest.id });
		}
		if (guest.state === "going") {
			if (walkIn(guest, WEDDING_WALK * dt)) {
				guest.state = "seated";
				guest.at = t;
				state.going -= 1;
				state.seated += 1;
				events.push({ type: "seat", id: guest.id, seated: state.seated });
			}
			continue;
		}
		if (guest.state !== "wait") continue;
		if (Math.abs(state.x - guest.x) + Math.abs(state.y - guest.y) <= WEDDING_REACH) {
			guest.state = "going";
			guest.at = t;
			state.going += 1;
			events.push({ type: "bid", id: guest.id, x: guest.x, y: guest.y, bidden: state.going + state.seated });
			continue;
		}
		if (t >= guest.leaves) {
			guest.state = "gone";
			guest.at = t;
			state.lost += 1;
			events.push({ type: "gone", id: guest.id });
		}
	}
	if (state.seated >= WEDDING_GUESTS) {
		state.phase = "won";
		state.endedAt = t;
		events.push({ type: "furnished" });
	} else if (t >= WEDDING_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = t;
		events.push({ type: "time" });
	}
	return state;
}

/** The round's result once it has ended: furnished sooner, with fewer guests left on the highways, scores higher. */
export function weddingResult(state: WeddingState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const extra = state.seated - WEDDING_GUESTS;
	const score = won ? Math.round(Math.max(5, Math.min(100, 100 - Math.max(0, state.endedAt - WEDDING_PAR) * 7 - state.lost * 4 + extra * 4))) : 0;
	return { won, score, count: Math.min(500, state.seated), seconds };
}
