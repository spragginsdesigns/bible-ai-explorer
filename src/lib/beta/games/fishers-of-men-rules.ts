/**
 * Fishers of Men (LC-17908, docs/beta/games.md), Matthew 4:18-22: "Jesus,
 * walking by the sea of Galilee, saw two brethren, Simon called Peter, and
 * Andrew his brother, casting a net into the sea: for they were fishers."
 * Pure and seeded so the tests play it; no imports (Node's type stripping
 * loads it).
 *
 * Aim and lead, artillery-style. Peter and Andrew are in their boat at the
 * bottom of the stage; shoals of fish drift under the water at different
 * distances, small ones and rich ones, and driftwood floats among them. The
 * player places the net's open circle on the water (the arrows glide it, a
 * finger or the mouse puts it straight there) and casts to it with one press.
 * The net then flies for FISH_FLIGHT seconds, opens where it lands and hauls
 * in every fish inside its circle; open water catches nothing and driftwood
 * snags the net. The shoals keep moving all the while, so the skill is
 * casting where a shoal will be, not where it is. Fill the quota before the
 * round runs out; then Jesus calls from the shore (v19) and they straightway
 * leave their nets (v20).
 *
 * It first cast with two sweeping meters (an aim arrow, then a strength
 * bar), but Matthew 3 (a gauge released in a band), 21 (press when the patch
 * is in the zone) and 24 (react to the flash) already make stopping a moving
 * indicator the skill, so LC-17908 replaced them: nothing here sweeps on its
 * own, the player aims.
 */

export const FISH_STEP = 1 / 60;
/** How long the round runs. */
export const FISH_SECONDS = 15;
/** Fish to haul in to win. */
export const FISH_QUOTA = 30;
/** The most fish one cast can hold. */
export const FISH_NET_HOLD = 10;
/** Where the net is thrown from (Peter, at the bow). */
export const FISH_BOAT_X = 200;
export const FISH_BOAT_Y = 344;
/** The net can be cast between -FISH_AIM_MAX and FISH_AIM_MAX radians from straight out. */
export const FISH_AIM_MAX = 0.84;
/** How near and how far from the boat the net can be cast. */
export const FISH_NEAR = 70;
export const FISH_FAR = 236;
/** How fast the held arrows glide the net's aim over the water, in stage units a second. */
export const FISH_AIM_SPEED = 260;
/** The net's flight, and the haul back to the boat (longer when it snags on driftwood). */
export const FISH_FLIGHT = 0.8;
export const FISH_HAUL = 0.95;
export const FISH_SNAG_HAUL = 1.5;
/** An empty net is gathered up slowly too, so casting blind costs time (LC-17908 review). */
export const FISH_EMPTY_HAUL = 2;
/** The open net's radius: every fish inside it is caught. */
export const FISH_NET_R = 30;
/** A net landing this close to driftwood snags on it. */
export const FISH_LOG_R = 26;
/** How many shoals swim at once, and how long a hauled-out shoal takes to be replaced. */
export const FISH_SHOALS = 4;
export const FISH_RESPAWN = 0.5;
/**
 * The fastest a round can be won: the quota needs ceil(QUOTA / NET_HOLD)
 * casts, and a cast can go on the very step the net is ready, so it is each
 * cast's flight with a haul between them, floored to the tenth.
 */
export const FISH_MIN_CASTS = Math.ceil(FISH_QUOTA / FISH_NET_HOLD);
export const FISH_MIN_SECONDS = Math.floor((FISH_MIN_CASTS * FISH_FLIGHT + (FISH_MIN_CASTS - 1) * FISH_HAUL) * 10) / 10;

export interface FishOne {
	/** Offset from the shoal's centre, and the phase of its wander. */
	ox: number;
	oy: number;
	ph: number;
}

