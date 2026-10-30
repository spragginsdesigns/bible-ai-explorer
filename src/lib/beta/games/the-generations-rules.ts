/**
 * The Generations (LC-17908, docs/beta/games.md), Matthew 1:1-25: "So all
 * the generations from Abraham to David are fourteen generations; and from
 * David until the carrying away into Babylon are fourteen generations; and
 * from the carrying away into Babylon unto Christ are fourteen generations"
 * (1:17). A watch-then-repeat memory game on the real line of 1:2-16.
 *
 * Each of the three ages lays six stone tablets with six names of that age
 * in a three-by-two field, at places random per seed. A run of consecutive
 * generations lights up in order, each tablet with its own tone; then every
 * tablet turns face down and the player picks them in the order they lit.
 * A kept run is written into the line; a wrong pick cracks that tablet,
 * shows the right one and replays the run, which costs time. After the
 * third age the line ends in JESUS (1:16, 1:21, 1:25) and the round is won.
 * It is lost when the clock runs out. Pure and seeded so the tests play it;
 * no imports (Node's type stripping loads it).
 */

export const GENERATIONS_STEP = 1 / 60;
export const GENERATIONS_SECONDS = 15;
/** Tablets in the field, three across and two down. */
export const GENERATIONS_TABLETS = 6;
/** How many generations light up in each age's run. */
export const GENERATIONS_RUNS = [3, 4, 5] as const;
/** Ticks the names lie face up before the first one lights. */
export const GENERATIONS_PREVIEW = 18;
/** Ticks each tablet stays lit, per age (the line quickens), and the dark beat after it. */
export const GENERATIONS_LIGHT = [16, 14, 12] as const;
export const GENERATIONS_GAP = 6;
/** Ticks the tablets take to turn face down. */
export const GENERATIONS_FLIP = 10;
/** Picks closer together than this count once. */
export const GENERATIONS_PICK_GAP = 6;
/** Ticks a wrong pick shows the crack and the right tablet before the run replays. */
export const GENERATIONS_SHOW_RIGHT = 36;
/** Ticks a kept run's names take to be written into the line. */
export const GENERATIONS_WRITE = 24;

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

/** The three ages of 1:17, as spans of the line (first and last index) and the verse's words. */
export const GENERATIONS_AGES: readonly { from: number; to: number; label: string }[] = [
	{ from: 0, to: 13, label: "from Abraham to David" },
	{ from: 14, to: 27, label: "from David until the carrying away into Babylon" },
	{ from: 28, to: 39, label: "from the carrying away into Babylon unto Christ" },
];

/** Where the tablets lie: three across, two down (centres in the 400 x 400 stage). */
export const GENERATIONS_SLOTS: readonly { x: number; y: number }[] = [
	{ x: 68, y: 226 },
	{ x: 200, y: 226 },
	{ x: 332, y: 226 },
	{ x: 68, y: 340 },
	{ x: 200, y: 340 },
	{ x: 332, y: 340 },
];
export const GENERATIONS_TILE_W = 120;
export const GENERATIONS_TILE_H = 104;

/** Ticks an age spends watching: the preview, its lights and the turn face down. */
export function generationsWatchTicks(age: number): number {
	return GENERATIONS_PREVIEW + GENERATIONS_RUNS[age] * (GENERATIONS_LIGHT[age] + GENERATIONS_GAP) + GENERATIONS_FLIP;
}

/** The fastest a round can be won: every run picked the moment the tablets are down, as fast as picks count. */
export const GENERATIONS_MIN_SECONDS =
	(GENERATIONS_RUNS.reduce((sum, length, age) => sum + generationsWatchTicks(age) + (length - 1) * GENERATIONS_PICK_GAP, 0) +
		(GENERATIONS_RUNS.length - 1) * GENERATIONS_WRITE) /
	60;

export type GenerationsStage = "watch" | "recall" | "wrong" | "write";

