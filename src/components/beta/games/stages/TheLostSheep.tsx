"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SHEEP_DECOY_SPOTS,
	SHEEP_FINDS,
	SHEEP_FIRST_TICKS,
	SHEEP_SECONDS,
	SHEEP_SPOTS,
	newSheep,
	sheepHead,
	sheepLeft,
	sheepResult,
	sheepVisible,
	stepSheep,
	type SheepEvent,
	type SheepPeek,
	type SheepState,
} from "@/lib/beta/games/the-lost-sheep-rules";

/**
 * The Lost Sheep (LC-17851), Matthew 18:12-14: the mountains at dusk, rose
 * and violet, darkening toward night as the clock runs. The one sheep peeks
 * from behind rocks, bushes and ravine lips; a goat peeks too, and two rocks
 * are shaped like sheep. On the win the shepherd, a robed figure in soft
 * light, lifts it on his shoulders.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const OUTRO_WON = 110;
const OUTRO_LOST = 30;

function sheepFace(context: CanvasRenderingContext2D, x: number, y: number, s: number) {
	// Ears out to the sides, a woolly crown, a cream face.
	context.fillStyle = "#e9c9b8";
	context.beginPath();
	context.ellipse(x - 17 * s, y - 2 * s, 9 * s, 4.5 * s, -0.35, 0, Math.PI * 2);
	context.ellipse(x + 17 * s, y - 2 * s, 9 * s, 4.5 * s, 0.35, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#f6f1e7";
	for (const [dx, dy, r] of [
		[-8, -12, 8],
		[0, -15, 9],
		[8, -12, 8],
		[-11, -4, 7],
		[11, -4, 7],
	]) {
		context.beginPath();
		context.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "#efe3cf";
	context.beginPath();
	context.ellipse(x, y + 2 * s, 10 * s, 13 * s, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#2a2220";
	context.beginPath();
	context.arc(x - 4.5 * s, y - 1 * s, 1.8 * s, 0, Math.PI * 2);
	context.arc(x + 4.5 * s, y - 1 * s, 1.8 * s, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#c79a8c";
	context.beginPath();
	context.ellipse(x, y + 10 * s, 3.5 * s, 2.2 * s, 0, 0, Math.PI * 2);
	context.fill();
}

function goatFace(context: CanvasRenderingContext2D, x: number, y: number, s: number) {
	context.strokeStyle = "#3d3128";
	context.lineWidth = 3.5 * s;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(x - 5 * s, y - 12 * s);
	context.quadraticCurveTo(x - 16 * s, y - 30 * s, x - 22 * s, y - 20 * s);
	context.moveTo(x + 5 * s, y - 12 * s);
	context.quadraticCurveTo(x + 16 * s, y - 30 * s, x + 22 * s, y - 20 * s);
	context.stroke();
	context.fillStyle = "#7a5f48";
	context.beginPath();
	context.ellipse(x - 14 * s, y - 4 * s, 8 * s, 3.5 * s, 0.5, 0, Math.PI * 2);
	context.ellipse(x + 14 * s, y - 4 * s, 8 * s, 3.5 * s, -0.5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#8c6e52";
	context.beginPath();
	context.ellipse(x, y + 2 * s, 9 * s, 15 * s, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#4b3a2c";
	context.beginPath();
	context.moveTo(x - 4 * s, y + 14 * s);
	context.lineTo(x, y + 26 * s);
	context.lineTo(x + 4 * s, y + 14 * s);
	context.fill();
	context.fillStyle = "#f2c94c";
	context.fillRect(x - 6 * s, y - 3 * s, 3.5 * s, 2 * s);
	context.fillRect(x + 2.5 * s, y - 3 * s, 3.5 * s, 2 * s);
}

function cover(context: CanvasRenderingContext2D, spot: (typeof SHEEP_SPOTS)[number], night: number) {
	const { x, y, scale: s, cover: kind } = spot;
	if (kind === "rock") {
		const rock = context.createLinearGradient(0, y, 0, y + 40 * s);
		rock.addColorStop(0, night > 0.5 ? "#5d5a6a" : "#8a8494");
		rock.addColorStop(1, "#3a3644");
		context.fillStyle = rock;
		context.beginPath();
		context.moveTo(x - 40 * s, y + 34 * s);
		context.quadraticCurveTo(x - 42 * s, y + 4 * s, x - 14 * s, y + 3 * s);
		context.quadraticCurveTo(x + 4 * s, y - 6 * s, x + 22 * s, y + 4 * s);
		context.quadraticCurveTo(x + 44 * s, y + 10 * s, x + 40 * s, y + 34 * s);
		context.closePath();
		context.fill();
		context.strokeStyle = "rgba(255,255,255,.14)";
		context.lineWidth = 2;
		context.beginPath();
		context.moveTo(x - 20 * s, y + 10 * s);
		context.lineTo(x - 6 * s, y + 6 * s);
		context.stroke();
	} else if (kind === "bush") {
		context.fillStyle = night > 0.5 ? "#23402e" : "#2f5a3c";
		for (const [dx, dy, r] of [
			[-26, 18, 16],
			[-10, 8, 18],
			[10, 6, 19],
			[27, 16, 16],
			[0, 22, 20],
		]) {
			context.beginPath();
			context.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
			context.fill();
		}
		context.fillStyle = "rgba(160,200,120,.22)";
		context.beginPath();
		context.arc(x + 4 * s, y + 4 * s, 7 * s, 0, Math.PI * 2);
		context.fill();
	} else {
		// A ravine: the far lip, the dark gash, the near lip the head peeks over.
		context.fillStyle = "#1c1424";
		context.beginPath();
		context.ellipse(x, y + 16 * s, 46 * s, 12 * s, 0, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = night > 0.5 ? "#4f4636" : "#6f6248";
		context.beginPath();
		context.moveTo(x - 54 * s, y + 30 * s);
		context.quadraticCurveTo(x, y + 2 * s, x + 54 * s, y + 30 * s);
		context.lineTo(x + 54 * s, y + 38 * s);
		context.lineTo(x - 54 * s, y + 38 * s);
		context.closePath();
		context.fill();
	}
}

function decoyRock(context: CanvasRenderingContext2D, x: number, y: number, s: number) {
	// A pale rock with a lump for a head: from afar, a sheep lying down.
	context.fillStyle = "#b9b4bd";
	context.beginPath();
	context.ellipse(x, y, 26 * s, 15 * s, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.ellipse(x - 24 * s, y - 6 * s, 10 * s, 9 * s, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#8f8896";
	context.beginPath();
	context.ellipse(x + 2 * s, y + 8 * s, 24 * s, 6 * s, 0, 0, Math.PI);
	context.fill();
	context.fillStyle = "#5f5866";
	context.fillRect(x - 27 * s, y - 8 * s, 2 * s, 2 * s);
}

function shepherd(context: CanvasRenderingContext2D, x: number, y: number, lift: number) {
	const glow = context.createRadialGradient(x, y - 70, 10, x, y - 70, 140);
	glow.addColorStop(0, "rgba(255,240,205,.75)");
	glow.addColorStop(1, "rgba(255,240,205,0)");
	context.fillStyle = glow;
	context.fillRect(x - 160, y - 220, 320, 300);
	context.fillStyle = "#f4ead6";
	context.beginPath();
	context.moveTo(x - 34, y);
	context.lineTo(x - 22, y - 92);
	context.lineTo(x + 22, y - 92);
	context.lineTo(x + 34, y);
	context.closePath();
	context.fill();
	context.fillStyle = "#b9884f";
	context.fillRect(x - 5, y - 70, 10, 46);
	// The staff.
	context.strokeStyle = "#7a5530";
	context.lineWidth = 4;
	context.beginPath();
	context.moveTo(x + 46, y);
	context.lineTo(x + 46, y - 124);
	context.arc(x + 36, y - 124, 10, 0, Math.PI, true);
	context.stroke();
	// The sheep laid on his shoulders: lifted from the ground to rest across them.
	const sy = y - 92 + (1 - lift) * 70;
	context.fillStyle = "#f6f1e7";
	context.beginPath();
	context.ellipse(x, sy, 44, 13, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e7dccb";
	context.fillRect(x + 30, sy + 4, 6, 20);
	context.fillRect(x + 22, sy + 4, 6, 18);
	context.fillRect(x - 36, sy + 4, 6, 20);
	context.fillRect(x - 28, sy + 4, 6, 18);
	sheepFace(context, x - 48, sy - 6, 0.7);
	// His head, hooded, in soft light above it: no face drawn.
	context.fillStyle = "#efe2c8";
	context.beginPath();
	context.arc(x, y - 112, 14, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#d9c7a5";
	context.beginPath();
	context.arc(x, y - 114, 14, Math.PI, Math.PI * 2);
	context.fill();
}

export default function TheLostSheep({ seed, paused, muted, reducedMotion, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<SheepState>(newSheep(seed));
	const taps = useRef<{ x: number; y: number }[]>([]);
	const outro = useRef(0);
	const ended = useRef(false);
	const shake = useRef(0);
	const sparks = useRef<{ x: number; y: number; vx: number; vy: number; life: number; color: string }[]>([]);
	const lastFrame = useRef(0);
	const lastData = useRef(0);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: SheepEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "peek") {
				// A small bleat: a wavering reed voice.
				play.tone(470, 0.16, { type: "sawtooth", volume: 0.06, to: 430 });
				play.tone(440, 0.26, { type: "sawtooth", volume: 0.06, to: 390, delay: 0.14 });
				play.tone(880, 0.3, { type: "sine", volume: 0.03, delay: 0.14 });
			}
			if (event.type === "goat") play.tone(260, 0.3, { type: "square", volume: 0.035, to: 230 });
			if (event.type === "found") {
				play.tone(660, 0.18, { type: "triangle", volume: 0.18 });
				play.tone(880, 0.3, { type: "triangle", volume: 0.16, delay: 0.09 });
			}
			if (event.type === "wrong") {
				play.tone(event.kind === "miss" ? 200 : 140, 0.25, { type: "square", volume: 0.08, to: 100 });
				if (event.kind === "rock") play.noise(0.12, { volume: 0.2, filter: 700 });
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play.tone(note, 1.3, { type: "triangle", volume: 0.15, delay: 0.15 + index * 0.1 }));
			if (event.type === "lost") play.tone(247, 1, { type: "sine", volume: 0.16, to: 165 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = sheepResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		const tap = taps.current[0] ?? null;
		taps.current.length = 0;
		const head = sheepHead(run.sheep, run.tick + 1);
		const events: SheepEvent[] = [];
		stepSheep(run, { tap }, events);
		for (const event of events) {
			sound(event);
			if (event.type === "found") {
				for (let i = 0; i < 30; i++) {
					const angle = Math.random() * Math.PI * 2;
					sparks.current.push({ x: head.x, y: head.y, vx: Math.cos(angle) * 150, vy: Math.sin(angle) * 150 - 40, life: 0.7, color: i % 2 ? "#fff3c4" : "#ffffff" });
				}
			}
			if (event.type === "wrong") shake.current = event.kind === "miss" ? 0.5 : 1;
		}
		onTime(sheepLeft(run));
	}, [onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const tick = run.tick;
			const night = Math.min(1, (run.t + run.penalty) / SHEEP_SECONDS);
			const canvas = canvasRef.current;
			if (canvas && time - lastData.current > 0.05) {
				lastData.current = time;
				const head = sheepHead(run.sheep, tick);
				canvas.dataset.sheep = `${Math.round(head.x)},${Math.round(head.y)},${sheepVisible(run.sheep, tick) && head.rise > 0.5 ? 1 : 0},${run.phase}`;
			}
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 70) * 5 * shake.current, 0);
			shake.current = Math.max(0, shake.current - dt * 3);

			// Dusk deepening into night.
			const sky = context.createLinearGradient(0, 0, 0, 200);
			const mix = (a: number, b: number) => Math.round(a + (b - a) * night);
			sky.addColorStop(0, `rgb(${mix(62, 14)},${mix(48, 16)},${mix(110, 46)})`);
			sky.addColorStop(0.6, `rgb(${mix(196, 48)},${mix(104, 36)},${mix(130, 78)})`);
			sky.addColorStop(1, `rgb(${mix(247, 80)},${mix(170, 60)},${mix(120, 90)})`);
			context.fillStyle = sky;
			context.fillRect(-10, 0, STAGE + 20, 210);
			for (let i = 0; i < 30; i++) {
				context.fillStyle = `rgba(255,255,240,${night * (0.4 + 0.3 * Math.sin(time * 2 + i))})`;
				context.fillRect((i * 83.1) % STAGE, (i * 29.7) % 120, 1.8, 1.8);
			}
			// Ridges, far to near.
			const ridge = (y: number, amplitude: number, color: string, seedShift: number) => {
				context.fillStyle = color;
				context.beginPath();
				context.moveTo(-10, STAGE);
				for (let x = -10; x <= STAGE + 10; x += 20) context.lineTo(x, y - Math.abs(Math.sin(x / 70 + seedShift)) * amplitude - Math.sin(x / 23 + seedShift) * 6);
				context.lineTo(STAGE + 10, STAGE);
				context.fill();
			};
			ridge(150, 60, `rgb(${mix(110, 34)},${mix(90, 30)},${mix(140, 60)})`, 1.2);
			ridge(200, 40, `rgb(${mix(96, 32)},${mix(104, 40)},${mix(98, 52)})`, 2.6);
			ridge(270, 30, `rgb(${mix(84, 28)},${mix(102, 44)},${mix(70, 40)})`, 0.4);
			ridge(330, 20, `rgb(${mix(70, 24)},${mix(92, 40)},${mix(58, 34)})`, 3.3);

			// The sheep-shaped rocks.
			for (const index of run.decoys) {
				const spot = SHEEP_DECOY_SPOTS[index];
				decoyRock(context, spot.x, spot.y, spot.scale);
			}

			// Each hiding place: whoever peeks there, then the cover in front.
			const peekers: { peek: SheepPeek; kind: "sheep" | "goat" }[] = [
				{ peek: run.sheep, kind: "sheep" },
				{ peek: run.goat, kind: "goat" },
			];
			SHEEP_SPOTS.forEach((spot, index) => {
				if (run.phase !== "won") {
					for (const { peek, kind } of peekers) {
						if (peek.spot !== index || !sheepVisible(peek, tick)) continue;
						const head = sheepHead(peek, tick);
						const wiggle = reducedMotion ? 0 : Math.sin(time * 9) * 1.5;
						const y = head.y + (1 - head.rise) * 30 * spot.scale;
						if (kind === "sheep") sheepFace(context, head.x + wiggle, y, spot.scale);
						else goatFace(context, head.x + wiggle, y, spot.scale);
					}
				}
				cover(context, spot, night);
			});

			// The first peek: a ring that says tap here.
			if (run.phase === "playing" && run.finds === 0 && run.sheep.showAt === SHEEP_FIRST_TICKS && sheepVisible(run.sheep, tick)) {
				const head = sheepHead(run.sheep, tick);
				const pulse = reducedMotion ? 0 : (time * 2) % 1;
				context.strokeStyle = `rgba(255,236,150,${1 - pulse})`;
				context.lineWidth = 4;
				context.beginPath();
				context.arc(head.x, head.y, head.r + pulse * 22, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "#fff4c4";
				context.font = "900 16px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Tap the sheep!", head.x, head.y - head.r - 14);
			}

			// After a find it runs to its next hiding place.
			if (run.fled && run.phase === "playing" && tick - run.fled.tick < 36) {
				const from = SHEEP_SPOTS[run.fled.spot];
				const to = SHEEP_SPOTS[run.sheep.spot];
				const k = (tick - run.fled.tick) / 36;
				const x = from.x + (to.x - from.x) * k;
				const y = from.y + (to.y - from.y) * k - Math.abs(Math.sin(k * Math.PI * 4)) * 12;
				const s = from.scale + (to.scale - from.scale) * k;
				context.globalAlpha = k > 0.8 ? (1 - k) * 5 : 1;
				context.fillStyle = "#f6f1e7";
				context.beginPath();
				context.ellipse(x, y, 16 * s, 10 * s, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#3a302c";
				const dir = to.x > from.x ? 1 : -1;
				context.beginPath();
				context.arc(x + dir * 15 * s, y - 4 * s, 5 * s, 0, Math.PI * 2);
				context.fill();
				context.globalAlpha = 1;
			}

			// The taps: a gold burst on the sheep, a red mark elsewhere.
			for (const tap of run.taps) {
				const age = tick - tap.tick + (run.phase === "playing" ? 0 : outro.current);
				if (age > 40 || tap.kind === "sheep") continue;
				context.globalAlpha = 1 - age / 40;
				context.strokeStyle = "#ff6b5a";
				context.lineWidth = 4;
				context.beginPath();
				context.moveTo(tap.x - 9, tap.y - 9);
				context.lineTo(tap.x + 9, tap.y + 9);
				context.moveTo(tap.x + 9, tap.y - 9);
				context.lineTo(tap.x - 9, tap.y + 9);
				context.stroke();
				context.fillStyle = "#ffd1c9";
				context.strokeStyle = "rgba(0,0,0,.6)";
				context.font = "900 16px system-ui, sans-serif";
				context.textAlign = "center";
				const label = tap.kind === "goat" ? "A goat! −1.2s" : tap.kind === "rock" ? "A rock! −1.2s" : "−0.5s";
				context.strokeText(label, tap.x, tap.y - 16 - age * 0.6);
				context.fillText(label, tap.x, tap.y - 16 - age * 0.6);
				context.globalAlpha = 1;
			}

			// Found so far.
			for (let i = 0; i < SHEEP_FINDS; i++) {
				const x = 22 + i * 30;
				context.globalAlpha = i < run.finds ? 1 : 0.35;
				context.fillStyle = "#f6f1e7";
				context.beginPath();
				context.ellipse(x, 22, 11, 8, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#3a302c";
				context.beginPath();
				context.arc(x + 11, 19, 4, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;

			// Won: the shepherd lifts it on his shoulders.
			if (run.phase === "won") {
				const k = Math.min(1, outro.current / 40);
				context.fillStyle = `rgba(20,14,34,${0.45 * k})`;
				context.fillRect(-10, 0, STAGE + 20, STAGE);
				context.globalAlpha = k;
				shepherd(context, 200, 360, Math.min(1, outro.current / 60));
				context.fillStyle = "#fff4d6";
				context.font = `italic 700 24px ${SERIF}`;
				context.textAlign = "center";
				context.fillText("he rejoiceth more of that sheep", 200, 70);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(10,8,20,.4)";
				context.fillRect(-10, 0, STAGE + 20, STAGE);
				context.fillStyle = "#fff";
				context.font = "900 24px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Night has fallen", 200, 200);
			}

			sparks.current = sparks.current.filter((spark) => (spark.life -= dt) > 0);
			for (const spark of sparks.current) {
				spark.x += spark.vx * dt;
				spark.y += spark.vy * dt;
				spark.vy += 200 * dt;
				context.globalAlpha = Math.min(1, spark.life * 2);
				context.fillStyle = spark.color;
				context.fillRect(spark.x - 2, spark.y - 2, 4, 4);
			}
			context.globalAlpha = 1;
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		taps.current.push(stagePoint(canvas, event));
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="The mountains at dusk. The lost sheep peeks out from behind rocks, bushes and ravines; tap it while it shows, three times. Not the goat, not the rocks shaped like sheep."
		/>
	);
}
