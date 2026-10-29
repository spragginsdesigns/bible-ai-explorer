import { EAST_LENGTH, STAR_LENGTH, STAR_LOST_LIMIT, legProgress, wrapAngle, type StarObstacle, type StarState } from "@/lib/beta/games/follow-the-star-rules";

/**
 * Draws Follow the Star (LC-17851) on a 2D canvas: a moonlit desert under a
 * deep, layered starfield and the Milky Way, the company travelling away from
 * the viewer, Jerusalem's lamps on the first leg's horizon, and on the second
 * the star that went before them, brighter than all the rest, with the cloud
 * banks that hide it, the ravines and rocky rises across the way, and the
 * house in Bethlehem it stands over at the end. Pure drawing: everything it
 * shows comes from the simulation's state and the frame's clock, and nothing
 * here changes either. No one in the house is drawn; its light is enough.
 */

export interface StarSceneFrame {
	width: number;
	height: number;
	state: StarState;
	/** Seconds on the page's clock, for the twinkle and the walk. */
	now: number;
	reduceMotion: boolean;
	/** The star's brightening as it is seen again, 0-1, already faded by the caller. */
	shimmer: number;
	/** Seconds since the company came to the house, or since it was lost, or null. */
	arrival: number | null;
	lost: number | null;
}

/** Half the view across, radians. */
const FOV_HALF = 0.62;
/** The camera's height over the sand, in the simulation's units: a little above the company, looking out over it. */
const CAM_H = 2.6;
/** Which way each leg runs in the sky, radians: west to Jerusalem, then on toward Bethlehem. */
const EAST_AXIS = 0;
const STAR_AXIS = 0.5;
const MOON = { az: -0.4, el: 0.3 };
const DUNE_SPACING = 5.5;
const DUNE_ROWS = 15;

// ---------------------------------------------------------------------------
// The sky's fixed furniture, made once from its own seeded random.

