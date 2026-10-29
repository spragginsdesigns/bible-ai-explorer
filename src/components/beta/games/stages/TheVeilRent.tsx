"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	VEIL_BOTTOM,
	VEIL_OFF_LIMIT,
	VEIL_SECONDS,
	VEIL_TOLERANCE,
	VEIL_TOP,
	newVeil,
	stepVeil,
	veilOnSeam,
	veilQuaking,
	veilResult,
	veilSeam,
	veilY,
	type VeilEvent,
	type VeilInput,
	type VeilState,
} from "@/lib/beta/games/the-veil-rent-rules";

/**
 * The Veil Was Rent (LC-17851), Matthew 27:50-54. Reverent and quiet: no
 * figures, no cross; only the temple's veil of blue, purple and scarlet with
 * cherubim worked in gold (Exodus 26:31), hanging in the darkness over all
 * the land (v45). A seam of light wavers down it; keep the rending point on
 * it with ← → or a drag while the earth quakes. At the bottom the veil is
 * rent in twain from the top to the bottom, and light floods through.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const LEFT = 52;
const RIGHT = 348;
const OUTRO_WON = 130;
const OUTRO_LOST = 40;
const BANDS = ["#1d3f8f", "#4a2a78", "#8e1f2e", "#1d3f8f", "#4a2a78", "#8e1f2e", "#1d3f8f", "#4a2a78"];

function cherub(context: CanvasRenderingContext2D, x: number, y: number, s: number) {
	// Cherubim worked in gold thread (Exodus 26:31): only their wings, stretched forth on high
	// (Exodus 25:20), feathers sweeping up from a rosette. A motif, never a figure.
	context.strokeStyle = "rgba(226,184,96,.5)";
	context.lineWidth = 1.3;
	context.lineCap = "round";
	for (const side of [-1, 1]) {
		for (let feather = 0; feather < 4; feather++) {
			const reach = (22 - feather * 3.5) * s;
			const rise = (28 - feather * 6) * s;
			context.beginPath();
			context.moveTo(x + side * 2 * s, y - feather * 2 * s);
			context.quadraticCurveTo(x + side * (6 + feather * 3) * s, y - rise * 0.75, x + side * reach, y - rise);
			context.stroke();
		}
	}
	context.beginPath();
	for (let petal = 0; petal < 6; petal++) {
		const angle = (petal / 6) * Math.PI * 2;
		context.moveTo(x, y + 4 * s);
		context.lineTo(x + Math.cos(angle) * 4 * s, y + 4 * s + Math.sin(angle) * 4 * s);
	}
	context.stroke();
}

export default function TheVeilRent({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<VeilState>(newVeil(seed));
	const drag = useRef<{ id: number; startX: number; fromX: number; toward: number } | null>(null);
	const trail = useRef<{ x: number; y: number }[]>([]);
	const outro = useRef(0);
	const ended = useRef(false);
	const shake = useRef(0);
	const lastFrame = useRef(0);
	const lastData = useRef(0);
	const lastDrone = useRef(-1);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: VeilEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "quake") {
				play.noise(1.1, { volume: 0.5, filter: 110 });
				play.tone(41, 1, { type: "sine", volume: 0.2, to: 35 });
			}
			if (event.type === "slip") play.tone(98, 0.4, { type: "sine", volume: 0.12, to: 82 });
			if (event.type === "back") play.tone(147, 0.2, { type: "sine", volume: 0.06 });
			if (event.type === "rent") {
				play.noise(0.9, { volume: 0.3, filter: 2600, type: "bandpass" });
				[262, 330, 392, 523, 659, 784].forEach((note, index) => play.tone(note, 2.6, { type: "sine", volume: 0.1, delay: 0.25 + index * 0.07 }));
			}
			if (event.type === "lost") play.tone(73, 1.4, { type: "sine", volume: 0.16, to: 55 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = veilResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		keys.presses.length = 0;
		const input: VeilInput = {};
		if (drag.current) input.toward = drag.current.toward;
		else input.dir = (keys.held.has("arrowright") ? 1 : 0) - (keys.held.has("arrowleft") ? 1 : 0);
		const before = run.progress;
		const events: VeilEvent[] = [];
		stepVeil(run, input, events);
		if (run.progress > before) trail.current.push({ x: (run.x + veilSeam(run, veilY(run))) / 2, y: veilY(run) });
		const play = synth.current;
		if (play) {
			// A low drone, tolling each second, and the cloth tearing while the point is on the seam.
			const second = Math.floor(run.t);
			if (second !== lastDrone.current) {
				lastDrone.current = second;
				play.tone(55, 1.3, { type: "sine", volume: 0.1 });
				play.tone(82.5, 1.3, { type: "sine", volume: 0.05 });
			}
			if (run.progress > before && run.tick % 5 === 0) play.noise(0.07, { volume: 0.04, filter: 1800, type: "bandpass" });
		}
		for (const event of events) {
			sound(event);
			if (event.type === "quake") shake.current = 1;
		}
		onTime(Math.max(0, VEIL_SECONDS - run.t));
	}, [keys, onEnd, onTime, sound, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const y = veilY(run);
			const seamHere = veilSeam(run, y);
			const on = veilOnSeam(run);
			const canvas = canvasRef.current;
			if (canvas && time - lastData.current > 0.03) {
				lastData.current = time;
				canvas.dataset.veil = `${Math.round(run.x)},${Math.round(y)},${Math.round(seamHere)},${run.phase}`;
			}
			const quaking = run.phase === "playing" && veilQuaking(run);
			if (quaking) shake.current = Math.max(shake.current, 0.6);
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 41) * 3.5 * shake.current, Math.cos(time * 53) * 2 * shake.current);
			shake.current = Math.max(0, shake.current - dt * 1.5);

			// Darkness over all the land.
			context.fillStyle = "#050407";
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			const won = run.phase === "won";
			const part = won ? Math.min(1, outro.current / 70) : 0;
			const ease = part * part * (3 - 2 * part);

			// Light behind the veil, seen when it parts.
			if (won) {
				const light = context.createRadialGradient(200, 200, 10, 200, 200, 260);
				light.addColorStop(0, `rgba(255,250,232,${ease})`);
				light.addColorStop(0.5, `rgba(255,226,160,${0.7 * ease})`);
				light.addColorStop(1, `rgba(255,200,120,${0.1 * ease})`);
				context.fillStyle = light;
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			}

			// The veil: blue, purple and scarlet, with cherubim, hung from its rod.
			const halves = won ? [-1, 1] : [0];
			for (const half of halves) {
				context.save();
				if (won) {
					// Each half pulls back to its side along the rent, its torn edge with it.
					context.translate(half * ease * 150, 0);
					context.beginPath();
					if (half < 0) {
						context.moveTo(LEFT - 10, VEIL_TOP - 20);
						for (const point of trail.current) context.lineTo(point.x, point.y);
						context.lineTo(trail.current.at(-1)?.x ?? 200, VEIL_BOTTOM + 20);
						context.lineTo(LEFT - 10, VEIL_BOTTOM + 20);
					} else {
						context.moveTo(RIGHT + 10, VEIL_TOP - 20);
						for (const point of trail.current) context.lineTo(point.x, point.y);
						context.lineTo(trail.current.at(-1)?.x ?? 200, VEIL_BOTTOM + 20);
						context.lineTo(RIGHT + 10, VEIL_BOTTOM + 20);
					}
					context.closePath();
					context.clip();
				}
				const bandW = (RIGHT - LEFT) / BANDS.length;
				BANDS.forEach((color, index) => {
					context.fillStyle = color;
					context.fillRect(LEFT + index * bandW, VEIL_TOP - 10, bandW + 0.5, VEIL_BOTTOM - VEIL_TOP + 22);
				});
				// Folds: soft shadows across the weave.
				for (let x = LEFT; x < RIGHT; x += 6) {
					const fold = Math.sin(x / 13) * 0.5 + 0.5;
					context.fillStyle = `rgba(0,0,0,${0.12 + 0.28 * fold})`;
					context.fillRect(x, VEIL_TOP - 10, 6, VEIL_BOTTOM - VEIL_TOP + 22);
				}
				for (let row = 0; row < 4; row++) {
					for (let column = 0; column < 3; column++) cherub(context, LEFT + 50 + column * 98 + (row % 2) * 30, VEIL_TOP + 52 + row * 84, 1);
				}
				// Fine twined linen: a gold border.
				context.strokeStyle = "rgba(226,184,96,.6)";
				context.lineWidth = 3;
				context.strokeRect(LEFT + 4, VEIL_TOP - 6, RIGHT - LEFT - 8, VEIL_BOTTOM - VEIL_TOP + 14);
				// Dim it in the darkness.
				context.fillStyle = "rgba(5,4,7,.38)";
				context.fillRect(LEFT, VEIL_TOP - 10, RIGHT - LEFT, VEIL_BOTTOM - VEIL_TOP + 22);
				context.restore();
			}
			context.fillStyle = "#6b5124";
			context.fillRect(LEFT - 16, VEIL_TOP - 20, RIGHT - LEFT + 32, 8);

			if (!won) {
				// The seam ahead: a wavering thread of light down to the bottom.
				const pulse = reducedMotion ? 0.8 : 0.65 + 0.25 * Math.sin(time * 5);
				context.strokeStyle = `rgba(255,232,170,${0.18 * pulse})`;
				context.lineWidth = VEIL_TOLERANCE * 2;
				context.lineCap = "round";
				context.beginPath();
				for (let sy = y; sy <= VEIL_BOTTOM; sy += 4) {
					const sx = veilSeam(run, sy);
					if (sy === y) context.moveTo(sx, sy);
					else context.lineTo(sx, sy);
				}
				context.stroke();
				context.strokeStyle = `rgba(255,240,200,${pulse})`;
				context.lineWidth = 2.5;
				context.stroke();

				// The rent so far: light through the tear.
				if (trail.current.length > 1) {
					context.strokeStyle = "rgba(255,248,226,.95)";
					context.lineWidth = 4;
					context.shadowColor = "rgba(255,226,150,.9)";
					context.shadowBlur = 12;
					context.beginPath();
					trail.current.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
					context.stroke();
					context.shadowBlur = 0;
				}

				// The rending point.
				const off = run.off / VEIL_OFF_LIMIT;
				context.fillStyle = on ? "#fff8e0" : "#ff9a7a";
				context.beginPath();
				context.arc(run.x, y, 7, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = on ? "rgba(255,236,170,.9)" : "rgba(255,120,90,.9)";
				context.lineWidth = 3;
				context.beginPath();
				context.arc(run.x, y, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (on ? 1 : 1 - off));
				context.stroke();
				if (!on && run.phase === "playing") {
					// Which way the seam is.
					const dir = Math.sign(seamHere - run.x);
					context.fillStyle = "#ffd1c0";
					context.beginPath();
					context.moveTo(run.x + dir * 34, y);
					context.lineTo(run.x + dir * 22, y - 8);
					context.lineTo(run.x + dir * 22, y + 8);
					context.fill();
				}
				if (run.phase === "playing" && run.t < 2) {
					context.fillStyle = `rgba(255,240,200,${0.7 + 0.3 * Math.sin(time * 6)})`;
					context.font = "800 15px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("← keep on the line of light →", 200, VEIL_TOP + 26);
				}
			}

			// Dust shaken loose in the quake.
			if (quaking && !reducedMotion) {
				context.fillStyle = "rgba(200,180,150,.5)";
				for (let i = 0; i < 18; i++) context.fillRect(LEFT + ((i * 71.3 + time * 13) % (RIGHT - LEFT)), (time * 160 + i * 47) % STAGE, 2, 3);
			}

			if (won && outro.current > 40) {
				context.globalAlpha = Math.min(1, (outro.current - 40) / 30);
				context.fillStyle = "#3a2508";
				context.font = `italic 700 23px ${SERIF}`;
				context.textAlign = "center";
				context.fillText("rent in twain", 200, 186);
				context.fillText("from the top to the bottom", 200, 216);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(0,0,0,.45)";
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
				context.fillStyle = "#f1eadc";
				context.font = "800 20px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(run.t >= VEIL_SECONDS - 0.02 ? "Keep closer to the line" : "The seam was lost", 200, 200);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		canvas.setPointerCapture?.(event.pointerId);
		const x = stagePoint(canvas, event).x;
		drag.current = { id: event.pointerId, startX: x, fromX: state.current.x, toward: state.current.x };
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		const held = drag.current;
		if (!canvas || !held || held.id !== event.pointerId) return;
		held.toward = held.fromX + (stagePoint(canvas, event).x - held.startX);
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (drag.current?.id === event.pointerId) drag.current = null;
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
			aria-label="The veil of the temple in the darkness. A line of light wavers down it; keep the rending point on the line with the left and right arrows, or drag, from the top to the bottom."
		/>
	);
}
