"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, STAGE_STEP, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	FISH_AIM_MAX,
	FISH_BOAT_X,
	FISH_BOAT_Y,
	FISH_FAR,
	FISH_FLIGHT,
	FISH_HAUL,
	FISH_NEAR,
	FISH_NET_R,
	FISH_QUOTA,
	FISH_SECONDS,
	FISH_SNAG_HAUL,
	depthScale,
	fishAt,
	fishResult,
	logAt,
	newFish,
	shoalAt,
	stepFish,
	type FishEvent,
	type FishState,
} from "@/lib/beta/games/fishers-of-men-rules";

/**
 * Fishers of Men (LC-17908), Matthew 4:18-22: the sea of Galilee at dawn.
 * Simon Peter and Andrew are in their boat at the foot of the stage, casting
 * a net into the sea; shoals of fish drift under the water, some small and
 * some rich, among floating driftwood. The net's open circle lies on the
 * water where it is aimed: the arrows glide it, a finger or the mouse puts it
 * straight there; Space, or letting go, casts it. The net flies a moment,
 * opens where it lands and hauls in the fish inside it, so a good cast leads
 * the shoal (LC-17908). Jesus walks by on the shore, a robed figure in
 * light; when the catch is full he calls, "Follow me, and I will make you
 * fishers of men" (v19), and they leave their nets (v20).
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const HORIZON = 92;
const HAND = { x: FISH_BOAT_X - 4, y: 318 };
const OUTRO_WON = 190;
const OUTRO_LOST = 45;
const SHORE_JESUS_Y = 330;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
	size: number;
	gravity: number;
}

interface Floater {
	x: number;
	y: number;
	born: number;
	text: string;
	color: string;
}

interface Ripple {
	x: number;
	y: number;
	born: number;
	size: number;
}

/** A fish under the water: a dark shape with a flicking tail and fins and a shimmer along its back. */
function drawFish(context: CanvasRenderingContext2D, x: number, y: number, heading: number, scale: number, flick: number, rich: boolean, shimmer: number, alpha: number) {
	context.save();
	context.translate(x, y);
	context.rotate(heading);
	context.scale(scale, scale);
	context.globalAlpha = alpha;
	context.fillStyle = rich ? "rgba(16,40,46,.82)" : "rgba(13,34,50,.72)";
	context.beginPath();
	context.ellipse(0, 0, 12, 4.4, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(-9, 0);
	context.lineTo(-18, -5 + flick * 3);
	context.lineTo(-16, flick * 1.5);
	context.lineTo(-18, 5 + flick * 3);
	context.closePath();
	context.fill();
	context.beginPath();
	context.moveTo(3, -3);
	context.lineTo(-3, -8 - flick * 1.5);
	context.lineTo(-5, -3);
	context.moveTo(3, 3);
	context.lineTo(-3, 8 - flick * 1.5);
	context.lineTo(-5, 3);
	context.fill();
	context.strokeStyle = rich ? `rgba(255,214,130,${0.35 + 0.5 * shimmer})` : `rgba(196,232,250,${0.2 + 0.35 * shimmer})`;
	context.lineWidth = 1.3;
	context.beginPath();
	context.moveTo(-7, -1.5);
	context.quadraticCurveTo(0, -3.6, 8, -1.2);
	context.stroke();
	context.restore();
	context.globalAlpha = 1;
}

/** A silver fish out of the water (in the boat, and the HUD). */
function drawSilver(context: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 1) {
	context.save();
	context.translate(x, y);
	context.rotate(angle);
	context.scale(size, size);
	const body = context.createLinearGradient(0, -5, 0, 5);
	body.addColorStop(0, "#eef4f8");
	body.addColorStop(0.55, "#a9c1d2");
	body.addColorStop(1, "#5e7f97");
	context.fillStyle = body;
	context.beginPath();
	context.ellipse(0, 0, 10, 4.2, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(-8, 0);
	context.lineTo(-15, -5);
	context.lineTo(-15, 5);
	context.closePath();
	context.fill();
	context.fillStyle = "#1d2b38";
	context.beginPath();
	context.arc(6, -1, 1.2, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

/** The net: a round mesh with a weighted rim. */
function drawNet(context: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, alpha: number, bright = false) {
	context.save();
	context.globalAlpha = alpha;
	context.strokeStyle = bright ? "#fff1c8" : "rgba(238,226,196,.9)";
	context.lineWidth = 0.9;
	context.beginPath();
	for (let i = 0; i < 16; i++) {
		const angle = spin + (i / 16) * Math.PI * 2;
		context.moveTo(x, y);
		context.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
	}
	for (const ring of [0.35, 0.68]) {
		context.moveTo(x + r * ring, y);
		context.arc(x, y, r * ring, 0, Math.PI * 2);
	}
	context.stroke();
	context.lineWidth = 2.2;
	context.strokeStyle = bright ? "#ffe39a" : "#e8d6a6";
	context.beginPath();
	context.arc(x, y, r, 0, Math.PI * 2);
	context.stroke();
	context.fillStyle = "#4b4038";
	for (let i = 0; i < 10; i++) {
		const angle = spin * 0.5 + (i / 10) * Math.PI * 2;
		context.beginPath();
		context.arc(x + Math.cos(angle) * r, y + Math.sin(angle) * r, Math.max(1, r / 14), 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

/** How far out from the boat a point is, 0 at the nearest cast and 1 at the farthest. */
function reachOf(x: number, y: number) {
	return Math.max(0, Math.min(1, (Math.hypot(x - FISH_BOAT_X, FISH_BOAT_Y - y) - FISH_NEAR) / (FISH_FAR - FISH_NEAR)));
}

/** Where the net is aimed: its open circle laid on the water as a rope ring, with the line it will fly along from Peter's hands. */
function drawAim(context: CanvasRenderingContext2D, from: { x: number; y: number }, x: number, y: number, live: boolean, time: number, still: boolean) {
	context.save();
	context.globalAlpha = live ? 1 : 0.38;
	const lift = 26 + 44 * reachOf(x, y);
	context.setLineDash([2, 7]);
	context.lineDashOffset = still ? 0 : -time * 18;
	context.lineCap = "round";
	context.strokeStyle = "rgba(255,240,200,.6)";
	context.lineWidth = 1.8;
	context.beginPath();
	context.moveTo(from.x, from.y);
	context.quadraticCurveTo((from.x + x) / 2, Math.min(from.y, y) - lift, x, y - FISH_NET_R);
	context.stroke();
	context.fillStyle = live ? "rgba(255,236,180,.12)" : "rgba(255,236,180,.05)";
	context.beginPath();
	context.arc(x, y, FISH_NET_R, 0, Math.PI * 2);
	context.fill();
	context.setLineDash([]);
	context.strokeStyle = "rgba(10,24,36,.45)";
	context.lineWidth = 4.5;
	context.beginPath();
	context.arc(x, y, FISH_NET_R, 0, Math.PI * 2);
	context.stroke();
	context.setLineDash([8, 5]);
	context.lineDashOffset = still || !live ? 0 : -time * 10;
	context.strokeStyle = live ? "#ffe8a8" : "rgba(238,226,196,.9)";
	context.lineWidth = 2.6;
	context.beginPath();
	context.arc(x, y, FISH_NET_R, 0, Math.PI * 2);
	context.stroke();
	context.setLineDash([]);
	context.fillStyle = "#4b4038";
	for (let i = 0; i < 8; i++) {
		const angle = (i / 8) * Math.PI * 2 + 0.2;
		context.beginPath();
		context.arc(x + Math.cos(angle) * FISH_NET_R, y + Math.sin(angle) * FISH_NET_R, 2.2, 0, Math.PI * 2);
		context.fill();
	}
	context.strokeStyle = live ? "#fff4d6" : "rgba(255,244,214,.8)";
	context.lineWidth = 1.6;
	context.beginPath();
	context.moveTo(x - 5, y);
	context.lineTo(x + 5, y);
	context.moveTo(x, y - 5);
	context.lineTo(x, y + 5);
	context.stroke();
	context.restore();
}

/** One of the brothers: a robed figure, head covered, no face drawn in detail. */
function drawBrother(context: CanvasRenderingContext2D, x: number, feet: number, robe: string, height: number, arm: { x: number; y: number } | null) {
	const top = feet - height;
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - 9, feet);
	context.lineTo(x - 7, top + 12);
	context.quadraticCurveTo(x, top + 6, x + 7, top + 12);
	context.lineTo(x + 9, feet);
	context.closePath();
	context.fill();
	context.fillStyle = "rgba(0,0,0,.25)";
	context.fillRect(x - 8, top + height * 0.52, 16, 3);
	context.fillStyle = "#c69a72";
	context.beginPath();
	context.arc(x, top + 4, 6.5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#3a2a20";
	context.beginPath();
	context.arc(x, top + 2, 6.8, Math.PI * 1.02, Math.PI * 1.98);
	context.fill();
	context.beginPath();
	context.arc(x, top + 8.5, 4.2, 0.1 * Math.PI, 0.9 * Math.PI);
	context.fill();
	if (arm) {
		context.strokeStyle = robe;
		context.lineWidth = 4.5;
		context.lineCap = "round";
		context.beginPath();
		context.moveTo(x, top + 15);
		context.lineTo(arm.x, arm.y);
		context.stroke();
	}
}

/** Jesus, a simple robed figure in light (no face drawn). */
function drawJesus(context: CanvasRenderingContext2D, x: number, feet: number, light: number) {
	const glow = context.createRadialGradient(x, feet - 22, 2, x, feet - 22, 34 + light * 40);
	glow.addColorStop(0, `rgba(255,248,226,${0.75 + 0.25 * light})`);
	glow.addColorStop(0.5, `rgba(255,236,190,${0.3 + 0.3 * light})`);
	glow.addColorStop(1, "rgba(255,236,190,0)");
	context.fillStyle = glow;
	context.beginPath();
	context.arc(x, feet - 22, 34 + light * 40, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#fbf5e6";
	context.beginPath();
	context.moveTo(x - 9, feet);
	context.lineTo(x - 6, feet - 28);
	context.quadraticCurveTo(x, feet - 34, x + 6, feet - 28);
	context.lineTo(x + 9, feet);
	context.closePath();
	context.fill();
	context.fillStyle = "rgba(196,150,96,.55)";
	context.fillRect(x - 6, feet - 18, 12, 2.5);
	context.fillStyle = "#fffaf0";
	context.beginPath();
	context.arc(x, feet - 37, 5.5, 0, Math.PI * 2);
	context.fill();
}

function drawLog(context: CanvasRenderingContext2D, x: number, y: number, tilt: number, scale: number, bob: number) {
	context.save();
	context.translate(x, y + bob);
	context.rotate(tilt);
	context.scale(scale, scale);
	context.strokeStyle = "rgba(220,236,255,.28)";
	context.lineWidth = 1.5;
	context.beginPath();
	context.ellipse(0, 3, 26, 6, 0, 0, Math.PI * 2);
	context.stroke();
	context.fillStyle = "#5e4128";
	context.beginPath();
	context.roundRect(-21, -5, 42, 10, 5);
	context.fill();
	context.fillStyle = "#7c5838";
	context.fillRect(-18, -4, 36, 2.5);
	context.strokeStyle = "#5e4128";
	context.lineWidth = 3;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(8, -3);
	context.lineTo(15, -11);
	context.stroke();
	context.fillStyle = "#9a7650";
	context.beginPath();
	context.ellipse(21, 0, 2.5, 4.6, 0, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

export default function FishersOfMen({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<FishState>(newFish(seed));
	/** A finger or the mouse on the water: where it is (the aim goes there) and whether it has let go (a cast). */
	const pointer = useRef<{ id: number | null; to: { x: number; y: number } | null; cast: boolean }>({ id: null, to: null, cast: false });
	const clock = useRef(0);
	const endClock = useRef(0);
	const outro = useRef(0);
	const ended = useRef(false);
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const ripples = useRef<Ripple[]>([]);
	const haul = useRef<{ count: number; snag: boolean }>({ count: 0, snag: false });
	const flash = useRef(-9);
	const shake = useRef(-9);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, gravity: number) => {
		const t = clock.current;
		for (let i = 0; i < count; i++) {
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
			const power = speed * (0.35 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, born: t, life: 0.45 + Math.random() * 0.45, color: colors[i % colors.length], size: 1.2 + Math.random() * 2.2, gravity });
		}
	}, []);

	const react = useCallback(
		(event: FishEvent) => {
			const play = synth.current;
			const t = clock.current;
			if (event.type === "throw") {
				play?.noise(0.32, { volume: 0.14, filter: 1700, type: "bandpass" });
				play?.tone(240, 0.3, { type: "sine", volume: 0.08, to: 520 });
			}
			if (event.type === "land") {
				play?.noise(0.4, { volume: 0.32, filter: 900 });
				burst(event.x, event.y, 14, ["#e6f6ff", "#ffffff", "#9fd2ea"], 120, 320);
				ripples.current.push({ x: event.x, y: event.y, born: t, size: FISH_NET_R }, { x: event.x, y: event.y, born: t + 0.15, size: FISH_NET_R * 0.7 });
				haul.current = { count: event.caught, snag: event.snag };
				if (event.snag) {
					floaters.current.push({ x: event.x, y: event.y - 30, born: t, text: "Snagged!", color: "#ffbf94" });
					play?.tone(130, 0.22, { type: "square", volume: 0.08, to: 90, delay: 0.05 });
					play?.noise(0.2, { volume: 0.12, filter: 500, type: "bandpass", delay: 0.05 });
				} else if (event.caught > 0) {
					floaters.current.push({ x: event.x, y: event.y - 30, born: t, text: `+${event.caught}`, color: "#ffe39a" });
					burst(event.x, event.y, 6 + event.caught * 3, ["#ffe39a", "#fff6d8", "#ffd060"], 150, 200);
					flash.current = t;
					if (event.caught >= 5 && !reducedMotion) shake.current = t;
					const notes = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319];
					for (let i = 0; i < Math.min(event.caught, notes.length); i++) play?.tone(notes[i], 0.16, { type: "triangle", volume: 0.12, delay: 0.12 + i * 0.055 });
				} else {
					floaters.current.push({ x: event.x, y: event.y - 30, born: t, text: "Empty", color: "rgba(235,245,255,.85)" });
					play?.tone(330, 0.3, { type: "sine", volume: 0.08, to: 220, delay: 0.1 });
				}
			}
			if (event.type === "hauled") play?.noise(0.18, { volume: 0.08, filter: 600 });
			if (event.type === "won") {
				[523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1.4, { type: "triangle", volume: 0.13, delay: 0.5 + index * 0.12 }));
			}
			if (event.type === "lost") play?.tone(240, 0.8, { type: "sine", volume: 0.16, to: 150 });
		},
		[burst, reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		clock.current += STAGE_STEP;
		if (run.phase !== "playing") {
			takePresses(keys);
			pointer.current.to = null;
			pointer.current.cast = false;
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = fishResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		const presses = takePresses(keys);
		const held = keys.held;
		const move = { x: (held.has("arrowright") ? 1 : 0) - (held.has("arrowleft") ? 1 : 0), y: (held.has("arrowdown") ? 1 : 0) - (held.has("arrowup") ? 1 : 0) };
		const touch = pointer.current;
		const input = { move, to: touch.to, cast: touch.cast || presses.includes(" ") };
		touch.to = null;
		touch.cast = false;
		const events: FishEvent[] = [];
		stepFish(run, input, events);
		for (const event of events) react(event);
		if (run.phase !== "playing") endClock.current = clock.current;
		onTime(Math.max(0, FISH_SECONDS - run.t));
		const canvas = canvasRef.current;
		if (canvas) {
			// What the proof bot reads: the net's stage and how long it has been in it, the aim, the catch, and the water.
			const cast = run.cast;
			canvas.dataset.cast = `${cast.stage},${(run.t - cast.since).toFixed(3)},${run.aimX.toFixed(1)},${run.aimY.toFixed(1)},${run.caught},${run.phase}`;
			canvas.dataset.shoals = run.shoals
				.map((shoal) => {
					const now = shoalAt(shoal, run.t);
					const soon = shoalAt(shoal, run.t + 0.1);
					// Where it will be if the net is cast now (the lead).
					const lead = shoalAt(shoal, run.t + FISH_FLIGHT);
					return `${now.x.toFixed(1)},${now.y.toFixed(1)},${((soon.x - now.x) * 10).toFixed(1)},${((soon.y - now.y) * 10).toFixed(1)},${shoal.fish.length},${lead.x.toFixed(1)},${lead.y.toFixed(1)}`;
				})
				.join(";");
			canvas.dataset.logs = run.logs
				.map((log) => {
					const at = logAt(log, run.t);
					const soon = logAt(log, run.t + 0.1);
					return `${at.x.toFixed(0)},${at.y.toFixed(0)},${((soon.x - at.x) * 10).toFixed(1)},${((soon.y - at.y) * 10).toFixed(1)}`;
				})
				.join(";");
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const now = clock.current;
			const won = run.phase === "won";
			// The water keeps moving through the closing beat.
			const vt = run.phase === "playing" ? run.t : (run.endedAt ?? run.t) + (now - endClock.current);
			const wave = reducedMotion ? 0 : time;
			const outroK = won ? Math.min(1, outro.current / 60) : 0;
			context.save();
			if (!reducedMotion && now - shake.current < 0.25) context.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);

			// Dawn over Galilee.
			const sky = context.createLinearGradient(0, 0, 0, HORIZON);
			sky.addColorStop(0, "#1e2752");
			sky.addColorStop(0.55, "#9a5f86");
			sky.addColorStop(1, "#f6b77c");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, HORIZON + 10);
			const sun = context.createRadialGradient(306, HORIZON - 4, 3, 306, HORIZON - 4, 80);
			sun.addColorStop(0, "rgba(255,244,210,1)");
			sun.addColorStop(0.18, "rgba(255,220,150,.85)");
			sun.addColorStop(1, "rgba(255,190,120,0)");
			context.fillStyle = sun;
			context.fillRect(200, HORIZON - 90, 200, 90);
			context.fillStyle = "rgba(255,206,170,.35)";
			context.fillRect(40, 38, 120, 3);
			context.fillRect(210, 52, 150, 2.5);
			context.fillRect(90, 60, 70, 2);
			// The far hills.
			context.fillStyle = "#5c4466";
			context.beginPath();
			context.moveTo(0, HORIZON);
			context.bezierCurveTo(40, 64, 100, 80, 150, 72);
			context.bezierCurveTo(200, 64, 236, 86, 290, 78);
			context.bezierCurveTo(340, 70, 372, 76, 400, 70);
			context.lineTo(400, HORIZON);
			context.closePath();
			context.fill();
			context.fillStyle = "#71526a";
			context.beginPath();
			context.moveTo(0, HORIZON);
			context.bezierCurveTo(80, 82, 160, 90, 230, 84);
			context.bezierCurveTo(300, 80, 350, 88, 400, 84);
			context.lineTo(400, HORIZON);
			context.closePath();
			context.fill();

			// The sea, the sun's path laid across it.
			const sea = context.createLinearGradient(0, HORIZON, 0, STAGE);
			sea.addColorStop(0, "#c99a8e");
			sea.addColorStop(0.18, "#4f7f97");
			sea.addColorStop(0.6, "#245a72");
			sea.addColorStop(1, "#123a4f");
			context.fillStyle = sea;
			context.fillRect(-10, HORIZON, STAGE + 20, STAGE - HORIZON + 10);
			for (let row = 0; row < 18; row++) {
				const y = HORIZON + 3 + row * row * 0.9;
				const width = 14 + row * 5;
				const sway = Math.sin(wave * 1.3 + row * 1.7) * 5;
				context.fillStyle = `rgba(255,214,160,${0.5 - row * 0.026})`;
				context.fillRect(306 - width / 2 + sway, y, width, 1.6);
			}
			context.strokeStyle = "rgba(220,240,255,.12)";
			context.lineWidth = 1.2;
			for (let row = 0; row < 9; row++) {
				const y = 112 + row * row * 3.4;
				context.beginPath();
				for (let x = -10; x <= STAGE + 10; x += 16) context.lineTo(x, y + Math.sin(x / 26 + wave * 1.4 + row) * (1 + row * 0.3));
				context.stroke();
			}

			// The reach of a cast, faint on the water.
			const cast = run.cast;
			if (run.phase === "playing") {
				context.strokeStyle = cast.stage === "ready" ? "rgba(255,236,190,.08)" : "rgba(255,236,190,.04)";
				context.lineWidth = FISH_FAR - FISH_NEAR;
				context.beginPath();
				context.arc(FISH_BOAT_X, FISH_BOAT_Y, (FISH_NEAR + FISH_FAR) / 2, -Math.PI / 2 - FISH_AIM_MAX, -Math.PI / 2 + FISH_AIM_MAX);
				context.stroke();
			}

			// Ripples where the net came down.
			ripples.current = ripples.current.filter((ripple) => now - ripple.born < 1.1);
			for (const ripple of ripples.current) {
				const age = (now - ripple.born) / 1.1;
				if (age < 0) continue;
				context.strokeStyle = `rgba(230,246,255,${0.55 * (1 - age)})`;
				context.lineWidth = 2;
				context.beginPath();
				context.ellipse(ripple.x, ripple.y, ripple.size * (0.8 + age * 0.9), ripple.size * (0.8 + age * 0.9) * 0.55, 0, 0, Math.PI * 2);
				context.stroke();
			}

			// Driftwood.
			for (const log of run.logs) {
				const at = logAt(log, vt);
				drawLog(context, at.x, at.y, log.tilt * 0.6, depthScale(at.y), reducedMotion ? 0 : Math.sin(time * 1.6 + log.d) * 1.2);
			}

			// The shoals, moving under the water.
			for (const shoal of run.shoals) {
				const centre = shoalAt(shoal, vt);
				const ahead = shoalAt(shoal, vt + 0.08);
				const heading = Math.atan2(ahead.y - centre.y, ahead.x - centre.x);
				const fade = Math.min(1, (vt - shoal.born) / 0.6);
				const scale = depthScale(centre.y);
				// The water stirs over them, warm over a rich shoal.
				const stir = (time * 0.9 + shoal.id * 0.37) % 1;
				context.strokeStyle = shoal.rich ? `rgba(255,222,150,${0.45 * (1 - stir) * fade})` : `rgba(220,240,255,${0.28 * (1 - stir) * fade})`;
				context.lineWidth = 1.5;
				context.beginPath();
				context.ellipse(centre.x, centre.y, (12 + stir * 26) * scale, (5 + stir * 10) * scale, 0, 0, Math.PI * 2);
				context.stroke();
				for (const one of shoal.fish) {
					const at = fishAt(shoal, one, vt);
					const flick = reducedMotion ? 0 : Math.sin(time * 13 + one.ph * 3);
					const shimmer = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 4 + one.ph * 5);
					drawFish(context, at.x, at.y, heading + Math.sin(time * 2 + one.ph) * 0.12, scale, flick, shoal.rich, shimmer, fade);
				}
				if (shoal.rich && !reducedMotion) {
					context.fillStyle = `rgba(255,236,170,${0.7 * fade})`;
					for (let i = 0; i < 3; i++) {
						const glint = (time * 1.4 + i * 0.33 + shoal.id * 0.21) % 1;
						context.fillRect(centre.x + Math.sin(i * 2.3 + shoal.id) * 16 * scale, centre.y - glint * 14 * scale, 1.8, 1.8);
					}
				}
			}

			// The shore, and Jesus walking by it (v18).
			const sand = context.createLinearGradient(0, 300, 0, 400);
			sand.addColorStop(0, "#d9b98a");
			sand.addColorStop(1, "#a9875c");
			context.fillStyle = sand;
			context.beginPath();
			context.moveTo(-10, 292);
			context.quadraticCurveTo(62, 290, 92, 324);
			context.quadraticCurveTo(116, 352, 120, 410);
			context.lineTo(-10, 410);
			context.closePath();
			context.fill();
			context.strokeStyle = "rgba(255,255,255,.4)";
			context.lineWidth = 1.5;
			context.beginPath();
			context.moveTo(-10, 293 + (reducedMotion ? 0 : Math.sin(time) * 1.5));
			context.quadraticCurveTo(62, 291, 92, 325);
			context.quadraticCurveTo(116, 353, 120, 410);
			context.stroke();
			const walk = Math.min(1, vt / FISH_SECONDS);
			const jesusX = won ? 34 + 26 * Math.min(1, (run.endedAt ?? 0) / FISH_SECONDS) : 34 + 26 * walk;
			drawJesus(context, jesusX, SHORE_JESUS_Y, outroK);

			// The boat, rocking gently.
			const rock = reducedMotion ? 0 : Math.sin(time * 1.8) * 1.4;
			context.save();
			context.translate(0, rock);
			const hull = context.createLinearGradient(0, 352, 0, 388);
			hull.addColorStop(0, "#80522e");
			hull.addColorStop(1, "#42261a");
			context.fillStyle = "#33200f";
			context.beginPath();
			context.ellipse(200, 356, 74, 8, 0, 0, Math.PI * 2);
			context.fill();
			// What they have caught, shining in the boat.
			for (let i = 0; i < Math.min(run.caught, 14); i++) {
				drawSilver(context, 222 + (i % 5) * 9 - Math.floor(i / 5) * 4, 356 - Math.floor(i / 5) * 3, (i % 2 ? 0.4 : -0.3) + (i % 3) * 0.5, 0.75);
			}
			// The brothers: Peter casting at the bow side, Andrew with the line.
			const castStage = cast.stage;
			const flying = run.phase === "playing" && castStage === "flight";
			const leave = won ? Math.max(0, Math.min(1, (outro.current - 70) / 90)) : 0;
			const ready = run.phase === "playing" && castStage === "ready";
			const aimAngle = Math.atan2(run.aimX - FISH_BOAT_X, FISH_BOAT_Y - run.aimY);
			const reachArm = ready ? { x: HAND.x + Math.sin(aimAngle) * 14, y: HAND.y - 6 - Math.cos(aimAngle) * 6 } : { x: HAND.x + 10, y: HAND.y + 4 };
			if (leave < 1) {
				context.globalAlpha = 1 - leave;
				const lx = leave * (jesusX + 22 - 186);
				const ly = leave * (SHORE_JESUS_Y - 352);
				drawBrother(context, 186 + lx, 354 + ly, "#8a6440", 40, leave > 0 ? null : { x: reachArm.x + lx, y: reachArm.y + ly });
				drawBrother(context, 244 + leave * (jesusX + 40 - 244), 354 + ly, "#56697c", 34, leave > 0 ? null : { x: 232, y: 340 });
				context.globalAlpha = 1;
			}
			// The net in Peter's hands, ready to cast (and left in the boat at the end).
			if (run.phase !== "playing" && won) drawNet(context, 166, 352, 9, 0.4, 1);
			else if (ready) drawNet(context, reachArm.x, reachArm.y, 7, time * (reducedMotion ? 0 : 0.6), 1);
			context.fillStyle = hull;
			context.beginPath();
			context.moveTo(118, 348);
			context.quadraticCurveTo(200, 362, 284, 348);
			context.quadraticCurveTo(272, 384, 248, 388);
			context.lineTo(152, 388);
			context.quadraticCurveTo(128, 384, 118, 348);
			context.closePath();
			context.fill();
			context.strokeStyle = "rgba(0,0,0,.28)";
			context.lineWidth = 1;
			for (const y of [364, 374]) {
				context.beginPath();
				context.moveTo(130, y - 6);
				context.quadraticCurveTo(200, y + 4, 272, y - 6);
				context.stroke();
			}
			context.strokeStyle = "#a8784a";
			context.lineWidth = 2.5;
			context.beginPath();
			context.moveTo(118, 348);
			context.quadraticCurveTo(200, 362, 284, 348);
			context.stroke();
			context.restore();
			// The sea laps the hull.
			context.fillStyle = "rgba(18,58,79,.6)";
			context.beginPath();
			context.moveTo(-10, 384);
			for (let x = -10; x <= STAGE + 10; x += 10) context.lineTo(x, 381 + Math.sin(x / 18 + wave * 2) * 2);
			context.lineTo(STAGE + 10, 410);
			context.lineTo(-10, 410);
			context.closePath();
			context.fill();

			// Where the net is aimed (dim while the net is out), and the net in the air.
			const since = (run.phase === "playing" ? run.t : vt) - cast.since;
			if (run.phase === "playing") drawAim(context, ready ? reachArm : { x: HAND.x + 8, y: HAND.y - 8 }, run.aimX, run.aimY, ready, time, reducedMotion);
			if (flying) {
				const u = Math.min(1, since / FISH_FLIGHT);
				const from = { x: HAND.x + 8, y: HAND.y - 8 };
				const x = from.x + (cast.landX - from.x) * u;
				const ground = from.y + (cast.landY - from.y) * u;
				const lift = Math.sin(Math.PI * u) * (46 + 70 * reachOf(cast.landX, cast.landY));
				// Its shadow on the water, and the ring where it is going.
				context.strokeStyle = "rgba(255,240,200,.35)";
				context.lineWidth = 1.5;
				context.beginPath();
				context.arc(cast.landX, cast.landY, FISH_NET_R, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "rgba(8,24,36,.35)";
				context.beginPath();
				context.ellipse(x, ground, 8 + 10 * u, 3 + 4 * u, 0, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = "rgba(230,220,190,.6)";
				context.lineWidth = 1;
				context.beginPath();
				context.moveTo(232, 340);
				context.quadraticCurveTo((232 + x) / 2, ground - lift - 30, x, ground - lift);
				context.stroke();
				const open = u < 0.6 ? 0 : (u - 0.6) / 0.4;
				drawNet(context, x, ground - lift, 7 + (FISH_NET_R - 7) * open * open, reducedMotion ? 0 : time * 9, 1);
			}
			if (run.phase !== "lost" && castStage === "haul") {
				const length = cast.snag ? FISH_SNAG_HAUL : FISH_HAUL;
				const u = Math.min(1, since / length);
				const pull = cast.snag ? Math.max(0, (u - 0.45) / 0.55) : u;
				const ease = pull * pull;
				const to = { x: 214, y: 344 };
				const x = cast.landX + (to.x - cast.landX) * ease;
				const y = cast.landY + (to.y - cast.landY) * ease;
				const r = FISH_NET_R * (1 - 0.75 * Math.min(1, pull * 1.6));
				const tug = cast.snag && !reducedMotion && u < 0.45 ? Math.sin(time * 30) * 2 : 0;
				context.strokeStyle = "rgba(230,220,190,.7)";
				context.lineWidth = 1;
				context.beginPath();
				context.moveTo(232, 340);
				context.lineTo(x + tug, y);
				context.stroke();
				drawNet(context, x + tug, y, r, 0.3, won ? Math.max(0, 1 - outro.current / 30) : 1, haul.current.count > 0);
				for (let i = 0; i < Math.min(haul.current.count, 9); i++) {
					const a = i * 2.4;
					const d = r * 0.55 * ((i % 3) + 1) / 3;
					drawSilver(context, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, a + (reducedMotion ? 0 : Math.sin(time * 14 + i) * 0.4), 0.7);
				}
			}

			// Spray, sparkle and words.
			particles.current = particles.current.filter((particle) => now - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = now - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x + particle.vx * age, particle.y + particle.vy * age + particle.gravity * age * age, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			floaters.current = floaters.current.filter((floater) => now - floater.born < 0.9);
			context.textAlign = "center";
			context.font = "900 20px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = (now - floater.born) / 0.9;
				context.globalAlpha = 1 - age * age;
				context.fillStyle = "rgba(8,20,32,.6)";
				context.fillText(floater.text, floater.x + 1.5, floater.y - age * 24 + 1.5);
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 24);
			}
			context.globalAlpha = 1;
			if (!reducedMotion && now - flash.current < 0.18) {
				context.fillStyle = `rgba(255,236,170,${0.16 * (1 - (now - flash.current) / 0.18)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// The count, and what the next press does.
			context.fillStyle = "rgba(10,20,36,.6)";
			context.beginPath();
			context.roundRect(10, 10, 112, 36, 12);
			context.fill();
			drawSilver(context, 34, 28, 0, 1.1);
			context.textAlign = "left";
			context.font = "900 20px system-ui, sans-serif";
			context.fillStyle = run.caught >= FISH_QUOTA ? "#ffe39a" : "#ffffff";
			context.fillText(`${run.caught}/${FISH_QUOTA}`, 54, 35);
			if (run.phase === "playing") {
				const label = ready ? "Cast!" : run.cast.stage === "flight" ? "..." : "Haul";
				const live = ready;
				context.fillStyle = live ? "rgba(255,227,154,.92)" : "rgba(10,20,36,.6)";
				context.beginPath();
				context.roundRect(STAGE - 102, 10, 92, 36, 12);
				context.fill();
				context.textAlign = "center";
				context.fillStyle = live ? "#2a1a08" : "#ffffff";
				context.fillText(label, STAGE - 56, 35);
			}
			if (run.phase === "playing" && run.casts === 0 && run.t < 4) {
				context.font = "800 15px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillStyle = "rgba(10,20,36,.55)";
				context.beginPath();
				context.roundRect(76, 56, 248, 28, 10);
				context.fill();
				context.fillStyle = "#fff4d8";
				context.fillText("Lead the shoal, then cast", 200, 75);
			}

			// The closing beat: he calls, and they leave their nets (v19-20).
			if (won && outro.current > 30) {
				const fade = Math.min(1, (outro.current - 30) / 30, (OUTRO_WON - outro.current) / 25);
				context.globalAlpha = fade;
				context.fillStyle = "rgba(255,248,230,.9)";
				context.beginPath();
				context.roundRect(40, 110, 320, 76, 16);
				context.fill();
				context.fillStyle = "#3a2508";
				context.textAlign = "center";
				context.font = `italic 700 20px ${SERIF}`;
				context.fillText("Follow me, and I will make you", 200, 142);
				context.fillText("fishers of men.", 200, 170);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = `rgba(6,14,24,${0.4 * Math.min(1, outro.current / 30)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	// A finger or the mouse puts the aim where it is pressed and follows a drag; letting go casts there.
	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		canvas.setPointerCapture?.(event.pointerId);
		pointer.current.id = event.pointerId;
		pointer.current.to = stagePoint(canvas, event);
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (paused || !canvas || pointer.current.id !== event.pointerId) return;
		pointer.current.to = stagePoint(canvas, event);
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas || pointer.current.id !== event.pointerId) return;
		pointer.current.id = null;
		if (paused) return;
		pointer.current.to = stagePoint(canvas, event);
		pointer.current.cast = true;
	};
	const onPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (pointer.current.id === event.pointerId) pointer.current.id = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label={`The sea of Galilee at dawn. Peter and Andrew cast their net from the boat while shoals of fish drift under the water. The net's circle lies on the water where it is aimed: move it with the arrow keys and press Space to cast, or touch the water and let go to cast there. The net takes a moment to fall, so cast where a shoal is going; it hauls in the fish inside its circle, and driftwood snags it. Catch ${FISH_QUOTA} fish.`}
		/>
	);
}
