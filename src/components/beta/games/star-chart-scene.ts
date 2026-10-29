import { CHART_LEGS, CHART_TRAVEL_SECONDS, cellOpenings, isTurnable, type ChartLeg, type ChartState } from "@/lib/beta/games/star-chart-rules";

/**
 * Draws Star Chart (LC-17851) on a 2D canvas: an astronomer's chart of the
 * way, in ink on parchment, laid out under a deep indigo sky of gold-leaf
 * stars. The road tiles turn in place, the joined road is inked in and turns
 * to gold leaf when it is charted, and the travellers walk it. As the night
 * is spent the stars dim and the dawn rises at the foot of the sky. Pure
 * drawing: everything it shows comes from the simulation's state, the
 * page's tile animation and the frame's clock.
 */

export interface ChartLayout {
	x0: number;
	y0: number;
	tile: number;
	cols: number;
	rows: number;
	sheet: { x: number; y: number; w: number; h: number };
}

/** Room the page keeps for its own HUD over the top and the leg's line along the foot. */
const HUD_TOP = 60;
const FOOT = 46;
const PAD = 0.42;

export function chartLayout(width: number, height: number, leg: Pick<ChartLeg, "cols" | "rows">): ChartLayout {
	const side = width < 520 ? 8 : 28;
	const availW = width - side * 2;
	const availH = height - HUD_TOP - FOOT;
	const tile = Math.max(1, Math.min(availW / (leg.cols + PAD * 2), availH / (leg.rows + PAD * 2), 84));
	const w = leg.cols * tile;
	const h = leg.rows * tile;
	const x0 = (width - w) / 2;
	const y0 = HUD_TOP + (availH - h) / 2;
	const pad = PAD * tile;
	return { x0, y0, tile, cols: leg.cols, rows: leg.rows, sheet: { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 } };
}

/** The cell under a point on the stage, or -1. */
export function cellAt(layout: ChartLayout, x: number, y: number): number {
	const col = Math.floor((x - layout.x0) / layout.tile);
	const row = Math.floor((y - layout.y0) / layout.tile);
	if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return -1;
	return row * layout.cols + col;
}

export interface ChartFrame {
	width: number;
	height: number;
	state: ChartState;
	/** Seconds on the page's clock. */
	now: number;
	/** Each cell's turn as drawn: eases toward the cell's `spin`. */
	shown: readonly number[];
	cursor: number;
	showCursor: boolean;
	reduceMotion: boolean;
	/** The page's serif family for the chart's lettering. */
	serif: string;
	/** The cell a hint just turned and when, for its ring. */
	hint: { cell: number; at: number } | null;
	/** When the road joined up, for the gold's shimmer. */
	connectedAt: number | null;
}

const INK = "#3a2716";
const INK_SOFT = "rgba(70, 48, 26, 0.55)";
const RUST = "#a4442c";
const GOLD = "#c9962f";
const GOLD_LIGHT = "#f4d88a";
const GOLD_DEEP = "#8a6320";
const WATER_INK = "#3e5873";

const SKY = Array.from({ length: 110 }, (_, i) => ({
	x: (i * 0.6180339887 + 0.13) % 1,
	y: (i * 0.7548776662 + 0.07) % 1,
	r: 0.5 + ((i * 37) % 10) / 9,
	phase: (i * 2.399) % (Math.PI * 2),
	speed: 0.6 + ((i * 53) % 10) / 8,
	bright: ((i * 29) % 11) / 10,
}));

const ROMAN = ["I", "II", "III", "IV"];

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

function ease(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

/** A steady pseudo-random number for a cell's drawing, so the art never shimmers. */
function hash(a: number, b = 0): number {
	const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
	return x - Math.floor(x);
}

const SIDE_VECTORS: Record<number, [number, number]> = { 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] };

function sideBetween(from: number, to: number, cols: number): number {
	const d = to - from;
	if (d === 1) return 2;
	if (d === -1) return 8;
	if (d === cols) return 4;
	return d === -cols ? 1 : 0;
}

function centerOf(layout: ChartLayout, index: number): [number, number] {
	const col = index % layout.cols;
	const row = Math.floor(index / layout.cols);
	return [layout.x0 + (col + 0.5) * layout.tile, layout.y0 + (row + 0.5) * layout.tile];
}