function seeded(seed: number) {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let r = Math.imul(s ^ (s >>> 15), 1 | s);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

/** The Milky Way's line across the sky: it climbs across the view from low on the left to high on the right. */
function bandElevation(az: number): number {
	return 0.27 + 0.2 * Math.sin(2 * az - 0.6);
}

interface SkyStar {
	az: number;
	el: number;
	size: number;
	light: number;
	phase: number;
	rate: number;
	tint: number;
	layer: number;
}

const TINTS = ["#ffffff", "#d6e2ff", "#ffeccc"];
const LAYER_DRIFT = [1, 0.985, 0.968];

const SKY_STARS: SkyStar[] = (() => {
	const rand = seeded(2_0901);
	const stars: SkyStar[] = [];
	for (let i = 0; i < 2400; i++) {
		const az = rand() * Math.PI * 2 - Math.PI;
		// A third gather along the Milky Way; the rest anywhere.
		const inBand = i % 3 === 0;
		const el = inBand ? bandElevation(az) + (rand() + rand() + rand() - 1.5) * 0.12 : 0.015 + Math.pow(rand(), 0.85) * 1.3;
		const r = rand();
		const bright = Math.pow(r, 5);
		stars.push({
			az,
			el,
			size: inBand ? 0.7 + rand() * 0.7 : 0.8 + bright * 2.2,
			light: inBand ? 0.25 + rand() * 0.45 : 0.3 + bright * 0.7,
			phase: rand() * Math.PI * 2,
			rate: 0.6 + rand() * 1.8,
			tint: rand() < 0.7 ? 0 : rand() < 0.5 ? 1 : 2,
			layer: i % 3,
		});
	}
	return stars;
})();

type Canvas = HTMLCanvasElement;
let sprites: { glow: Canvas; star: Canvas; moon: Canvas; cloud: Canvas; milky: Canvas; lamp: Canvas } | null = null;

function makeCanvas(width: number, height: number): Canvas {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function buildSprites() {
	// A soft round glow for the brighter stars and the lamps.
	const glow = makeCanvas(64, 64);
	{
		const g = glow.getContext("2d")!;
		const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, "rgba(255,255,255,1)");
		gradient.addColorStop(0.18, "rgba(255,255,255,.55)");
		gradient.addColorStop(0.5, "rgba(255,255,255,.12)");
		gradient.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = gradient;
		g.fillRect(0, 0, 64, 64);
	}

	// The star: a white heart, a gold halo and long fine rays.
	const star = makeCanvas(512, 512);
	{
		const g = star.getContext("2d")!;
		const c = 256;
		const halo = g.createRadialGradient(c, c, 0, c, c, c);
		halo.addColorStop(0, "rgba(255,252,240,1)");
		halo.addColorStop(0.03, "rgba(255,246,214,.95)");
		halo.addColorStop(0.09, "rgba(255,226,160,.45)");
		halo.addColorStop(0.25, "rgba(240,190,110,.12)");
		halo.addColorStop(0.6, "rgba(229,182,100,.03)");
		halo.addColorStop(1, "rgba(229,182,100,0)");
		g.fillStyle = halo;
		g.fillRect(0, 0, 512, 512);
		g.globalCompositeOperation = "lighter";
		const ray = (angle: number, length: number, width: number, alpha: number) => {
			g.save();
			g.translate(c, c);
			g.rotate(angle);
			const line = g.createLinearGradient(0, -length, 0, length);
			line.addColorStop(0, "rgba(255,236,190,0)");
			line.addColorStop(0.5, `rgba(255,248,226,${alpha})`);
			line.addColorStop(1, "rgba(255,236,190,0)");
			g.fillStyle = line;
			g.beginPath();
			g.moveTo(0, -length);
			g.lineTo(width, 0);
			g.lineTo(0, length);
			g.lineTo(-width, 0);
			g.closePath();
			g.fill();
			g.restore();
		};
		ray(0, 250, 3.2, 0.95);
		ray(Math.PI / 2, 190, 2.6, 0.8);
		ray(Math.PI / 4, 70, 1.6, 0.45);
		ray(-Math.PI / 4, 70, 1.6, 0.45);
		const core = g.createRadialGradient(c, c, 0, c, c, 10);
		core.addColorStop(0, "rgba(255,255,255,1)");
		core.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = core;
		g.fillRect(c - 12, c - 12, 24, 24);
	}

	// A thin crescent moon with its own faint light.
	const moon = makeCanvas(160, 160);
	{
		const g = moon.getContext("2d")!;
		const light = g.createRadialGradient(80, 80, 0, 80, 80, 80);
		light.addColorStop(0, "rgba(220,228,255,.28)");
		light.addColorStop(0.3, "rgba(200,210,255,.08)");
		light.addColorStop(1, "rgba(200,210,255,0)");
		g.fillStyle = light;
		g.fillRect(0, 0, 160, 160);
		const disc = makeCanvas(160, 160);
		const d = disc.getContext("2d")!;
		d.fillStyle = "#eef0ff";
		d.beginPath();
		d.arc(80, 80, 18, 0, Math.PI * 2);
		d.fill();
		d.globalCompositeOperation = "destination-out";
		d.beginPath();
		d.arc(88, 75, 17, 0, Math.PI * 2);
		d.fill();
		g.drawImage(disc, 0, 0);
	}

	// A cloud bank: dark, many-lobed, its upper edges caught by the moon.
	const cloud = makeCanvas(760, 300);
	{
		const g = cloud.getContext("2d")!;
		const rand = seeded(77);
		for (let pass = 0; pass < 2; pass++) {
			for (let i = 0; i < 46; i++) {
				const t = i / 45;
				const hump = Math.sin(t * Math.PI);
				const r = 34 + hump * 56 + rand() * 18;
				const x = 120 + t * 520 + (rand() - 0.5) * 30;
				const y = 172 - hump * 34 + (rand() - 0.5) * 24 - (pass === 0 ? 6 : 0);
				const lobe = g.createRadialGradient(x, y, 0, x, y, r);
				if (pass === 0) {
					lobe.addColorStop(0, "rgba(110,122,170,.22)");
					lobe.addColorStop(1, "rgba(110,122,170,0)");
				} else {
					lobe.addColorStop(0, "rgba(15,18,38,.96)");
					lobe.addColorStop(0.65, "rgba(17,21,44,.8)");
					lobe.addColorStop(1, "rgba(17,21,44,0)");
				}
				g.fillStyle = lobe;
				g.beginPath();
				g.arc(x, y, r, 0, Math.PI * 2);
				g.fill();
			}
		}
	}

	// The Milky Way all the way round, small and soft (it is drawn large).
	const milky = makeCanvas(1024, 210);
	{
		const g = milky.getContext("2d")!;
		const rand = seeded(1612);
		const perRad = 1024 / (Math.PI * 2);
		const perEl = 210 / 1.3;
		const colors = ["176,190,255", "214,200,255", "255,240,220"];
		for (let i = 0; i < 2600; i++) {
			const az = rand() * Math.PI * 2 - Math.PI;
			const spread = (rand() + rand() + rand() - 1.5) * 0.16;
			const el = bandElevation(az) + spread;
			const x = (az + Math.PI) * perRad;
			const y = 210 - el * perEl;
			const r = 3 + rand() * (i < 300 ? 22 : 9);
			const alpha = (i < 300 ? 0.05 : 0.1) * (1 - Math.abs(spread) * 3);
			if (alpha <= 0) continue;
			const blob = g.createRadialGradient(x, y, 0, x, y, r);
			blob.addColorStop(0, `rgba(${colors[i % 3]},${alpha})`);
			blob.addColorStop(1, `rgba(${colors[i % 3]},0)`);
			g.fillStyle = blob;
			g.fillRect(x - r, y - r, r * 2, r * 2);
		}
		// The dark rifts of dust down its middle.
		g.globalCompositeOperation = "destination-out";
		for (let i = 0; i < 420; i++) {
			const az = rand() * Math.PI * 2 - Math.PI;
			const el = bandElevation(az) + (rand() - 0.5) * 0.06 + 0.02 * Math.sin(az * 5);
			const x = (az + Math.PI) * perRad;
			const y = 210 - el * perEl;
			const r = 2 + rand() * 6;
			const blob = g.createRadialGradient(x, y, 0, x, y, r);
			blob.addColorStop(0, "rgba(0,0,0,.18)");
			blob.addColorStop(1, "rgba(0,0,0,0)");
			g.fillStyle = blob;
			g.fillRect(x - r, y - r, r * 2, r * 2);
		}
	}

	// A lamp's warm light.
	const lamp = makeCanvas(64, 64);
	{
		const g = lamp.getContext("2d")!;
		const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, "rgba(255,226,160,1)");
		gradient.addColorStop(0.15, "rgba(255,200,120,.6)");
		gradient.addColorStop(0.5, "rgba(240,170,90,.12)");
		gradient.addColorStop(1, "rgba(240,170,90,0)");
		g.fillStyle = gradient;
		g.fillRect(0, 0, 64, 64);
	}
	return { glow, star, moon, cloud, milky, lamp };
}

// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

function smooth(from: number, to: number, value: number): number {
	const x = clamp((value - from) / (to - from), 0, 1);
	return x * x * (3 - 2 * x);
}

/** Small and repeatable: the same id always gives the same rocks. */
function hash(n: number): number {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
}

interface View {
	width: number;
	height: number;
	cx: number;
	horizon: number;
	perRad: number;
	/** The heading the camera looks along, in the sky's frame. */
	look: number;
	axis: number;
	companyY: number;
	companyDist: number;
}

function viewFor(frame: StarSceneFrame): View {
	const { width, height, state } = frame;
	const perRad = width / 2 / FOV_HALF;
	const horizon = height * (width > height ? 0.6 : 0.56);
	const companyY = horizon + 0.5 * (height - horizon);
	const companyDist = CAM_H / Math.tan((companyY - horizon) / perRad);
	const axis = state.phase === "east" || state.phase === "jerusalem" ? EAST_AXIS : STAR_AXIS;
	return { width, height, cx: width / 2, horizon, perRad, look: axis + state.heading, axis, companyY, companyDist };
}

/** A point on the sand in the leg's frame, as the camera sees it: screen x, y and pixels per unit. */
function ground(view: View, state: StarState, s: number, lat: number) {
	const dx = s - state.s;
	const dy = lat - state.lat;
	const cos = Math.cos(state.heading);
	const sin = Math.sin(state.heading);
	const f = dx * cos + dy * sin + view.companyDist;
	const r = -dx * sin + dy * cos;
	return { f, x: view.cx + Math.atan2(r, f) * view.perRad, y: view.horizon + Math.atan2(CAM_H, f) * view.perRad, scale: view.perRad / Math.max(0.01, f) };
}

