/**
 * Crest Hopper's sea (LC-17851), drawn as pixel art: the whole picture is
 * painted into a 200x200 offscreen buffer and scaled up onto the 400x400
 * stage with smoothing off, so every pixel stays a crisp block. Seen from
 * above: the ship at the bottom, ten rows of swells rolling across, and Jesus
 * waiting in his light at the top, a figure in warm light with no face drawn.
 * A limited palette of night blues, white foam and gold.
 *
 * On top of the pixels, in the stage's own units, go the cues that make the
 * moment to press unmistakable (Austin's note on the storm game, LC-17851):
 * the glowing ring on the next row (gold: hop now; red: a trough, wait), the
 * "Tap or ↑" hint until the first hop, and a gust's arrow, countdown and
 * marker on the spot it will shove him to (green: safe; red: move).
 */

import {
	CREST_COLS,
	CREST_FAITH,
	CREST_GUST_WARN,
	CREST_HOP_AIR,
	CREST_LIGHT_ROW,
	CREST_SHIP_LANES,
	CREST_SHOVE_AIR,
	cellAt,
	crestAt,
	hopUpHolds,
	shoveLands,
	type CrestEvent,
	type CrestState,
} from "@/lib/beta/games/crest-hopper-rules";

/** The buffer's size in pixels; the stage is twice that in its units. */
export const HOPPER_PIXELS = 200;
const SCALE = 2;
const CELL = 16;
const ROW = 15;
const FIELD = CREST_COLS * CELL;
const M = (HOPPER_PIXELS - FIELD) / 2;

const P = {
	abyss: "#05071a",
	deep: "#0a1033",
	trough: "#111b4f",
	ripple: "#1a2a6b",
	crestDark: "#1d3c8a",
	crest: "#2a58b0",
	crestLight: "#4b82d6",
	foam: "#bfe0ff",
	white: "#ffffff",
	calm: "#162a66",
	gold: "#f2b84b",
	goldLight: "#ffd97a",
	goldPale: "#fff3c4",
	robe: "#f6efdc",
	robeShade: "#d2c6a6",
	glowSkin: "#ffe6b3",
	hand: "#f0c99a",
	tunic: "#b8643a",
	tunicDark: "#7d3f22",
	skin: "#e2a77a",
	hair: "#3b2416",
	belt: "#4a2a17",
	wood: "#6b4426",
	woodDark: "#3f2512",
	woodLight: "#946238",
	panel: "#080c26",
	panelLine: "#1d2a66",
	hud: "#f1eadc",
	hudDim: "#8d98c4",
	danger: "#e2735a",
	ember: "#3a2f4a",
	rain: "#3f5fae",
	rock: "#1b2140",
	rockLight: "#2b3360",
} as const;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	color: string;
	gravity: number;
}

interface Pop {
	text: string;
	x: number;
	y: number;
	age: number;
	color: string;
}

interface Streak {
	x: number;
	y: number;
	len: number;
	speed: number;
}

/** A ring of light where he landed, in buffer pixels. */
interface Ripple {
	x: number;
	y: number;
	age: number;
	good: boolean;
}

/** Everything the picture remembers between frames: splashes, pops, the wind and the flashes. Never the game itself. */
export interface HopperLook {
	particles: Particle[];
	pops: Pop[];
	streaks: Streak[];
	ripples: Ripple[];
	rain: { x: number; y: number }[];
	shake: number;
	/** Seconds since the last gust shoved, the last slip, the win. */
	gustAge: number;
	slipAge: number;
	wonAge: number | null;
	/** Peter's place in the light once he reaches it, easing to Jesus' side. */
	arrive: number;
}

export function createLook(): HopperLook {
	return { particles: [], pops: [], streaks: [], ripples: [], rain: [], shake: 0, gustAge: 9, slipAge: 9, wonAge: null, arrive: 0 };
}

function laneX(x: number): number {
	return M + CELL / 2 + x * CELL;
}

function rowY(row: number): number {
	return HOPPER_PIXELS - 14 - row * ROW;
}

/** Where Peter is drawn: his lane, his row (between two while hopping) and how high the hop has lifted him. */
function peterPose(state: CrestState): { x: number; row: number; lift: number } {
	const hop = state.hop;
	if (!hop || state.air <= 0) return { x: state.x, row: state.row, lift: 0 };
	const air = hop.kind === "shove" ? CREST_SHOVE_AIR : CREST_HOP_AIR;
	const done = 1 - state.air / air;
	return { x: state.x, row: hop.fromRow + (hop.toRow - hop.fromRow) * done, lift: Math.sin(done * Math.PI) * (hop.kind === "shove" ? 3 : 6) };
}

function burst(look: HopperLook, x: number, y: number, count: number, colors: readonly string[], speed: number, gravity: number, life: number) {
	for (let i = 0; i < count; i++) {
		const angle = Math.random() * Math.PI * 2;
		const v = speed * (0.4 + Math.random() * 0.8);
		look.particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v * 0.6 - speed * 0.3, life, max: life, color: colors[i % colors.length], gravity });
	}
}

