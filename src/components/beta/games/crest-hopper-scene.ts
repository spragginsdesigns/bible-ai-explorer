/**
 * Crest Hopper's sea (LC-17851), drawn as pixel art: the whole picture is
 * painted into a small offscreen buffer (about 180 pixels across) and scaled
 * up with smoothing off, so every pixel stays a crisp block. Seen from above:
 * the ship at the bottom, rows of swells rolling across, and Jesus waiting in
 * his light at the top, a figure in warm light with no face drawn. A limited
 * palette of night blues, white foam and gold.
 */

import {
	HOPPER_COLS,
	HOPPER_HOP_AIR,
	HOPPER_LIGHT_ROW,
	HOPPER_SHIP_LANES,
	HOPPER_START,
	crestAt,
	hopperProgress,
	type HopperEvent,
	type HopperState,
} from "@/lib/beta/games/crest-hopper-rules";

const CELL = 16;
const ROW = 16;
const FIELD = HOPPER_COLS * CELL;

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
	rest: "#2a4c9e",
	restLight: "#5b8fe0",
	calm: "#162a66",
	gold: "#f2b84b",
	goldLight: "#ffd97a",
	goldPale: "#fff3c4",
	goldDeep: "#b9781f",
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
	rain: "#3f5fae",
} as const;

/** The picture's size in buffer pixels for a stage, and the whole-number scale it is drawn up at. */
export function hopperLayout(width: number, height: number): { scale: number; w: number; h: number } {
	const scale = Math.max(1, Math.min(Math.floor(width / 150), Math.floor(height / 150)));
	return { scale, w: Math.max(FIELD + 8, Math.ceil(width / scale)), h: Math.max(120, Math.ceil(height / scale)) };
}

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

/** Everything the picture remembers between frames: the camera, splashes, score pops and the wind. Never the game itself. */
export interface HopperLook {
	cam: number;
	particles: Particle[];
	pops: Pop[];
	streaks: Streak[];
	rain: { x: number; y: number }[];
	shake: number;
	/** Seconds since the last gust shoved, for the wind's burst. */
	gustAge: number;
	/** Seconds since the last slip, for the red flash of the meter. */
	slipAge: number;
	/** When the rescue and the arrival began (seconds on the page's clock), or null. */
	rescueAt: number | null;
	arriveAt: number | null;
	/** The gold of the combo, fading. */
	comboGlow: number;
	w: number;
	h: number;
}

export function createLook(): HopperLook {
	return { cam: 0, particles: [], pops: [], streaks: [], rain: [], shake: 0, gustAge: 9, slipAge: 9, rescueAt: null, arriveAt: null, comboGlow: 0, w: 0, h: 0 };
}

function laneX(look: HopperLook, x: number): number {
	return margin(look) + CELL / 2 + x * CELL;
}

function margin(look: HopperLook): number {
	return Math.floor((look.w - FIELD) / 2);
}

function baseY(look: HopperLook): number {
	return Math.round(look.h * 0.64);
}

function rowY(look: HopperLook, row: number): number {
	return baseY(look) - (row - look.cam) * ROW;
}

/** Where Peter is drawn: his lane, his row (between two while hopping) and how high the hop has lifted him. */
function peterPose(state: HopperState): { x: number; row: number; lift: number } {
	const hop = state.hop;
	if (!hop || state.air <= 0) return { x: state.x, row: state.row, lift: 0 };
	const air = hop.kind === "shove" ? 0.16 : HOPPER_HOP_AIR;
	const done = 1 - state.air / air;
	return { x: state.x, row: hop.fromRow + (hop.toRow - hop.fromRow) * done, lift: Math.sin(done * Math.PI) * (hop.kind === "shove" ? 3 : 6) };
}

function camTarget(look: HopperLook, row: number): number {
	// The ship whole above the bottom of the picture (and the phone's faith strip), Jesus' light well inside the top.
	const bottom = (look.h - (margin(look) >= 44 ? 20 : 30) - baseY(look)) / ROW;
	const top = HOPPER_LIGHT_ROW - (baseY(look) - 40) / ROW;
	return Math.min(top, Math.max(bottom, row));
}

