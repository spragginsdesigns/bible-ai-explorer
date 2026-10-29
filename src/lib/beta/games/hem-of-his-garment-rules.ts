/**
 * The Hem of His Garment (LC-17851, docs/beta/games.md), Matthew 9:20-22: a
 * woman presses through the crowd behind Jesus to touch the hem of his
 * garment. Pure and seeded so the tests play it; no imports (Node's type
 * stripping loads it).
 *
 * Seen from above: Jesus walks across the top of the street, his hem trailing
 * behind him. Five rows of the crowd move along the street below him, each
 * row with gaps. The woman starts at the bottom and slips up through the gaps;
 * bumping into someone pushes her back two rows and stops her a moment. She
 * wins by touching the hem before he has passed out of sight.
 */

export const HEM_STEP = 1 / 60;
/** How long Jesus takes to walk across the street and out of sight. */
export const HEM_SECONDS = 15;
/** The woman's speed, picture units a second. */
export const HEM_SPEED = 104;
export const HEM_RADIUS = 8;
export const PERSON_RADIUS = 11;
/** How near the woman's hand must come to the hem. */
export const HEM_REACH = 16;
/** After a bump (two rows back) she stands still this long, and the crowd cannot bump her again for HEM_SAFE. */
export const HEM_STUN = 0.5;
export const HEM_SAFE = 0.75;
/** The rows of the crowd, bottom to top. */
export const HEM_LANES = [316, 270, 224, 178, 132];
/** Jesus' path along the top of the street. */
export const HEM_JESUS_Y = 74;
export const HEM_START = { x: 200, y: 372 };
const TOP = 52;
const WRAP = 500;
const WALK = 28.6;

export function jesusX(t: number): number {
	return 16 + t * WALK;
}

/** Where the hem trails, behind him. */
export function hemPoint(t: number): { x: number; y: number } {
	return { x: jesusX(t) - 30, y: HEM_JESUS_Y + 16 };
}

/**
 * The fastest a round can possibly be won: the first moment the hem is within
 * reach of a woman who ran straight at it from the start at full speed,
 * through no one. The crowd only makes it slower.
 */
export const HEM_MIN_SECONDS = (() => {
	for (let tick = 0; tick < 60 * HEM_SECONDS; tick++) {
		const t = tick * HEM_STEP;
		const hem = hemPoint(t);
		if (Math.hypot(hem.x - HEM_START.x, hem.y - HEM_START.y) <= HEM_SPEED * t + HEM_REACH) return Math.floor(t * 10) / 10;
	}
	return HEM_SECONDS;
})();

export interface HemLane {
	y: number;
	/** +1 walks right, -1 left. */
	dir: number;
	speed: number;
	/** Where each person stands at t = 0, 0..WRAP. */
	offsets: number[];
	/** Robe colour per person, an index the stage picks a colour from. */
	tints: number[];
}

export interface HemPerson {
	x: number;
	y: number;
	lane: number;
	tint: number;
	dir: number;
}