function pop(look: HopperLook, text: string, x: number, y: number, color: string) {
	const half = textWidth(text) / 2;
	for (const older of look.pops) older.y -= 7;
	look.pops.push({ text, x: Math.min(M + FIELD - half - 2, Math.max(M + half + 2, x)), y, age: 0, color });
	if (look.pops.length > 3) look.pops.shift();
}

/** Feeds the round's events into the picture: splashes, foam, sparkles and flashes. */
export function lookEvents(look: HopperLook, state: CrestState, events: readonly CrestEvent[], reduceMotion: boolean) {
	for (const event of events) {
		switch (event.type) {
			case "land": {
				const x = laneX(event.x);
				const y = rowY(event.row);
				burst(look, x, y - 1, 6, [P.foam, P.white], 22, 40, 0.35);
				look.ripples.push({ x, y, age: 0, good: true });
				break;
			}
			case "slip": {
				const x = laneX(event.x);
				const y = rowY(event.row);
				burst(look, x, y, 22, [P.white, P.foam, P.crestLight], 50, 90, 0.7);
				look.ripples.push({ x, y, age: 0, good: false });
				pop(look, event.faith > 0 ? "-1 FAITH" : "SINKING", x, y - 16, P.danger);
				look.slipAge = 0;
				if (!reduceMotion) look.shake = 0.3;
				break;
			}
			case "gust":
			case "shoved":
				look.gustAge = 0;
				break;
			case "steady":
				pop(look, "STEADY", laneX(state.x), rowY(state.row) - 16, P.goldLight);
				look.ripples.push({ x: laneX(state.x), y: rowY(state.row), age: 0, good: true });
				break;
			case "won": {
				look.wonAge = 0;
				const x = laneX(state.x);
				const y = rowY(CREST_LIGHT_ROW);
				burst(look, x, y - 8, 34, [P.goldLight, P.goldPale, P.white], 50, -12, 1.4);
				break;
			}
			default:
				break;
		}
	}
}

/** Moves the splashes, the flashes and the weather along by `dt` seconds. */
export function stepLook(look: HopperLook, state: CrestState, dt: number, reduceMotion: boolean) {
	const w = HOPPER_PIXELS;
	const h = HOPPER_PIXELS;
	look.shake = Math.max(0, look.shake - dt);
	look.gustAge += dt;
	look.slipAge += dt;
	if (look.wonAge !== null) {
		look.wonAge += dt;
		look.arrive = Math.min(1, look.wonAge / 0.9);
	}
	for (const particle of look.particles) {
		particle.life -= dt;
		particle.vy += particle.gravity * dt;
		particle.x += particle.vx * dt;
		particle.y += particle.vy * dt;
	}
	look.particles = look.particles.filter((particle) => particle.life > 0);
	for (const item of look.pops) {
		item.age += dt;
		item.y -= dt * 14;
	}
	look.pops = look.pops.filter((item) => item.age < 0.9);
	for (const ripple of look.ripples) ripple.age += dt;
	look.ripples = look.ripples.filter((ripple) => ripple.age < 0.45);

	// The wind contrary: streaks while a gust is coming, a burst when it shoves, and the rain driven by it.
	const calm = state.phase === "won";
	const wind = state.gust?.dir ?? (look.gustAge < 0.6 ? (state.shove?.dir ?? 0) : 0);
	const rate = calm ? 0 : state.gust ? 30 : look.gustAge < 0.5 ? 80 : 0;
	if (!reduceMotion && wind !== 0 && Math.random() < rate * dt) {
		const left = wind > 0;
		look.streaks.push({ x: left ? -16 : w + 16, y: 30 + Math.random() * (h - 40), len: 6 + Math.floor(Math.random() * 12), speed: wind * (190 + Math.random() * 90) });
	}
	for (const streak of look.streaks) streak.x += streak.speed * dt;
	look.streaks = look.streaks.filter((streak) => streak.x > -40 && streak.x < w + 40);

	const drops = calm ? 0 : reduceMotion ? 14 : 34;
	while (look.rain.length < drops) look.rain.push({ x: Math.random() * w, y: Math.random() * h });
	if (look.rain.length > drops) look.rain.length = drops;
	const slant = 18 + 50 * Math.abs(wind) * (wind < 0 ? -1 : 1);
	for (const drop of look.rain) {
		drop.y += dt * (reduceMotion ? 40 : 120);
		drop.x += dt * slant;
		if (drop.y > h) drop.y -= h + 4;
		if (drop.x > w) drop.x -= w;
		if (drop.x < 0) drop.x += w;
	}
}

// --- drawing ---------------------------------------------------------------

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
	ctx.fillStyle = color;
	ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** A 3x5 pixel font, one string of fifteen bits a glyph, read row by row. */
const GLYPHS: Record<string, string> = {
	"0": "111101101101111",
	"1": "010110010010111",
	"2": "111001111100111",
	"3": "111001111001111",
	"4": "101101111001001",
	"5": "111100111001111",
	"6": "111100111101111",
	"7": "111001010010010",
	"8": "111101111101111",
	"9": "111101111001111",
	A: "010101111101101",
	C: "011100100100011",
	R: "110101110101101",
	P: "110101110100100",
	D: "110101101101110",
	E: "111100110100111",
	F: "111100110100100",
	G: "011100101101011",
	H: "101101111101101",
	I: "111010010010111",
	K: "101101110101101",
	L: "100100100100111",
	N: "110101101101101",
	O: "010101101101010",
	S: "011100010001110",
	T: "111010010010010",
	U: "101101101101111",
	W: "101101111111101",
	Y: "101101010010010",
	"+": "000010111010000",
	"-": "000000111000000",
};

