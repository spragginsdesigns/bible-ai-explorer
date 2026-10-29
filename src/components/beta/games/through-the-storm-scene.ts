import { BRACE_HOLD, STORM_GOAL, SWELL_WARNING, nextSwell, type StormState } from "@/lib/beta/games/through-the-storm-rules";

/**
 * Draws Through the Storm (LC-17851) on a 2D canvas, through Peter's eyes: a
 * night sea in perspective that pitches and rolls with the view, cloud and
 * rain driven by the wind, lightning that lights the whole sea, the great
 * swells rising ahead, and Jesus standing on the water in his own warm light,
 * small at first and nearer with every step. Pure drawing: everything it shows
 * comes from the simulation's state and the frame's clock, and nothing here
 * changes either.
 */

export interface StormFrame {
	width: number;
	height: number;
	state: StormState;
	/** Seconds on the page's clock, for the sea and the rain. */
	now: number;
	/** 1 is the full storm; it falls to 0 once the wind ceases. */
	storm: number;
	/** Lightning, 0-1, already faded by the caller (always 0 for reduced motion). */
	flash: number;
	/** Where the bolt struck, 0-1 across the sky. */
	boltAt: number;
	/** Seconds since the rescue began, or null. */
	rescue: number | null;
	/** Seconds since he reached Jesus, or null. */
	arrival: number | null;
	/** Show the focus ring and the swell's closing ring (only while walking). */
	guides: boolean;
	reduceMotion: boolean;
}

/** The focus ring's centre and radius in CSS pixels: the page maps a drag on the stage to ring radii with it. */
export function stormLayout(width: number, height: number) {
	return { cx: width / 2, cy: height * 0.45, ring: Math.max(34, Math.min(width, height) * 0.115) };
}

const EYE = 1.7; // eye height above the water, world units
const CHEST = 1.2; // where the eyes rest on Jesus
const HEIGHT = 1.85; // Jesus, standing
const SWELL_HEIGHT = 2.7;
const SWELL_FAR = 34; // where a swell rises
const FAR_SEA = 110;
const BANDS = 30;

/** Cloud banks: each a cluster of puffs, the back bank paler than the front. */
const CLOUDS = Array.from({ length: 14 }, (_, i) => ({
	u: (i * 0.618034) % 1,
	v: i % 2 === 0 ? 0.42 + ((i * 37) % 11) / 30 : 0.1 + ((i * 29) % 7) / 28,
	w: 0.2 + ((i * 17) % 7) * 0.04,
	back: i % 2 === 0,
	puffs: Array.from({ length: 5 }, (_, k) => ({ dx: (k - 2) * 0.42 + (((i + k) * 31) % 5) / 20, dy: -Math.abs(k - 2) * -0.1 - (((i * k + 3) * 7) % 5) / 14, r: 0.38 + (((i + 2 * k) * 13) % 5) / 12 })),
}));

/** Curtains of rain hanging from the clouds. */
const CURTAINS = Array.from({ length: 5 }, (_, i) => ({ u: (i * 0.381966 + 0.1) % 1, w: 0.08 + (i % 3) * 0.05 }));

const DROPS = Array.from({ length: 240 }, (_, i) => ({
	u: ((i * 0.6180339887) % 1) * 2 - 1,
	v: ((i * 0.7548776662) % 1) * 2 - 1.3,
	phase: (i * 0.5698402909) % 1,
	speed: 0.8 + ((i * 37) % 10) / 18,
}));

const SPRAY = Array.from({ length: 40 }, (_, i) => ({
	a: (i * 2.39996) % (Math.PI * 2),
	r: 0.35 + ((i * 53) % 10) / 14,
	size: 1.5 + ((i * 31) % 5),
}));

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

function ease(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

function mixColor(a: readonly number[], b: readonly number[], t: number, add = 0): string {
	return `rgb(${Math.round(clamp(a[0] + (b[0] - a[0]) * t + add, 0, 255))}, ${Math.round(clamp(a[1] + (b[1] - a[1]) * t + add, 0, 255))}, ${Math.round(clamp(a[2] + (b[2] - a[2]) * t + add * 1.15, 0, 255))})`;
}

let grain: CanvasPattern | null | undefined;
/** A fixed speckle of paint grain laid over the whole view, made once. */
function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
	if (grain !== undefined) return grain;
	const tile = document.createElement("canvas");
	tile.width = 160;
	tile.height = 160;
	const g = tile.getContext("2d");
	if (!g) return (grain = null);
	const image = g.createImageData(160, 160);
	let seed = 7;
	for (let i = 0; i < image.data.length; i += 4) {
		seed = (seed * 16807) % 2147483647;
		const v = seed % 255;
		image.data[i] = v;
		image.data[i + 1] = v;
		image.data[i + 2] = v;
		image.data[i + 3] = 22;
	}
	g.putImageData(image, 0, 0);
	return (grain = ctx.createPattern(tile, "repeat"));
}

interface CloudSprite {
	body: HTMLCanvasElement;
	warm: HTMLCanvasElement;
	cool: HTMLCanvasElement;
}
const cloudCache = new Map<string, CloudSprite | null>();

/** Each cloud painted once (per size) as soft overlapping puffs: its dark body and two rims for its lit underside. */
function cloudSprites(index: number, size: number): CloudSprite | null {
	const key = `${index}:${Math.round(size / 16)}`;
	const cached = cloudCache.get(key);
	if (cached !== undefined) return cached;
	if (cloudCache.size > 120) cloudCache.clear();
	const cloud = CLOUDS[index];
	const w = Math.ceil(size * 2.8);
	const h = Math.ceil(size * 1.3);
	const paint = (color: string, lift: number, spread: number) => {
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const g = canvas.getContext("2d");
		if (!g) return null;
		for (const puff of cloud.puffs) {
			for (let k = 0; k < 3; k++) {
				const r = size * puff.r * 0.55 * (1 - k * 0.18) * spread;
				const px = w / 2 + puff.dx * size + (k - 1) * r * 0.5;
				const py = h * 0.55 + puff.dy * size * 0.45 - lift * r + k * r * 0.12;
				const blob = g.createRadialGradient(px, py, 0, px, py, r);
				blob.addColorStop(0, color.replace("A", "0.9"));
				blob.addColorStop(0.55, color.replace("A", "0.65"));
				blob.addColorStop(1, color.replace("A", "0"));
				g.fillStyle = blob;
				g.save();
				g.translate(px, py);
				g.scale(1, 0.62);
				g.translate(-px, -py);
				g.fillRect(px - r, py - r, r * 2, r * 2);
				g.restore();
			}
		}
		return canvas;
	};
	const body = paint(cloud.back ? "rgba(22, 29, 42, A)" : "rgba(9, 13, 21, A)", 0.16, 1);
	const warm = paint("rgba(214, 160, 96, A)", 0, 1.04);
	const cool = paint("rgba(150, 168, 196, A)", 0, 1.04);
	// The faint cool rim every cloud has is baked in beneath its body: one draw instead of two each frame.
	const baked = body && cool ? document.createElement("canvas") : null;
	const bakedContext = baked?.getContext("2d");
	if (baked && bakedContext && body && cool) {
		baked.width = w;
		baked.height = h;
		bakedContext.globalAlpha = 0.24;
		bakedContext.drawImage(cool, 0, size * 0.05);
		bakedContext.globalAlpha = 1;
		bakedContext.drawImage(body, 0, 0);
	}
	const sprite = baked && warm && cool ? { body: baked, warm, cool } : null;
	cloudCache.set(key, sprite);
	return sprite;
}

