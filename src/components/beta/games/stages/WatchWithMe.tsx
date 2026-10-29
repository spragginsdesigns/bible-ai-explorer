"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "@/components/beta/games/stage-kit";
import type { StageProps } from "@/components/beta/games/types";
import {
	VIGIL_HEAVY,
	VIGIL_NAMES,
	VIGIL_NODDING,
	VIGIL_SECONDS,
	VIGIL_SLIP_LIMIT,
	newVigil,
	stepVigil,
	vigilResult,
	type VigilEvent,
	type VigilState,
} from "@/lib/beta/games/watch-with-me-rules";

/**
 * Watch with Me (LC-17851), Matthew 26:36-41: Gethsemane at night under the
 * moon and the olive trees. Peter, James and John sit, numbered 1, 2 and 3;
 * their eyelids droop and their heads nod as the meter under each drains.
 * Press a disciple's number, or tap him, to wake him once his eyes are heavy.
 * Far off, the Lord kneels in prayer in a soft light.
 */

const KEYS: Record<string, number> = { "1": 0, "2": 1, "3": 2 };
const SEATS = [70, 200, 330];
const GROUND = 300;
const ROBES = ["#6d5a48", "#4f6577", "#6b5876"];
const MANTLES = ["#8a3f35", "#3d4f3c", "#a07a3e"];
const WAKE_NOTES = [440, 554, 659];
const STARS = Array.from({ length: 28 }, (_, index) => ({ x: (index * 89 + 17) % 400, y: (index * 41 + 9) % 130, r: index % 5 === 0 ? 1.3 : 0.8 }));

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
}

