"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	WINGS_CATCH_R,
	WINGS_CHICKS,
	WINGS_NEST,
	WINGS_NEST_R,
	WINGS_SECONDS,
	WINGS_WALL,
	newWings,
	stepWings,
	wingsResult,
	type Chick,
	type WingsEvent,
	type WingsState,
} from "@/lib/beta/games/under-her-wings-rules";

/**
 * Under Her Wings (LC-17851), Matthew 23:37-39: a stone courtyard in
 * Jerusalem seen from above as a storm gathers. Arrow keys (or drag) move
 * the hen; each scattered chick glows with a ring until she reaches it, then
 * falls in behind her, and a gold arrow points home to the nest. In the nest
 * she gathers her line under her wings. The sky darkens, rain begins, and
 * lightning warns that the storm is about to break.
 */

/** When the lightning flashes (seconds into the round), only for the picture and the thunder. */
const LIGHTNING = [9.6, 12.2, 13.9];

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
}

function drawChick(context: CanvasRenderingContext2D, chick: Pick<Chick, "x" | "y" | "heading" | "hop">, time: number, scale = 1) {
	const hop = 1 + 0.08 * Math.abs(Math.sin(time * 9 + chick.hop));
	context.save();
	context.translate(chick.x, chick.y);
	context.rotate(chick.heading);
	context.scale(scale * hop, scale * hop);
	context.fillStyle = "rgba(0,0,0,.18)";
	context.beginPath();
	context.ellipse(1.5, 2, 7, 6, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#ffd84a";
	context.beginPath();
	context.ellipse(-1, 0, 7, 6, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#ffe57f";
	context.beginPath();
	context.arc(4.5, 0, 4.2, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#f08a1c";
	context.beginPath();
	context.moveTo(8.5, -1.6);
	context.lineTo(11.5, 0);
	context.lineTo(8.5, 1.6);
	context.closePath();
	context.fill();
	context.fillStyle = "#2a1d10";
	context.beginPath();
	context.arc(5.5, -2, 0.9, 0, Math.PI * 2);
	context.arc(5.5, 2, 0.9, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawHen(context: CanvasRenderingContext2D, x: number, y: number, facing: number, spread: number) {
	context.save();
	context.translate(x, y);
	context.rotate(facing);
	context.fillStyle = "rgba(0,0,0,.22)";
	context.beginPath();
	context.ellipse(3, 4, 18 + spread * 6, 14 + spread * 8, 0, 0, Math.PI * 2);
	context.fill();
	// Wings, opening wide to gather.
	context.fillStyle = "#8a4b23";
	for (const side of [-1, 1]) {
		context.beginPath();
		context.ellipse(-3, side * (8 + spread * 9), 13 + spread * 5, 6 + spread * 6, side * (0.25 + spread * 0.5), 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "#a85d2c";
	context.beginPath();
	context.ellipse(-2, 0, 16, 12, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#6e3818";
	context.beginPath();
	context.moveTo(-14, 0);
	context.lineTo(-24, -6);
	context.lineTo(-22, 0);
	context.lineTo(-24, 6);
	context.closePath();
	context.fill();
	context.fillStyle = "#b86a35";
	context.beginPath();
	context.arc(12, 0, 7, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#d8322a";
	context.beginPath();
	context.ellipse(13, 0, 4.5, 2.2, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#f0a020";
	context.beginPath();
	context.moveTo(18, -2.2);
	context.lineTo(23, 0);
	context.lineTo(18, 2.2);
	context.closePath();
	context.fill();
	context.fillStyle = "#1e120a";
	context.beginPath();
	context.arc(14.5, -3.6, 1.2, 0, Math.PI * 2);
	context.arc(14.5, 3.6, 1.2, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

export default function UnderHerWings({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WingsState>(newWings(seed));
	const drag = useRef<{ x: number; y: number } | null>(null);
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const thunder = useRef(0);
	const gathered = useRef(-9);
	const ended = useRef(false);
	const lastData = useRef(-1);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, t: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const power = speed * (0.4 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, born: t, life: 0.45 + Math.random() * 0.35, color: colors[i % colors.length], size: 1.4 + Math.random() * 2 });
		}
	}, []);

	const react = useCallback(
		(event: WingsEvent, run: WingsState) => {
			const play = synth.current;
			if (event.type === "follow") {
				burst(event.x, event.y, 10, ["#ffe57f", "#ffffff"], 70, run.t);
				floaters.current.push({ x: event.x, y: event.y - 16, born: run.t, text: "Peep!" });
				play?.tone(1900, 0.07, { type: "sine", volume: 0.12, to: 2500 });
				play?.tone(2100, 0.07, { type: "sine", volume: 0.1, to: 2700, delay: 0.09 });
			}
			if (event.type === "home") {
				gathered.current = run.t;
				burst(WINGS_NEST.x, WINGS_NEST.y, 16 + event.count * 4, ["#ffe2a0", "#ffffff", "#ffd84a"], 120, run.t);
				floaters.current.push({ x: WINGS_NEST.x, y: WINGS_NEST.y - 34, born: run.t, text: `${event.home}/${WINGS_CHICKS} home` });
				play?.tone(330, 0.16, { type: "triangle", volume: 0.16, to: 280 });
				[659, 880].forEach((note, index) => play?.tone(note, 0.35, { type: "sine", volume: 0.12, delay: 0.1 + index * 0.08 }));
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: 0.3 + index * 0.1 }));
			if (event.type === "storm") {
				play?.noise(1.6, { volume: 0.4, filter: 380 });
				play?.tone(70, 1.2, { type: "sawtooth", volume: 0.12, to: 40 });
			}
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		takePresses(keys);
		const held = keys.held;
		const dx = (held.has("arrowright") ? 1 : 0) - (held.has("arrowleft") ? 1 : 0);
		const dy = (held.has("arrowdown") ? 1 : 0) - (held.has("arrowup") ? 1 : 0);
		const events: WingsEvent[] = [];
		const before = run.t;
		stepWings(run, { dx, dy, target: dx || dy ? null : drag.current }, events);
		for (const event of events) react(event, run);
		const strike = LIGHTNING.find((at) => before < at && run.t >= at);
		if (strike !== undefined && run.phase === "playing") {
			thunder.current = run.t;
			synth.current?.noise(1.1, { volume: 0.22 + strike / 60, filter: 300, delay: 0.15 });
		}
		onTime(Math.max(0, WINGS_SECONDS - run.t));
		const canvas = canvasRef.current;
		const tick = Math.floor(run.t * 10);
		if (canvas && tick !== lastData.current) {
			lastData.current = tick;
			canvas.dataset.hen = `${Math.round(run.hen.x)},${Math.round(run.hen.y)},${run.home},${run.followers}`;
			canvas.dataset.chicks = run.chicks
				.filter((chick) => chick.state === "wander")
				.map((chick) => `${Math.round(chick.x)},${Math.round(chick.y)}`)
				.join(" ");
		}
		const result = wingsResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			const still = reducedMotion ? 0 : time;
			const storm = Math.min(1, t / WINGS_SECONDS);

			// The courtyard's paving, warm Jerusalem stone.
			context.fillStyle = "#d9c49a";
			context.fillRect(0, 0, STAGE, STAGE);
			for (let row = 0; row < 14; row++) {
				for (let col = 0; col < 10; col++) {
					const x = col * 42 + (row % 2) * 21 - 10;
					const y = row * 30 - 6;
					context.fillStyle = (row * 7 + col * 3) % 5 === 0 ? "#cdb68a" : (row + col) % 3 === 0 ? "#e2cfa6" : "#d6c093";
					context.fillRect(x + 1.5, y + 1.5, 39, 27);
				}
			}
			// The walls around it, olive trees in two corners, a water jar by the gate.
			context.fillStyle = "#a88b5e";
			context.fillRect(0, 0, STAGE, WINGS_WALL - 4);
			context.fillRect(0, STAGE - WINGS_WALL + 4, STAGE, WINGS_WALL);
			context.fillRect(0, 0, WINGS_WALL - 4, STAGE);
			context.fillRect(STAGE - WINGS_WALL + 4, 0, WINGS_WALL, STAGE);
			context.fillStyle = "#8f744b";
			for (let brick = 0; brick < 20; brick++) {
				context.fillRect(brick * 20 + 2, 3, 16, 5);
				context.fillRect(brick * 20 + 12, STAGE - 9, 16, 5);
			}
			for (const [x, y] of [
				[30, 30],
				[372, 372],
			]) {
				context.fillStyle = "#4f6a3a";
				context.beginPath();
				context.arc(x, y, 30, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#6a8a4a";
				for (let leaf = 0; leaf < 6; leaf++) {
					context.beginPath();
					context.arc(x + Math.cos(leaf + still * 0.8) * 14, y + Math.sin(leaf * 1.7) * 14, 10, 0, Math.PI * 2);
					context.fill();
				}
			}
			context.fillStyle = "#b5653a";
			context.beginPath();
			context.arc(368, 34, 10, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#5a3018";
			context.beginPath();
			context.arc(368, 34, 4, 0, Math.PI * 2);
			context.fill();

			// The nest in the middle, straw in a ring, glowing as home.
			const nestPulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 4);
			const glow = context.createRadialGradient(WINGS_NEST.x, WINGS_NEST.y, 8, WINGS_NEST.x, WINGS_NEST.y, WINGS_NEST_R + 26);
			glow.addColorStop(0, `rgba(255,226,140,${0.45 + 0.2 * nestPulse})`);
			glow.addColorStop(1, "rgba(255,226,140,0)");
			context.fillStyle = glow;
			context.beginPath();
			context.arc(WINGS_NEST.x, WINGS_NEST.y, WINGS_NEST_R + 26, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = "#b08a3e";
			context.lineWidth = 10;
			context.beginPath();
			context.arc(WINGS_NEST.x, WINGS_NEST.y, WINGS_NEST_R - 6, 0, Math.PI * 2);
			context.stroke();
			context.strokeStyle = "#d8b25c";
			context.lineWidth = 2;
			for (let straw = 0; straw < 18; straw++) {
				const angle = (straw / 18) * Math.PI * 2;
				context.beginPath();
				context.moveTo(WINGS_NEST.x + Math.cos(angle) * (WINGS_NEST_R - 12), WINGS_NEST.y + Math.sin(angle) * (WINGS_NEST_R - 12));
				context.lineTo(WINGS_NEST.x + Math.cos(angle + 0.4) * (WINGS_NEST_R - 1), WINGS_NEST.y + Math.sin(angle + 0.4) * (WINGS_NEST_R - 1));
				context.stroke();
			}
			context.fillStyle = "#8a6a2e";
			context.beginPath();
			context.arc(WINGS_NEST.x, WINGS_NEST.y, WINGS_NEST_R - 12, 0, Math.PI * 2);
			context.fill();
			// Chicks already home, snug in the nest.
			const homeChicks = run.chicks.filter((chick) => chick.state === "home");
			homeChicks.forEach((chick, index) => {
				const angle = (index / Math.max(1, homeChicks.length)) * Math.PI * 2 + 0.4;
				drawChick(context, { x: WINGS_NEST.x + Math.cos(angle) * 11, y: WINGS_NEST.y + Math.sin(angle) * 11, heading: angle + Math.PI, hop: chick.hop }, reducedMotion ? 0 : time * 0.3, 0.85);
			});

			const hen = run.hen;
			// A gold arrow home while chicks follow her.
			if (run.followers > 0 && run.phase === "playing") {
				const toNest = Math.hypot(WINGS_NEST.x - hen.x, WINGS_NEST.y - hen.y);
				if (toNest > WINGS_NEST_R + 24) {
					const angle = Math.atan2(WINGS_NEST.y - hen.y, WINGS_NEST.x - hen.x);
					context.strokeStyle = `rgba(255,214,90,${0.6 + 0.4 * nestPulse})`;
					context.setLineDash([7, 7]);
					context.lineDashOffset = -still * 30;
					context.lineWidth = 3;
					context.beginPath();
					context.moveTo(hen.x + Math.cos(angle) * 26, hen.y + Math.sin(angle) * 26);
					context.lineTo(WINGS_NEST.x - Math.cos(angle) * (WINGS_NEST_R + 4), WINGS_NEST.y - Math.sin(angle) * (WINGS_NEST_R + 4));
					context.stroke();
					context.setLineDash([]);
					const tipX = WINGS_NEST.x - Math.cos(angle) * (WINGS_NEST_R + 2);
					const tipY = WINGS_NEST.y - Math.sin(angle) * (WINGS_NEST_R + 2);
					context.fillStyle = "#ffd65a";
					context.beginPath();
					context.moveTo(tipX, tipY);
					context.lineTo(tipX - Math.cos(angle - 0.5) * 13, tipY - Math.sin(angle - 0.5) * 13);
					context.lineTo(tipX - Math.cos(angle + 0.5) * 13, tipY - Math.sin(angle + 0.5) * 13);
					context.closePath();
					context.fill();
				}
			}

			// The scattered chicks, each ringed until the hen reaches it.
			for (const chick of run.chicks) {
				if (chick.state !== "wander") continue;
				const ring = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 6 + chick.id);
				context.strokeStyle = `rgba(255,236,120,${0.55 + 0.45 * ring})`;
				context.lineWidth = 2.5;
				context.beginPath();
				context.arc(chick.x, chick.y, WINGS_CATCH_R - 2 + ring * 4, 0, Math.PI * 2);
				context.stroke();
				drawChick(context, chick, still);
			}
			// The line following her, then the hen herself.
			for (const chick of run.chicks.filter((item) => item.state === "follow")) drawChick(context, chick, still);
			const spread = run.phase === "won" ? 1 : Math.max(0, 1 - (t - gathered.current) / 0.5);
			drawHen(context, hen.x, hen.y, hen.facing, spread);

			// The storm gathering: darkness, cloud shadows, rain, lightning.
			context.fillStyle = `rgba(28,32,58,${0.05 + storm * 0.42})`;
			context.fillRect(0, 0, STAGE, STAGE);
			for (let cloud = 0; cloud < 3; cloud++) {
				const x = ((cloud * 170 + still * (18 + cloud * 6)) % 600) - 100;
				context.fillStyle = `rgba(10,12,30,${0.08 + storm * 0.16})`;
				context.beginPath();
				context.ellipse(x, 80 + cloud * 120, 110, 50, 0.3, 0, Math.PI * 2);
				context.fill();
			}
			if (t > 6) {
				const rain = Math.min(1, (t - 6) / 6);
				context.strokeStyle = `rgba(190,205,240,${0.25 + 0.3 * rain})`;
				context.lineWidth = 1.2;
				context.beginPath();
				for (let drop = 0; drop < Math.floor(20 + rain * 70); drop++) {
					const x = (drop * 53.7 + still * 260) % 420;
					const y = (drop * 91.3 + still * 520) % 420;
					context.moveTo(x, y);
					context.lineTo(x - 4, y + 11);
				}
				context.stroke();
			}
			const sinceBolt = t - thunder.current;
			if (thunder.current > 0 && sinceBolt < 0.35) {
				context.fillStyle = `rgba(235,240,255,${(reducedMotion ? 0.25 : 0.55) * (1 - sinceBolt / 0.35)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			particles.current = particles.current.filter((particle) => t - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = t - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x + particle.vx * age, particle.y + particle.vy * age, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			floaters.current = floaters.current.filter((floater) => t - floater.born < 0.9);
			context.textAlign = "center";
			context.font = "900 16px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = (t - floater.born) / 0.9;
				context.globalAlpha = 1 - age;
				context.lineWidth = 3;
				context.strokeStyle = "rgba(40,24,10,.7)";
				context.strokeText(floater.text, floater.x, floater.y - age * 22);
				context.fillStyle = "#ffe57f";
				context.fillText(floater.text, floater.x, floater.y - age * 22);
			}
			context.globalAlpha = 1;

			// Home so far, and how many follow her.
			context.fillStyle = "rgba(30,24,40,.62)";
			context.beginPath();
			context.roundRect(28, 26, 150, 32, 12);
			context.fill();
			drawChick(context, { x: 46, y: 42, heading: 0, hop: 0 }, 0, 1.1);
			context.textAlign = "left";
			context.font = "900 17px system-ui, sans-serif";
			context.fillStyle = run.home >= WINGS_CHICKS ? "#ffe57f" : "#ffffff";
			context.fillText(`${run.home}/${WINGS_CHICKS} home`, 62, 48);
			if (run.followers > 0) {
				context.fillStyle = "rgba(30,24,40,.62)";
				context.beginPath();
				context.roundRect(STAGE - 168, 26, 140, 32, 12);
				context.fill();
				context.fillStyle = "#ffd65a";
				context.textAlign = "center";
				context.fillText(`${run.followers} following`, STAGE - 98, 48);
			}

			// The first moments: who she is and what to do.
			if (t < 2.2 && run.phase === "playing") {
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 7);
				context.strokeStyle = `rgba(255,236,120,${0.6 + 0.4 * pulse})`;
				context.lineWidth = 3;
				context.beginPath();
				context.arc(hen.x, hen.y, 34 + pulse * 6, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "rgba(30,24,40,.7)";
				context.beginPath();
				context.roundRect(64, 300, 272, 46, 14);
				context.fill();
				context.fillStyle = "#ffffff";
				context.font = "900 15px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Run to each chick ◯", 200, 318);
				context.fillStyle = "#ffe57f";
				context.fillText("then bring them home to the nest", 200, 337);
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,236,180,.22)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (event.type === "pointerdown") {
			event.preventDefault();
			event.currentTarget.setPointerCapture?.(event.pointerId);
		} else if (event.buttons === 0) return; // a hovering mouse or pen is not a drag
		const canvas = canvasRef.current;
		if (canvas) drag.current = stagePoint(canvas, event);
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
			aria-label="A courtyard in Jerusalem as a storm gathers. Six chicks have scattered from the nest. Use the arrow keys, or drag, to move the hen to each chick so it follows her, then bring them home to the nest before the storm breaks."
		/>
	);
}
