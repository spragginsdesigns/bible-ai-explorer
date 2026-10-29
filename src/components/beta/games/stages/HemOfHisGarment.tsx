"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	HEM_JESUS_Y,
	HEM_LANES,
	HEM_RADIUS,
	HEM_SECONDS,
	HEM_START,
	PERSON_RADIUS,
	crowdAt,
	hemPoint,
	hemResult,
	jesusX,
	newHem,
	stepHem,
	type HemEvent,
	type HemState,
} from "@/lib/beta/games/hem-of-his-garment-rules";

/**
 * The Hem of His Garment (LC-17851), Matthew 9:20-22, seen from above: a
 * sunlit street in Capernaum, the multitude pressing along it in rows, Jesus
 * walking across the top with the hem of his garment trailing behind him in
 * soft light. The woman (veiled, in blue) starts at the bottom; arrows or a
 * drag move her through the gaps. A bump sends her back.
 */

/** Robes of the multitude, earthy and varied; 6 and 7 are the disciples. */
const ROBES = ["#8a5a3c", "#6f7a4a", "#9b6b4e", "#5f5470", "#a4824f", "#7a4b46", "#8c7a5c", "#6a6a58"];
const HEADS = ["#3a2a1e", "#4a3424", "#d8c7a4", "#2e2a26", "#c9b48a", "#55402c", "#3b2c20", "#d2c09a"];
const HEM_GOLD = "#ffe7a3";

interface Puff {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	color: string;
}