function textWidth(text: string, size = 1): number {
	return text.length * 4 * size - size;
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 1, shadow: string | null = P.abyss) {
	const draw = (ox: number, oy: number, fill: string) => {
		ctx.fillStyle = fill;
		let cx = Math.round(x) + ox;
		for (const char of text.toUpperCase()) {
			const glyph = GLYPHS[char];
			if (glyph) {
				for (let i = 0; i < 15; i++) if (glyph[i] === "1") ctx.fillRect(cx + (i % 3) * size, Math.round(y) + oy + Math.floor(i / 3) * size, size, size);
			}
			cx += 4 * size;
		}
	};
	if (shadow) draw(size, size, shadow);
	draw(0, 0, color);
}

/** 4x4 ordered dither: true where a pixel at (x, y) is lit at `level` 0-1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function dithered(x: number, y: number, level: number): boolean {
	return level * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5;
}

let glowCache: HTMLCanvasElement | null = null;
/** Jesus' light: rings of gold dithered out into the night, painted once and reused. */
function glow(): HTMLCanvasElement | null {
	if (glowCache || typeof document === "undefined") return glowCache;
	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const c = size / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const d = Math.hypot(x - c, (y - c) * 1.15) / c;
			let color: string | null = null;
			if (d < 0.16) color = P.goldPale;
			else if (d < 0.3) color = dithered(x, y, 1 - (d - 0.16) / 0.14) ? P.goldPale : P.goldLight;
			else if (d < 0.5) color = dithered(x, y, 1 - (d - 0.3) / 0.2) ? P.goldLight : P.gold;
			else if (d < 1) color = dithered(x, y, Math.pow(1 - (d - 0.5) / 0.5, 1.6) * 0.9) ? P.gold : null;
			if (color) {
				ctx.fillStyle = color;
				ctx.fillRect(x, y, 1, 1);
			}
		}
	}
	glowCache = canvas;
	return glowCache;
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
	const image = glow();
	if (!image || size <= 0) return;
	ctx.globalAlpha = alpha;
	ctx.drawImage(image, Math.round(x - size / 2), Math.round(y - size / 2), Math.round(size), Math.round(size));
	ctx.globalAlpha = 1;
}

function drawSeaRow(ctx: CanvasRenderingContext2D, state: CrestState, r: number, now: number, reduceMotion: boolean) {
	const row = state.rows[r];
	const top = Math.round(rowY(r) - ROW / 2);
	rect(ctx, P.trough, M, top, FIELD, ROW);
	rect(ctx, P.deep, M, top, FIELD, 1);
	// Ripples in the trough, drifting with the row.
	const drift = Math.floor(row.offset * 6);
	for (let i = -1; i < CREST_COLS + 1; i++) {
		const rx = M + i * CELL + ((((drift + r * 5) % CELL) + CELL) % CELL);
		if (rx < M || rx > M + FIELD - 4) continue;
		rect(ctx, P.ripple, rx, top + 7, 4, 1);
		rect(ctx, P.ripple, rx + 8, top + 10, 3, 1);
	}
	const first = Math.floor(-row.offset - 1);
	const tide = reduceMotion ? 0 : Math.floor(now * 8);
	ctx.save();
	ctx.beginPath();
	ctx.rect(M, top, FIELD, ROW);
	ctx.clip();
	for (let k = first; k <= first + CREST_COLS + 2; k++) {
		if (!crestAt(row, k)) continue;
		const x = Math.round(M + (k + row.offset) * CELL);
		const open = !crestAt(row, k - 1);
		const close = !crestAt(row, k + 1);
		// The swell's shadow on the trough, its body in three blues, its cap of foam.
		rect(ctx, P.deep, x, top + 13, CELL, 2);
		rect(ctx, P.crestDark, x, top + 10, CELL, 3);
		rect(ctx, P.crest, x, top + 5, CELL, 5);
		rect(ctx, P.crestLight, x, top + 3, CELL, 2);
		rect(ctx, P.foam, x, top + 2, CELL, 1);
		rect(ctx, P.foam, x + 1, top + 1, 3, 1);
		rect(ctx, P.foam, x + 9, top + 1, 3, 1);
		rect(ctx, P.white, x + 2, top + 1, 1, 1);
		rect(ctx, P.white, x + 10, top + 1, 1, 1);
		// Wave lines across the body.
		const a = (k * 5) & 7;
		rect(ctx, P.crestLight, x + a, top + 6, 3, 1);
		rect(ctx, P.crestLight, x + a + 3, top + 7, 2, 1);
		rect(ctx, P.crestDark, x + ((a + 8) & 15), top + 8, 4, 1);
		// A glint running along the cap.
		rect(ctx, P.white, x + ((k * 7 + tide) & 15), top + 3, 2, 1);
		const leftFace = row.dir < 0;
		for (const [end, ex, outward] of [
			[open, x, -1],
			[close, x + CELL - 1, 1],
		] as const) {
			if (!end) continue;
			const face = (outward < 0) === leftFace;
			if (face) {
				// The breaking face: a curl of white foam leaning the way the swell rolls, spray off its lip.
				rect(ctx, P.trough, ex, top + 1, 1, 1);
				rect(ctx, P.trough, ex, top + 12, 1, 1);
				rect(ctx, P.white, ex, top + 2, 1, 8);
				rect(ctx, P.foam, ex - outward, top + 3, 1, 6);
				rect(ctx, P.white, ex + outward, top + 2, 1, 2);
				rect(ctx, P.foam, ex + outward * 2, top + 3, 1, 1);
				const flick = reduceMotion ? 0 : (tide + k) % 4;
				rect(ctx, P.foam, ex + outward * (2 + (flick & 1)), top + 5 + flick, 1, 1);
				rect(ctx, P.white, ex + outward * 3, top + 1 + (flick % 2), 1, 1);
			} else {
				// The back of the swell slopes away.
				rect(ctx, P.trough, ex, top + 1, 1, 3);
				rect(ctx, P.trough, ex - outward, top + 1, 1, 1);
				rect(ctx, P.trough, ex - outward * 2, top + 1, 1, 1);
				rect(ctx, P.crestLight, ex, top + 4, 1, 1);
				rect(ctx, P.trough, ex, top + 12, 1, 3);
				rect(ctx, P.crestDark, ex - outward, top + 12, 1, 1);
			}
		}
	}
	ctx.restore();
	// Which way the row rolls: a chevron of foam on each bank.
	const chevron = row.dir > 0 ? ">" : "<";
	const cy = top + 5;
	for (const bx of [M - 7, M + FIELD + 3]) {
		const x0 = chevron === ">" ? bx : bx + 2;
		rect(ctx, P.hudDim, x0, cy, 1, 1);
		rect(ctx, P.hudDim, x0 + (chevron === ">" ? 1 : -1), cy + 1, 1, 1);
		rect(ctx, P.hudDim, x0 + (chevron === ">" ? 2 : -2), cy + 2, 1, 1);
		rect(ctx, P.hudDim, x0 + (chevron === ">" ? 1 : -1), cy + 3, 1, 1);
		rect(ctx, P.hudDim, x0, cy + 4, 1, 1);
	}
}

