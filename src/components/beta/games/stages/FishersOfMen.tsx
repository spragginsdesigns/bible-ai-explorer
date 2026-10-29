"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	FISH_NET_Y,
	FISH_SEA_Y,
	FISH_SECONDS,
	FISH_TARGET,
	FISH_TEARS_TO_BREAK,
	airborne,
	fishResult,
	itemAt,
	netHalf,
	newFish,
	stepFish,
	type FishEvent,
	type FishItem,
	type FishState,
} from "@/lib/beta/games/fishers-of-men-rules";

/**
 * Fishers of Men (LC-17851), Matthew 4:18-22: the sea of Galilee at dawn.
 * Peter and Andrew wade in the shallows with their net between them; fish
 * leap from the sea and fall toward it. Hold ← → (or drag) to move the net
 * under each fish; a gold ring on the water shows where a fish comes down, a
 * red one where driftwood or a stone does. Jesus stands on the shore in soft
 * light.
 */

const WATER_TOP = 148;

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

interface Floater {
	x: number;
	y: number;
	born: number;
	text: string;
	color: string;
}

function drawBrother(context: CanvasRenderingContext2D, x: number, waist: number, robe: string, side: number, bob: number) {
	const top = waist - 44 + bob;
	// Robe above the water, head, and the arm holding the net's corner.
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - 11, waist + 6);
	context.lineTo(x - 8, top + 14);
	context.quadraticCurveTo(x, top + 8, x + 8, top + 14);
	context.lineTo(x + 11, waist + 6);
	context.closePath();
	context.fill();
	context.fillStyle = "#c99a74";
	context.beginPath();
	context.arc(x, top + 4, 7.5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#3b2a22";
	context.beginPath();
	context.arc(x, top + 1.5, 7.5, Math.PI, Math.PI * 2);
	context.fill();
	context.strokeStyle = robe;
	context.lineWidth = 5;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(x + side * 5, top + 18);
	context.lineTo(x + side * 14, FISH_NET_Y - 2);
	context.stroke();
}