/** The road as a line of points from the start's middle along every joined tile, curving through the bends. */
export function routePoints(layout: ChartLayout, route: readonly number[]): [number, number][] {
	const h = layout.tile / 2;
	const points: [number, number][] = [];
	if (!route.length) return points;
	points.push(centerOf(layout, route[0]));
	for (let i = 1; i < route.length; i++) {
		const [cx, cy] = centerOf(layout, route[i]);
		const entry = sideBetween(route[i], route[i - 1], layout.cols);
		const exit = i + 1 < route.length ? sideBetween(route[i], route[i + 1], layout.cols) : 0;
		const [ex, ey] = SIDE_VECTORS[entry] ?? [0, 0];
		points.push([cx + ex * h, cy + ey * h]);
		if (!exit) {
			points.push([cx, cy]);
			continue;
		}
		const [ox, oy] = SIDE_VECTORS[exit];
		if (ex === -ox && ey === -oy) {
			points.push([cx + ox * h, cy + oy * h]);
			continue;
		}
		// A bend: a quarter circle about the corner the two sides share.
		const kx = cx + (ex + ox) * h;
		const ky = cy + (ey + oy) * h;
		const a0 = Math.atan2(cy + ey * h - ky, cx + ex * h - kx);
		let a1 = Math.atan2(cy + oy * h - ky, cx + ox * h - kx);
		if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
		if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
		for (let s = 1; s <= 6; s++) {
			const a = a0 + ((a1 - a0) * s) / 6;
			points.push([kx + Math.cos(a) * h, ky + Math.sin(a) * h]);
		}
	}
	return points;
}

function pointAlong(points: readonly [number, number][], t: number): { x: number; y: number; angle: number } {
	if (points.length < 2) return { x: points[0]?.[0] ?? 0, y: points[0]?.[1] ?? 0, angle: 0 };
	let total = 0;
	const lengths: number[] = [];
	for (let i = 1; i < points.length; i++) {
		const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
		lengths.push(l);
		total += l;
	}
	let goal = clamp(t, 0, 1) * total;
	for (let i = 0; i < lengths.length; i++) {
		if (goal <= lengths[i] || i === lengths.length - 1) {
			const f = lengths[i] ? clamp(goal / lengths[i], 0, 1) : 0;
			const [ax, ay] = points[i];
			const [bx, by] = points[i + 1];
			return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, angle: Math.atan2(by - ay, bx - ax) };
		}
		goal -= lengths[i];
	}
	const last = points[points.length - 1];
	return { x: last[0], y: last[1], angle: 0 };
}

function starPath(context: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.22, points = 4) {
	context.beginPath();
	for (let i = 0; i < points * 2; i++) {
		const a = (i * Math.PI) / points - Math.PI / 2;
		const radius = i % 2 === 0 ? r : r * inner;
		const px = x + Math.cos(a) * radius;
		const py = y + Math.sin(a) * radius;
		if (i === 0) context.moveTo(px, py);
		else context.lineTo(px, py);
	}
	context.closePath();
}

/** The star in gold leaf: a long cross of light, a shorter one between, and its glow. */
function drawGreatStar(context: CanvasRenderingContext2D, x: number, y: number, r: number, glow: number) {
	if (glow > 0) {
		const halo = context.createRadialGradient(x, y, 0, x, y, r * 3.2);
		halo.addColorStop(0, `rgba(255, 228, 150, ${0.42 * glow})`);
		halo.addColorStop(0.35, `rgba(244, 200, 110, ${0.16 * glow})`);
		halo.addColorStop(1, "rgba(244, 200, 110, 0)");
		context.fillStyle = halo;
		context.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
	}
	context.save();
	context.translate(x, y);
	context.rotate(Math.PI / 4);
	starPath(context, 0, 0, r * 0.55, 0.3);
	context.fillStyle = GOLD;
	context.fill();
	context.restore();
	starPath(context, x, y, r, 0.16);
	const leaf = context.createLinearGradient(x - r, y - r, x + r, y + r);
	leaf.addColorStop(0, GOLD_LIGHT);
	leaf.addColorStop(0.55, "#e2b453");
	leaf.addColorStop(1, GOLD_DEEP);
	context.fillStyle = leaf;
	context.fill();
	context.lineWidth = Math.max(1, r * 0.05);
	context.strokeStyle = "rgba(255, 244, 210, 0.7)";
	context.stroke();
}

function drawSky(context: CanvasRenderingContext2D, frame: ChartFrame, nightLeft: number) {
	const { width, height, now, reduceMotion } = frame;
	const sky = context.createLinearGradient(0, 0, 0, height);
	sky.addColorStop(0, "#090c2a");
	sky.addColorStop(0.55, "#151a48");
	sky.addColorStop(1, "#232a63");
	context.fillStyle = sky;
	context.fillRect(0, 0, width, height);
	// The dawn rises from the foot of the sky as the night is spent.
	const dawn = clamp(1 - nightLeft / 0.45, 0, 1);
	if (dawn > 0) {
		const rise = context.createLinearGradient(0, height, 0, height * (1 - 0.75 * dawn));
		rise.addColorStop(0, `rgba(238, 168, 112, ${0.55 * dawn})`);
		rise.addColorStop(0.45, `rgba(176, 108, 128, ${0.3 * dawn})`);
		rise.addColorStop(1, "rgba(60, 50, 110, 0)");
		context.fillStyle = rise;
		context.fillRect(0, 0, width, height);
	}
	const fade = 0.25 + 0.75 * clamp(nightLeft, 0, 1);
	for (const star of SKY) {
		const twinkle = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(now * star.speed + star.phase);
		const alpha = (0.35 + 0.65 * star.bright) * twinkle * fade;
		const x = star.x * width;
		const y = star.y * height;
		if (star.bright > 0.85) {
			starPath(context, x, y, star.r * 3, 0.2);
			context.fillStyle = `rgba(244, 214, 140, ${alpha})`;
			context.fill();
		} else {
			context.fillStyle = `rgba(240, 220, 170, ${alpha})`;
			context.fillRect(x - star.r / 2, y - star.r / 2, star.r, star.r);
		}
	}
}