function burst(look: HopperLook, x: number, y: number, count: number, colors: readonly string[], speed: number, gravity: number, life: number) {
	for (let i = 0; i < count; i++) {
		const angle = Math.random() * Math.PI * 2;
		const v = speed * (0.4 + Math.random() * 0.8);
		look.particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v * 0.6 - speed * 0.3, life, max: life, color: colors[i % colors.length], gravity });
	}
}

function pop(look: HopperLook, text: string, x: number, y: number, color: string) {
	const m = margin(look);
	const half = textWidth(text) / 2;
	for (const older of look.pops) older.y -= 7;
	look.pops.push({ text, x: Math.min(m + FIELD - half - 2, Math.max(m + half + 2, x)), y, age: 0, color });
	if (look.pops.length > 4) look.pops.shift();
}

/** Feeds the game's events into the picture: splashes, foam, sparkles and the score's pops. */
export function lookEvents(look: HopperLook, state: HopperState, events: readonly HopperEvent[], now: number, reduceMotion: boolean) {
	for (const event of events) {
		switch (event.type) {
			case "land": {
				const x = laneX(look, event.x);
				const y = rowY(look, event.row);
				burst(look, x, y - 1, 5, [P.foam, P.white], 22, 40, 0.35);
				if (event.points > 0) pop(look, event.combo > 1 ? `+${event.points} X${event.combo}` : `+${event.points}`, x, y - 16, event.combo > 2 ? P.goldLight : P.hud);
				if (event.combo > 2) {
					look.comboGlow = 1;
					burst(look, x, y - 8, 4 + event.combo, [P.goldLight, P.goldPale], 26, -10, 0.6);
				}
				break;
			}
			case "rest": {
				const y = rowY(look, event.row);
				pop(look, "CALM +100", laneX(look, state.x), y - 24, P.goldLight);
				break;
			}
			case "slip": {
				const x = laneX(look, event.x);
				const y = rowY(look, event.row);
				burst(look, x, y, 18, [P.white, P.foam, P.crestLight], 46, 90, 0.7);
				pop(look, "SLIP", x, y - 16, P.danger);
				look.slipAge = 0;
				if (!reduceMotion) look.shake = 0.3;
				break;
			}
			case "shoved":
				look.gustAge = 0;
				break;
			case "gust":
				look.gustAge = 0;
				break;
			case "rescued":
				look.rescueAt = now;
				break;
			case "arrived": {
				look.arriveAt = now;
				const x = laneX(look, state.x);
				const y = rowY(look, HOPPER_LIGHT_ROW);
				burst(look, x, y - 8, 30, [P.goldLight, P.goldPale, P.white], 50, -12, 1.4);
				pop(look, `+${event.bonus}`, x, y - 30, P.goldLight);
				break;
			}
			default:
				break;
		}
	}
}

