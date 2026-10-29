import {
	CARAVAN_END,
	CARAVAN_FOOT,
	CARAVAN_HITS,
	CARAVAN_JERUSALEM,
	OVERHEAD_CLEARANCE,
	hazardAction,
	nextHazard,
	type CaravanHazard,
	type CaravanState,
} from "@/lib/beta/games/the-caravan-rules";

/**
 * Draws The Caravan (LC-17851) on a 2D canvas, side on, in silhouette: the
 * sky from dusk through the deep night to the glow before dawn, the star
 * high ahead, far mountains, dunes, palms and rock spires in parallax, the
 * road with its rocks, ravines, ledges and gusts of sand, the travellers and
 * their pack animals, Jerusalem's walls passing far off midway and the house
 * in Bethlehem at the end; then, over it all, what to do next (JUMP or DUCK
 * over each hazard as it comes, LC-17851's "make the controls obvious") and
 * the stars of the star kept. Pure drawing: everything it shows comes from
 * the simulation's state and the frame's clock, and nothing here changes
 * either.
 */

export interface TrailPoint {
	x: number;
	y: number;
}

export interface CaravanFrame {
	width: number;
	height: number;
	state: CaravanState;
	/** Seconds on the page's clock, for the wind, the sand and the stars. */
	now: number;
	/** Where the leader's feet have been, oldest first, so those behind jump where he jumped. */
	trail: readonly TrailPoint[];
	/** 0-1 extra brightness of the star after it is caught up with, already faded by the caller. */
	starGlow: number;
	/** 0-1 shake after a stumble (0 for reduced motion), already faded by the caller. */
	shake: number;
	/** Seconds since the caravan reached the house, or null. */
	arrival: number | null;
	/** 0-1 red flash after a stumble, already faded by the caller (shown in reduced motion too). */
	flash: number;
	/** 0-1: how strongly the opening "how to play" cue shows, already faded by the caller. */
	hint: number;
}

/** The house sits just past the end of the road; its door a little before it. */
const HOUSE_X = CARAVAN_END + 3;
const DOOR_X = HOUSE_X - 0.6;
/** The train behind the leader: who walks where, in paces behind him. */
/** It runs on off the edge of the view: travellers, those with them, and their animals, never a count. */
const TRAIN: readonly { kind: "traveller" | "animal"; behind: number; look: number }[] = [
	{ kind: "animal", behind: 2.4, look: 0 },
	{ kind: "traveller", behind: 4.9, look: 1 },
	{ kind: "animal", behind: 7.3, look: 1 },
	{ kind: "traveller", behind: 9.7, look: 3 },
	{ kind: "animal", behind: 12.1, look: 2 },
	{ kind: "traveller", behind: 14.6, look: 2 },
	{ kind: "animal", behind: 17, look: 0 },
	{ kind: "traveller", behind: 19.4, look: 3 },
];

type Rgb = readonly [number, number, number];
/** The sky through the journey: dusk ahead in the west, deep night at Jerusalem, the glow before dawn. */
const SKY: readonly { at: number; top: Rgb; mid: Rgb; low: Rgb }[] = [
	{ at: 0, top: [38, 28, 74], mid: [124, 58, 92], low: [238, 150, 92] },
	{ at: 0.22, top: [24, 20, 56], mid: [70, 40, 84], low: [168, 88, 88] },
	{ at: 0.44, top: [6, 8, 22], mid: [14, 20, 46], low: [30, 38, 70] },
	{ at: 0.74, top: [5, 9, 24], mid: [14, 24, 54], low: [34, 48, 88] },
	{ at: 1, top: [12, 22, 54], mid: [46, 58, 104], low: [214, 150, 120] },
];

function hash(i: number): number {
	const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
}

const STARS = Array.from({ length: 140 }, (_, i) => ({
	x: hash(i),
	y: Math.pow(hash(i + 500), 1.4) * 0.62,
	r: 0.5 + hash(i + 900) * 1.1,
	phase: hash(i + 1300) * Math.PI * 2,
	speed: 0.6 + hash(i + 1700) * 1.6,
}));

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

