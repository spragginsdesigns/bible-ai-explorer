"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	WATCH_FLASHES,
	WATCH_MAX_EARLY,
	WATCH_SECONDS,
	newWatch,
	stepWatch,
	watchDecoyAt,
	watchLit,
	watchOpen,
	watchResult,
	type WatchEvent,
	type WatchState,
} from "@/lib/beta/games/watch-rules";

/**
 * Watch! (LC-17851), Matthew 24:42-44 and v27: a night watch over a house and
 * the sky. Lamps flicker, a torch passes in the street, heat-lightning glows
 * low on the horizon; none of those is the sign. When the lightning streaks
 * out of the east and shines even unto the west, tap or press Space at once.
 */

const TAP_KEYS = new Set([" "]);
const HORIZON = 250;

interface Word {
	text: string;
	x: number;
	y: number;
	age: number;
	color: string;
	size: number;
}

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
}

function hash(n: number) {
	const s = Math.sin(n * 78.233) * 43758.5453;
	return s - Math.floor(s);
}

/** A jagged bolt from the east (right) to the west (left), with a few forks hanging from it. */
function boltPoints(index: number) {
	const points: { x: number; y: number }[] = [];
	let y = 40 + hash(index * 3) * 60;
	for (let i = 0; i <= 22; i++) {
		points.push({ x: STAGE + 10 - i * ((STAGE + 20) / 22), y });
		y += (hash(index * 31 + i) - 0.5) * 56;
		y = Math.max(24, Math.min(170, y));
	}
	return points;
}

function forkPoints(points: { x: number; y: number }[], index: number) {
	return [5, 11, 17].map((at, k) => {
		const fork = [points[at]];
		let { x, y } = points[at];
		for (let i = 0; i < 4; i++) {
			x -= 6 + hash(index * 7 + k * 13 + i) * 12;
			y += 10 + hash(index * 5 + k * 17 + i) * 14;
			fork.push({ x, y });
		}
		return { at, fork };
	});
}

