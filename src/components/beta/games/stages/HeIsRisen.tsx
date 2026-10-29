"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	RISEN_APEX,
	RISEN_SECONDS,
	RISEN_SPEED,
	RISEN_STUMBLES,
	leapClears,
	newRisen,
	nextObstacle,
	risenResult,
	stepRisen,
	type RisenEvent,
	type RisenObstacle,
	type RisenState,
} from "@/lib/beta/games/he-is-risen-rules";

/**
 * He Is Risen (LC-17851), Matthew 28:1-10: a runner through the garden at
 * dawn. One of the women runs from the empty sepulchre, the great stone rolled
 * back and the angel a soft light upon it, past the olive trees and the
 * lilies with Galilee's hills beyond, to bring his disciples word. The sun
 * rises over the round. A press (Space, ↑ or a tap) is a leap; a gold ring
 * closes on each stone and lights "LEAP!" while a leap would clear it.
 */

const LEAP_KEYS = new Set([" ", "arrowup"]);
const RUNNER_X = 104;
const GROUND_Y = 322;
/** The marker lights this much before the leap window opens, for reaction time. */
const MARKER_LEAD = 0.07;

interface Particle {
	/** World x (scrolls with the path), screen y. */
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

interface Popup {
	/** World x, or null to stay over the runner. */
	x: number | null;
	text: string;
	born: number;
	color: string;
}

function hash(n: number) {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
}

function mix(a: string, b: string, k: number) {
	const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
	const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
	return `rgb(${pa.map((value, i) => Math.round(value + (pb[i] - value) * k)).join(",")})`;
}

/** A simple robed figure, no face: head in a mantle, a flared robe. */
function drawRobed(context: CanvasRenderingContext2D, x: number, y: number, height: number, robe: string, mantle: string, armsUp = 0) {
	const h = height;
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - h * 0.2, y);
	context.quadraticCurveTo(x - h * 0.14, y - h * 0.45, x - h * 0.1, y - h * 0.72);
	context.lineTo(x + h * 0.1, y - h * 0.72);
	context.quadraticCurveTo(x + h * 0.14, y - h * 0.45, x + h * 0.2, y);
	context.closePath();
	context.fill();
	if (armsUp > 0) {
		context.strokeStyle = robe;
		context.lineWidth = h * 0.08;
		context.lineCap = "round";
		context.beginPath();
		context.moveTo(x - h * 0.08, y - h * 0.64);
		context.lineTo(x - h * 0.24, y - h * (0.64 + 0.3 * armsUp));
		context.moveTo(x + h * 0.08, y - h * 0.64);
		context.lineTo(x + h * 0.24, y - h * (0.64 + 0.3 * armsUp));
		context.stroke();
	}
	context.fillStyle = mantle;
	context.beginPath();
	context.arc(x, y - h * 0.84, h * 0.13, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(x - h * 0.13, y - h * 0.84);
	context.lineTo(x - h * 0.17, y - h * 0.6);
	context.lineTo(x + h * 0.17, y - h * 0.6);
	context.lineTo(x + h * 0.13, y - h * 0.84);
	context.closePath();
	context.fill();
}

/** The runner: robe streaming behind, mantle over her head, legs in stride. */
function drawRunner(context: CanvasRenderingContext2D, x: number, feet: number, stride: number, airborne: boolean, stagger: number, fallen: boolean) {
	context.save();
	context.translate(x, feet);
	context.scale(1.3, 1.3);
	if (fallen) {
		context.rotate(Math.PI / 2.3);
		context.translate(10, 4);
	} else context.rotate(0.16 + stagger * 0.5);
	const swing = airborne ? 0 : Math.sin(stride);
	context.strokeStyle = "#5a2a32";
	context.lineCap = "round";
	context.lineWidth = 4.5;
	context.beginPath();
	if (airborne) {
		context.moveTo(-2, -22);
		context.lineTo(8, -12);
		context.lineTo(4, -2);
		context.moveTo(-2, -22);
		context.lineTo(-10, -12);
		context.lineTo(-16, -8);
	} else {
		context.moveTo(-1, -22);
		context.lineTo(swing * 10, -2);
		context.moveTo(-1, -22);
		context.lineTo(-swing * 10, -2);
	}
	context.stroke();
	// Robe, flaring back as she runs.
	context.fillStyle = "#b8475a";
	context.beginPath();
	context.moveTo(-6, -50);
	context.lineTo(7, -50);
	context.quadraticCurveTo(10, -32, 8, -16);
	context.lineTo(-18 - Math.abs(swing) * 3, -12);
	context.quadraticCurveTo(-12, -34, -6, -50);
	context.closePath();
	context.fill();
	context.fillStyle = "#93334a";
	context.beginPath();
	context.moveTo(-4, -46);
	context.quadraticCurveTo(-10, -30, -18 - Math.abs(swing) * 3, -12);
	context.lineTo(-12, -12);
	context.quadraticCurveTo(-6, -30, -1, -46);
	context.closePath();
	context.fill();
	// Arms: one reaching forward, one back.
	context.strokeStyle = "#e9d8bd";
	context.lineWidth = 3.5;
	context.beginPath();
	context.moveTo(2, -44);
	context.lineTo(12 + swing * 3, -36 - (airborne ? 8 : 0));
	context.moveTo(-1, -44);
	context.lineTo(-10 - swing * 3, -36 - (airborne ? 6 : 0));
	context.stroke();
	// Mantle over her head and shoulders, streaming back.
	context.fillStyle = "#f4e8d2";
	context.beginPath();
	context.arc(2, -56, 7, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(8, -58);
	context.quadraticCurveTo(2, -66, -6, -60);
	context.quadraticCurveTo(-18, -54, -24 - Math.abs(swing) * 2, -44);
	context.lineTo(-6, -46);
	context.closePath();
	context.fill();
	context.restore();
}

function drawObstacle(context: CanvasRenderingContext2D, item: RisenObstacle, x: number) {
	const { w, h } = item;
	context.save();
	if (item.state === "hit") {
		context.globalAlpha = 0.75;
		context.translate(x, GROUND_Y);
		context.rotate(0.25);
		context.translate(-x, -GROUND_Y);
	}
	if (item.kind === "root") {
		context.strokeStyle = "#5b3b24";
		context.lineCap = "round";
		context.lineWidth = 7;
		context.beginPath();
		context.moveTo(x - w / 2, GROUND_Y + 2);
		context.bezierCurveTo(x - w / 3, GROUND_Y - h * 1.5, x + w / 4, GROUND_Y - h * 1.4, x + w / 2, GROUND_Y + 2);
		context.stroke();
		context.strokeStyle = "#7a5233";
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(x - w / 2 + 4, GROUND_Y - 1);
		context.bezierCurveTo(x - w / 3, GROUND_Y - h * 1.3, x + w / 4, GROUND_Y - h * 1.2, x + w / 2 - 4, GROUND_Y - 1);
		context.stroke();
	} else {
		const big = item.kind === "rock";
		context.fillStyle = big ? "#6f6a63" : "#8d8780";
		context.beginPath();
		context.moveTo(x - w / 2, GROUND_Y + 3);
		context.quadraticCurveTo(x - w / 2 - 2, GROUND_Y - h * 0.8, x - w * 0.1, GROUND_Y - h);
		context.quadraticCurveTo(x + w / 2 + 2, GROUND_Y - h * 0.95, x + w / 2, GROUND_Y + 3);
		context.closePath();
		context.fill();
		context.fillStyle = "rgba(255,226,180,.35)";
		context.beginPath();
		context.ellipse(x + w * 0.1, GROUND_Y - h * 0.7, w * 0.22, h * 0.16, -0.3, 0, Math.PI * 2);
		context.fill();
		if (big) {
			context.fillStyle = "#6c7c48";
			context.beginPath();
			context.ellipse(x - w * 0.2, GROUND_Y - h * 0.15, w * 0.22, h * 0.12, 0, 0, Math.PI * 2);
			context.fill();
		}
	}
	context.restore();
}

function drawLily(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
	context.strokeStyle = "#4f7a3a";
	context.lineWidth = 1.5;
	context.beginPath();
	context.moveTo(x, y);
	context.quadraticCurveTo(x - 2, y - size * 1.2, x + 1, y - size * 2);
	context.stroke();
	context.fillStyle = "#fffaf0";
	for (const angle of [-0.9, 0, 0.9]) {
		context.beginPath();
		context.ellipse(x + 1 + Math.sin(angle) * size * 0.45, y - size * 2.3 - Math.cos(angle) * size * 0.25, size * 0.28, size * 0.62, angle, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "#f2c14e";
	context.beginPath();
	context.arc(x + 1, y - size * 2.05, size * 0.16, 0, Math.PI * 2);
	context.fill();
}

function drawOlive(context: CanvasRenderingContext2D, x: number, base: number, size: number, k: number) {
	context.fillStyle = mix("#3c2f2c", "#5d4636", k);
	context.beginPath();
	context.moveTo(x - size * 0.12, base);
	context.quadraticCurveTo(x - size * 0.02, base - size * 0.4, x - size * 0.12, base - size * 0.7);
	context.lineTo(x + size * 0.06, base - size * 0.7);
	context.quadraticCurveTo(x + size * 0.14, base - size * 0.35, x + size * 0.12, base);
	context.closePath();
	context.fill();
	context.fillStyle = mix("#3f4a3a", "#7d8c62", k);
	for (const [dx, dy, r] of [
		[-0.32, -0.82, 0.32],
		[0.08, -1.0, 0.4],
		[0.42, -0.8, 0.3],
		[0, -0.7, 0.34],
	]) {
		context.beginPath();
		context.ellipse(x + dx * size, base + dy * size, r * size * 1.2, r * size * 0.8, 0, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = mix("#566249", "#a7b382", k);
	context.beginPath();
	context.ellipse(x + 0.22 * size, base - 1.05 * size, 0.22 * size, 0.12 * size, 0, 0, Math.PI * 2);
	context.fill();
}

export default function HeIsRisen({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<RisenState>(newRisen(seed));
	const taps = useRef(0);
	const pointerHeld = useRef(false);
	const particles = useRef<Particle[]>([]);
	const popups = useRef<Popup[]>([]);
	const flash = useRef({ hit: -10, clear: -10 });
	const ended = useRef(false);
	const ticks = useRef(0);
	/** The draw clock, real seconds: effects play on after the round ends. */
	const clock = useRef(0);
	const touch = useRef(false);
	const pausedRef = useRef(paused);
	pausedRef.current = paused;
	const synth = useSynth(muted);

	useEffect(() => {
		touch.current = window.matchMedia("(pointer: coarse)").matches;
	}, []);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, gravity: number, life: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.6);
			particles.current.push({
				x,
				y,
				vx: Math.cos(angle) * v,
				vy: Math.sin(angle) * v - speed * 0.4,
				born: clock.current,
				life: life * (0.6 + Math.random() * 0.4),
				color: colors[i % colors.length],
				size: 1.5 + Math.random() * 2.5,
				gravity,
			});
		}
	}, []);

	const react = useCallback(
		(event: RisenEvent) => {
			const run = state.current;
			const play = synth.current;
			if (event.type === "leap") {
				play?.noise(0.14, { volume: 0.07, filter: 2600, type: "highpass" });
				play?.tone(360, 0.16, { type: "sine", volume: 0.08, to: 760 });
				burst(run.d, GROUND_Y, 5, ["#e8cfa4", "#d9b98a"], 40, 60, 0.4);
			}
			if (event.type === "land") {
				play?.noise(0.06, { volume: 0.05, filter: 600 });
				burst(run.d, GROUND_Y, 4, ["#e8cfa4"], 30, 60, 0.3);
			}
			if (event.type === "clear") {
				const scale = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1567.98];
				const note = scale[Math.min(scale.length - 1, Math.max(0, event.streak - 1))];
				play?.tone(note, 0.6, { type: "triangle", volume: 0.14 });
				play?.tone(note * 2, 0.4, { type: "sine", volume: 0.04, delay: 0.02 });
				const item = run.obstacles.find((other) => other.id === event.id);
				if (item) {
					burst(item.x, GROUND_Y - item.h - 8, 14, ["#ffe08a", "#fff6d8", "#f7b267"], 70, 20, 0.7);
					popups.current.push({ x: item.x, text: "+1", born: clock.current, color: "#ffe08a" });
				}
				flash.current.clear = clock.current;
			}
			if (event.type === "stumble") {
				play?.noise(0.28, { volume: 0.35, filter: 260 });
				play?.tone(150, 0.3, { type: "sine", volume: 0.2, to: 70 });
				flash.current.hit = clock.current;
				burst(run.d + 8, GROUND_Y - 6, 12, ["#c9a77a", "#a8885f", "#e8cfa4"], 60, 120, 0.6);
				popups.current.push({ x: null, text: `Stumbled ${run.stumbles}/${RISEN_STUMBLES}`, born: clock.current, color: "#ffd0c2" });
			}
			if (event.type === "arrived") {
				[523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((note, index) => play?.tone(note, 1.4, { type: "triangle", volume: 0.15, delay: index * 0.1 }));
				[523.25, 659.25, 783.99].forEach((note) => play?.tone(note, 2.2, { type: "sine", volume: 0.07, delay: 0.55 }));
				burst(run.d + 40, GROUND_Y - 60, 40, ["#ffe08a", "#fff6d8", "#ffffff", "#f7b267"], 120, 10, 1.6);
			}
			if (event.type === "fell") play?.tone(330, 0.9, { type: "sine", volume: 0.16, to: 196 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const leap = takePresses(keys).some((key) => LEAP_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const hold = pointerHeld.current || keys.held.has(" ") || keys.held.has("arrowup");
		const events: RisenEvent[] = [];
		stepRisen(run, { leap, hold }, events);
		for (const event of events) react(event);
		onTime(Math.max(0, RISEN_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && (ticks.current % 6 === 0 || run.phase !== "playing")) {
			const item = nextObstacle(run);
			const leapAt = item ? run.t + (item.x - run.d - run.speed * RISEN_APEX) / run.speed : -1;
			canvas.dataset.risen = `${run.t.toFixed(3)},${leapAt.toFixed(3)},${item?.id ?? -1},${run.stumbles},${run.cleared}`;
		}
		const result = risenResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			clock.current = time;
			const k = Math.min(1, run.t / RISEN_SECONDS);
			const sinceHit = time - flash.current.hit;
			const shake = !reducedMotion && sinceHit < 0.3 ? (1 - sinceHit / 0.3) * 5 : 0;
			context.save();
			if (shake) context.translate(Math.sin(time * 90) * shake, Math.cos(time * 77) * shake * 0.6);
			const toScreen = (worldX: number) => RUNNER_X + worldX - run.d;

			// Dawn: the sky warms and the sun rises over the round.
			const sky = context.createLinearGradient(0, 0, 0, 300);
			sky.addColorStop(0, mix("#2c2b5e", "#7fb0dc", k));
			sky.addColorStop(0.55, mix("#9b5d8e", "#f7c9a8", k));
			sky.addColorStop(1, mix("#f2a079", "#ffe7ad", k));
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 320);
			const sunY = 300 - k * 190;
			const sunGlow = context.createRadialGradient(292, sunY, 10, 292, sunY, 150);
			sunGlow.addColorStop(0, "rgba(255,236,170,.75)");
			sunGlow.addColorStop(1, "rgba(255,236,170,0)");
			context.fillStyle = sunGlow;
			context.fillRect(130, sunY - 160, 330, 320);
			context.fillStyle = "#fff1c4";
			context.beginPath();
			context.arc(292, sunY, 28, 0, Math.PI * 2);
			context.fill();
			if (k < 0.35) {
				context.fillStyle = `rgba(255,255,255,${0.7 * (1 - k / 0.35)})`;
				for (let i = 0; i < 14; i++) context.fillRect(hash(i) * STAGE, hash(i + 40) * 140, 1.6, 1.6);
			}

			// Galilee's hills, far off.
			const hills = (parallax: number, base: number, amp: number, color: string) => {
				context.fillStyle = color;
				context.beginPath();
				context.moveTo(-10, 330);
				for (let x = -10; x <= STAGE + 10; x += 10) {
					const wx = x + run.d * parallax;
					context.lineTo(x, base - amp * (0.6 * Math.sin(wx / 90) + 0.4 * Math.sin(wx / 37 + 1.3)));
				}
				context.lineTo(STAGE + 10, 330);
				context.closePath();
				context.fill();
			};
			hills(0.06, 246, 16, mix("#6c5585", "#a9b4d4", k));
			hills(0.14, 270, 12, mix("#584a70", "#8a9cb8", k));

			// Olive trees of the garden.
			const treeParallax = 0.45;
			const first = Math.floor((run.d * treeParallax - 60) / 120);
			for (let i = first; i < first + 6; i++) {
				const x = i * 120 + hash(i) * 50 - run.d * treeParallax;
				drawOlive(context, x, 300, 52 + hash(i + 9) * 22, k);
			}

			// The garden and the path.
			context.fillStyle = mix("#3e5a35", "#7aa05a", k);
			context.fillRect(-10, 296, STAGE + 20, 30);
			context.fillStyle = mix("#a98a6a", "#e2c596", k);
			context.fillRect(-10, GROUND_Y - 6, STAGE + 20, 30);
			context.fillStyle = mix("#2f4a2c", "#5d8446", k);
			context.fillRect(-10, GROUND_Y + 24, STAGE + 20, 90);
			for (let i = Math.floor((run.d - 40) / 46); i < Math.floor((run.d + 440) / 46); i++) {
				const x = toScreen(i * 46 + hash(i) * 20);
				if (hash(i + 3) < 0.55) drawLily(context, x, 304, 4 + hash(i + 5) * 1.5);
			}

			// The sepulchre in the garden, its great stone rolled back from the door.
			const tombX = toScreen(-110);
			if (tombX > -160) {
				context.fillStyle = mix("#6e5e55", "#a08b78", k);
				context.beginPath();
				context.moveTo(tombX - 100, GROUND_Y);
				context.quadraticCurveTo(tombX - 90, GROUND_Y - 150, tombX + 10, GROUND_Y - 140);
				context.quadraticCurveTo(tombX + 70, GROUND_Y - 120, tombX + 66, GROUND_Y);
				context.closePath();
				context.fill();
				context.fillStyle = "#231915";
				context.beginPath();
				context.moveTo(tombX - 22, GROUND_Y);
				context.lineTo(tombX - 22, GROUND_Y - 44);
				context.arc(tombX, GROUND_Y - 44, 22, Math.PI, 0);
				context.lineTo(tombX + 22, GROUND_Y);
				context.closePath();
				context.fill();
				const stoneX = tombX + 54;
				context.fillStyle = mix("#7d7268", "#b3a594", k);
				context.beginPath();
				context.arc(stoneX, GROUND_Y - 32, 32, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = "rgba(0,0,0,.18)";
				context.lineWidth = 3;
				context.beginPath();
				context.arc(stoneX, GROUND_Y - 32, 24, 0, Math.PI * 2);
				context.stroke();
				// The angel: a soft white light sitting upon the stone (v2).
				const pulse = reducedMotion ? 0 : Math.sin(time * 2) * 6;
				const angel = context.createRadialGradient(stoneX, GROUND_Y - 84, 4, stoneX, GROUND_Y - 84, 64 + pulse);
				angel.addColorStop(0, "rgba(255,255,255,.95)");
				angel.addColorStop(0.35, "rgba(255,250,232,.55)");
				angel.addColorStop(1, "rgba(255,250,232,0)");
				context.fillStyle = angel;
				context.fillRect(stoneX - 80, GROUND_Y - 170, 160, 170);
				context.fillStyle = "rgba(255,255,255,.85)";
				context.beginPath();
				context.ellipse(stoneX, GROUND_Y - 82, 9, 20, 0, 0, Math.PI * 2);
				context.fill();
			}

			// The disciples, waiting; she reaches them as the round ends.
			const meetX = RUNNER_X + 44 + Math.max(0, RISEN_SECONDS - run.t) * RISEN_SPEED;
			if (meetX < STAGE + 80) {
				const cheer = run.phase === "won" ? 1 : 0;
				const glow = context.createRadialGradient(meetX + 40, GROUND_Y - 30, 6, meetX + 40, GROUND_Y - 30, run.phase === "won" ? 120 : 70);
				glow.addColorStop(0, "rgba(255,240,200,.6)");
				glow.addColorStop(1, "rgba(255,240,200,0)");
				context.fillStyle = glow;
				context.fillRect(meetX - 90, GROUND_Y - 160, 260, 200);
				const robes = ["#5f4b8b", "#7a5a3a", "#3f6b6a", "#8a6d2f", "#6b3f3f"];
				robes.forEach((robe, index) => {
					const bob = cheer && !reducedMotion ? Math.abs(Math.sin(time * 5 + index)) * 4 : 0;
					drawRobed(context, meetX + index * 19, GROUND_Y + 2 - (index % 2) * 4 - bob, 50 + (index % 3) * 4, robe, "#e9dcc4", cheer);
				});
			}

			// Stones and roots on the way, and the leap marker on the next one.
			const ahead = nextObstacle(run);
			for (const item of run.obstacles) {
				const x = toScreen(item.x);
				if (x < -40 || x > STAGE + 40) continue;
				drawObstacle(context, item, x);
			}
			if (ahead && run.phase === "playing") {
				const x = toScreen(ahead.x);
				const ideal = run.speed * RISEN_APEX;
				const gap = ahead.x - run.d;
				const lit = leapClears(run, ahead) || leapClears({ ...run, d: run.d + run.speed * MARKER_LEAD }, ahead);
				const closing = Math.max(0, Math.min(1, (gap - ideal) / 220));
				if (x < STAGE + 20) {
					const top = GROUND_Y - ahead.h - 16;
					if (lit && run.grounded) {
						const beat = reducedMotion ? 1 : 1 + Math.sin(time * 24) * 0.12;
						const halo = context.createRadialGradient(x, top + 6, 2, x, top + 6, 40 * beat);
						halo.addColorStop(0, "rgba(255,226,120,.85)");
						halo.addColorStop(1, "rgba(255,226,120,0)");
						context.fillStyle = halo;
						context.fillRect(x - 50, top - 44, 100, 100);
						context.strokeStyle = "#ffe066";
						context.lineWidth = 4;
						context.beginPath();
						context.arc(x, top + 6, 20 * beat, 0, Math.PI * 2);
						context.stroke();
						context.font = "900 22px system-ui, sans-serif";
						context.textAlign = "center";
						context.lineWidth = 5;
						context.strokeStyle = "rgba(60,30,10,.75)";
						context.strokeText("LEAP!", x, top - 30);
						context.fillStyle = "#fff4c2";
						context.fillText("LEAP!", x, top - 30);
						// Her take-off glows too.
						context.fillStyle = "rgba(255,224,102,.55)";
						context.beginPath();
						context.ellipse(RUNNER_X, GROUND_Y + 2, 20, 5, 0, 0, Math.PI * 2);
						context.fill();
					} else if (gap > ideal || !run.grounded) {
						context.strokeStyle = `rgba(255,224,102,${0.35 + 0.5 * (1 - closing)})`;
						context.lineWidth = 3;
						context.beginPath();
						context.arc(x, top + 6, 20 + closing * 46, 0, Math.PI * 2);
						context.stroke();
						context.setLineDash([2, 4]);
						context.strokeStyle = "rgba(255,240,190,.55)";
						context.lineWidth = 1.5;
						context.beginPath();
						context.arc(x, top + 6, 20, 0, Math.PI * 2);
						context.stroke();
						context.setLineDash([]);
					}
				}
			}

			// Her shadow and the runner.
			const fallen = run.phase === "lost";
			const sinceStumble = run.t - run.stumbleAt;
			const stagger = sinceStumble < 0.4 ? 1 - sinceStumble / 0.4 : 0;
			context.fillStyle = "rgba(40,25,20,.25)";
			context.beginPath();
			context.ellipse(RUNNER_X, GROUND_Y + 2, Math.max(6, 14 - run.y * 0.08), 3.5, 0, 0, Math.PI * 2);
			context.fill();
			const stride = run.phase === "playing" ? run.d / 11 : 0;
			drawRunner(context, RUNNER_X, GROUND_Y - run.y, stride, !run.grounded, stagger, fallen);
			if (sinceHit < 0.35) {
				context.strokeStyle = `rgba(255,120,90,${1 - sinceHit / 0.35})`;
				context.lineWidth = 3;
				context.beginPath();
				context.arc(RUNNER_X, GROUND_Y - run.y - 30, 30 + sinceHit * 60, 0, Math.PI * 2);
				context.stroke();
			}

			// Particles and the little words over the way.
			particles.current = particles.current.filter((p) => time - p.born < p.life);
			for (const p of particles.current) {
				const age = Math.max(0, time - p.born);
				const life = age / p.life;
				context.fillStyle = p.color;
				context.globalAlpha = 1 - life;
				context.beginPath();
				context.arc(toScreen(p.x) + p.vx * age, p.y + p.vy * age + p.gravity * age * age, p.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			popups.current = popups.current.filter((popup) => time - popup.born < 0.9);
			context.font = "800 15px system-ui, sans-serif";
			context.textAlign = "center";
			for (const popup of popups.current) {
				const age = time - popup.born;
				context.globalAlpha = 1 - age / 0.9;
				context.lineWidth = 4;
				context.strokeStyle = "rgba(40,20,10,.7)";
				const x = popup.x === null ? RUNNER_X + 10 : toScreen(popup.x);
				context.strokeText(popup.text, x, GROUND_Y - 100 - age * 30);
				context.fillStyle = popup.color;
				context.fillText(popup.text, x, GROUND_Y - 100 - age * 30);
			}
			context.globalAlpha = 1;

			// Foreground lilies, nearer and quicker.
			for (let i = Math.floor((run.d * 1.25 - 40) / 64); i < Math.floor((run.d * 1.25 + 440) / 64); i++) {
				if (hash(i + 21) < 0.5) continue;
				drawLily(context, i * 64 + hash(i + 7) * 30 - run.d * 1.25, 384 + hash(i + 11) * 10, 6 + hash(i + 2) * 2);
			}
			context.restore();

			// Flashes.
			if (sinceHit < 0.3) {
				context.fillStyle = `rgba(255,110,80,${0.32 * (1 - sinceHit / 0.3)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}
			const sinceClear = time - flash.current.clear;
			if (sinceClear < 0.2) {
				context.fillStyle = `rgba(255,236,160,${0.14 * (1 - sinceClear / 0.2)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,244,214,.2)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(30,20,40,.35)";
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// The steps she may still stumble: three lilies, one wilting with each stumble.
			context.fillStyle = "rgba(20,14,30,.45)";
			context.beginPath();
			context.roundRect(10, 10, 92, 34, 12);
			context.fill();
			for (let i = 0; i < RISEN_STUMBLES; i++) {
				const used = i >= RISEN_STUMBLES - run.stumbles;
				context.globalAlpha = used ? 0.3 : 1;
				drawLily(context, 28 + i * 28, 40, 5);
			}
			context.globalAlpha = 1;
			context.fillStyle = "rgba(20,14,30,.45)";
			context.beginPath();
			context.roundRect(STAGE - 88, 10, 78, 34, 12);
			context.fill();
			context.fillStyle = "#8d8780";
			context.beginPath();
			context.ellipse(STAGE - 70, 30, 10, 7, 0, Math.PI, 0);
			context.fill();
			context.fillStyle = "#fff4c2";
			context.font = "900 18px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillText(`× ${run.cleared}`, STAGE - 56, 34);

			// How to leap, plain on the stage for the first seconds.
			if (run.phase === "playing" && run.t < 2.4 && !(pausedRef.current && run.t === 0)) {
				const alpha = run.t < 1.9 ? 1 : 1 - (run.t - 1.9) / 0.5;
				const beat = reducedMotion ? 1 : 1 + Math.sin(time * 7) * 0.05;
				context.globalAlpha = alpha;
				context.save();
				context.translate(STAGE / 2, 92);
				context.scale(beat, beat);
				context.fillStyle = "rgba(20,14,30,.72)";
				context.beginPath();
				context.roundRect(-150, -30, 300, 60, 18);
				context.fill();
				context.strokeStyle = "#ffe066";
				context.lineWidth = 2.5;
				context.stroke();
				context.fillStyle = "#fff4c2";
				context.font = "900 24px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(touch.current ? "TAP to leap" : "SPACE or ↑ to leap", 0, -2);
				context.font = "700 13px system-ui, sans-serif";
				context.fillStyle = "#ffe8b0";
				context.fillText("Leap when the gold ring says LEAP!", 0, 19);
				context.restore();
				context.globalAlpha = 1;
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused) return;
		// Captured, so a release over the pause screen still ends the hold.
		event.currentTarget.setPointerCapture?.(event.pointerId);
		taps.current += 1;
		pointerHeld.current = true;
	};
	const release = () => {
		pointerHeld.current = false;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerUp={release}
			onPointerCancel={release}
			onPointerLeave={release}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="At dawn a woman runs from the empty sepulchre through the garden to tell the disciples he is risen. Tap, or press Space or the up arrow, to leap the stones and roots when the gold ring says Leap."
		/>
	);
}
