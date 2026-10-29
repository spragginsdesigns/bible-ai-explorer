import { SINK_SHOWS_BELOW, WALK_GOAL, WALK_JUMP_AIR, type WalkState } from "@/lib/beta/games/water-walk-rules";

/**
 * Draws Peter's Water Walk (LC-17850) on a 2D canvas: the night sea in the
 * fourth watch, the ship behind, Jesus ahead in his own light, the swells,
 * the rain and the wind. Pure drawing: everything it shows comes from the
 * simulation's state and the frame's clock, and nothing here changes either.
 */

export interface SceneFrame {
	width: number;
	height: number;
	state: WalkState;
	/** Seconds on the page's clock, for the sea and the rain. */
	now: number;
	/** 1 is the full storm; it falls to 0 once the wind ceases. */
	storm: number;
	/** Lightning, 0-1, already faded by the caller. */
	flash: number;
	/** Seconds since the rescue began, or null. */
	rescue: number | null;
	/** Seconds since he reached Jesus, or null. */
	arrival: number | null;
}

/** Cubits across the view. */
const VIEW_CUBITS = 34;
const SHIP_X = -4;
const JESUS_X = WALK_GOAL + 1.4;

const CLOUDS = Array.from({ length: 9 }, (_, i) => ({
	x: (i * 0.137 + ((i * 7919) % 13) / 13) % 1,
	y: 0.04 + ((i * 31) % 7) * 0.035,
	w: 0.28 + ((i * 17) % 5) * 0.07,
	h: 0.07 + ((i * 13) % 4) * 0.02,
}));

const DROPS = Array.from({ length: 150 }, (_, i) => ({
	x: ((i * 0.6180339887) % 1),
	y: ((i * 0.7548776662) % 1),
	speed: 0.9 + ((i * 37) % 10) / 20,
	length: 0.6 + ((i * 53) % 10) / 15,
}));

function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

function ease(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

interface View {
	unit: number;
	camera: number;
	waterline: number;
	crest: number;
	toScreen: (x: number) => number;
}

function viewFor(frame: SceneFrame): View {
	const { width, height, state } = frame;
	const unit = width / VIEW_CUBITS;
	// Peter a third of the way in; the ship stays in sight at the start, Jesus at the end.
	const camera = clamp(state.x - VIEW_CUBITS * 0.36, SHIP_X - 6, JESUS_X + 6 - VIEW_CUBITS);
	return {
		unit,
		camera,
		waterline: height * 0.72,
		crest: height * 0.1,
		toScreen: (x) => (x - camera) * unit,
	};
}

/** The height of the sea's surface under world position x, in screen pixels. */
function surfaceAt(frame: SceneFrame, view: View, x: number): number {
	const chop = Math.sin(x * 0.9 + frame.now * 2.1) * 0.5 + Math.sin(x * 0.37 - frame.now * 1.3) * 0.5;
	let y = view.waterline - chop * frame.height * 0.012 * (0.35 + frame.storm);
	for (const swell of frame.state.swells) {
		const d = (x - swell.x) / 2.3;
		y -= view.crest * Math.exp(-d * d) * (0.3 + 0.7 * frame.storm);
	}
	return y;
}

function drawSky(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
	const { width, height, storm } = frame;
	const sky = ctx.createLinearGradient(0, 0, 0, height * 0.6);
	// Storm black, lifting toward the dawn's blue as the wind ceases.
	const calm = 1 - storm;
	sky.addColorStop(0, `rgb(${5 + 18 * calm}, ${8 + 22 * calm}, ${15 + 40 * calm})`);
	sky.addColorStop(1, `rgb(${20 + 40 * calm}, ${28 + 45 * calm}, ${44 + 60 * calm})`);
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, width, height);

	// The clouds drift with the wind and thin out once it ceases.
	ctx.fillStyle = `rgba(4, 6, 11, ${0.35 + 0.45 * storm})`;
	for (const cloud of CLOUDS) {
		const drift = (cloud.x + frame.now * 0.006 * (1 + 2 * storm) - frame.state.x * 0.0015) % 1;
		const cx = (drift < 0 ? drift + 1 : drift) * (width * 1.4) - width * 0.2;
		ctx.beginPath();
		ctx.ellipse(cx, height * cloud.y, width * cloud.w * 0.5, height * cloud.h, 0, 0, Math.PI * 2);
		ctx.fill();
	}

	// The hills of Galilee on the far shore.
	ctx.fillStyle = "#0a1018";
	ctx.beginPath();
	ctx.moveTo(0, height * 0.52);
	for (let i = 0; i <= 12; i++) {
		const x = (i / 12) * width;
		const y = height * (0.47 + 0.035 * Math.sin(i * 1.7 + frame.state.x * 0.01) + 0.02 * Math.sin(i * 0.6));
		ctx.lineTo(x, y);
	}
	ctx.lineTo(width, height * 0.56);
	ctx.lineTo(0, height * 0.56);
	ctx.closePath();
	ctx.fill();
}

