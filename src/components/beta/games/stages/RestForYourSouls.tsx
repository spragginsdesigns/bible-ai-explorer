"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "@/components/beta/games/stage-kit";
import type { StageProps } from "@/components/beta/games/types";
import {
	REST_FALL_LIMIT,
	REST_HEAVY,
	REST_LANES,
	REST_LEAN,
	REST_LIE,
	REST_SECONDS,
	burdenAt,
	newRest,
	restResult,
	stepRest,
	type RestEvent,
	type RestState,
	type RestTraveller,
} from "@/lib/beta/games/rest-for-your-souls-rules";

/**
 * Rest for Your Souls (LC-17851), Matthew 11:28-30: weary travellers on a
 * dusty road in the late afternoon, walking toward the Lord, who stands far
 * off in soft light with his arms open. Burdens drop onto their backs and grow
 * heavy (red as they near the limit); a tap or click lifts one away, light as
 * a feather.
 */

const ROBES = ["#7a5c3e", "#5d6b4a", "#8a4b3a", "#4f5d73", "#6e5a7a", "#9a7b4f"];
const CLOTHS = ["#d8c7a0", "#b7684a", "#e3d9c2", "#8c9a6a", "#c9a25a", "#a7b2c4"];

interface Feather {
	x: number;
	y: number;
	born: number;
	drift: number;
}

interface Mote {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
	size: number;
}

function drawFeather(context: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
	context.save();
	context.translate(x, y);
	context.rotate(angle);
	context.fillStyle = "#fffaf0";
	context.beginPath();
	context.moveTo(0, -size);
	context.quadraticCurveTo(size * 0.45, -size * 0.2, 0, size);
	context.quadraticCurveTo(-size * 0.45, -size * 0.2, 0, -size);
	context.fill();
	context.strokeStyle = "rgba(160,140,110,.8)";
	context.lineWidth = 0.8;
	context.beginPath();
	context.moveTo(0, -size);
	context.lineTo(0, size * 1.2);
	context.stroke();
	context.restore();
}