interface Camera {
	f: number;
	eye: number;
	/** Where Jesus' chest is on screen: the point the gaze is measured from. */
	jx: number;
	jy: number;
	horizon: number;
	/** How far Jesus stands, world units. */
	dist: number;
	roll: number;
}

function cameraFor(frame: StormFrame): Camera {
	const { width, height, state, now, storm, rescue, arrival, reduceMotion } = frame;
	const { cx, cy, ring } = stormLayout(width, height);
	const f = height * 1.05;
	const swell = state.swells.find((item) => item.outcome === "braced" && item.eta < 0 && item.eta > -1);
	// Lifted over a braced swell as it rolls under him.
	const lift = swell ? Math.sin(Math.PI * clamp(-swell.eta / 1, 0, 1)) * 1.1 : 0;
	let eye = EYE * (1 - 0.72 * state.dip) + lift - (state.brace > 0 ? 0.25 : 0);
	if (state.phase === "sinking") eye = Math.max(0.12, EYE * (1 - 0.72 * state.dip) - state.sink * 0.9);
	if (rescue !== null) eye = 0.25 + (EYE - 0.25) * ease((rescue - 0.7) / 1.2);
	const remaining = STORM_GOAL - state.x;
	let dist = remaining * 0.45 + 4.5;
	
	let jx = cx + state.gazeX * ring;
	let jy = cy + state.gazeY * ring;
	// After the walk the eyes rest on him.
	const settle = arrival !== null ? ease(arrival / 0.8) : rescue !== null ? ease(rescue / 0.6) : 0;
	jx += (cx - jx) * settle;
	jy += (cy - jy) * settle;
	const rough = reduceMotion ? 0.15 : 1;
	const roll = ((0.055 * Math.sin(now * 0.9) + 0.025 * Math.sin(now * 2.1 + 1)) * (0.25 + storm) + state.wind * 0.012) * rough * (1 - settle * 0.8);
	return { f, eye, jx, jy, dist, roll, horizon: jy - (f * (eye - CHEST)) / dist };
}

/** The sea's surface lift (world units) at lateral X and depth z. */
function wave(frame: StormFrame, X: number, z: number): number {
	const { now, state, storm } = frame;
	const travel = (z + state.x * 0.45) * 0.85 + now * 0.9;
	return (0.12 + 0.42 * storm) * (0.6 * Math.sin(X * 0.33 + travel) + 0.4 * Math.sin(X * 0.81 - travel * 1.3 + 2) + 0.25 * Math.sin(X * 1.9 + travel * 2.1));
}

function paintSky(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera) {
	const { width, height, storm, flash, state, now } = frame;
	const calm = 1 - storm;
	const top = cam.horizon - height * 1.4;
	const light = flash * 110;
	const sky = ctx.createLinearGradient(0, top, 0, cam.horizon);
	sky.addColorStop(0, mixColor([2, 4, 9], [26, 40, 66], calm, light * 0.5));
	sky.addColorStop(0.62, mixColor([8, 13, 23], [70, 86, 110], calm, light * 0.8));
	sky.addColorStop(1, mixColor([26, 36, 50], [150, 150, 152], calm, light));
	ctx.fillStyle = sky;
	ctx.fillRect(-width * 0.2, Math.max(top, -height * 0.25), width * 1.4, cam.horizon - Math.max(top, -height * 0.25) + 2);

	// His light reaches up into the storm above him.
	const up = ctx.createRadialGradient(cam.jx, cam.horizon, 0, cam.jx, cam.horizon, height * 0.8);
	up.addColorStop(0, `rgba(196, 150, 92, ${0.32 + 0.2 * calm})`);
	up.addColorStop(0.5, "rgba(120, 92, 70, 0.1)");
	up.addColorStop(1, "rgba(120, 92, 70, 0)");
	ctx.fillStyle = up;
	ctx.fillRect(cam.jx - height * 0.8, cam.horizon - height * 0.8, height * 1.6, height * 0.8);

	// Curtains of rain sweeping under the clouds, slanted by the wind.
	if (storm > 0.1) {
		const slant = clamp(state.wind / 3, -1, 1) * height * 0.25;
		for (const curtain of CURTAINS) {
			const drift = (curtain.u + now * 0.01 + state.x * 0.001) % 1;
			const x = cam.jx + (drift - 0.5) * width * 2.4;
			const w = width * curtain.w;
			const g = ctx.createLinearGradient(0, cam.horizon - height * 0.55, 0, cam.horizon);
			g.addColorStop(0, "rgba(120, 140, 160, 0)");
			g.addColorStop(1, `rgba(${120 + light}, ${140 + light}, ${160 + light}, ${0.13 * storm})`);
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(x, cam.horizon - height * 0.55);
			ctx.lineTo(x + w, cam.horizon - height * 0.55);
			ctx.lineTo(x + w + slant, cam.horizon);
			ctx.lineTo(x + slant, cam.horizon);
			ctx.closePath();
			ctx.fill();
		}
	}

	// Cloud banks driven by the wind: soft masses with a rim lit beneath, warm near him, white in the lightning.
	for (const [index, cloud] of CLOUDS.entries()) {
		const drift = (cloud.u + now * 0.005 * (1 + 3 * storm) * (cloud.back ? 0.6 : 1) + state.x * 0.0009) % 1;
		const size = width * cloud.w * (cloud.back ? 0.8 : 1);
		const sprite = cloudSprites(index, size);
		if (!sprite) continue;
		const x = cam.jx + (drift - 0.5) * width * 2.8 - sprite.body.width / 2;
		const y = cam.horizon - cloud.v * height * 0.75 - sprite.body.height / 2;
		const near = 1 - clamp(Math.abs(x + sprite.body.width / 2 - cam.jx) / (width * 0.6), 0, 1);
		if (x > width * 1.2 || x + sprite.body.width < -width * 0.2) continue;
		const warm = clamp(near * (cloud.back ? 0.95 : 0.6) * (0.5 + 0.5 * (1 - cloud.v)) + 0.15 * calm, 0, 1);
		if (warm > 0.03) {
			ctx.globalAlpha = warm;
			ctx.drawImage(sprite.warm, x, y + size * 0.05);
		}
		if (flash > 0.02) {
			ctx.globalAlpha = clamp(flash * 1.2, 0, 1);
			ctx.drawImage(sprite.cool, x, y + size * 0.05);
		}
		ctx.globalAlpha = (cloud.back ? 0.8 : 0.97) * (0.35 + 0.65 * storm) * (1 - flash * 0.45);
		ctx.drawImage(sprite.body, x, y);
		ctx.globalAlpha = 1;
	}

	// Mist low on the water at the horizon.
	const mist = ctx.createLinearGradient(0, cam.horizon - height * 0.1, 0, cam.horizon + height * 0.03);
	mist.addColorStop(0, "rgba(60, 76, 96, 0)");
	mist.addColorStop(1, `rgba(${Math.round(70 + 60 * calm + light)}, ${Math.round(86 + 50 * calm + light)}, ${Math.round(104 + 40 * calm + light)}, ${0.3 + 0.2 * storm})`);
	ctx.fillStyle = mist;
	ctx.fillRect(-width, cam.horizon - height * 0.1, width * 3, height * 0.13);
}