function drawJesusLight(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: View) {
	const { width, height, state } = frame;
	const x = view.toScreen(jesusX(frame));
	// Even off the edge of the view, his light shows where to look.
	const cx = clamp(x, -width * 0.1, width * 1.08);
	const cy = view.waterline - height * 0.16;
	const strength = 0.32 + 0.38 * (state.faith / 100) + 0.3 * (1 - frame.storm);
	const radius = height * (0.42 + 0.12 * (1 - frame.storm));
	const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
	glow.addColorStop(0, `rgba(255, 236, 190, ${0.55 * strength})`);
	glow.addColorStop(0.35, `rgba(229, 182, 100, ${0.22 * strength})`);
	glow.addColorStop(1, "rgba(229, 182, 100, 0)");
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, width, height);
}

function drawSea(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: View, layer: "back" | "front") {
	const { width, height, now, storm } = frame;
	const bands =
		layer === "back"
			? [
					{ y: 0.56, amp: 0.012, freq: 0.012, speed: 0.4, parallax: 0.25, color: "#0b1a2a" },
					{ y: 0.61, amp: 0.018, freq: 0.016, speed: 0.6, parallax: 0.5, color: "#0e2236" },
					{ y: 0.66, amp: 0.022, freq: 0.02, speed: 0.9, parallax: 0.75, color: "#123049" },
				]
			: [{ y: 0.86, amp: 0.03, freq: 0.024, speed: 1.4, parallax: 1.35, color: "rgba(16, 52, 76, 0.92)" }];
	for (const band of bands) {
		ctx.fillStyle = band.color;
		ctx.beginPath();
		ctx.moveTo(0, height);
		for (let px = 0; px <= width + 8; px += 8) {
			const wx = px + view.camera * view.unit * band.parallax;
			const y =
				height * band.y -
				Math.sin(wx * band.freq + now * band.speed) * height * band.amp * (0.4 + storm) -
				Math.sin(wx * band.freq * 2.3 - now * band.speed * 1.4) * height * band.amp * 0.4 * storm;
			ctx.lineTo(px, y);
		}
		ctx.lineTo(width, height);
		ctx.closePath();
		ctx.fill();
	}
}

/** The water Peter walks on, with its swells and their foam. */
function drawWalkway(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: View) {
	const { width, height } = frame;
	const body = ctx.createLinearGradient(0, view.waterline - view.crest, 0, height);
	body.addColorStop(0, "#22597f");
	body.addColorStop(1, "#08182a");
	ctx.fillStyle = body;
	ctx.beginPath();
	ctx.moveTo(0, height);
	for (let px = 0; px <= width + 6; px += 6) ctx.lineTo(px, surfaceAt(frame, view, view.camera + px / view.unit));
	ctx.lineTo(width, height);
	ctx.closePath();
	ctx.fill();

	// Foam riding each crest.
	ctx.strokeStyle = "rgba(214, 233, 245, 0.75)";
	ctx.lineWidth = Math.max(2, height * 0.006);
	ctx.lineCap = "round";
	for (const swell of frame.state.swells) {
		const sx = view.toScreen(swell.x);
		if (sx < -40 || sx > width + 40) continue;
		ctx.beginPath();
		for (let dx = -1.6; dx <= 1.6; dx += 0.2) ctx.lineTo(view.toScreen(swell.x + dx), surfaceAt(frame, view, swell.x + dx) - 1);
		ctx.stroke();
	}
}