export interface GenerationsState {
	tick: number;
	t: number;
	rng: number;
	/** The age being played, 0-2. */
	age: number;
	stage: GenerationsStage;
	/** The tick the stage began. */
	stageAt: number;
	/** The line index of the name on each tablet, by place 0-5. */
	tablets: number[];
	/** The places that light, in the order of the line. */
	run: number[];
	/** Places picked right so far in this run. */
	progress: number;
	lastPick: number;
	/** The line indices written so far, age by age. */
	kept: number[];
	/** Runs replayed after a wrong pick. */
	replays: number;
	/** The last wrong pick: the cracked place and the right one. */
	wrong: { slot: number; right: number } | null;
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export type GenerationsEvent =
	| { type: "light"; slot: number }
	| { type: "flip" }
	| { type: "right"; slot: number }
	| { type: "wrong"; slot: number; right: number }
	| { type: "replay" }
	| { type: "kept"; age: number }
	| { type: "won" }
	| { type: "lost" };

/** Pick a place 0-5 (number keys), or tap a point of the stage. */
export interface GenerationsInput {
	slot?: number | null;
	tap?: { x: number; y: number } | null;
}

function nextRandom(state: GenerationsState): number {
	state.rng = (state.rng + 0x6d2b79f5) >>> 0;
	let t = state.rng;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Lays an age's tablets: six consecutive names of the age, a run of them, at random places. */
function deal(state: GenerationsState) {
	const span = GENERATIONS_AGES[state.age];
	const length = GENERATIONS_RUNS[state.age];
	const size = span.to - span.from + 1;
	const first = span.from + Math.floor(nextRandom(state) * (size - GENERATIONS_TABLETS + 1));
	const offset = Math.floor(nextRandom(state) * (GENERATIONS_TABLETS - length + 1));
	const places = [0, 1, 2, 3, 4, 5];
	for (let i = places.length - 1; i > 0; i--) {
		const j = Math.floor(nextRandom(state) * (i + 1));
		[places[i], places[j]] = [places[j], places[i]];
	}
	state.tablets = new Array(GENERATIONS_TABLETS);
	places.forEach((place, at) => (state.tablets[place] = first + at));
	state.run = places.slice(offset, offset + length);
	state.progress = 0;
	state.wrong = null;
}

export function newGenerations(seed: number): GenerationsState {
	const state: GenerationsState = {
		tick: 0,
		t: 0,
		rng: seed >>> 0 || 1,
		age: 0,
		stage: "watch",
		stageAt: 0,
		tablets: [],
		run: [],
		progress: 0,
		lastPick: -999,
		kept: [],
		replays: 0,
		wrong: null,
		phase: "playing",
		endedAt: null,
	};
	deal(state);
	return state;
}

/** The place lit now while watching (and how far through its light, 0-1), or null. */
export function generationsLit(state: GenerationsState): { slot: number; k: number } | null {
	if (state.stage !== "watch") return null;
	const since = state.tick - state.stageAt - GENERATIONS_PREVIEW;
	if (since < 0) return null;
	const beat = GENERATIONS_LIGHT[state.age] + GENERATIONS_GAP;
	const index = Math.floor(since / beat);
	const into = since - index * beat;
	if (index >= state.run.length || into >= GENERATIONS_LIGHT[state.age]) return null;
	return { slot: state.run[index], k: into / GENERATIONS_LIGHT[state.age] };
}

/** How far the unpicked tablets are turned face down, 0 (names up) to 1 (down). */
export function generationsDown(state: GenerationsState): number {
	if (state.stage === "recall" || state.stage === "wrong") return 1;
	if (state.stage === "write") return 1;
	const since = state.tick - state.stageAt - (generationsWatchTicks(state.age) - GENERATIONS_FLIP);
	return Math.max(0, Math.min(1, since / GENERATIONS_FLIP));
}

/** True while a pick would count. */
export function generationsCanPick(state: GenerationsState): boolean {
	return state.phase === "playing" && state.stage === "recall" && state.tick + 1 - state.lastPick >= GENERATIONS_PICK_GAP;
}

/** The tablet's place under a point of the stage, or null. */
export function generationsSlotAt(x: number, y: number): number | null {
	const index = GENERATIONS_SLOTS.findIndex((slot) => Math.abs(x - slot.x) <= GENERATIONS_TILE_W / 2 + 4 && Math.abs(y - slot.y) <= GENERATIONS_TILE_H / 2 + 4);
	return index >= 0 ? index : null;
}

export function generationsLeft(state: GenerationsState): number {
	return Math.max(0, GENERATIONS_SECONDS - (state.endedAt ?? state.t));
}

export function stepGenerations(state: GenerationsState, input: GenerationsInput, events: GenerationsEvent[] = []): GenerationsState {
	if (state.phase !== "playing") return state;
	state.tick += 1;
	state.t = state.tick / 60;
	const since = state.tick - state.stageAt;
	if (state.stage === "watch") {
		const beat = GENERATIONS_LIGHT[state.age] + GENERATIONS_GAP;
		const lit = since - GENERATIONS_PREVIEW;
		if (lit >= 0 && lit % beat === 0 && lit / beat < state.run.length) events.push({ type: "light", slot: state.run[lit / beat] });
		if (since === generationsWatchTicks(state.age) - GENERATIONS_FLIP) events.push({ type: "flip" });
		if (since >= generationsWatchTicks(state.age)) {
			state.stage = "recall";
			state.stageAt = state.tick;
			state.progress = 0;
		}
	} else if (state.stage === "wrong") {
		if (since >= GENERATIONS_SHOW_RIGHT) {
			state.stage = "watch";
			state.stageAt = state.tick;
			state.progress = 0;
			state.wrong = null;
			state.replays += 1;
			events.push({ type: "replay" });
		}
	} else if (state.stage === "write") {
		if (since >= GENERATIONS_WRITE) {
			state.age += 1;
			deal(state);
			state.stage = "watch";
			state.stageAt = state.tick;
		}
	}
	if (state.stage === "recall" && state.tick - state.lastPick >= GENERATIONS_PICK_GAP) {
		const slot = input.slot !== undefined && input.slot !== null ? input.slot : input.tap ? generationsSlotAt(input.tap.x, input.tap.y) : null;
		if (slot !== null && slot >= 0 && slot < GENERATIONS_TABLETS) {
			state.lastPick = state.tick;
			const right = state.run[state.progress];
			if (slot === right) {
				state.progress += 1;
				events.push({ type: "right", slot });
				if (state.progress >= state.run.length) {
					for (const place of state.run) state.kept.push(state.tablets[place]);
					events.push({ type: "kept", age: state.age });
					if (state.age >= GENERATIONS_AGES.length - 1) {
						state.phase = "won";
						state.endedAt = state.t;
						events.push({ type: "won" });
						return state;
					}
					state.stage = "write";
					state.stageAt = state.tick;
				}
			} else if (!state.run.slice(0, state.progress).includes(slot)) {
				state.stage = "wrong";
				state.stageAt = state.tick;
				state.wrong = { slot, right };
				events.push({ type: "wrong", slot, right });
			}
		}
	}
	if (state.t >= GENERATIONS_SECONDS - 1e-9) {
		state.phase = "lost";
		state.endedAt = state.t;
		events.push({ type: "lost" });
	}
	return state;
}

/** The round's result once it has ended: no replays and quick is a higher score. */
export function generationsResult(state: GenerationsState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = state.phase === "won" ? Math.round(Math.max(20, Math.min(100, 100 - state.replays * 15 - Math.max(0, state.endedAt - 9.5) * 10.5))) : 0;
	return { won: state.phase === "won", score, count: state.kept.length, seconds };
}
