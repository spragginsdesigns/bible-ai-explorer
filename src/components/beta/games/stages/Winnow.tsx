"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	WINNOW_MISTAKES,
	WINNOW_SECONDS,
	newWinnow,
	stepWinnow,
	winnowFront,
	winnowResult,
	type WinnowEvent,
	type WinnowGrain,
	type WinnowKind,
	type WinnowSide,
	type WinnowState,
} from "@/lib/beta/games/winnow-rules";

/**
 * Winnow the Floor (LC-17851), Matthew 3:11-17: a threshing floor by Jordan
 * at evening. The fan tosses grain up; the lowest grain in the air (ringed)
 * is the one to sort: wheat to the garner on the left (← or swipe left),
 * chaff to the fire on the right (→ or swipe right).
 */

const FLOOR_Y = 346;
const FAN = { x: 200, y: 362 };
const GARNER = { x: 58, y: 262 };
const FIRE = { x: 344, y: 300 };
const SWIPE = 26;

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

/** Where a grain is in the air at time t. */
function grainPoint(grain: WinnowGrain, t: number) {
	const u = Math.max(0, Math.min(1, (t - grain.born) / (grain.lands - grain.born)));
	return { x: FAN.x + grain.drift * 95 * u, y: FAN.y + (FLOOR_Y - FAN.y) * u - 1080 * u * (1 - u), u };
}

