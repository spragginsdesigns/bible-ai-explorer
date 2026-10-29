"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SHEEP_RADIUS,
	WOLVES_HEARTS,
	WOLVES_SECONDS,
	crouchSeconds,
	newWolves,
	stepWolves,
	wolvesResult,
	type WolvesEvent,
	type WolvesState,
} from "@/lib/beta/games/sheep-among-wolves-rules";

/**
 * Sheep Among Wolves (LC-17851), Matthew 10:16-31, seen from above: a
 * pasture at dusk, the light going amber and violet, wolves prowling in from
 * the dark edges. A wolf about to lunge crouches low with red eyes and a red
 * line along its path; the sheep must be out of that line when it springs.
 * Doves cross overhead (atmosphere only).
 */

interface Tuft {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	color: string;
}

/** Fixed scenery, the same every round: grass tufts, stones and a few flowers. */
const TUFTS = Array.from({ length: 70 }, (_, index) => ({ x: (index * 97.3) % 400, y: (index * 61.7 + (index % 7) * 13) % 400, s: 3 + (index % 4) }));
const STONES = [
	{ x: 62, y: 318, r: 9 },
	{ x: 330, y: 92, r: 7 },
	{ x: 300, y: 330, r: 11 },
	{ x: 88, y: 70, r: 6 },
];
const FLOWERS = Array.from({ length: 16 }, (_, index) => ({ x: (index * 151.7 + 31) % 380 + 10, y: (index * 83.3 + 47) % 380 + 10 }));