function drawShip(ctx: CanvasRenderingContext2D, now: number, reduceMotion: boolean) {
	const cy = Math.round(rowY(0) + (reduceMotion ? 0 : Math.round(Math.sin(now * 1.4))));
	const x0 = M + CREST_SHIP_LANES[0] * CELL - 8;
	const x1 = M + (CREST_SHIP_LANES[1] + 1) * CELL + 8;
	const height = 22;
	const top = cy - 11;
	for (let i = 0; i < height; i++) {
		const t = Math.abs(i - (height - 1) / 2) / ((height - 1) / 2);
		const stern = Math.round(t * t * 6);
		const bow = Math.round(Math.pow(t, 1.4) * 18);
		const a = x0 + stern;
		const b = x1 - bow;
		const edge = i === 0 || i === height - 1;
		rect(ctx, edge ? P.woodDark : P.wood, a, top + i, b - a, 1);
		rect(ctx, P.woodDark, a, top + i, 1, 1);
		rect(ctx, P.woodDark, b - 1, top + i, 1, 1);
		if (!edge && i !== 1 && i !== height - 2) {
			rect(ctx, P.woodLight, a + 1, top + i, 1, 1);
			rect(ctx, P.woodLight, b - 2, top + i, 1, 1);
		}
		if (i === 1 || i === height - 2) rect(ctx, P.woodLight, a + 1, top + i, b - a - 2, 1);
		if (i % 4 === 3 && !edge) rect(ctx, P.woodDark, a + 3, top + i, b - a - 6, 1);
	}
	// The mast and its yard.
	const mx = M + 5 * CELL + 8;
	rect(ctx, P.woodDark, mx - 1, top + 3, 2, height - 6);
	rect(ctx, P.woodDark, mx - 2, cy - 2, 4, 4);
	rect(ctx, P.woodLight, mx - 1, cy - 1, 2, 2);
	// They that were in the ship.
	const crew: [number, string][] = [
		[x0 + 9, "#6d7f9e"],
		[x0 + 16, "#8a6f9e"],
		[x1 - 30, "#7f8e6a"],
	];
	for (const [x, robe] of crew) {
		rect(ctx, robe, x - 2, cy - 2, 5, 5);
		rect(ctx, P.hair, x - 1, cy - 1, 3, 3);
	}
}

