"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	FRUIT_CORRUPT_LIMIT,
	FRUIT_GOAL,
	FRUIT_SECONDS,
	FRUIT_SPOTS,
	fruitLook,
	fruitResult,
	newFruit,
	stepFruit,
	type Fruit,
	type FruitEvent,
	type FruitState,
} from "@/lib/beta/games/known-by-his-fruit-rules";

/**
 * Known by His Fruit (LC-17851), Matthew 12:33-35: a good tree in a bright
 * midday orchard. Fruit buds green, ripens bright red (pick it: tap or
 * click), and if it is left it turns corrupt: dark, bruised and wormy. Never
 * pick the corrupt.
 */

const BASKET = { x: 334, y: 362 };
const GROUND_Y = 372;

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	color: string;
	size: number;
}

function drawRipe(context: CanvasRenderingContext2D, x: number, y: number, r: number, turning: number) {
	context.fillStyle = "#e0262f";
	context.beginPath();
	context.arc(x - r * 0.3, y, r * 0.82, 0, Math.PI * 2);
	context.arc(x + r * 0.3, y, r * 0.82, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#ff6a5a";
	context.beginPath();
	context.ellipse(x - r * 0.35, y - r * 0.35, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
	context.fill();
	if (turning > 0) {
		// Browning at the edges: it is about to turn.
		context.fillStyle = `rgba(90,40,20,${0.65 * turning})`;
		for (const [dx, dy, s] of [
			[0.4, 0.3, 0.3],
			[-0.3, 0.45, 0.22],
			[0.55, -0.2, 0.2],
		]) {
			context.beginPath();
			context.arc(x + dx * r, y + dy * r, s * r, 0, Math.PI * 2);
			context.fill();
		}
	}
	context.strokeStyle = "#5a3a1a";
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(x, y - r * 0.7);
	context.lineTo(x + 1, y - r * 1.1);
	context.stroke();
	context.fillStyle = "#3f9a3a";
	context.beginPath();
	context.ellipse(x + r * 0.45, y - r * 1.0, r * 0.42, r * 0.18, -0.5, 0, Math.PI * 2);
	context.fill();
}

function drawCorrupt(context: CanvasRenderingContext2D, x: number, y: number, r: number, time: number, id: number) {
	// Shrivelled, dark and bruised, a worm in it and flies about it.
	context.fillStyle = "#3b2232";
	context.beginPath();
	for (let i = 0; i <= 10; i++) {
		const angle = (i / 10) * Math.PI * 2;
		const wobble = r * (0.82 + ((i * 37 + id) % 5) * 0.05);
		const px = x + Math.cos(angle) * wobble;
		const py = y + Math.sin(angle) * wobble * 0.92 + 1;
		if (i === 0) context.moveTo(px, py);
		else context.lineTo(px, py);
	}
	context.fill();
	context.fillStyle = "#5e3a2a";
	context.beginPath();
	context.arc(x - r * 0.3, y + r * 0.1, r * 0.3, 0, Math.PI * 2);
	context.arc(x + r * 0.35, y - r * 0.25, r * 0.2, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#1c0f18";
	context.beginPath();
	context.arc(x + r * 0.25, y + r * 0.2, r * 0.22, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = "#e7a8b0";
	context.lineWidth = 3;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(x + r * 0.25, y + r * 0.2);
	context.quadraticCurveTo(x + r * 0.9, y + r * 0.1 + Math.sin(time * 6 + id) * 3, x + r * 1.1, y - r * 0.4);
	context.stroke();
	context.lineCap = "butt";
	context.fillStyle = "#1a1a1a";
	for (let i = 0; i < 2; i++) {
		const angle = time * (5 + i) + id + i * 2;
		context.beginPath();
		context.arc(x + Math.cos(angle) * r * 1.5, y - r * 0.6 + Math.sin(angle * 1.3) * r * 0.7, 1.6, 0, Math.PI * 2);
		context.fill();
	}
}

export default function KnownByHisFruit({ seed, paused, muted, reducedMotion, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<FruitState>(newFruit(seed));
	const taps = useRef<{ x: number; y: number }[]>([]);
	const sparks = useRef<Spark[]>([]);
	const flashes = useRef<{ x: number; y: number; at: number; good: boolean; label: string }[]>([]);
	const misses = useRef<{ x: number; y: number; at: number }[]>([]);
	const shake = useRef(0);
	const lastData = useRef(-1);
	const ended = useRef(false);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, colors: string[], count: number, speed: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.6);
			sparks.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 30, life: 0, max: 0.45 + Math.random() * 0.4, color: colors[i % colors.length], size: 2 + Math.random() * 2.5 });
		}
	}, []);

	const react = useCallback(
		(event: FruitEvent, run: FruitState, tap: { x: number; y: number } | null) => {
			const play = synth.current;
			if (event.type === "pick" && tap) {
				if (event.good) {
					burst(tap.x, tap.y, ["#ff6a5a", "#ffd666", "#ffffff"], 12, 80);
					play?.tone(700 + Math.min(run.good, 24) * 18, 0.12, { type: "triangle", volume: 0.14 });
					play?.noise(0.05, { volume: 0.1, filter: 4000, type: "highpass" });
					flashes.current.push({ x: tap.x, y: tap.y - 22, at: run.t, good: true, label: "+1" });
				} else {
					burst(tap.x, tap.y, ["#3b2232", "#5e3a2a", "#ff5a4a"], 16, 90);
					play?.noise(0.3, { volume: 0.25, filter: 400 });
					play?.tone(130, 0.35, { type: "square", volume: 0.12, to: 70 });
					flashes.current.push({ x: tap.x, y: tap.y - 24, at: run.t, good: false, label: "Corrupt!" });
					shake.current = run.t + 0.35;
				}
			}
			if (event.type === "unripe" && tap) {
				play?.tone(340, 0.06, { type: "sine", volume: 0.07 });
				flashes.current.push({ x: tap.x, y: tap.y - 20, at: run.t, good: false, label: "Not yet" });
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1, { type: "triangle", volume: 0.13, delay: index * 0.09 }));
			if (event.type === "lost") play?.tone(220, 0.8, { type: "sine", volume: 0.18, to: 110 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		for (const spark of sparks.current) {
			spark.life += 1 / 60;
			spark.x += spark.vx / 60;
			spark.y += spark.vy / 60;
			spark.vy += 220 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.life < spark.max);
		if (run.phase !== "playing") return;
		const tap = taps.current.shift() ?? null;
		const events: FruitEvent[] = [];
		stepFruit(run, { tap }, events);
		if (tap && !events.some((event) => event.type === "pick" || event.type === "unripe")) misses.current.push({ ...tap, at: run.t });
		for (const event of events) react(event, run, tap);
		onTime(Math.max(0, FRUIT_SECONDS - run.t));
		const tick = Math.floor(run.t * 10);
		if (tick !== lastData.current && canvasRef.current) {
			lastData.current = tick;
			canvasRef.current.dataset.ripe = run.fruits
				.filter((fruit) => fruitLook(fruit, run.t) === "ripe" && fruit.corruptAt - run.t > 0.2)
				.sort((a, b) => a.corruptAt - b.corruptAt)
				.map((fruit) => `${FRUIT_SPOTS[fruit.spot].x},${FRUIT_SPOTS[fruit.spot].y}`)
				.join(";");
			canvasRef.current.dataset.score = `${run.good}/${run.corrupt}`;
		}
		const result = fruitResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			context.save();
			if (!reducedMotion && run.t < shake.current) context.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);

			// A bright midday orchard.
			const sky = context.createLinearGradient(0, 0, 0, 300);
			sky.addColorStop(0, "#7cc6f2");
			sky.addColorStop(1, "#e8f6ff");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 320);
			context.fillStyle = "#fff6c4";
			context.beginPath();
			context.arc(356, 74, 20, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#9fd67a";
			context.beginPath();
			context.moveTo(-10, 300);
			context.quadraticCurveTo(120, 262, 230, 290);
			context.quadraticCurveTo(320, 270, 410, 292);
			context.lineTo(410, 410);
			context.lineTo(-10, 410);
			context.fill();
			context.fillStyle = "#7fbf5c";
			context.fillRect(-10, GROUND_Y - 6, STAGE + 20, 50);

			// The good tree: trunk, boughs and a full crown.
			context.fillStyle = "#7a4e2a";
			context.beginPath();
			context.moveTo(178, GROUND_Y);
			context.quadraticCurveTo(190, 300, 182, 250);
			context.lineTo(218, 250);
			context.quadraticCurveTo(210, 300, 224, GROUND_Y);
			context.closePath();
			context.fill();
			context.strokeStyle = "#7a4e2a";
			context.lineWidth = 9;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(196, 262);
			context.lineTo(130, 200);
			context.moveTo(204, 262);
			context.lineTo(278, 196);
			context.moveTo(200, 256);
			context.lineTo(204, 150);
			context.stroke();
			context.lineCap = "butt";
			const crown = [
				[200, 150, 120, 88],
				[110, 170, 62, 56],
				[290, 172, 64, 58],
				[150, 112, 66, 50],
				[252, 112, 66, 50],
				[200, 220, 112, 42],
			];
			context.fillStyle = "#2f7a3a";
			for (const [cx, cy, rx, ry] of crown) {
				context.beginPath();
				context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
				context.fill();
			}
			context.fillStyle = "#3f9446";
			for (const [cx, cy, rx, ry] of crown) {
				context.beginPath();
				context.ellipse(cx - rx * 0.12, cy - ry * 0.16, rx * 0.8, ry * 0.7, 0, 0, Math.PI * 2);
				context.fill();
			}

			// The basket.
			context.fillStyle = "#b07a3a";
			context.beginPath();
			context.moveTo(BASKET.x - 40, BASKET.y - 18);
			context.lineTo(BASKET.x + 40, BASKET.y - 18);
			context.lineTo(BASKET.x + 30, BASKET.y + 20);
			context.lineTo(BASKET.x - 30, BASKET.y + 20);
			context.closePath();
			context.fill();
			context.strokeStyle = "#8a5a26";
			context.lineWidth = 2;
			for (let i = 0; i < 3; i++) {
				context.beginPath();
				context.moveTo(BASKET.x - 38 + i * 2, BASKET.y - 8 + i * 10);
				context.lineTo(BASKET.x + 38 - i * 2, BASKET.y - 8 + i * 10);
				context.stroke();
			}
			const shown = Math.min(run.good, 9);
			for (let i = 0; i < shown; i++) drawRipe(context, BASKET.x - 26 + (i % 5) * 13, BASKET.y - 20 - Math.floor(i / 5) * 9, 7, 0);
			context.fillStyle = "#fff";
			context.font = "900 15px system-ui, sans-serif";
			context.textAlign = "center";
			context.fillText(`${run.good}`, BASKET.x, BASKET.y + 12);

			// The fruit.
			let hintFruit: Fruit | null = null;
			for (const fruit of run.fruits) {
				const spot = FRUIT_SPOTS[fruit.spot];
				const look = fruitLook(fruit, run.t);
				if (look === "picked" && fruit.picked) {
					const age = Math.min(1, (run.t - fruit.picked.at) / 0.4);
					if (!fruit.picked.good || age >= 1) continue;
					drawRipe(context, spot.x + (BASKET.x - spot.x) * age, spot.y + (BASKET.y - 26 - spot.y) * age - Math.sin(age * Math.PI) * 50, 13 - age * 5, 0);
					continue;
				}
				if (look === "fallen") {
					const age = Math.min(1, (run.t - fruit.fallsAt) / 0.45);
					context.globalAlpha = Math.max(0, 1 - (run.t - fruit.fallsAt));
					drawCorrupt(context, spot.x, spot.y + (GROUND_Y - 8 - spot.y) * age * age, 11, time, fruit.id);
					context.globalAlpha = 1;
					continue;
				}
				if (look === "bud") {
					const grow = Math.min(1, (run.t - fruit.born) / (fruit.ripeAt - fruit.born));
					context.fillStyle = "#9ccc4a";
					context.strokeStyle = "#5f8f2a";
					context.lineWidth = 1.5;
					context.beginPath();
					context.arc(spot.x, spot.y, 4 + grow * 5, 0, Math.PI * 2);
					context.fill();
					context.stroke();
					continue;
				}
				if (look === "ripe") {
					const left = fruit.corruptAt - run.t;
					const turning = left < 0.35 ? 1 - left / 0.35 : 0;
					const pulse = 0.5 + 0.5 * Math.sin(time * 9 + fruit.id);
					context.strokeStyle = turning > 0 ? "rgba(255,140,60,.9)" : `rgba(255,236,140,${0.55 + pulse * 0.45})`;
					context.lineWidth = 3;
					context.beginPath();
					context.arc(spot.x, spot.y, 19 + pulse * 2, 0, Math.PI * 2);
					context.stroke();
					const pop = Math.min(1, (run.t - fruit.ripeAt) / 0.12);
					drawRipe(context, spot.x, spot.y, 9 + pop * 5, turning);
					if (!hintFruit || fruit.ripeAt < hintFruit.ripeAt) hintFruit = fruit;
					continue;
				}
				drawCorrupt(context, spot.x, spot.y, 13, time, fruit.id);
			}

			// The first seconds: a ring and a hand on the first ripe fruit.
			if (run.t < 2.6 && hintFruit) {
				const spot = FRUIT_SPOTS[hintFruit.spot];
				const pulse = (time * 1.6) % 1;
				context.strokeStyle = `rgba(255,255,255,${1 - pulse})`;
				context.lineWidth = 4;
				context.beginPath();
				context.arc(spot.x, spot.y, 20 + pulse * 26, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "rgba(20,40,20,.75)";
				context.beginPath();
				context.roundRect(spot.x - 34, spot.y + 26, 68, 24, 12);
				context.fill();
				context.fillStyle = "#fff";
				context.font = "900 14px system-ui, sans-serif";
				context.fillText("Tap!", spot.x, spot.y + 43);
			}
			if (run.t < 2.6) {
				context.fillStyle = "rgba(20,40,20,.7)";
				context.beginPath();
				context.roundRect(30, 318, 236, 46, 14);
				context.fill();
				drawRipe(context, 54, 341, 10, 0);
				drawCorrupt(context, 162, 341, 10, time, 1);
				context.font = "900 13px system-ui, sans-serif";
				context.textAlign = "left";
				context.fillStyle = "#c8f7b0";
				context.fillText("Pick", 70, 346);
				context.fillStyle = "#ffb0a6";
				context.fillText("Never", 178, 346);
				context.textAlign = "center";
			}

			misses.current = misses.current.filter((miss) => run.t - miss.at < 0.3);
			for (const miss of misses.current) {
				context.strokeStyle = `rgba(255,255,255,${1 - (run.t - miss.at) / 0.3})`;
				context.lineWidth = 2;
				context.beginPath();
				context.arc(miss.x, miss.y, 8 + (run.t - miss.at) * 40, 0, Math.PI * 2);
				context.stroke();
			}
			for (const spark of sparks.current) {
				context.globalAlpha = Math.max(0, 1 - spark.life / spark.max);
				context.fillStyle = spark.color;
				context.beginPath();
				context.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			flashes.current = flashes.current.filter((flash) => run.t - flash.at < 0.7);
			for (const flash of flashes.current) {
				const age = (run.t - flash.at) / 0.7;
				context.globalAlpha = 1 - age;
				context.font = "900 17px system-ui, sans-serif";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(20,30,20,.75)";
				context.fillStyle = flash.good ? "#fff27a" : "#ff6b5e";
				context.strokeText(flash.label, flash.x, flash.y - age * 22);
				context.fillText(flash.label, flash.x, flash.y - age * 22);
			}
			context.globalAlpha = 1;

			// The basket's goal and the corrupt picks allowed.
			context.fillStyle = "rgba(20,40,20,.62)";
			context.beginPath();
			context.roundRect(8, 8, 384, 32, 16);
			context.fill();
			context.fillStyle = "rgba(255,255,255,.18)";
			context.beginPath();
			context.roundRect(18, 17, 220, 14, 7);
			context.fill();
			context.fillStyle = run.good >= FRUIT_GOAL ? "#ffd666" : "#ff6a5a";
			context.beginPath();
			context.roundRect(18, 17, Math.max(14, (220 * Math.min(run.good, FRUIT_GOAL)) / FRUIT_GOAL), 14, 7);
			context.fill();
			context.fillStyle = "#fff";
			context.font = "900 13px system-ui, sans-serif";
			context.fillText(`${run.good} / ${FRUIT_GOAL}`, 128, 29);
			context.textAlign = "right";
			context.font = "800 11px system-ui, sans-serif";
			context.fillText("corrupt", 318, 29);
			context.textAlign = "center";
			for (let i = 0; i < FRUIT_CORRUPT_LIMIT + 1; i++) {
				const x = 334 + i * 20;
				if (i < run.corrupt) {
					context.strokeStyle = "#ff6b5e";
					context.lineWidth = 3;
					context.beginPath();
					context.moveTo(x - 6, 18);
					context.lineTo(x + 6, 30);
					context.moveTo(x + 6, 18);
					context.lineTo(x - 6, 30);
					context.stroke();
				} else {
					context.strokeStyle = i === FRUIT_CORRUPT_LIMIT ? "rgba(255,107,94,.8)" : "rgba(255,255,255,.7)";
					context.lineWidth = 2;
					context.beginPath();
					context.arc(x, 24, 6, 0, Math.PI * 2);
					context.stroke();
				}
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,240,170,.2)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused || !canvasRef.current) return;
		taps.current.push(stagePoint(canvasRef.current, event));
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A good tree bears fruit. Tap or click each fruit while it is bright and ripe to put it in the basket. Never pick the dark, corrupt fruit."
		/>
	);
}
