/**
 * Treasures in Heaven (LC-17851, docs/beta/games.md), Matthew 6:19-21: lay up
 * treasures in heaven, where neither moth nor rust doth corrupt. Pure and
 * seeded so the tests play it; no imports (Node's type stripping loads it).
 *
 * Gold coins come down from heaven's light in sweeping trails, and now and
 * then a jewel falls fast; the chest slides left and right beneath them.
 * Moths flutter down in wide wobbles and rust drifts down in slow clouds, and
 * either one that reaches the chest corrupts part of what is laid up in it.
 * It all comes faster and thicker as the round goes on. Won: enough treasure
 * laid up when the round ends.
 */

export const TREASURE_STEP = 1 / 60;
export const TREASURE_SECONDS = 15;
/** A round is played to the end, so it is never won sooner. */
export const TREASURE_MIN_SECONDS = TREASURE_SECONDS;
/** Treasure to have laid up when the round ends. */
export const TREASURE_TARGET = 44;
/** The chest's open lid, where things are caught, in the 400-unit picture. */
export const TREASURE_CHEST_Y = 326;
export const TREASURE_CHEST_SPEED = 290;
export const TREASURE_CHEST_HALF = 34;
/** What a moth or a cloud of rust corrupts. */
export const TREASURE_CORRUPT = 8;
export const TREASURE_VALUE = { coin: 1, jewel: 3, moth: 0, rust: 0 } as const;
export const TREASURE_RADIUS = { coin: 8, jewel: 9, moth: 10, rust: 17 } as const;

export type TreasureKind = keyof typeof TREASURE_VALUE;

export interface TreasureItem {
	id: number;
	kind: TreasureKind;
	born: number;
	x0: number;
	y0: number;
	/** Fall speed, sideways drift, and the wobble's size, pace and phase. */
	fall: number;
	drift: number;
	wobble: number;
	pace: number;
	phase: number;
	landAt: number;
	landX: number;
	outcome: "kept" | "corrupted" | "missed" | null;
}

export interface TreasureState {
	t: number;
	chestX: number;
	treasure: number;
	/** Treasure that has come down so far, caught or not. */
	offered: number;
	coins: number;
	corruptions: number;
	items: TreasureItem[];
	phase: "playing" | "won" | "lost";
	endedAt: number | null;
}

export interface TreasureInput {
	dir: number;
	target: number | null;
}

export type TreasureEvent =
	| { type: "keep"; x: number; kind: TreasureKind; value: number }
	| { type: "corrupt"; x: number; kind: TreasureKind; lost: number }
	| { type: "miss"; x: number; kind: TreasureKind }
	| { type: "won" }
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

/** Where an item is at time `t`. */
export function treasureAt(item: TreasureItem, t: number): { x: number; y: number } {
	const age = t - item.born;
	return { x: item.x0 + item.drift * age + item.wobble * Math.sin(item.pace * age + item.phase), y: item.y0 + item.fall * age };
}

function make(id: number, kind: TreasureKind, landAt: number, x0: number, fall: number, drift: number, wobble: number, pace: number, phase: number): TreasureItem {
	const y0 = -20;
	const flight = (TREASURE_CHEST_Y - y0) / fall;
	const item: TreasureItem = { id, kind, born: landAt - flight, x0, y0, fall, drift, wobble, pace, phase, landAt, landX: 0, outcome: null };
	item.landX = treasureAt(item, landAt).x;
	return item;
}