function drawFish(context: CanvasRenderingContext2D, x: number, y: number, angle: number, glow: boolean) {
	context.save();
	context.translate(x, y);
	context.rotate(angle);
	if (glow) {
		context.fillStyle = "rgba(255,226,140,.35)";
		context.beginPath();
		context.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
		context.fill();
	}
	const body = context.createLinearGradient(0, -7, 0, 7);
	body.addColorStop(0, "#dfe9f2");
	body.addColorStop(0.5, "#9fb8cc");
	body.addColorStop(1, "#5d7e98");
	context.fillStyle = body;
	context.beginPath();
	context.ellipse(0, 0, 13, 6.5, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(-10, 0);
	context.lineTo(-19, -7);
	context.lineTo(-17, 0);
	context.lineTo(-19, 7);
	context.closePath();
	context.fill();
	context.fillStyle = "#1d2b38";
	context.beginPath();
	context.arc(7, -1.5, 1.6, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawDebris(context: CanvasRenderingContext2D, item: FishItem, x: number, y: number, t: number) {
	context.save();
	context.translate(x, y);
	context.rotate((t - item.born) * (item.id % 2 ? 4 : -3.4));
	if (item.kind === "wood") {
		context.fillStyle = "#6b4a2f";
		context.beginPath();
		context.roundRect(-17, -5, 34, 10, 4);
		context.fill();
		context.fillStyle = "#4a321f";
		context.fillRect(-11, -5, 3, 10);
		context.fillRect(5, -5, 3, 10);
		context.fillStyle = "#8a6544";
		context.beginPath();
		context.ellipse(17, 0, 3, 5, 0, 0, Math.PI * 2);
		context.fill();
	} else {
		context.fillStyle = "#6f6a66";
		context.beginPath();
		context.moveTo(-10, -4);
		context.lineTo(-4, -10);
		context.lineTo(8, -8);
		context.lineTo(11, 2);
		context.lineTo(4, 10);
		context.lineTo(-8, 8);
		context.closePath();
		context.fill();
		context.fillStyle = "#94908b";
		context.beginPath();
		context.arc(-2, -3, 3.5, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

export default function FishersOfMen({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<FishState>(newFish(seed));
	const drag = useRef<number | null>(null);
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const flash = useRef<{ at: number; color: string } | null>(null);
	const shake = useRef(0);
	const ended = useRef(false);
	const lastData = useRef(-1);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, t: number) => {
		for (let i = 0; i < count; i++) {
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
			const power = speed * (0.4 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, born: t, life: 0.5 + Math.random() * 0.4, color: colors[i % colors.length], size: 1.5 + Math.random() * 2.5 });
		}
	}, []);

	const react = useCallback(
		(event: FishEvent, run: FishState) => {
			const play = synth.current;
			if (event.type === "catch") {
				burst(event.x, FISH_NET_Y - 4, 14, ["#ffe39a", "#ffffff", "#bfe3f5"], 140, run.t);
				floaters.current.push({ x: event.x, y: FISH_NET_Y - 24, born: run.t, text: "+1", color: "#ffe39a" });
				flash.current = { at: run.t, color: "255,226,140" };
				play?.tone(620 + Math.min(run.caught, 20) * 18, 0.13, { type: "triangle", volume: 0.16, to: 980 });
			}
			if (event.type === "tear") {
				burst(event.x, FISH_NET_Y, 18, ["#ff6b5a", "#7a4a2f", "#ffffff"], 170, run.t);
				floaters.current.push({ x: event.x, y: FISH_NET_Y - 26, born: run.t, text: "Torn!", color: "#ff8a7a" });
				flash.current = { at: run.t, color: "255,80,60" };
				if (!reducedMotion) shake.current = run.t + 0.3;
				play?.noise(0.22, { volume: 0.3, filter: 2400, type: "highpass" });
				play?.tone(170, 0.3, { type: "sawtooth", volume: 0.14, to: 90 });
			}
			if (event.type === "splash") {
				burst(event.x, FISH_NET_Y + 22, 8, ["#d8f1ff", "#ffffff"], 90, run.t);
				if (event.kind === "fish") play?.noise(0.18, { volume: 0.1, filter: 900 });
			}
			if (event.type === "broken") {
				play?.noise(0.6, { volume: 0.35, filter: 1500 });
				play?.tone(150, 0.9, { type: "sawtooth", volume: 0.16, to: 60 });
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1.1, { type: "triangle", volume: 0.15, delay: index * 0.1 }));
			if (event.type === "lost") play?.tone(240, 0.8, { type: "sine", volume: 0.16, to: 150 });
		},
		[burst, reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		takePresses(keys);
		const left = keys.held.has("arrowleft");
		const right = keys.held.has("arrowright");
		const dir = (right ? 1 : 0) - (left ? 1 : 0);
		const events: FishEvent[] = [];
		stepFish(run, { dir, target: left || right ? null : drag.current }, events);
		for (const event of events) react(event, run);
		onTime(Math.max(0, FISH_SECONDS - run.t));
		const canvas = canvasRef.current;
		const tick = Math.floor(run.t * 10);
		if (canvas && tick !== lastData.current) {
			lastData.current = tick;
			canvas.dataset.net = `${Math.round(run.netX)},${run.tears},${run.caught}`;
			canvas.dataset.drops = airborne(run)
				.filter((item) => item.outcome === null)
				.map((item) => `${item.kind[0]}${Math.round(item.landX)}@${(item.landAt - run.t).toFixed(2)}`)
				.join(" ");
		}
		const result = fishResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			const half = netHalf(run.tears);
			const wave = reducedMotion ? 0 : time;
			context.save();
			if (shake.current > t) context.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);

			// Dawn over Galilee.
			const sky = context.createLinearGradient(0, 0, 0, WATER_TOP);
			sky.addColorStop(0, "#2b3a67");
			sky.addColorStop(0.5, "#b8728a");
			sky.addColorStop(1, "#f7c58a");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, WATER_TOP + 10);
			const sun = context.createRadialGradient(262, WATER_TOP - 6, 4, 262, WATER_TOP - 6, 70);
			sun.addColorStop(0, "rgba(255,240,200,1)");
			sun.addColorStop(0.25, "rgba(255,214,140,.8)");
			sun.addColorStop(1, "rgba(255,200,120,0)");
			context.fillStyle = sun;
			context.fillRect(180, WATER_TOP - 80, 170, 80);
			// The far hills.
			context.fillStyle = "#6c4f6b";
			context.beginPath();
			context.moveTo(0, WATER_TOP);
			context.bezierCurveTo(60, 104, 120, 132, 170, 118);
			context.bezierCurveTo(210, 108, 230, 138, 300, 124);
			context.bezierCurveTo(350, 114, 380, 120, 400, 112);
			context.lineTo(400, WATER_TOP);
			context.closePath();
			context.fill();

			// The sea, with the sun's path on it.
			const sea = context.createLinearGradient(0, WATER_TOP, 0, STAGE);
			sea.addColorStop(0, "#5f7fa3");
			sea.addColorStop(0.45, "#2f5f80");
			sea.addColorStop(1, "#173a55");
			context.fillStyle = sea;
			context.fillRect(-10, WATER_TOP, STAGE + 20, STAGE - WATER_TOP + 10);
			for (let row = 0; row < 14; row++) {
				const y = WATER_TOP + 6 + row * row * 1.5;
				const width = 26 + row * 7;
				const sway = Math.sin(wave * 1.3 + row) * 6;
				context.fillStyle = `rgba(255,214,150,${0.5 - row * 0.03})`;
				context.fillRect(262 - width / 2 + sway, y, width, 2);
			}
			context.strokeStyle = "rgba(220,236,255,.18)";
			context.lineWidth = 1.5;
			for (let row = 0; row < 7; row++) {
				const y = 190 + row * 30;
				context.beginPath();
				for (let x = 0; x <= STAGE; x += 20) context.lineTo(x, y + Math.sin(x / 30 + wave * 1.6 + row) * 2.5);
				context.stroke();
			}

			// Jesus on the shore, a robed figure in soft light (v18-19).
			const glow = context.createRadialGradient(56, WATER_TOP - 14, 2, 56, WATER_TOP - 14, 34);
			glow.addColorStop(0, "rgba(255,246,220,.9)");
			glow.addColorStop(1, "rgba(255,246,220,0)");
			context.fillStyle = glow;
			context.fillRect(20, WATER_TOP - 50, 72, 60);
			context.fillStyle = "#c9a77e";
			context.fillRect(0, WATER_TOP - 2, 110, 5);
			context.fillStyle = "#fbf3e2";
			context.beginPath();
			context.moveTo(50, WATER_TOP);
			context.lineTo(53, WATER_TOP - 22);
			context.lineTo(59, WATER_TOP - 22);
			context.lineTo(62, WATER_TOP);
			context.closePath();
			context.fill();
			context.beginPath();
			context.arc(56, WATER_TOP - 25, 3.6, 0, Math.PI * 2);
			context.fill();

			// Where the leaping fish come out of the sea.
			for (const item of run.items) {
				const age = t - item.born;
				if (item.kind === "stone" || age < 0 || age > 0.35) continue;
				const ring = age / 0.35;
				context.strokeStyle = `rgba(230,245,255,${0.7 * (1 - ring)})`;
				context.lineWidth = 2;
				context.beginPath();
				context.ellipse(item.x0, FISH_SEA_Y + 6, 6 + ring * 16, 2 + ring * 5, 0, 0, Math.PI * 2);
				context.stroke();
			}

			// The rings on the water: gold where a fish comes down, red where debris does.
			const flying = airborne(run);
			for (const item of flying) {
				if (item.outcome !== null) continue;
				const flight = item.landAt - item.born;
				const left = Math.max(0, (item.landAt - t) / flight);
				const fish = item.kind === "fish";
				context.strokeStyle = fish ? `rgba(255,214,102,${0.95 - left * 0.5})` : `rgba(255,90,70,${0.95 - left * 0.45})`;
				context.lineWidth = fish ? 3 : 3.5;
				context.beginPath();
				context.ellipse(item.landX, FISH_NET_Y + 14, 9 + left * 22, 3.5 + left * 7, 0, 0, Math.PI * 2);
				context.stroke();
				if (!fish) {
					context.beginPath();
					context.moveTo(item.landX - 5, FISH_NET_Y + 10);
					context.lineTo(item.landX + 5, FISH_NET_Y + 18);
					context.moveTo(item.landX + 5, FISH_NET_Y + 10);
					context.lineTo(item.landX - 5, FISH_NET_Y + 18);
					context.stroke();
				}
			}

			// Peter and Andrew wading, the net between them.
			const netX = run.netX;
			const bob = reducedMotion ? 0 : Math.sin(time * 2.2) * 1.2;
			const flashAge = flash.current ? t - flash.current.at : 9;
			drawBrother(context, netX - half - 14, FISH_NET_Y + 18, "#7a5a3a", 1, bob);
			drawBrother(context, netX + half + 14, FISH_NET_Y + 18, "#5b6b7a", -1, -bob);
			// The net: a mesh bowl under a glowing rim, the zone that catches.
			const rimGlow = context.createLinearGradient(0, FISH_NET_Y - 14, 0, FISH_NET_Y + 4);
			rimGlow.addColorStop(0, "rgba(255,226,140,0)");
			rimGlow.addColorStop(1, `rgba(255,226,140,${run.t < 2 ? 0.35 + 0.25 * Math.sin(time * 8) : 0.28})`);
			context.fillStyle = rimGlow;
			context.fillRect(netX - half, FISH_NET_Y - 14, half * 2, 18);
			context.strokeStyle = "rgba(240,226,190,.75)";
			context.lineWidth = 1.2;
			const depth = 30;
			for (let i = 0; i <= 8; i++) {
				const x = netX - half + (i / 8) * half * 2;
				context.beginPath();
				context.moveTo(x, FISH_NET_Y);
				context.quadraticCurveTo(x + (netX - x) * 0.3, FISH_NET_Y + depth * 0.7, netX + (x - netX) * 0.45, FISH_NET_Y + depth);
				context.stroke();
			}
			for (let row = 1; row <= 3; row++) {
				const y = FISH_NET_Y + (row / 3) * depth;
				const w = half * (1 - row * 0.18);
				context.beginPath();
				context.moveTo(netX - w, y - 2);
				context.quadraticCurveTo(netX, y + 4, netX + w, y - 2);
				context.stroke();
			}
			// The tears, ragged holes in the mesh.
			for (let tear = 0; tear < run.tears; tear++) {
				const x = netX + (tear % 2 ? 1 : -1) * half * 0.45;
				context.fillStyle = "rgba(23,58,85,.95)";
				context.beginPath();
				context.ellipse(x, FISH_NET_Y + 14, 8, 6, 0.4, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = "#ff8a7a";
				context.lineWidth = 1.5;
				context.stroke();
			}
			context.strokeStyle = flashAge < 0.25 && flash.current ? `rgba(${flash.current.color},1)` : "#f1dca0";
			context.lineWidth = 4;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(netX - half, FISH_NET_Y);
			context.quadraticCurveTo(netX, FISH_NET_Y + 5, netX + half, FISH_NET_Y);
			context.stroke();
			// Fish caught so far, shining in the net.
			for (let i = 0; i < Math.min(run.caught, 8); i++) {
				drawFish(context, netX - half * 0.55 + (i % 4) * half * 0.36, FISH_NET_Y + 12 + Math.floor(i / 4) * 8, (i % 2 ? 0.2 : -0.2) + Math.PI * (i % 2), false);
			}
			// The water in front of the wading brothers.
			context.fillStyle = "rgba(23,58,85,.55)";
			context.fillRect(-10, FISH_NET_Y + 26, STAGE + 20, STAGE);

			// What is in the air.
			for (const item of flying) {
				const at = itemAt(item, Math.min(t, item.landAt + 0.4));
				if (item.kind === "fish") {
					const age = t - item.born;
					const angle = Math.atan2(item.vy + 620 * age, item.vx || 0.001);
					drawFish(context, at.x, at.y, angle, item.outcome === null);
				} else drawDebris(context, item, at.x, at.y, t);
			}

			// Spray and sparkle.
			particles.current = particles.current.filter((particle) => t - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = t - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x + particle.vx * age, particle.y + particle.vy * age + 260 * age * age, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			floaters.current = floaters.current.filter((floater) => t - floater.born < 0.8);
			context.textAlign = "center";
			context.font = "900 18px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = (t - floater.born) / 0.8;
				context.globalAlpha = 1 - age;
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 26);
			}
			context.globalAlpha = 1;

			// The count and the net's strength.
			context.fillStyle = "rgba(10,20,36,.55)";
			context.beginPath();
			context.roundRect(10, 10, 116, 34, 12);
			context.fill();
			drawFish(context, 30, 27, 0, false);
			context.textAlign = "left";
			context.font = "900 19px system-ui, sans-serif";
			context.fillStyle = run.caught >= FISH_TARGET ? "#ffe39a" : "#ffffff";
			context.fillText(`${run.caught}/${FISH_TARGET}`, 52, 34);
			context.fillStyle = "rgba(10,20,36,.55)";
			context.beginPath();
			context.roundRect(STAGE - 106, 10, 96, 34, 12);
			context.fill();
			context.font = "800 11px system-ui, sans-serif";
			context.fillStyle = "#ffffff";
			context.fillText("NET", STAGE - 98, 31);
			for (let knot = 0; knot < FISH_TEARS_TO_BREAK; knot++) {
				const torn = knot >= FISH_TEARS_TO_BREAK - run.tears;
				const x = STAGE - 66 + knot * 18;
				context.strokeStyle = torn ? "#ff6b5a" : "#f1dca0";
				context.lineWidth = 2;
				context.strokeRect(x, 19, 13, 13);
				context.beginPath();
				if (torn) {
					context.moveTo(x + 2, 21);
					context.lineTo(x + 11, 30);
					context.moveTo(x + 11, 21);
					context.lineTo(x + 2, 30);
				} else {
					context.moveTo(x + 6.5, 19);
					context.lineTo(x + 6.5, 32);
					context.moveTo(x, 25.5);
					context.lineTo(x + 13, 25.5);
				}
				context.stroke();
			}

			// The first moments: show what moves and what to catch.
			if (t < 2.2 && run.phase === "playing") {
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 7);
				context.strokeStyle = `rgba(255,226,140,${0.5 + 0.5 * pulse})`;
				context.lineWidth = 3;
				context.beginPath();
				context.ellipse(netX, FISH_NET_Y + 6, half + 26 + pulse * 6, 26 + pulse * 3, 0, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "#ffe39a";
				context.font = "900 26px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("◀", netX - half - 52, FISH_NET_Y + 14);
				context.fillText("▶", netX + half + 52, FISH_NET_Y + 14);
				context.font = "900 17px system-ui, sans-serif";
				context.fillStyle = "#ffffff";
				context.fillText(`Catch ${FISH_TARGET} fish · dodge the wood and stones`, STAGE / 2, 72);
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,240,200,.2)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (event.type === "pointerdown") {
			event.preventDefault();
			event.currentTarget.setPointerCapture?.(event.pointerId);
		} else if (event.buttons === 0 && event.pointerType === "mouse") return;
		const canvas = canvasRef.current;
		if (canvas) drag.current = stagePoint(canvas, event).x;
	};
	const onRelease = () => {
		drag.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointer}
			onPointerMove={onPointer}
			onPointerUp={onRelease}
			onPointerCancel={onRelease}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label={`The sea of Galilee at dawn. Fish leap toward Peter and Andrew's net. Hold the left and right arrows, or drag, to move the net under the fish; let the driftwood and stones fall by. Catch ${FISH_TARGET} fish.`}
		/>
	);
}
