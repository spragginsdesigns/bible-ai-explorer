"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "@/components/beta/games/stage-kit";
import type { StageProps } from "@/components/beta/games/types";
import {
	LIGHT_CANDLES,
	LIGHT_MISS_LIMIT,
	LIGHT_OUT_LIMIT,
	LIGHT_SECONDS,
	bushelAt,
	lightLevel,
	lightResult,
	newLight,
	stepLight,
	type LightEvent,
	type LightState,
} from "@/lib/beta/games/let-your-light-shine-rules";

/**
 * Let Your Light Shine (LC-17851), Matthew 5:14-16: a house at night, six
 * candlesticks on the shelf and the table, and through the window a city set
 * on an hill. Bushels drop over the candles; a tap or click lifts one off, and
 * every tenth tap that lifts nothing puts out the nearest candle. The whole
 * room's light follows how many candles still shine.
 */

const WINDOW = { left: 128, right: 272, top: 34, bottom: 166 };
const STARS = Array.from({ length: 22 }, (_, index) => ({
	x: WINDOW.left + 8 + ((index * 53) % 128),
	y: WINDOW.top + 8 + ((index * 37) % 62),
	r: index % 4 === 0 ? 1.4 : 0.8,
}));
/** The city on the hill: each house's left edge, width and height. */
const CITY = [
	[150, 14, 16],
	[163, 12, 24],
	[174, 16, 20],
	[189, 10, 34],
	[198, 18, 26],
	[215, 12, 18],
	[226, 15, 22],
	[240, 12, 14],
];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
	size: number;
}

function flamePath(context: CanvasRenderingContext2D, x: number, y: number, height: number, sway: number) {
	context.beginPath();
	context.moveTo(x, y);
	context.bezierCurveTo(x - height * 0.42, y - height * 0.3, x - height * 0.18 + sway, y - height * 0.8, x + sway, y - height);
	context.bezierCurveTo(x + height * 0.18 + sway, y - height * 0.8, x + height * 0.42, y - height * 0.3, x, y);
	context.closePath();
}

function drawBushel(context: CanvasRenderingContext2D, x: number, y: number, dead: boolean, tilt = 0) {
	// An upturned bushel basket: narrow base on top, the wide mouth over the candle. (x, y) is its centre.
	context.save();
	context.translate(x, y);
	context.rotate(tilt);
	const top = -28;
	const bottom = 28;
	context.fillStyle = dead ? "#4a3829" : "#b98a4e";
	context.beginPath();
	context.moveTo(-19, top);
	context.lineTo(19, top);
	context.lineTo(28, bottom);
	context.lineTo(-28, bottom);
	context.closePath();
	context.fill();
	context.strokeStyle = dead ? "#2e2219" : "#7e5730";
	context.lineWidth = 1.5;
	for (let i = -3; i <= 3; i++) {
		context.beginPath();
		context.moveTo(i * 5.4, top);
		context.lineTo(i * 8, bottom);
		context.stroke();
	}
	context.fillStyle = dead ? "#3a2b20" : "#8a6234";
	context.fillRect(-23, -8, 46, 5);
	context.fillRect(-27, bottom - 6, 54, 7);
	context.fillRect(-20, top, 40, 5);
	if (!dead) {
		context.fillStyle = "rgba(255,230,170,.35)";
		context.beginPath();
		context.moveTo(-16, top + 5);
		context.lineTo(-10, top + 5);
		context.lineTo(-17, bottom - 6);
		context.lineTo(-24, bottom - 6);
		context.closePath();
		context.fill();
	}
	context.restore();
}