/** The parchment: a deckled sheet with a burnt edge, a ruled border and its title. */
function drawSheet(context: CanvasRenderingContext2D, layout: ChartLayout, legIndex: number, serif: string) {
	const { x, y, w, h } = layout.sheet;
	const edge: [number, number][] = [];
	const steps = 14;
	const jag = Math.max(2, layout.tile * 0.06);
	for (let i = 0; i < steps; i++) edge.push([x + (w * i) / steps, y + (hash(legIndex, i) - 0.5) * jag]);
	for (let i = 0; i < steps; i++) edge.push([x + w + (hash(legIndex + 9, i) - 0.5) * jag, y + (h * i) / steps]);
	for (let i = 0; i < steps; i++) edge.push([x + w - (w * i) / steps, y + h + (hash(legIndex + 19, i) - 0.5) * jag]);
	for (let i = 0; i < steps; i++) edge.push([x + (hash(legIndex + 29, i) - 0.5) * jag, y + h - (h * i) / steps]);
	const path = () => {
		context.beginPath();
		edge.forEach(([px, py], i) => (i === 0 ? context.moveTo(px, py) : context.lineTo(px, py)));
		context.closePath();
	};
	context.save();
	context.shadowColor = "rgba(0, 0, 0, 0.45)";
	context.shadowBlur = 22;
	context.shadowOffsetY = 8;
	path();
	context.fillStyle = "#e9d9b4";
	context.fill();
	context.restore();

	context.save();
	path();
	context.clip();
	const paper = context.createRadialGradient(x + w * 0.45, y + h * 0.4, Math.min(w, h) * 0.1, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
	paper.addColorStop(0, "#f3e8cc");
	paper.addColorStop(0.65, "#e8d6ae");
	paper.addColorStop(1, "#c9a76f");
	context.fillStyle = paper;
	context.fillRect(x - 10, y - 10, w + 20, h + 20);
	// Foxing: a few soft age marks, the same every time.
	for (let i = 0; i < 9; i++) {
		const fx = x + hash(legIndex * 3 + i, 1) * w;
		const fy = y + hash(legIndex * 3 + i, 2) * h;
		const fr = layout.tile * (0.3 + hash(i, legIndex) * 0.7);
		const spot = context.createRadialGradient(fx, fy, 0, fx, fy, fr);
		spot.addColorStop(0, "rgba(150, 105, 50, 0.1)");
		spot.addColorStop(1, "rgba(150, 105, 50, 0)");
		context.fillStyle = spot;
		context.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
	}
	context.restore();

	// A ruled double border.
	const inset = layout.tile * PAD * 0.42;
	context.strokeStyle = "rgba(70, 48, 26, 0.6)";
	context.lineWidth = 1.2;
	context.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
	context.lineWidth = 0.6;
	context.strokeRect(x + inset + 3, y + inset + 3, w - inset * 2 - 6, h - inset * 2 - 6);

	// The leg's title in the top margin, lettered on a cleared band.
	const leg = CHART_LEGS[legIndex];
	const size = clamp(layout.tile * PAD * 0.62, 10, 16);
	context.font = `italic 600 ${size}px ${serif}`;
	const title = `${ROMAN[legIndex]} · ${leg.title}`;
	const tw = context.measureText(title).width;
	const ty = y + inset;
	context.fillStyle = "#ead9b2";
	context.fillRect(x + w / 2 - tw / 2 - 8, ty - size * 0.7, tw + 16, size * 1.4);
	context.fillStyle = INK;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(title, x + w / 2, ty + 0.5);
}

/** A compass rose in ink and gold leaf. */
function drawRose(context: CanvasRenderingContext2D, x: number, y: number, r: number, serif: string, onParchment: boolean) {
	const ink = onParchment ? INK : "rgba(236, 222, 190, 0.85)";
	context.save();
	context.translate(x, y);
	context.strokeStyle = ink;
	context.lineWidth = Math.max(0.8, r * 0.025);
	context.beginPath();
	context.arc(0, 0, r * 0.62, 0, Math.PI * 2);
	context.stroke();
	context.beginPath();
	context.arc(0, 0, r * 0.68, 0, Math.PI * 2);
	context.stroke();
	for (let i = 0; i < 32; i++) {
		const a = (i * Math.PI) / 16;
		const inner = i % 4 === 0 ? 0.5 : 0.6;
		context.beginPath();
		context.moveTo(Math.cos(a) * r * inner, Math.sin(a) * r * inner);
		context.lineTo(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68);
		context.stroke();
	}
	// Eight points: the four winds long in gold, the four between short in ink.
	for (let i = 0; i < 8; i++) {
		const long = i % 2 === 0;
		const a = (i * Math.PI) / 4 - Math.PI / 2;
		const len = r * (long ? 0.95 : 0.5);
		const half = r * (long ? 0.13 : 0.1);
		const tip: [number, number] = [Math.cos(a) * len, Math.sin(a) * len];
		const left: [number, number] = [Math.cos(a - Math.PI / 2) * half, Math.sin(a - Math.PI / 2) * half];
		const right: [number, number] = [Math.cos(a + Math.PI / 2) * half, Math.sin(a + Math.PI / 2) * half];
		context.beginPath();
		context.moveTo(0, 0);
		context.lineTo(...tip);
		context.lineTo(...left);
		context.closePath();
		context.fillStyle = long ? GOLD : onParchment ? "#7a5a36" : "rgba(220, 200, 160, 0.7)";
		context.fill();
		context.beginPath();
		context.moveTo(0, 0);
		context.lineTo(...tip);
		context.lineTo(...right);
		context.closePath();
		context.fillStyle = long ? GOLD_DEEP : onParchment ? "#e6d3a8" : "rgba(80, 70, 120, 0.9)";
		context.fill();
		context.strokeStyle = ink;
		context.beginPath();
		context.moveTo(...left);
		context.lineTo(...tip);
		context.lineTo(...right);
		context.stroke();
	}
	context.beginPath();
	context.arc(0, 0, r * 0.07, 0, Math.PI * 2);
	context.fillStyle = GOLD_LIGHT;
	context.fill();
	const size = Math.max(9, r * 0.24);
	context.font = `600 ${size}px ${serif}`;
	context.fillStyle = ink;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText("N", 0, -r * 1.12);
	if (r > 30) {
		context.fillText("E", r * 1.12, 0);
		context.fillText("S", 0, r * 1.12);
		context.fillText("W", -r * 1.12, 0);
	}
	context.restore();
}

function drawMountain(context: CanvasRenderingContext2D, cx: number, cy: number, t: number, seed: number) {
	const peaks = [
		[-0.2 + hash(seed, 1) * 0.08, 0.32 + hash(seed, 2) * 0.1, 0.24],
		[0.16, 0.24 + hash(seed, 3) * 0.08, 0.2],
	];
	for (const [px, height, half] of peaks) {
		const baseY = cy + t * 0.26;
		const topX = cx + px * t;
		const topY = baseY - height * t * 1.5;
		context.beginPath();
		context.moveTo(topX - half * t, baseY);
		context.lineTo(topX, topY);
		context.lineTo(topX + half * t, baseY);
		context.fillStyle = "rgba(232, 214, 176, 0.9)";
		context.fill();
		context.strokeStyle = INK;
		context.lineWidth = Math.max(1, t * 0.025);
		context.stroke();
		// Hatching down the shaded flank.
		context.lineWidth = Math.max(0.6, t * 0.012);
		context.strokeStyle = INK_SOFT;
		for (let i = 1; i <= 4; i++) {
			const f = i / 5;
			const sx = topX + half * t * f;
			const sy = topY + (baseY - topY) * f;
			context.beginPath();
			context.moveTo(sx, sy);
			context.lineTo(sx - half * t * 0.28, baseY);
			context.stroke();
		}
	}
}

function drawWadi(context: CanvasRenderingContext2D, cx: number, cy: number, t: number, seed: number) {
	context.strokeStyle = WATER_INK;
	context.lineWidth = Math.max(0.8, t * 0.02);
	for (let line = -1; line <= 1; line++) {
		context.beginPath();
		for (let i = 0; i <= 12; i++) {
			const x = cx - t * 0.42 + (t * 0.84 * i) / 12;
			const y = cy + line * t * 0.16 + Math.sin(i * 1.1 + seed + line) * t * 0.04;
			if (i === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		}
		context.stroke();
	}
	context.strokeStyle = INK_SOFT;
	for (let i = 0; i < 3; i++) {
		const x = cx + (hash(seed, i) - 0.5) * t * 0.7;
		const y = cy + t * 0.34;
		context.beginPath();
		context.moveTo(x, y);
		context.lineTo(x - t * 0.03, y - t * 0.12);
		context.moveTo(x + t * 0.03, y);
		context.lineTo(x + t * 0.05, y - t * 0.1);
		context.stroke();
	}
}

function drawDesert(context: CanvasRenderingContext2D, cx: number, cy: number, t: number, seed: number) {
	context.fillStyle = "rgba(90, 64, 34, 0.32)";
	for (let i = 0; i < 7; i++) {
		const x = cx + (hash(seed, i) - 0.5) * t * 0.8;
		const y = cy + (hash(seed, i + 20) - 0.5) * t * 0.8;
		context.fillRect(x, y, 1.2, 1.2);
	}
	if (hash(seed, 99) > 0.5) {
		context.strokeStyle = "rgba(90, 64, 34, 0.35)";
		context.lineWidth = Math.max(0.6, t * 0.014);
		context.beginPath();
		context.moveTo(cx - t * 0.28, cy + t * 0.12);
		context.quadraticCurveTo(cx - t * 0.05, cy - t * 0.06, cx + t * 0.22, cy + t * 0.1);
		context.stroke();
	}
}

/** A walled city with towers and a gate: Jerusalem. */
function drawCity(context: CanvasRenderingContext2D, cx: number, cy: number, t: number) {
	const w = t * 0.62;
	const h = t * 0.3;
	const left = cx - w / 2;
	const base = cy + t * 0.2;
	context.fillStyle = "#e7d2a2";
	context.strokeStyle = INK;
	context.lineWidth = Math.max(1, t * 0.024);
	context.beginPath();
	context.moveTo(left, base);
	context.lineTo(left, base - h);
	const merlons = 6;
	for (let i = 0; i < merlons; i++) {
		const x = left + (w * i) / merlons;
		context.lineTo(x, base - h - t * 0.05);
		context.lineTo(x + w / merlons / 2, base - h - t * 0.05);
		context.lineTo(x + w / merlons / 2, base - h);
		context.lineTo(x + w / merlons, base - h);
	}
	context.lineTo(left + w, base);
	context.closePath();
	context.fill();
	context.stroke();
	for (const tx of [left - t * 0.02, left + w - t * 0.1]) {
		context.beginPath();
		context.rect(tx, base - h - t * 0.14, t * 0.12, h + t * 0.14);
		context.fill();
		context.stroke();
	}
	// A domed roof behind the walls and the gate.
	context.beginPath();
	context.arc(cx + t * 0.04, base - h - t * 0.03, t * 0.1, Math.PI, 0);
	context.fillStyle = GOLD;
	context.fill();
	context.stroke();
	context.beginPath();
	context.moveTo(cx - t * 0.06, base);
	context.lineTo(cx - t * 0.06, base - t * 0.1);
	context.arc(cx, base - t * 0.1, t * 0.06, Math.PI, 0);
	context.lineTo(cx + t * 0.06, base);
	context.fillStyle = INK;
	context.fill();
}

function drawHouse(context: CanvasRenderingContext2D, x: number, base: number, t: number, lit: boolean) {
	const w = t * 0.26;
	const h = t * 0.2;
	context.fillStyle = "#ead7aa";
	context.strokeStyle = INK;
	context.lineWidth = Math.max(1, t * 0.022);
	context.beginPath();
	context.rect(x - w / 2, base - h, w, h);
	context.fill();
	context.stroke();
	// A flat roof with its low parapet.
	context.beginPath();
	context.moveTo(x - w / 2 - t * 0.02, base - h);
	context.lineTo(x + w / 2 + t * 0.02, base - h);
	context.stroke();
	context.fillStyle = lit ? "#f2c766" : INK;
	context.fillRect(x - t * 0.035, base - h * 0.55, t * 0.07, h * 0.55);
}

function drawTents(context: CanvasRenderingContext2D, cx: number, cy: number, t: number) {
	for (const [dx, s] of [
		[-0.13, 1],
		[0.15, 0.8],
	]) {
		const x = cx + dx * t;
		const base = cy + t * 0.18;
		context.beginPath();
		context.moveTo(x - t * 0.17 * s, base);
		context.lineTo(x, base - t * 0.26 * s);
		context.lineTo(x + t * 0.17 * s, base);
		context.closePath();
		context.fillStyle = "#e3c891";
		context.fill();
		context.strokeStyle = INK;
		context.lineWidth = Math.max(1, t * 0.022);
		context.stroke();
		context.beginPath();
		context.moveTo(x, base - t * 0.26 * s);
		context.lineTo(x, base);
		context.stroke();
	}
}

function drawLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, serif: string) {
	const size = clamp(t * 0.2, 10.5, 15);
	context.font = `italic 600 ${size}px ${serif}`;
	const w = context.measureText(text).width;
	context.fillStyle = "rgba(240, 228, 198, 0.92)";
	context.beginPath();
	context.roundRect(x - w / 2 - 4, y - size * 0.62, w + 8, size * 1.24, 3);
	context.fill();
	context.fillStyle = INK;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(text, x, y + 0.5);
}

type RoadStyle = "dotted" | "ink" | "gold" | "astray";

/** One tile's road in local coordinates, centred, unrotated: its openings decide the shape. */
function strokeRoad(context: CanvasRenderingContext2D, t: number, open: number, style: RoadStyle) {
	const h = t / 2;
	const sides = [1, 2, 4, 8].filter((side) => open & side);
	context.beginPath();
	if (sides.length === 2 && !(open === 5 || open === 10)) {
		const [a, b] = sides;
		const [ax, ay] = SIDE_VECTORS[a];
		const [bx, by] = SIDE_VECTORS[b];
		const kx = (ax + bx) * h;
		const ky = (ay + by) * h;
		const a0 = Math.atan2(ay * h - ky, ax * h - kx);
		let a1 = Math.atan2(by * h - ky, bx * h - kx);
		if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
		if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
		context.arc(kx, ky, h, a0, a1, a1 < a0);
	} else if (sides.length === 2) {
		const [ax, ay] = SIDE_VECTORS[sides[0]];
		const [bx, by] = SIDE_VECTORS[sides[1]];
		context.moveTo(ax * h, ay * h);
		context.lineTo(bx * h, by * h);
	} else {
		for (const side of sides) {
			const [sx, sy] = SIDE_VECTORS[side];
			context.moveTo(0, 0);
			context.lineTo(sx * h, sy * h);
		}
	}
	context.lineCap = "round";
	if (style === "dotted") {
		context.setLineDash([t * 0.04, t * 0.085]);
		context.strokeStyle = "#5a3b1d";
		context.lineWidth = Math.max(1.6, t * 0.055);
		context.stroke();
		context.setLineDash([]);
		return;
	}
	if (style === "gold") {
		context.strokeStyle = GOLD_DEEP;
		context.lineWidth = Math.max(4, t * 0.13);
		context.stroke();
		context.strokeStyle = GOLD;
		context.lineWidth = Math.max(3, t * 0.095);
		context.stroke();
		context.strokeStyle = GOLD_LIGHT;
		context.lineWidth = Math.max(1, t * 0.03);
		context.stroke();
		return;
	}
	context.strokeStyle = style === "astray" ? RUST : INK;
	context.lineWidth = Math.max(2.4, t * 0.075);
	context.stroke();
}

/** A small caravan in ink: a laden pack animal and travellers on foot. */
function drawTravellers(context: CanvasRenderingContext2D, x: number, y: number, t: number, bob: number) {
	const s = t * 0.62;
	context.save();
	context.translate(x, y - s * 0.12);
	// A soft gold disc beneath, so the caravan reads on the gold road.
	context.fillStyle = "rgba(244, 226, 180, 0.9)";
	context.beginPath();
	context.ellipse(0, s * 0.18, s * 0.62, s * 0.4, 0, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = INK;
	context.fillStyle = INK;
	context.lineWidth = Math.max(1, s * 0.07);
	context.lineCap = "round";
	// The pack animal, laden.
	context.beginPath();
	context.ellipse(-s * 0.12, s * 0.02 + bob, s * 0.22, s * 0.12, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(s * 0.08, bob);
	context.lineTo(s * 0.2, -s * 0.2 + bob);
	context.lineTo(s * 0.3, -s * 0.18 + bob);
	context.stroke();
	for (const lx of [-0.28, -0.18, -0.02, 0.06]) {
		context.beginPath();
		context.moveTo(s * lx, s * 0.1 + bob);
		context.lineTo(s * lx, s * 0.32);
		context.stroke();
	}
	context.fillStyle = GOLD;
	context.fillRect(-s * 0.24, -s * 0.16 + bob, s * 0.2, s * 0.1);
	// Travellers on foot, robed.
	for (const [fx, fb] of [
		[0.38, bob * 0.6],
		[0.52, -bob * 0.6],
	]) {
		context.fillStyle = INK;
		context.beginPath();
		context.moveTo(s * fx - s * 0.08, s * 0.32);
		context.lineTo(s * fx, -s * 0.06 + fb);
		context.lineTo(s * fx + s * 0.08, s * 0.32);
		context.closePath();
		context.fill();
		context.beginPath();
		context.arc(s * fx, -s * 0.12 + fb, s * 0.065, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

/** The cells the star marks on this leg, the next one it waits over, and whether the road has passed each. */
function starMarks(leg: ChartLeg, state: ChartState) {
	return leg.stars.map(([r, c]) => {
		const index = r * leg.cols + c;
		return { index, passed: state.route.includes(index) };
	});
}

export function drawChartScene(context: CanvasRenderingContext2D, frame: ChartFrame) {
	const { width, height, state, now, shown, serif, reduceMotion } = frame;
	if (!width || !height) return;
	const leg = CHART_LEGS[state.leg];
	const layout = chartLayout(width, height, leg);
	const t = layout.tile;
	const nightLeft = state.phase === "charting" || state.phase === "dawn" ? (state.nightTotal ? state.night / state.nightTotal : 1) : 1;
	const charted = state.phase === "travelling" || state.phase === "between" || state.phase === "done";

	drawSky(context, frame, nightLeft);

	// The compass rose: large in the sky beside the chart when there is room, else small on the chart's corner.
	const room = layout.sheet.x;
	if (room > 130) drawRose(context, room / 2, layout.sheet.y + layout.sheet.h * 0.62, Math.min(room * 0.36, 78), serif, false);

	drawSheet(context, layout, state.leg, serif);
	if (room <= 130) drawRose(context, layout.sheet.x + layout.sheet.w - t * 0.28, layout.sheet.y + t * 0.3, t * 0.4, serif, true);

	// A faint dotted grid, as ruled on a chart.
	context.strokeStyle = "rgba(90, 60, 30, 0.16)";
	context.lineWidth = 1;
	context.setLineDash([2, 4]);
	context.beginPath();
	for (let c = 0; c <= leg.cols; c++) {
		context.moveTo(layout.x0 + c * t, layout.y0);
		context.lineTo(layout.x0 + c * t, layout.y0 + leg.rows * t);
	}
	for (let r = 0; r <= leg.rows; r++) {
		context.moveTo(layout.x0, layout.y0 + r * t);
		context.lineTo(layout.x0 + leg.cols * t, layout.y0 + r * t);
	}
	context.stroke();
	context.setLineDash([]);

	const onRoute = new Set(state.route);
	const astray = state.reaches && state.astray !== null;
	const routeStyle: RoadStyle = charted ? "gold" : astray ? "astray" : "ink";
	const map = leg.map.join("");

	for (let index = 0; index < state.cells.length; index++) {
		const cell = state.cells[index];
		const [cx, cy] = centerOf(layout, index);
		const seed = index * 7 + state.leg * 101;
		if (cell.kind === "mountain") drawMountain(context, cx, cy, t, seed);
		else if (cell.kind === "wadi") drawWadi(context, cx, cy, t, seed);
		else if (cell.kind === "desert") drawDesert(context, cx, cy, t, seed);
		else if (isTurnable(cell)) {
			// A tile that turns: a plate of fresher parchment, its road drawn turning with it.
			const angle = (cell.rot - cell.spin + (shown[index] ?? cell.spin)) * (Math.PI / 2);
			context.save();
			context.translate(cx, cy);
			context.fillStyle = "rgba(250, 242, 222, 0.55)";
			context.strokeStyle = "rgba(90, 60, 30, 0.3)";
			context.lineWidth = 1;
			context.beginPath();
			context.roundRect(-t / 2 + 2.5, -t / 2 + 2.5, t - 5, t - 5, Math.max(3, t * 0.1));
			context.fill();
			context.stroke();
			context.rotate(angle);
			const open = cellOpenings({ kind: cell.kind, rot: 0 });
			const settled = Math.abs((shown[index] ?? cell.spin) - cell.spin) < 0.02;
			strokeRoad(context, t, open, onRoute.has(index) && settled ? routeStyle : "dotted");
			context.restore();
		}
	}

	// The places the passage names, with the road's stubs into them.
	const startIndex = map.indexOf("S");
	const goalIndex = map.indexOf("G");
	const cityIndex = map.indexOf("X");
	const stub = (index: number, open: number, style: RoadStyle) => {
		const [cx, cy] = centerOf(layout, index);
		context.save();
		context.translate(cx, cy);
		strokeRoad(context, t, open, style);
		context.restore();
	};
	const startSide = { north: 1, east: 2, south: 4, west: 8 }[leg.startSide];
	stub(startIndex, startSide, state.route.length > 1 ? routeStyle : "dotted");
	if (state.reaches) stub(goalIndex, sideBetween(goalIndex, state.route[state.route.length - 2], leg.cols), routeStyle);
	if (cityIndex >= 0) {
		const passing = onRoute.has(cityIndex) ? sideBetween(cityIndex, state.route[state.route.indexOf(cityIndex) - 1], leg.cols) : 0;
		const axis = passing === 1 || passing === 4 ? 5 : 10;
		stub(cityIndex, 5, passing && axis === 5 ? routeStyle : "dotted");
		stub(cityIndex, 10, passing && axis === 10 ? routeStyle : "dotted");
	}

	const place = (index: number, name: string) => {
		const [cx, cy] = centerOf(layout, index);
		if (name === "Jerusalem") drawCity(context, cx, cy, t);
		else if (name === "Bethlehem") {
			drawHouse(context, cx - t * 0.16, cy + t * 0.22, t * 0.9, false);
			drawHouse(context, cx + t * 0.14, cy + t * 0.18, t, false);
			drawHouse(context, cx + t * 0.0, cy + t * 0.3, t * 0.8, false);
		} else if (name === "the house") drawHouse(context, cx, cy + t * 0.3, t * 1.9, charted || state.leg === 3);
		else drawTents(context, cx, cy, t);
		drawLabel(context, name, cx, cy - t * 0.34, t, serif);
	};
	place(startIndex, leg.from);
	place(goalIndex, leg.to);
	if (cityIndex >= 0) {
		place(cityIndex, "Jerusalem");
		if (state.astray === "city" && state.reaches) {
			const [cx, cy] = centerOf(layout, cityIndex);
			context.strokeStyle = RUST;
			context.lineWidth = Math.max(2, t * 0.05);
			context.beginPath();
			context.arc(cx, cy, t * 0.46, 0, Math.PI * 2);
			context.stroke();
		}
	}

	// The star's marks on the road to the house.
	const marks = starMarks(leg, state);
	for (const mark of marks) {
		const [cx, cy] = centerOf(layout, mark.index);
		const r = t * 0.17;
		const mx = cx + t * 0.3;
		const my = cy - t * 0.3;
		starPath(context, mx, my, r, 0.3);
		context.fillStyle = mark.passed ? GOLD : "rgba(240, 228, 198, 0.9)";
		context.fill();
		context.strokeStyle = mark.passed ? GOLD_DEEP : state.astray === "star" && state.reaches ? RUST : INK;
		context.lineWidth = Math.max(1, t * 0.03);
		context.stroke();
	}

	// The charted road: a shimmer of gold along it, then the travellers walking it.
	const points = charted || state.reaches ? routePoints(layout, state.route) : [];
	if (charted && frame.connectedAt !== null && !reduceMotion) {
		const since = now - frame.connectedAt;
		if (since < 1.2) {
			const at = pointAlong(points, since / 1.2);
			const glint = context.createRadialGradient(at.x, at.y, 0, at.x, at.y, t * 0.6);
			glint.addColorStop(0, "rgba(255, 240, 190, 0.85)");
			glint.addColorStop(1, "rgba(255, 240, 190, 0)");
			context.fillStyle = glint;
			context.fillRect(at.x - t * 0.6, at.y - t * 0.6, t * 1.2, t * 1.2);
		}
	}
	const progress = state.phase === "travelling" ? ease(state.travel / CHART_TRAVEL_SECONDS) : charted ? 1 : 0;

	// The great star. On the first leg it is his star seen in the east; on the
	// scribes' leg it is not in the sky; on the third it goes before them,
	// waiting over each mark, and stands over the house; on the way home it is
	// behind them, over the house.
	let star: { x: number; y: number; r: number; glow: number } | null = null;
	if (state.leg === 0) {
		const x = room > 130 ? layout.sheet.x + layout.sheet.w + room * 0.5 : layout.sheet.x + layout.sheet.w - t * 0.95;
		star = { x, y: room > 130 ? layout.sheet.y + t * 0.9 : HUD_TOP * 0.5 + 6, r: room > 130 ? 26 : 14, glow: 1 };
	} else if (state.leg === 2) {
		const next = marks.find((mark) => !mark.passed);
		let [sx, sy] = centerOf(layout, next ? next.index : goalIndex);
		if (state.phase === "travelling" || charted) {
			// Ahead of the travellers along the road, until it stands over the house.
			const ahead = pointAlong(points, Math.min(1, progress + 0.22));
			const [gx, gy] = centerOf(layout, goalIndex);
			const f = ease((progress - 0.6) / 0.4);
			sx = ahead.x + (gx - ahead.x) * f;
			sy = ahead.y + (gy - ahead.y) * f;
		}
		star = { x: sx, y: sy - t * 0.62, r: t * 0.38, glow: 1 };
	} else if (state.leg === 3) {
		const [sx, sy] = centerOf(layout, startIndex);
		star = { x: sx, y: sy - t * 0.62, r: t * 0.22, glow: 0.5 };
	}
	if (star) {
		const breathe = reduceMotion ? 1 : 1 + Math.sin(now * 1.6) * 0.04;
		drawGreatStar(context, star.x, star.y, star.r * breathe, star.glow * (0.4 + 0.6 * nightLeft));
	}

	if (charted && points.length > 1) {
		if (state.leg === 1) {
			// The scribes' answer is written onto the chart: a quill draws the way.
			const at = pointAlong(points, progress);
			if (progress < 1) {
				context.save();
				context.translate(at.x, at.y);
				context.rotate(-0.9);
				context.fillStyle = "#f4ead2";
				context.strokeStyle = INK;
				context.lineWidth = 1;
				context.beginPath();
				context.moveTo(0, 0);
				context.quadraticCurveTo(t * 0.12, -t * 0.4, t * 0.04, -t * 0.75);
				context.quadraticCurveTo(-t * 0.06, -t * 0.4, 0, 0);
				context.fill();
				context.stroke();
				context.restore();
			}
		} else {
			const at = pointAlong(points, progress);
			const bob = reduceMotion || state.phase !== "travelling" ? 0 : Math.sin(now * 12) * t * 0.012;
			drawTravellers(context, at.x, at.y, t, bob);
		}
	}

	// A hint's ring, and the keyboard's cursor.
	if (frame.hint && now - frame.hint.at < 1.4) {
		const [cx, cy] = centerOf(layout, frame.hint.cell);
		const f = (now - frame.hint.at) / 1.4;
		context.strokeStyle = `rgba(214, 160, 52, ${1 - f})`;
		context.lineWidth = 3;
		context.beginPath();
		context.arc(cx, cy, t * (0.42 + (reduceMotion ? 0 : f * 0.2)), 0, Math.PI * 2);
		context.stroke();
	}
	if (frame.showCursor && state.phase === "charting" && frame.cursor >= 0) {
		const [cx, cy] = centerOf(layout, frame.cursor);
		context.strokeStyle = "#b07a1c";
		context.lineWidth = 2.5;
		context.setLineDash([6, 4]);
		context.beginPath();
		context.roundRect(cx - t / 2 + 1, cy - t / 2 + 1, t - 2, t - 2, Math.max(3, t * 0.1));
		context.stroke();
		context.setLineDash([]);
	}

	// At dawn the chart is washed with morning light and the stars are gone.
	if (state.phase === "dawn") {
		const wash = context.createLinearGradient(0, height, 0, 0);
		wash.addColorStop(0, "rgba(250, 196, 140, 0.45)");
		wash.addColorStop(1, "rgba(250, 196, 140, 0.08)");
		context.fillStyle = wash;
		context.fillRect(0, 0, width, height);
	}
}
