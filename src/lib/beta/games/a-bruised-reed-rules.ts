/**
 * A Bruised Reed (LC-17908, docs/beta/games.md), Matthew 12:14-21: "A
 * bruised reed shall he not break, and smoking flax shall he not quench, till
 * he send forth judgment unto victory." Pure and seeded so the tests play it;
 * no imports (Node's type stripping loads it).
 *
 * At night a smoking flax, a wick barely burning, sits at the centre with a
 * bruised reed beside it. Gusts of wind come at it from any of eight
 * directions round the edge, each shown a moment before it arrives (the grass
 * bends and dust streams in from that side). A pair of cupped hands, an arc
 * shield, turns round the flame: a gust that meets it is turned aside, one
 * that gets through makes the flame gutter. Later gusts come faster, often
 * from the opposite side, and some are feints: they sway and die away before
 * they arrive. Three gusts through and the flame is quenched; outlast the
 * round and it rises bright.
 *
 * Angles are degrees, clockwise from straight up (0) on the stage.
 */

export const REED_STEP = 1 / 60;
/** The round's length: outlast it. */
export const REED_SECONDS = 15;
/** The fastest a round can be won: the whole of it. */
export const REED_MIN_SECONDS = REED_SECONDS;
export const REED_DIRECTIONS = 8;
/** The cupped hands' width, and a little give at their edges. */
export const REED_ARC = 76;
export const REED_GRACE = 4;
/** A gust caught this near the hands' edge still flickers the flame. */
export const REED_EDGE = 8;
/** Degrees a second the hands turn. */
export const REED_TURN = 270;
/** The least time between one gust and the next beyond the time the hands need to turn to it. */
export const REED_SEE = 0.34;
/** Gusts through before the flame is quenched. */
export const REED_LIVES = 3;
/** What a gust through costs the flame, and one caught at the edge. */
export const REED_THROUGH = 34;
export const REED_GRAZE = 5;

export interface ReedGust {
	/** Which of the eight directions it comes from (0 up, clockwise). */
	dir: number;
	/** When it shows, and when it reaches the flame (a feint never does). */
	warn: number;
	hit: number;
	/** A feint sways and dies away at `dies`. */
	feint: boolean;
	dies: number | null;
	outcome: "blocked" | "grazed" | "through" | "faded" | null;
}