function drawLight(ctx: CanvasRenderingContext2D, now: number, reduceMotion: boolean, won: number | null) {
	const y = rowY(CREST_LIGHT_ROW);
	const bottom = Math.round(y + ROW / 2);
	rect(ctx, P.calm, M, 0, FIELD, bottom);
	for (let row = 0; row < bottom; row += 6) {
		for (let i = 0; i < FIELD - 5; i += 12) rect(ctx, P.ripple, M + i + ((row * 5) % 12), row + 2, 5, 1);
	}
	const pulse = reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(now * 2);
	const bloom = won === null ? 0 : Math.min(1, won / 0.8);
	drawGlow(ctx, laneX(4), y - 6, (110 + 80 * bloom) * pulse, 0.5 + 0.3 * bloom);
	drawGlow(ctx, laneX(4), y - 6, 60, 1);
	rect(ctx, P.goldLight, M, bottom - 1, FIELD, 1);
}

/** A figure in warm light, robe and halo; no face is drawn. `reach` stretches a hand out toward Peter (-1 left, 1 right). */
function drawJesus(ctx: CanvasRenderingContext2D, cx: number, feet: number, reach: number) {
	cx = Math.round(cx);
	feet = Math.round(feet);
	rect(ctx, P.goldLight, cx - 5, feet, 11, 1);
	rect(ctx, P.robe, cx - 4, feet - 3, 9, 3);
	rect(ctx, P.robe, cx - 3, feet - 13, 7, 10);
	rect(ctx, P.robeShade, cx + 2, feet - 12, 2, 12);
	rect(ctx, P.gold, cx - 3, feet - 8, 7, 1);
	// Arms open, or one stretched forth.
	const out = reach === 0 ? 0 : reach > 0 ? 1 : -1;
	if (out >= 0) rect(ctx, P.robe, cx - 5, feet - 12, 2, 4);
	if (out <= 0) rect(ctx, P.robe, cx + 4, feet - 12, 2, 4);
	if (out >= 0) rect(ctx, P.hand, cx - 5, feet - 8, 2, 1);
	if (out <= 0) rect(ctx, P.hand, cx + 4, feet - 8, 2, 1);
	if (out !== 0) {
		const ax = out > 0 ? cx + 4 : cx - 9;
		rect(ctx, P.robe, ax, feet - 11, 6, 2);
		rect(ctx, P.hand, out > 0 ? ax + 6 : ax - 1, feet - 11, 2, 2);
	}
	// The head in light, and the halo.
	rect(ctx, P.glowSkin, cx - 2, feet - 18, 5, 5);
	rect(ctx, P.goldPale, cx - 1, feet - 19, 3, 1);
	rect(ctx, P.goldLight, cx - 4, feet - 20, 9, 1);
	rect(ctx, P.goldLight, cx - 4, feet - 13, 1, 1);
	rect(ctx, P.goldLight, cx + 4, feet - 13, 1, 1);
	rect(ctx, P.goldLight, cx - 4, feet - 20, 1, 6);
	rect(ctx, P.goldLight, cx + 4, feet - 20, 1, 6);
}

function drawPeter(ctx: CanvasRenderingContext2D, cx: number, feet: number, lift: number, mode: "stand" | "hop" | "slip", facing: number, now: number, sink = 0) {
	cx = Math.round(cx);
	feet = Math.round(feet);
	if (mode === "slip") {
		const y = feet + 2 + Math.round(sink * 5);
		// Head and arms above the water, a ring of foam about him.
		rect(ctx, P.tunic, cx - 3, y - 8, 6, 3);
		rect(ctx, P.skin, cx - 2, y - 12, 4, 4);
		rect(ctx, P.hair, cx - 2, y - 12, 4, 2);
		const wave = Math.round(Math.sin(now * 9));
		rect(ctx, P.skin, cx - 5, y - 13 + wave, 1, 4);
		rect(ctx, P.skin, cx + 4, y - 13 - wave, 1, 4);
		rect(ctx, P.trough, cx - 6, y - 5, 13, 6);
		rect(ctx, P.white, cx - 6, y - 6, 3, 1);
		rect(ctx, P.foam, cx - 3, y - 5, 7, 1);
		rect(ctx, P.white, cx + 4, y - 6, 3, 1);
		return;
	}
	if (lift > 0.5) rect(ctx, P.abyss, cx - 3, feet - 1, 7, 2);
	const y = Math.round(feet - lift);
	const bob = mode === "stand" ? (Math.sin(now * 3) > 0.6 ? 1 : 0) : 0;
	// Legs, tunic, belt.
	rect(ctx, P.skin, cx - 2, y - 2, 1, 2);
	rect(ctx, P.skin, cx + 1, y - 2, 1, 2);
	rect(ctx, P.tunic, cx - 3, y - 8 + bob, 7, 6 - bob);
	rect(ctx, P.tunicDark, cx + 2, y - 8 + bob, 2, 6 - bob);
	rect(ctx, P.belt, cx - 3, y - 5, 7, 1);
	// Arms: at his sides, or up for balance in the air.
	if (mode === "hop") {
		rect(ctx, P.skin, cx - 5, y - 11, 1, 3);
		rect(ctx, P.skin, cx + 5, y - 11, 1, 3);
	} else {
		rect(ctx, P.skin, cx - 4, y - 8 + bob, 1, 3);
		rect(ctx, P.skin, cx + 4, y - 8 + bob, 1, 3);
	}
	// Head, hair and beard, turned the way he last hopped.
	rect(ctx, P.skin, cx - 2, y - 12 + bob, 5, 4);
	rect(ctx, P.hair, cx - 2, y - 12 + bob, 5, 1);
	rect(ctx, P.hair, facing < 0 ? cx + 2 : cx - 2, y - 11 + bob, 1, 2);
	rect(ctx, P.hair, cx - 1, y - 9 + bob, 3, 1);
}