/** A point in the sky by its bearing and height, both radians. */
function sky(view: View, az: number, el: number) {
	return { x: view.cx + wrapAngle(az - view.look) * view.perRad, y: view.horizon - el * view.perRad };
}

/** Where the star stands in the sky: well up at first, coming lower toward the end to stand over the house. */
function starSky(frame: StarSceneFrame, view: View) {
	const progress = legProgress(frame.state);
	const high = view.width > view.height ? 0.2 : 0.42;
	const fraction = high + (0.68 - high) * smooth(0.65, 1, progress);
	return sky(view, view.axis + frame.state.bearing, ((1 - fraction) * view.horizon) / view.perRad);
}

function starVisible(frame: StarSceneFrame): number {
	const { state } = frame;
	if (state.phase !== "star" && state.phase !== "arrived" && state.phase !== "lost") return 0;
	// "Lo, the star": it comes out as they depart.
	const appear = smooth(0.2, 1.8, state.legT);
	return appear * (1 - smooth(0.25, 0.55, state.cover));
}

// ---------------------------------------------------------------------------

function drawSky(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View, dim: number) {
	const { width, height } = view;
	const gradient = ctx.createLinearGradient(0, 0, 0, view.horizon);
	gradient.addColorStop(0, "#02040c");
	gradient.addColorStop(0.4, "#081032");
	gradient.addColorStop(0.78, "#1a1f50");
	gradient.addColorStop(0.94, "#3a3470");
	gradient.addColorStop(1, "#4d3f74");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, view.horizon + 2);

	const art = sprites!;
	// The Milky Way, turning with the heading.
	const span = Math.PI * 2 * view.perRad;
	const top = view.horizon - 1.3 * view.perRad;
	ctx.globalAlpha = 0.95 * dim;
	let x0 = view.cx + (-Math.PI - view.look * LAYER_DRIFT[2]) * view.perRad;
	while (x0 > 0) x0 -= span;
	for (let x = x0; x < width; x += span) ctx.drawImage(art.milky, x, top, span, 1.3 * view.perRad);
	ctx.globalAlpha = 1;

	// The stars, in three layers that turn at slightly different rates.
	const twinkle = !frame.reduceMotion;
	const drift = frame.now * 0.0012;
	let tint = -1;
	for (const star of SKY_STARS) {
		const rel = wrapAngle(star.az - view.look * LAYER_DRIFT[star.layer] - drift);
		if (rel < -FOV_HALF - 0.02 || rel > FOV_HALF + 0.02) continue;
		const x = view.cx + rel * view.perRad;
		const y = view.horizon - star.el * view.perRad;
		if (y < -4 || y > view.horizon - 1) continue;
		const shimmer = twinkle ? 0.72 + 0.28 * Math.sin(frame.now * star.rate + star.phase) : 0.9;
		const alpha = star.light * shimmer * smooth(0, 0.09, star.el) * dim;
		if (alpha < 0.02) continue;
		if (star.size > 1.9) {
			ctx.globalAlpha = alpha * 0.55;
			const r = star.size * 3.2;
			ctx.drawImage(art.glow, x - r, y - r, r * 2, r * 2);
		}
		if (star.tint !== tint) {
			tint = star.tint;
			ctx.fillStyle = TINTS[tint];
		}
		ctx.globalAlpha = alpha;
		const s = Math.min(2.2, star.size);
		ctx.fillRect(x - s / 2, y - s / 2, s, s);
	}
	ctx.globalAlpha = 1;

	// The moon, low and thin.
	const moon = sky(view, MOON.az, MOON.el);
	const moonSize = 0.16 * view.perRad;
	if (moon.x > -moonSize && moon.x < width + moonSize) {
		ctx.globalAlpha = 0.95 * dim;
		ctx.drawImage(art.moon, moon.x - moonSize / 2, moon.y - moonSize / 2, moonSize, moonSize);
		ctx.globalAlpha = 1;
	}
	void height;
}

function drawTheStar(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const visible = starVisible(frame);
	if (visible <= 0.01) return;
	const { x, y } = starSky(frame, view);
	const art = sprites!;
	const breathe = frame.reduceMotion ? 1 : 1 + 0.05 * Math.sin(frame.now * 1.4);
	const lift = 1 + 0.35 * frame.shimmer;
	// The light it casts across the sky around it.
	const wide = view.height * 0.75;
	const halo = ctx.createRadialGradient(x, y, 0, x, y, wide);
	halo.addColorStop(0, `rgba(255,226,170,${0.2 * visible * lift})`);
	halo.addColorStop(0.4, `rgba(229,182,100,${0.05 * visible})`);
	halo.addColorStop(1, "rgba(229,182,100,0)");
	ctx.fillStyle = halo;
	ctx.fillRect(x - wide, y - wide, wide * 2, wide * 2);
	const size = Math.max(150, 0.42 * view.perRad) * breathe * lift;
	ctx.globalAlpha = visible;
	ctx.globalCompositeOperation = "lighter";
	ctx.drawImage(art.star, x - size / 2, y - size / 2, size, size);
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
}

function drawClouds(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const { state } = frame;
	const art = sprites!;
	// Thin wisps that are always somewhere, drifting slowly.
	for (let i = 0; i < 4; i++) {
		const az = -Math.PI + ((i * 1.7 + frame.now * 0.004) % (Math.PI * 2));
		const p = sky(view, az, 0.12 + 0.08 * i);
		const w = 0.9 * view.perRad;
		ctx.globalAlpha = 0.18;
		ctx.drawImage(art.cloud, p.x - w / 2, p.y - w * 0.2, w, w * 0.4);
	}
	ctx.globalAlpha = 1;
	if (state.cover <= 0) return;
	// The bank rolls in from one side over where the star is, and away to the other.
	const star = starSky(frame, view);
	const offset = (1 - state.cover) * 0.62 * view.perRad * (state.cloudTarget === 1 ? 1 : -1);
	const w = 1.15 * view.perRad;
	const h = w * 0.42;
	ctx.globalAlpha = smooth(0, 0.3, state.cover);
	ctx.drawImage(art.cloud, star.x + offset - w / 2, star.y - h * 0.58, w, h);
	ctx.globalAlpha = 1;
}