export interface ReedState {
	tick: number;
	t: number;
	/** Where the hands face. */
	shield: number;
	gusts: ReedGust[];
	/** The flame, 0-100. */
	flame: number;
	through: number;
	blocked: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type ReedEvent =
	| { type: "warn"; dir: number; feint: boolean }
	| { type: "fade"; dir: number }
	| { type: "blocked"; dir: number; grazed: boolean }
	| { type: "through"; dir: number; through: number }
	| { type: "victory" }
	| { type: "quenched" };

/** Turn the hands: `dir` -1 anticlockwise (←), 1 clockwise (→); or toward the angle `toward` (a tap or hold). */
export interface ReedInput {
	dir?: number;
	toward?: number | null;
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

/** An angle in 0-360. */
export function reedWrap(angle: number): number {
	return ((angle % 360) + 360) % 360;
}

/** The shortest turn from `from` to `to`, -180 to 180. */
export function reedTurn(from: number, to: number): number {
	const diff = reedWrap(to - from);
	return diff > 180 ? diff - 360 : diff;
}

/** The angle a direction comes from. */
export function reedAngle(dir: number): number {
	return (dir * 360) / REED_DIRECTIONS;
}

/** How long a gust shows before it arrives, as the round goes on. */
function leadAt(t: number) {
	return 1.05 - 0.4 * Math.min(1, t / REED_SECONDS);
}

export function newReed(seed: number): ReedState {
	const next = random(seed);
	const gusts: ReedGust[] = [];
	let hit = 1.9 + next() * 0.3;
	// The first gust comes from a quarter turn or more away from where the hands start.
	let dir = 2 + Math.floor(next() * 5);
	/** Seconds to turn the hands a number of eighths, as far as the gust's edge, and a moment to see it. */
	const need = (steps: number) => Math.max(0, (steps * 360) / REED_DIRECTIONS - REED_ARC / 2 - REED_GRACE) / REED_TURN + REED_SEE;
	let needed = need(4 - Math.abs(4 - dir));
	while (hit < REED_SECONDS - 0.4) {
		const along = hit / REED_SECONDS;
		// It shows at least long enough before it arrives for the hands to get there.
		gusts.push({ dir, warn: hit - Math.max(leadAt(hit), needed), hit, feint: false, dies: null, outcome: null });
		// Later in the round the wind swings round to the opposite side more often, and sooner.
		const steps = along > 0.4 && next() < 0.5 ? 4 : 2 + Math.floor(next() * 3);
		const nextDir = (dir + (next() < 0.5 ? steps : REED_DIRECTIONS - steps)) % REED_DIRECTIONS;
		// Never sooner than the hands can turn there from the last one.
		const interval = Math.max(1.2 - 0.72 * along + next() * 0.15, need(steps));
		const nextHit = hit + interval;
		needed = need(steps);
		const nextWarn = nextHit - Math.max(leadAt(nextHit), needed);
		const feint = next() < 0.4 || (along > 0.5 && !gusts.some((gust) => gust.feint));
		if (along > 0.3 && feint) {
			// A feint: it sways in from elsewhere as if it would arrive first, then dies away.
			let fake = (nextDir + 2 + Math.floor(next() * 5)) % REED_DIRECTIONS;
			if (fake === dir) fake = (fake + 1) % REED_DIRECTIONS;
			const fakeHit = nextHit - 0.25;
			// It dies away in time for the hands to turn to the gust that does come, from wherever
			// they are between the last gust and the feint.
			const away = Math.max(4 - Math.abs(4 - ((nextDir - fake + REED_DIRECTIONS) % REED_DIRECTIONS)), steps);
			const dies = nextHit - need(away);
			// It shows before the gust that does come, as early as just before the last one arrives.
			const warn = Math.max(hit - 0.4, Math.min(fakeHit - leadAt(fakeHit), nextWarn - 0.1, dies - 0.45));
			if (dies - warn >= 0.3) gusts.push({ dir: fake, warn, hit: fakeHit, feint: true, dies, outcome: null });
		}
		hit = nextHit;
		dir = nextDir;
	}
	gusts.sort((a, b) => a.warn - b.warn);
	return { tick: 0, t: 0, shield: 0, gusts, flame: 100, through: 0, blocked: 0, phase: "playing", endedAt: null };
}

/** The gusts showing now: warned, not yet arrived or faded. */
export function reedShowing(state: ReedState): ReedGust[] {
	return state.gusts.filter((gust) => gust.outcome === null && state.t >= gust.warn);
}

export function stepReed(state: ReedState, input: ReedInput, events: ReedEvent[] = []): ReedState {
	if (state.phase !== "playing") return state;
	const most = REED_TURN * REED_STEP;
	if (typeof input.toward === "number") {
		const turn = reedTurn(state.shield, input.toward);
		state.shield = reedWrap(state.shield + Math.max(-most, Math.min(most, turn)));
	} else if (input.dir) {
		state.shield = reedWrap(state.shield + Math.sign(input.dir) * most);
	}
	const before = state.t;
	state.tick += 1;
	state.t = state.tick / 60;
	for (const gust of state.gusts) {
		if (gust.outcome !== null) continue;
		if (before < gust.warn && state.t >= gust.warn) events.push({ type: "warn", dir: gust.dir, feint: gust.feint });
		if (gust.feint && gust.dies !== null && state.t >= gust.dies) {
			gust.outcome = "faded";
			events.push({ type: "fade", dir: gust.dir });
			continue;
		}
		if (gust.feint || state.t < gust.hit) continue;
		const off = Math.abs(reedTurn(state.shield, reedAngle(gust.dir)));
		if (off <= REED_ARC / 2 + REED_GRACE) {
			const grazed = off > REED_ARC / 2 - REED_EDGE;
			gust.outcome = grazed ? "grazed" : "blocked";
			state.blocked += 1;
			if (grazed) state.flame = Math.max(0, state.flame - REED_GRAZE);
			events.push({ type: "blocked", dir: gust.dir, grazed });
		} else {
			gust.outcome = "through";
			state.through += 1;
			state.flame = Math.max(0, state.flame - REED_THROUGH);
			events.push({ type: "through", dir: gust.dir, through: state.through });
			if (state.through >= REED_LIVES) {
				state.phase = "lost";
				state.endedAt = state.t;
				events.push({ type: "quenched" });
				return state;
			}
		}
	}
	if (state.tick >= REED_SECONDS * 60) {
		state.phase = "won";
		state.endedAt = state.t;
		events.push({ type: "victory" });
	}
	return state;
}

/** The round's result once it has ended: how much of the flame was kept. */
export function reedResult(state: ReedState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(1, Math.min(100, state.flame))) : 0;
	return { won: state.phase === "won", score, count: state.blocked, seconds };
}