function drawWeather(ctx: CanvasRenderingContext2D, look: HopperLook, reduceMotion: boolean) {
	for (const drop of look.rain) rect(ctx, P.rain, drop.x, drop.y, 1, reduceMotion ? 1 : 3);
	for (const streak of look.streaks) {
		rect(ctx, P.foam, streak.x, streak.y, streak.len, 1);
		rect(ctx, P.crestLight, streak.x - Math.sign(streak.speed) * 4, streak.y, 4, 1);
	}
}

/** A lamp's flame, one measure of faith: lit, or a cold ember once spent. */
function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean, flicker: number, flash: boolean) {
	if (!lit) {
		rect(ctx, P.ember, x + 3, y + 6, 4, 4);
		rect(ctx, P.ember, x + 4, y + 4, 2, 2);
	} else {
		const body = flash ? P.white : P.gold;
		rect(ctx, body, x + 2, y + 5, 6, 5);
		rect(ctx, body, x + 3, y + 3, 4, 2);
		rect(ctx, P.goldLight, x + 4, y + 1 + flicker, 2, 3 - flicker);
		rect(ctx, P.goldLight, x + 3, y + 6, 4, 3);
		rect(ctx, P.goldPale, x + 4, y + 7, 2, 2);
	}
	// The lamp under it.
	rect(ctx, P.woodLight, x + 1, y + 10, 8, 2);
	rect(ctx, P.woodDark, x + 2, y + 12, 6, 1);
}

function drawPanels(ctx: CanvasRenderingContext2D, look: HopperLook, state: CrestState, now: number, reduceMotion: boolean) {
	const h = HOPPER_PIXELS;
	// The banks of the sea: rocks either side of the swells.
	rect(ctx, P.panel, 0, 0, M, h);
	rect(ctx, P.panel, M + FIELD, 0, M, h);
	for (let y = 0; y < h; y += 6) {
		rect(ctx, P.rock, M - 3 - ((y / 6) % 2), y, 3, 4);
		rect(ctx, P.rock, M + FIELD + ((y / 6) % 2), y, 3, 4);
		rect(ctx, P.rockLight, M - 2, y + 1, 1, 1);
		rect(ctx, P.rockLight, M + FIELD + 1, y + 1, 1, 1);
	}
	// Faith: three lamps down the left bank.
	drawText(ctx, "FAITH", 4, 44, state.faith <= 1 ? P.danger : P.hudDim);
	const flash = !reduceMotion && look.slipAge < 0.45 && Math.floor(look.slipAge * 12) % 2 === 0;
	for (let i = 0; i < CREST_FAITH; i++) {
		const lit = i < state.faith;
		const flicker = reduceMotion ? 0 : Math.floor(now * 6 + i * 2) % 2;
		drawFlame(ctx, 9, 54 + i * 18, lit, flicker, flash && i === state.faith);
	}
	// The way to Jesus, ship to light, down the right bank.
	const tx = M + FIELD + 14;
	const top = rowY(CREST_LIGHT_ROW);
	const bottom = rowY(0);
	for (let y = top; y < bottom; y += 3) rect(ctx, P.panelLine, tx, y, 1, 2);
	rect(ctx, P.goldLight, tx - 2, top - 2, 5, 5);
	rect(ctx, P.goldPale, tx - 1, top - 1, 3, 3);
	rect(ctx, P.woodLight, tx - 2, bottom - 1, 5, 3);
	const at = rowY(peterPose(state).row);
	rect(ctx, P.tunic, tx - 2, Math.round(at) - 2, 5, 4);
	rect(ctx, P.skin, tx - 1, Math.round(at) - 4, 3, 2);
}