function drawWolf(context: CanvasRenderingContext2D, x: number, y: number, heading: number, crouch: number, lunging: boolean, time: number) {
	context.save();
	context.translate(x, y);
	context.rotate(heading);
	const long = lunging ? 1.25 : 1 - crouch * 0.18;
	const wide = 1 - crouch * 0.12;
	// Shadow.
	context.fillStyle = "rgba(10,8,20,.35)";
	context.beginPath();
	context.ellipse(2, 3, 18 * long, 9 * wide, 0, 0, Math.PI * 2);
	context.fill();
	// Tail.
	const wag = lunging ? 0 : Math.sin(time * 5) * 0.25;
	context.strokeStyle = "#4a4b55";
	context.lineWidth = 5;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(-15 * long, 0);
	context.quadraticCurveTo(-22 * long, wag * 10, -27 * long, wag * 16);
	context.stroke();
	context.lineCap = "butt";
	// Body and head.
	context.fillStyle = crouch > 0 ? "#3e3f49" : "#5d5f6b";
	context.beginPath();
	context.ellipse(0, 0, 16 * long, 8 * wide, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#777987";
	context.beginPath();
	context.ellipse(-2, 0, 9 * long, 4 * wide, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = crouch > 0 ? "#45464f" : "#666874";
	context.beginPath();
	context.ellipse(15 * long, 0, 7.5, 6.5 * wide, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(21 * long + 6, -1.5);
	context.lineTo(21 * long + 6, 1.5);
	context.lineTo(15 * long, 4);
	context.lineTo(15 * long, -4);
	context.closePath();
	context.fill();
	// Ears, laid back when crouching.
	context.fillStyle = "#3a3b44";
	const back = crouch * 3;
	context.beginPath();
	context.moveTo(13 * long - back, -4);
	context.lineTo(9 * long - back, -9 + crouch * 2);
	context.lineTo(16 * long - back, -5);
	context.moveTo(13 * long - back, 4);
	context.lineTo(9 * long - back, 9 - crouch * 2);
	context.lineTo(16 * long - back, 5);
	context.fill();
	// Eyes: red and glowing when it means to spring.
	context.fillStyle = crouch > 0 || lunging ? "#ff3b2f" : "#e8d27a";
	context.beginPath();
	context.arc(18 * long, -2.6, 1.6 + crouch, 0, Math.PI * 2);
	context.arc(18 * long, 2.6, 1.6 + crouch, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawHeart(context: CanvasRenderingContext2D, x: number, y: number, size: number, full: boolean) {
	context.beginPath();
	context.moveTo(x, y + size * 0.35);
	context.bezierCurveTo(x - size * 0.9, y - size * 0.35, x - size * 0.35, y - size * 0.95, x, y - size * 0.4);
	context.bezierCurveTo(x + size * 0.35, y - size * 0.95, x + size * 0.9, y - size * 0.35, x, y + size * 0.35);
	context.closePath();
	context.fillStyle = full ? "#ff6b6b" : "rgba(255,255,255,.18)";
	context.fill();
	context.strokeStyle = full ? "#ffe3e3" : "rgba(255,255,255,.45)";
	context.lineWidth = 1.5;
	context.stroke();
}

export default function SheepAmongWolves({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WolvesState>(newWolves(seed));
	const drag = useRef<{ x: number; y: number } | null>(null);
	const facing = useRef(0);
	const tufts = useRef<Tuft[]>([]);
	const shake = useRef(0);
	const flash = useRef<{ at: number; x: number; y: number; text: string; color: string } | null>(null);
	const wonAt = useRef<number | null>(null);
	const ended = useRef(false);
	const lastData = useRef(-1);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: WolvesEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "crouch") play.tone(110, 0.5, { type: "sawtooth", volume: 0.07, to: 90 });
			if (event.type === "lunge") play.noise(0.22, { volume: 0.22, filter: 2400, type: "bandpass" });
			if (event.type === "bite") {
				play.noise(0.3, { volume: 0.4, filter: 700 });
				play.tone(220, 0.35, { type: "square", volume: 0.1, to: 120 });
			}
			if (event.type === "dodged") play.tone(660, 0.12, { type: "triangle", volume: 0.08, to: 880 });
			if (event.type === "safe") [392, 523, 659, 784].forEach((note, index) => play.tone(note, 1.5, { type: "triangle", volume: 0.14, delay: index * 0.1 }));
			if (event.type === "lost") play.tone(196, 1, { type: "sine", volume: 0.18, to: 110 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		takePresses(keys);
		let x = 0;
		let y = 0;
		if (keys.held.has("arrowleft")) x -= 1;
		if (keys.held.has("arrowright")) x += 1;
		if (keys.held.has("arrowup")) y -= 1;
		if (keys.held.has("arrowdown")) y += 1;
		if (!x && !y && drag.current) {
			const dx = drag.current.x - run.x;
			const dy = drag.current.y - run.y;
			const distance = Math.hypot(dx, dy);
			if (distance > 3) {
				const pull = Math.min(1, distance / 18) / distance;
				x = dx * pull;
				y = dy * pull;
			}
		}
		if (x || y) facing.current = Math.atan2(y, x);
		const events: WolvesEvent[] = [];
		stepWolves(run, { x, y }, events);
		const now = performance.now() / 1000;
		for (const event of events) {
			if (event.type === "bite") {
				shake.current = reducedMotion ? 0 : 9;
				flash.current = { at: now, x: event.x, y: event.y, text: event.hearts > 0 ? "Bitten!" : "Caught!", color: "255,70,60" };
				for (let i = 0; i < 16; i++) {
					const angle = Math.random() * Math.PI * 2;
					const speed = 30 + Math.random() * 80;
					tufts.current.push({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, color: "255,255,255" });
				}
			}
			if (event.type === "dodged") {
				const wolf = run.wolves[event.wolf];
				const near = Math.hypot(wolf.x - run.x, wolf.y - run.y);
				if (near < 70) flash.current = { at: now, x: run.x, y: run.y, text: "Dodged!", color: "255,214,102" };
			}
			sound(event);
		}
		onTime(Math.max(0, WOLVES_SECONDS - run.t));
		const result = wolvesResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const canvas = canvasRef.current;
			if (canvas && Math.floor(time * 10) !== lastData.current) {
				lastData.current = Math.floor(time * 10);
				const wolves = run.wolves
					.map((wolf) => [wolf.x, wolf.y, wolf.fromX, wolf.fromY, wolf.toX, wolf.toY].map((value) => value.toFixed(1)).join(":") + `:${wolf.mode[0]}:${wolf.since.toFixed(3)}:${wolf.next.toFixed(3)}:${wolf.angle.toFixed(3)}`)
					.join(";");
				canvas.dataset.run = `${seed},${run.t.toFixed(3)},${run.x.toFixed(1)},${run.y.toFixed(1)},${run.hearts},${run.lastCrouch.toFixed(3)},${run.draws},${run.safeUntil.toFixed(3)}|${wolves}`;
			}
			const won = run.phase === "won";
			if (won && wonAt.current === null) wonAt.current = time;
			const calm = won && wonAt.current !== null ? Math.min(1, (time - wonAt.current) / 1.5) : 0;

			context.save();
			if (shake.current > 0.2) {
				context.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
				shake.current *= 0.86;
			}
			// The pasture at dusk: amber light from the west, violet shadow at the edges.
			const field = context.createLinearGradient(0, 0, STAGE, STAGE);
			field.addColorStop(0, "#5c6e3e");
			field.addColorStop(0.55, "#465a36");
			field.addColorStop(1, "#2f3d2e");
			context.fillStyle = field;
			context.fillRect(-12, -12, STAGE + 24, STAGE + 24);
			const sun = context.createRadialGradient(40, 30, 10, 40, 30, 300);
			sun.addColorStop(0, "rgba(255,190,110,.45)");
			sun.addColorStop(1, "rgba(255,190,110,0)");
			context.fillStyle = sun;
			context.fillRect(0, 0, STAGE, STAGE);
			context.strokeStyle = "rgba(170,190,110,.35)";
			context.lineWidth = 1.4;
			for (const tuft of TUFTS) {
				context.beginPath();
				context.moveTo(tuft.x - tuft.s, tuft.y + tuft.s);
				context.lineTo(tuft.x - tuft.s * 0.4, tuft.y - tuft.s);
				context.moveTo(tuft.x, tuft.y + tuft.s);
				context.lineTo(tuft.x + tuft.s * 0.2, tuft.y - tuft.s * 1.2);
				context.moveTo(tuft.x + tuft.s, tuft.y + tuft.s);
				context.lineTo(tuft.x + tuft.s * 0.8, tuft.y - tuft.s * 0.7);
				context.stroke();
			}
			for (const stone of STONES) {
				context.fillStyle = "rgba(0,0,0,.25)";
				context.beginPath();
				context.ellipse(stone.x + 3, stone.y + 3, stone.r, stone.r * 0.75, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#8d8a7c";
				context.beginPath();
				context.ellipse(stone.x, stone.y, stone.r, stone.r * 0.75, 0, 0, Math.PI * 2);
				context.fill();
			}
			context.fillStyle = "rgba(255,236,190,.55)";
			for (const flower of FLOWERS) {
				context.beginPath();
				context.arc(flower.x, flower.y, 1.6, 0, Math.PI * 2);
				context.fill();
			}
			const vignette = context.createRadialGradient(200, 200, 120, 200, 200, 300);
			vignette.addColorStop(0, "rgba(30,18,60,0)");
			vignette.addColorStop(1, `rgba(30,18,60,${0.65 - calm * 0.35})`);
			context.fillStyle = vignette;
			context.fillRect(0, 0, STAGE, STAGE);

			// The lines of crouching wolves: where each will spring.
			for (const wolf of run.wolves) {
				if (wolf.mode !== "crouch" || won) continue;
				const progress = Math.min(1, (run.t - wolf.since) / crouchSeconds(wolf.since));
				const blink = reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(time * 22);
				context.strokeStyle = `rgba(255,59,47,${(0.35 + progress * 0.55) * blink})`;
				context.lineWidth = 3 + progress * 7;
				context.setLineDash([10, 7]);
				context.beginPath();
				context.moveTo(wolf.fromX, wolf.fromY);
				context.lineTo(wolf.toX, wolf.toY);
				context.stroke();
				context.setLineDash([]);
				const angle = Math.atan2(wolf.toY - wolf.fromY, wolf.toX - wolf.fromX);
				context.fillStyle = `rgba(255,59,47,${0.5 + progress * 0.5})`;
				context.beginPath();
				context.moveTo(wolf.toX + Math.cos(angle) * 8, wolf.toY + Math.sin(angle) * 8);
				context.lineTo(wolf.toX + Math.cos(angle + 2.5) * 14, wolf.toY + Math.sin(angle + 2.5) * 14);
				context.lineTo(wolf.toX + Math.cos(angle - 2.5) * 14, wolf.toY + Math.sin(angle - 2.5) * 14);
				context.closePath();
				context.fill();
			}

			// The wolves (after the round they slink back into the dark).
			for (const wolf of run.wolves) {
				if (run.t < wolf.enters && !won) continue;
				let x = wolf.x;
				let y = wolf.y;
				let heading = Math.atan2(run.y - wolf.y, run.x - wolf.x);
				if (wolf.mode === "crouch" || wolf.mode === "lunge") heading = Math.atan2(wolf.toY - wolf.fromY, wolf.toX - wolf.fromX);
				if (won) {
					const away = Math.atan2(wolf.y - 200, wolf.x - 200);
					x += Math.cos(away) * calm * 220;
					y += Math.sin(away) * calm * 220;
					heading = away;
				}
				const crouch = wolf.mode === "crouch" ? Math.min(1, (run.t - wolf.since) / 0.2) : 0;
				if (wolf.mode === "lunge" && !won) {
					context.strokeStyle = "rgba(220,220,235,.35)";
					context.lineWidth = 10;
					context.lineCap = "round";
					context.beginPath();
					context.moveTo(wolf.fromX + (x - wolf.fromX) * 0.4, wolf.fromY + (y - wolf.fromY) * 0.4);
					context.lineTo(x, y);
					context.stroke();
					context.lineCap = "butt";
				}
				drawWolf(context, x, y, heading, won ? 0 : crouch, wolf.mode === "lunge" && !won, time);
				if (wolf.mode === "crouch" && !won) {
					context.fillStyle = "#ff3b2f";
					context.font = "900 18px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("!", x, y - 18);
				}
			}

			// The sheep: wool and a dark face, a gold ring so she is always easy to find.
			const sheepX = run.x;
			const sheepY = run.y;
			const safe = run.t < run.safeUntil && run.phase === "playing";
			if (calm > 0) {
				const light = context.createRadialGradient(sheepX, sheepY, 4, sheepX, sheepY, 30 + calm * 110);
				light.addColorStop(0, `rgba(255,244,214,${0.6 * calm})`);
				light.addColorStop(1, "rgba(255,244,214,0)");
				context.fillStyle = light;
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.strokeStyle = "rgba(255,214,102,.9)";
			context.lineWidth = 2.5;
			context.beginPath();
			context.arc(sheepX, sheepY, SHEEP_RADIUS + 7, 0, Math.PI * 2);
			context.stroke();
			if (run.t > 0 && run.t < 1.8 && run.phase === "playing") {
				const ring = (run.t * 1.3) % 1;
				context.strokeStyle = `rgba(255,214,102,${1 - ring})`;
				context.lineWidth = 3;
				context.beginPath();
				context.arc(sheepX, sheepY, SHEEP_RADIUS + 10 + ring * 30, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "#fff6d6";
				context.font = "900 15px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Keep moving!", sheepX, sheepY + 48);
			}
			context.globalAlpha = safe && Math.floor(time * 12) % 2 ? 0.4 : 1;
			context.fillStyle = "rgba(10,8,20,.3)";
			context.beginPath();
			context.ellipse(sheepX + 2, sheepY + 3, SHEEP_RADIUS + 2, SHEEP_RADIUS, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#f6f1e4";
			for (let i = 0; i < 6; i++) {
				const angle = (i / 6) * Math.PI * 2 + 0.3;
				context.beginPath();
				context.arc(sheepX + Math.cos(angle) * 5.5, sheepY + Math.sin(angle) * 5, 6.2, 0, Math.PI * 2);
				context.fill();
			}
			context.beginPath();
			context.arc(sheepX, sheepY, 7, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#2b2622";
			context.beginPath();
			context.ellipse(sheepX + Math.cos(facing.current) * 10, sheepY + Math.sin(facing.current) * 10, 5, 4, facing.current, 0, Math.PI * 2);
			context.fill();
			context.globalAlpha = 1;

			// Where a drag is steering her.
			if (drag.current && run.phase === "playing") {
				context.strokeStyle = "rgba(255,255,255,.6)";
				context.lineWidth = 2;
				context.setLineDash([4, 4]);
				context.beginPath();
				context.moveTo(sheepX, sheepY);
				context.lineTo(drag.current.x, drag.current.y);
				context.stroke();
				context.setLineDash([]);
			}

			// Wool on a bite, and the bite or dodge called out.
			tufts.current = tufts.current.filter((tuft) => time - tuft.born < 0.8);
			for (const tuft of tufts.current) {
				const age = Math.max(0, (time - tuft.born) / 0.8);
				context.fillStyle = `rgba(${tuft.color},${(1 - age).toFixed(2)})`;
				context.beginPath();
				context.arc(tuft.x + tuft.vx * age * 0.8, tuft.y + tuft.vy * age * 0.8, 3 - age * 1.5, 0, Math.PI * 2);
				context.fill();
			}
			if (flash.current && time - flash.current.at < 0.7) {
				const age = Math.max(0, (time - flash.current.at) / 0.7);
				if (flash.current.text !== "Dodged!") {
					context.fillStyle = `rgba(${flash.current.color},${0.25 * (1 - age)})`;
					context.fillRect(0, 0, STAGE, STAGE);
				}
				context.fillStyle = `rgba(${flash.current.color},${1 - age})`;
				context.font = "900 17px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(flash.current.text, Math.max(50, Math.min(STAGE - 50, flash.current.x)), Math.max(40, flash.current.y - 26 - age * 18));
			}

			// Doves crossing the dusk sky, for peace.
			for (let i = 0; i < 3; i++) {
				const along = ((time * 0.045 + i * 0.37) % 1.3) - 0.15;
				const bx = along * STAGE;
				const by = 40 + i * 120 + Math.sin(time * 0.7 + i) * 18 - along * 40;
				const flap = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 9 + i * 2);
				context.strokeStyle = `rgba(255,250,240,${0.55 + calm * 0.4})`;
				context.lineWidth = 2;
				context.beginPath();
				context.moveTo(bx - 10, by - 3 - flap * 5);
				context.quadraticCurveTo(bx - 4, by, bx, by + 1);
				context.quadraticCurveTo(bx + 4, by, bx + 10, by - 3 - flap * 5);
				context.stroke();
				context.fillStyle = `rgba(255,250,240,${0.55 + calm * 0.4})`;
				context.beginPath();
				context.ellipse(bx + 1, by + 1, 3.5, 2, 0, 0, Math.PI * 2);
				context.fill();
			}

			// Hearts.
			for (let i = 0; i < WOLVES_HEARTS; i++) drawHeart(context, 20 + i * 24, 22, 18, i < run.hearts);
			context.restore();
		},
		[reducedMotion, seed],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	/** A finger steers the sheep to just above itself, so the sheep and a lunge aimed at it stay in sight. */
	const TOUCH_LIFT = 40;
	const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const at = stagePoint(canvas, event);
		// The lift fades out near the bottom edge, so the sheep can still reach the bottom of the field.
		drag.current = event.pointerType === "touch" ? { x: at.x, y: Math.max(0, at.y - TOUCH_LIFT * Math.min(1, (STAGE - at.y) / 80)) } : at;
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		point(event);
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (drag.current) point(event);
	};
	const onPointerUp = () => {
		drag.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A sheep in a field at dusk with wolves prowling round it. Move the sheep with the arrow keys, or drag. A wolf crouches and shows a red line before it lunges: step out of the line."
		/>
	);
}