/** A shoal drifts on smooth swings about a centre, in angle and distance from the boat, quick enough that a cast must lead it. */
export interface Shoal {
	id: number;
	rich: boolean;
	born: number;
	a0: number;
	aAmp: number;
	aW: number;
	aPh: number;
	d0: number;
	dAmp: number;
	dW: number;
	dPh: number;
	fish: FishOne[];
}

export interface Driftwood {
	a0: number;
	aAmp: number;
	aW: number;
	aPh: number;
	d: number;
	tilt: number;
}

/** The net is in Peter's hands ("ready"), in the air, or being hauled back. */
export type CastStage = "ready" | "flight" | "haul";

export interface Cast {
	stage: CastStage;
	/** When this stage began. */
	since: number;
	/** Where the net was cast to. */
	landX: number;
	landY: number;
	/** Fish hauled by this cast, and whether it snagged. */
	caught: number;
	snag: boolean;
	/** Which shoals it hauled from (for the stage's picture). */
	from: number[];
}

export interface FishState {
	t: number;
	rng: number;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
	caught: number;
	casts: number;
	/** Casts that hauled in nothing. */
	empty: number;
	cast: Cast;
	/** Where the net is aimed: its open circle on the water, kept within reach of the boat. */
	aimX: number;
	aimY: number;
	shoals: Shoal[];
	logs: Driftwood[];
	/** Shoals to come: when each one appears. */
	pending: number[];
	nextId: number;
}

export type FishEvent =
	| { type: "throw"; x: number; y: number }
	| { type: "land"; x: number; y: number; caught: number; snag: boolean; shoals: number[] }
	| { type: "hauled" }
	| { type: "won" }
	| { type: "lost" };

/**
 * One step's input: `move` glides the aim (held arrows, each -1, 0 or 1),
 * `to` puts it straight at a point (a finger or the mouse), `cast` throws the
 * net to the aim if it is ready. The aim can move while the net is out.
 */
export interface FishInput {
	move?: { x: number; y: number };
	to?: { x: number; y: number } | null;
	cast?: boolean;
}