export default function Watch({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WatchState>(newWatch(seed));
	const taps = useRef(0);
	const ended = useRef(false);
	const words = useRef<Word[]>([]);
	const sparks = useRef<Spark[]>([]);
	const early = useRef(-9);
	const shake = useRef(0);
	const ticks = useRef(0);
	const lastLit = useRef("");
	const bolts = useRef(
		Array.from({ length: WATCH_FLASHES }, (_, index) => {
			const points = boltPoints(seed + index);
			return { points, forks: forkPoints(points, seed + index) };
		}),
	);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: WatchEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "flash") {
				play.noise(0.12, { volume: 0.3, filter: 6000, type: "highpass" });
				play.noise(1.2, { volume: 0.32, filter: 220, delay: 0.25 });
			}
			if (event.type === "catch") [880, 1320].forEach((note, index) => play.tone(note, 0.3, { type: "triangle", volume: 0.16, delay: index * 0.07 }));
			if (event.type === "early") play.tone(180, 0.3, { type: "square", volume: 0.1, to: 120 });
			if (event.type === "missed") play.tone(330, 0.4, { type: "sine", volume: 0.12, to: 220 });
			if (event.type === "decoy" && event.kind === "heat") play.noise(0.5, { volume: 0.05, filter: 160 });
			if (event.type === "end") {
				if (event.won) [523, 659, 784, 1047].forEach((note, index) => play.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: 0.2 + index * 0.1 }));
				else play.tone(220, 0.9, { type: "sine", volume: 0.16, to: 147 });
			}
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const pressed = takePresses(keys).some((key) => TAP_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const events: WatchEvent[] = [];
		stepWatch(run, { tap: pressed }, events);
		for (const event of events) {
			sound(event);
			if (event.type === "flash" && !reducedMotion) shake.current = 0.2;
			if (event.type === "catch") {
				const ms = Math.round(event.reaction * 1000);
				words.current.push({ text: ms <= 260 ? "Ready!" : "Caught!", x: STAGE / 2, y: 190, age: 0, color: "#ffe680", size: 34 });
				words.current.push({ text: `${(event.reaction).toFixed(2)}s`, x: STAGE / 2, y: 222, age: 0, color: "#ffffff", size: 18 });
				for (let i = 0; i < 26; i++) {
					const angle = (i / 26) * Math.PI * 2;
					sparks.current.push({ x: STAGE / 2, y: 180, vx: Math.cos(angle) * 160, vy: Math.sin(angle) * 160, age: 0, life: 0.6 });
				}
			}
			if (event.type === "early") {
				early.current = run.t;
				words.current.push({ text: "Too soon!", x: STAGE / 2, y: 190, age: 0, color: "#ff8f7a", size: 30 });
				if (!reducedMotion) shake.current = 0.25;
			}
			if (event.type === "missed") words.current.push({ text: "Missed it!", x: STAGE / 2, y: 190, age: 0, color: "#c9d2ea", size: 30 });
		}
		for (const spark of sparks.current) {
			spark.age += 1 / 60;
			spark.x += spark.vx / 60;
			spark.y += spark.vy / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.age < spark.life);
		for (const word of words.current) word.age += 1 / 60;
		words.current = words.current.filter((word) => word.age < 1);
		shake.current = Math.max(0, shake.current - 1 / 60);
		onTime(Math.max(0, WATCH_SECONDS - run.t));
		ticks.current++;
		const canvas = canvasRef.current;
		const open = watchOpen(run);
		const key = open >= 0 ? `1|${open}` : "0|-";
		if (canvas && (ticks.current % 6 === 0 || key !== lastLit.current)) {
			lastLit.current = key;
			canvas.dataset.watch = `${run.t.toFixed(2)}|${key}`;
		}
		const result = watchResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const lit = watchLit(run);
			const decoy = run.phase === "playing" ? watchDecoyAt(run) : null;
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 90) * shake.current * 10, Math.cos(time * 75) * shake.current * 5);

			// The night sky over the hills, stars, a thin moon.
			const sky = context.createLinearGradient(0, 0, 0, HORIZON);
			sky.addColorStop(0, "#070a1f");
			sky.addColorStop(1, "#1c2550");
			context.fillStyle = sky;
			context.fillRect(-20, -20, STAGE + 40, HORIZON + 20);
			for (let i = 0; i < 60; i++) {
				const twinkle = reducedMotion ? 0.7 : 0.4 + 0.6 * Math.abs(Math.sin(time * (0.6 + hash(i) * 2) + i));
				context.fillStyle = `rgba(255,255,240,${twinkle * 0.8})`;
				context.fillRect(hash(i) * STAGE, hash(i + 99) * (HORIZON - 30), 1.6, 1.6);
			}
			context.fillStyle = "#f2ecd0";
			context.beginPath();
			context.arc(70, 60, 13, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#0b1029";
			context.beginPath();
			context.arc(76, 56, 12, 0, Math.PI * 2);
			context.fill();

			// East and west, so the sign's path is plain.
			context.fillStyle = "rgba(200,210,255,.55)";
			context.font = "800 11px system-ui, sans-serif";
			context.textAlign = "right";
			context.fillText("EAST", STAGE - 8, HORIZON - 8);
			context.textAlign = "left";
			context.fillText("WEST", 8, HORIZON - 8);

			// Heat-lightning: a dull glow behind the far hills, no bolt.
			if (decoy?.kind === "heat") {
				const k = Math.sin(((run.t - decoy.at) / (decoy.until - decoy.at)) * Math.PI);
				const glow = context.createRadialGradient(decoy.x * STAGE, HORIZON - 10, 4, decoy.x * STAGE, HORIZON - 10, 120);
				glow.addColorStop(0, `rgba(255,200,170,${0.55 * k})`);
				glow.addColorStop(1, "rgba(255,200,170,0)");
				context.fillStyle = glow;
				context.fillRect(0, 100, STAGE, HORIZON - 100);
			}

			// The lightning: from the east across to the west, and the whole sky lit.
			if (lit) {
				const reach = Math.min(1, lit.age / 0.12);
				const fade = lit.age < 0.12 ? 1 : Math.max(0, 1 - (lit.age - 0.12) / 0.45);
				context.fillStyle = `rgba(220,230,255,${0.55 * fade})`;
				context.fillRect(-20, -20, STAGE + 40, STAGE + 40);
				const { points, forks } = bolts.current[lit.index];
				const count = Math.max(2, Math.ceil(points.length * reach));
				const line = (path: { x: number; y: number }[]) => {
					context.beginPath();
					path.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
					context.stroke();
				};
				for (const [width, color] of [
					[12, `rgba(150,180,255,${0.45 * fade})`],
					[4, `rgba(255,255,255,${fade})`],
				] as const) {
					context.strokeStyle = color;
					context.lineWidth = width;
					context.lineJoin = "round";
					line(points.slice(0, count));
					context.lineWidth = width / 2;
					for (const fork of forks) if (fork.at < count) line(fork.fork);
				}
			}

			// The hills and the house.
			context.fillStyle = "#121733";
			context.beginPath();
			context.moveTo(-10, HORIZON);
			for (let x = -10; x <= STAGE + 10; x += 20) context.lineTo(x, HORIZON - 14 - 12 * Math.sin(x / 50) - 8 * Math.cos(x / 23));
			context.lineTo(STAGE + 10, STAGE);
			context.lineTo(-10, STAGE);
			context.fill();
			context.fillStyle = lit ? "#4a4f6e" : "#262a48";
			context.fillRect(150, 268, 170, 132);
			context.fillStyle = lit ? "#5d6385" : "#30355a";
			context.fillRect(142, 262, 186, 10);
			context.fillRect(150, 236, 40, 30);
			context.fillStyle = "#181b33";
			context.fillRect(222, 330, 30, 70);
			// The window lamp: warm, flickering brighter when it is the decoy.
			const lampFlare = decoy?.kind === "lamp" ? 0.5 + 0.5 * Math.abs(Math.sin((run.t - decoy.at) * 40)) : 0;
			const lampGlow = 0.55 + (reducedMotion ? 0 : 0.08 * Math.sin(time * 7)) + lampFlare * 0.45;
			context.fillStyle = `rgba(255,190,90,${lampGlow})`;
			context.fillRect(270, 296, 26, 22);
			if (lampFlare > 0) {
				const glow = context.createRadialGradient(283, 307, 4, 283, 307, 70);
				glow.addColorStop(0, `rgba(255,190,90,${0.5 * lampFlare})`);
				glow.addColorStop(1, "rgba(255,190,90,0)");
				context.fillStyle = glow;
				context.fillRect(200, 230, 170, 160);
			}
			// The watchman on the roof, a still figure looking east.
			context.fillStyle = "#0c0f22";
			context.beginPath();
			context.moveTo(214, 262);
			context.lineTo(220, 222);
			context.lineTo(236, 222);
			context.lineTo(242, 262);
			context.closePath();
			context.fill();
			context.beginPath();
			context.arc(228, 212, 9, 0, Math.PI * 2);
			context.fill();
			// A torch passing along the road below.
			if (decoy?.kind === "torch") {
				const k = (run.t - decoy.at) / (decoy.until - decoy.at);
				const x = 20 + k * 120;
				const glow = context.createRadialGradient(x, 352, 2, x, 352, 46);
				glow.addColorStop(0, "rgba(255,170,70,.75)");
				glow.addColorStop(1, "rgba(255,170,70,0)");
				context.fillStyle = glow;
				context.fillRect(x - 50, 300, 100, 100);
				context.fillStyle = "#ffd27a";
				context.beginPath();
				context.arc(x, 352, 4 + (reducedMotion ? 0 : Math.sin(time * 30)), 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#0c0f22";
				context.fillRect(x - 6, 358, 10, 30);
			}

			for (const spark of sparks.current) {
				context.globalAlpha = 1 - spark.age / spark.life;
				context.fillStyle = "#ffe680";
				context.fillRect(spark.x, spark.y, 3, 3);
			}
			context.globalAlpha = 1;
			context.textAlign = "center";
			for (const word of words.current) {
				context.globalAlpha = Math.min(1, 2 * (1 - word.age));
				context.font = `900 ${word.size}px system-ui, sans-serif`;
				context.lineWidth = 5;
				context.strokeStyle = "rgba(5,8,25,.75)";
				context.strokeText(word.text, word.x, word.y - word.age * 20);
				context.fillStyle = word.color;
				context.fillText(word.text, word.x, word.y - word.age * 20);
			}
			context.globalAlpha = 1;
			context.restore();

			// An early tap: the edges flash red.
			if (run.t - early.current < 0.3) {
				context.strokeStyle = `rgba(255,80,60,${1 - (run.t - early.current) / 0.3})`;
				context.lineWidth = 14;
				context.strokeRect(0, 0, STAGE, STAGE);
			}

			// The flashes so far, and the early taps allowed.
			context.fillStyle = "rgba(5,8,25,.6)";
			context.beginPath();
			context.roundRect(10, 10, STAGE - 20, 40, 12);
			context.fill();
			context.font = "800 13px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillStyle = "#fff";
			context.fillText("Lightning", 20, 35);
			run.flashes.forEach((flash, index) => {
				const x = 104 + index * 30;
				context.fillStyle = flash.caught !== null ? "#ffe680" : flash.missed ? "#5b627f" : "rgba(255,255,255,.22)";
				context.beginPath();
				context.moveTo(x + 4, 18);
				context.lineTo(x - 5, 31);
				context.lineTo(x + 1, 31);
				context.lineTo(x - 3, 42);
				context.lineTo(x + 7, 27);
				context.lineTo(x + 1, 27);
				context.closePath();
				context.fill();
			});
			context.fillStyle = "#fff";
			context.fillText("Too soon", 236, 35);
			for (let i = 0; i <= WATCH_MAX_EARLY; i++) {
				context.fillStyle = i < run.early ? "#ff7a66" : i === WATCH_MAX_EARLY ? "rgba(255,122,102,.3)" : "rgba(255,255,255,.3)";
				context.beginPath();
				context.arc(312 + i * 24, 31, 7, 0, Math.PI * 2);
				context.fill();
			}

			// The first seconds: what the sign is, plainly.
			if (run.t < 1.4 && run.phase === "playing") {
				context.globalAlpha = run.t < 1 ? 1 : 1 - (run.t - 1) / 0.4;
				context.fillStyle = "rgba(5,8,25,.78)";
				context.beginPath();
				context.roundRect(60, 82, 280, 58, 12);
				context.fill();
				context.fillStyle = "#ffe680";
				context.font = "900 16px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Tap when lightning crosses", STAGE / 2, 106);
				context.fillText("the sky, east to west. Not before!", STAGE / 2, 126);
				context.globalAlpha = 1;
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (!paused) taps.current += 1;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A night watch over a house. Tap, or press Space, the instant lightning streaks across the sky from east to west; lamps, torches and glows on the horizon are not the sign."
		/>
	);
}