let skyLayer: HTMLCanvasElement | null = null;

/**
 * The sky (its gradient, his light rising into it, the rain curtains, the clouds and the mist) is soft, so it is
 * painted at half resolution and laid on the view in one draw: most of the scene's pixels for a quarter of the work.
 */
function drawSky(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera) {
	const { width, height, flash } = frame;
	const left = -width * 0.2;
	const top = Math.max(cam.horizon - height * 1.4, -height * 0.25);
	const bottom = cam.horizon + height * 0.04;
	if (bottom <= top) return;
	const w = Math.ceil((width * 1.4) / 2);
	const h = Math.ceil((bottom - top) / 2);
	skyLayer ??= document.createElement("canvas");
	if (skyLayer.width !== w || skyLayer.height < h) {
		skyLayer.width = w;
		skyLayer.height = Math.max(h, Math.ceil(height * 0.9));
	}
	const g = skyLayer.getContext("2d");
	if (!g) return;
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.clearRect(0, 0, w, h + 1);
	g.setTransform(0.5, 0, 0, 0.5, -left / 2, -top / 2);
	paintSky(g, frame, cam);
	ctx.drawImage(skyLayer, 0, 0, w, h, left, top, w * 2, h * 2);
	// The bolt, for a moment.
	if (flash > 0.45) {
		const x0 = cam.jx + (frame.boltAt - 0.5) * width * 1.6;
		ctx.strokeStyle = `rgba(235, 240, 255, ${clamp((flash - 0.45) * 2.4, 0, 1)})`;
		ctx.lineWidth = Math.max(1.5, height * 0.004);
		ctx.lineJoin = "round";
		ctx.beginPath();
		let x = x0;
		let y = cam.horizon - height * 0.9;
		ctx.moveTo(x, y);
		let seed = Math.floor(frame.boltAt * 9973) + 1;
		while (y < cam.horizon - 2) {
			seed = (seed * 16807) % 2147483647;
			x += ((seed % 100) / 100 - 0.5) * height * 0.08;
			y += height * (0.04 + (seed % 7) / 140);
			ctx.lineTo(x, Math.min(y, cam.horizon));
		}
		ctx.stroke();
	}

}

function drawJesusLight(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera, size: number) {
	const { height, state, storm } = frame;
	const strength = 0.45 + 0.35 * (state.faith / 100) + 0.35 * (1 - storm);
	const radius = Math.max(height * 0.32, size * 2.4);
	const g = ctx.createRadialGradient(cam.jx, cam.jy, 0, cam.jx, cam.jy, radius);
	g.addColorStop(0, `rgba(255, 238, 196, ${0.6 * strength})`);
	g.addColorStop(0.25, `rgba(240, 196, 116, ${0.26 * strength})`);
	g.addColorStop(1, "rgba(229, 182, 100, 0)");
	ctx.globalCompositeOperation = "lighter";
	ctx.fillStyle = g;
	ctx.fillRect(cam.jx - radius, cam.jy - radius, radius * 2, radius * 2);
	ctx.globalCompositeOperation = "source-over";
}