function drawPerson(context: CanvasRenderingContext2D, x: number, y: number, robe: string, head: string, dir: number, sway: number) {
	context.fillStyle = "rgba(60,40,20,.16)";
	context.beginPath();
	context.ellipse(x + 1.5, y + 2.5, PERSON_RADIUS * 0.85, PERSON_RADIUS * 1.05, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = robe;
	context.beginPath();
	context.ellipse(x, y, PERSON_RADIUS * 0.72, PERSON_RADIUS, sway * 0.08, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = head;
	context.beginPath();
	context.arc(x + dir * 2.5, y, PERSON_RADIUS * 0.45, 0, Math.PI * 2);
	context.fill();
}

export default function HemOfHisGarment({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<HemState>(newHem(seed));
	const drag = useRef<{ x: number; y: number } | null>(null);
	const shown = useRef({ x: HEM_START.x, y: HEM_START.y });
	const puffs = useRef<Puff[]>([]);
	const shake = useRef(0);
	const flash = useRef<{ at: number; text: string; x: number; y: number } | null>(null);
	const ended = useRef(false);
	const lastData = useRef(-1);
	const wonAt = useRef<number | null>(null);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: HemEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "bump") {
				play.noise(0.25, { volume: 0.35, filter: 500 });
				play.tone(150, 0.22, { type: "square", volume: 0.08, to: 90 });
			}
			if (event.type === "row") play.tone(440 + event.row * 70, 0.14, { type: "triangle", volume: 0.12 });
			if (event.type === "touched") [523, 659, 784, 1047, 1319].forEach((note, index) => play.tone(note, 1.6, { type: "sine", volume: 0.14, delay: index * 0.08 }));
			if (event.type === "passed") play.tone(260, 0.9, { type: "sine", volume: 0.16, to: 170 });
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
		const events: HemEvent[] = [];
		stepHem(run, { x, y }, events);
		const now = performance.now() / 1000;
		for (const event of events) {
			if (event.type === "bump") {
				shake.current = reducedMotion ? 0 : 7;
				flash.current = { at: now, text: "Pushed back!", x: event.x, y: event.y };
				for (let i = 0; i < 12; i++) {
					const angle = Math.random() * Math.PI * 2;
					puffs.current.push({ x: event.x, y: event.y, vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60, born: now, color: "rgba(150,110,70," });
				}
			}
			if (event.type === "touched") {
				for (let i = 0; i < 28; i++) {
					const angle = Math.random() * Math.PI * 2;
					const speed = 40 + Math.random() * 90;
					puffs.current.push({ x: run.x, y: run.y - 6, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, color: "rgba(255,231,163," });
				}
			}
			sound(event);
		}
		onTime(Math.max(0, HEM_SECONDS - run.t));
		const result = hemResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.endedAt ?? run.t;
			const canvas = canvasRef.current;
			if (canvas && Math.floor(time * 10) !== lastData.current) {
				lastData.current = Math.floor(time * 10);
				canvas.dataset.run = `${seed},${run.t.toFixed(3)},${run.x.toFixed(1)},${run.y.toFixed(1)}`;
			}
			// She is drawn easing toward where the rules put her, so a bump reads as a shove.
			const ease = run.t < run.stunUntil ? 0.25 : 0.6;
			shown.current.x += (run.x - shown.current.x) * ease;
			shown.current.y += (run.y - shown.current.y) * ease;
			const her = shown.current;

			context.save();
			if (shake.current > 0.2) {
				context.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
				shake.current *= 0.85;
			}
			// The street: warm limestone flags in afternoon sun, house walls in shadow at the top.
			context.fillStyle = "#e3c48f";
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			context.strokeStyle = "rgba(150,110,60,.22)";
			context.lineWidth = 1;
			for (let row = 0; row < 14; row++) {
				const y = 40 + row * 28;
				context.beginPath();
				context.moveTo(0, y);
				context.lineTo(STAGE, y);
				context.stroke();
				for (let col = 0; col < 9; col++) {
					const x = ((row % 2) * 26 + col * 52) % (STAGE + 52);
					context.beginPath();
					context.moveTo(x, y);
					context.lineTo(x, y + 28);
					context.stroke();
				}
			}
			context.fillStyle = "#b98a57";
			context.fillRect(0, 0, STAGE, 34);
			context.fillStyle = "#9c6f43";
			for (let i = 0; i < 6; i++) context.fillRect(i * 72 + 6, 0, 52, 26);
			context.fillStyle = "rgba(80,50,25,.25)";
			context.fillRect(0, 34, STAGE, 10);
			// An awning's striped shade at the bottom, where she starts.
			context.fillStyle = "rgba(120,60,40,.14)";
			context.fillRect(0, 352, STAGE, 48);

			// Jesus, a figure in soft light, and the hem trailing behind him.
			const jx = jesusX(t);
			const hem = hemPoint(t);
			const won = run.phase === "won";
			const glow = context.createRadialGradient(jx, HEM_JESUS_Y, 4, jx, HEM_JESUS_Y, won ? 120 : 58);
			glow.addColorStop(0, "rgba(255,248,224,.95)");
			glow.addColorStop(1, "rgba(255,248,224,0)");
			context.fillStyle = glow;
			context.fillRect(jx - 130, HEM_JESUS_Y - 130, 260, 260);
			context.fillStyle = "#fffaf0";
			context.beginPath();
			context.moveTo(jx + 6, HEM_JESUS_Y - 12);
			context.quadraticCurveTo(jx - 16, HEM_JESUS_Y - 6, hem.x - 2, hem.y + 2 + Math.sin(time * 3) * 1.5);
			context.lineTo(hem.x + 4, hem.y + 7);
			context.quadraticCurveTo(jx - 8, HEM_JESUS_Y + 12, jx + 8, HEM_JESUS_Y + 10);
			context.closePath();
			context.fill();
			context.beginPath();
			context.ellipse(jx, HEM_JESUS_Y, 11, 14, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#c79a5b";
			context.beginPath();
			context.arc(jx + 3, HEM_JESUS_Y, 6, 0, Math.PI * 2);
			context.fill();
			// The hem: a glowing gold border, pulsing so it reads as the goal.
			const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 6);
			context.strokeStyle = HEM_GOLD;
			context.lineWidth = 3;
			context.beginPath();
			context.moveTo(hem.x - 2, hem.y + 2);
			context.lineTo(hem.x + 6, hem.y + 8);
			context.stroke();
			if (!won && hem.x > -10) {
				context.strokeStyle = `rgba(255,214,102,${0.55 + pulse * 0.45})`;
				context.lineWidth = 3;
				context.beginPath();
				context.arc(hem.x + 2, hem.y + 4, 14 + pulse * 6, 0, Math.PI * 2);
				context.stroke();
			}

			// The multitude, pressing along the street.
			for (const person of crowdAt(run, t)) {
				const sway = reducedMotion ? 0 : Math.sin(time * 9 + person.x * 0.2);
				drawPerson(context, person.x, person.y + sway * 0.8, ROBES[person.tint], HEADS[person.tint], person.dir, sway);
			}

			// The goal, named above the hem while she is far off and as she nears it.
			if (!won && hem.x > -10 && ((run.t > 0 && run.t < 3) || run.y < 160)) {
				const labelX = Math.max(64, Math.min(STAGE - 64, hem.x - 18));
				context.fillStyle = "rgba(255,247,226,.92)";
				context.beginPath();
				context.roundRect(labelX - 58, hem.y - 44, 116, 22, 11);
				context.fill();
				context.fillStyle = "#5a3412";
				context.font = "900 13px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Touch the hem", labelX, hem.y - 28);
			}

			// Where a drag is steering her.
			if (drag.current && run.phase === "playing") {
				context.strokeStyle = "rgba(255,255,255,.7)";
				context.lineWidth = 2;
				context.setLineDash([4, 4]);
				context.beginPath();
				context.moveTo(her.x, her.y);
				context.lineTo(drag.current.x, drag.current.y);
				context.stroke();
				context.setLineDash([]);
			}

			// The woman: veiled, in blue, a gold ring under her so she is easy to find.
			const stunned = run.t < run.stunUntil;
			const safe = run.t < run.safeUntil && !stunned;
			context.strokeStyle = stunned ? "#e0523a" : "rgba(255,214,102,.95)";
			context.lineWidth = 3;
			context.beginPath();
			context.arc(her.x, her.y, HEM_RADIUS + 7, 0, Math.PI * 2);
			context.stroke();
			if (run.t > 0 && run.t < 2.2 && run.phase === "playing") {
				const ring = (run.t * 1.4) % 1;
				context.strokeStyle = `rgba(255,214,102,${1 - ring})`;
				context.beginPath();
				context.arc(her.x, her.y, HEM_RADIUS + 10 + ring * 28, 0, Math.PI * 2);
				context.stroke();
				// An arrow from her toward the hem.
				const ax = hem.x - her.x;
				const ay = hem.y - her.y;
				const length = Math.hypot(ax, ay) || 1;
				const ux = ax / length;
				const uy = ay / length;
				const tipX = her.x + ux * 62;
				const tipY = her.y + uy * 62;
				context.strokeStyle = "#fff6d6";
				context.lineWidth = 5;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(her.x + ux * 26, her.y + uy * 26);
				context.lineTo(tipX, tipY);
				context.moveTo(tipX, tipY);
				context.lineTo(tipX - ux * 12 - uy * 9, tipY - uy * 12 + ux * 9);
				context.moveTo(tipX, tipY);
				context.lineTo(tipX - ux * 12 + uy * 9, tipY - uy * 12 - ux * 9);
				context.stroke();
				context.lineCap = "butt";
			}
			context.globalAlpha = safe && Math.floor(time * 12) % 2 ? 0.55 : 1;
			context.fillStyle = "rgba(60,40,20,.25)";
			context.beginPath();
			context.ellipse(her.x + 3, her.y + 4, HEM_RADIUS + 1, HEM_RADIUS, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#2f5d8c";
			context.beginPath();
			context.ellipse(her.x, her.y, HEM_RADIUS * 0.85, HEM_RADIUS * 1.15, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#cfe0f0";
			context.beginPath();
			context.arc(her.x, her.y - 1, HEM_RADIUS * 0.55, 0, Math.PI * 2);
			context.fill();
			// Her hand reaches out as she nears the hem.
			const reach = Math.hypot(hem.x - her.x, hem.y - her.y);
			if (reach < 70 || won) {
				const ux = (hem.x - her.x) / (reach || 1);
				const uy = (hem.y - her.y) / (reach || 1);
				const arm = won ? Math.min(14, reach) : 6 + (1 - Math.min(1, reach / 70)) * 8;
				context.strokeStyle = "#2f5d8c";
				context.lineWidth = 4;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(her.x + ux * 6, her.y + uy * 6);
				context.lineTo(her.x + ux * (6 + arm), her.y + uy * (6 + arm));
				context.stroke();
				context.fillStyle = "#e9c9a3";
				context.beginPath();
				context.arc(her.x + ux * (8 + arm), her.y + uy * (8 + arm), 2.6, 0, Math.PI * 2);
				context.fill();
				context.lineCap = "butt";
			}
			context.globalAlpha = 1;

			// Dust and light.
			puffs.current = puffs.current.filter((puff) => time - puff.born < 0.9);
			for (const puff of puffs.current) {
				const age = Math.max(0, (time - puff.born) / 0.9);
				const x = puff.x + puff.vx * age * 0.9;
				const y = puff.y + puff.vy * age * 0.9;
				context.fillStyle = `${puff.color}${(1 - age).toFixed(2)})`;
				context.beginPath();
				context.arc(x, y, 2.5 + age * 3, 0, Math.PI * 2);
				context.fill();
			}
			if (flash.current && time - flash.current.at < 0.8) {
				const age = Math.max(0, (time - flash.current.at) / 0.8);
				context.fillStyle = `rgba(224,82,58,${0.18 * (1 - age)})`;
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = `rgba(120,25,15,${1 - age})`;
				context.font = "900 16px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(flash.current.text, Math.max(60, Math.min(STAGE - 60, flash.current.x)), flash.current.y - 22 - age * 16);
			}
			// The rows still to pass, as small marks at the side.
			context.fillStyle = "rgba(90,52,18,.55)";
			context.font = "800 11px system-ui, sans-serif";
			context.textAlign = "left";
			HEM_LANES.forEach((laneY, index) => {
				context.fillStyle = index < run.rows ? "rgba(255,214,102,.95)" : "rgba(90,52,18,.35)";
				context.beginPath();
				context.arc(6, laneY, 3.5, 0, Math.PI * 2);
				context.fill();
			});
			if (won) {
				const since = Math.min(1, Math.max(0, time - (wonAt.current ??= time)) / 1.2);
				const burst = context.createRadialGradient(hem.x, hem.y, 4, hem.x, hem.y, 40 + since * 260);
				burst.addColorStop(0, `rgba(255,244,214,${0.85 - since * 0.4})`);
				burst.addColorStop(1, "rgba(255,244,214,0)");
				context.fillStyle = burst;
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.restore();
		},
		[reducedMotion, seed],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (canvas) drag.current = stagePoint(canvas, event);
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
			aria-label="A crowded street seen from above. Jesus walks across the top with the hem of his garment trailing behind him. Move the woman with the arrow keys, or drag, through the gaps in the crowd to touch the hem."
		/>
	);
}