/** Paints one frame into the buffer (HOPPER_PIXELS square). */
export function drawHopper(ctx: CanvasRenderingContext2D, look: HopperLook, state: CrestState, now: number, reduceMotion: boolean) {
	const size = HOPPER_PIXELS;
	rect(ctx, P.abyss, 0, 0, size, size);
	rect(ctx, P.trough, M, rowY(0) - ROW / 2, FIELD, size);
	for (let r = 1; r < CREST_LIGHT_ROW; r++) drawSeaRow(ctx, state, r, now, reduceMotion);
	drawShip(ctx, now, reduceMotion);
	drawLight(ctx, now, reduceMotion, look.wonAge);

	// Landing ripples: white for a crest, red for a trough.
	for (const ripple of look.ripples) {
		const r = 3 + ripple.age * 26;
		const color = ripple.good ? P.white : P.danger;
		for (let a = 0; a < 16; a++) {
			const angle = (a / 16) * Math.PI * 2;
			if (ripple.age > 0.3 && a % 2) continue;
			rect(ctx, color, ripple.x + Math.cos(angle) * r, ripple.y + Math.sin(angle) * r * 0.45, 1, 1);
		}
	}

	// Jesus in his light; reaching it, Peter goes to his side and he stretches forth his hand (v31).
	const pose = peterPose(state);
	const won = state.phase === "won";
	if (won) {
		const goal = state.x <= 4 ? 3.1 : 4.9;
		pose.x = state.x + (goal - state.x) * (1 - Math.pow(1 - look.arrive, 2));
	}
	const lightY = rowY(CREST_LIGHT_ROW) + 4;
	drawJesus(ctx, laneX(4), lightY, won ? (state.x > 4 ? 1 : -1) : 0);

	const px = laneX(pose.x);
	const py = rowY(pose.row) + 3;
	const facing = state.hop ? Math.sign(state.hop.target - state.hop.fromX) || 1 : 1;
	if (state.phase === "lost" && state.lostBy === "faith") drawPeter(ctx, px, py, 0, "slip", facing, now, Math.min(1, look.slipAge / 1.2));
	else if (state.stun > 0) drawPeter(ctx, px, py, 0, "slip", facing, now);
	else drawPeter(ctx, px, py, pose.lift, pose.lift > 0 ? "hop" : "stand", facing, now);

	for (const particle of look.particles) {
		if (particle.life < particle.max * 0.25 && Math.floor(particle.life * 30) % 2 === 0) continue;
		rect(ctx, particle.color, particle.x, particle.y, 1, 1);
	}
	drawWeather(ctx, look, reduceMotion);

	// Fear closing in at the last measure of faith.
	if (state.faith <= 1 && !won) {
		const depth = state.faith === 0 ? 14 : 8;
		for (let i = 0; i < depth; i++) {
			for (let x = M + (i % 2) * 2; x < M + FIELD; x += 4) {
				rect(ctx, P.abyss, x, i, 1, 1);
				rect(ctx, P.abyss, x + 1, size - 1 - i, 1, 1);
			}
		}
	}
	for (const item of look.pops) drawText(ctx, item.text, item.x - textWidth(item.text) / 2, item.y, item.color);
	drawPanels(ctx, look, state, now, reduceMotion);
}

// --- the cues, in stage units (twice the buffer's pixels) -------------------

/**
 * What the ring on the next row says right now: "hop" (gold), "wait" (red) or
 * null when no ring shows. Gold only while a hop pressed at any moment over a
 * player's reaction time from now would still land on a crest.
 */
export function ringState(state: CrestState): "hop" | "wait" | null {
	if (state.phase !== "playing" || state.air > 0 || state.stun > 0 || state.row >= CREST_LIGHT_ROW) return null;
	return hopUpHolds(state) ? "hop" : "wait";
}

/**
 * Where a gust will shove him and whether that is a crest, or null with no
 * gust shown. In the air or floundering there is no spot to mark yet
 * (`marked` false): it shoves him where he lands.
 */
