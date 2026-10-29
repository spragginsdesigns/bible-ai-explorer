"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	FLOCK_GATE,
	FLOCK_MISTAKES,
	FLOCK_SECONDS,
	flockAlong,
	flockAtGate,
	flockResult,
	newFlock,
	stepFlock,
	type FlockAnimal,
	type FlockEvent,
	type FlockKind,
	type FlockSide,
	type FlockState,
} from "@/lib/beta/games/sheep-and-goats-rules";

/**
 * The Sheep and the Goats (LC-17851), Matthew 25:31-40: a green hillside in
 * royal morning light, the throne of glory shining far off. The flock comes
 * down the winding path to the shepherd's crook; at the glowing gate each
 * animal is parted: sheep to the right hand (→ or swipe right), goats to the
 * left (← or swipe left), as in v33.
 */

const SWIPE = 26;
const LEFT_FOLD = { x: 44, y: 318 };
const RIGHT_FOLD = { x: 356, y: 318 };
const P0 = { x: 200, y: 112 };
const P1 = { x: 96, y: 178 };
const P2 = { x: 312, y: 248 };
const P3 = { x: 200, y: 336 };

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

/** A point on the path, 0 at the throne's hill to 1 at the crook (past 1 runs on down off the picture). */
function pathPoint(u: number) {
	if (u > 1) return { x: P3.x, y: P3.y + (u - 1) * 260, dx: 0 };
	const v = 1 - u;
	const x = v * v * v * P0.x + 3 * v * v * u * P1.x + 3 * v * u * u * P2.x + u * u * u * P3.x;
	const y = v * v * v * P0.y + 3 * v * v * u * P1.y + 3 * v * u * u * P2.y + u * u * u * P3.y;
	const dx = 3 * v * v * (P1.x - P0.x) + 6 * v * u * (P2.x - P1.x) + 3 * u * u * (P3.x - P2.x);
	return { x, y, dx };
}

