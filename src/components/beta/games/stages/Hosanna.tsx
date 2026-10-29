"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	HOSANNA_AHEAD,
	HOSANNA_MAX_WASTED,
	HOSANNA_PATCH,
	HOSANNA_RAMP,
	HOSANNA_SECONDS,
	HOSANNA_SPEED,
	HOSANNA_WIN_SHARE,
	HOSANNA_ZONE,
	hosannaInZone,
	hosannaResult,
	hosannaRoadX,
	hosannaShare,
	hosannaZoneX,
	newHosanna,
	stepHosanna,
	type HosannaEvent,
	type HosannaState,
} from "@/lib/beta/games/hosanna-rules";

/**
 * Hosanna! (LC-17851), Matthew 21:1-11: Jesus rides the colt along the road
 * into Jerusalem on a bright morning while the multitude lines the way with
 * palm branches. Bare patches of road come toward the colt; Space or a tap
 * lays a garment or a branch on whatever is in the glowing "lay here" zone
 * just in front of it. A run of covered patches makes the crowd cry Hosanna.
 */

const LAY_KEYS = new Set([" "]);
const COLT_X = 120;
const ZONE_X = COLT_X + HOSANNA_AHEAD;
const ROAD_TOP = 268;
const ROAD_Y = 300;
const ROAD_BOTTOM = 334;
const GARMENTS = ["#b8324a", "#3a5fb0", "#7a3f9c", "#d9822b"];

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
	color: string;
	leaf: boolean;
}

interface Word {
	text: string;
	x: number;
	y: number;
	age: number;
	color: string;
	size: number;
}

/** The time the next bare patch reaches the middle of the zone. */
function zoneTimeFor(x: number) {
	const reach = x - HOSANNA_AHEAD;
	return (-HOSANNA_SPEED + Math.sqrt(HOSANNA_SPEED * HOSANNA_SPEED + 2 * HOSANNA_RAMP * reach)) / HOSANNA_RAMP;
}

function hash(n: number) {
	const s = Math.sin(n * 91.7) * 24634.6345;
	return s - Math.floor(s);
}

function drawPalm(context: CanvasRenderingContext2D, x: number, y: number, size: number, sway: number) {
	context.fillStyle = "#3f8a3a";
	for (let i = 0; i < 7; i++) {
		const angle = -Math.PI / 2 + (i - 3) * 0.42 + sway * 0.1;
		context.save();
		context.translate(x, y);
		context.rotate(angle);
		context.beginPath();
		context.ellipse(size * 0.5, 0, size * 0.5, size * 0.09, 0, 0, Math.PI * 2);
		context.fill();
		context.restore();
	}
}

function drawPerson(context: CanvasRenderingContext2D, x: number, y: number, height: number, robe: string, armsUp: number, frond: boolean) {
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - height * 0.17, y);
	context.lineTo(x - height * 0.1, y - height * 0.72);
	context.lineTo(x + height * 0.1, y - height * 0.72);
	context.lineTo(x + height * 0.17, y);
	context.closePath();
	context.fill();
	context.fillStyle = "#b9835a";
	context.beginPath();
	context.arc(x, y - height * 0.84, height * 0.12, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = robe;
	context.lineWidth = height * 0.08;
	context.lineCap = "round";
	const reach = 0.25 + 0.35 * armsUp;
	context.beginPath();
	context.moveTo(x + height * 0.08, y - height * 0.64);
	context.lineTo(x + height * 0.2, y - height * (0.64 + reach));
	context.stroke();
	if (frond) drawPalm(context, x + height * 0.2, y - height * (0.66 + reach), height * 0.42, armsUp);
}