export interface HemState {
	t: number;
	x: number;
	y: number;
	lanes: HemLane[];
	bumps: number;
	/** Until when she stands still, and until when the crowd cannot bump her. */
	stunUntil: number;
	safeUntil: number;
	/** The highest row she has passed, 0-5. */
	rows: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type HemEvent = { type: "bump"; x: number; y: number } | { type: "row"; row: number } | { type: "touched" } | { type: "passed" };

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

export function newHem(seed: number): HemState {
	const next = random(seed);
	const lanes: HemLane[] = [];
	let dir = next() < 0.5 ? 1 : -1;
	HEM_LANES.forEach((y, index) => {
		const upper = index / (HEM_LANES.length - 1);
		const speed = (38 + upper * 30) * (0.85 + next() * 0.3);
		const gapMin = 70 - upper * 8;
		const gapMax = 98 - upper * 10;
		const offsets: number[] = [];
		const tints: number[] = [];
		const first = next() * 30;
		let cursor = first;
		for (;;) {
			const count = 3 + Math.floor(next() * 2);
			const spacing = 26 + next() * 5;
			if (cursor + (count - 1) * spacing + gapMin > WRAP + first) break;
			for (let c = 0; c < count; c++) {
				offsets.push(cursor + c * spacing);
				tints.push(Math.floor(next() * 6));
			}
			cursor += (count - 1) * spacing + gapMin + next() * (gapMax - gapMin);
		}
		lanes.push({ y, dir, speed, offsets, tints });
		dir = next() < 0.7 ? -dir : dir;
	});
	return { t: 0, x: HEM_START.x, y: HEM_START.y, lanes, bumps: 0, stunUntil: 0, safeUntil: 0, rows: 0, phase: "playing", endedAt: null };
}

/** Everyone in the crowd at time `t`, the disciples who walk ahead of Jesus included (lane = HEM_LANES.length). */
export function crowdAt(state: HemState, t = state.t): HemPerson[] {
	const people: HemPerson[] = [];
	state.lanes.forEach((lane, index) => {
		const shift = lane.dir * lane.speed * t;
		lane.offsets.forEach((offset, person) => {
			const along = (((offset + shift) % WRAP) + WRAP) % WRAP;
			people.push({ x: along - 50, y: lane.y, lane: index, tint: lane.tints[person], dir: lane.dir });
		});
	});
	const jx = jesusX(t);
	people.push({ x: jx + 34, y: HEM_JESUS_Y - 6, lane: HEM_LANES.length, tint: 6, dir: 1 });
	people.push({ x: jx + 62, y: HEM_JESUS_Y + 10, lane: HEM_LANES.length, tint: 7, dir: 1 });
	return people;
}

function laneY(lane: number): number {
	return lane < HEM_LANES.length ? HEM_LANES[lane] : HEM_JESUS_Y;
}

/** Advances the round one step. `move` is where she is steered, each part -1..1. */
export function stepHem(state: HemState, input: { x: number; y: number }, events: HemEvent[] = []): HemState {
	if (state.phase !== "playing") return state;
	const dt = HEM_STEP;
	if (state.t >= state.stunUntil) {
		let { x, y } = input;
		const length = Math.hypot(x, y);
		if (length > 1) {
			x /= length;
			y /= length;
		}
		state.x = Math.max(HEM_RADIUS, Math.min(400 - HEM_RADIUS, state.x + x * HEM_SPEED * dt));
		state.y = Math.max(TOP, Math.min(400 - HEM_RADIUS, state.y + y * HEM_SPEED * dt));
	}
	state.t += dt;
	if (state.t >= state.safeUntil) {
		const hit = crowdAt(state).find((person) => Math.hypot(person.x - state.x, person.y - state.y) < PERSON_RADIUS + HEM_RADIUS);
		if (hit) {
			state.bumps += 1;
			state.stunUntil = state.t + HEM_STUN;
			state.safeUntil = state.t + HEM_SAFE;
			events.push({ type: "bump", x: state.x, y: state.y });
			state.y = Math.min(HEM_START.y, laneY(hit.lane) + 69);
			state.x = Math.max(HEM_RADIUS, Math.min(400 - HEM_RADIUS, state.x + hit.dir * 8));
		}
	}
	const passed = HEM_LANES.filter((y) => state.y < y - PERSON_RADIUS - HEM_RADIUS).length;
	if (passed > state.rows) {
		state.rows = passed;
		events.push({ type: "row", row: passed });
	}
	const hem = hemPoint(state.t);
	if (hem.x > 0 && hem.x < 400 && Math.hypot(hem.x - state.x, hem.y - state.y) <= HEM_REACH) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "touched" });
	} else if (state.t >= HEM_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "passed" });
	}
	return state;
}

/** The round's result once it has ended: sooner and with fewer bumps is more faith kept. */
export function hemResult(state: HemState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - Math.max(0, state.endedAt - 6) * 7 - state.bumps * 8))) : 0;
	return { won: state.phase === "won", score, count: state.rows, seconds };
}
