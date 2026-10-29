/**
 * Sheep Among Wolves (LC-17851, docs/beta/games.md), Matthew 10:16-31:
 * "Behold, I send you forth as sheep in the midst of wolves." Pure and seeded
 * so the tests play it; no imports (Node's type stripping loads it).
 *
 * A sheep in a field at dusk, wolves prowling round it. Every so often a wolf
 * crouches (its path is shown as a line toward where the sheep is heading)
 * and then lunges straight along that line. Step out of the line before it
 * lunges. A bite costs one of three hearts; keep one to the end of the round.
 */

export const WOLVES_STEP = 1 / 60;
export const WOLVES_SECONDS = 15;
/** A survival round: the fastest win is the whole round. */
export const WOLVES_MIN_SECONDS = WOLVES_SECONDS;
export const SHEEP_SPEED = 125;
export const SHEEP_RADIUS = 11;
export const WOLF_RADIUS = 12;
export const WOLVES_HEARTS = 3;
/** After a bite the sheep cannot be bitten again for this long. */
export const WOLVES_SAFE = 1.1;
/** How long a wolf crouches (the warning) before it lunges, at the start and at the end of the round. */
export const CROUCH_START = 0.75;
export const CROUCH_END = 0.55;
export const LUNGE_SPEED = 470;
export const LUNGE_LENGTH = 270;
/** A wolf aims where the sheep will be this far ahead, so running straight on is no escape. */
export const LUNGE_LEAD = 0.3;
export const REST = 0.6;
const PROWL_SPEED = 70;
const PROWL_RING = 135;
const EDGE = 14;
/** At least this long between two wolves starting to crouch. */
const MIN_GAP = 0.55;

export interface Wolf {
	x: number;
	y: number;
	/** Where round the sheep it likes to prowl. */
	angle: number;
	mode: "prowl" | "crouch" | "lunge" | "rest";
	/** When the current mode began, and when the wolf next crouches. */
	since: number;
	next: number;
	/** The lunge's line: from where it crouched toward its end. */
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	/** Joins the hunt at this time (until then it waits off the field). */
	enters: number;
}

export interface WolvesState {
	t: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	hearts: number;
	safeUntil: number;
	wolves: Wolf[];
	lastCrouch: number;
	dodged: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	seed: number;
	/** The seeded generator's position, so a state replays exactly. */
	draws: number;
}

export type WolvesEvent =
	| { type: "crouch"; wolf: number }
	| { type: "lunge"; wolf: number }
	| { type: "bite"; x: number; y: number; hearts: number }
	| { type: "dodged"; wolf: number }
	| { type: "safe" }
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