function ease(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgb(c: Rgb, alpha = 1): string {
	return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha})`;
}

function skyAt(p: number) {
	let i = 0;
	while (i < SKY.length - 2 && p > SKY[i + 1].at) i++;
	const a = SKY[i];
	const b = SKY[i + 1];
	const t = ease((p - a.at) / (b.at - a.at));
	return { top: mix(a.top, b.top, t), mid: mix(a.mid, b.mid, t), low: mix(a.low, b.low, t) };
}

interface View {
	unit: number;
	camera: number;
	ground: number;
	lead: number;
	span: number;
	/** World x (paces) to screen x. */
	sx: (x: number) => number;
	/** Height above the road (paces) to screen y. */
	sy: (y: number) => number;
	sky: ReturnType<typeof skyAt>;
	night: number;
	/** The silhouette ink, a touch of the sky in it. */
	ink: Rgb;
	/** The rim of light the star puts on every silhouette. */
	rim: string;
}

/** Where the leader is drawn: on the road, or walking up to the door once arrived. */
function leaderX(frame: CaravanFrame): number {
	if (frame.arrival === null) return frame.state.x;
	return frame.state.x + (DOOR_X - 1.4 - frame.state.x) * ease(frame.arrival / 2.4);
}

function viewFor(frame: CaravanFrame): View {
	const { width, height } = frame;
	const portrait = width / height < 1;
	const span = clamp((width / height) * 13.5, 12, 26);
	const unit = width / span;
	const lead = portrait ? 0.2 : width / height < 1.2 ? 0.22 : 0.27;
	let camera = frame.state.x - span * lead;
	if (frame.arrival !== null) camera += (HOUSE_X - span * 0.66 - camera) * ease(frame.arrival / 3);
	const ground = height * (portrait ? 0.79 : 0.75);
	const p = clamp(leaderX(frame) / CARAVAN_END, 0, 1);
	const sky = skyAt(p);
	const night = clamp(1 - Math.abs(p - 0.58) / 0.5, 0.25, 1);
	return {
		unit,
		camera,
		ground,
		lead,
		span,
		sx: (x) => (x - camera) * unit,
		sy: (y) => ground - y * unit,
		sky,
		night,
		ink: mix([10, 8, 16], sky.top, 0.18),
		rim: `rgba(255, ${Math.round(200 + 30 * night)}, ${Math.round(140 + 60 * night)}, ${0.5 + 0.25 * night})`,
	};
}

function drawSky(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const { width, height, now } = frame;
	const gradient = ctx.createLinearGradient(0, 0, 0, view.ground);
	gradient.addColorStop(0, rgb(view.sky.top));
	gradient.addColorStop(0.55, rgb(view.sky.mid));
	gradient.addColorStop(1, rgb(view.sky.low));
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);

	// The last of the day ahead in the west at the start; the first of the next behind, in the east, at the end.
	const p = clamp(leaderX(frame) / CARAVAN_END, 0, 1);
	const dusk = clamp(1 - p / 0.3, 0, 1);
	const dawn = clamp((p - 0.72) / 0.28, 0, 1);
	for (const [strength, x, color] of [
		[dusk, width * 0.95, "255, 170, 100"],
		[dawn, width * 0.05, "240, 178, 140"],
	] as const) {
		if (strength <= 0) continue;
		const glow = ctx.createRadialGradient(x, view.ground, 0, x, view.ground, width * 0.75);
		glow.addColorStop(0, `rgba(${color}, ${0.45 * strength})`);
		glow.addColorStop(1, `rgba(${color}, 0)`);
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, width, view.ground + 4);
	}

	// The stars of the night sky, drifting very slowly as the caravan goes.
	const shift = view.camera * 0.004;
	for (const star of STARS) {
		const twinkle = 0.55 + 0.45 * Math.sin(now * star.speed + star.phase);
		const alpha = view.night * twinkle * (1 - star.y * 0.6);
		if (alpha < 0.05) continue;
		const x = (((star.x - shift) % 1) + 1) % 1;
		ctx.fillStyle = `rgba(240, 236, 255, ${alpha})`;
		ctx.fillRect(x * width, star.y * view.ground, star.r, star.r);
	}
}

/** The star: high ahead while kept to, slipping to the edge of the sky as it draws away. */
function starPosition(frame: CaravanFrame, view: View) {
	const { width, height, state } = frame;
	const slip = 1 - state.keep / 100;
	// On a tall phone stage it sits below the HUD.
	const portrait = width < height;
	let x = width * ((portrait ? 0.64 : 0.72) + (portrait ? 0.42 : 0.34) * slip);
	let y = height * ((portrait ? 0.3 : 0.15) + 0.13 * slip);
	// Over the last of the road it comes down toward the house ahead.
	const near = frame.arrival === null ? ease((state.x - (CARAVAN_END - 22)) / 22) : 1;
	x += (Math.min(width * 0.86, view.sx(HOUSE_X + 2)) - x) * near * 0.85;
	y += (height * 0.2 - y) * near * 0.6;
	if (frame.arrival !== null) {
		// "Till it came and stood over where the young child was."
		const t = ease(frame.arrival / 2.6);
		x += (view.sx(HOUSE_X) - x) * t;
		y += (height * (portrait ? 0.24 : 0.13) - y) * t;
	}
	return { x, y };
}

function drawStar(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const { height, state } = frame;
	const { x, y } = starPosition(frame, view);
	const kept = state.keep / 100;
	let bright = 0.3 + 0.7 * kept + 0.5 * frame.starGlow;
	if (state.phase === "lost") bright *= clamp(1 - state.ended / 1.5, 0, 1);
	const arrived = frame.arrival === null ? 0 : ease(frame.arrival / 2.6);
	bright += 0.4 * arrived;
	const size = height * (state.x > CARAVAN_JERUSALEM ? 0.021 : 0.018) * (1 + 0.25 * frame.starGlow + 0.3 * arrived);
	if (bright <= 0.02) return;

	const glow = ctx.createRadialGradient(x, y, 0, x, y, height * (0.2 + 0.14 * kept + 0.1 * arrived));
	glow.addColorStop(0, `rgba(255, 246, 214, ${0.5 * bright})`);
	glow.addColorStop(0.25, `rgba(240, 210, 150, ${0.18 * bright})`);
	glow.addColorStop(1, "rgba(240, 210, 150, 0)");
	ctx.fillStyle = glow;
	ctx.fillRect(x - height, y - height, height * 2, height * 2);

	// Its rays: the long one down toward the earth.
	ctx.save();
	ctx.translate(x, y);
	ctx.globalAlpha = clamp(bright, 0, 1);
	for (const [dx, dy, length] of [
		[0, 1, 7.5],
		[0, -1, 4.6],
		[1, 0, 4.4],
		[-1, 0, 4.4],
		[0.7, 0.7, 2.2],
		[-0.7, 0.7, 2.2],
		[0.7, -0.7, 2],
		[-0.7, -0.7, 2],
	] as const) {
		const ray = ctx.createLinearGradient(0, 0, dx * size * length, dy * size * length);
		ray.addColorStop(0, "rgba(255, 250, 230, 0.95)");
		ray.addColorStop(1, "rgba(255, 236, 190, 0)");
		ctx.fillStyle = ray;
		const half = size * (length > 3 ? 0.16 : 0.11);
		ctx.beginPath();
		ctx.moveTo(-dy * half, dx * half);
		ctx.lineTo(dx * size * length, dy * size * length);
		ctx.lineTo(dy * half, -dx * half);
		ctx.closePath();
		ctx.fill();
	}
	ctx.fillStyle = "#fffaf0";
	ctx.beginPath();
	ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	// Standing over the house, its light comes down on it.
	if (arrived > 0) {
		const house = view.sx(HOUSE_X);
		const beam = ctx.createLinearGradient(0, y, 0, view.sy(3.2));
		beam.addColorStop(0, `rgba(255, 240, 200, ${0.2 * arrived})`);
		beam.addColorStop(1, `rgba(255, 220, 160, ${0.06 * arrived})`);
		ctx.fillStyle = beam;
		ctx.beginPath();
		ctx.moveTo(house - size * 0.4, y);
		ctx.lineTo(house + size * 0.4, y);
		ctx.lineTo(house + view.unit * 2.6, view.sy(3.2));
		ctx.lineTo(house - view.unit * 2.6, view.sy(3.2));
		ctx.closePath();
		ctx.fill();
	}
}

/** A layer of the land far off, drawn as a ridge line: `heightAt` in paces above the road for a layer x. */
function drawRidge(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View, depth: number, base: number, color: string, heightAt: (x: number) => number) {
	const { width, height } = frame;
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(0, height);
	for (let px = 0; px <= width + 6; px += 6) {
		const lx = view.camera * depth + px / view.unit;
		ctx.lineTo(px, base - heightAt(lx) * view.unit);
	}
	ctx.lineTo(width, height);
	ctx.closePath();
	ctx.fill();
}

/** Where a far-off landmark sits: at `at` across the screen when the camera is at `cameraAt`. */
function landmarkX(frame: CaravanFrame, view: View, at: number, cameraAt: number, depth: number) {
	return frame.width * at + (cameraAt - view.camera) * view.unit * depth;
}

function drawJerusalem(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const depth = 0.34;
	const u = view.unit * 0.5;
	const cx = landmarkX(frame, view, 0.62, CARAVAN_JERUSALEM - view.span * view.lead, depth);
	const half = u * 13;
	if (cx + half < 0 || cx - half > frame.width) return;
	const base = view.ground - u * 0.9;
	const color = rgb(mix(view.ink, view.sky.mid, 0.22));
	ctx.fillStyle = color;
	// The walls, with their battlements, the gate and towers, and the temple's courts above them.
	ctx.fillRect(cx - half, base - u * 2.2, half * 2, u * 2.4);
	for (let x = cx - half; x < cx + half; x += u * 0.55) ctx.fillRect(x, base - u * 2.55, u * 0.3, u * 0.4);
	for (const [dx, w, h] of [
		[-12.5, 1.4, 3.6],
		[-7, 1.6, 3.9],
		[-1.6, 1.5, 4.2],
		[1.6, 1.5, 4.2],
		[7.5, 1.6, 3.8],
		[12, 1.3, 3.4],
	]) {
		ctx.fillRect(cx + dx * u - (w * u) / 2, base - h * u, w * u, h * u);
		for (let k = 0; k < 3; k++) ctx.fillRect(cx + dx * u - (w * u) / 2 + k * ((w * u) / 2.5), base - h * u - u * 0.35, (w * u) / 5, u * 0.4);
	}
	// The temple's walls and sanctuary on its mount, the highest thing in the city.
	ctx.fillRect(cx + u * 3, base - u * 4.2, u * 7.5, u * 2.2);
	ctx.fillRect(cx + u * 5.2, base - u * 6.4, u * 3, u * 2.4);
	ctx.fillRect(cx + u * 4.6, base - u * 5.2, u * 4.2, u * 1.1);
	// Houses behind the wall.
	for (let i = 0; i < 9; i++) {
		const hx = cx - half + u * (1 + i * 1.3 + hash(i + 40) * 0.6);
		const h = 2.6 + hash(i + 60) * 1.4;
		if (hx > cx + u * 2.4) break;
		ctx.fillRect(hx, base - h * u, u * 1.1, h * u);
	}
	ctx.fillStyle = view.rim;
	ctx.globalAlpha = 0.4;
	ctx.fillRect(cx - half, base - u * 2.2, half * 2, 1);
	ctx.fillRect(cx + u * 5.2, base - u * 6.4, u * 3, 1);
	ctx.globalAlpha = 1;
	// The gate, and lamps in the windows.
	ctx.fillStyle = "rgba(255, 196, 120, 0.85)";
	ctx.beginPath();
	ctx.moveTo(cx - u * 0.5, base + u * 0.2);
	ctx.lineTo(cx - u * 0.5, base - u * 1.1);
	ctx.arc(cx, base - u * 1.1, u * 0.5, Math.PI, 0);
	ctx.lineTo(cx + u * 0.5, base + u * 0.2);
	ctx.closePath();
	ctx.globalAlpha = 0.55;
	ctx.fill();
	ctx.globalAlpha = 1;
	for (let i = 0; i < 16; i++) {
		const lx = cx - half + hash(i + 80) * half * 2;
		const ly = base - u * (0.6 + hash(i + 120) * 3.2);
		const flicker = 0.6 + 0.4 * Math.sin(frame.now * (1.5 + hash(i) * 2) + i);
		ctx.fillStyle = `rgba(255, 200, 120, ${0.5 * flicker})`;
		ctx.fillRect(lx, ly, u * 0.16, u * 0.22);
	}
}

function drawBethlehem(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const depth = 0.34;
	const u = view.unit * 0.6;
	const cx = landmarkX(frame, view, 0.7, CARAVAN_END - view.span * view.lead, depth);
	const half = u * 9;
	if (cx + half < 0 || cx - half > frame.width) return;
	const base = view.ground - u * 0.8;
	ctx.fillStyle = rgb(mix(view.ink, view.sky.mid, 0.25));
	// A little town on its hill.
	ctx.beginPath();
	ctx.moveTo(cx - half * 1.3, base + u);
	ctx.quadraticCurveTo(cx, base - u * 2.6, cx + half * 1.3, base + u);
	ctx.fill();
	for (let i = 0; i < 11; i++) {
		const hx = cx - half + (i / 10) * half * 2 + hash(i + 200) * u;
		const rise = 1.9 * (1 - Math.pow((hx - cx) / (half * 1.3), 2));
		const h = 1 + hash(i + 220) * 1.2;
		const w = 1 + hash(i + 240) * 0.8;
		ctx.fillRect(hx - (w * u) / 2, base - (rise + h) * u, w * u, h * u + u);
	}
	for (let i = 0; i < 9; i++) {
		const hx = cx - half + hash(i + 260) * half * 2;
		const rise = 1.9 * (1 - Math.pow((hx - cx) / (half * 1.3), 2));
		ctx.fillStyle = `rgba(255, 200, 120, ${0.35 + 0.25 * Math.sin(frame.now * 1.7 + i)})`;
		ctx.fillRect(hx, base - (rise + 0.5 + hash(i + 280) * 0.6) * u, u * 0.14, u * 0.2);
	}
}

/** Palms, acacias and rock spires beside the road, nearer than the dunes. */
function drawNearLand(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const depth = 0.55;
	const spacing = 6.5;
	const left = view.camera * depth - 4;
	const right = left + view.span + 10;
	const color = rgb(mix(view.ink, view.sky.mid, 0.12));
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	for (let i = Math.floor(left / spacing); i <= right / spacing; i++) {
		const kind = hash(i * 3 + 7);
		const lx = i * spacing + hash(i * 5 + 1) * 3.5;
		const x = (lx - view.camera * depth) * view.unit;
		const base = view.ground + view.unit * 0.25;
		const scale = view.unit * (0.85 + hash(i * 11) * 0.45);
		// Near the cities the land is kept clear for them.
		const world = view.camera + x / view.unit;
		if (Math.abs(world - CARAVAN_JERUSALEM) < 6) continue;
		if (kind < 0.36) drawPalm(ctx, x, base, scale, frame.now + i, color);
		else if (kind < 0.58) {
			// A rock spire, wind-cut.
			ctx.beginPath();
			ctx.moveTo(x - scale * 1.1, base);
			ctx.lineTo(x - scale * 0.7, base - scale * 2.4);
			ctx.lineTo(x - scale * 0.2, base - scale * 3.4);
			ctx.lineTo(x + scale * 0.5, base - scale * 3.1);
			ctx.lineTo(x + scale * 0.8, base - scale * 1.6);
			ctx.lineTo(x + scale * 1.3, base);
			ctx.closePath();
			ctx.fill();
		} else if (kind < 0.74) {
			// An acacia, flat-topped.
			ctx.lineWidth = scale * 0.16;
			ctx.beginPath();
			ctx.moveTo(x, base);
			ctx.quadraticCurveTo(x + scale * 0.2, base - scale * 1.3, x - scale * 0.1, base - scale * 2.1);
			ctx.moveTo(x + scale * 0.08, base - scale * 1.2);
			ctx.lineTo(x + scale * 0.8, base - scale * 1.9);
			ctx.stroke();
			ctx.beginPath();
			ctx.ellipse(x + scale * 0.25, base - scale * 2.15, scale * 1.6, scale * 0.32, 0, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

function drawPalm(ctx: CanvasRenderingContext2D, x: number, base: number, scale: number, seed: number, color: string) {
	const sway = Math.sin(seed * 0.7) * 0.15;
	const top = { x: x + scale * (0.5 + sway), y: base - scale * 3.6 };
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineCap = "round";
	ctx.lineWidth = scale * 0.2;
	ctx.beginPath();
	ctx.moveTo(x, base);
	ctx.quadraticCurveTo(x + scale * 0.05, base - scale * 2, top.x, top.y);
	ctx.stroke();
	// The fronds, drooping.
	for (let k = 0; k < 7; k++) {
		const angle = -Math.PI / 2 + (k - 3) * 0.48 + sway * 0.5;
		const length = scale * (1.5 + (k % 2) * 0.35);
		const ex = top.x + Math.cos(angle) * length;
		const ey = top.y + Math.sin(angle) * length * 0.5 + length * 0.45;
		ctx.beginPath();
		ctx.moveTo(top.x, top.y);
		ctx.quadraticCurveTo(top.x + Math.cos(angle) * length * 0.6, top.y + Math.sin(angle) * length * 0.7 - scale * 0.2, ex, ey);
		ctx.quadraticCurveTo(top.x + Math.cos(angle) * length * 0.5, top.y + Math.sin(angle) * length * 0.4, top.x, top.y + scale * 0.12);
		ctx.fill();
	}
}

/** The road: the sand, cut by its ravines. */
function drawRoad(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const { width, height, state } = frame;
	const top = view.ground;
	const sand = ctx.createLinearGradient(0, top - 2, 0, height);
	sand.addColorStop(0, rgb(mix(view.sky.low, view.ink, 0.42)));
	sand.addColorStop(0.07, rgb(mix(view.sky.mid, view.ink, 0.62)));
	sand.addColorStop(0.35, rgb(mix(view.ink, view.sky.mid, 0.12)));
	sand.addColorStop(1, rgb(view.ink));
	ctx.fillStyle = sand;
	ctx.beginPath();
	ctx.moveTo(0, height);
	for (let px = 0; px <= width + 6; px += 6) {
		const wx = view.camera + px / view.unit;
		ctx.lineTo(px, top + Math.sin(wx * 1.3) * 1.2 + Math.sin(wx * 3.1) * 0.8);
	}
	ctx.lineTo(width, height);
	ctx.closePath();
	ctx.fill();
	// The starlit edge of the road.
	ctx.strokeStyle = view.rim;
	ctx.globalAlpha = 0.35;
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	ctx.moveTo(0, top);
	ctx.lineTo(width, top);
	ctx.stroke();
	// Wind ripples in the sand, and stones.
	ctx.strokeStyle = rgb(mix(view.sky.low, view.ink, 0.3));
	ctx.lineWidth = 1;
	ctx.beginPath();
	const first = Math.floor(view.camera / 1.6);
	for (let i = first; i < first + view.span / 1.6 + 2; i++) {
		for (let row = 0; row < 3; row++) {
			if (hash(i * 3 + row) < 0.35) continue;
			const x = view.sx(i * 1.6 + hash(i + row * 31) * 1.2);
			const y = top + view.unit * (0.35 + row * 0.5 + hash(i * 7 + row) * 0.2);
			const w = view.unit * (0.5 + hash(i + row) * 0.6) * (1 - row * 0.15);
			ctx.moveTo(x, y);
			ctx.quadraticCurveTo(x + w / 2, y - view.unit * 0.08, x + w, y);
		}
	}
	ctx.globalAlpha = 0.22;
	ctx.stroke();
	ctx.globalAlpha = 1;
	ctx.fillStyle = rgb(mix(view.ink, view.sky.mid, 0.3));
	for (let i = Math.floor(view.camera / 2.3); i < view.camera / 2.3 + view.span / 2.3 + 2; i++) {
		if (hash(i * 11 + 5) < 0.5) continue;
		ctx.beginPath();
		ctx.ellipse(view.sx(i * 2.3 + hash(i) * 2), top + view.unit * (0.2 + hash(i + 3) * 1.4), view.unit * 0.12, view.unit * 0.05, 0, 0, Math.PI * 2);
		ctx.fill();
	}

	for (const hazard of state.hazards) {
		if (hazard.kind !== "ravine") continue;
		const left = view.sx(hazard.x);
		const right = view.sx(hazard.x + hazard.w);
		if (right < -10 || left > width + 10) continue;
		// The far wall catches a little light; the near one is in shadow; the drop is dark.
		const depth = height - top;
		const wall = (from: number, side: 1 | -1, color: string) => {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(from, top - 1);
			for (let k = 1; k <= 5; k++) ctx.lineTo(from + side * view.unit * (0.08 + (k % 2) * 0.22 + k * 0.05), top + (k / 5) * depth);
			ctx.lineTo(from, height);
			ctx.closePath();
			ctx.fill();
		};
		ctx.fillStyle = "rgb(3, 2, 6)";
		ctx.fillRect(left, top - 1, right - left, depth + 1);
		const shade = ctx.createLinearGradient(0, top, 0, height);
		shade.addColorStop(0, rgb(mix(view.ink, view.sky.mid, 0.35)));
		shade.addColorStop(1, "rgb(3, 2, 6)");
		wall(right, -1, rgb(mix(view.ink, view.sky.low, 0.22)));
		wall(left, 1, rgb(view.ink));
		ctx.fillStyle = shade;
		ctx.globalAlpha = 0.35;
		ctx.fillRect(left, top, right - left, depth * 0.5);
		ctx.globalAlpha = 1;
		// The lips catch the starlight.
		ctx.strokeStyle = view.rim;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(left - view.unit * 0.5, top);
		ctx.lineTo(left + view.unit * 0.05, top);
		ctx.moveTo(right + view.unit * 0.5, top);
		ctx.lineTo(right - view.unit * 0.05, top);
		ctx.stroke();
	}
}

function drawRock(ctx: CanvasRenderingContext2D, view: View, hazard: CaravanHazard) {
	const left = view.sx(hazard.x);
	const w = hazard.w * view.unit;
	const h = hazard.h * view.unit;
	const j = (k: number) => (hash(hazard.id * 13 + k) - 0.5) * 0.18;
	const outline = (dx: number, dy: number) => {
		ctx.beginPath();
		ctx.moveTo(left + dx, view.ground + 2);
		ctx.lineTo(left + w * (0.02 + j(1)) + dx, view.ground - h * 0.45 + dy);
		ctx.lineTo(left + w * (0.22 + j(2)) + dx, view.ground - h * (0.92 + j(3)) + dy);
		ctx.lineTo(left + w * (0.55 + j(4)) + dx, view.ground - h + dy);
		ctx.lineTo(left + w * (0.86 + j(5)) + dx, view.ground - h * (0.72 + j(6)) + dy);
		ctx.lineTo(left + w + dx, view.ground + 2);
		ctx.closePath();
		ctx.fill();
	};
	ctx.fillStyle = view.rim;
	outline(1.4, -1.2);
	ctx.fillStyle = rgb(view.ink);
	outline(0, 0);
}

/** A ledge: an overhang of rock from a cliff behind the road, low enough to duck under. */
function drawLedge(ctx: CanvasRenderingContext2D, view: View, hazard: CaravanHazard, layer: "back" | "front") {
	const u = view.unit;
	const left = view.sx(hazard.x - 0.4);
	const right = view.sx(hazard.x + hazard.w + 0.4);
	const under = view.sy(OVERHEAD_CLEARANCE + 0.08);
	const j = (k: number) => (hash(hazard.id * 17 + k) - 0.5) * u * 0.5;
	if (layer === "back") {
		// The cliff it juts from, behind the road, running up out of the view.
		ctx.fillStyle = rgb(mix(view.ink, view.sky.mid, 0.16));
		ctx.beginPath();
		ctx.moveTo(right - u * 0.8, view.ground + 2);
		ctx.lineTo(right - u * 0.5, view.sy(2.6));
		ctx.quadraticCurveTo(right - u * 0.2, view.sy(4.6), right + u * 0.6, view.sy(5.6) + j(1));
		ctx.lineTo(right + u * 1.8, view.sy(6.1));
		ctx.quadraticCurveTo(right + u * 2.6, view.sy(4), right + u * 3, view.ground + 2);
		ctx.closePath();
		ctx.fill();
		return;
	}
	// The overhang: a ragged underside just above a ducked head, a broken brow, its root in the cliff.
	const outline = (dx: number, dy: number) => {
		ctx.beginPath();
		ctx.moveTo(left - u * 0.3 + dx, under - u * 0.3 + dy);
		const steps = 8;
		for (let k = 0; k <= steps; k++) {
			const x = left + ((right - left) * k) / steps;
			ctx.lineTo(x + dx, under - Math.abs(j(k + 10)) * 0.35 + dy);
		}
		ctx.lineTo(right + u * 0.6 + dx, under - u * 0.1 + dy);
		ctx.lineTo(right + u * 1.3 + dx, view.sy(2.9) + dy);
		ctx.lineTo(right + u * 1.1 + dx, view.sy(4.2) + dy);
		const brow = 7;
		for (let k = brow; k >= 0; k--) {
			const x = left - u * 0.4 + ((right - left + u * 1.4) * k) / brow;
			const rise = 3.1 + 0.9 * Math.sin((k / brow) * Math.PI * 0.9 + 0.2);
			ctx.lineTo(x + dx, view.sy(rise) + j(k + 30) * 0.6 + dy);
		}
		ctx.lineTo(left - u * 0.75 + dx, view.sy(2.3) + dy);
		ctx.closePath();
		ctx.fill();
	};
	ctx.fillStyle = view.rim;
	outline(1.4, -1.2);
	const body = ctx.createLinearGradient(left, 0, right + u * 1.3, 0);
	body.addColorStop(0, rgb(view.ink));
	body.addColorStop(0.65, rgb(view.ink));
	body.addColorStop(1, rgb(mix(view.ink, view.sky.mid, 0.16)));
	ctx.fillStyle = body;
	outline(0, 0);
	ctx.strokeStyle = rgb(view.ink);
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	for (let k = 1; k < 6; k++) {
		const x = left + ((right - left) * k) / 6;
		ctx.moveTo(x, under - 1);
		ctx.lineTo(x + 2, under + u * (0.06 + hash(hazard.id + k) * 0.08));
	}
	ctx.stroke();
}

/** A gust of the sandstorm, blowing toward the caravan at head height. */
function drawGust(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View, hazard: CaravanHazard) {
	const left = view.sx(hazard.x);
	const w = hazard.w * view.unit;
	if (left + w < -40 || left > frame.width + 40) return;
	const low = view.sy(OVERHEAD_CLEARANCE + 0.1);
	const high = view.sy(3.1);
	const mid = (low + high) / 2;
	const body = ctx.createLinearGradient(left - w * 0.3, 0, left + w * 1.4, 0);
	body.addColorStop(0, "rgba(214, 170, 112, 0)");
	body.addColorStop(0.25, "rgba(214, 170, 112, 0.42)");
	body.addColorStop(0.7, "rgba(190, 140, 90, 0.3)");
	body.addColorStop(1, "rgba(190, 140, 90, 0)");
	ctx.fillStyle = body;
	ctx.beginPath();
	ctx.ellipse(left + w * 0.55, mid, w * 0.85, (low - high) * 0.55, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "rgba(236, 200, 150, 0.55)";
	for (let k = 0; k < 46; k++) {
		const u = hash(hazard.id * 50 + k);
		const v = hash(hazard.id * 70 + k);
		const swirl = Math.sin(frame.now * 5 + k) * view.unit * 0.18;
		const x = left - w * 0.2 + u * w * 1.5;
		const y = high + v * (low - high) + swirl;
		ctx.fillRect(x, y, 1.6, 1.6);
	}
	ctx.strokeStyle = "rgba(240, 214, 170, 0.5)";
	ctx.lineWidth = 1.4;
	ctx.lineCap = "round";
	ctx.beginPath();
	for (let k = 0; k < 6; k++) {
		const y = high + ((k + 0.5) / 6) * (low - high);
		const x = left + ((frame.now * 1.7 + k * 0.37) % 1) * w;
		ctx.moveTo(x, y);
		ctx.quadraticCurveTo(x + w * 0.25, y - view.unit * 0.12, x + w * 0.5, y);
	}
	ctx.stroke();
}

interface Pose {
	x: number;
	/** Feet above the road (paces). */
	y: number;
	/** 0 upright, 1 crouched (ducking, or kneeling at the house). */
	crouch: number;
	/** The stride's phase. */
	stride: number;
	/** 0 on the ground, 1 in the air. */
	air: number;
	moving: boolean;
}

/** A traveller from the east, robed and turbaned, staff in hand; `look` varies the headdress. */
function drawTraveller(ctx: CanvasRenderingContext2D, view: View, pose: Pose, look: number, now: number, fill: string) {
	const u = view.unit;
	const x = view.sx(pose.x);
	const y = view.sy(pose.y);
	const c = pose.crouch;
	const swing = pose.moving && pose.air < 0.5 ? Math.sin(pose.stride) : pose.air > 0.5 ? 0.6 : 0;
	ctx.save();
	ctx.translate(x, y);
	ctx.fillStyle = fill;
	ctx.strokeStyle = fill;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	// Legs under the hem: striding, tucked in the air, bent in a crouch.
	const hip = -u * (0.75 - 0.3 * c);
	ctx.lineWidth = u * 0.13;
	ctx.beginPath();
	for (const side of [1, -1]) {
		const reach = pose.air > 0.5 ? side * 0.18 : side * swing * 0.34;
		const knee = { x: u * (reach * 0.6 + 0.12 * c + (pose.air > 0.5 ? 0.18 : 0)), y: hip * 0.5 - u * (pose.air > 0.5 ? 0.22 : 0) };
		ctx.moveTo(0, hip);
		ctx.lineTo(knee.x, knee.y);
		ctx.lineTo(u * (reach - 0.12 * c * side), pose.air > 0.5 ? -u * 0.12 : 0);
	}
	ctx.stroke();
	// Robe, leaning into the walk, bowed low when crouched.
	ctx.save();
	ctx.translate(0, hip);
	ctx.rotate(0.12 + 0.95 * c);
	const torso = u * (1.15 - 0.25 * c);
	const flutter = Math.sin(now * 6 + look) * u * 0.06;
	ctx.beginPath();
	ctx.moveTo(-u * 0.2, -torso);
	ctx.lineTo(u * 0.2, -torso);
	ctx.lineTo(u * 0.38, u * 0.42);
	ctx.lineTo(-u * 0.45 + flutter, u * 0.5);
	ctx.closePath();
	ctx.fill();
	// The cloak streaming behind.
	ctx.beginPath();
	ctx.moveTo(-u * 0.12, -torso + u * 0.05);
	ctx.quadraticCurveTo(-u * 0.75, -torso * 0.4 + flutter, -u * 0.85 + flutter * 2, u * 0.35 + (pose.air > 0.5 ? -u * 0.3 : 0));
	ctx.lineTo(-u * 0.3, u * 0.4);
	ctx.closePath();
	ctx.fill();
	// Head and headdress.
	ctx.beginPath();
	ctx.arc(u * 0.04, -torso - u * 0.2, u * 0.16, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	if (look === 0) {
		// A wrapped turban with a plume.
		ctx.ellipse(u * 0.02, -torso - u * 0.36, u * 0.22, u * 0.14, 0, 0, Math.PI * 2);
		ctx.moveTo(u * 0.04, -torso - u * 0.46);
		ctx.quadraticCurveTo(u * 0.22, -torso - u * 0.82, u * 0.02, -torso - u * 0.9);
		ctx.lineTo(u * 0.0, -torso - u * 0.46);
	} else if (look === 1) {
		// A tall rounded cap.
		ctx.moveTo(-u * 0.17, -torso - u * 0.3);
		ctx.quadraticCurveTo(-u * 0.14, -torso - u * 0.85, u * 0.06, -torso - u * 0.82);
		ctx.quadraticCurveTo(u * 0.2, -torso - u * 0.6, u * 0.2, -torso - u * 0.3);
	} else if (look === 3) {
		// A head cloth, falling to the shoulders.
		ctx.moveTo(-u * 0.2, -torso - u * 0.12);
		ctx.quadraticCurveTo(-u * 0.18, -torso - u * 0.48, u * 0.06, -torso - u * 0.44);
		ctx.quadraticCurveTo(u * 0.22, -torso - u * 0.38, u * 0.2, -torso - u * 0.22);
		ctx.lineTo(-u * 0.05, -torso - u * 0.2);
		ctx.lineTo(-u * 0.3, -torso + u * 0.15);
	} else {
		// A crowned headdress.
		ctx.moveTo(-u * 0.18, -torso - u * 0.3);
		ctx.lineTo(-u * 0.2, -torso - u * 0.66);
		ctx.lineTo(-u * 0.08, -torso - u * 0.52);
		ctx.lineTo(u * 0.02, -torso - u * 0.72);
		ctx.lineTo(u * 0.12, -torso - u * 0.52);
		ctx.lineTo(u * 0.24, -torso - u * 0.66);
		ctx.lineTo(u * 0.2, -torso - u * 0.3);
	}
	ctx.fill();
	// The arm and staff, swinging with the stride.
	ctx.lineWidth = u * 0.1;
	ctx.beginPath();
	const hand = { x: u * (0.32 + 0.1 * swing), y: -torso * 0.45 };
	ctx.moveTo(u * 0.05, -torso + u * 0.12);
	ctx.lineTo(hand.x, hand.y);
	ctx.stroke();
	ctx.lineWidth = u * 0.055;
	ctx.beginPath();
	ctx.moveTo(hand.x - u * 0.12, hand.y - u * 0.75);
	ctx.lineTo(hand.x + u * 0.12 + swing * u * 0.1, hand.y + u * 1.05);
	ctx.stroke();
	ctx.restore();
	ctx.restore();
}

/** A pack animal of the caravan, laden with bundles, walking with a long, rocking gait. */
function drawAnimal(ctx: CanvasRenderingContext2D, view: View, pose: Pose, look: number, fill: string, accent: string | null) {
	const u = view.unit;
	const x = view.sx(pose.x);
	const y = view.sy(pose.y);
	const c = pose.crouch;
	const gait = pose.moving && pose.air < 0.5 ? pose.stride * 0.75 : 0;
	const bob = pose.moving && pose.air < 0.5 ? Math.abs(Math.sin(gait)) * u * 0.06 : 0;
	const bodyY = -u * (1.55 - 0.5 * c) - bob;
	ctx.save();
	ctx.translate(x, y);
	ctx.fillStyle = fill;
	ctx.strokeStyle = fill;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	// Four long legs, front and back pairs out of step.
	ctx.lineWidth = u * 0.11;
	ctx.beginPath();
	for (const [hipX, offset] of [
		[-0.62, 0],
		[-0.48, Math.PI],
		[0.5, Math.PI],
		[0.64, 0],
	] as const) {
		const s = pose.air > 0.5 ? (hipX < 0 ? -0.3 : 0.3) : Math.sin(gait + offset) * 0.32;
		const kneeY = bodyY * 0.45;
		ctx.moveTo(u * hipX, bodyY + u * 0.2);
		ctx.lineTo(u * (hipX + s * 0.5 + 0.08 * c), kneeY);
		ctx.lineTo(u * (hipX + s), pose.air > 0.5 ? -u * 0.25 : 0);
	}
	ctx.stroke();
	// The body and its hump.
	ctx.beginPath();
	ctx.ellipse(0, bodyY, u * 0.92, u * 0.38, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse(-u * 0.05, bodyY - u * 0.32, u * 0.45, u * 0.32, 0, Math.PI, Math.PI * 2);
	ctx.fill();
	// The neck curving forward and up, lowered when it ducks; the head.
	const head = { x: u * (1.42 + 0.25 * c), y: bodyY - u * (0.75 - 1.05 * c) };
	ctx.lineWidth = u * 0.24;
	ctx.beginPath();
	ctx.moveTo(u * 0.7, bodyY - u * 0.05);
	ctx.quadraticCurveTo(u * 1.25, bodyY + u * (0.1 + 0.2 * c), head.x - u * 0.1, head.y + u * 0.08);
	ctx.stroke();
	ctx.beginPath();
	ctx.ellipse(head.x + u * 0.08, head.y, u * 0.26, u * 0.12, 0.25, 0, Math.PI * 2);
	ctx.fill();
	ctx.lineWidth = u * 0.05;
	ctx.beginPath();
	ctx.moveTo(head.x - u * 0.06, head.y - u * 0.08);
	ctx.lineTo(head.x - u * 0.1, head.y - u * 0.2);
	ctx.stroke();
	// The tail.
	ctx.beginPath();
	ctx.moveTo(-u * 0.88, bodyY - u * 0.05);
	ctx.quadraticCurveTo(-u * 1.05, bodyY + u * 0.2, -u * 0.98, bodyY + u * 0.45);
	ctx.stroke();
	// Its load: a saddle cloth and bundles tied on, a tassel swinging.
	const load = () => {
		ctx.beginPath();
		ctx.moveTo(-u * 0.55, bodyY - u * 0.22);
		ctx.quadraticCurveTo(-u * 0.05, bodyY - u * (0.95 + 0.05 * look), u * 0.45, bodyY - u * 0.22);
		ctx.lineTo(u * 0.35, bodyY + u * 0.18);
		ctx.lineTo(-u * 0.45, bodyY + u * 0.18);
		ctx.closePath();
		ctx.fill();
	};
	if (accent) {
		ctx.fillStyle = accent;
		load();
		ctx.fillStyle = fill;
	}
	ctx.beginPath();
	ctx.ellipse(-u * 0.38, bodyY - u * 0.5, u * 0.2, u * 0.16, -0.3, 0, Math.PI * 2);
	ctx.ellipse(u * 0.28, bodyY - u * 0.52, u * 0.22, u * 0.15, 0.3, 0, Math.PI * 2);
	ctx.fill();
	ctx.lineWidth = u * 0.03;
	ctx.beginPath();
	ctx.moveTo(-u * 0.45, bodyY + u * 0.15);
	ctx.lineTo(-u * 0.5 + Math.sin(gait) * u * 0.06, bodyY + u * 0.45);
	ctx.stroke();
	ctx.restore();
}

/** Height of the leader's feet when he was at x, for those walking behind him. */
function trailHeight(trail: readonly TrailPoint[], x: number): number {
	if (!trail.length || x <= trail[0].x) return 0;
	let lo = 0;
	let hi = trail.length - 1;
	if (x >= trail[hi].x) return Math.max(0, trail[hi].y);
	while (hi - lo > 1) {
		const m = (lo + hi) >> 1;
		if (trail[m].x <= x) lo = m;
		else hi = m;
	}
	const a = trail[lo];
	const b = trail[hi];
	const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
	return Math.max(0, a.y + (b.y - a.y) * t);
}

function drawCaravan(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const { state, now } = frame;
	const lead = leaderX(frame);
	// "Fell down, and worshipped him": a deep bow at the door.
	const kneel = frame.arrival === null ? 0 : 0.72 * ease((frame.arrival - 2.6) / 0.9);
	const moving = state.phase === "running" ? true : frame.arrival !== null && frame.arrival < 2.4;
	const overhead = (x: number) =>
		state.hazards.some((hazard) => (hazard.kind === "ledge" || hazard.kind === "gust") && x > hazard.x - 0.9 && x < hazard.x + hazard.w + 0.5);
	const poses: { kind: "traveller" | "animal"; pose: Pose; look: number }[] = [];
	for (const walker of [...TRAIN].reverse()) {
		// Those behind stop short of the door and bow there too.
		const x = lead - walker.behind;
		const y = frame.arrival === null ? trailHeight(frame.trail, x) : 0;
		const ducked = (frame.arrival === null && overhead(x) ? 1 : 0) || (walker.kind === "traveller" ? kneel : kneel * 0.6);
		poses.push({ kind: walker.kind, look: walker.look, pose: { x, y, crouch: ducked, stride: x * 2.3, air: y > 0.15 ? 1 : 0, moving } });
	}
	const crouch = Math.max(state.ducking ? 1 : 0, kneel, state.phase === "lost" ? 0.4 : 0);
	poses.push({
		kind: "traveller",
		look: 0,
		pose: { x: lead, y: state.y, crouch: state.stagger > 0 ? 0.35 : crouch, stride: lead * 2.3, air: state.grounded ? 0 : 1, moving },
	});

	const accents = ["rgba(122, 34, 46, 0.55)", "rgba(40, 62, 110, 0.55)", "rgba(110, 82, 30, 0.55)", "rgba(70, 90, 60, 0.55)"];
	for (const layer of ["rim", "ink"] as const) {
		ctx.save();
		if (layer === "rim") ctx.translate(1.4, -1.2);
		const fill = layer === "rim" ? view.rim : rgb(view.ink);
		for (const { kind, pose, look } of poses) {
			if (view.sx(pose.x) < -view.unit * 3 || view.sx(pose.x) > frame.width + view.unit * 3) continue;
			if (kind === "traveller") drawTraveller(ctx, view, pose, look, now, fill);
			else drawAnimal(ctx, view, pose, look, fill, layer === "ink" ? accents[look] : null);
		}
		ctx.restore();
	}
	// The lead rope from the leader's hand to the first animal.
	if (frame.arrival === null) {
		const hand = { x: view.sx(lead) - view.unit * 0.1, y: view.sy(state.y + (state.ducking ? 0.55 : 1.1)) };
		const animalY = trailHeight(frame.trail, state.x - TRAIN[0].behind);
		const head = { x: view.sx(state.x - TRAIN[0].behind + 1.45), y: view.sy(animalY + (overhead(state.x - TRAIN[0].behind) ? 1.0 : 2.25)) };
		ctx.strokeStyle = rgb(view.ink);
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.moveTo(head.x, head.y);
		ctx.quadraticCurveTo((hand.x + head.x) / 2, Math.max(hand.y, head.y) + view.unit * 0.35, hand.x, hand.y);
		ctx.stroke();
	}
}

/** The house in Bethlehem: flat-roofed, its door alight. */
function drawHouse(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const left = view.sx(HOUSE_X - 0.4);
	const u = view.unit;
	if (left > frame.width + u * 6 || left + u * 6 < 0) return;
	const base = view.ground + 2;
	const arrived = frame.arrival === null ? 0 : ease(frame.arrival / 2.5);
	const outline = (dx: number, dy: number) => {
		ctx.beginPath();
		ctx.moveTo(left + dx, base);
		ctx.lineTo(left + dx, base - u * 3 + dy);
		ctx.lineTo(left - u * 0.15 + dx, base - u * 3 + dy);
		ctx.lineTo(left - u * 0.15 + dx, base - u * 3.3 + dy);
		ctx.lineTo(left + u * 4.6 + dx, base - u * 3.3 + dy);
		ctx.lineTo(left + u * 4.6 + dx, base - u * 3 + dy);
		ctx.lineTo(left + u * 4.45 + dx, base - u * 3 + dy);
		ctx.lineTo(left + u * 4.45 + dx, base);
		ctx.closePath();
		ctx.fill();
		// The outside stair up to the roof.
		ctx.beginPath();
		ctx.moveTo(left + u * 4.45 + dx, base);
		for (let k = 0; k < 6; k++) {
			ctx.lineTo(left + u * (5.9 - k * 0.24) + dx, base - u * (k * 0.5) + dy);
			ctx.lineTo(left + u * (5.9 - k * 0.24) + dx, base - u * ((k + 1) * 0.5) + dy);
		}
		ctx.lineTo(left + u * 4.45 + dx, base - u * 3 + dy);
		ctx.closePath();
		ctx.fill();
	};
	ctx.fillStyle = view.rim;
	outline(1.4, -1.2);
	ctx.fillStyle = rgb(view.ink);
	outline(0, 0);
	// The doorway and a window, warm with lamplight, brighter once they have come.
	const door = { x: left + u * 0.5, y: base - u * 1.9, w: u * 0.95, h: u * 1.9 };
	const light = ctx.createLinearGradient(0, door.y, 0, base);
	light.addColorStop(0, `rgba(255, 214, 140, ${0.7 + 0.3 * arrived})`);
	light.addColorStop(1, `rgba(230, 150, 70, ${0.6 + 0.3 * arrived})`);
	ctx.fillStyle = light;
	ctx.beginPath();
	ctx.moveTo(door.x, base - 1);
	ctx.lineTo(door.x, door.y + door.w / 2);
	ctx.arc(door.x + door.w / 2, door.y + door.w / 2, door.w / 2, Math.PI, 0);
	ctx.lineTo(door.x + door.w, base - 1);
	ctx.closePath();
	ctx.fill();
	ctx.fillRect(left + u * 2.6, base - u * 2.3, u * 0.55, u * 0.45);
	// Its light on the sand before the door.
	const pool = ctx.createRadialGradient(door.x + door.w / 2, base, 0, door.x + door.w / 2, base, u * (2.4 + 1.6 * arrived));
	pool.addColorStop(0, `rgba(255, 200, 120, ${0.28 + 0.2 * arrived})`);
	pool.addColorStop(1, "rgba(255, 200, 120, 0)");
	ctx.fillStyle = pool;
	ctx.fillRect(door.x - u * 5, base - u * 4, u * 10, u * 6);
}

function drawDust(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const { state, now } = frame;
	// Sand kicked up behind the leader's heels at pace.
	if (state.grounded && state.phase === "running") {
		ctx.fillStyle = "rgba(214, 180, 130, 0.35)";
		for (let k = 0; k < 5; k++) {
			const age = (now * 3 + k / 5) % 1;
			const x = view.sx(state.x - 0.3 - age * 1.4);
			const y = view.ground - view.unit * (0.1 + Math.sin(age * Math.PI) * 0.35);
			ctx.globalAlpha = 1 - age;
			ctx.fillRect(x, y, 2, 2);
		}
		ctx.globalAlpha = 1;
	}
	for (const [at, size, count] of [
		[state.landedAt, 0.5, 5],
		[state.stumbledAt, 0.9, 8],
	] as const) {
		const age = state.t - at;
		if (age < 0 || age > 0.6) continue;
		const x = view.sx(state.x - state.speed * age);
		const spread = view.unit * size * (0.4 + age * 2.2);
		ctx.fillStyle = `rgba(214, 180, 130, ${0.45 * (1 - age / 0.6)})`;
		for (let k = 0; k < count; k++) {
			const angle = Math.PI + (k / (count - 1)) * Math.PI;
			ctx.beginPath();
			ctx.arc(x + Math.cos(angle) * spread, view.ground + Math.sin(angle) * spread * 0.35, view.unit * 0.12 * (1 + age), 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

/** Desert grass and stones nearest of all, passing fastest. */
function drawForeground(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const depth = 1.35;
	const spacing = 7;
	const left = view.camera * depth - 2;
	const sway = Math.sin(frame.now * 1.6) * 0.12;
	ctx.fillStyle = "rgba(4, 3, 8, 0.95)";
	ctx.strokeStyle = "rgba(4, 3, 8, 0.95)";
	ctx.lineCap = "round";
	for (let i = Math.floor(left / spacing); i <= (left + view.span * 1.2 + 4) / spacing; i++) {
		if (hash(i * 7 + 3) < 0.4) continue;
		const x = (i * spacing + hash(i + 9) * 4 - view.camera * depth) * view.unit;
		const y = frame.height + 2;
		const s = view.unit * (0.5 + hash(i + 19) * 0.5);
		if (hash(i * 13) < 0.45) {
			ctx.beginPath();
			ctx.ellipse(x, y, s * 1.1, s * 0.45, 0, Math.PI, Math.PI * 2);
			ctx.fill();
			continue;
		}
		ctx.lineWidth = Math.max(1.5, s * 0.09);
		ctx.beginPath();
		for (let k = 0; k < 7; k++) {
			const lean = (k - 3) * 0.28 + sway;
			const tall = s * (1.2 + hash(i * 5 + k) * 0.9);
			ctx.moveTo(x + (k - 3) * s * 0.08, y);
			ctx.quadraticCurveTo(x + lean * tall * 0.4, y - tall * 0.6, x + lean * tall * 0.9, y - tall);
		}
		ctx.stroke();
	}
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string, scale: number, alpha: number) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.translate(x, y);
	ctx.scale(scale, scale);
	ctx.font = "900 17px system-ui, sans-serif";
	const w = ctx.measureText(text).width + 22;
	ctx.shadowColor = fill;
	ctx.shadowBlur = 14 * (scale - 0.8);
	ctx.fillStyle = fill;
	ctx.beginPath();
	ctx.roundRect(-w / 2, -15, w, 30, 15);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.fillStyle = ink;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 0, 1);
	ctx.restore();
}

function starShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
	ctx.beginPath();
	for (let k = 0; k < 8; k++) {
		const angle = -Math.PI / 2 + (k * Math.PI) / 4;
		const radius = k % 2 ? r * 0.38 : r;
		ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
	}
	ctx.closePath();
}

/** What to do about the hazard coming (JUMP or DUCK, glowing when it is time), the opening cue, the stars kept, a stumble's flash. */
function drawCues(ctx: CanvasRenderingContext2D, frame: CaravanFrame, view: View) {
	const { width, height, state, now } = frame;
	const playing = state.phase === "running";
	if (playing) {
		const coming: CaravanHazard[] = [];
		const first = nextHazard(state);
		if (first) {
			coming.push(first);
			const second = state.hazards.find((hazard) => hazard.id === first.id + 1);
			if (second) coming.push(second);
		}
		for (const hazard of coming) {
			const action = hazardAction(hazard.kind);
			const closing = state.speed + (hazard.kind === "gust" ? 4 : 0);
			const until = (hazard.x - CARAVAN_FOOT - state.x) / Math.max(1, closing);
			if (until > 1.7) continue;
			const alpha = clamp((1.7 - until) / 0.5, 0, 1);
			// Time to act: a jump about a fifth of a second before a rock or the lip, a duck just before the overhang.
			const act = action === "jump" ? until < 0.32 : until < 0.4;
			const pulse = act ? 1.12 + 0.1 * Math.sin(now * 24) : 0.9;
			const centre = view.sx(hazard.x + hazard.w / 2);
			const x = clamp(centre, 50, width - 50);
			const y = action === "jump" ? view.sy(hazard.kind === "rock" ? hazard.h + 2.4 : 2.6) : view.sy(4.9);
			const jump = action === "jump";
			const fill = jump ? "#ffd166" : "#7dd3fc";
			// A pointer down to it.
			ctx.save();
			ctx.globalAlpha = alpha * 0.9;
			ctx.fillStyle = fill;
			ctx.beginPath();
			ctx.moveTo(x - 7, y + 14);
			ctx.lineTo(x + 7, y + 14);
			ctx.lineTo(centre, y + 24);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
			chip(ctx, x, y, jump ? "JUMP ↑" : "DUCK ↓", fill, "#1b1206", pulse, alpha);
			if (act && hazard === first) {
				// The leader's ring, the colour of what to do.
				const lx = view.sx(state.x);
				const ly = view.sy(state.y + 1);
				ctx.strokeStyle = fill;
				ctx.globalAlpha = 0.85;
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc(lx, ly, view.unit * (1.25 + 0.15 * Math.sin(now * 24)), 0, Math.PI * 2);
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
		}
	}

	// The opening cue: the two controls, big.
	if (frame.hint > 0) {
		ctx.save();
		ctx.globalAlpha = frame.hint;
		ctx.fillStyle = "rgba(6, 6, 16, 0.55)";
		ctx.beginPath();
		ctx.roundRect(width / 2 - 150, 44, 300, 82, 16);
		ctx.fill();
		ctx.restore();
		const pulse = 1 + 0.06 * Math.sin(now * 9);
		chip(ctx, width / 2, 66, "↑ Space · Tap = JUMP", "#ffd166", "#1b1206", pulse, frame.hint);
		chip(ctx, width / 2, 104, "↓ · Swipe down = DUCK", "#7dd3fc", "#06121b", pulse, frame.hint);
		const lx = view.sx(state.x);
		const ly = view.sy(1);
		ctx.strokeStyle = `rgba(255, 220, 140, ${0.8 * frame.hint})`;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(lx, ly, view.unit * (1.1 + 0.3 * ((now * 1.5) % 1)), 0, Math.PI * 2);
		ctx.stroke();
	}

	// The stars kept: one goes dark at each stumble; the last lost is the star lost.
	const kept = CARAVAN_HITS - state.hits;
	ctx.fillStyle = "rgba(6, 6, 16, 0.45)";
	ctx.beginPath();
	ctx.roundRect(8, 8, 26 * CARAVAN_HITS + 10, 32, 12);
	ctx.fill();
	for (let k = 0; k < CARAVAN_HITS; k++) {
		const on = k < kept;
		ctx.fillStyle = on ? "#ffe9a8" : "rgba(255, 255, 255, 0.18)";
		if (on) {
			ctx.shadowColor = "#ffd166";
			ctx.shadowBlur = 8;
		}
		starShape(ctx, 26 + k * 26, 24, 10);
		ctx.fill();
		ctx.shadowBlur = 0;
	}

	if (frame.flash > 0) {
		ctx.fillStyle = `rgba(255, 70, 50, ${0.32 * frame.flash})`;
		ctx.fillRect(0, 0, width, height);
		chip(ctx, clamp(view.sx(state.x), 70, width - 70), view.sy(3.3), "Stumbled!", "#ff6b5a", "#fff", 1, Math.min(1, frame.flash * 1.6));
	}
}

export function drawCaravanScene(ctx: CanvasRenderingContext2D, frame: CaravanFrame) {
	const view = viewFor(frame);
	const { width, height, state } = frame;
	ctx.save();
	if (frame.shake > 0) ctx.translate(Math.sin(frame.now * 90) * 4 * frame.shake, Math.cos(frame.now * 77) * 3 * frame.shake);
	ctx.clearRect(-8, -8, width + 16, height + 16);
	drawSky(ctx, frame, view);
	drawStar(ctx, frame, view);
	// Far mountains, then the dunes, then the cities, then the land beside the road.
	drawRidge(ctx, frame, view, 0.05, view.ground - view.unit * 1.3, rgb(mix(view.sky.low, view.ink, 0.62)), (x) => 2 + 1.1 * Math.sin(x * 0.19) + 0.6 * Math.sin(x * 0.47 + 1) + 0.9 * (1 - Math.abs(Math.sin(x * 0.62))) + 0.25 * Math.abs(Math.sin(x * 2.1)));
	drawRidge(ctx, frame, view, 0.2, view.ground - view.unit * 0.4, rgb(mix(view.sky.mid, view.ink, 0.78)), (x) => 1 + 0.6 * Math.sin(x * 0.16) + 0.35 * Math.sin(x * 0.39 + 2));
	drawJerusalem(ctx, frame, view);
	drawBethlehem(ctx, frame, view);
	drawNearLand(ctx, frame, view);
	for (const hazard of state.hazards) if (hazard.kind === "ledge" && view.sx(hazard.x) < width + view.unit * 4 && view.sx(hazard.x + hazard.w) > -view.unit * 4) drawLedge(ctx, view, hazard, "back");
	drawRoad(ctx, frame, view);
	drawHouse(ctx, frame, view);
	for (const hazard of state.hazards) if (hazard.kind === "rock" && view.sx(hazard.x) < width + 20 && view.sx(hazard.x + hazard.w) > -20) drawRock(ctx, view, hazard);
	drawCaravan(ctx, frame, view);
	for (const hazard of state.hazards) {
		if (view.sx(hazard.x) > width + view.unit * 4 || view.sx(hazard.x + hazard.w) < -view.unit * 4) continue;
		if (hazard.kind === "ledge") drawLedge(ctx, view, hazard, "front");
		else if (hazard.kind === "gust") drawGust(ctx, frame, view, hazard);
	}
	drawDust(ctx, frame, view);
	drawForeground(ctx, frame, view);

	// The dark closes in as the star draws away.
	const fear = state.phase === "lost" ? 1 : clamp((65 - state.keep) / 65, 0, 1);
	if (fear > 0 && frame.arrival === null) {
		const shade = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, width * 0.8);
		shade.addColorStop(0, "rgba(0, 0, 0, 0)");
		shade.addColorStop(1, `rgba(0, 0, 0, ${0.55 * fear})`);
		ctx.fillStyle = shade;
		ctx.fillRect(0, 0, width, height);
	}
	drawCues(ctx, frame, view);
	ctx.restore();
}