/** Jesus on the water: a robed figure in light, the mantle over his head, no face drawn. */
function drawJesus(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera) {
	const s = (cam.f * HEIGHT) / cam.dist;
	const feet = cam.jy + (cam.f * CHEST) / cam.dist;
	// Arms open a little as Peter nears; at the end one is stretched out to him (drawn by the hands).
	const open = clamp((24 - (STORM_GOAL - frame.state.x)) / 24, 0, 1);
	const reaching = frame.arrival !== null;
	ctx.save();
	ctx.translate(cam.jx, feet);
	// Light pooled on the water at his feet.
	const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.9);
	pool.addColorStop(0, "rgba(255, 228, 170, 0.55)");
	pool.addColorStop(1, "rgba(255, 228, 170, 0)");
	ctx.fillStyle = pool;
	ctx.save();
	ctx.scale(1, 0.22);
	ctx.beginPath();
	ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	const sway = Math.sin(frame.now * 2.2) * s * 0.02 * frame.storm + frame.state.wind * s * 0.008;
	const robe = ctx.createLinearGradient(-s * 0.22, -s, s * 0.22, 0);
	robe.addColorStop(0, "#fff8e8");
	robe.addColorStop(0.55, "#f1e4c6");
	robe.addColorStop(1, "#c8a874");
	// Sleeves first, behind the body: hanging open at his sides.
	const sleeve = (side: -1 | 1, lift: number) => {
		ctx.fillStyle = side > 0 ? "#e9d8b4" : "#f4e8cc";
		ctx.beginPath();
		ctx.moveTo(side * s * 0.09, -s * 0.76);
		ctx.quadraticCurveTo(side * s * (0.2 + 0.08 * lift), -s * (0.62 + 0.05 * lift), side * s * (0.25 + 0.1 * lift), -s * (0.42 + 0.12 * lift));
		ctx.lineTo(side * s * (0.17 + 0.1 * lift), -s * (0.38 + 0.12 * lift));
		ctx.quadraticCurveTo(side * s * 0.13, -s * 0.56, side * s * 0.05, -s * 0.66);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = "#f0d3aa";
		ctx.beginPath();
		ctx.ellipse(side * s * (0.215 + 0.1 * lift), -s * (0.37 + 0.12 * lift), s * 0.03, s * 0.04, 0, 0, Math.PI * 2);
		ctx.fill();
	};
	sleeve(-1, open * 0.6);
	if (!reaching) sleeve(1, open);
	// The robe, falling to the water, stirred by the wind.
	ctx.fillStyle = robe;
	ctx.beginPath();
	ctx.moveTo(-s * 0.1, -s * 0.8);
	ctx.quadraticCurveTo(-s * 0.19, -s * 0.45, -s * 0.2 + sway, -s * 0.01);
	ctx.quadraticCurveTo(0, s * 0.03, s * 0.2 + sway, -s * 0.01);
	ctx.quadraticCurveTo(s * 0.19, -s * 0.45, s * 0.1, -s * 0.8);
	ctx.closePath();
	ctx.fill();
	// Folds.
	ctx.strokeStyle = "rgba(170, 132, 84, 0.35)";
	ctx.lineWidth = Math.max(0.6, s * 0.008);
	ctx.beginPath();
	for (const fx of [-0.07, 0.02, 0.1]) {
		ctx.moveTo(s * fx, -s * 0.5);
		ctx.quadraticCurveTo(s * (fx * 1.3) + sway * 0.5, -s * 0.25, s * fx * 1.5 + sway, -s * 0.03);
	}
	ctx.stroke();
	// The mantle across the body and up over the head.
	ctx.fillStyle = "rgba(201, 158, 96, 0.85)";
	ctx.beginPath();
	ctx.moveTo(-s * 0.11, -s * 0.8);
	ctx.quadraticCurveTo(s * 0.02, -s * 0.5, s * 0.17 + sway, -s * 0.12);
	ctx.lineTo(s * 0.2 + sway, -s * 0.2);
	ctx.quadraticCurveTo(s * 0.12, -s * 0.6, s * 0.06, -s * 0.8);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = "#e6cf9f";
	ctx.beginPath();
	ctx.moveTo(-s * 0.115, -s * 0.76);
	ctx.quadraticCurveTo(-s * 0.13, -s * 1.02, 0, -s * 1.03);
	ctx.quadraticCurveTo(s * 0.13, -s * 1.02, s * 0.115, -s * 0.76);
	ctx.closePath();
	ctx.fill();
	// Within the mantle, only light.
	const face = ctx.createRadialGradient(0, -s * 0.89, 0, 0, -s * 0.89, s * 0.11);
	face.addColorStop(0, "rgba(255, 250, 232, 1)");
	face.addColorStop(0.7, "rgba(255, 236, 196, 0.95)");
	face.addColorStop(1, "rgba(246, 214, 160, 0.9)");
	ctx.fillStyle = face;
	ctx.beginPath();
	ctx.ellipse(0, -s * 0.885, s * 0.072, s * 0.095, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** A great swell rising ahead and rolling in: a dark wall of water, its crest lit by his light behind it. */
function drawSwell(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera, z: number, eta: number) {
	const { width, height, now, storm, state } = frame;
	const rise = 0.35 + 0.65 * ease(1 - eta / SWELL_WARNING);
	const scale = cam.f / z;
	const peak = SWELL_HEIGHT * rise * (0.45 + 0.55 * storm);
	const base = cam.horizon + scale * cam.eye;
	const left = -width;
	const right = width * 2;
	const points: Array<[number, number]> = [];
	for (let sx = left; sx <= right; sx += 12) {
		const X = (sx - cam.jx) / scale;
		// Higher where it heaps up, lower toward its shoulders, ragged along the top.
		const heap = peak * (0.78 + 0.22 * Math.cos(X * 0.16 + 0.6)) + 0.16 * Math.sin(X * 0.9 + now * 1.6) + 0.08 * Math.sin(X * 2.3 - now * 2.6);
		points.push([sx, base - heap * scale]);
	}
	const crestTop = Math.min(...points.map((point) => point[1]));
	ctx.beginPath();
	ctx.moveTo(left, height * 2);
	for (const [sx, y] of points) ctx.lineTo(sx, y);
	ctx.lineTo(right, height * 2);
	ctx.closePath();
	const body = ctx.createLinearGradient(0, crestTop, 0, Math.max(base + scale * 0.6, crestTop + 20));
	const lit = frame.flash * 90;
	body.addColorStop(0, mixColor([86, 140, 140], [86, 140, 140], 0, lit));
	body.addColorStop(0.12, mixColor([34, 82, 92], [34, 82, 92], 0, lit * 0.8));
	body.addColorStop(0.5, mixColor([12, 38, 50], [12, 38, 50], 0, lit * 0.5));
	body.addColorStop(1, "rgb(4, 13, 20)");
	ctx.fillStyle = body;
	ctx.fill();
	// Streaks of foam drawn down the face by the wind.
	ctx.strokeStyle = `rgba(190, 220, 228, ${0.18 + 0.2 * storm})`;
	ctx.lineWidth = Math.max(1, scale * 0.025);
	ctx.lineCap = "round";
	ctx.beginPath();
	for (let i = 3; i < points.length; i += 5) {
		const [sx, y] = points[i];
		const run = (0.25 + ((i * 37) % 7) / 10) * scale * 0.6;
		ctx.moveTo(sx, y + scale * 0.08);
		ctx.quadraticCurveTo(sx + state.wind * 3, y + run * 0.5, sx - 4, y + run);
	}
	ctx.stroke();
	// The crest catches his light where it stands between him and Peter.
	ctx.globalCompositeOperation = "lighter";
	const lip = ctx.createRadialGradient(cam.jx, crestTop, 0, cam.jx, crestTop, width * 0.55);
	lip.addColorStop(0, "rgba(255, 216, 150, 0.6)");
	lip.addColorStop(1, "rgba(255, 216, 150, 0)");
	ctx.strokeStyle = lip;
	ctx.lineWidth = Math.max(2, scale * 0.09);
	ctx.beginPath();
	for (const [i, [sx, y]] of points.entries()) {
		if (i === 0) ctx.moveTo(sx, y);
		else ctx.lineTo(sx, y);
	}
	ctx.stroke();
	ctx.globalCompositeOperation = "source-over";
	// Spray torn off the crest downwind.
	ctx.strokeStyle = `rgba(226, 238, 244, ${0.25 + 0.35 * (1 - eta / SWELL_WARNING)})`;
	ctx.lineWidth = Math.max(1, Math.min(3, scale * 0.02));
	ctx.beginPath();
	for (let i = 0; i < points.length; i += 1) {
		const [sx, y] = points[i];
		const puff = ((i * 13 + Math.floor(now * 6)) % 9) / 9;
		if (puff > 0.5) continue;
		const run = scale * (0.12 + puff * 0.25);
		ctx.moveTo(sx, y - puff * scale * 0.1);
		ctx.lineTo(sx + (state.wind * 0.4 + 0.6) * run, y - puff * scale * 0.1 - run * 0.35);
	}
	ctx.stroke();
}

/** The sea in perspective, far to near, each row lit along its crest, with any swell drawn at its own depth. */
function drawSea(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera) {
	const { width, height, storm, flash, state } = frame;
	const zNear = Math.max(0.3, (cam.f * Math.max(cam.eye, 0.1)) / (height * 1.6 - cam.horizon));
	const swell = nextSwell(state);
	const swellZ = swell ? 0.35 + (swell.eta / SWELL_WARNING) * SWELL_FAR : null;
	let swellDrawn = swellZ === null;
	const calm = 1 - storm;
	const light = flash * 80;
	const foam = new Path2D();
	const glints = new Path2D();
	for (let i = 0; i <= BANDS; i++) {
		const t = i / BANDS;
		const z = FAR_SEA * Math.pow(zNear / FAR_SEA, t);
		if (!swellDrawn && swellZ !== null && z < swellZ && swell) {
			drawSwell(ctx, frame, cam, swellZ, swell.eta);
			swellDrawn = true;
		}
		const scale = cam.f / z;
		const y0 = cam.horizon + scale * cam.eye;
		const amp = (0.12 + 0.42 * storm) * scale;
		// Each row is filled only down to where the next, nearer row will cover it.
		const zNext = FAR_SEA * Math.pow(zNear / FAR_SEA, (i + 1) / BANDS);
		const bottom = i === BANDS ? height + 4 : Math.min(height + 4, cam.horizon + (cam.f / zNext) * (cam.eye + (0.12 + 0.42 * storm) * 1.3) + 2);
		ctx.beginPath();
		ctx.moveTo(-width * 0.5, bottom);
		const step = 9 + 12 * (1 - t);
		let prevCrest = false;
		for (let sx = -width * 0.5; sx <= width * 1.5; sx += step) {
			const X = (sx - cam.jx) / scale;
			const lift = wave(frame, X, z);
			const y = y0 - lift * scale;
			ctx.lineTo(sx, y);
			const crest = lift > (0.12 + 0.42 * storm) * 0.7;
			if (crest && t > 0.2) {
				if (!prevCrest) foam.moveTo(sx, y);
				else foam.lineTo(sx, y);
			}
			prevCrest = crest;
			const sparkle = Math.sin(X * 5.3 + z * 1.7 + frame.now * 2.6);
			if (Math.abs(X) < 0.7 + z * 0.05 && lift > 0.02 && sparkle > 0.35) {
				const half = Math.min(step, 4 + scale * 0.2) * (0.3 + 0.5 * sparkle);
				glints.moveTo(sx - half, y + 1.5);
				glints.lineTo(sx + half, y + 1.5);
			}
		}
		ctx.lineTo(width * 1.5, bottom);
		ctx.closePath();
		// Each row: the face catches the sky's light, the trough falls into shadow.
		const depth = Math.pow(t, 0.75);
		const top = y0 - amp * 1.1;
		const rows = ctx.createLinearGradient(0, top, 0, y0 + amp * 1.6 + 2);
		rows.addColorStop(0, mixColor([62 + 40 * calm, 92 + 36 * calm, 112 + 26 * calm], [44, 84, 98], depth, light));
		rows.addColorStop(0.45, mixColor([24 + 30 * calm, 44 + 30 * calm, 62 + 26 * calm], [12, 36, 48], depth, light * 0.7));
		rows.addColorStop(1, mixColor([12 + 20 * calm, 22 + 24 * calm, 34 + 20 * calm], [3, 10, 16], depth, light * 0.4));
		ctx.fillStyle = rows;
		ctx.fill();
	}
	if (!swellDrawn && swell && swellZ !== null) drawSwell(ctx, frame, cam, swellZ, swell.eta);

	ctx.lineCap = "round";
	ctx.strokeStyle = `rgba(206, 226, 236, ${0.12 + 0.4 * storm + flash * 0.3})`;
	ctx.lineWidth = Math.max(1, height * 0.003);
	ctx.stroke(foam);
	// His light on the water: a broken road of warm glints toward Peter.
	ctx.globalCompositeOperation = "lighter";
	const feet = cam.jy + (cam.f * CHEST) / cam.dist;
	const reach = height * 1.2 - feet;
	if (reach > 4) {
		ctx.save();
		ctx.translate(cam.jx, feet);
		ctx.scale(Math.max(0.12, (width * 0.1) / reach), 1);
		const road = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
		road.addColorStop(0, "rgba(255, 214, 150, 0.26)");
		road.addColorStop(0.4, "rgba(255, 214, 150, 0.08)");
		road.addColorStop(1, "rgba(255, 214, 150, 0)");
		ctx.fillStyle = road;
		ctx.fillRect(-reach, 0, reach * 2, reach);
		ctx.restore();
	}
	ctx.strokeStyle = `rgba(255, 214, 150, ${0.35 + 0.35 * (state.faith / 100)})`;
	ctx.lineWidth = Math.max(1.4, height * 0.0045);
	ctx.stroke(glints);
	ctx.globalCompositeOperation = "source-over";
	// Under the water on a rescue, only his light and his hand are seen.
	if (frame.rescue === null && !(state.phase === "sinking" && state.sink > 0.6)) drawJesus(ctx, frame, cam);
}

/** Rain driving at the eyes, slanted by the wind, faster as he walks. */
function drawRain(ctx: CanvasRenderingContext2D, frame: StormFrame) {
	const { width, height, now, storm, state } = frame;
	if (storm < 0.05) return;
	const { cx, cy } = stormLayout(width, height);
	const f = height * 0.9;
	const slant = clamp(state.wind / 2.5, -1.4, 1.4);
	const count = Math.round(DROPS.length * Math.min(1, storm));
	ctx.lineCap = "round";
	for (let layer = 0; layer < 2; layer++) {
		ctx.strokeStyle = layer === 0 ? `rgba(170, 192, 214, ${0.16 * storm + 0.04})` : `rgba(214, 228, 240, ${0.32 * storm + 0.05})`;
		ctx.lineWidth = layer === 0 ? 1 : Math.max(1.2, height * 0.0028);
		ctx.beginPath();
		for (let i = layer; i < count; i += 2) {
			const drop = DROPS[i];
			const life = (drop.phase + now * drop.speed * 0.55) % 1;
			const z = 6 - life * 5.6;
			const fall = life * 1.6;
			const wx = drop.u * 2.6 + slant * fall - state.gazeX * 0.25;
			const wy = drop.v * 1.6 + fall - state.gazeY * 0.2;
			const x1 = cx + (wx * f) / z;
			const y1 = cy + (wy * f) / z;
			const z0 = z + 0.45;
			const x0 = cx + ((wx - slant * 0.14) * f) / z0;
			const y0 = cy + ((wy - 0.14) * f) / z0;
			if ((layer === 1) !== (z < 2.4)) continue;
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
		}
		ctx.stroke();
	}
}

/** The sea at his own waist: it climbs the view as his eyes leave Jesus and his faith fails. */
function drawNearWater(ctx: CanvasRenderingContext2D, frame: StormFrame) {
	const { width, height, now, state, storm } = frame;
	const sinking = state.phase === "sinking" ? state.sink : 0;
	const rescueLift = frame.rescue !== null ? 1 - ease((frame.rescue - 0.7) / 1.2) : 1;
	const level = clamp(state.dip * 0.32 + sinking * 0.5, 0, 0.9) * rescueLift * (frame.arrival !== null ? 1 - ease(frame.arrival / 1.5) : 1);
	if (level < 0.02) return;
	const top = height * (1.02 - level);
	ctx.beginPath();
	ctx.moveTo(0, height);
	for (let x = 0; x <= width + 10; x += 10) {
		const y = top - Math.sin(x * 0.012 + now * 2.4) * height * 0.025 * (0.4 + storm) - Math.sin(x * 0.031 - now * 3.1) * height * 0.012;
		ctx.lineTo(x, y);
	}
	ctx.lineTo(width, height);
	ctx.closePath();
	const body = ctx.createLinearGradient(0, top - height * 0.04, 0, height);
	body.addColorStop(0, "rgba(64, 112, 128, 0.85)");
	body.addColorStop(0.12, "rgba(16, 44, 58, 0.92)");
	body.addColorStop(1, "rgba(3, 10, 16, 0.97)");
	ctx.fillStyle = body;
	ctx.fill();
	ctx.strokeStyle = `rgba(210, 230, 240, ${0.3 + 0.3 * storm})`;
	ctx.lineWidth = Math.max(1.5, height * 0.005);
	ctx.stroke();
}

interface Palette {
	sleeve: readonly [string, string];
	skin: readonly [string, string];
}

const PETER: Palette = { sleeve: ["#6b4e30", "#2a1d12"], skin: ["#b8865e", "#6a4a34"] };
const LORD: Palette = { sleeve: ["#fff6e2", "#d9bf8f"], skin: ["#f6dcb6", "#c99a6c"] };

/** An arm from (x0, y0) to an open hand at (x1, y1): a sleeve widening toward the near end, a palm, four fingers and a thumb. */
function drawArm(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number, palette: Palette, mirror: 1 | -1, far = 1.7) {
	const angle = Math.atan2(y1 - y0, x1 - x0);
	const length = Math.hypot(x1 - x0, y1 - y0);
	ctx.save();
	ctx.translate(x1, y1);
	ctx.rotate(angle);
	ctx.scale(1, mirror);
	const sleeve = ctx.createLinearGradient(0, -r * 1.6, 0, r * 1.6);
	sleeve.addColorStop(0, palette.sleeve[0]);
	sleeve.addColorStop(1, palette.sleeve[1]);
	ctx.fillStyle = sleeve;
	ctx.beginPath();
	ctx.moveTo(-r * 0.55, -r * 0.62);
	ctx.quadraticCurveTo(-length * 0.5, -r * (0.62 + far) * 0.5, -length - r * 0.2, -r * far);
	ctx.lineTo(-length - r * 0.2, r * far);
	ctx.quadraticCurveTo(-length * 0.5, r * (0.62 + far) * 0.5, -r * 0.55, r * 0.62);
	ctx.closePath();
	ctx.fill();
	// The cuff.
	ctx.strokeStyle = palette.sleeve[1];
	ctx.lineWidth = r * 0.12;
	ctx.beginPath();
	ctx.moveTo(-r * 0.62, -r * 0.66);
	ctx.lineTo(-r * 0.62, r * 0.66);
	ctx.stroke();
	const skin = ctx.createLinearGradient(0, -r, 0, r);
	skin.addColorStop(0, palette.skin[0]);
	skin.addColorStop(1, palette.skin[1]);
	ctx.fillStyle = skin;
	ctx.strokeStyle = skin;
	ctx.lineCap = "round";
	// Palm.
	ctx.beginPath();
	ctx.moveTo(-r * 0.5, -r * 0.42);
	ctx.quadraticCurveTo(r * 0.3, -r * 0.62, r * 0.62, -r * 0.42);
	ctx.lineTo(r * 0.66, r * 0.4);
	ctx.quadraticCurveTo(r * 0.2, r * 0.6, -r * 0.5, r * 0.42);
	ctx.closePath();
	ctx.fill();
	// Fingers, slightly fanned and open.
	const fingers = [
		[-0.33, 0.78],
		[-0.11, 0.9],
		[0.11, 0.86],
		[0.32, 0.7],
	] as const;
	ctx.lineWidth = r * 0.25;
	ctx.beginPath();
	for (const [offset, reach] of fingers) {
		ctx.moveTo(r * 0.55, r * offset);
		ctx.lineTo(r * (0.55 + reach), r * offset * 1.35);
	}
	ctx.stroke();
	// Thumb.
	ctx.lineWidth = r * 0.27;
	ctx.beginPath();
	ctx.moveTo(r * 0.05, -r * 0.4);
	ctx.quadraticCurveTo(r * 0.35, -r * 0.85, r * 0.72, -r * 0.92);
	ctx.stroke();
	ctx.restore();
}

/**
 * "Jesus stretched forth his hand": on a rescue his hand reaches down through the water from above, on the arrival
 * out of his light toward the eyes, and Peter's own hand rises to take it.
 */
function drawHands(ctx: CanvasRenderingContext2D, frame: StormFrame, cam: Camera) {
	const { width, height, state, rescue, arrival } = frame;
	const unit = Math.min(width, height);
	// On the rescue the hands meet mid-view; at the end, at his outstretched hand beside him.
	const size = (cam.f * HEIGHT) / cam.dist;
	const feet = cam.jy + (cam.f * CHEST) / cam.dist;
	const r = rescue !== null ? unit * 0.06 : Math.max(unit * 0.035, size * 0.05);
	const meetX = rescue !== null ? width / 2 + unit * 0.02 : cam.jx + size * 0.2;
	const meetY = rescue !== null ? height * 0.5 : feet - size * 0.36;
	let lord = 0;
	let peter = 0;
	if (rescue !== null) {
		lord = ease(rescue / 0.55);
		peter = 1;
	} else if (arrival !== null) {
		lord = ease((arrival - 0.2) / 0.8);
		peter = ease(arrival / 0.9);
	} else if (state.phase === "sinking") peter = ease(state.ended / 0.6);
	if (peter > 0) {
		// Peter's hand reaching up out of the bottom of the view.
		const sinkingReach = state.phase === "sinking" && rescue === null ? Math.sin(frame.now * 3) * unit * 0.02 : 0;
		const pr = Math.max(r * 1.3, unit * 0.055);
		const hx = arrival !== null ? meetX - pr * 0.2 : width / 2 - unit * 0.05 + sinkingReach;
		const target = arrival !== null || rescue !== null ? meetY + pr * 1.5 : height * 0.62;
		const hy = height + pr * 2 - (height + pr * 2 - target) * peter;
		drawArm(ctx, width / 2 - unit * 0.3, height + unit * 0.5, hx, hy, pr, PETER, 1);
	}
	if (lord > 0) {
		const glow = ctx.createRadialGradient(meetX, meetY, 0, meetX, meetY, unit * 0.5);
		glow.addColorStop(0, `rgba(255, 236, 190, ${0.5 * lord})`);
		glow.addColorStop(1, "rgba(255, 236, 190, 0)");
		ctx.globalCompositeOperation = "lighter";
		ctx.fillStyle = glow;
		ctx.fillRect(meetX - unit * 0.5, meetY - unit * 0.5, unit, unit);
		ctx.globalCompositeOperation = "source-over";
		// From above the water on a rescue; from his own shoulder at the end.
		const fromX = rescue !== null ? width / 2 + unit * 0.12 : cam.jx + size * 0.08;
		const fromY = rescue !== null ? -unit * 0.6 : feet - size * 0.74;
		const hx = fromX + (meetX + r * 0.3 - fromX) * lord;
		const hy = fromY + (meetY - r * 0.6 - fromY) * lord;
		ctx.globalAlpha = clamp(lord * 2, 0, 1);
		drawArm(ctx, fromX, fromY, hx, hy, r, LORD, -1, rescue !== null ? 1.7 : 0.9);
		ctx.globalAlpha = 1;
	}
}

/** The focus ring where the eyes rest, the swell's ring closing on it, and a mark toward Jesus when he is out of it. */
function drawGuides(ctx: CanvasRenderingContext2D, frame: StormFrame) {
	const { width, height, state } = frame;
	const { cx, cy, ring } = stormLayout(width, height);
	const off = Math.hypot(state.gazeX, state.gazeY);
	const inside = off < 1;
	ctx.lineWidth = 2;
	ctx.strokeStyle = inside ? "rgba(229, 182, 100, 0.85)" : "rgba(241, 234, 220, 0.4)";
	ctx.setLineDash(inside ? [] : [6, 7]);
	ctx.beginPath();
	ctx.arc(cx, cy, ring, 0, Math.PI * 2);
	ctx.stroke();
	ctx.setLineDash([]);
	// Small ticks at the ring's quarters, like a sighting mark.
	ctx.beginPath();
	for (let k = 0; k < 4; k++) {
		const a = (k * Math.PI) / 2;
		ctx.moveTo(cx + Math.cos(a) * ring * 0.86, cy + Math.sin(a) * ring * 0.86);
		ctx.lineTo(cx + Math.cos(a) * ring * 1.12, cy + Math.sin(a) * ring * 1.12);
	}
	ctx.stroke();

	if (!inside) {
		const a = Math.atan2(state.gazeY, state.gazeX);
		const px = cx + Math.cos(a) * ring * 1.35;
		const py = cy + Math.sin(a) * ring * 1.35;
		ctx.fillStyle = "rgba(255, 222, 160, 0.95)";
		ctx.beginPath();
		ctx.moveTo(px + Math.cos(a) * 11, py + Math.sin(a) * 11);
		ctx.lineTo(px + Math.cos(a + 2.4) * 9, py + Math.sin(a + 2.4) * 9);
		ctx.lineTo(px + Math.cos(a - 2.4) * 9, py + Math.sin(a - 2.4) * 9);
		ctx.closePath();
		ctx.fill();
		// At the stage's edge, his light shows where to look when he is out of sight.
		const ex = clamp(cx + state.gazeX * ring, 0, width);
		const ey = clamp(cy + state.gazeY * ring, 0, height);
		if (ex <= 1 || ex >= width - 1 || ey <= 1 || ey >= height - 1) {
			const edge = ctx.createRadialGradient(ex, ey, 0, ex, ey, height * 0.3);
			edge.addColorStop(0, "rgba(255, 220, 150, 0.45)");
			edge.addColorStop(1, "rgba(255, 220, 150, 0)");
			ctx.fillStyle = edge;
			ctx.fillRect(ex - height * 0.3, ey - height * 0.3, height * 0.6, height * 0.6);
		}
	}

	const swell = nextSwell(state);
	if (swell && swell.eta > 0) {
		// The swell's ring closes on the focus ring: brace as they meet.
		const ideal = BRACE_HOLD / 2;
		const r = ring * (1 + Math.max(0, swell.eta - ideal) * 1.25);
		const ready = swell.eta <= BRACE_HOLD;
		ctx.lineWidth = ready ? 4 : 2.5;
		ctx.strokeStyle = ready ? "rgba(255, 214, 140, 0.95)" : `rgba(196, 226, 240, ${0.25 + 0.6 * (1 - swell.eta / SWELL_WARNING)})`;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.stroke();
	}
}

/** A crest breaking over him: a sheet of water across the eyes, spray streaking outward. */
function drawStruck(ctx: CanvasRenderingContext2D, frame: StormFrame) {
	const { width, height } = frame;
	const struck = frame.state.swells.find((item) => item.outcome === "struck" && item.eta < 0 && item.eta > -1.1);
	if (!struck) return;
	const t = -struck.eta;
	const wash = 1 - ease(t / 1.1);
	// The sheet of water runs down the view, leaving runnels.
	ctx.fillStyle = `rgba(52, 104, 116, ${0.72 * wash})`;
	ctx.fillRect(0, 0, width, height);
	ctx.lineCap = "round";
	for (const [k, drop] of SPRAY.entries()) {
		const x = ((k * 0.618034) % 1) * width;
		const top = -height * 0.1 + drop.r * height * 0.3;
		const run = height * (0.15 + drop.r * 0.5) * ease(t / 0.8);
		ctx.strokeStyle = `rgba(214, 234, 240, ${(0.18 + 0.2 * ((k * 7) % 3) / 2) * wash})`;
		ctx.lineWidth = 1 + drop.size * 0.35;
		ctx.beginPath();
		ctx.moveTo(x, top);
		ctx.lineTo(x + Math.sin(k) * 6, top + run);
		ctx.stroke();
		ctx.fillStyle = `rgba(226, 240, 246, ${0.35 * wash})`;
		ctx.beginPath();
		ctx.arc(x + Math.sin(k) * 6, top + run, 1 + drop.size * 0.45, 0, Math.PI * 2);
		ctx.fill();
	}
}

export function drawStormScene(ctx: CanvasRenderingContext2D, frame: StormFrame) {
	const { width, height, state, rescue, arrival, reduceMotion } = frame;
	const cam = cameraFor(frame);
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = "#05080d";
	ctx.fillRect(0, 0, width, height);

	ctx.save();
	// A strike shakes the view for a moment.
	const struck = state.swells.find((item) => item.outcome === "struck" && item.eta < 0 && item.eta > -0.35);
	if (struck && !reduceMotion) ctx.translate(Math.sin(frame.now * 80) * 6 * (1 + struck.eta / 0.35), Math.cos(frame.now * 67) * 5 * (1 + struck.eta / 0.35));
	ctx.translate(cam.jx, cam.jy);
	ctx.rotate(cam.roll);
	ctx.translate(-cam.jx, -cam.jy);
	drawSky(ctx, frame, cam);
	drawJesusLight(ctx, frame, cam, (cam.f * HEIGHT) / cam.dist);
	drawSea(ctx, frame, cam);
	ctx.restore();

	drawRain(ctx, frame);
	drawNearWater(ctx, frame);
	drawStruck(ctx, frame);

	// Going under: the sea closes over the view, green-black, until the hand comes.
	if (state.phase === "sinking" || (rescue !== null && rescue < 1.6)) {
		const under = state.phase === "sinking" ? ease((state.sink - 0.35) / 0.65) : 1 - ease((rescue ?? 0) / 1.4);
		ctx.fillStyle = `rgba(4, 22, 28, ${0.7 * under})`;
		ctx.fillRect(0, 0, width, height);
		// His light still shows above the water.
		const above = ctx.createRadialGradient(width / 2, 0, 0, width / 2, 0, height * 0.7);
		above.addColorStop(0, `rgba(255, 222, 160, ${0.28 * under})`);
		above.addColorStop(1, "rgba(255, 222, 160, 0)");
		ctx.fillStyle = above;
		ctx.fillRect(0, 0, width, height * 0.7);
		ctx.strokeStyle = `rgba(200, 228, 236, ${0.5 * under})`;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (const [k, drop] of SPRAY.entries()) {
			const rise = (((k * 0.3819) % 1) + frame.now * (0.22 + (k % 5) * 0.06)) % 1;
			const bx = width * (0.2 + ((k * 0.618034) % 1) * 0.6) + Math.sin(frame.now * 3 + k) * 4;
			const by = height * (1 - rise);
			const br = 1.5 + drop.size * 0.6;
			ctx.moveTo(bx + br, by);
			ctx.arc(bx, by, br, 0, Math.PI * 2);
		}
		ctx.stroke();
	}
	drawHands(ctx, frame, cam);

	// The dark closes in as faith fails: "when he saw the wind boisterous, he was afraid".
	const fear = state.phase === "sinking" ? 1 : clamp((55 - state.faith) / 55, 0, 1);
	const calmed = arrival !== null || rescue !== null ? 0.4 : 1;
	const shade = ctx.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * (0.32 - 0.12 * fear), width / 2, height * 0.45, Math.max(width, height) * 0.75);
	shade.addColorStop(0, "rgba(0, 0, 0, 0)");
	shade.addColorStop(1, `rgba(0, 0, 0, ${(0.45 + 0.4 * fear) * calmed})`);
	ctx.fillStyle = shade;
	ctx.fillRect(0, 0, width, height);
	const pattern = grainPattern(ctx);
	if (pattern) {
		ctx.fillStyle = pattern;
		ctx.fillRect(0, 0, width, height);
	}
	if (frame.flash > 0) {
		ctx.fillStyle = `rgba(214, 226, 255, ${frame.flash * 0.35})`;
		ctx.fillRect(0, 0, width, height);
	}
	if (frame.guides && state.phase === "walking") drawGuides(ctx, frame);
}