export function newTreasure(seed: number): TreasureState {
	const next = random(seed);
	const items: TreasureItem[] = [];
	let id = 0;
	// Trails of coins and the odd jewel, closer together as the round goes on.
	let at = 1.0 + next() * 0.2;
	while (at < TREASURE_SECONDS - 0.3) {
		const progress = at / TREASURE_SECONDS;
		const fall = 215 + 125 * progress;
		if (next() < 0.2 + 0.1 * progress) {
			const x = 40 + next() * 320;
			items.push(make(id++, "jewel", at, x, fall * 1.45, 0, 4, 9, next() * 6));
			at += 0.42 - 0.12 * progress;
		} else {
			const count = 3 + Math.floor(next() * 3);
			const spacing = 0.15 - 0.03 * progress;
			const step = (next() < 0.5 ? -1 : 1) * (16 + next() * 14);
			let x = 50 + next() * 300;
			if (x + step * (count - 1) > 360 || x + step * (count - 1) < 40) x -= step * (count - 1);
			for (let i = 0; i < count; i++) items.push(make(id++, "coin", at + i * spacing, x + step * i, fall, 0, 0, 0, 0));
			at += count * spacing + 0.32 - 0.16 * progress + next() * 0.25;
		}
	}
	// Moths and rust, more of them later; kept off the coins that land close by.
	const coinsAndJewels = items.slice();
	let threat = 2.0 + next() * 0.4;
	const rustFirst = next() < 0.5;
	for (let count = 0; threat < TREASURE_SECONDS - 0.2; count++) {
		const progress = threat / TREASURE_SECONDS;
		// Two in five are rust, the rest moths.
		const kind: TreasureKind = (count % 5 === 1 || count % 5 === 3) !== (rustFirst && count % 5 < 2) ? "rust" : "moth";
		let made: TreasureItem | null = null;
		for (let attempt = 0; attempt < 14; attempt++) {
			const moth = kind === "moth";
			const candidate = make(
				id,
				kind,
				threat,
				60 + next() * 280,
				moth ? 150 + 70 * progress : 105 + 45 * progress,
				(next() * 2 - 1) * (moth ? 24 : 34),
				moth ? 26 + next() * 16 : 16 + next() * 10,
				moth ? 4.5 + next() * 2 : 1.6 + next() * 0.8,
				next() * 6.28,
			);
			if (candidate.landX < 24 || candidate.landX > 376) continue;
			const clear = TREASURE_CHEST_HALF + TREASURE_RADIUS[kind] + 4;
			if (coinsAndJewels.some((item) => Math.abs(item.landAt - threat) < 0.3 && Math.abs(item.landX - candidate.landX) < clear)) continue;
			made = candidate;
			break;
		}
		if (made) {
			items.push(made);
			id++;
		}
		threat += 0.8 - 0.45 * progress + next() * 0.3;
	}
	items.sort((a, b) => a.born - b.born);
	return { t: 0, chestX: 200, treasure: 0, offered: 0, coins: 0, corruptions: 0, items, phase: "playing", endedAt: null };
}

/** Everything that can be seen falling now. */
export function falling(state: TreasureState): TreasureItem[] {
	return state.items.filter((item) => item.born <= state.t && (item.outcome === null || item.outcome === "missed") && state.t < item.landAt + 0.35);
}

export function stepTreasure(state: TreasureState, input: TreasureInput, events: TreasureEvent[] = []): TreasureState {
	if (state.phase !== "playing") return state;
	const move = TREASURE_CHEST_SPEED * TREASURE_STEP;
	if (input.target !== null && Number.isFinite(input.target)) state.chestX += Math.max(-move, Math.min(move, input.target - state.chestX));
	else if (input.dir) state.chestX += Math.sign(input.dir) * move;
	state.chestX = Math.max(TREASURE_CHEST_HALF, Math.min(400 - TREASURE_CHEST_HALF, state.chestX));
	state.t += TREASURE_STEP;
	for (const item of state.items) {
		if (item.outcome !== null || item.landAt > state.t + 1e-9) continue;
		const value = TREASURE_VALUE[item.kind];
		state.offered += value;
		const caught = Math.abs(item.landX - state.chestX) <= TREASURE_CHEST_HALF + TREASURE_RADIUS[item.kind] * 0.6;
		if (!caught) {
			item.outcome = "missed";
			events.push({ type: "miss", x: item.landX, kind: item.kind });
		} else if (value > 0) {
			item.outcome = "kept";
			state.treasure += value;
			if (item.kind === "coin") state.coins += 1;
			events.push({ type: "keep", x: item.landX, kind: item.kind, value });
		} else {
			item.outcome = "corrupted";
			const lost = Math.min(state.treasure, TREASURE_CORRUPT);
			state.treasure -= lost;
			state.corruptions += 1;
			events.push({ type: "corrupt", x: item.landX, kind: item.kind, lost });
		}
	}
	if (state.t >= TREASURE_SECONDS - 1e-9) {
		state.phase = state.treasure >= TREASURE_TARGET ? "won" : "lost";
		state.endedAt = state.t;
		events.push({ type: state.phase === "won" ? "won" : "lost" });
	}
	return state;
}

/** The round's result once it has ended: the share of the treasure offered that was kept. */
export function treasureResult(state: TreasureState): { won: boolean; score: number; count: number; seconds: number } | null {
	if (state.phase === "playing" || state.endedAt === null) return null;
	const seconds = Math.round(state.endedAt * 10) / 10;
	const score = Math.round(Math.max(0, Math.min(100, (state.treasure / Math.max(1, state.offered)) * 112)));
	return { won: state.phase === "won", score, count: state.treasure, seconds };
}