function ridge(az: number, layer: number): number {
	return layer === 0
		? 0.05 + 0.024 * Math.sin(3 * az + 1) + 0.013 * Math.sin(7 * az + 2) + 0.006 * Math.sin(13 * az + 0.5)
		: 0.026 + 0.017 * Math.sin(2 * az + 3) + 0.01 * Math.sin(9 * az + 1) + 0.005 * Math.sin(17 * az);
}

function drawHills(ctx: CanvasRenderingContext2D, view: View) {
	for (const [layer, fill, rim] of [
		[0, "#1d1f46", "rgba(160,166,226,.22)"],
		[1, "#13152f", "rgba(176,180,236,.3)"],
	] as const) {
		ctx.beginPath();
		ctx.moveTo(0, view.horizon + 2);
		for (let x = 0; x <= view.width + 8; x += 8) {
			const az = view.look + (x - view.cx) / view.perRad;
			ctx.lineTo(x, view.horizon - ridge(az, layer) * view.perRad);
		}
		ctx.lineTo(view.width, view.horizon + 2);
		ctx.closePath();
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.strokeStyle = rim;
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 0; x <= view.width + 8; x += 8) {
			const az = view.look + (x - view.cx) / view.perRad;
			const y = view.horizon - ridge(az, layer) * view.perRad;
			if (x === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}
}

function drawGroundBase(ctx: CanvasRenderingContext2D, view: View) {
	const gradient = ctx.createLinearGradient(0, view.horizon, 0, view.height);
	gradient.addColorStop(0, "#3a3762");
	gradient.addColorStop(0.35, "#29284a");
	gradient.addColorStop(1, "#151427");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, view.horizon, view.width, view.height - view.horizon);
}

/** One row of dunes `f` units from the camera: sharp crests, the moon on their left faces, filled down to the bottom of the view. */
function drawDuneRow(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View, f: number, row: number) {
	const base = view.horizon + Math.atan2(CAM_H, f) * view.perRad;
	const amplitude = Math.min(view.height * 0.08, (1.1 / f) * view.perRad);
	if (base - amplitude > view.height) return;
	const haze = clamp((f - 10) / 75, 0, 1);
	const seed = row * 1.37;
	const lat = frame.state.lat;
	const step = 6;
	const xs: number[] = [];
	const ys: number[] = [];
	for (let x = -step; x <= view.width + step; x += step) {
		const az = view.look + (x - view.cx) / view.perRad;
		const u = 0.22 * (az * f + lat) + seed;
		const ridge = 1 - Math.abs(Math.sin(u));
		const swell = 0.5 + 0.5 * Math.sin(0.37 * u + seed * 2.3);
		xs.push(x);
		ys.push(base - amplitude * (0.15 + 0.85 * ridge * ridge * (0.45 + 0.55 * swell)));
	}
	ctx.beginPath();
	ctx.moveTo(xs[0], view.height + 2);
	for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
	ctx.lineTo(xs[xs.length - 1], view.height + 2);
	ctx.closePath();
	const mix = (near: number[], far: number[]) => near.map((value, i) => Math.round(value + (far[i] - value) * haze)).join(",");
	const fill = ctx.createLinearGradient(0, base - amplitude, 0, base + amplitude * 1.4);
	fill.addColorStop(0, `rgb(${mix([92, 86, 120], [70, 64, 106])})`);
	fill.addColorStop(0.45, `rgb(${mix([50, 46, 76], [56, 52, 92])})`);
	fill.addColorStop(1, `rgb(${mix([24, 22, 40], [44, 41, 76])})`);
	ctx.fillStyle = fill;
	ctx.fill();
	// The faces that turn toward the moon catch its light along the crest.
	ctx.strokeStyle = `rgba(206,204,240,${0.12 + 0.3 * (1 - haze)})`;
	ctx.lineWidth = 1 + (1 - haze);
	ctx.beginPath();
	for (let i = 1; i < xs.length; i++) {
		if (ys[i] < ys[i - 1]) {
			ctx.moveTo(xs[i - 1], ys[i - 1]);
			ctx.lineTo(xs[i], ys[i]);
		}
	}
	ctx.stroke();
}