export function gustTarget(state: CrestState): { x: number; row: number; safe: boolean; marked: boolean } | null {
	if (!state.gust || state.phase !== "playing") return null;
	const row = state.rows[state.row];
	if (state.air > 0 || state.stun > 0) return { x: state.x, row: state.row, safe: true, marked: false };
	if (row.kind !== "sea") return { x: state.x, row: state.row, safe: true, marked: false };
	const k = cellAt(row, state.x) + state.gust.dir;
	return { x: k + row.offset, row: state.row, safe: shoveLands(state, state.gust.dir), marked: true };
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, color: string, size = 18) {
	ctx.font = `900 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	const width = ctx.measureText(text).width + size * 1.1;
	const left = Math.max(M * SCALE + 4, Math.min(HOPPER_PIXELS * SCALE - M * SCALE - 4 - width, x - width / 2));
	ctx.fillStyle = fill;
	ctx.beginPath();
	ctx.roundRect(left, y - size * 0.85, width, size * 1.7, size * 0.85);
	ctx.fill();
	ctx.fillStyle = color;
	ctx.fillText(text, left + width / 2, y + 1);
}

/** Draws the cues over the scaled-up pixels: the ring, the first-hop hint, the gust's warning and the flashes. */
export function drawCues(ctx: CanvasRenderingContext2D, look: HopperLook, state: CrestState, now: number, reduceMotion: boolean) {
	const S = SCALE;
	const pulse = reduceMotion ? 1 : 0.5 + 0.5 * Math.sin(now * 9);
	const ring = ringState(state);
	if (ring) {
		const x = laneX(state.x) * S;
		const y = (rowY(state.row + 1) + 1) * S;
		ctx.save();
		ctx.lineWidth = ring === "hop" ? 4 : 3;
		if (ring === "hop") {
			ctx.strokeStyle = "#ffd97a";
			ctx.shadowColor = "rgba(255,217,122,.9)";
			ctx.shadowBlur = reduceMotion ? 8 : 6 + 10 * pulse;
			ctx.beginPath();
			ctx.ellipse(x, y, 15 + 2 * pulse, 9 + pulse, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.shadowBlur = 0;
			// An arrow up from Peter to the ring.
			ctx.fillStyle = "#ffd97a";
			ctx.beginPath();
			ctx.moveTo(x, y + 14);
			ctx.lineTo(x - 7, y + 22);
			ctx.lineTo(x + 7, y + 22);
			ctx.closePath();
			ctx.fill();
		} else {
			ctx.strokeStyle = "rgba(226,115,90,.85)";
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.ellipse(x, y, 14, 8, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(x - 5, y - 4);
			ctx.lineTo(x + 5, y + 4);
			ctx.moveTo(x + 5, y - 4);
			ctx.lineTo(x - 5, y + 4);
			ctx.stroke();
		}
		ctx.restore();
	}

	// Until the first hop: how to hop, pulsing over the ring.
	if (state.phase === "playing" && state.hops === 0 && state.slips === 0 && state.row === 0 && state.air === 0) {
		const y = (rowY(1) - 16) * S;
		ctx.globalAlpha = reduceMotion ? 1 : 0.75 + 0.25 * pulse;
		pill(ctx, ring === "hop" ? "Tap or ↑  Hop now!" : "Wait for the gold ring", laneX(state.x) * S, y, ring === "hop" ? "#ffd97a" : "rgba(5,7,26,.85)", ring === "hop" ? "#1a1206" : "#f1eadc", 17);
		ctx.globalAlpha = 1;
	}

	// A gust coming: its arrow, its countdown, and the spot it will shove him to.
	const target = gustTarget(state);
	if (state.gust && target) {
		const left = Math.max(0, state.gust.at - state.t);
		const arrow = state.gust.dir > 0 ? "→" : "←";
		const label = target.safe ? `Gust ${arrow}  ${left.toFixed(1)}` : `Gust ${arrow}  Move!  ${left.toFixed(1)}`;
		// Over the open sea: low while Peter is high, high while he is low.
		const y = state.row >= 6 ? 372 : 118;
		ctx.globalAlpha = reduceMotion || Math.floor(now * 6) % 2 === 0 ? 1 : 0.85;
		pill(ctx, label, HOPPER_PIXELS, y, target.safe ? "rgba(191,224,255,.95)" : "#e2735a", "#05071a", 20);
		ctx.globalAlpha = 1;
		// The countdown draining under the label.
		const width = 150;
		ctx.fillStyle = "rgba(5,7,26,.7)";
		ctx.fillRect(HOPPER_PIXELS - width / 2, y + 22, width, 5);
		ctx.fillStyle = target.safe ? "#bfe0ff" : "#e2735a";
		ctx.fillRect(HOPPER_PIXELS - width / 2, y + 22, width * Math.min(1, left / CREST_GUST_WARN), 5);
		// Where it will shove him.
		if (target.marked) {
			const x = laneX(target.x) * S;
			const ty = rowY(target.row) * S;
			ctx.save();
			ctx.lineWidth = 3;
			ctx.strokeStyle = target.safe ? "#7ee0a1" : "#ff6b5a";
			ctx.globalAlpha = target.safe ? 0.9 : 0.6 + 0.4 * pulse;
			ctx.strokeRect(x - 14, ty - 12, 28, 24);
			if (!target.safe) {
				ctx.beginPath();
				ctx.moveTo(x - 8, ty - 7);
				ctx.lineTo(x + 8, ty + 7);
				ctx.moveTo(x + 8, ty - 7);
				ctx.lineTo(x - 8, ty + 7);
				ctx.stroke();
			}
			// The arrow from Peter to it.
			const from = laneX(state.x) * S;
			const dir = state.gust.dir;
			ctx.fillStyle = ctx.strokeStyle;
			ctx.beginPath();
			ctx.moveTo(from + dir * 10, ty - 22);
			ctx.lineTo(from + dir * 24, ty - 22);
			ctx.lineTo(from + dir * 24, ty - 27);
			ctx.lineTo(from + dir * 32, ty - 20);
			ctx.lineTo(from + dir * 24, ty - 13);
			ctx.lineTo(from + dir * 24, ty - 18);
			ctx.lineTo(from + dir * 10, ty - 18);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}
	}

	// Flashes: red on a slip, a cool sweep when a gust shoves, gold on reaching Jesus.
	if (look.slipAge < 0.35) {
		ctx.fillStyle = `rgba(226,60,50,${0.32 * (1 - look.slipAge / 0.35)})`;
		ctx.fillRect(0, 0, HOPPER_PIXELS * S, HOPPER_PIXELS * S);
	}
	if (look.gustAge < 0.25 && state.phase === "playing") {
		ctx.fillStyle = `rgba(191,224,255,${0.18 * (1 - look.gustAge / 0.25)})`;
		ctx.fillRect(0, 0, HOPPER_PIXELS * S, HOPPER_PIXELS * S);
	}
	if (look.wonAge !== null && look.wonAge < 0.7) {
		ctx.fillStyle = `rgba(255,243,196,${0.45 * (1 - look.wonAge / 0.7)})`;
		ctx.fillRect(0, 0, HOPPER_PIXELS * S, HOPPER_PIXELS * S);
	}
	if (state.phase === "lost") {
		ctx.fillStyle = "rgba(5,7,26,.35)";
		ctx.fillRect(0, 0, HOPPER_PIXELS * S, HOPPER_PIXELS * S);
	}
}