function drawShip(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: View) {
	const { height, now, storm } = frame;
	const x = view.toScreen(SHIP_X);
	if (x < -height * 0.5 || x > frame.width + height * 0.5) return;
	const y = surfaceAt(frame, view, SHIP_X) + height * 0.01;
	const size = height * 0.24;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(Math.sin(now * 1.1) * 0.08 * (0.3 + storm));
	// Hull.
	ctx.fillStyle = "#3a2616";
	ctx.beginPath();
	ctx.moveTo(-size * 0.7, -size * 0.18);
	ctx.lineTo(size * 0.7, -size * 0.2);
	ctx.quadraticCurveTo(size * 0.55, size * 0.12, size * 0.3, size * 0.14);
	ctx.lineTo(-size * 0.35, size * 0.14);
	ctx.quadraticCurveTo(-size * 0.6, size * 0.1, -size * 0.7, -size * 0.18);
	ctx.fill();
	ctx.fillStyle = "#5a3d24";
	ctx.fillRect(-size * 0.66, -size * 0.22, size * 1.34, size * 0.05);
	// Mast and the furled sail.
	ctx.fillStyle = "#2a1c10";
	ctx.fillRect(-size * 0.03, -size * 1.05, size * 0.05, size * 0.86);
	ctx.fillStyle = "#c9b993";
	ctx.fillRect(-size * 0.32, -size * 0.98, size * 0.64, size * 0.06);
	// The disciples, watching.
	ctx.fillStyle = "#1a1410";
	for (const [dx, h] of [
		[-0.45, 0.2],
		[-0.25, 0.23],
		[0.22, 0.21],
		[0.42, 0.19],
	]) {
		ctx.beginPath();
		ctx.arc(size * dx, -size * (0.22 + h), size * 0.055, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillRect(size * (dx - 0.06), -size * (0.22 + h - 0.04), size * 0.12, size * (h - 0.02));
	}
	ctx.restore();
}

/** A robed figure standing at (x, y) on its feet, `size` tall, drawn upright then tilted. */
function drawFigure(
	ctx: CanvasRenderingContext2D,
	options: { x: number; y: number; size: number; tilt: number; robe: string; sash: string; hair: string; walk: number; arms: number; reach?: number; facing?: 1 | -1 },
) {
	const { x, y, size: s, tilt, robe, sash, hair, walk, arms, reach = 0, facing = 1 } = options;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(tilt);
	ctx.scale(facing, 1);
	ctx.lineCap = "round";
	// Legs under the robe's hem.
	ctx.strokeStyle = "#6b4a33";
	ctx.lineWidth = s * 0.06;
	const stride = Math.sin(walk) * s * 0.08;
	ctx.beginPath();
	ctx.moveTo(-s * 0.05, -s * 0.2);
	ctx.lineTo(-s * 0.05 + stride, 0);
	ctx.moveTo(s * 0.05, -s * 0.2);
	ctx.lineTo(s * 0.05 - stride, 0);
	ctx.stroke();
	// Robe.
	ctx.fillStyle = robe;
	ctx.beginPath();
	ctx.moveTo(-s * 0.12, -s * 0.74);
	ctx.lineTo(s * 0.12, -s * 0.74);
	ctx.lineTo(s * 0.2, -s * 0.16);
	ctx.lineTo(-s * 0.2, -s * 0.16);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = sash;
	ctx.fillRect(-s * 0.15, -s * 0.5, s * 0.3, s * 0.05);
	// Arms: out for balance (arms 0-1), one reaching forward when `reach` is set.
	ctx.strokeStyle = robe;
	ctx.lineWidth = s * 0.07;
	const spread = 0.35 + 0.9 * arms;
	ctx.beginPath();
	ctx.moveTo(-s * 0.1, -s * 0.68);
	ctx.lineTo(-s * 0.1 - Math.cos(spread) * s * 0.3, -s * 0.68 + Math.sin(spread) * s * 0.3 * (arms > 0.5 ? -0.4 : 1));
	ctx.moveTo(s * 0.1, -s * 0.68);
	if (reach) ctx.lineTo(s * 0.1 + s * 0.34 * reach, -s * 0.66 - s * 0.05 * reach);
	else ctx.lineTo(s * 0.1 + Math.cos(spread) * s * 0.3, -s * 0.68 + Math.sin(spread) * s * 0.3 * (arms > 0.5 ? -0.4 : 1));
	ctx.stroke();
	// Head, hair and beard.
	ctx.fillStyle = "#b9875f";
	ctx.beginPath();
	ctx.arc(0, -s * 0.84, s * 0.085, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = hair;
	ctx.beginPath();
	ctx.arc(0, -s * 0.87, s * 0.09, Math.PI, Math.PI * 2);
	ctx.fill();
	// The beard, along the jaw below the mouth.
	ctx.beginPath();
	ctx.moveTo(-s * 0.08, -s * 0.81);
	ctx.quadraticCurveTo(-s * 0.06, -s * 0.72, 0, -s * 0.715);
	ctx.quadraticCurveTo(s * 0.06, -s * 0.72, s * 0.08, -s * 0.81);
	ctx.quadraticCurveTo(0, -s * 0.775, -s * 0.08, -s * 0.81);
	ctx.fill();
	ctx.restore();
}

function jesusX(frame: SceneFrame): number {
	const { state, rescue } = frame;
	// "Immediately Jesus stretched forth his hand": on a rescue he comes to Peter.
	if (rescue !== null) return JESUS_X + (state.x + 1.6 - JESUS_X) * ease(rescue / 0.7);
	return JESUS_X;
}

function drawJesus(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: View) {
	const x = jesusX(frame);
	const sx = view.toScreen(x);
	if (sx < -80 || sx > frame.width + 80) return;
	const near = frame.rescue !== null || frame.arrival !== null || frame.state.x > WALK_GOAL - 14;
	drawFigure(ctx, {
		x: sx,
		y: surfaceAt(frame, view, x),
		size: frame.height * 0.24,
		tilt: 0,
		robe: "#efe9dc",
		sash: "#b5893e",
		hair: "#3b2a1c",
		walk: 0,
		arms: 0.1,
		// He faces Peter, who comes from his left, and reaches for him.
		reach: near ? 1 : 0,
		facing: -1,
	});
}

function peterPose(frame: SceneFrame, view: View) {
	const { state, height, rescue, arrival } = frame;
	let x = state.x;
	let sink = 0;
	if (state.phase === "sinking") sink = state.sink;
	else if (rescue !== null) sink = state.sink * (1 - ease((rescue - 0.6) / 0.8));
	else if (state.phase === "walking") sink = Math.max(0, (SINK_SHOWS_BELOW - state.faith) / SINK_SHOWS_BELOW) * 0.32;
	if (arrival !== null) x = Math.min(state.x, JESUS_X - 1.6);
	const air = state.phase === "walking" && state.air > 0 ? 1 - state.air / WALK_JUMP_AIR : 0;
	const lift = Math.sin(Math.PI * air) * height * 0.14;
	const flat = view.waterline - lift;
	const y = Math.min(surfaceAt(frame, view, x), air > 0 ? flat : Infinity);
	return { x, sx: view.toScreen(x), y: y + sink * height * 0.2, sink };
}

function drawPeter(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: View) {
	const { state, height, rescue, arrival } = frame;
	const pose = peterPose(frame, view);
	const settled = rescue !== null || arrival !== null;
	drawFigure(ctx, {
		x: pose.sx,
		y: pose.y,
		size: height * 0.22,
		// Sinking, he reaches up out of the water rather than lying down in it.
		tilt: settled ? 0 : state.tilt * (state.phase === "sinking" ? 0.2 : 0.55),
		robe: "#7a5a2c",
		sash: "#3d5a73",
		hair: "#2a1d14",
		walk: state.x * 1.9,
		// Arms fly out as he loses balance, and up as he sinks.
		arms: settled ? 0.2 : state.phase === "sinking" ? 1 : clamp(Math.abs(state.tilt) * 1.3, 0.15, 1),
		reach: settled ? 1 : 0,
	});
	// The sea closing over him as he sinks.
	if (pose.sink > 0.02) {
		ctx.fillStyle = "rgba(20, 60, 88, 0.88)";
		ctx.beginPath();
		const w = height * 0.11;
		const top = surfaceAt(frame, view, pose.x);
		ctx.ellipse(pose.sx, top + 2, w, height * 0.018, 0, 0, Math.PI * 2);
		ctx.fill();
	}
}

function drawRain(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
	const { width, height, now, storm, state } = frame;
	if (storm < 0.05) return;
	const slant = clamp(state.wind / 4, -1.2, 1.2);
	const count = Math.round(DROPS.length * Math.min(1, storm));
	ctx.strokeStyle = `rgba(190, 210, 230, ${0.28 * storm + 0.06})`;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let i = 0; i < count; i++) {
		const drop = DROPS[i];
		const fall = (drop.y + now * drop.speed * 0.9) % 1;
		const x = ((drop.x + now * slant * 0.25 + fall * slant * 0.3) % 1 + 1) % 1;
		const px = x * width;
		const py = fall * height;
		const len = height * 0.035 * drop.length;
		ctx.moveTo(px, py);
		ctx.lineTo(px + slant * len * 0.6, py + len);
	}
	ctx.stroke();
}

/** Streaks across the view show which way the wind is pushing and how hard. */
function drawWind(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
	const { width, height, now, state } = frame;
	const force = Math.abs(state.wind);
	if (force < 0.6 || state.phase !== "walking") return;
	const dir = Math.sign(state.wind);
	ctx.strokeStyle = `rgba(225, 235, 245, ${clamp((force - 0.6) / 3, 0.05, 0.4)})`;
	ctx.lineWidth = Math.max(1.5, height * 0.004);
	ctx.lineCap = "round";
	ctx.beginPath();
	for (let i = 0; i < 9; i++) {
		const lane = 0.18 + i * 0.07;
		const t = (now * (0.7 + 0.25 * force) + i * 0.37) % 1;
		const x = dir > 0 ? t * width * 1.3 - width * 0.15 : width * 1.15 - t * width * 1.3;
		const len = width * (0.06 + 0.02 * force);
		ctx.moveTo(x, height * lane);
		ctx.lineTo(x - dir * len, height * lane + Math.sin(i + now) * 2);
	}
	ctx.stroke();
}

export function drawWalkScene(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
	const view = viewFor(frame);
	ctx.clearRect(0, 0, frame.width, frame.height);
	drawSky(ctx, frame);
	drawJesusLight(ctx, frame, view);
	drawSea(ctx, frame, view, "back");
	drawShip(ctx, frame, view);
	drawWalkway(ctx, frame, view);
	drawJesus(ctx, frame, view);
	drawPeter(ctx, frame, view);
	drawSea(ctx, frame, view, "front");
	drawWind(ctx, frame);
	drawRain(ctx, frame);

	// Fear closes in as faith fails: "when he saw the wind boisterous, he was afraid".
	const fear = frame.state.phase === "sinking" ? 1 : clamp((50 - frame.state.faith) / 50, 0, 1);
	if (fear > 0 && frame.rescue === null && frame.arrival === null) {
		const shade = ctx.createRadialGradient(frame.width / 2, frame.height / 2, frame.height * 0.25, frame.width / 2, frame.height / 2, frame.width * 0.75);
		shade.addColorStop(0, "rgba(0, 0, 0, 0)");
		shade.addColorStop(1, `rgba(0, 0, 0, ${0.6 * fear})`);
		ctx.fillStyle = shade;
		ctx.fillRect(0, 0, frame.width, frame.height);
	}
	if (frame.flash > 0) {
		ctx.fillStyle = `rgba(214, 226, 255, ${frame.flash})`;
		ctx.fillRect(0, 0, frame.width, frame.height);
	}
}