function drawObstacle(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View, obstacle: StarObstacle) {
	const { state } = frame;
	const centre = ground(view, state, obstacle.s, obstacle.lat);
	if (centre.f < 0.8) return;
	const rand = (i: number) => hash(obstacle.id * 31 + i);
	if (obstacle.kind === "rise") {
		// A rocky rise: broken stone heaped up out of the sand, lit on the moon's side.
		const w = obstacle.half * 2 * centre.scale;
		const h = (0.75 + rand(1) * 0.35) * centre.scale;
		const points: [number, number][] = [];
		const n = 8;
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const bump = Math.sin(t * Math.PI) * (0.65 + 0.35 * rand(i + 2)) + (i % 2 ? 0.08 : -0.04);
			points.push([centre.x - w / 2 + t * w, centre.y - h * Math.max(0, bump)]);
		}
		ctx.fillStyle = "rgba(6,8,20,.55)";
		ctx.beginPath();
		ctx.ellipse(centre.x + w * 0.18, centre.y + 1, w * 0.62, Math.max(2, h * 0.16), 0, 0, Math.PI * 2);
		ctx.fill();
		const stone = ctx.createLinearGradient(centre.x - w / 2, centre.y - h, centre.x + w / 2, centre.y);
		stone.addColorStop(0, "#3a4170");
		stone.addColorStop(0.45, "#1d2140");
		stone.addColorStop(1, "#0d1024");
		ctx.fillStyle = stone;
		ctx.beginPath();
		ctx.moveTo(centre.x - w / 2, centre.y + 1);
		for (const [x, y] of points) ctx.lineTo(x, y);
		ctx.lineTo(centre.x + w / 2, centre.y + 1);
		ctx.closePath();
		ctx.fill();
		ctx.strokeStyle = "rgba(196,206,250,.4)";
		ctx.lineWidth = Math.max(1, centre.scale * 0.03);
		ctx.beginPath();
		points.slice(0, 6).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
		ctx.stroke();
		// A crack or two in the stone.
		ctx.strokeStyle = "rgba(4,5,14,.6)";
		ctx.beginPath();
		ctx.moveTo(centre.x - w * 0.1, centre.y - h * 0.5);
		ctx.lineTo(centre.x + w * 0.02, centre.y - h * 0.15);
		ctx.moveTo(centre.x + w * 0.22, centre.y - h * 0.42);
		ctx.lineTo(centre.x + w * 0.15, centre.y);
		ctx.stroke();
		return;
	}
	// A ravine: a dark gash across the way, its far wall pale in the moonlight.
	const near = ground(view, state, obstacle.s - obstacle.depth / 2, obstacle.lat);
	const far = ground(view, state, obstacle.s + obstacle.depth / 2, obstacle.lat);
	if (near.f < 0.8) return;
	const nearW = obstacle.half * near.scale;
	const farW = obstacle.half * far.scale;
	const n = 10;
	const edge = (side: number, i: number) => 0.12 * Math.sin(i * 2.1 + obstacle.id + side) * (side ? near.scale : far.scale);
	ctx.beginPath();
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const taper = Math.sin(t * Math.PI);
		const x = far.x - farW + t * farW * 2;
		const y = far.y + edge(0, i) * 0.4 + (1 - taper) * (near.y - far.y) * 0.5;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	for (let i = n; i >= 0; i--) {
		const t = i / n;
		const taper = Math.sin(t * Math.PI);
		ctx.lineTo(near.x - nearW + t * nearW * 2, near.y + edge(1, i) * 0.3 - (1 - taper) * (near.y - far.y) * 0.5);
	}
	ctx.closePath();
	ctx.fillStyle = "#05060f";
	ctx.fill();
	// The far wall catches the light.
	const wall = Math.max(1.5, (near.y - far.y) * 0.32);
	ctx.fillStyle = "rgba(110,122,180,.32)";
	ctx.beginPath();
	for (let i = 1; i < n; i++) {
		const t = i / n;
		const x = far.x - farW + t * farW * 2;
		const y = far.y + edge(0, i) * 0.4;
		if (i === 1) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	for (let i = n - 1; i >= 1; i--) {
		const t = i / n;
		ctx.lineTo(far.x - farW + t * farW * 2, far.y + edge(0, i) * 0.4 + wall * Math.sin(t * Math.PI));
	}
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = "rgba(190,200,246,.3)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(near.x - nearW, near.y);
	for (let i = 1; i <= n; i++) {
		const t = i / n;
		ctx.lineTo(near.x - nearW + t * nearW * 2, near.y + edge(1, i) * 0.3 - (1 - Math.sin(t * Math.PI)) * (near.y - far.y) * 0.5);
	}
	ctx.stroke();
}

/** Jerusalem on the first leg's horizon: walls and towers, and lamps in the night. */
function drawJerusalem(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const at = ground(view, frame.state, EAST_LENGTH + 7, 0);
	if (at.f < 1) return;
	const u = at.scale;
	const w = 11 * u;
	const left = at.x - w / 2;
	const art = sprites!;
	// A warm haze over the city.
	const haze = ctx.createRadialGradient(at.x, at.y - u, 0, at.x, at.y - u, w * 0.9);
	haze.addColorStop(0, "rgba(240,180,110,.2)");
	haze.addColorStop(1, "rgba(240,180,110,0)");
	ctx.fillStyle = haze;
	ctx.fillRect(at.x - w, at.y - w, w * 2, w * 1.2);
	ctx.fillStyle = "#0f1230";
	ctx.beginPath();
	ctx.moveTo(left - 2 * u, at.y + 0.2 * u);
	ctx.quadraticCurveTo(at.x, at.y - 0.9 * u, left + w + 2 * u, at.y + 0.2 * u);
	ctx.fill();
	const wallTop = at.y - 1.3 * u;
	ctx.fillStyle = "#121535";
	ctx.fillRect(left, wallTop, w, 1.3 * u);
	const towers = [0.04, 0.27, 0.55, 0.8, 0.96];
	for (const [i, t] of towers.entries()) {
		const tw = 0.7 * u;
		const th = (1.9 + (i % 2) * 0.5) * u;
		ctx.fillRect(left + t * w - tw / 2, at.y - th, tw, th);
	}
	// Roofs within the walls.
	ctx.fillStyle = "#171b40";
	for (let i = 0; i < 7; i++) {
		const x = left + (0.1 + i * 0.12) * w;
		ctx.fillRect(x, wallTop - (0.4 + hash(i) * 0.6) * u, (0.6 + hash(i + 9) * 0.5) * u, (0.6 + hash(i) * 0.6) * u);
	}
	ctx.strokeStyle = "rgba(180,190,240,.22)";
	ctx.lineWidth = 1;
	ctx.strokeRect(left, wallTop, w, 1.3 * u);
	for (let i = 0; i < 14; i++) {
		const x = left + (0.05 + 0.9 * hash(i * 3.3)) * w;
		const y = wallTop - (hash(i * 7.1) * 0.7 - 0.5) * u;
		const r = Math.max(3, 0.5 * u) * (0.7 + 0.5 * hash(i));
		const flicker = frame.reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(frame.now * (2 + hash(i) * 3) + i);
		ctx.globalAlpha = 0.85 * flicker;
		ctx.drawImage(art.lamp, x - r, y - r, r * 2, r * 2);
	}
	ctx.globalAlpha = 1;
}