export default function LetYourLightShine({ seed, paused, muted, reducedMotion, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<LightState>(newLight(seed));
	const taps = useRef<{ x: number; y: number }[]>([]);
	const particles = useRef<Particle[]>([]);
	const flying = useRef<{ x: number; y: number; born: number; spin: number }[]>([]);
	const misses = useRef<{ x: number; y: number; born: number }[]>([]);
	const level = useRef(1);
	const shake = useRef(0);
	const outFlash = useRef(-9);
	const ended = useRef(false);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, life: number, up = 0) => {
		const t = state.current.t;
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
			const v = speed * (0.4 + Math.random() * 0.6);
			particles.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - up, born: t, life: life * (0.7 + Math.random() * 0.5), color: colors[i % colors.length], size: 1.5 + Math.random() * 2.5 });
		}
	}, []);

	const handle = useCallback(
		(event: LightEvent) => {
			const play = synth.current;
			const t = state.current.t;
			if (event.type === "drop") play?.noise(0.12, { volume: 0.12, filter: 500, delay: 0.3 });
			if (event.type === "lift") {
				flying.current.push({ x: event.x, y: event.y, born: t, spin: Math.random() < 0.5 ? -1 : 1 });
				const candle = LIGHT_CANDLES[event.candle];
				burst(candle.x, candle.y - 48, 16, ["#fff3c4", "#ffd166", "#ffb347"], 90, 0.7, 30);
				play?.tone(660, 0.18, { type: "triangle", volume: 0.16, to: 990 });
				play?.tone(1320, 0.3, { type: "sine", volume: 0.07, delay: 0.06 });
			}
			if (event.type === "miss") {
				misses.current.push({ x: event.x, y: event.y, born: t });
				play?.noise(0.09, { volume: 0.14, filter: 320 });
				play?.tone(150, 0.1, { type: "sine", volume: 0.1, to: 90 });
			}
			if (event.type === "out") {
				const candle = LIGHT_CANDLES[event.candle];
				burst(candle.x, candle.y - 60, 14, ["#6b6670", "#8d8794", "#4d4952"], 30, 1.4, 40);
				outFlash.current = t;
				if (!reducedMotion) shake.current = 7;
				play?.noise(0.5, { volume: 0.2, filter: 2400, type: "highpass" });
				play?.tone(196, 0.5, { type: "sine", volume: 0.18, to: 98 });
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: index * 0.09 }));
			if (event.type === "dark") play?.tone(262, 1.1, { type: "sine", volume: 0.2, to: 110 });
		},
		[burst, reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const events: LightEvent[] = [];
		stepLight(run, { taps: taps.current.splice(0) }, events);
		for (const event of events) handle(event);
		onTime(Math.max(0, LIGHT_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			canvas.dataset.targets = run.bushels.map((bushel) => {
				const at = bushelAt(bushel, run.t);
				return `${Math.round(at.x)},${Math.round(at.y)},${Math.round((bushel.smothers - run.t) * 100)}`;
			}).join(";");
			canvas.dataset.outs = String(run.outs);
		}
		const result = lightResult(run);
		if (result && !ended.current) {
			ended.current = true;
			if (canvas) canvas.dataset.outs = String(run.outs);
			onEnd(result);
		}
	}, [handle, onEnd, onTime]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			level.current += (lightLevel(run) - level.current) * 0.1;
			const light = level.current;
			const flicker = (index: number) => (reducedMotion ? 1 : 0.92 + Math.sin(time * 11 + index * 2.3) * 0.05 + Math.sin(time * 17 + index) * 0.03);

			context.save();
			if (shake.current > 0.2) {
				context.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
				shake.current *= 0.86;
			}

			// The room: plastered wall, the window, the shelf, the table, the floor.
			const wall = context.createLinearGradient(0, 0, 0, STAGE);
			wall.addColorStop(0, "#3b2c4a");
			wall.addColorStop(0.55, "#4a3542");
			wall.addColorStop(1, "#2a1d1c");
			context.fillStyle = wall;
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			context.fillStyle = "#2c1d16";
			context.fillRect(-10, 362, STAGE + 20, 50);

			// Through the window: a city set on an hill, which cannot be hid (v14).
			context.save();
			context.beginPath();
			context.moveTo(WINDOW.left, WINDOW.bottom);
			context.lineTo(WINDOW.left, WINDOW.top + 50);
			context.arc((WINDOW.left + WINDOW.right) / 2, WINDOW.top + 50, (WINDOW.right - WINDOW.left) / 2, Math.PI, 0);
			context.lineTo(WINDOW.right, WINDOW.bottom);
			context.closePath();
			context.clip();
			const sky = context.createLinearGradient(0, WINDOW.top - 20, 0, WINDOW.bottom);
			sky.addColorStop(0, "#070b26");
			sky.addColorStop(1, "#24305e");
			context.fillStyle = sky;
			context.fillRect(WINDOW.left, WINDOW.top - 30, WINDOW.right - WINDOW.left, WINDOW.bottom - WINDOW.top + 30);
			for (const [index, star] of STARS.entries()) {
				context.fillStyle = `rgba(255,255,240,${reducedMotion ? 0.8 : 0.55 + 0.35 * Math.sin(time * 2 + index)})`;
				context.fillRect(star.x, star.y, star.r * 1.6, star.r * 1.6);
			}
			const cityGlow = context.createRadialGradient(200, 128, 4, 200, 128, 80);
			cityGlow.addColorStop(0, "rgba(255,200,110,.55)");
			cityGlow.addColorStop(1, "rgba(255,200,110,0)");
			context.fillStyle = cityGlow;
			context.fillRect(WINDOW.left, WINDOW.top, WINDOW.right - WINDOW.left, WINDOW.bottom - WINDOW.top);
			context.fillStyle = "#151a35";
			context.beginPath();
			context.moveTo(WINDOW.left, WINDOW.bottom);
			context.quadraticCurveTo(200, 92, WINDOW.right, WINDOW.bottom);
			context.fill();
			for (const [left, width, height] of CITY) {
				const base = 128 + Math.abs(left + width / 2 - 200) * 0.32;
				context.fillStyle = "#1d2240";
				context.fillRect(left, base - height, width, height + 4);
				context.fillStyle = "#ffd27a";
				context.fillRect(left + width * 0.3, base - height * 0.7, 3, 3);
				if (height > 18) context.fillRect(left + width * 0.62, base - height * 0.4, 3, 3);
			}
			context.restore();
			context.strokeStyle = "#2a1b12";
			context.lineWidth = 6;
			context.beginPath();
			context.moveTo(WINDOW.left, WINDOW.bottom);
			context.lineTo(WINDOW.left, WINDOW.top + 50);
			context.arc(200, WINDOW.top + 50, 72, Math.PI, 0);
			context.lineTo(WINDOW.right, WINDOW.bottom);
			context.moveTo(200, WINDOW.top - 22);
			context.lineTo(200, WINDOW.bottom);
			context.moveTo(WINDOW.left, WINDOW.top + 66);
			context.lineTo(WINDOW.right, WINDOW.top + 66);
			context.stroke();

			// The shelf and the table.
			context.fillStyle = "#5b3a22";
			context.fillRect(22, 222, 356, 10);
			context.fillStyle = "#7a5131";
			context.fillRect(22, 222, 356, 3);
			context.fillStyle = "#4a2f1c";
			context.fillRect(40, 232, 8, 14);
			context.fillRect(352, 232, 8, 14);
			context.fillStyle = "#6b4529";
			context.fillRect(30, 338, 340, 14);
			context.fillStyle = "#8a5d38";
			context.fillRect(30, 338, 340, 3);
			context.fillStyle = "#4a2f1c";
			context.fillRect(48, 352, 12, 50);
			context.fillRect(340, 352, 12, 50);

			// The candlesticks and candles (their flames are drawn as light, below).
			LIGHT_CANDLES.forEach((candle, index) => {
				const lit = run.candles[index].lit;
				context.fillStyle = "#b8893a";
				context.beginPath();
				context.ellipse(candle.x, candle.y - 2, 14, 4, 0, 0, Math.PI * 2);
				context.fill();
				context.fillRect(candle.x - 3, candle.y - 14, 6, 12);
				context.beginPath();
				context.ellipse(candle.x, candle.y - 14, 10, 3, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = lit ? "#f3ead2" : "#a59d8c";
				context.fillRect(candle.x - 5, candle.y - 38, 10, 24);
				context.fillStyle = "#2a2420";
				context.fillRect(candle.x - 0.8, candle.y - 43, 1.6, 5);
			});

			// The dark of the night, lifted by every candle that shines.
			context.fillStyle = `rgba(6,5,18,${0.12 + 0.68 * (1 - light)})`;
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			if (t - outFlash.current < 0.35) {
				context.fillStyle = `rgba(120,20,30,${0.28 * (1 - (t - outFlash.current) / 0.35)})`;
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			}

			// The flames and their light.
			context.globalCompositeOperation = "lighter";
			LIGHT_CANDLES.forEach((candle, index) => {
				if (!run.candles[index].lit) return;
				const bushel = run.bushels.find((item) => item.candle === index);
				const covered = bushel && t >= bushel.lands ? 1 - (t - bushel.lands) / (bushel.smothers - bushel.lands) : null;
				const strength = covered === null ? 1 : 0.25 * covered;
				const glow = context.createRadialGradient(candle.x, candle.y - 46, 2, candle.x, candle.y - 46, 120 * flicker(index));
				glow.addColorStop(0, `rgba(255,196,96,${0.5 * strength})`);
				glow.addColorStop(0.4, `rgba(255,150,60,${0.16 * strength})`);
				glow.addColorStop(1, "rgba(255,140,50,0)");
				context.fillStyle = glow;
				context.fillRect(candle.x - 130, candle.y - 176, 260, 260);
			});
			context.globalCompositeOperation = "source-over";
			LIGHT_CANDLES.forEach((candle, index) => {
				if (!run.candles[index].lit) return;
				const height = 15 * flicker(index);
				const sway = reducedMotion ? 0 : Math.sin(time * 7 + index) * 1.6;
				context.fillStyle = "#ffb347";
				flamePath(context, candle.x, candle.y - 39, height, sway);
				context.fill();
				context.fillStyle = "#fff4c8";
				flamePath(context, candle.x, candle.y - 40, height * 0.55, sway * 0.6);
				context.fill();
			});

			// The bushels left on the candles that went out, and smoke over every candle out.
			for (const bushel of run.dead) drawBushel(context, LIGHT_CANDLES[bushel.candle].x, LIGHT_CANDLES[bushel.candle].y - 30, true);
			for (const [index, candle] of LIGHT_CANDLES.entries()) {
				if (run.candles[index].lit) continue;
				const age = t - (run.candles[index].outAt ?? t);
				if (!reducedMotion || age < 0.1) {
					for (let i = 0; i < 3; i++) {
						const rise = ((time * 18 + i * 14) % 42) + 6;
						context.fillStyle = `rgba(150,145,160,${0.28 * (1 - rise / 48)})`;
						context.beginPath();
						context.arc(candle.x + Math.sin(time * 2 + i) * 5, candle.y - 60 - rise, 5 + rise * 0.15, 0, Math.PI * 2);
						context.fill();
					}
				}
			}

			// The bushels: falling, then smothering the candle, each with its time running out.
			const firstSeconds = t < 3;
			for (const bushel of run.bushels) {
				const at = bushelAt(bushel, t);
				const candle = LIGHT_CANDLES[bushel.candle];
				const left = at.landed ? 1 - (t - bushel.lands) / (bushel.smothers - bushel.lands) : 1;
				if (at.landed) {
					// The light leaking under the rim, fading.
					context.fillStyle = `rgba(255,170,70,${0.55 * left})`;
					context.beginPath();
					context.ellipse(candle.x, candle.y - 1, 28 + 6 * left, 4, 0, 0, Math.PI * 2);
					context.fill();
				}
				drawBushel(context, at.x, at.y, false);
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 10 + bushel.id);
				const urgent = left < 0.45;
				context.strokeStyle = urgent ? `rgba(255,90,70,${0.5 + 0.4 * pulse})` : `rgba(255,226,140,${0.35 + 0.35 * pulse})`;
				context.lineWidth = 2;
				context.beginPath();
				context.arc(at.x, at.y, 38 + pulse * 3, 0, Math.PI * 2);
				context.stroke();
				if (at.landed) {
					context.strokeStyle = "rgba(0,0,0,.45)";
					context.lineWidth = 5;
					context.beginPath();
					context.arc(at.x, at.y, 34, 0, Math.PI * 2);
					context.stroke();
					context.strokeStyle = urgent ? "#ff5a46" : "#ffd166";
					context.beginPath();
					context.arc(at.x, at.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
					context.stroke();
				}
				if (firstSeconds) {
					context.fillStyle = "#fff";
					context.strokeStyle = "rgba(0,0,0,.7)";
					context.lineWidth = 4;
					context.font = "900 15px system-ui, sans-serif";
					context.textAlign = "center";
					context.strokeText("TAP!", at.x, at.y - 44);
					context.fillText("TAP!", at.x, at.y - 44);
				}
			}

			// Lifted bushels fly up and away.
			flying.current = flying.current.filter((item) => t - item.born < 0.6);
			for (const item of flying.current) {
				const age = (t - item.born) / 0.6;
				context.globalAlpha = 1 - age;
				drawBushel(context, item.x + item.spin * age * 40, item.y - age * 120, false, item.spin * age * 1.2);
				context.globalAlpha = 1;
			}
			particles.current = particles.current.filter((item) => t - item.born < item.life);
			for (const item of particles.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / item.life);
				context.fillStyle = item.color;
				context.beginPath();
				context.arc(item.x + item.vx * age, item.y + item.vy * age + 20 * age * age, item.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			// A miss: a red ring and "Miss" where the tap landed.
			misses.current = misses.current.filter((item) => t - item.born < 0.45);
			for (const item of misses.current) {
				const fade = 1 - (t - item.born) / 0.45;
				context.strokeStyle = `rgba(255,90,70,${0.8 * fade})`;
				context.lineWidth = 2.5;
				context.beginPath();
				context.arc(item.x, item.y, 8 + (t - item.born) * 40, 0, Math.PI * 2);
				context.stroke();
				context.globalAlpha = fade;
				context.fillStyle = "#ff6a55";
				context.strokeStyle = "rgba(0,0,0,.7)";
				context.lineWidth = 3;
				context.font = "900 13px system-ui, sans-serif";
				context.textAlign = "center";
				context.strokeText("Miss", item.x, item.y - 16 - (t - item.born) * 20);
				context.fillText("Miss", item.x, item.y - 16 - (t - item.born) * 20);
				context.globalAlpha = 1;
			}

			// How many candles still shine: three out and the house is dark.
			context.fillStyle = "rgba(0,0,0,.5)";
			context.beginPath();
			context.roundRect(8, 8, 112, 30, 10);
			context.fill();
			run.candles.forEach((candle, index) => {
				const x = 22 + index * 17;
				if (candle.lit) {
					context.fillStyle = "#ffc857";
					flamePath(context, x, 30, 15, 0);
					context.fill();
				} else {
					context.strokeStyle = "rgba(255,255,255,.4)";
					context.lineWidth = 1.5;
					flamePath(context, x, 30, 15, 0);
					context.stroke();
				}
			});
			context.fillStyle = "rgba(255,255,255,.75)";
			context.font = "800 10px system-ui, sans-serif";
			context.textAlign = "right";
			context.fillText(`${LIGHT_OUT_LIMIT} out = dark`, 392, 22);
			context.fillText(`Lifted ${run.lifted}`, 392, 36);
			// Misses toward the next candle a miss puts out.
			const missed = run.misses % LIGHT_MISS_LIMIT;
			context.fillStyle = missed >= LIGHT_MISS_LIMIT - 3 ? "#ff6a55" : "rgba(255,255,255,.75)";
			context.fillText(`Misses ${missed}/${LIGHT_MISS_LIMIT}`, 392, 50);

			if (run.phase === "won") {
				context.fillStyle = "rgba(255,214,140,.16)";
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
		taps.current.push(stagePoint(canvasRef.current, event));
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A house at night with six candles and a city on a hill through the window. Bushels drop over the candles: tap or click a bushel to lift it off before its candle goes out. Every tenth tap that lifts nothing puts out the nearest candle."
		/>
	);
}
