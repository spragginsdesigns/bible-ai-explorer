"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	COIN_LAND,
	COIN_SECONDS,
	COIN_STRIKES,
	coinCueAt,
	coinResult,
	newCoin,
	stepCoin,
	type CoinEvent,
	type CoinState,
} from "@/lib/beta/games/coin-in-the-fish-rules";

/**
 * The Coin in the Fish (LC-17851), Matthew 17:24-27: Peter casts an hook from
 * the shore of the sea at first light. One fish, the one with the piece of
 * money, comes to the bait: it nibbles (small bobs of the float) and then
 * bites (the float goes under with a flash). Strike on the bite, three times,
 * to bring it up; striking on a nibble scares it back down.
 */

const STRIKE_KEYS = new Set([" "]);
const WATER_Y = 172;
const FLOAT_X = 262;
const BAIT_Y = 262;
const ROD_TIP = { x: 118, y: 88 };
/** Where the fish waits at each fathom drawn up. */
const DEPTHS = [356, 318, 286, 250];

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
	color: string;
}

interface Word {
	text: string;
	x: number;
	y: number;
	age: number;
	color: string;
}

function drawFish(context: CanvasRenderingContext2D, x: number, y: number, facing: number, glint: number, scale = 1) {
	context.save();
	context.translate(x, y);
	context.scale(facing * scale, scale);
	context.fillStyle = "#9fb7c2";
	context.beginPath();
	context.ellipse(0, 0, 26, 11, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(-22, 0);
	context.lineTo(-38, -11);
	context.lineTo(-38, 11);
	context.closePath();
	context.fill();
	context.fillStyle = "#6f8b98";
	context.fillRect(-14, -11, 18, 3);
	context.fillStyle = "#1b2630";
	context.beginPath();
	context.arc(15, -3, 2.4, 0, Math.PI * 2);
	context.fill();
	// The piece of money in its mouth.
	context.fillStyle = "#f2c94c";
	context.beginPath();
	context.arc(26, 3, 4.6, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#fff4c2";
	context.beginPath();
	context.arc(25, 2, 1.6, 0, Math.PI * 2);
	context.fill();
	if (glint > 0) {
		context.strokeStyle = `rgba(255,246,200,${glint})`;
		context.lineWidth = 2;
		context.beginPath();
		const r = 6 + glint * 8;
		context.moveTo(26 - r, 3);
		context.lineTo(26 + r, 3);
		context.moveTo(26, 3 - r);
		context.lineTo(26, 3 + r);
		context.stroke();
	}
	context.restore();
}

export default function CoinInTheFish({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<CoinState>(newCoin(seed));
	const taps = useRef(0);
	const ended = useRef(false);
	const sparks = useRef<Spark[]>([]);
	const words = useRef<Word[]>([]);
	const flash = useRef<{ color: string; age: number } | null>(null);
	const shake = useRef(0);
	const upAt = useRef(-9);
	const ticks = useRef(0);
	const lastCue = useRef("");
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: CoinEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "nibble") play.tone(900, 0.05, { type: "sine", volume: 0.06 });
			if (event.type === "bite") {
				play.noise(0.2, { volume: 0.24, filter: 1800 });
				play.tone(640, 0.14, { type: "square", volume: 0.08, to: 380 });
			}
			if (event.type === "strike") {
				play.noise(0.12, { volume: 0.18, filter: 5000, type: "highpass" });
				play.tone(440 + event.level * 120, 0.22, { type: "triangle", volume: 0.18, to: 660 + event.level * 120 });
			}
			if (event.type === "scare") play.tone(300, 0.35, { type: "sawtooth", volume: 0.1, to: 120 });
			if (event.type === "letgo") play.tone(520, 0.2, { type: "sine", volume: 0.08, to: 300 });
			if (event.type === "up") {
				play.noise(0.5, { volume: 0.22, filter: 1400 });
				[784, 988, 1175, 1568].forEach((note, index) => play.tone(note, 0.9, { type: "triangle", volume: 0.12, delay: 0.25 + index * 0.08 }));
			}
			if (event.type === "end" && !event.won) play.tone(247, 0.9, { type: "sine", volume: 0.16, to: 165 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase === "won" || run.phase === "lost") return;
		const pressed = takePresses(keys).some((key) => STRIKE_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const events: CoinEvent[] = [];
		stepCoin(run, { strike: pressed }, events);
		for (const event of events) {
			sound(event);
			if (event.type === "strike") {
				words.current.push({ text: `Hooked! ${event.level}/${COIN_STRIKES}`, x: FLOAT_X, y: WATER_Y - 40, age: 0, color: "#ffe17a" });
				flash.current = { color: "rgba(255,240,170,.35)", age: 0 };
				for (let i = 0; i < 16; i++) sparks.current.push({ x: FLOAT_X, y: WATER_Y, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 120, age: 0, life: 0.6, color: i % 2 ? "#e8f7ff" : "#9fd8f2" });
				if (!reducedMotion) shake.current = 0.18;
			}
			if (event.type === "scare") {
				words.current.push({ text: "Too soon! It fled", x: FLOAT_X, y: WATER_Y - 40, age: 0, color: "#ff8f7a" });
				flash.current = { color: "rgba(255,80,60,.22)", age: 0 };
				if (!reducedMotion) shake.current = 0.22;
			}
			if (event.type === "letgo") words.current.push({ text: "Too late! It let go", x: FLOAT_X, y: WATER_Y - 40, age: 0, color: "#ffc2b5" });
			if (event.type === "up") {
				upAt.current = run.t;
				words.current.push({ text: "A piece of money!", x: STAGE / 2, y: 96, age: 0, color: "#ffe17a" });
				for (let i = 0; i < 30; i++) sparks.current.push({ x: FLOAT_X, y: WATER_Y, vx: (Math.random() - 0.5) * 220, vy: -120 - Math.random() * 160, age: 0, life: 0.9, color: i % 3 ? "#e8f7ff" : "#ffe17a" });
			}
		}
		for (const spark of sparks.current) {
			spark.age += 1 / 60;
			spark.x += spark.vx / 60;
			spark.y += spark.vy / 60;
			spark.vy += 320 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.age < spark.life);
		for (const word of words.current) word.age += 1 / 60;
		words.current = words.current.filter((word) => word.age < 1.1);
		if (flash.current) {
			flash.current.age += 1 / 60;
			if (flash.current.age > 0.22) flash.current = null;
		}
		shake.current = Math.max(0, shake.current - 1 / 60);
		onTime(Math.max(0, COIN_SECONDS - run.t));
		ticks.current++;
		const canvas = canvasRef.current;
		const cue = coinCueAt(run);
		const key = cue ? `${cue.kind}|${cue.from.toFixed(3)}` : "-|-";
		if (canvas && (ticks.current % 6 === 0 || key !== lastCue.current)) {
			lastCue.current = key;
			canvas.dataset.cue = `${run.t.toFixed(2)}|${key}`;
		}
		const result = coinResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const cue = run.phase === "playing" ? coinCueAt(run) : null;
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 85) * shake.current * 9, Math.cos(time * 70) * shake.current * 4);

			// First light over the sea of Galilee.
			const sky = context.createLinearGradient(0, 0, 0, WATER_Y);
			sky.addColorStop(0, "#3d4f7c");
			sky.addColorStop(0.55, "#d98c8c");
			sky.addColorStop(1, "#f6c99a");
			context.fillStyle = sky;
			context.fillRect(-20, 0, STAGE + 40, WATER_Y);
			context.fillStyle = "rgba(255,236,190,.95)";
			context.beginPath();
			context.arc(330, WATER_Y, 30, Math.PI, 0);
			context.fill();
			context.fillStyle = "#6e6a8a";
			context.beginPath();
			context.moveTo(150, WATER_Y);
			context.quadraticCurveTo(240, WATER_Y - 34, 330, WATER_Y - 12);
			context.quadraticCurveTo(380, WATER_Y - 24, 420, WATER_Y);
			context.fill();

			// The sea: surface glimmer, depths below, rays of light.
			const sea = context.createLinearGradient(0, WATER_Y, 0, STAGE);
			sea.addColorStop(0, "#2f7f96");
			sea.addColorStop(1, "#0d2f45");
			context.fillStyle = sea;
			context.fillRect(-20, WATER_Y, STAGE + 40, STAGE - WATER_Y);
			context.fillStyle = "rgba(255,255,255,.07)";
			for (let i = 0; i < 4; i++) {
				const x = 140 + i * 70 + (reducedMotion ? 0 : Math.sin(time * 0.6 + i) * 10);
				context.beginPath();
				context.moveTo(x, WATER_Y);
				context.lineTo(x + 26, WATER_Y);
				context.lineTo(x - 30, STAGE);
				context.lineTo(x - 70, STAGE);
				context.fill();
			}
			context.strokeStyle = "rgba(255,226,190,.55)";
			context.lineWidth = 2;
			for (let i = 0; i < 7; i++) {
				const x = 150 + i * 40 + (reducedMotion ? 0 : (time * 12) % 40);
				context.beginPath();
				context.moveTo(x, WATER_Y + 4 + (i % 2) * 6);
				context.lineTo(x + 16, WATER_Y + 4 + (i % 2) * 6);
				context.stroke();
			}

			// The shore and Peter with his line.
			context.fillStyle = "#4a3b33";
			context.beginPath();
			context.moveTo(-10, 150);
			context.quadraticCurveTo(70, 140, 128, 186);
			context.lineTo(140, STAGE);
			context.lineTo(-10, STAGE);
			context.fill();
			context.fillStyle = "#5e4b40";
			context.beginPath();
			context.ellipse(60, 160, 46, 14, 0, 0, Math.PI * 2);
			context.fill();
			const struck = run.t - run.lastStrike < 0.25 ? 1 - (run.t - run.lastStrike) / 0.25 : 0;
			const px = 56;
			const py = 154;
			context.fillStyle = "#5a6f8f";
			context.beginPath();
			context.moveTo(px - 13, py);
			context.lineTo(px - 8, py - 52);
			context.lineTo(px + 9, py - 52);
			context.lineTo(px + 13, py);
			context.closePath();
			context.fill();
			context.fillStyle = "#b9835a";
			context.beginPath();
			context.arc(px, py - 61, 8.5, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#e9e1cf";
			context.beginPath();
			context.arc(px, py - 64, 8.5, Math.PI, 0);
			context.fill();
			const tip = { x: ROD_TIP.x - struck * 14, y: ROD_TIP.y - struck * 26 };
			context.strokeStyle = "#7a5a3a";
			context.lineWidth = 3.5;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(px + 6, py - 34);
			context.lineTo(tip.x, tip.y);
			context.stroke();

			// The float: small bobs on a nibble, under with a flash on a bite.
			let dip = reducedMotion ? 0 : Math.sin(time * 2.4) * 1.5;
			if (cue?.kind === "nibble") dip = 4 + Math.sin(((run.t - cue.from) / (cue.to - cue.from)) * Math.PI * 3) * 4;
			if (cue?.kind === "bite") dip = 22;
			if (run.phase === "landing" || run.phase === "won") dip = -6;
			const floatY = WATER_Y - 6 + dip;
			context.strokeStyle = "rgba(240,240,240,.85)";
			context.lineWidth = 1.2;
			context.beginPath();
			context.moveTo(tip.x, tip.y);
			context.quadraticCurveTo((tip.x + FLOAT_X) / 2, tip.y + 30 + (cue?.kind === "bite" ? 20 : 0), FLOAT_X, floatY - 8);
			context.moveTo(FLOAT_X, floatY + 8);
			context.lineTo(FLOAT_X, BAIT_Y);
			context.stroke();
			if (cue?.kind === "bite") {
				const age = run.t - cue.from;
				context.strokeStyle = `rgba(255,236,120,${Math.max(0.3, 1 - age * 2)})`;
				context.lineWidth = 5;
				context.beginPath();
				context.ellipse(FLOAT_X, WATER_Y, 22 + age * 70, 8 + age * 20, 0, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "rgba(255,240,150,.2)";
				context.fillRect(0, 0, STAGE, STAGE);
			} else if (cue?.kind === "nibble") {
				context.strokeStyle = "rgba(255,255,255,.45)";
				context.lineWidth = 2;
				context.beginPath();
				context.ellipse(FLOAT_X, WATER_Y, 14, 4, 0, 0, Math.PI * 2);
				context.stroke();
			}
			context.fillStyle = "#e23d32";
			context.beginPath();
			context.ellipse(FLOAT_X, floatY - 3, 7, 8, 0, Math.PI, 0);
			context.fill();
			context.fillStyle = "#f6f1e6";
			context.beginPath();
			context.ellipse(FLOAT_X, floatY - 3, 7, 8, 0, 0, Math.PI);
			context.fill();
			context.fillStyle = "#e23d32";
			context.fillRect(FLOAT_X - 1.2, floatY - 16, 2.4, 6);
			// The bait on the hook.
			context.fillStyle = "#d8a06a";
			context.beginPath();
			context.arc(FLOAT_X, BAIT_Y, 4, 0, Math.PI * 2);
			context.fill();

			// The fish: waits at its fathom, comes to the bait to nibble and bite, darts off when scared.
			let fishX = FLOAT_X + 70 + (reducedMotion ? 0 : Math.sin(time * 1.3) * 16);
			let fishY = DEPTHS[Math.min(run.level, DEPTHS.length - 1)] + (reducedMotion ? 0 : Math.sin(time * 2) * 4);
			let facing = -1;
			let scale = 1;
			if (cue) {
				fishX = FLOAT_X + 30;
				fishY = BAIT_Y + 2;
			}
			if (run.busy === "scare" && run.t < run.busyUntil) {
				const k = 1 - (run.busyUntil - run.t);
				fishX = FLOAT_X + 30 + k * 220;
				fishY += k * 30;
				facing = 1;
			}
			if (run.phase === "landing" || run.phase === "won") {
				const k = Math.min(1, (run.t - upAt.current) / COIN_LAND);
				fishX = FLOAT_X + 12 - k * 40;
				fishY = BAIT_Y - k * 150 - Math.sin(k * Math.PI) * 40;
				scale = 1 + k * 0.4;
			}
			const glint = run.phase === "landing" || run.phase === "won" ? 0.6 + 0.4 * Math.sin(time * 14) : reducedMotion ? 0.4 : Math.max(0, Math.sin(time * 3)) * 0.7;
			drawFish(context, fishX, fishY, facing, glint, scale);

			for (const spark of sparks.current) {
				context.globalAlpha = 1 - spark.age / spark.life;
				context.fillStyle = spark.color;
				context.fillRect(spark.x, spark.y, 3, 3);
			}
			context.globalAlpha = 1;
			context.textAlign = "center";
			for (const word of words.current) {
				context.globalAlpha = Math.min(1, 2 * (1.1 - word.age));
				context.font = "900 19px system-ui, sans-serif";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(10,20,40,.65)";
				context.strokeText(word.text, word.x, word.y - word.age * 24);
				context.fillStyle = word.color;
				context.fillText(word.text, word.x, word.y - word.age * 24);
			}
			context.globalAlpha = 1;
			if (cue?.kind === "bite") {
				context.font = "900 30px system-ui, sans-serif";
				context.lineWidth = 6;
				context.strokeStyle = "rgba(10,20,40,.7)";
				context.strokeText("STRIKE!", FLOAT_X, WATER_Y - 50);
				context.fillStyle = "#ffe14a";
				context.fillText("STRIKE!", FLOAT_X, WATER_Y - 50);
			}
			context.restore();

			if (flash.current) {
				context.fillStyle = flash.current.color;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// The strikes so far: three hooks to bring the coin fish up.
			context.fillStyle = "rgba(10,20,40,.55)";
			context.beginPath();
			context.roundRect(STAGE - 186, 10, 176, 46, 12);
			context.fill();
			context.fillStyle = "#fff";
			context.font = "800 13px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillText("Drawn up", STAGE - 174, 38);
			for (let i = 0; i < COIN_STRIKES; i++) {
				const done = i < run.level;
				context.fillStyle = done ? "#ffd84a" : "rgba(255,255,255,.25)";
				context.beginPath();
				context.arc(STAGE - 78 + i * 24, 33, 9, 0, Math.PI * 2);
				context.fill();
				if (done) {
					context.fillStyle = "#8a6a10";
					context.font = "900 11px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("✓", STAGE - 78 + i * 24, 37);
					context.textAlign = "left";
					context.font = "800 13px system-ui, sans-serif";
				}
			}

			// The first seconds: what to watch for, plainly.
			if (run.t < 2.6 && run.phase === "playing") {
				context.globalAlpha = run.t < 2.1 ? 1 : 1 - (run.t - 2.1) / 0.5;
				context.fillStyle = "rgba(10,20,40,.75)";
				context.beginPath();
				context.roundRect(140, 66, 250, 56, 12);
				context.fill();
				context.fillStyle = "#ffe14a";
				context.font = "900 16px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Strike when the float", 265, 89);
				context.fillText("goes UNDER, not on a bob", 265, 109);
				context.strokeStyle = "#ffe14a";
				context.lineWidth = 3;
				context.beginPath();
				context.arc(FLOAT_X, WATER_Y, 22 + (reducedMotion ? 0 : (time * 36) % 16), 0, Math.PI * 2);
				context.stroke();
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
			aria-label="Peter fishes from the shore. Tap, or press Space, to strike when the float goes under; three clean strikes bring up the fish with the coin."
		/>
	);
}