/** Bethlehem at the end of the way: the house the star stands over, its light at the door. */
function drawBethlehem(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const { state } = frame;
	const progress = legProgress(state);
	const show = smooth(0.5, 0.62, progress);
	if (show <= 0) return;
	// The town lies where the star is going, under it.
	const distance = STAR_LENGTH + 14 - state.s;
	const lat = state.lat + distance * Math.tan(state.bearing);
	const at = ground(view, state, STAR_LENGTH + 14, lat);
	if (at.f < 1) return;
	const u = at.scale;
	const art = sprites!;
	ctx.globalAlpha = show;
	// A low rise with the town's houses on it.
	ctx.fillStyle = "#171b3d";
	ctx.beginPath();
	ctx.moveTo(at.x - 9 * u, at.y + 0.3 * u);
	ctx.quadraticCurveTo(at.x, at.y - 1.6 * u, at.x + 9 * u, at.y + 0.3 * u);
	ctx.fill();
	const houses = [
		[-5.2, 0.9, 1.6],
		[-3.4, 1.2, 1.3],
		[3.1, 1.1, 1.5],
		[4.8, 0.8, 1.2],
		[-1.9, 1.0, 1.0],
	];
	for (const [i, [dx, h, w]] of houses.entries()) {
		const x = at.x + dx * u;
		const top = at.y - (h + 0.6 - Math.abs(dx) * 0.08) * u;
		const hw = (w * u) / 2;
		const wall = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
		wall.addColorStop(0, "#2a2a52");
		wall.addColorStop(0.5, "#1b1c3c");
		wall.addColorStop(1, "#121330");
		ctx.fillStyle = wall;
		ctx.fillRect(x - hw, top, hw * 2, at.y - top);
		// A flat roof with its low parapet, pale where the moon finds it.
		ctx.fillStyle = "#101129";
		ctx.fillRect(x - hw - 0.05 * u, top - 0.1 * u, hw * 2 + 0.1 * u, 0.12 * u);
		ctx.fillStyle = "rgba(196,200,244,.28)";
		ctx.fillRect(x - hw - 0.05 * u, top - 0.1 * u, hw * 2 + 0.1 * u, Math.max(1, 0.03 * u));
		if (i % 2 === 0) {
			const wy = top + (at.y - top) * 0.38;
			ctx.fillStyle = "rgba(255,206,130,.85)";
			ctx.fillRect(x - 0.12 * u, wy, 0.22 * u, 0.2 * u);
			const r = Math.max(3, 0.45 * u);
			ctx.globalAlpha = show * 0.55;
			ctx.drawImage(art.lamp, x - r, wy + 0.1 * u - r, r * 2, r * 2);
			ctx.globalAlpha = show;
		}
	}
	// The house: flat-roofed, a lit doorway and window, a stair up the side.
	const hw = 2.4 * u;
	const hh = 1.7 * u;
	const left = at.x - hw / 2;
	const top = at.y - hh - 0.4 * u;
	const house = ctx.createLinearGradient(left, top, left + hw, at.y);
	house.addColorStop(0, "#2b2f58");
	house.addColorStop(1, "#14183a");
	ctx.fillStyle = house;
	ctx.fillRect(left, top, hw, at.y - top);
	ctx.fillStyle = "#0e1130";
	ctx.fillRect(left - 0.1 * u, top - 0.12 * u, hw + 0.2 * u, 0.16 * u);
	ctx.beginPath();
	ctx.moveTo(left + hw, at.y);
	ctx.lineTo(left + hw + 0.9 * u, at.y);
	ctx.lineTo(left + hw, top + 0.2 * u);
	ctx.closePath();
	ctx.fill();
	const arrival = frame.arrival ?? 0;
	const warmth = 0.75 + 0.25 * smooth(0, 2, arrival);
	const door = { x: at.x - 0.35 * u, y: at.y - 0.95 * u, w: 0.6 * u, h: 0.95 * u };
	const doorLight = ctx.createLinearGradient(0, door.y, 0, door.y + door.h);
	doorLight.addColorStop(0, `rgba(255,214,140,${0.95 * warmth})`);
	doorLight.addColorStop(1, `rgba(240,170,90,${0.85 * warmth})`);
	ctx.fillStyle = doorLight;
	ctx.fillRect(door.x, door.y, door.w, door.h);
	ctx.fillRect(at.x + 0.55 * u, top + 0.45 * u, 0.4 * u, 0.32 * u);
	const spill = Math.max(10, 2.6 * u) * warmth;
	ctx.globalAlpha = show * 0.8 * warmth;
	ctx.drawImage(art.lamp, door.x + door.w / 2 - spill, door.y + door.h * 0.4 - spill, spill * 2, spill * 2);
	ctx.globalAlpha = 1;
}

/** "Till it came and stood over where the young child was": a soft light from the star down to the house. */
function drawBeam(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const { state } = frame;
	const strength = smooth(0.9, 1, legProgress(state)) * (frame.arrival === null ? 0.6 : 0.6 + 0.4 * smooth(0, 2, frame.arrival)) * starVisible(frame);
	if (strength <= 0.01) return;
	const star = starSky(frame, view);
	const distance = STAR_LENGTH + 14 - state.s;
	const at = ground(view, state, STAR_LENGTH + 14, state.lat + distance * Math.tan(state.bearing));
	const roof = at.y - 2.2 * at.scale;
	const top = star.y + 6;
	const spread = Math.max(14, 1.8 * at.scale);
	const beam = ctx.createLinearGradient(0, top, 0, roof);
	beam.addColorStop(0, `rgba(255,236,190,${0.22 * strength})`);
	beam.addColorStop(1, `rgba(255,220,150,${0.06 * strength})`);
	ctx.fillStyle = beam;
	ctx.beginPath();
	ctx.moveTo(star.x - 2, top);
	ctx.lineTo(star.x + 2, top);
	ctx.lineTo(at.x + spread, roof);
	ctx.lineTo(at.x - spread, roof);
	ctx.closePath();
	ctx.fill();
}

// ---------------------------------------------------------------------------
// The company, seen from behind as it travels away: people on foot and laden beasts.

interface Traveller {
	kind: "walker" | "beast";
	lat: number;
	ahead: number;
	robe: string;
	staff?: boolean;
	step: number;
}

const COMPANY: Traveller[] = [
	{ kind: "walker", lat: 0.15, ahead: 3.6, robe: "#2b3a2c", step: 0.3 },
	{ kind: "beast", lat: -0.55, ahead: 2.8, robe: "#5a3426", step: 1.9 },
	{ kind: "walker", lat: 0.7, ahead: 2.3, robe: "#4a3b24", staff: true, step: 2.6 },
	{ kind: "walker", lat: -0.05, ahead: 1.4, robe: "#24384a", step: 0.9 },
	{ kind: "beast", lat: 0.6, ahead: 0.6, robe: "#3b2a4a", step: 3.4 },
	{ kind: "walker", lat: -0.65, ahead: 0, robe: "#4a2a36", staff: true, step: 1.2 },
];