/** The state's own generator, advanced from its seed by `draws` steps so it lives in plain data. */
function draw(state: WolvesState): number {
	const next = random(state.seed + state.draws * 0x9e3779b1);
	state.draws += 1;
	return next();
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function crouchSeconds(t: number): number {
	return CROUCH_START + (CROUCH_END - CROUCH_START) * Math.min(1, t / WOLVES_SECONDS);
}

export function newWolves(seed: number): WolvesState {
	const state: WolvesState = {
		t: 0,
		x: 200,
		y: 230,
		vx: 0,
		vy: 0,
		hearts: WOLVES_HEARTS,
		safeUntil: 0,
		wolves: [],
		lastCrouch: -1,
		dodged: 0,
		phase: "playing",
		endedAt: null,
		seed: seed >>> 0 || 1,
		draws: 0,
	};
	const turn = draw(state) * Math.PI * 2;
	const enters = [0, 0, 0, 5.5];
	enters.forEach((at, index) => {
		const angle = turn + (index * Math.PI * 2) / enters.length;
		const x = clamp(200 + Math.cos(angle) * 240, -20, 420);
		const y = clamp(200 + Math.sin(angle) * 240, -20, 420);
		state.wolves.push({
			x,
			y,
			angle,
			mode: "prowl",
			since: 0,
			next: at + 1 + index * 0.55 + draw(state) * 0.5,
			fromX: x,
			fromY: y,
			toX: x,
			toY: y,
			enters: at,
		});
	});
	return state;
}

/** Steps the round on by one tick. `move` steers the sheep, each part -1..1. */
export function stepWolves(state: WolvesState, input: { x: number; y: number }, events: WolvesEvent[] = []): WolvesState {
	if (state.phase !== "playing") return state;
	const dt = WOLVES_STEP;
	let { x, y } = input;
	const length = Math.hypot(x, y);
	if (length > 1) {
		x /= length;
		y /= length;
	}
	const beforeX = state.x;
	const beforeY = state.y;
	state.x = clamp(state.x + x * SHEEP_SPEED * dt, EDGE, 400 - EDGE);
	state.y = clamp(state.y + y * SHEEP_SPEED * dt, EDGE, 400 - EDGE);
	state.vx = (state.x - beforeX) / dt;
	state.vy = (state.y - beforeY) / dt;
	state.t += dt;
	const t = state.t;

	state.wolves.forEach((wolf, index) => {
		if (t < wolf.enters) return;
		const age = t - wolf.since;
		if (wolf.mode === "prowl" || wolf.mode === "rest") {
			if (wolf.mode === "rest" && age >= REST) {
				wolf.mode = "prowl";
				wolf.since = t;
			}
			// Prowl round the sheep, at its own place on a ring.
			wolf.angle += dt * 0.35 * (index % 2 ? 1 : -1);
			const ringX = clamp(state.x + Math.cos(wolf.angle) * PROWL_RING, 10, 390);
			const ringY = clamp(state.y + Math.sin(wolf.angle) * PROWL_RING, 10, 390);
			const dx = ringX - wolf.x;
			const dy = ringY - wolf.y;
			const far = Math.hypot(dx, dy);
			const speed = (wolf.mode === "rest" ? 0.4 : 1) * PROWL_SPEED * (wolf.x < 0 || wolf.x > 400 || wolf.y < 0 || wolf.y > 400 ? 2 : 1);
			if (far > 1) {
				wolf.x += (dx / far) * Math.min(far, speed * dt);
				wolf.y += (dy / far) * Math.min(far, speed * dt);
			}
			const onField = wolf.x > 8 && wolf.x < 392 && wolf.y > 8 && wolf.y < 392;
			if (wolf.mode === "prowl" && onField && t >= wolf.next && t - state.lastCrouch >= MIN_GAP) {
				// Crouch, and fix the line it will lunge along.
				const aimX = state.x + state.vx * LUNGE_LEAD;
				const aimY = state.y + state.vy * LUNGE_LEAD;
				const ax = aimX - wolf.x;
				const ay = aimY - wolf.y;
				const aim = Math.hypot(ax, ay) || 1;
				let reach = LUNGE_LENGTH;
				const ux = ax / aim;
				const uy = ay / aim;
				if (ux > 0) reach = Math.min(reach, (400 - EDGE - wolf.x) / ux);
				if (ux < 0) reach = Math.min(reach, (EDGE - wolf.x) / ux);
				if (uy > 0) reach = Math.min(reach, (400 - EDGE - wolf.y) / uy);
				if (uy < 0) reach = Math.min(reach, (EDGE - wolf.y) / uy);
				wolf.mode = "crouch";
				wolf.since = t;
				wolf.fromX = wolf.x;
				wolf.fromY = wolf.y;
				wolf.toX = wolf.x + ux * Math.max(0, reach);
				wolf.toY = wolf.y + uy * Math.max(0, reach);
				state.lastCrouch = t;
				events.push({ type: "crouch", wolf: index });
			}
		} else if (wolf.mode === "crouch") {
			if (age >= crouchSeconds(wolf.since)) {
				wolf.mode = "lunge";
				wolf.since = t;
				events.push({ type: "lunge", wolf: index });
			}
		} else if (wolf.mode === "lunge") {
			const dx = wolf.toX - wolf.x;
			const dy = wolf.toY - wolf.y;
			const left = Math.hypot(dx, dy);
			const stride = LUNGE_SPEED * dt;
			if (left <= stride) {
				wolf.x = wolf.toX;
				wolf.y = wolf.toY;
				wolf.mode = "rest";
				wolf.since = t;
				wolf.next = t + REST + 1.5 + draw(state) * 1.1 - Math.min(0.6, t * 0.04);
				state.dodged += 1;
				events.push({ type: "dodged", wolf: index });
			} else {
				wolf.x += (dx / left) * stride;
				wolf.y += (dy / left) * stride;
			}
		}
		if (t >= state.safeUntil && state.phase === "playing" && wolf.mode !== "rest" && Math.hypot(wolf.x - state.x, wolf.y - state.y) < SHEEP_RADIUS + WOLF_RADIUS) {
			state.hearts -= 1;
			state.safeUntil = t + WOLVES_SAFE;
			events.push({ type: "bite", x: state.x, y: state.y, hearts: state.hearts });
			if (wolf.mode === "lunge") {
				wolf.mode = "rest";
				wolf.since = t;
				wolf.next = t + REST + 1.6 + draw(state) * 1.1;
			}
			if (state.hearts <= 0) {
				state.phase = "lost";
				state.endedAt = t;
				events.push({ type: "lost" });
			}
		}
	});
	if (state.phase === "playing" && t >= WOLVES_SECONDS - 1e-9) {
		state.phase = "won";
		state.endedAt = t;
		events.push({ type: "safe" });
	}
	return state;
}

/** The round's result once it has ended: every heart kept is a third of the score. */
export function wolvesResult(state: WolvesState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round((100 * state.hearts) / WOLVES_HEARTS) : 0;
	return { won: state.phase === "won", score, count: Math.min(500, state.dodged), seconds };
}