/** Jesus on the colt: a robed figure in soft light, no face drawn. */
function drawRider(context: CanvasRenderingContext2D, x: number, y: number, step: number) {
	const glow = context.createRadialGradient(x, y - 70, 6, x, y - 70, 70);
	glow.addColorStop(0, "rgba(255,248,220,.85)");
	glow.addColorStop(1, "rgba(255,248,220,0)");
	context.fillStyle = glow;
	context.fillRect(x - 80, y - 150, 160, 160);
	// The colt.
	context.fillStyle = "#8a7a6c";
	context.beginPath();
	context.ellipse(x, y - 30, 30, 13, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(x + 22, y - 36);
	context.lineTo(x + 40, y - 56);
	context.lineTo(x + 50, y - 50);
	context.lineTo(x + 32, y - 28);
	context.closePath();
	context.fill();
	context.beginPath();
	context.ellipse(x + 50, y - 50, 9, 6, 0.5, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(x + 42, y - 58);
	context.lineTo(x + 40, y - 72);
	context.lineTo(x + 46, y - 60);
	context.fill();
	context.strokeStyle = "#6f6155";
	context.lineWidth = 5;
	context.lineCap = "round";
	const swing = Math.sin(step) * 6;
	context.beginPath();
	for (const [lx, phase] of [
		[x - 20, 1],
		[x - 12, -1],
		[x + 14, -1],
		[x + 22, 1],
	] as const) {
		context.moveTo(lx, y - 24);
		context.lineTo(lx + swing * phase, y);
	}
	context.stroke();
	// The rider.
	context.fillStyle = "#fbf3e2";
	context.beginPath();
	context.moveTo(x - 16, y - 28);
	context.lineTo(x - 8, y - 78);
	context.lineTo(x + 10, y - 78);
	context.lineTo(x + 18, y - 28);
	context.closePath();
	context.fill();
	context.fillStyle = "#c8452f";
	context.fillRect(x - 3, y - 76, 7, 44);
	context.fillStyle = "#fbf3e2";
	context.beginPath();
	context.arc(x + 1, y - 88, 10, 0, Math.PI * 2);
	context.fill();
}

export default function Hosanna({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<HosannaState>(newHosanna(seed));
	const taps = useRef(0);
	const ended = useRef(false);
	const sparks = useRef<Spark[]>([]);
	const words = useRef<Word[]>([]);
	const laidAt = useRef<Map<number, number>>(new Map());
	const cheer = useRef(-9);
	const shake = useRef(0);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: HosannaEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "lay") {
				play.noise(0.14, { volume: 0.14, filter: 2600 });
				const notes = [523, 587, 659, 784, 880, 1047];
				play.tone(notes[Math.min(notes.length - 1, event.streak - 1)], 0.2, { type: "triangle", volume: 0.16 });
				if (event.streak >= 3 && event.streak % 3 === 0) [659, 784, 1047].forEach((note, index) => play.tone(note, 0.5, { type: "triangle", volume: 0.12, delay: 0.08 + index * 0.08 }));
			}
			if (event.type === "waste") play.noise(0.25, { volume: 0.2, filter: 500 });
			if (event.type === "missed") play.tone(220, 0.25, { type: "square", volume: 0.07, to: 160 });
			if (event.type === "end") {
				if (event.won) [523, 659, 784, 1047].forEach((note, index) => play.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: index * 0.1 }));
				else play.tone(262, 0.9, { type: "sine", volume: 0.16, to: 175 });
			}
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const pressed = takePresses(keys).some((key) => LAY_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const events: HosannaEvent[] = [];
		stepHosanna(run, { lay: pressed }, events);
		for (const event of events) {
			sound(event);
			if (event.type === "lay") {
				laidAt.current.set(event.index, run.t);
				const x = run.patches[event.index].x - hosannaRoadX(run.t) + COLT_X;
				for (let i = 0; i < 16; i++) {
					sparks.current.push({ x: x + (Math.random() - 0.5) * 24, y: ROAD_Y - 4, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 120, age: 0, life: 0.7, color: i % 3 ? "#5fbf4a" : "#ffe08a", leaf: i % 3 !== 0 });
				}
				if (event.streak >= 3 && event.streak % 3 === 0) {
					cheer.current = run.t;
					words.current.push({ text: "Hosanna!", x: 230, y: 110, age: 0, color: "#ffd84a", size: 40 });
				} else words.current.push({ text: event.streak > 1 ? `×${event.streak}` : "Laid!", x, y: ROAD_TOP - 26, age: 0, color: "#ffffff", size: 18 });
			}
			if (event.type === "waste") {
				// Late when a patch has just left the zone; otherwise the press came before the next one reached it.
				const zone = hosannaZoneX(run.t);
				const late = run.patches.some((patch) => patch.cover === "missed" && patch.x < zone - HOSANNA_ZONE && patch.x >= zone - HOSANNA_ZONE - 45);
				words.current.push({ text: late ? "Too late!" : "Too soon!", x: ZONE_X, y: ROAD_TOP - 26, age: 0, color: "#ff8f7a", size: 18 });
				for (let i = 0; i < 10; i++) sparks.current.push({ x: ZONE_X + (Math.random() - 0.5) * 20, y: ROAD_Y, vx: (Math.random() - 0.5) * 80, vy: -30 - Math.random() * 50, age: 0, life: 0.6, color: "#c9a77a", leaf: false });
				if (!reducedMotion) shake.current = 0.2;
			}
			if (event.type === "missed") words.current.push({ text: "Bare!", x: ZONE_X - 30, y: ROAD_TOP - 26, age: 0, color: "#ffb3a6", size: 18 });
		}
		for (const spark of sparks.current) {
			spark.age += 1 / 60;
			spark.x += (spark.vx - (HOSANNA_SPEED + HOSANNA_RAMP * run.t) * 0.6) / 60;
			spark.y += spark.vy / 60;
			spark.vy += 240 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.age < spark.life);
		for (const word of words.current) word.age += 1 / 60;
		words.current = words.current.filter((word) => word.age < 1);
		shake.current = Math.max(0, shake.current - 1 / 60);
		onTime(Math.max(0, HOSANNA_SECONDS - run.t));
		ticks.current++;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			const next = run.patches.find((patch) => patch.cover === "bare" && patch.x >= hosannaZoneX(run.t) - 2);
			canvas.dataset.lay = `${run.t.toFixed(2)}|${next ? zoneTimeFor(next.x).toFixed(3) : "99"}`;
		}
		const result = hosannaResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const road = hosannaRoadX(run.t);
			const cheering = run.t - cheer.current < 1.2 || run.phase === "won";
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 80) * shake.current * 9, 0);

			// A bright morning; Jerusalem's walls rise ahead as the round goes on.
			const sky = context.createLinearGradient(0, 0, 0, ROAD_TOP);
			sky.addColorStop(0, "#5fb4ef");
			sky.addColorStop(1, "#cfeefc");
			context.fillStyle = sky;
			context.fillRect(-20, 0, STAGE + 40, ROAD_TOP);
			context.fillStyle = "#fff8d6";
			context.beginPath();
			context.arc(300, 96, 22, 0, Math.PI * 2);
			context.fill();
			const city = STAGE + 160 - (run.t / HOSANNA_SECONDS) * 230;
			context.fillStyle = "#e7cf9a";
			context.fillRect(city, 150, 260, ROAD_TOP - 150);
			context.fillStyle = "#d8b979";
			for (let i = 0; i < 9; i++) context.fillRect(city + i * 30, 140, 16, 12);
			context.fillRect(city + 40, 112, 50, 40);
			context.fillStyle = "#8e6a3a";
			context.beginPath();
			context.arc(city + 65, ROAD_TOP - 30, 18, Math.PI, 0);
			context.fillRect(city + 47, ROAD_TOP - 30, 36, 30);
			context.fill();
			context.fillStyle = "#b9d99a";
			context.fillRect(-20, 220, STAGE + 40, ROAD_TOP - 220);

			// Palm trees and the back row of the multitude, waving branches.
			for (let i = -1; i < 7; i++) {
				const x = ((i * 70 - road * 0.5) % 490) + 490 * (i * 70 - road * 0.5 < 0 ? 1 : 0) - 40;
				context.fillStyle = "#8a6a42";
				context.fillRect(x - 3, 170, 6, 60);
				drawPalm(context, x, 172, 34, reducedMotion ? 0 : Math.sin(time * 2 + i));
			}
			for (let i = 0; i < 12; i++) {
				const x = ((i * 38 - road * 0.8) % 456) + (i * 38 - road * 0.8 < 0 ? 456 : 0) - 28;
				const jump = cheering && !reducedMotion ? Math.abs(Math.sin(time * 9 + i)) * 6 : 0;
				drawPerson(context, x, ROAD_TOP - 2 - jump, 40, ["#7d5a8c", "#3c6e8f", "#9a5b3a", "#5c7d3e"][i % 4], cheering ? 1 : reducedMotion ? 0.4 : 0.4 + 0.3 * Math.sin(time * 4 + i), true);
			}

			// The road, the patches already covered behind, and the bare ones coming.
			context.fillStyle = "#e3c58f";
			context.fillRect(-20, ROAD_TOP, STAGE + 40, ROAD_BOTTOM - ROAD_TOP);
			context.fillStyle = "#d2b27a";
			context.fillRect(-20, ROAD_BOTTOM - 8, STAGE + 40, 8);
			run.patches.forEach((patch, index) => {
				const x = patch.x - road + COLT_X;
				if (x < -40 || x > STAGE + 40) return;
				if (patch.cover === "bare" || patch.cover === "missed") {
					context.fillStyle = patch.cover === "missed" ? "#a98a5c" : "#b8955f";
					context.beginPath();
					context.ellipse(x, ROAD_Y, HOSANNA_PATCH + 4, 12, 0, 0, Math.PI * 2);
					context.fill();
					context.strokeStyle = patch.cover === "missed" ? "rgba(140,40,30,.7)" : "rgba(90,60,30,.65)";
					context.setLineDash([4, 3]);
					context.lineWidth = 2;
					context.stroke();
					context.setLineDash([]);
					if (patch.cover === "missed") {
						context.strokeStyle = "#b8392b";
						context.lineWidth = 3;
						context.beginPath();
						context.moveTo(x - 7, ROAD_Y - 7);
						context.lineTo(x + 7, ROAD_Y + 7);
						context.moveTo(x + 7, ROAD_Y - 7);
						context.lineTo(x - 7, ROAD_Y + 7);
						context.stroke();
					}
					return;
				}
				const laid = laidAt.current.get(index) ?? -9;
				const drop = Math.min(1, (run.t - laid) / 0.15);
				const y = ROAD_Y - (1 - drop) * 30;
				if (patch.cover === "garment") {
					context.fillStyle = GARMENTS[index % GARMENTS.length];
					context.beginPath();
					context.roundRect(x - HOSANNA_PATCH - 4, y - 10, (HOSANNA_PATCH + 4) * 2, 20, 4);
					context.fill();
					context.fillStyle = "rgba(255,255,255,.35)";
					context.fillRect(x - HOSANNA_PATCH, y - 6, (HOSANNA_PATCH + 4) * 2 - 8, 3);
				} else {
					context.save();
					context.translate(x, y);
					context.rotate(-0.15 + hash(index) * 0.3);
					context.strokeStyle = "#2f7a2c";
					context.lineWidth = 3;
					context.beginPath();
					context.moveTo(-HOSANNA_PATCH - 4, 0);
					context.lineTo(HOSANNA_PATCH + 4, 0);
					context.stroke();
					context.strokeStyle = "#4fae3e";
					context.lineWidth = 2.4;
					for (let k = -3; k <= 3; k++) {
						context.beginPath();
						context.moveTo(k * 5, 0);
						context.lineTo(k * 5 + 6, -9);
						context.moveTo(k * 5, 0);
						context.lineTo(k * 5 + 6, 9);
						context.stroke();
					}
					context.restore();
				}
			});

			// The "lay here" zone, bright when a bare patch is in it.
			const inZone = hosannaInZone(run) >= 0;
			const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 12);
			context.fillStyle = inZone ? `rgba(255,216,74,${0.35 + pulse * 0.25})` : "rgba(255,240,180,.18)";
			context.fillRect(ZONE_X - HOSANNA_ZONE - HOSANNA_PATCH, ROAD_TOP + 2, (HOSANNA_ZONE + HOSANNA_PATCH) * 2, ROAD_BOTTOM - ROAD_TOP - 4);
			context.strokeStyle = inZone ? "#ffd84a" : "rgba(255,255,255,.8)";
			context.lineWidth = inZone ? 4 : 2;
			context.strokeRect(ZONE_X - HOSANNA_ZONE - HOSANNA_PATCH, ROAD_TOP + 2, (HOSANNA_ZONE + HOSANNA_PATCH) * 2, ROAD_BOTTOM - ROAD_TOP - 4);
			drawRider(context, COLT_X, ROAD_Y + 6, reducedMotion ? 0 : run.t * 10);

			// The front row of the multitude, below the road.
			context.fillStyle = "#c9b07e";
			context.fillRect(-20, ROAD_BOTTOM, STAGE + 40, STAGE - ROAD_BOTTOM);
			for (let i = 0; i < 9; i++) {
				const x = ((i * 52 - road) % 468) + (i * 52 - road < 0 ? 468 : 0) - 34;
				const jump = cheering && !reducedMotion ? Math.abs(Math.sin(time * 10 + i * 1.3)) * 8 : 0;
				drawPerson(context, x, STAGE + 6 - jump, 58, ["#a3423c", "#2f5f8a", "#6b4a8a", "#80602f"][i % 4], cheering ? 1 : 0.3, i % 2 === 0);
			}

			// The zone's label, over the front row so it is never hidden.
			context.fillStyle = "rgba(30,40,60,.7)";
			context.beginPath();
			context.roundRect(ZONE_X - 40, ROAD_BOTTOM + 11, 80, 22, 8);
			context.fill();
			context.fillStyle = inZone ? "#ffd84a" : "#ffffff";
			context.font = "900 13px system-ui, sans-serif";
			context.textAlign = "center";
			context.lineWidth = 3;
			context.strokeStyle = "rgba(60,40,10,.6)";
			context.strokeText(inZone ? "LAY NOW!" : "LAY HERE", ZONE_X, ROAD_BOTTOM + 26);
			context.fillText(inZone ? "LAY NOW!" : "LAY HERE", ZONE_X, ROAD_BOTTOM + 26);
			context.beginPath();
			context.moveTo(ZONE_X - 8, ROAD_BOTTOM + 13);
			context.lineTo(ZONE_X + 8, ROAD_BOTTOM + 13);
			context.lineTo(ZONE_X, ROAD_BOTTOM + 3);
			context.fill();

			for (const spark of sparks.current) {
				context.globalAlpha = 1 - spark.age / spark.life;
				context.fillStyle = spark.color;
				if (spark.leaf) {
					context.beginPath();
					context.ellipse(spark.x, spark.y, 4, 1.6, spark.age * 8, 0, Math.PI * 2);
					context.fill();
				} else context.fillRect(spark.x, spark.y, 3, 3);
			}
			context.globalAlpha = 1;
			for (const word of words.current) {
				const scale = word.size > 30 ? 1 + 0.3 * Math.max(0, 1 - word.age * 5) : 1;
				context.globalAlpha = Math.min(1, 2 * (1 - word.age));
				context.font = `900 ${Math.round(word.size * scale)}px system-ui, sans-serif`;
				context.lineWidth = word.size > 30 ? 6 : 4;
				context.strokeStyle = "rgba(70,40,10,.6)";
				context.strokeText(word.text, word.x, word.y - word.age * 24);
				context.fillStyle = word.color;
				context.fillText(word.text, word.x, word.y - word.age * 24);
			}
			context.globalAlpha = 1;
			context.restore();

			// The way covered, the line to reach, and the branches that may fall in the dust.
			context.fillStyle = "rgba(30,40,60,.55)";
			context.beginPath();
			context.roundRect(10, 10, 228, 50, 12);
			context.fill();
			context.fillStyle = "#fff";
			context.font = "800 13px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillText(`Way covered ${run.covered}/${run.patches.length}`, 20, 29);
			context.fillStyle = "rgba(255,255,255,.2)";
			context.fillRect(20, 38, 208, 12);
			context.fillStyle = "#ffd84a";
			context.fillRect(20, 38, 208 * hosannaShare(run), 12);
			context.fillStyle = "#fff";
			context.fillRect(20 + 208 * HOSANNA_WIN_SHARE - 1, 34, 3, 20);
			context.fillStyle = "rgba(30,40,60,.55)";
			context.beginPath();
			context.roundRect(STAGE - 150, 10, 140, 50, 12);
			context.fill();
			context.fillStyle = "#fff";
			context.fillText("Dropped", STAGE - 140, 29);
			for (let i = 0; i < HOSANNA_MAX_WASTED + 1; i++) {
				context.fillStyle = i < run.wasted ? "#ff7a66" : i === HOSANNA_MAX_WASTED ? "rgba(255,122,102,.3)" : "rgba(255,255,255,.3)";
				context.beginPath();
				context.arc(STAGE - 134 + i * 21, 45, 7, 0, Math.PI * 2);
				context.fill();
			}

			// The first seconds: what to do, plainly.
			if (run.t < 2.4 && run.phase === "playing") {
				context.globalAlpha = run.t < 1.9 ? 1 : 1 - (run.t - 1.9) / 0.5;
				context.fillStyle = "rgba(30,40,60,.72)";
				context.beginPath();
				context.roundRect(ZONE_X - 40, 182, 210, 54, 12);
				context.fill();
				context.fillStyle = "#ffd84a";
				context.font = "900 16px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Lay a branch when a bare", ZONE_X + 65, 204);
				context.fillText("patch is in the zone", ZONE_X + 65, 224);
				context.strokeStyle = "#ffd84a";
				context.lineWidth = 3;
				context.beginPath();
				context.arc(ZONE_X, ROAD_Y, 34 + (reducedMotion ? 0 : (time * 40) % 18), 0, Math.PI * 2);
				context.stroke();
				context.globalAlpha = 1;
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,240,170,.16)";
				context.fillRect(0, 0, STAGE, STAGE);
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
			aria-label="Jesus rides the colt into Jerusalem. Tap, or press Space, to lay a branch when a bare patch of road is in the glowing zone in front of the colt."
		/>
	);
}