function drawTraveller(ctx: CanvasRenderingContext2D, traveller: Traveller, x: number, y: number, u: number, walk: number, rim: string) {
	const swing = Math.sin(walk + traveller.step);
	const bob = Math.abs(Math.cos(walk + traveller.step)) * 0.025 * u;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	// A long shadow away from the moon.
	ctx.fillStyle = "rgba(6,6,16,.5)";
	ctx.beginPath();
	ctx.ellipse(x + 0.45 * u, y + 0.03 * u, (traveller.kind === "beast" ? 0.75 : 0.42) * u, 0.08 * u, -0.08, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = rim;
	ctx.lineWidth = Math.max(0.8, 0.03 * u);
	if (traveller.kind === "walker") {
		const top = y - 1.0 * u - bob;
		// Feet, stepping under the hem.
		ctx.fillStyle = "#07070f";
		ctx.fillRect(x - 0.12 * u + swing * 0.04 * u, y - 0.05 * u, 0.09 * u, 0.06 * u);
		ctx.fillRect(x + 0.03 * u - swing * 0.04 * u, y - 0.05 * u, 0.09 * u, 0.06 * u);
		// The robe, flaring to the hem, a mantle over the shoulders.
		ctx.beginPath();
		ctx.moveTo(x - 0.12 * u, top + 0.2 * u);
		ctx.quadraticCurveTo(x - 0.17 * u, top + 0.45 * u, x - 0.22 * u + swing * 0.02 * u, y - 0.03 * u);
		ctx.lineTo(x + 0.22 * u - swing * 0.02 * u, y - 0.03 * u);
		ctx.quadraticCurveTo(x + 0.17 * u, top + 0.45 * u, x + 0.12 * u, top + 0.2 * u);
		ctx.closePath();
		const robe = ctx.createLinearGradient(0, top, 0, y);
		robe.addColorStop(0, traveller.robe);
		robe.addColorStop(1, "#0b0a16");
		ctx.fillStyle = robe;
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "rgba(10,9,20,.55)";
		ctx.beginPath();
		ctx.moveTo(x - 0.14 * u, top + 0.2 * u);
		ctx.quadraticCurveTo(x, top + 0.62 * u, x + 0.14 * u, top + 0.2 * u);
		ctx.closePath();
		ctx.fill();
		// The head covered, its cloth falling to the shoulders.
		ctx.beginPath();
		ctx.moveTo(x - 0.11 * u, top + 0.27 * u);
		ctx.quadraticCurveTo(x - 0.12 * u, top + 0.02 * u, x, top - 0.01 * u);
		ctx.quadraticCurveTo(x + 0.12 * u, top + 0.02 * u, x + 0.11 * u, top + 0.27 * u);
		ctx.closePath();
		ctx.fillStyle = "#1a1828";
		ctx.fill();
		ctx.stroke();
		if (traveller.staff) {
			ctx.strokeStyle = "#0b0a12";
			ctx.lineWidth = Math.max(1, 0.035 * u);
			ctx.beginPath();
			ctx.moveTo(x + 0.25 * u, top + 0.05 * u);
			ctx.lineTo(x + 0.3 * u, y);
			ctx.stroke();
		}
		ctx.lineCap = "butt";
		return;
	}
	// A pack animal from behind: long legs, a narrow laden body, the hump, and its neck carried out ahead.
	const back = y - 1.12 * u - bob;
	ctx.strokeStyle = "#08080f";
	ctx.lineWidth = Math.max(1.2, 0.075 * u);
	ctx.beginPath();
	for (const [dx, phase, top] of [
		[-0.1, Math.PI, 0.15],
		[0.1, 0, 0.15],
		[-0.16, 0, 0.3],
		[0.16, Math.PI, 0.3],
	] as const) {
		const s = Math.sin(walk * 0.8 + traveller.step + phase) * 0.05 * u;
		ctx.moveTo(x + dx * u, back + top * u);
		ctx.lineTo(x + dx * 0.8 * u + s, y - 0.02 * u);
	}
	ctx.stroke();
	ctx.strokeStyle = rim;
	ctx.lineWidth = Math.max(0.8, 0.03 * u);
	// The neck rises ahead of the hump and carries the head out in front.
	ctx.fillStyle = "#15142a";
	ctx.beginPath();
	ctx.moveTo(x - 0.07 * u, back - 0.18 * u);
	ctx.quadraticCurveTo(x - 0.06 * u, back - 0.44 * u, x - 0.01 * u, back - 0.5 * u);
	ctx.lineTo(x + 0.06 * u, back - 0.5 * u);
	ctx.quadraticCurveTo(x + 0.09 * u, back - 0.4 * u, x + 0.08 * u, back - 0.18 * u);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	ctx.beginPath();
	ctx.ellipse(x + 0.025 * u, back - 0.53 * u, 0.075 * u, 0.06 * u, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
	// The body seen end on, and the hump over it.
	ctx.beginPath();
	ctx.moveTo(x - 0.2 * u, back + 0.32 * u);
	ctx.quadraticCurveTo(x - 0.25 * u, back - 0.05 * u, x - 0.12 * u, back - 0.2 * u);
	ctx.quadraticCurveTo(x, back - 0.42 * u, x + 0.12 * u, back - 0.2 * u);
	ctx.quadraticCurveTo(x + 0.25 * u, back - 0.05 * u, x + 0.2 * u, back + 0.32 * u);
	ctx.quadraticCurveTo(x, back + 0.42 * u, x - 0.2 * u, back + 0.32 * u);
	ctx.closePath();
	ctx.fillStyle = "#17162c";
	ctx.fill();
	ctx.stroke();
	// A striped saddle cloth, and a load slung low on either side.
	ctx.fillStyle = traveller.robe;
	ctx.beginPath();
	ctx.moveTo(x - 0.17 * u, back - 0.12 * u);
	ctx.quadraticCurveTo(x, back - 0.3 * u, x + 0.17 * u, back - 0.12 * u);
	ctx.lineTo(x + 0.21 * u, back + 0.04 * u);
	ctx.quadraticCurveTo(x, back - 0.1 * u, x - 0.21 * u, back + 0.04 * u);
	ctx.closePath();
	ctx.fill();
	for (const side of [-1, 1]) {
		const px = x + side * 0.24 * u;
		ctx.fillStyle = "#2a2234";
		ctx.beginPath();
		ctx.moveTo(px - 0.08 * u, back - 0.02 * u);
		ctx.lineTo(px + 0.08 * u, back - 0.02 * u);
		ctx.lineTo(px + 0.09 * u, back + 0.3 * u);
		ctx.quadraticCurveTo(px, back + 0.36 * u, px - 0.09 * u, back + 0.3 * u);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "rgba(229,182,100,.4)";
		ctx.fillRect(px - 0.085 * u, back + 0.12 * u, 0.17 * u, 0.025 * u);
	}
	// The tail.
	ctx.strokeStyle = "#08080f";
	ctx.lineWidth = Math.max(1, 0.03 * u);
	ctx.beginPath();
	ctx.moveTo(x, back + 0.36 * u);
	ctx.lineTo(x + Math.sin(walk * 0.5) * 0.02 * u, back + 0.6 * u);
	ctx.stroke();
	ctx.lineCap = "butt";
}

function drawCompany(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const { state } = frame;
	const walk = frame.reduceMotion ? state.travel * 1.1 : state.travel * 2.2;
	const lit = starVisible(frame);
	// Lit from ahead: gold from the star, cool from the moon before it rises.
	const rim = lit > 0.3 ? `rgba(244,206,140,${0.12 + 0.16 * lit})` : "rgba(170,180,236,.16)";
	const cos = Math.cos(state.heading);
	const sin = Math.sin(state.heading);
	for (const traveller of COMPANY) {
		// Each walks a place in the line, turned with the company's heading.
		const f = view.companyDist + traveller.ahead * cos - traveller.lat * sin * 0.2;
		const r = traveller.lat + traveller.ahead * sin * 0.15;
		const x = view.cx + Math.atan2(r, f) * view.perRad;
		const y = view.horizon + Math.atan2(CAM_H, f) * view.perRad;
		const u = Math.min(view.perRad / f, view.height * 0.16);
		drawTraveller(ctx, traveller, x, y, u, walk, rim);
	}
}

/** When the star is in sight but out of the view, a soft mark at the edge shows which way to turn. */
function drawEdgeMark(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const { state } = frame;
	if (state.phase !== "star" || starVisible(frame) < 0.5) return;
	const rel = wrapAngle(view.axis + state.bearing - view.look);
	if (Math.abs(rel) < FOV_HALF - 0.05) return;
	const side = rel > 0 ? 1 : -1;
	const { y } = starSky(frame, view);
	const x = side > 0 ? view.width - 22 : 22;
	const pulse = frame.reduceMotion ? 0.85 : 0.65 + 0.35 * Math.sin(frame.now * 3);
	ctx.globalAlpha = pulse;
	ctx.drawImage(sprites!.lamp, x - 26, y - 26, 52, 52);
	ctx.strokeStyle = "#ffe9bd";
	ctx.lineWidth = 3;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(x - side * 6, y - 10);
	ctx.lineTo(x + side * 4, y);
	ctx.lineTo(x - side * 6, y + 10);
	ctx.stroke();
	ctx.lineCap = "butt";
	ctx.globalAlpha = 1;
}

function drawNight(ctx: CanvasRenderingContext2D, frame: StarSceneFrame, view: View) {
	const { width, height } = view;
	// The edges of the view always a little darker.
	const vignette = ctx.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * 0.35, width / 2, height * 0.5, Math.max(width, height) * 0.8);
	vignette.addColorStop(0, "rgba(2,3,10,0)");
	vignette.addColorStop(1, "rgba(2,3,10,.55)");
	ctx.fillStyle = vignette;
	ctx.fillRect(0, 0, width, height);
	// The night closes in while the star is out of sight, and over the lost company.
	const closing = frame.lost !== null ? 0.45 + 0.4 * smooth(0, 1.6, frame.lost) : 0.5 * smooth(0, 1, frame.state.lostFor / STAR_LOST_LIMIT);
	if (closing > 0.01) {
		ctx.fillStyle = `rgba(2,3,10,${closing})`;
		ctx.fillRect(0, 0, width, height);
	}
	// At the house, a warmth over everything.
	if (frame.arrival !== null) {
		ctx.fillStyle = `rgba(255,200,130,${0.06 * smooth(0, 2.5, frame.arrival)})`;
		ctx.fillRect(0, 0, width, height);
	}
}

export function drawStarScene(ctx: CanvasRenderingContext2D, frame: StarSceneFrame) {
	if (!sprites) sprites = buildSprites();
	const view = viewFor(frame);
	const { state } = frame;
	const dim = frame.lost !== null ? 1 - 0.5 * smooth(0, 1.6, frame.lost) : 1;

	drawSky(ctx, frame, view, dim);
	drawTheStar(ctx, frame, view);
	drawClouds(ctx, frame, view);
	drawHills(ctx, view);
	drawGroundBase(ctx, view);

	// The way ahead, far to near: dunes, the city or the town, ravines and rises.
	const items: { f: number; draw: () => void }[] = [];
	const offset = state.travel % DUNE_SPACING;
	const firstRow = Math.floor(state.travel / DUNE_SPACING);
	for (let k = 1; k <= DUNE_ROWS; k++) {
		const f = k * DUNE_SPACING - offset + 1.2;
		const row = firstRow + k;
		items.push({ f, draw: () => drawDuneRow(ctx, frame, view, f, row) });
	}
	for (const obstacle of state.obstacles) {
		const f = ground(view, state, obstacle.s, obstacle.lat).f;
		items.push({ f, draw: () => drawObstacle(ctx, frame, view, obstacle) });
	}
	if (state.phase === "east" || state.phase === "jerusalem") {
		items.push({ f: ground(view, state, EAST_LENGTH + 7, 0).f, draw: () => drawJerusalem(ctx, frame, view) });
	} else {
		const distance = STAR_LENGTH + 14 - state.s;
		const f = ground(view, state, STAR_LENGTH + 14, state.lat + distance * Math.tan(state.bearing)).f;
		items.push({
			f,
			draw: () => {
				drawBeam(ctx, frame, view);
				drawBethlehem(ctx, frame, view);
			},
		});
	}
	items.sort((a, b) => b.f - a.f);
	for (const item of items) item.draw();

	drawCompany(ctx, frame, view);
	drawEdgeMark(ctx, frame, view);
	drawNight(ctx, frame, view);
}