function drawWheat(context: CanvasRenderingContext2D, x: number, y: number, scale: number, angle: number) {
	context.save();
	context.translate(x, y);
	context.rotate(angle);
	context.scale(scale, scale);
	// A golden ear: a stalk and plump kernels in pairs.
	context.strokeStyle = "#a86a12";
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(0, 14);
	context.lineTo(0, -12);
	context.stroke();
	for (let i = 0; i < 4; i++) {
		const ky = 8 - i * 6.2;
		for (const side of [-1, 1]) {
			context.fillStyle = "#e9a822";
			context.beginPath();
			context.ellipse(side * 4.2, ky, 4.4, 3.2, side * 0.6, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#ffe08a";
			context.beginPath();
			context.ellipse(side * 4.2 - 1, ky - 1, 1.6, 1.1, 0, 0, Math.PI * 2);
			context.fill();
		}
	}
	context.fillStyle = "#e9a822";
	context.beginPath();
	context.ellipse(0, -15, 3.2, 4.2, 0, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawChaff(context: CanvasRenderingContext2D, x: number, y: number, scale: number, angle: number) {
	context.save();
	context.translate(x, y);
	context.rotate(angle);
	context.scale(scale, scale);
	// A pale, papery husk: thin, curled, nearly see-through.
	context.fillStyle = "rgba(244,238,220,.82)";
	context.strokeStyle = "rgba(170,160,135,.9)";
	context.lineWidth = 1.2;
	context.beginPath();
	context.moveTo(-13, 3);
	context.quadraticCurveTo(-2, -12, 13, -4);
	context.quadraticCurveTo(2, -3, -13, 3);
	context.closePath();
	context.fill();
	context.stroke();
	context.beginPath();
	context.moveTo(-9, 6);
	context.quadraticCurveTo(1, -2, 11, 3);
	context.quadraticCurveTo(0, 4, -9, 6);
	context.fill();
	context.stroke();
	context.strokeStyle = "rgba(160,150,125,.7)";
	context.beginPath();
	context.moveTo(-6, -1);
	context.lineTo(5, -5);
	context.moveTo(-4, 4);
	context.lineTo(6, 1);
	context.stroke();
	context.restore();
}

function drawGrain(context: CanvasRenderingContext2D, kind: WinnowKind, x: number, y: number, scale: number, time: number, id: number) {
	if (kind === "wheat") drawWheat(context, x, y, scale, Math.sin(time * 3 + id) * 0.25);
	else drawChaff(context, x, y, scale, time * 5 + id);
}

export default function Winnow({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WinnowState>(newWinnow(seed));
	const swipes = useRef<WinnowSide[]>([]);
	const drag = useRef<{ x: number; y: number; done: boolean } | null>(null);
	const sparks = useRef<Spark[]>([]);
	const flashes = useRef<{ x: number; y: number; at: number; good: boolean; label: string }[]>([]);
	const fanAt = useRef(-1);
	const shake = useRef(0);
	const lastData = useRef(-1);
	const ended = useRef(false);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, colors: string[], count: number, speed: number, up = 0) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.6);
			sparks.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - up, life: 0, max: 0.5 + Math.random() * 0.4, color: colors[i % colors.length], size: 1.5 + Math.random() * 2.5 });
		}
	}, []);

	const react = useCallback(
		(event: WinnowEvent, run: WinnowState) => {
			const play = synth.current;
			if (event.type === "toss") {
				fanAt.current = run.t;
				play?.noise(0.12, { volume: 0.12, filter: 2400, type: "bandpass" });
			}
			if (event.type === "sorted") {
				const target = event.side === "left" ? GARNER : FIRE;
				if (event.right) {
					if (event.kind === "wheat") {
						burst(target.x, target.y - 10, ["#ffd66b", "#f2b63a", "#fff3c4"], 14, 70, 20);
						play?.tone(660, 0.12, { type: "triangle", volume: 0.14 });
						play?.tone(990, 0.16, { type: "triangle", volume: 0.1, delay: 0.06 });
					} else {
						burst(target.x, target.y - 20, ["#ff8a2a", "#ffd166", "#ff5a1f"], 18, 90, 50);
						play?.noise(0.25, { volume: 0.2, filter: 900, type: "lowpass" });
						play?.tone(520, 0.1, { type: "triangle", volume: 0.1 });
					}
					flashes.current.push({ x: target.x, y: target.y - 52, at: run.t, good: true, label: event.kind === "wheat" ? "Gathered!" : "Burned!" });
				} else {
					burst(target.x, target.y - 10, ["#ff4d4d", "#ffffff"], 10, 60);
					play?.tone(150, 0.3, { type: "square", volume: 0.12, to: 90 });
					flashes.current.push({ x: target.x, y: target.y - 52, at: run.t, good: false, label: event.kind === "wheat" ? "That was wheat!" : "That was chaff!" });
					shake.current = run.t + 0.3;
				}
			}
			if (event.type === "fell") {
				const grain = run.grains.find((item) => item.fell !== null && Math.abs(item.fell - run.t) < 1e-6);
				const x = grain ? FAN.x + grain.drift * 95 : FAN.x;
				burst(x, FLOOR_Y, ["#c9a77a", "#a8835a", "#ff4d4d"], 12, 50, 10);
				play?.noise(0.2, { volume: 0.22, filter: 500 });
				play?.tone(140, 0.25, { type: "square", volume: 0.1, to: 80 });
				flashes.current.push({ x, y: FLOOR_Y - 34, at: run.t, good: false, label: "Fell!" });
				shake.current = run.t + 0.3;
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 0.9, { type: "triangle", volume: 0.14, delay: index * 0.09 }));
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
			spark.vy += 160 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.life < spark.max);
		if (run.phase !== "playing") return;
		let sort: WinnowSide | null = null;
		for (const key of takePresses(keys)) {
			if (key === "arrowleft") sort = sort ?? "left";
			if (key === "arrowright") sort = sort ?? "right";
		}
		if (!sort && swipes.current.length) sort = swipes.current.shift() ?? null;
		const events: WinnowEvent[] = [];
		stepWinnow(run, { sort }, events);
		for (const event of events) react(event, run);
		onTime(Math.max(0, WINNOW_SECONDS - run.t));
		const tick = Math.floor(run.t * 10);
		if (tick !== lastData.current && canvasRef.current) {
			lastData.current = tick;
			const front = winnowFront(run);
			canvasRef.current.dataset.front = front ? front.kind : "";
			canvasRef.current.dataset.score = `${run.right}/${run.mistakes}`;
		}
		const result = winnowResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			context.save();
			if (!reducedMotion && run.t < shake.current) context.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);

			// Evening over Jordan: sky, far hills, the river and its reeds.
			const sky = context.createLinearGradient(0, 0, 0, 200);
			sky.addColorStop(0, "#1f3a5a");
			sky.addColorStop(0.55, "#d98b4f");
			sky.addColorStop(1, "#f6c879");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 210);
			context.fillStyle = "#fff0c2";
			context.beginPath();
			context.arc(286, 150, 26, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#8a5a4a";
			context.beginPath();
			context.moveTo(-10, 170);
			context.quadraticCurveTo(80, 120, 170, 160);
			context.quadraticCurveTo(260, 130, 410, 165);
			context.lineTo(410, 200);
			context.lineTo(-10, 200);
			context.fill();
			context.fillStyle = "#4f86a8";
			context.fillRect(-10, 182, STAGE + 20, 16);
			context.fillStyle = "rgba(255,240,200,.35)";
			for (let i = 0; i < 9; i++) context.fillRect(((i * 53 + time * 12) % 440) - 20, 188, 18, 2);
			context.fillStyle = "#c19a63";
			context.fillRect(-10, 198, STAGE + 20, 220);

			// The threshing floor: a ring of beaten earth and stones.
			context.fillStyle = "#a9814f";
			context.beginPath();
			context.ellipse(200, 342, 182, 52, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#d4b07a";
			context.beginPath();
			context.ellipse(200, 338, 166, 42, 0, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = "rgba(120,86,50,.35)";
			context.lineWidth = 1;
			for (let r = 60; r < 170; r += 34) {
				context.beginPath();
				context.ellipse(200, 338, r, r * 0.25, 0, 0, Math.PI * 2);
				context.stroke();
			}

			// The garner on the left: a granary with a lit door.
			const garnerGlow = context.createRadialGradient(GARNER.x, GARNER.y, 6, GARNER.x, GARNER.y, 80);
			garnerGlow.addColorStop(0, "rgba(255,214,107,.55)");
			garnerGlow.addColorStop(1, "rgba(255,214,107,0)");
			context.fillStyle = garnerGlow;
			context.fillRect(GARNER.x - 80, GARNER.y - 80, 160, 160);
			context.fillStyle = "#b9875a";
			context.beginPath();
			context.moveTo(8, 330);
			context.lineTo(8, 222);
			context.quadraticCurveTo(58, 168, 108, 222);
			context.lineTo(108, 330);
			context.closePath();
			context.fill();
			context.strokeStyle = "#7d5634";
			context.lineWidth = 3;
			context.stroke();
			context.fillStyle = "#3a2414";
			context.beginPath();
			context.moveTo(38, 330);
			context.lineTo(38, 262);
			context.quadraticCurveTo(58, 238, 78, 262);
			context.lineTo(78, 330);
			context.fill();
			context.fillStyle = "#f2b63a";
			context.beginPath();
			context.ellipse(58, 318, 18, 9, 0, Math.PI, 0);
			context.fill();

			// The fire on the right.
			context.fillStyle = "#5b4636";
			context.beginPath();
			context.ellipse(FIRE.x, FIRE.y + 30, 46, 13, 0, 0, Math.PI * 2);
			context.fill();
			const flicker = reducedMotion ? 0 : Math.sin(time * 13) * 4 + Math.sin(time * 7.3) * 3;
			const fireGlow = context.createRadialGradient(FIRE.x, FIRE.y, 6, FIRE.x, FIRE.y, 90);
			fireGlow.addColorStop(0, "rgba(255,120,40,.6)");
			fireGlow.addColorStop(1, "rgba(255,120,40,0)");
			context.fillStyle = fireGlow;
			context.fillRect(FIRE.x - 90, FIRE.y - 90, 180, 180);
			const flame = (color: string, w: number, h: number) => {
				context.fillStyle = color;
				context.beginPath();
				context.moveTo(FIRE.x - w, FIRE.y + 30);
				context.quadraticCurveTo(FIRE.x - w * 0.9, FIRE.y - h * 0.4, FIRE.x + flicker * 0.5, FIRE.y + 30 - h - flicker);
				context.quadraticCurveTo(FIRE.x + w * 0.9, FIRE.y - h * 0.4, FIRE.x + w, FIRE.y + 30);
				context.fill();
			};
			flame("#e2401c", 40, 92);
			flame("#ff8a2a", 30, 72);
			flame("#ffd166", 16, 44);

			// Labels and arrows: where each kind goes, pulsing at the start.
			const hint = run.t < 2.2 ? 0.5 + 0.5 * Math.sin(time * 8) : 0;
			context.textAlign = "center";
			context.font = "900 15px system-ui, sans-serif";
			for (const side of [-1, 1] as const) {
				const x = side < 0 ? GARNER.x : FIRE.x;
				const y = 70;
				context.fillStyle = side < 0 ? "rgba(46,30,10,.8)" : "rgba(60,16,8,.8)";
				context.strokeStyle = `rgba(255,214,107,${0.55 + hint * 0.45})`;
				context.lineWidth = 2 + hint * 2;
				context.beginPath();
				context.roundRect(x - 52, y - 34, 104, 70, 14);
				context.fill();
				context.stroke();
				context.fillStyle = "#ffe7a8";
				context.font = "800 11px system-ui, sans-serif";
				context.fillText(side < 0 ? "to the garner" : "to the fire", x, y - 18);
				if (side < 0) drawWheat(context, x - 28, y + 12, 0.85, 0);
				else drawChaff(context, x + 28, y + 12, 1, 0.3);
				context.fillStyle = "#fff4d6";
				context.font = "900 22px system-ui, sans-serif";
				context.fillText(side < 0 ? "←" : "→", side < 0 ? x + 12 : x - 12, y + 8);
				context.font = "900 13px system-ui, sans-serif";
				context.fillText(side < 0 ? "WHEAT" : "CHAFF", side < 0 ? x + 12 : x - 12, y + 26);
			}
			if (hint > 0) {
				context.fillStyle = `rgba(255,244,214,${0.6 + hint * 0.4})`;
				context.font = "900 16px system-ui, sans-serif";
				context.fillText("Sort the ringed one", 200, 132);
			}

			// The fan, lifting as it tosses.
			const since = run.t - fanAt.current;
			const lift = since >= 0 && since < 0.25 ? Math.sin((since / 0.25) * Math.PI) : 0;
			context.save();
			context.translate(FAN.x, FAN.y + 40);
			context.rotate(-0.15 - lift * 0.35);
			// A winnowing fork: a long handle and broad wooden tines.
			context.fillStyle = "#7a5230";
			context.fillRect(-4, -14, 8, 70);
			context.fillStyle = "#c8a46a";
			context.strokeStyle = "#6b4526";
			context.lineWidth = 2;
			context.beginPath();
			context.roundRect(-28, -22, 56, 10, 4);
			context.fill();
			context.stroke();
			for (let i = -2; i <= 2; i++) {
				context.beginPath();
				context.roundRect(i * 11 - 3.5, -52, 7, 32, 3);
				context.fill();
				context.stroke();
			}
			context.restore();

			// The grain: sorted grain flies to its place, fallen grain lies on the floor.
			const front = winnowFront(run);
			for (const grain of run.grains) {
				if (grain.sorted) {
					const age = Math.min(1, (run.t - grain.sorted.at) / 0.32);
					if (age >= 1) continue;
					const from = grainPoint(grain, grain.sorted.at);
					const to = grain.sorted.side === "left" ? GARNER : FIRE;
					drawGrain(context, grain.kind, from.x + (to.x - from.x) * age, from.y + (to.y - from.y) * age - Math.sin(age * Math.PI) * 40, 1.3 - age * 0.6, time, grain.id);
					continue;
				}
				if (grain.fell !== null) {
					context.globalAlpha = Math.max(0, 1 - (run.t - grain.fell));
					drawGrain(context, grain.kind, FAN.x + grain.drift * 95, FLOOR_Y, 1.2, 0, grain.id);
					context.globalAlpha = 1;
					continue;
				}
				const point = grainPoint(grain, run.t);
				if (grain === front) {
					const pulse = 0.5 + 0.5 * Math.sin(time * 10);
					context.strokeStyle = point.u > 0.75 ? "#ff5a4a" : "#fff4d6";
					context.lineWidth = 3;
					context.beginPath();
					context.arc(point.x, point.y, 25 + pulse * 3, 0, Math.PI * 2);
					context.stroke();
					context.fillStyle = "rgba(255,244,214,.22)";
					context.fill();
				}
				drawGrain(context, grain.kind, point.x, point.y, grain === front ? 1.45 : 1.15, time, grain.id);
			}

			for (const spark of sparks.current) {
				context.globalAlpha = Math.max(0, 1 - spark.life / spark.max);
				context.fillStyle = spark.color;
				context.fillRect(spark.x - spark.size / 2, spark.y - spark.size / 2, spark.size, spark.size);
			}
			context.globalAlpha = 1;

			flashes.current = flashes.current.filter((flash) => run.t - flash.at < 0.8);
			for (const flash of flashes.current) {
				const age = (run.t - flash.at) / 0.8;
				context.globalAlpha = 1 - age;
				context.font = "900 16px system-ui, sans-serif";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(0,0,0,.6)";
				context.fillStyle = flash.good ? "#ffe08a" : "#ff6b5e";
				const x = Math.max(60, Math.min(STAGE - 60, flash.x));
				context.strokeText(flash.label, x, flash.y - age * 20);
				context.fillText(flash.label, x, flash.y - age * 20);
			}
			context.globalAlpha = 1;

			// Mistakes left, and the count gathered.
			context.fillStyle = "rgba(0,0,0,.45)";
			context.beginPath();
			context.roundRect(130, 8, 140, 30, 15);
			context.fill();
			for (let i = 0; i < WINNOW_MISTAKES; i++) {
				const x = 152 + i * 24;
				if (i < run.mistakes) {
					context.strokeStyle = "#ff5a4a";
					context.lineWidth = 3.5;
					context.beginPath();
					context.moveTo(x - 7, 16);
					context.lineTo(x + 7, 30);
					context.moveTo(x + 7, 16);
					context.lineTo(x - 7, 30);
					context.stroke();
				} else {
					context.fillStyle = "#ffd66b";
					context.beginPath();
					context.arc(x, 23, 7, 0, Math.PI * 2);
					context.fill();
				}
			}
			context.fillStyle = "#fff4d6";
			context.font = "900 15px system-ui, sans-serif";
			context.textAlign = "right";
			context.fillText(`${run.right}`, 258, 28);
			context.textAlign = "center";

			if (run.phase === "won") {
				context.fillStyle = "rgba(255,230,160,.2)";
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
		canvasRef.current.setPointerCapture?.(event.pointerId);
		const point = stagePoint(canvasRef.current, event);
		drag.current = { x: point.x, y: point.y, done: false };
	};
	const swipe = (event: ReactPointerEvent<HTMLCanvasElement>, ending: boolean) => {
		const start = drag.current;
		if (!start || start.done || !canvasRef.current || paused) return;
		const point = stagePoint(canvasRef.current, event);
		const dx = point.x - start.x;
		const dy = point.y - start.y;
		if (Math.abs(dx) >= (ending ? SWIPE * 0.6 : SWIPE) && Math.abs(dx) > Math.abs(dy) * 0.8) {
			start.done = true;
			swipes.current.push(dx < 0 ? "left" : "right");
		}
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		swipe(event, true);
		drag.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={(event) => swipe(event, false)}
			onPointerUp={onPointerUp}
			onPointerCancel={() => (drag.current = null)}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A threshing floor. Grain is tossed up from the fan. Press left arrow or swipe left to send golden wheat to the garner; press right arrow or swipe right to send pale chaff to the fire."
		/>
	);
}