export default function RestForYourSouls({ seed, paused, muted, reducedMotion, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<RestState>(newRest(seed));
	const taps = useRef<{ x: number; y: number }[]>([]);
	const feathers = useRef<Feather[]>([]);
	const motes = useRef<Mote[]>([]);
	const misses = useRef<{ x: number; y: number; born: number }[]>([]);
	const fallFlash = useRef(-9);
	const shake = useRef(0);
	const ended = useRef(false);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, life: number) => {
		const t = state.current.t;
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.3 + Math.random() * 0.7);
			motes.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v * 0.6 - speed * 0.3, born: t, life: life * (0.6 + Math.random() * 0.6), color: colors[i % colors.length], size: 1.4 + Math.random() * 2.2 });
		}
	}, []);

	const handle = useCallback(
		(event: RestEvent) => {
			const play = synth.current;
			const t = state.current.t;
			if (event.type === "burden") play?.noise(0.14, { volume: 0.14, filter: 380, delay: 0.2 });
			if (event.type === "lift") {
				feathers.current.push({ x: event.x, y: event.y, born: t, drift: Math.random() < 0.5 ? -1 : 1 });
				burst(event.x, event.y, 12, ["#fff6d8", "#ffe39a", "#ffffff"], 70, 0.7);
				play?.tone(523 + (1 - event.weight) * 260, 0.25, { type: "triangle", volume: 0.15, to: 1046 });
				play?.tone(1568, 0.35, { type: "sine", volume: 0.05, delay: 0.08 });
			}
			if (event.type === "miss") {
				misses.current.push({ x: event.x, y: event.y, born: t });
				play?.tone(200, 0.05, { type: "square", volume: 0.04 });
			}
			if (event.type === "fall") {
				const lane = REST_LANES[event.lane];
				burst(event.x, lane.y, 18, ["#c9a77a", "#a88a62", "#e0c9a0"], 60, 0.9);
				fallFlash.current = t;
				if (!reducedMotion) shake.current = 8;
				play?.noise(0.35, { volume: 0.3, filter: 300 });
				play?.tone(150, 0.4, { type: "sine", volume: 0.2, to: 70 });
			}
			if (event.type === "won") [392, 494, 587, 784].forEach((note, index) => play?.tone(note, 1.3, { type: "triangle", volume: 0.14, delay: index * 0.1 }));
			if (event.type === "lost") play?.tone(220, 1, { type: "sine", volume: 0.2, to: 98 });
		},
		[burst, reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const events: RestEvent[] = [];
		stepRest(run, { taps: taps.current.splice(0) }, events);
		for (const event of events) handle(event);
		onTime(Math.max(0, REST_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			canvas.dataset.targets = run.travellers
				.filter((walker) => walker.burden && walker.fellAt === null)
				.map((walker) => {
					const at = burdenAt(run, walker);
					return `${Math.round(at.x)},${Math.round(at.y)},${Math.round((1 - (walker.burden?.weight ?? 0)) * 1000)}`;
				})
				.join(";");
			canvas.dataset.falls = String(run.falls);
		}
		const result = restResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [handle, onEnd, onTime]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			context.save();
			if (shake.current > 0.2) {
				context.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
				shake.current *= 0.86;
			}

			// Late afternoon over the hills of Galilee.
			const sky = context.createLinearGradient(0, 0, 0, 200);
			sky.addColorStop(0, "#9fb7c9");
			sky.addColorStop(0.65, "#f1d3a2");
			sky.addColorStop(1, "#f4c27f");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 220);
			context.fillStyle = "#c9a774";
			context.beginPath();
			context.moveTo(-10, 172);
			context.quadraticCurveTo(90, 120, 180, 160);
			context.quadraticCurveTo(280, 110, 410, 150);
			context.lineTo(410, 200);
			context.lineTo(-10, 200);
			context.fill();
			context.fillStyle = "#a9a06a";
			context.beginPath();
			context.moveTo(-10, 190);
			context.quadraticCurveTo(120, 160, 240, 186);
			context.quadraticCurveTo(330, 170, 410, 182);
			context.lineTo(410, 210);
			context.lineTo(-10, 210);
			context.fill();

			// The Lord far off where the road leads, in soft light, arms open (v28).
			const lordX = 360;
			const lordY = 150;
			const halo = context.createRadialGradient(lordX, lordY - 20, 2, lordX, lordY - 20, 70);
			halo.addColorStop(0, "rgba(255,250,225,.95)");
			halo.addColorStop(0.35, "rgba(255,240,190,.45)");
			halo.addColorStop(1, "rgba(255,240,190,0)");
			context.fillStyle = halo;
			context.fillRect(lordX - 80, lordY - 100, 160, 160);

			// The road, wide and dusty, coming toward us.
			const road = context.createLinearGradient(0, 196, 0, STAGE);
			road.addColorStop(0, "#d9bf8f");
			road.addColorStop(1, "#c29a64");
			context.fillStyle = road;
			context.fillRect(-10, 196, STAGE + 20, STAGE);
			context.fillStyle = "rgba(120,90,50,.18)";
			for (let i = 0; i < 14; i++) context.fillRect((i * 67 + 13) % 400, 205 + ((i * 53) % 190), 18 + (i % 3) * 8, 2);

			context.fillStyle = "#fbf6ea";
			context.beginPath();
			context.arc(lordX, lordY - 34, 4.5, 0, Math.PI * 2);
			context.fill();
			context.beginPath();
			context.moveTo(lordX - 7, lordY);
			context.lineTo(lordX - 4, lordY - 29);
			context.lineTo(lordX + 4, lordY - 29);
			context.lineTo(lordX + 7, lordY);
			context.closePath();
			context.fill();
			context.strokeStyle = "#fbf6ea";
			context.lineWidth = 2.2;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(lordX - 3, lordY - 26);
			context.lineTo(lordX - 13, lordY - 33);
			context.moveTo(lordX + 3, lordY - 26);
			context.lineTo(lordX + 13, lordY - 33);
			context.stroke();

			// The travellers, the far paths first.
			const ordered = [...run.travellers].sort((a, b) => a.lane - b.lane);
			for (const walker of ordered) drawTraveller(context, run, walker, time, reducedMotion);

			// Burdens: heavier is bigger and redder; the ring is how near he is to falling.
			for (const walker of ordered) {
				if (!walker.burden || walker.fellAt !== null) continue;
				const at = burdenAt(run, walker);
				const scale = REST_LANES[walker.lane].scale;
				const weight = walker.burden.weight;
				const heavy = weight >= REST_HEAVY;
				const size = (9 + weight * 9) * scale;
				if (heavy) {
					const pulse = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(time * 14);
					const glow = context.createRadialGradient(at.x, at.y, 2, at.x, at.y, size * 2.6);
					glow.addColorStop(0, `rgba(255,60,40,${0.35 + 0.35 * pulse})`);
					glow.addColorStop(1, "rgba(255,60,40,0)");
					context.fillStyle = glow;
					context.fillRect(at.x - size * 3, at.y - size * 3, size * 6, size * 6);
				}
				const red = Math.min(1, weight / 0.95);
				context.fillStyle = `rgb(${Math.round(120 + 110 * red)},${Math.round(92 - 40 * red)},${Math.round(60 - 20 * red)})`;
				context.beginPath();
				context.ellipse(at.x, at.y, size * 1.05, size * 0.9, -0.2, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = "rgba(60,35,20,.8)";
				context.lineWidth = 1.6 * scale;
				context.beginPath();
				context.moveTo(at.x - size, at.y);
				context.lineTo(at.x + size, at.y);
				context.moveTo(at.x, at.y - size * 0.9);
				context.lineTo(at.x, at.y + size * 0.9);
				context.stroke();
				const reach = Math.max(22, size + 10);
				context.strokeStyle = "rgba(0,0,0,.35)";
				context.lineWidth = 4;
				context.beginPath();
				context.arc(at.x, at.y, reach, 0, Math.PI * 2);
				context.stroke();
				context.strokeStyle = heavy ? "#ff4b3a" : "#fff1c2";
				context.beginPath();
				context.arc(at.x, at.y, reach, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * weight);
				context.stroke();
				if (t < 3) {
					context.font = "900 14px system-ui, sans-serif";
					context.textAlign = "center";
					context.lineWidth = 4;
					context.strokeStyle = "rgba(0,0,0,.7)";
					context.fillStyle = "#fff";
					context.strokeText("TAP!", at.x, at.y - reach - 6);
					context.fillText("TAP!", at.x, at.y - reach - 6);
				}
			}

			// Lifted burdens float away, light as a feather (v30).
			feathers.current = feathers.current.filter((item) => t - item.born < 1.4);
			for (const item of feathers.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / 1.4);
				const sway = Math.sin(age * 5) * 12 * item.drift;
				drawFeather(context, item.x + sway + item.drift * age * 18, item.y - age * 95, Math.sin(age * 5) * 0.6, 11);
				context.globalAlpha = 1;
			}
			motes.current = motes.current.filter((item) => t - item.born < item.life);
			for (const item of motes.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / item.life);
				context.fillStyle = item.color;
				context.beginPath();
				context.arc(item.x + item.vx * age, item.y + item.vy * age, item.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			misses.current = misses.current.filter((item) => t - item.born < 0.3);
			for (const item of misses.current) {
				context.strokeStyle = `rgba(80,50,20,${0.5 * (1 - (t - item.born) / 0.3)})`;
				context.lineWidth = 2;
				context.beginPath();
				context.arc(item.x, item.y, 8 + (t - item.born) * 40, 0, Math.PI * 2);
				context.stroke();
			}
			if (t - fallFlash.current < 0.4) {
				context.fillStyle = `rgba(150,30,20,${0.25 * (1 - (t - fallFlash.current) / 0.4)})`;
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			}

			// Falls so far: three and the round is lost.
			context.fillStyle = "rgba(40,25,15,.55)";
			context.beginPath();
			context.roundRect(8, 8, 128, 28, 10);
			context.fill();
			context.font = "800 11px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillStyle = "#fff";
			context.fillText("Falls", 16, 26);
			for (let i = 0; i < REST_FALL_LIMIT; i++) {
				context.beginPath();
				context.arc(62 + i * 22, 22, 7, 0, Math.PI * 2);
				if (i < run.falls) {
					context.fillStyle = "#ff5a46";
					context.fill();
				} else {
					context.strokeStyle = "rgba(255,255,255,.7)";
					context.lineWidth = 2;
					context.stroke();
				}
			}
			context.fillStyle = "rgba(40,25,15,.55)";
			context.beginPath();
			context.roundRect(312, 8, 80, 28, 10);
			context.fill();
			context.fillStyle = "#fff";
			context.textAlign = "center";
			context.fillText(`Lifted ${run.lifted}`, 352, 26);

			if (run.phase === "won") {
				context.fillStyle = "rgba(255,244,214,.2)";
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
			aria-label="Weary travellers walk a dusty road toward the Lord. Burdens drop on their backs and grow heavy: tap or click a burden to lift it off before a traveller falls."
		/>
	);
}

/** A traveller walking (legs swinging), stooping under his burden, or lying fallen on the road. */
function drawTraveller(context: CanvasRenderingContext2D, run: RestState, walker: RestTraveller, time: number, reducedMotion: boolean) {
	if (run.t < walker.enters) return;
	const lane = REST_LANES[walker.lane];
	const s = lane.scale;
	const robe = ROBES[walker.look % ROBES.length];
	const cloth = CLOTHS[(walker.look * 5 + 1) % CLOTHS.length];
	context.save();
	if (walker.fellAt !== null) {
		const age = run.t - walker.fellAt;
		context.globalAlpha = Math.max(0, 1 - Math.max(0, age - REST_LIE * 0.6) / (REST_LIE * 0.4));
		context.translate(walker.x, lane.y);
		context.rotate(Math.min(1, age / 0.25) * 1.45);
		context.translate(-walker.x, -lane.y);
	}
	const weight = walker.burden?.weight ?? 0;
	const heavy = weight >= REST_HEAVY;
	const stride = reducedMotion ? 0 : Math.sin(walker.x * 0.22) * (1 - weight * 0.6);
	const stumble = heavy && !reducedMotion ? Math.sin(time * 26 + walker.id) * 1.6 * s : 0;
	// Shadow.
	context.fillStyle = "rgba(70,45,20,.25)";
	context.beginPath();
	context.ellipse(walker.x, lane.y + 1, 12 * s, 3 * s, 0, 0, Math.PI * 2);
	context.fill();
	// Legs.
	context.strokeStyle = "#5a4030";
	context.lineWidth = 3 * s;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(walker.x, lane.y - 20 * s);
	context.lineTo(walker.x + stride * 7 * s, lane.y);
	context.moveTo(walker.x, lane.y - 20 * s);
	context.lineTo(walker.x - stride * 7 * s, lane.y);
	context.stroke();
	// Body, stooping forward from the hips.
	context.translate(walker.x + stumble, lane.y - 20 * s);
	context.rotate(weight * REST_LEAN);
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(-9 * s, 6 * s);
	context.lineTo(-6 * s, -28 * s);
	context.lineTo(6 * s, -28 * s);
	context.lineTo(9 * s, 6 * s);
	context.closePath();
	context.fill();
	context.fillStyle = "#c99a74";
	context.beginPath();
	context.arc(1 * s, -34 * s, 5.5 * s, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = cloth;
	context.beginPath();
	context.arc(0, -35 * s, 6 * s, Math.PI * 0.95, Math.PI * 2.05);
	context.fill();
	context.fillRect(-6 * s, -36 * s, 3 * s, 12 * s);
	// A staff in the forward hand.
	context.strokeStyle = "#6b4a2b";
	context.lineWidth = 2 * s;
	context.beginPath();
	context.moveTo(9 * s, -36 * s);
	context.lineTo(14 * s, 22 * s);
	context.stroke();
	context.restore();
}