function drawSheep(context: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: number, step: number) {
	context.save();
	context.translate(x, y);
	context.scale(scale * facing, scale);
	// Legs.
	context.strokeStyle = "#2a2622";
	context.lineWidth = 3.2;
	context.lineCap = "round";
	for (const [lx, phase] of [
		[-10, 0],
		[-4, Math.PI],
		[6, Math.PI],
		[12, 0],
	] as const) {
		context.beginPath();
		context.moveTo(lx, 2);
		context.lineTo(lx + Math.sin(step + phase) * 2.5, 13);
		context.stroke();
	}
	// A round, white, woolly body: overlapping puffs.
	context.fillStyle = "#fbf8ef";
	context.strokeStyle = "#cfc8b6";
	context.lineWidth = 1.2;
	const puffs = [
		[-12, -6, 8],
		[-4, -11, 9],
		[6, -11, 9],
		[13, -5, 8],
		[8, 1, 8],
		[-2, 1, 9],
		[-11, 1, 7],
		[1, -5, 10],
	];
	for (const [px, py, r] of puffs) {
		context.beginPath();
		context.arc(px, py, r, 0, Math.PI * 2);
		context.fill();
		context.stroke();
	}
	context.fillStyle = "#fbf8ef";
	for (const [px, py, r] of puffs) {
		context.beginPath();
		context.arc(px, py, r - 1.3, 0, Math.PI * 2);
		context.fill();
	}
	// A dark face and ears.
	context.fillStyle = "#2a2622";
	context.beginPath();
	context.ellipse(21, -6, 6, 7.5, 0.35, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.ellipse(16, -12, 4, 2, -0.6, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#fbf8ef";
	context.beginPath();
	context.arc(18, -13, 4.5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#fff";
	context.beginPath();
	context.arc(23, -8, 1.4, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawGoat(context: CanvasRenderingContext2D, x: number, y: number, scale: number, facing: number, step: number) {
	context.save();
	context.translate(x, y);
	context.scale(scale * facing, scale);
	context.lineCap = "round";
	// Long thin legs.
	context.strokeStyle = "#4a2f18";
	context.lineWidth = 3;
	for (const [lx, phase] of [
		[-12, 0],
		[-6, Math.PI],
		[8, Math.PI],
		[13, 0],
	] as const) {
		context.beginPath();
		context.moveTo(lx, 0);
		context.lineTo(lx + Math.sin(step + phase) * 2.5, 14);
		context.stroke();
	}
	// A lean brown body with a pale belly and an upright tail.
	context.fillStyle = "#8a5428";
	context.beginPath();
	context.ellipse(0, -6, 17, 8.5, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#c79a68";
	context.beginPath();
	context.ellipse(0, -2, 12, 3.5, 0, 0, Math.PI);
	context.fill();
	context.strokeStyle = "#5a3618";
	context.lineWidth = 3;
	context.beginPath();
	context.moveTo(-16, -9);
	context.lineTo(-20, -17);
	context.stroke();
	// Neck and a long head held high.
	context.fillStyle = "#8a5428";
	context.beginPath();
	context.moveTo(10, -12);
	context.lineTo(17, -24);
	context.lineTo(23, -21);
	context.lineTo(18, -6);
	context.closePath();
	context.fill();
	context.beginPath();
	context.ellipse(23, -24, 7.5, 4.5, 0.5, 0, Math.PI * 2);
	context.fill();
	// The beard.
	context.fillStyle = "#3b2412";
	context.beginPath();
	context.moveTo(24, -20);
	context.lineTo(29, -20);
	context.lineTo(25, -11);
	context.closePath();
	context.fill();
	// Horns sweeping back, and an ear.
	context.strokeStyle = "#3a332c";
	context.lineWidth = 3;
	context.beginPath();
	context.moveTo(20, -28);
	context.quadraticCurveTo(14, -40, 6, -36);
	context.stroke();
	context.beginPath();
	context.moveTo(23, -28);
	context.quadraticCurveTo(19, -42, 11, -40);
	context.stroke();
	context.fillStyle = "#6e4220";
	context.beginPath();
	context.ellipse(15, -24, 5, 2, 0.4, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#fff6c8";
	context.beginPath();
	context.arc(25, -26, 1.3, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawAnimal(context: CanvasRenderingContext2D, kind: FlockKind, x: number, y: number, scale: number, facing: number, step: number) {
	if (kind === "sheep") drawSheep(context, x, y, scale, facing, step);
	else drawGoat(context, x, y, scale, facing, step);
}

export default function SheepAndGoats({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<FlockState>(newFlock(seed));
	const swipes = useRef<FlockSide[]>([]);
	const drag = useRef<{ x: number; y: number; done: boolean } | null>(null);
	const sparks = useRef<Spark[]>([]);
	const flashes = useRef<{ x: number; y: number; at: number; good: boolean; label: string }[]>([]);
	const shake = useRef(0);
	const lastData = useRef(-1);
	const ended = useRef(false);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, colors: string[], count: number, speed: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.6);
			sparks.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 30, life: 0, max: 0.5 + Math.random() * 0.5, color: colors[i % colors.length], size: 2 + Math.random() * 2.5 });
		}
	}, []);

	const react = useCallback(
		(event: FlockEvent, run: FlockState) => {
			const play = synth.current;
			if (event.type === "come") play?.tone(event.kind === "sheep" ? 880 : 740, 0.08, { type: "sine", volume: 0.05 });
			if (event.type === "parted") {
				const fold = event.side === "right" ? RIGHT_FOLD : LEFT_FOLD;
				if (event.right) {
					burst(P3.x, P3.y - 14, event.kind === "sheep" ? ["#fff6d8", "#ffd977", "#ffffff"] : ["#e8c48a", "#ffd977", "#fff6d8"], 14, 80);
					if (event.kind === "sheep") play?.tone(392, 0.28, { type: "triangle", volume: 0.12, to: 523 });
					else play?.tone(294, 0.24, { type: "triangle", volume: 0.12, to: 392 });
					play?.tone(1175, 0.18, { type: "sine", volume: 0.06, delay: 0.05 });
					flashes.current.push({ x: fold.x, y: fold.y - 36, at: run.t, good: true, label: event.side === "right" ? "Right hand" : "Left" });
				} else {
					burst(P3.x, P3.y - 14, ["#ff5a4a", "#ffffff"], 10, 60);
					play?.tone(160, 0.32, { type: "square", volume: 0.11, to: 95 });
					flashes.current.push({ x: fold.x, y: fold.y - 36, at: run.t, good: false, label: event.kind === "sheep" ? "A sheep: right!" : "A goat: left!" });
					shake.current = run.t + 0.3;
				}
			}
			if (event.type === "early") {
				play?.tone(260, 0.07, { type: "sine", volume: 0.06 });
				flashes.current.push({ x: P3.x, y: 230, at: run.t, good: false, label: "Wait for the gate" });
			}
			if (event.type === "strayed") {
				play?.tone(150, 0.3, { type: "square", volume: 0.1, to: 80 });
				flashes.current.push({ x: P3.x, y: P3.y - 60, at: run.t, good: false, label: "Strayed!" });
				shake.current = run.t + 0.3;
			}
			if (event.type === "won") [392, 494, 587, 784, 988].forEach((note, index) => play?.tone(note, 1.1, { type: "triangle", volume: 0.12, delay: index * 0.1 }));
			if (event.type === "lost") play?.tone(220, 0.8, { type: "sine", volume: 0.18, to: 120 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		for (const spark of sparks.current) {
			spark.life += 1 / 60;
			spark.x += spark.vx / 60;
			spark.y += spark.vy / 60;
			spark.vy += 120 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.life < spark.max);
		if (run.phase !== "playing") return;
		let side: FlockSide | null = null;
		for (const key of takePresses(keys)) {
			if (key === "arrowleft") side = side ?? "left";
			if (key === "arrowright") side = side ?? "right";
		}
		if (!side && swipes.current.length) side = swipes.current.shift() ?? null;
		const events: FlockEvent[] = [];
		stepFlock(run, { side }, events);
		for (const event of events) react(event, run);
		onTime(Math.max(0, FLOCK_SECONDS - run.t));
		const tick = Math.floor(run.t * 10);
		if (tick !== lastData.current && canvasRef.current) {
			lastData.current = tick;
			canvasRef.current.dataset.front = flockAtGate(run)?.kind ?? "";
			canvasRef.current.dataset.score = `${run.right}/${run.mistakes}`;
		}
		const result = flockResult(run);
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

			// Royal morning: a pale gold sky and the light of the throne of glory.
			const sky = context.createLinearGradient(0, 0, 0, 160);
			sky.addColorStop(0, "#f7e7b4");
			sky.addColorStop(1, "#d9ecf5");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 180);
			context.save();
			context.translate(200, 62);
			context.rotate(reducedMotion ? 0 : time * 0.05);
			context.fillStyle = "rgba(255,236,170,.35)";
			for (let i = 0; i < 12; i++) {
				context.rotate(Math.PI / 6);
				context.beginPath();
				context.moveTo(0, 0);
				context.lineTo(-14, -260);
				context.lineTo(14, -260);
				context.closePath();
				context.fill();
			}
			context.restore();
			const glory = context.createRadialGradient(200, 62, 4, 200, 62, 80);
			glory.addColorStop(0, "rgba(255,255,240,1)");
			glory.addColorStop(0.4, "rgba(255,240,190,.8)");
			glory.addColorStop(1, "rgba(255,240,190,0)");
			context.fillStyle = glory;
			context.fillRect(110, -20, 180, 170);
			// The throne far off, with the King upon it: a seated robed figure in light.
			context.fillStyle = "#e3b649";
			context.fillRect(184, 44, 32, 6);
			context.fillRect(180, 26, 6, 40);
			context.fillRect(214, 26, 6, 40);
			context.fillStyle = "#f2cf6a";
			context.fillRect(176, 66, 48, 6);
			context.fillRect(170, 72, 60, 6);
			context.fillStyle = "#fffdf4";
			context.beginPath();
			context.arc(200, 34, 6, 0, Math.PI * 2);
			context.fill();
			context.beginPath();
			context.moveTo(191, 44);
			context.lineTo(209, 44);
			context.lineTo(213, 66);
			context.lineTo(187, 66);
			context.closePath();
			context.fill();
			context.fillStyle = "#b8862a";
			context.fillRect(196, 44, 8, 3);

			// Green hills and the hill the path comes down.
			context.fillStyle = "#8cc36d";
			context.beginPath();
			context.moveTo(-10, 150);
			context.quadraticCurveTo(100, 96, 200, 104);
			context.quadraticCurveTo(300, 96, 410, 150);
			context.lineTo(410, 410);
			context.lineTo(-10, 410);
			context.fill();
			// The left: stony, shaded ground.
			context.fillStyle = "#7f9a5c";
			context.beginPath();
			context.moveTo(-10, 230);
			context.quadraticCurveTo(70, 210, 128, 300);
			context.lineTo(140, 410);
			context.lineTo(-10, 410);
			context.fill();
			context.fillStyle = "#a59c88";
			for (const [rx, ry, rr] of [
				[24, 262, 10],
				[70, 290, 8],
				[30, 360, 12],
				[96, 372, 7],
			]) {
				context.beginPath();
				context.ellipse(rx, ry, rr * 1.4, rr, 0, 0, Math.PI * 2);
				context.fill();
			}
			// The right hand: a bright meadow and a white fold.
			const meadow = context.createRadialGradient(RIGHT_FOLD.x, RIGHT_FOLD.y, 10, RIGHT_FOLD.x, RIGHT_FOLD.y, 120);
			meadow.addColorStop(0, "rgba(255,246,190,.75)");
			meadow.addColorStop(1, "rgba(255,246,190,0)");
			context.fillStyle = meadow;
			context.fillRect(240, 200, 170, 210);
			context.strokeStyle = "#fffaf0";
			context.lineWidth = 3;
			for (let i = 0; i < 6; i++) {
				const fx = 290 + i * 22;
				context.beginPath();
				context.moveTo(fx, 360);
				context.lineTo(fx, 334);
				context.stroke();
			}
			context.beginPath();
			context.moveTo(284, 342);
			context.lineTo(410, 342);
			context.moveTo(284, 352);
			context.lineTo(410, 352);
			context.stroke();

			// The path, and the gate glowing where animals are parted.
			context.strokeStyle = "#e7d3a0";
			context.lineWidth = 26;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(P0.x, P0.y);
			context.bezierCurveTo(P1.x, P1.y, P2.x, P2.y, P3.x, P3.y);
			context.lineTo(P3.x, 420);
			context.stroke();
			const gateLive = !!flockAtGate(run);
			const pulse = 0.5 + 0.5 * Math.sin(time * 9);
			context.strokeStyle = gateLive ? `rgba(255,214,90,${0.6 + pulse * 0.4})` : "rgba(255,214,90,.45)";
			context.lineWidth = 32;
			context.beginPath();
			for (let i = 0; i <= 20; i++) {
				const point = pathPoint(FLOCK_GATE + ((1 - FLOCK_GATE) * i) / 20);
				if (i === 0) context.moveTo(point.x, point.y);
				else context.lineTo(point.x, point.y);
			}
			context.stroke();
			context.strokeStyle = "#e7d3a0";
			context.lineWidth = 20;
			context.stroke();
			context.lineCap = "butt";
			// The gate itself: two gold posts and an arch where the parting begins.
			const gate = pathPoint(FLOCK_GATE);
			context.strokeStyle = gateLive ? `rgba(240,184,40,${0.8 + pulse * 0.2})` : "#d9a52c";
			context.lineWidth = 5;
			context.beginPath();
			context.moveTo(gate.x - 28, gate.y + 8);
			context.lineTo(gate.x - 28, gate.y - 30);
			context.quadraticCurveTo(gate.x, gate.y - 52, gate.x + 28, gate.y - 30);
			context.lineTo(gate.x + 28, gate.y + 8);
			context.stroke();
			context.fillStyle = "#6b3fa0";
			context.beginPath();
			context.roundRect(gate.x - 22, gate.y - 52, 44, 16, 8);
			context.fill();
			context.fillStyle = "#ffe9a8";
			context.font = "900 10px system-ui, sans-serif";
			context.textAlign = "center";
			context.fillText("GATE", gate.x, gate.y - 40);

			// The shepherd's crook at the end of the path.
			context.strokeStyle = "#6b4423";
			context.lineWidth = 5;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(236, 384);
			context.lineTo(236, 300);
			context.arc(226, 300, 10, 0, Math.PI, true);
			context.lineTo(216, 308);
			context.stroke();
			context.lineCap = "butt";

			// Side labels, pulsing at the start.
			const hint = run.t < 2.4 ? 0.5 + 0.5 * Math.sin(time * 8) : 0;
			context.textAlign = "center";
			for (const side of ["left", "right"] as const) {
				const x = side === "left" ? 62 : 338;
				const y = 200;
				context.fillStyle = side === "left" ? "rgba(52,40,30,.82)" : "rgba(64,40,104,.85)";
				context.strokeStyle = `rgba(255,214,90,${0.55 + hint * 0.45})`;
				context.lineWidth = 2 + hint * 2;
				context.beginPath();
				context.roundRect(x - 54, y - 36, 108, 74, 14);
				context.fill();
				context.stroke();
				context.fillStyle = "#ffe9a8";
				context.font = "800 11px system-ui, sans-serif";
				context.fillText(side === "left" ? "on the left" : "the right hand", x, y - 20);
				if (side === "left") drawGoat(context, x - 30, y + 18, 0.62, 1, 0);
				else drawSheep(context, x + 28, y + 16, 0.66, -1, 0);
				context.fillStyle = "#fffaf0";
				context.font = "900 22px system-ui, sans-serif";
				context.fillText(side === "left" ? "←" : "→", side === "left" ? x + 16 : x - 16, y + 8);
				context.font = "900 13px system-ui, sans-serif";
				context.fillText(side === "left" ? "GOATS" : "SHEEP", side === "left" ? x + 16 : x - 16, y + 27);
			}
			if (hint > 0) {
				context.fillStyle = "#3b2a5c";
				context.font = "900 15px system-ui, sans-serif";
				context.fillText("Part each one at the gold gate", 200, 140);
			}

			// The flock, back to front so the nearer animals stand over the farther.
			const atGate = flockAtGate(run);
			const ordered = [...run.animals].sort((a, b) => flockAlong(a, run.t) - flockAlong(b, run.t));
			for (const animal of ordered) drawFlockAnimal(context, animal, run.t, animal === atGate, time);

			for (const spark of sparks.current) {
				context.globalAlpha = Math.max(0, 1 - spark.life / spark.max);
				context.fillStyle = spark.color;
				context.beginPath();
				context.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;

			flashes.current = flashes.current.filter((flash) => run.t - flash.at < 0.8);
			for (const flash of flashes.current) {
				const age = (run.t - flash.at) / 0.8;
				context.globalAlpha = 1 - age;
				context.font = "900 16px system-ui, sans-serif";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(40,24,60,.75)";
				context.fillStyle = flash.good ? "#ffe08a" : "#ff7a6b";
				const x = Math.max(70, Math.min(STAGE - 70, flash.x));
				context.strokeText(flash.label, x, flash.y - age * 18);
				context.fillText(flash.label, x, flash.y - age * 18);
			}
			context.globalAlpha = 1;

			// Mistakes left (three crooks), and the count parted.
			context.fillStyle = "rgba(48,30,80,.6)";
			context.beginPath();
			context.roundRect(8, 8, 120, 30, 15);
			context.fill();
			for (let i = 0; i < FLOCK_MISTAKES; i++) {
				const x = 26 + i * 24;
				if (i < run.mistakes) {
					context.strokeStyle = "#ff6b5e";
					context.lineWidth = 3.5;
					context.beginPath();
					context.moveTo(x - 7, 16);
					context.lineTo(x + 7, 30);
					context.moveTo(x + 7, 16);
					context.lineTo(x - 7, 30);
					context.stroke();
				} else {
					context.fillStyle = "#ffd966";
					context.beginPath();
					context.arc(x, 23, 7, 0, Math.PI * 2);
					context.fill();
				}
			}
			context.fillStyle = "#fffaf0";
			context.font = "900 15px system-ui, sans-serif";
			context.textAlign = "right";
			context.fillText(`${run.right}`, 118, 28);
			context.textAlign = "center";
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,240,190,.22)";
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
			aria-label="Sheep and goats come down the path to the shepherd's crook. At the gold gate, press right arrow or swipe right to set a sheep on the right hand; press left arrow or swipe left to set a goat on the left."
		/>
	);
}

/** One animal: walking down the path, running off to its side once parted, or wandering past the crook. */
function drawFlockAnimal(context: CanvasRenderingContext2D, animal: FlockAnimal, t: number, atGate: boolean, time: number) {
	if (animal.parted) {
		const age = Math.min(1, (t - animal.parted.at) / 0.6);
		const from = pathPoint(flockAlong(animal, animal.parted.at));
		const fold = animal.parted.side === "right" ? RIGHT_FOLD : LEFT_FOLD;
		const x = from.x + (fold.x - from.x) * age;
		const y = from.y + (fold.y - from.y) * age - Math.abs(Math.sin(age * Math.PI * 3)) * 10;
		context.globalAlpha = age > 0.75 ? (1 - age) * 4 : 1;
		drawAnimal(context, animal.kind, x, y, 1, animal.parted.side === "right" ? 1 : -1, time * 18);
		if (!animal.parted.right) {
			context.strokeStyle = "#ff5a4a";
			context.lineWidth = 3;
			context.beginPath();
			context.arc(x, y - 8, 26, 0, Math.PI * 2);
			context.stroke();
		}
		context.globalAlpha = 1;
		return;
	}
	const along = flockAlong(animal, t);
	const point = pathPoint(along);
	const scale = 0.42 + 0.62 * Math.min(1, along);
	if (animal.strayed !== null) context.globalAlpha = Math.max(0, 1 - (t - animal.strayed) / 1.2);
	if (atGate) {
		const pulse = 0.5 + 0.5 * Math.sin(time * 10);
		context.strokeStyle = along > 0.9 ? "#ff5a4a" : "#fffbe8";
		context.lineWidth = 3;
		context.fillStyle = "rgba(255,240,170,.35)";
		context.beginPath();
		context.ellipse(point.x, point.y - 8 * scale, 34 * scale + pulse * 3, 28 * scale + pulse * 3, 0, 0, Math.PI * 2);
		context.fill();
		context.stroke();
	}
	const facing = Math.abs(point.dx) < 8 ? 1 : Math.sign(point.dx);
	drawAnimal(context, animal.kind, point.x, point.y, scale * (atGate ? 1.15 : 1), facing, time * 10 + animal.id);
	context.globalAlpha = 1;
}