/** Moves the camera, the splashes and the weather along by `dt` seconds. */
export function stepLook(look: HopperLook, state: HopperState, dt: number, w: number, h: number, reduceMotion: boolean) {
	if (look.w !== w || look.h !== h) {
		const first = look.w === 0;
		look.w = w;
		look.h = h;
		if (first) look.cam = camTarget(look, state.row);
	}
	const pose = peterPose(state);
	look.cam += (camTarget(look, pose.row) - look.cam) * Math.min(1, dt * 6);
	look.shake = Math.max(0, look.shake - dt);
	look.gustAge += dt;
	look.slipAge += dt;
	look.comboGlow = Math.max(0, look.comboGlow - dt * 1.5);
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

	// The wind contrary: streaks while a gust is coming, a burst when it shoves, and the rain driven by it.
	const calm = state.phase === "arrived" || state.phase === "rescued";
	const wind = state.gust?.dir ?? (look.gustAge < 0.6 ? (state.shove?.dir ?? 0) : 0);
	const rate = calm ? 0 : state.gust ? 26 : look.gustAge < 0.5 ? 70 : 0;
	if (!reduceMotion && wind !== 0 && Math.random() < rate * dt) {
		const left = wind > 0;
		look.streaks.push({ x: left ? -16 : w + 16, y: 14 + Math.random() * (h - 28), len: 6 + Math.floor(Math.random() * 12), speed: wind * (190 + Math.random() * 90) });
	}
	for (const streak of look.streaks) streak.x += streak.speed * dt;
	look.streaks = look.streaks.filter((streak) => streak.x > -40 && streak.x < w + 40);

	const drops = calm ? 0 : reduceMotion ? 14 : 34;
	while (look.rain.length < drops) look.rain.push({ x: Math.random() * w, y: Math.random() * h });
	if (look.rain.length > drops) look.rain.length = drops;
	const slant = 18 + 50 * Math.abs(wind) * (wind < 0 ? -1 : 1);
	for (const drop of look.rain) {
		drop.y += dt * 120;
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
	B: "110101110101110",
	C: "011100100100011",
	D: "110101101101110",
	E: "111100110100111",
	F: "111100110100100",
	G: "011100101101011",
	H: "101101111101101",
	I: "111010010010111",
	J: "001001001101010",
	K: "101101110101101",
	L: "100100100100111",
	M: "101111111101101",
	N: "110101101101101",
	O: "010101101101010",
	P: "110101110100100",
	Q: "010101101110011",
	R: "110101110101101",
	S: "011100010001110",
	T: "111010010010010",
	U: "101101101101111",
	V: "101101101101010",
	W: "101101111111101",
	X: "101101010101101",
	Y: "101101010010010",
	Z: "111001010100111",
	"%": "101001010100101",
	">": "100010001010100",
	"<": "001010100010001",
	"+": "000010111010000",
	"!": "010010010000010",
	":": "000010000010000",
	".": "000000000000010",
	"-": "000000111000000",
	"/": "001001010100100",
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

function drawSeaRow(ctx: CanvasRenderingContext2D, look: HopperLook, state: HopperState, r: number, now: number, reduceMotion: boolean) {
	const row = state.rows[r];
	const top = Math.round(rowY(look, r) - ROW / 2);
	const left = margin(look);
	rect(ctx, P.trough, left, top, FIELD, ROW);
	rect(ctx, P.deep, left, top, FIELD, 1);
	// Ripples in the trough, drifting with the row.
	const drift = Math.floor(row.offset * 6);
	for (let i = -1; i < HOPPER_COLS + 1; i++) {
		const rx = left + i * CELL + ((((drift + r * 5) % CELL) + CELL) % CELL);
		rect(ctx, P.ripple, rx, top + 7, 4, 1);
		rect(ctx, P.ripple, rx + 8, top + 11, 3, 1);
	}
	if (row.kind === "rest") {
		// One long, calm swell, crest from bank to bank.
		rect(ctx, P.rest, left, top + 3, FIELD, 10);
		rect(ctx, P.restLight, left, top + 3, FIELD, 2);
		rect(ctx, P.crestDark, left, top + 12, FIELD, 1);
		const shimmer = reduceMotion ? 0 : Math.floor(now * 3);
		for (let i = 0; i < FIELD; i += 7) if ((i + shimmer * 3 + r) % 5 === 0) rect(ctx, P.goldLight, left + i, top + 3, 2, 1);
		for (let i = 2; i < FIELD; i += 9) rect(ctx, P.foam, left + i, top + 2, 3, 1);
		return;
	}
	const first = Math.floor(-row.offset - 1);
	const tide = reduceMotion ? 0 : Math.floor(now * 8);
	for (let k = first; k <= first + HOPPER_COLS + 2; k++) {
		if (!crestAt(row, k)) continue;
		const x = Math.round(left + (k + row.offset) * CELL);
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
}

function drawShip(ctx: CanvasRenderingContext2D, look: HopperLook, now: number, reduceMotion: boolean) {
	const cy = Math.round(rowY(look, 0) + (reduceMotion ? 0 : Math.round(Math.sin(now * 1.4))));
	const left = margin(look);
	rect(ctx, P.trough, left, cy - 8, FIELD, ROW + 12);
	const x0 = left + HOPPER_SHIP_LANES[0] * CELL - 8;
	const x1 = left + (HOPPER_SHIP_LANES[1] + 1) * CELL + 8;
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
	// The wake along the hull.
	rect(ctx, P.foam, x0 + 4, top + height, x1 - x0 - 26, 1);
	rect(ctx, P.foam, x1 - 14, cy, 4, 1);
	// The mast and its yard.
	const mx = left + 5 * CELL + 8;
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

function drawLightRows(ctx: CanvasRenderingContext2D, look: HopperLook, now: number, reduceMotion: boolean) {
	const y = rowY(look, HOPPER_LIGHT_ROW);
	const bottom = Math.round(y + ROW / 2);
	if (bottom <= 0) return;
	const left = margin(look);
	rect(ctx, P.calm, left, 0, FIELD, bottom);
	for (let row = 0; row < bottom; row += 6) {
		for (let i = 0; i < FIELD; i += 12) rect(ctx, P.ripple, left + i + ((row * 5) % 12), row + 2, 5, 1);
	}
	const pulse = reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(now * 2);
	drawGlow(ctx, laneX(look, 4), y - 6, 150 * pulse, 0.55);
	drawGlow(ctx, laneX(look, 4), y - 6, 78, 1);
	rect(ctx, P.goldLight, left, bottom - 1, FIELD, 1);
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

function drawPeter(ctx: CanvasRenderingContext2D, cx: number, feet: number, lift: number, mode: "stand" | "hop" | "slip" | "sink", sink: number, facing: number, now: number) {
	cx = Math.round(cx);
	feet = Math.round(feet);
	if (mode === "slip" || mode === "sink") {
		const under = mode === "sink" ? Math.round(3 + sink * 6) : 2;
		const y = feet + under;
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

function meter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, value: number, vertical: boolean, low: boolean, flash: boolean) {
	rect(ctx, P.abyss, x - 1, y - 1, w + 2, h + 2);
	rect(ctx, P.panelLine, x, y, w, h);
	const fill = low ? P.danger : P.gold;
	if (vertical) {
		const filled = Math.round(h * value);
		rect(ctx, flash ? P.white : fill, x, y + h - filled, w, filled);
		if (filled > 1) rect(ctx, low ? "#f5a08a" : P.goldLight, x, y + h - filled, 1, filled);
		for (let i = y + 3; i < y + h; i += 4) rect(ctx, P.abyss, x, i, w, 1);
	} else {
		const filled = Math.round(w * value);
		rect(ctx, flash ? P.white : fill, x, y, filled, h);
		if (filled > 1) rect(ctx, low ? "#f5a08a" : P.goldLight, x, y, filled, 1);
		for (let i = x + 4; i < x + w; i += 5) rect(ctx, P.abyss, i, y, 1, h);
	}
}

function score6(score: number): string {
	return String(Math.min(999999, Math.max(0, Math.round(score)))).padStart(6, "0");
}

function drawHud(ctx: CanvasRenderingContext2D, look: HopperLook, state: HopperState, now: number, reduceMotion: boolean) {
	const { w, h } = look;
	const m = margin(look);
	const faith = state.faith / 100;
	const low = state.faith < 35;
	const flash = !reduceMotion && look.slipAge < 0.45 && Math.floor(look.slipAge * 12) % 2 === 0;
	const progress = hopperProgress(state);
	const comboColor = look.comboGlow > 0.1 || state.combo > 2 ? P.goldLight : P.hud;

	if (m >= 44) {
		// An arcade cabinet's side panels.
		rect(ctx, P.panel, 0, 0, m, h);
		rect(ctx, P.panel, m + FIELD, 0, w - m - FIELD, h);
		rect(ctx, P.panelLine, m - 2, 0, 1, h);
		rect(ctx, P.panelLine, m + FIELD + 1, 0, 1, h);
		rect(ctx, P.abyss, m - 1, 0, 1, h);
		rect(ctx, P.abyss, m + FIELD, 0, 1, h);
		const lx = 6;
		drawText(ctx, "SCORE", lx, 10, P.hudDim);
		drawText(ctx, score6(state.score), lx, 18, P.hud, Math.min(2, Math.floor((m - 10) / 23)));
		drawText(ctx, "COMBO", lx, 38, P.hudDim);
		drawText(ctx, state.combo > 1 ? `X${state.combo}` : "-", lx, 46, comboColor, 2);
		drawText(ctx, "HOPS", lx, 66, P.hudDim);
		drawText(ctx, String(state.cleanHops), lx, 74, P.hud);
		drawText(ctx, "SLIPS", lx, 86, P.hudDim);
		drawText(ctx, String(state.slips), lx, 94, state.slips ? P.danger : P.hud);
		const rx = m + FIELD + 6;
		drawText(ctx, "FAITH", rx, 24, low ? P.danger : P.hudDim);
		const barTop = 33;
		const barH = Math.max(30, h - barTop - 18);
		meter(ctx, rx + 2, barTop, 8, barH, faith, true, low, flash);
		drawText(ctx, `${Math.round(state.faith)}%`, rx, barTop + barH + 5, low ? P.danger : P.hud);
		// The way to Jesus, ship to light.
		const tx = rx + 22;
		if (tx + 4 < w) {
			rect(ctx, P.panelLine, tx, barTop, 1, barH);
			rect(ctx, P.goldLight, tx - 1, barTop - 2, 3, 3);
			rect(ctx, P.woodLight, tx - 1, barTop + barH - 1, 3, 2);
			rect(ctx, P.white, tx - 1, Math.round(barTop + barH - 2 - progress * (barH - 3)), 3, 2);
		}
	} else {
		// A phone: score across the top, faith along the bottom, the way to Jesus down the left bank.
		rect(ctx, P.panel, 0, 0, w, 14);
		rect(ctx, P.panelLine, 0, 14, w, 1);
		drawText(ctx, "SCORE", 3, 5, P.hudDim);
		drawText(ctx, score6(state.score), 24, 2, P.hud, 2);
		if (state.combo > 1) drawText(ctx, `X${state.combo}`, 24 + textWidth("000000", 2) + 4, 5, comboColor);
		rect(ctx, P.panel, 0, h - 11, w, 11);
		rect(ctx, P.panelLine, 0, h - 12, w, 1);
		drawText(ctx, "FAITH", 3, h - 8, low ? P.danger : P.hudDim);
		const barX = 24;
		const barW = w - barX - 22;
		meter(ctx, barX, h - 8, barW, 5, faith, false, low, flash);
		drawText(ctx, `${Math.round(state.faith)}%`, barX + barW + 4, h - 8, low ? P.danger : P.hud, 1);
		if (m >= 6) {
			const tx = Math.floor(m / 2);
			const top = 20;
			const bottom = h - 18;
			for (let y = top; y < bottom; y += 3) rect(ctx, P.panelLine, tx, y, 1, 2);
			rect(ctx, P.goldLight, tx - 1, top - 2, 3, 3);
			rect(ctx, P.woodLight, tx - 1, bottom, 3, 2);
			rect(ctx, P.white, tx - 1, Math.round(bottom - 1 - progress * (bottom - top - 2)), 3, 2);
		}
	}

	// A gust shown coming: the arrow says which way it will shove him.
	if (state.gust && state.phase === "playing") {
		const label = state.gust.dir > 0 ? "GUST >>" : "<< GUST";
		const blink = reduceMotion || Math.floor(now * 6) % 2 === 0;
		const tw = textWidth(label, 2);
		const x = m + Math.round((FIELD - tw) / 2);
		const y = m >= 44 ? 6 : 19;
		rect(ctx, P.abyss, x - 3, y - 2, tw + 6, 14);
		if (blink) drawText(ctx, label, x, y, P.foam, 2, null);
		else drawText(ctx, label, x, y, P.crestLight, 2, null);
	}
	if (state.phase === "playing" && state.t < HOPPER_START + 0.6) {
		const label = state.t < HOPPER_START ? "READY" : "HOP!";
		const tw = textWidth(label, 2);
		drawText(ctx, label, m + Math.round((FIELD - tw) / 2), Math.round(h * 0.42), P.goldLight, 2);
	}
}

export interface HopperFrame {
	state: HopperState;
	now: number;
	reduceMotion: boolean;
}

/** Paints one frame into the buffer (`look.w` by `look.h` pixels). */
export function drawHopper(ctx: CanvasRenderingContext2D, look: HopperLook, frame: HopperFrame) {
	const { state, now, reduceMotion } = frame;
	const { w, h } = look;
	ctx.save();
	if (look.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 3));
	// The deep beyond the lanes, and the banks of the field.
	rect(ctx, P.abyss, -4, -4, w + 8, h + 8);
	const m = margin(look);
	for (let y = 0; y < h; y += 2) {
		rect(ctx, P.deep, m - 3 + ((y / 2) % 2), y, 1, 1);
		rect(ctx, P.deep, m + FIELD + 2 - ((y / 2) % 2), y, 1, 1);
	}

	const lowest = Math.max(0, Math.floor(look.cam - (h - baseY(look)) / ROW) - 1);
	const highest = Math.min(HOPPER_LIGHT_ROW - 1, Math.ceil(look.cam + baseY(look) / ROW) + 1);
	// Below the ship, open sea.
	rect(ctx, P.trough, m, Math.round(rowY(look, 0) + ROW / 2), FIELD, h);
	for (let r = Math.max(1, lowest); r <= highest; r++) drawSeaRow(ctx, look, state, r, now, reduceMotion);
	if (lowest <= 1) drawShip(ctx, look, now, reduceMotion);
	drawLightRows(ctx, look, now, reduceMotion);

	// Jesus in his light: at the top, or come to Peter on a rescue (v31).
	const pose = peterPose(state);
	if (state.phase === "arrived" && look.arriveAt !== null) {
		// Reaching the light, Peter goes to Jesus' side.
		const t = Math.min(1, (now - look.arriveAt) / 0.9);
		const goal = state.x <= 4 ? 3.1 : 4.9;
		pose.x = state.x + (goal - state.x) * (1 - Math.pow(1 - t, 2));
	}
	const px = laneX(look, pose.x);
	const py = rowY(look, pose.row) + 3;
	const lightY = rowY(look, HOPPER_LIGHT_ROW) + 4;
	let jx = laneX(look, 4);
	let jy = lightY;
	let reach = 0;
	if (look.rescueAt !== null) {
		const t = Math.min(1, (now - look.rescueAt) / 1.1);
		const ease = 1 - Math.pow(1 - t, 3);
		const tx = px + (pose.x > 4 ? -14 : 14);
		jx = tx + (laneX(look, 4) - tx) * (1 - ease);
		jy = py + (-30 - py) * (1 - ease);
		reach = pose.x > 4 ? 1 : -1;
		drawGlow(ctx, jx, jy - 8, 110, 0.5 + 0.3 * ease);
	} else if (state.phase === "arrived") {
		reach = state.x > 4 ? 1 : -1;
	}
	if (jy > -40 && jy < h + 30) drawJesus(ctx, jx, jy, reach);

	// Peter.
	const facing = state.hop ? Math.sign(state.hop.target - state.hop.fromX) || 1 : 1;
	if (state.phase === "sinking" || (state.phase === "rescued" && look.rescueAt !== null && now - look.rescueAt < 0.8)) {
		drawPeter(ctx, px, py, 0, "sink", state.sink, facing, now);
	} else if (state.phase === "rescued") {
		// Caught and held up beside Jesus.
		drawPeter(ctx, px, py - 2, 0, "stand", 0, reach > 0 ? -1 : 1, now);
	} else if (state.stun > 0) {
		drawPeter(ctx, px, py, 0, "slip", 0, facing, now);
	} else {
		drawPeter(ctx, px, py, pose.lift, pose.lift > 0 ? "hop" : "stand", 0, facing, now);
	}

	for (const particle of look.particles) {
		if (particle.life < particle.max * 0.25 && Math.floor(particle.life * 30) % 2 === 0) continue;
		rect(ctx, particle.color, particle.x, particle.y, 1, 1);
	}
	drawWeather(ctx, look, reduceMotion);

	// Fear closing in as faith runs low.
	if (state.faith < 40 && state.phase !== "arrived") {
		const depth = Math.round((1 - state.faith / 40) * 10);
		for (let i = 0; i < depth; i++) {
			for (let x = (i % 2) * 2; x < w; x += 4) {
				rect(ctx, P.abyss, x, i + 15, 1, 1);
				rect(ctx, P.abyss, x + 1, h - 13 - i, 1, 1);
			}
		}
	}
	for (const item of look.pops) drawText(ctx, item.text, item.x - textWidth(item.text) / 2, item.y, item.color);
	ctx.restore();
	drawHud(ctx, look, state, now, reduceMotion);
}