function olive(context: CanvasRenderingContext2D, x: number, y: number, size: number, flip: number, time: number, still: boolean) {
	context.save();
	context.translate(x, y);
	context.scale(flip, 1);
	context.fillStyle = "#2b2620";
	context.beginPath();
	context.moveTo(-10 * size, 0);
	context.bezierCurveTo(-14 * size, -40 * size, 10 * size, -50 * size, -4 * size, -90 * size);
	context.lineTo(8 * size, -88 * size);
	context.bezierCurveTo(20 * size, -50 * size, 2 * size, -40 * size, 12 * size, 0);
	context.closePath();
	context.fill();
	const sway = still ? 0 : Math.sin(time * 0.8) * 2;
	const leaves: [number, number, number, string][] = [
		[-30, -100, 34, "#2f4237"],
		[10, -118, 38, "#364c40"],
		[42, -96, 30, "#2f4237"],
		[-8, -92, 30, "#4a6352"],
		[24, -108, 22, "#5b7663"],
	];
	for (const [lx, ly, r, color] of leaves) {
		context.fillStyle = color;
		context.beginPath();
		context.ellipse((lx + sway) * size, ly * size, r * size, r * 0.62 * size, 0, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "rgba(190,215,200,.18)";
	for (const [lx, ly, r] of leaves) {
		context.beginPath();
		context.ellipse((lx + sway - r * 0.25) * size, (ly - r * 0.25) * size, r * 0.5 * size, r * 0.22 * size, -0.3, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

export default function WatchWithMe({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<VigilState>(newVigil(seed));
	const taps = useRef<number[]>([]);
	const sparks = useRef<Spark[]>([]);
	const popups = useRef<{ disciple: number; born: number; text: string; good: boolean }[]>([]);
	const shake = useRef(0);
	const ended = useRef(false);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const handle = useCallback(
		(event: VigilEvent) => {
			const play = synth.current;
			const t = state.current.t;
			if (event.type === "wake") {
				const x = SEATS[event.disciple];
				for (let i = 0; i < 14; i++) {
					const angle = (i / 14) * Math.PI * 2;
					sparks.current.push({ x, y: GROUND - 78, vx: Math.cos(angle) * 70, vy: Math.sin(angle) * 70, born: t, life: 0.5, color: i % 2 ? "#fff3c4" : "#bcd7ff" });
				}
				popups.current.push({ disciple: event.disciple, born: t, text: event.awake < VIGIL_NODDING ? "Just in time!" : "Awake!", good: true });
				play?.tone(WAKE_NOTES[event.disciple], 0.22, { type: "triangle", volume: 0.16, to: WAKE_NOTES[event.disciple] * 1.5 });
			}
			if (event.type === "slip") {
				popups.current.push({ disciple: event.disciple, born: t, text: "Still awake!", good: false });
				if (!reducedMotion) shake.current = 6;
				play?.tone(140, 0.25, { type: "sawtooth", volume: 0.12, to: 100 });
			}
			if (event.type === "nodding") play?.tone(98, 0.5, { type: "sine", volume: 0.1, to: 82 });
			if (event.type === "asleep") {
				if (!reducedMotion) shake.current = 5;
				play?.tone(196, 1.2, { type: "sine", volume: 0.2, to: 98 });
			}
			if (event.type === "won") [392, 494, 587, 784].forEach((note, index) => play?.tone(note, 1.6, { type: "sine", volume: 0.12, delay: index * 0.14 }));
		},
		[reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const wake = takePresses(keys)
			.map((key) => KEYS[key])
			.filter((index): index is number => index !== undefined);
		wake.push(...taps.current.splice(0));
		const events: VigilEvent[] = [];
		stepVigil(run, { wake }, events);
		for (const event of events) handle(event);
		onTime(Math.max(0, VIGIL_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			canvas.dataset.meters = run.disciples.map((disciple) => disciple.awake.toFixed(2)).join(",");
			canvas.dataset.slips = String(run.slips);
		}
		const result = vigilResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [handle, keys, onEnd, onTime]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			const still = reducedMotion;
			context.save();
			if (shake.current > 0.2) {
				context.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
				shake.current *= 0.85;
			}

			// The night over the garden, the moon and its soft halo.
			const sky = context.createLinearGradient(0, 0, 0, 240);
			sky.addColorStop(0, "#070b1e");
			sky.addColorStop(1, "#16304a");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 260);
			for (const [index, star] of STARS.entries()) {
				context.fillStyle = `rgba(230,236,255,${still ? 0.7 : 0.45 + 0.35 * Math.sin(time * 1.5 + index * 1.7)})`;
				context.fillRect(star.x, star.y, star.r * 1.6, star.r * 1.6);
			}
			const moonHalo = context.createRadialGradient(330, 52, 10, 330, 52, 80);
			moonHalo.addColorStop(0, "rgba(220,230,255,.4)");
			moonHalo.addColorStop(1, "rgba(220,230,255,0)");
			context.fillStyle = moonHalo;
			context.fillRect(240, -30, 180, 170);
			context.fillStyle = "#eef1ff";
			context.beginPath();
			context.arc(330, 52, 20, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#1c2f3e";
			context.beginPath();
			context.moveTo(-10, 196);
			context.quadraticCurveTo(110, 150, 220, 180);
			context.quadraticCurveTo(320, 160, 410, 186);
			context.lineTo(410, 260);
			context.lineTo(-10, 260);
			context.fill();
			const ground = context.createLinearGradient(0, 180, 0, STAGE);
			ground.addColorStop(0, "#182b2a");
			ground.addColorStop(1, "#0d1817");
			context.fillStyle = ground;
			context.fillRect(-10, 200, STAGE + 20, STAGE);

			// Far off, the Lord kneels by a rock and prays in a soft light (v39).
			const lordX = 266;
			const lordY = 174;
			const light = context.createRadialGradient(lordX, lordY - 14, 2, lordX, lordY - 14, 64);
			const breathe = still ? 1 : 0.9 + 0.1 * Math.sin(time * 1.2);
			light.addColorStop(0, `rgba(255,246,214,${0.75 * breathe})`);
			light.addColorStop(0.4, `rgba(255,236,180,${0.25 * breathe})`);
			light.addColorStop(1, "rgba(255,236,180,0)");
			context.fillStyle = light;
			context.fillRect(lordX - 70, lordY - 80, 140, 140);
			context.fillStyle = "#3a4440";
			context.beginPath();
			context.ellipse(lordX + 14, lordY - 2, 14, 8, 0, Math.PI, Math.PI * 2);
			context.fill();
			context.fillStyle = "#f6efdf";
			context.beginPath();
			context.moveTo(lordX - 9, lordY);
			context.quadraticCurveTo(lordX - 8, lordY - 16, lordX - 1, lordY - 20);
			context.lineTo(lordX + 5, lordY - 14);
			context.lineTo(lordX + 4, lordY);
			context.closePath();
			context.fill();
			context.beginPath();
			context.arc(lordX + 1, lordY - 24, 3.8, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = "#f6efdf";
			context.lineWidth = 2;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(lordX + 2, lordY - 16);
			context.lineTo(lordX + 9, lordY - 9);
			context.stroke();

			// The olive trees framing the garden.
			olive(context, 18, 236, 1.05, 1, time, still);
			olive(context, 392, 230, 1.15, -1, time + 1, still);
			context.fillStyle = "rgba(40,70,60,.7)";
			for (let i = 0; i < 18; i++) {
				const gx = (i * 61 + 11) % 400;
				const gy = 214 + ((i * 37) % 160);
				context.beginPath();
				context.moveTo(gx, gy);
				context.lineTo(gx + 2, gy - 6);
				context.lineTo(gx + 4, gy);
				context.fill();
			}

			// Peter, James and John: heavy eyes, nodding heads, the meter under each.
			run.disciples.forEach((disciple, index) => {
				const x = SEATS[index];
				const awake = disciple.awake;
				const heavy = awake < VIGIL_HEAVY;
				const nodding = awake < VIGIL_NODDING;
				const sinceWake = t - disciple.wokenAt;
				const jolt = sinceWake < 0.3 ? 1 - sinceWake / 0.3 : 0;
				const droop = 1 - awake;
				const nod = nodding && !still ? Math.max(0, Math.sin(time * 4 + index)) * 5 : 0;
				const headTilt = droop * 0.55 - jolt * 0.2;
				const headX = x + droop * 7;
				const headY = GROUND - 82 + droop * 16 + nod - jolt * 6;

				// Moonlit body, seated.
				context.fillStyle = "rgba(0,0,0,.35)";
				context.beginPath();
				context.ellipse(x, GROUND + 2, 40, 7, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = ROBES[index];
				context.beginPath();
				context.moveTo(x - 38, GROUND);
				context.quadraticCurveTo(x - 34, GROUND - 40, x - 14 + droop * 4, GROUND - 66 + droop * 8);
				context.lineTo(x + 12 + droop * 6, GROUND - 66 + droop * 8);
				context.quadraticCurveTo(x + 34, GROUND - 40, x + 38, GROUND);
				context.closePath();
				context.fill();
				context.fillStyle = MANTLES[index];
				context.beginPath();
				context.moveTo(x - 16 + droop * 4, GROUND - 64 + droop * 8);
				context.quadraticCurveTo(x - 4, GROUND - 30, x - 26, GROUND - 6);
				context.lineTo(x - 18, GROUND - 4);
				context.quadraticCurveTo(x + 4, GROUND - 34, x - 4 + droop * 4, GROUND - 64 + droop * 8);
				context.closePath();
				context.fill();
				context.fillStyle = "rgba(200,220,255,.12)";
				context.beginPath();
				context.ellipse(x + 18, GROUND - 40, 8, 24, -0.3, 0, Math.PI * 2);
				context.fill();

				// The head, eyelids drooping as he grows drowsy.
				context.save();
				context.translate(headX, headY);
				context.rotate(headTilt);
				context.fillStyle = "#b98a68";
				context.beginPath();
				context.arc(0, 0, 15, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#3b2a20";
				context.beginPath();
				context.arc(0, -3, 15.5, Math.PI * 1.02, Math.PI * 1.98);
				context.fill();
				if (index === 0) {
					context.fillStyle = "#6d6a66";
					context.beginPath();
					context.arc(0, 8, 10, 0.1 * Math.PI, 0.9 * Math.PI);
					context.fill();
				}
				const open = Math.max(0, Math.min(1, (awake - 0.08) / 0.62)) + jolt * 0.3;
				for (const side of [-1, 1]) {
					const ex = side * 5.5;
					context.fillStyle = "#f4efe6";
					context.beginPath();
					context.ellipse(ex, 1, 3.4, Math.max(0.4, 3 * Math.min(1, open)), 0, 0, Math.PI * 2);
					context.fill();
					if (open > 0.25) {
						context.fillStyle = "#2a1f18";
						context.beginPath();
						context.arc(ex, 1.4, 1.5 * Math.min(1, open), 0, Math.PI * 2);
						context.fill();
					}
					context.strokeStyle = "#5a3c2c";
					context.lineWidth = 1.4;
					context.beginPath();
					context.moveTo(ex - 3.6, 1 - 3 * Math.min(1, open));
					context.lineTo(ex + 3.6, 1 - 3 * Math.min(1, open));
					context.stroke();
				}
				context.restore();

				// Zzz as he nods off.
				if (nodding) {
					context.font = "900 13px system-ui, sans-serif";
					context.textAlign = "left";
					for (let i = 0; i < 3; i++) {
						const phase = still ? i / 3 : (time * 0.9 + i / 3) % 1;
						context.fillStyle = `rgba(200,215,255,${0.9 * (1 - phase)})`;
						context.fillText("z", headX + 14 + phase * 16 + i * 2, headY - 14 - phase * 26);
					}
				}

				// The meter: wide awake above the line, heavy-eyed below it (wake him now), red when nodding.
				const meterLeft = x - 44;
				const meterTop = GROUND + 14;
				context.fillStyle = "rgba(0,0,0,.5)";
				context.beginPath();
				context.roundRect(meterLeft - 3, meterTop - 3, 94, 16, 7);
				context.fill();
				context.fillStyle = "rgba(255,200,87,.22)";
				context.beginPath();
				context.roundRect(meterLeft, meterTop, 88 * VIGIL_HEAVY, 10, 5);
				context.fill();
				context.fillStyle = nodding ? (still || Math.sin(time * 16) > 0 ? "#ff4b3a" : "#c7372a") : heavy ? "#ffc857" : "#9fc4ff";
				context.beginPath();
				context.roundRect(meterLeft, meterTop, Math.max(2, 88 * awake), 10, 5);
				context.fill();
				context.fillStyle = "#fff";
				context.fillRect(meterLeft + 88 * VIGIL_HEAVY - 1, meterTop - 5, 2, 20);

				// His number, glowing when it is time to press it.
				const pulse = still ? 1 : 0.6 + 0.4 * Math.sin(time * 10 + index);
				const keyTop = GROUND + 38;
				if (heavy) {
					const glow = context.createRadialGradient(x - 26, keyTop + 16, 4, x - 26, keyTop + 16, 34);
					glow.addColorStop(0, `rgba(255,214,102,${0.6 * pulse})`);
					glow.addColorStop(1, "rgba(255,214,102,0)");
					context.fillStyle = glow;
					context.fillRect(x - 64, keyTop - 22, 76, 76);
				}
				context.fillStyle = heavy ? "#ffd166" : "rgba(255,255,255,.18)";
				context.strokeStyle = heavy ? "#fff3c4" : "rgba(255,255,255,.4)";
				context.lineWidth = 2;
				context.beginPath();
				context.roundRect(x - 42, keyTop, 32, 32, 8);
				context.fill();
				context.stroke();
				context.fillStyle = heavy ? "#1a1408" : "rgba(255,255,255,.75)";
				context.font = "900 20px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(String(index + 1), x - 26, keyTop + 23);
				context.font = "800 13px system-ui, sans-serif";
				context.textAlign = "left";
				context.fillStyle = heavy ? "#ffe39a" : "rgba(255,255,255,.7)";
				context.fillText(VIGIL_NAMES[index], x - 4, keyTop + 14);
				context.font = "800 10px system-ui, sans-serif";
				context.fillStyle = nodding ? "#ff8a7a" : heavy ? "#ffd166" : "rgba(255,255,255,.45)";
				context.fillText(nodding ? "WAKE HIM!" : heavy ? "Wake" : "Watching", x - 4, keyTop + 28);
			});

			sparks.current = sparks.current.filter((item) => t - item.born < item.life);
			for (const item of sparks.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / item.life);
				context.fillStyle = item.color;
				context.beginPath();
				context.arc(item.x + item.vx * age, item.y + item.vy * age, 2, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			popups.current = popups.current.filter((item) => t - item.born < 0.8);
			for (const item of popups.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / 0.8);
				context.font = "900 14px system-ui, sans-serif";
				context.textAlign = "center";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(0,0,0,.8)";
				context.fillStyle = item.good ? "#fff3c4" : "#ff6b5a";
				const px = Math.max(52, Math.min(348, SEATS[item.disciple]));
				context.strokeText(item.text, px, GROUND - 112 - age * 20);
				context.fillText(item.text, px, GROUND - 112 - age * 20);
				context.globalAlpha = 1;
			}

			// Slips: shaking one who is still wide awake.
			context.fillStyle = "rgba(0,0,0,.45)";
			context.beginPath();
			context.roundRect(8, 8, 118, 28, 10);
			context.fill();
			context.font = "800 11px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillStyle = "#fff";
			context.fillText("Slips", 16, 26);
			for (let i = 0; i < VIGIL_SLIP_LIMIT; i++) {
				context.beginPath();
				context.arc(60 + i * 20, 22, 6.5, 0, Math.PI * 2);
				if (i < run.slips) {
					context.fillStyle = "#ff5a46";
					context.fill();
				} else {
					context.strokeStyle = "rgba(255,255,255,.7)";
					context.lineWidth = 2;
					context.stroke();
				}
			}
			if (run.asleep !== null) {
				context.fillStyle = "rgba(5,8,20,.45)";
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,246,214,.12)";
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused || !canvasRef.current) return;
		const point = stagePoint(canvasRef.current, event);
		if (point.y < 150) return;
		taps.current.push(point.x < 135 ? 0 : point.x < 265 ? 1 : 2);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="Gethsemane at night. Peter, James and John sit numbered 1, 2 and 3 while the Lord prays far off. Press a disciple's number, or tap him, to wake him when his eyes grow heavy."
		/>
	);
}