/** The mulberry-style generator the chapter games share, stepped from the state so a round replays. */
function draw(state: FishState): number {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The nearest point to (x, y) the net can be cast to: within FISH_AIM_MAX of straight out, FISH_NEAR to FISH_FAR from the boat. */
export function clampAim(x: number, y: number): { x: number; y: number } {
	const dx = x - FISH_BOAT_X;
	// Never behind the bow: a point below the boat would otherwise flip the angle to the far side.
	const dy = Math.max(0, FISH_BOAT_Y - y);
	const angle = Math.max(-FISH_AIM_MAX, Math.min(FISH_AIM_MAX, Math.atan2(dx, dy)));
	const reach = Math.max(FISH_NEAR, Math.min(FISH_FAR, Math.hypot(dx, dy)));
	return polar(angle, reach);
}

/** A point at an angle and distance from the boat. */
function polar(angle: number, reach: number) {
	return { x: FISH_BOAT_X + Math.sin(angle) * reach, y: FISH_BOAT_Y - Math.cos(angle) * reach };
}

/** A shoal's centre at time t. */
export function shoalAt(shoal: Shoal, t: number): { x: number; y: number } {
	return polar(shoal.a0 + shoal.aAmp * Math.sin(shoal.aW * t + shoal.aPh), shoal.d0 + shoal.dAmp * Math.sin(shoal.dW * t + shoal.dPh));
}

/** How big a fish looks at this height on the water (far ones are smaller). */
export function depthScale(y: number): number {
	return 0.62 + 0.38 * Math.max(0, Math.min(1, (y - 100) / 250));
}

/** Each fish of a shoal at time t, wandering a little about its place. */
export function fishAt(shoal: Shoal, one: FishOne, t: number): { x: number; y: number } {
	const centre = shoalAt(shoal, t);
	const scale = depthScale(centre.y);
	return { x: centre.x + (one.ox + Math.sin(t * 1.7 + one.ph) * 3) * scale, y: centre.y + (one.oy + Math.cos(t * 1.3 + one.ph) * 2) * scale };
}

export function logAt(log: Driftwood, t: number): { x: number; y: number } {
	return polar(log.a0 + log.aAmp * Math.sin(log.aW * t + log.aPh), log.d);
}

function newShoal(state: FishState, rich: boolean, born: number): Shoal {
	const aAmp = 0.22 + draw(state) * 0.36;
	const a0 = (draw(state) * 2 - 1) * (FISH_AIM_MAX - 0.06 - aAmp);
	const dAmp = 8 + draw(state) * 22;
	const d0 = FISH_NEAR + 26 + dAmp + draw(state) * (FISH_FAR - FISH_NEAR - 40 - 2 * dAmp);
	const count = rich ? 5 + Math.floor(draw(state) * 3) : 2 + Math.floor(draw(state) * 3);
	const spread = rich ? 22 : 14;
	const fish: FishOne[] = [];
	for (let i = 0; i < count; i++) {
		const angle = (i / count) * Math.PI * 2 + draw(state) * 0.8;
		const r = i === 0 ? 0 : spread * (0.55 + draw(state) * 0.45);
		fish.push({ ox: Math.cos(angle) * r * 1.3, oy: Math.sin(angle) * r * 0.75, ph: draw(state) * Math.PI * 2 });
	}
	return {
		id: state.nextId++,
		rich,
		born,
		a0,
		aAmp,
		aW: (0.54 + draw(state) * 0.68) * (draw(state) < 0.5 ? -1 : 1),
		aPh: draw(state) * Math.PI * 2,
		d0,
		dAmp,
		dW: 0.6 + draw(state) * 0.75,
		dPh: draw(state) * Math.PI * 2,
		fish,
	};
}

function newCast(t: number): Cast {
	return { stage: "ready", since: t, landX: 0, landY: 0, caught: 0, snag: false, from: [] };
}

/**
 * Where the aim rests when a round begins: just off the bow, short of the
 * shoals, so casting without aiming catches nothing (the middle of the reach
 * is where the shoals' paths cross most).
 */
export const FISH_AIM_START = { x: FISH_BOAT_X, y: FISH_BOAT_Y - 88 };

export function newFish(seed: number): FishState {
	const state: FishState = {
		t: 0,
		rng: seed >>> 0 || 1,
		phase: "playing",
		endedAt: null,
		caught: 0,
		casts: 0,
		empty: 0,
		cast: newCast(0),
		aimX: FISH_AIM_START.x,
		aimY: FISH_AIM_START.y,
		shoals: [],
		logs: [],
		pending: [],
		nextId: 1,
	};
	// Two rich shoals and two small ones to begin.
	for (let i = 0; i < FISH_SHOALS; i++) state.shoals.push(newShoal(state, i < 2, 0));
	for (let i = 0; i < 2; i++) {
		state.logs.push({
			a0: (i ? 1 : -1) * (0.2 + draw(state) * 0.4),
			aAmp: 0.1 + draw(state) * 0.15,
			aW: 0.25 + draw(state) * 0.2,
			aPh: draw(state) * Math.PI * 2,
			d: FISH_NEAR + 50 + draw(state) * (FISH_FAR - FISH_NEAR - 70),
			tilt: draw(state) - 0.5,
		});
	}
	return state;
}

/** The net comes down: every fish inside its circle is caught (up to what it holds), unless it snags. */
function land(state: FishState, events: FishEvent[]) {
	const cast = state.cast;
	const t = state.t;
	cast.snag = state.logs.some((log) => {
		const at = logAt(log, t);
		return Math.hypot(at.x - cast.landX, at.y - cast.landY) < FISH_LOG_R;
	});
	cast.caught = 0;
	cast.from = [];
	if (!cast.snag) {
		const inside: { shoal: Shoal; one: FishOne; d: number }[] = [];
		for (const shoal of state.shoals) {
			for (const one of shoal.fish) {
				const at = fishAt(shoal, one, t);
				const d = Math.hypot(at.x - cast.landX, at.y - cast.landY);
				if (d <= FISH_NET_R) inside.push({ shoal, one, d });
			}
		}
		inside.sort((a, b) => a.d - b.d);
		for (const hit of inside.slice(0, FISH_NET_HOLD)) {
			hit.shoal.fish = hit.shoal.fish.filter((one) => one !== hit.one);
			if (!cast.from.includes(hit.shoal.id)) cast.from.push(hit.shoal.id);
			cast.caught++;
		}
	}
	state.caught += cast.caught;
	if (cast.caught === 0) state.empty++;
	// A shoal hauled down to its last fish scatters, and another comes in its place.
	const kept: Shoal[] = [];
	for (const shoal of state.shoals) {
		if (shoal.fish.length <= 1) state.pending.push(t + FISH_RESPAWN);
		else kept.push(shoal);
	}
	state.shoals = kept;
	events.push({ type: "land", x: cast.landX, y: cast.landY, caught: cast.caught, snag: cast.snag, shoals: cast.from });
}

export function stepFish(state: FishState, input: FishInput = {}, events: FishEvent[] = []): FishState {
	if (state.phase !== "playing") return state;
	if (input.to) {
		const at = clampAim(input.to.x, input.to.y);
		state.aimX = at.x;
		state.aimY = at.y;
	}
	const mx = Math.sign(input.move?.x ?? 0);
	const my = Math.sign(input.move?.y ?? 0);
	if (mx || my) {
		const glide = (FISH_AIM_SPEED * FISH_STEP) / Math.hypot(mx, my);
		const at = clampAim(state.aimX + mx * glide, state.aimY + my * glide);
		state.aimX = at.x;
		state.aimY = at.y;
	}
	const cast = state.cast;
	if (cast.stage === "ready" && input.cast) {
		cast.landX = state.aimX;
		cast.landY = state.aimY;
		cast.stage = "flight";
		cast.since = state.t;
		state.casts++;
		events.push({ type: "throw", x: cast.landX, y: cast.landY });
	}
	state.t += FISH_STEP;
	const now = state.t - state.cast.since;
	if (state.cast.stage === "flight" && now >= FISH_FLIGHT - 1e-9) {
		land(state, events);
		state.cast.stage = "haul";
		state.cast.since = state.t;
		if (state.caught >= FISH_QUOTA) {
			state.phase = "won";
			state.endedAt = state.t;
			events.push({ type: "won" });
			return state;
		}
	} else if (state.cast.stage === "haul" && now >= (state.cast.snag ? FISH_SNAG_HAUL : state.cast.caught === 0 ? FISH_EMPTY_HAUL : FISH_HAUL) - 1e-9) {
		state.cast = newCast(state.t);
		events.push({ type: "hauled" });
	}
	// New shoals come in where old ones were hauled out, rich about half the time.
	const due = state.pending.filter((at) => at <= state.t + 1e-9);
	if (due.length) {
		state.pending = state.pending.filter((at) => at > state.t + 1e-9);
		const rich = state.shoals.filter((shoal) => shoal.rich).length;
		for (let i = 0; i < due.length; i++) state.shoals.push(newShoal(state, rich + i < 1 || draw(state) < 0.5, state.t));
	}
	if (state.t >= FISH_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: the quota filled sooner, with fewer casts wasted, scores higher. */
export function fishResult(state: FishState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const won = state.phase === "won";
	const spare = Math.max(0, FISH_SECONDS - state.endedAt);
	const score = won ? Math.round(Math.max(10, Math.min(100, 30 + spare * 8 - state.empty * 10 + (state.caught - FISH_QUOTA) * 2))) : 0;
	return { won, score, count: Math.min(500, state.caught), seconds };
}
