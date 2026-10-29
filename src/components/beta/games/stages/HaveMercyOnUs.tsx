"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	MERCY_HEAR_FROM,
	MERCY_LINE,
	jesusAlong,
	mercyResult,
	newMercy,
	rebukeAt,
	stepMercy,
	type MercyEvent,
	type MercyState,
} from "@/lib/beta/games/have-mercy-on-us-rules";

/**
 * Have Mercy on Us (LC-17851), Matthew 20:29-34: the reference stage for the
 * chapter games' kit (docs/beta/games.md). Two blind men sit by the way side
 * near Jericho at dusk; the multitude follows Jesus along the road. Every tap
 * or Space is a cry; the crowd's raised hands are a rebuke.
 */

const CRY_KEYS = new Set([" "]);
const ROAD_Y = 250;

function drawFigure(context: CanvasRenderingContext2D, x: number, y: number, height: number, color: string, armsUp = 0) {
	context.fillStyle = color;
	context.beginPath();
	context.arc(x, y - height + height * 0.13, height * 0.13, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.moveTo(x - height * 0.16, y);
	context.lineTo(x - height * 0.1, y - height * 0.72);
	context.lineTo(x + height * 0.1, y - height * 0.72);
	context.lineTo(x + height * 0.16, y);
	context.closePath();
	context.fill();
	if (armsUp > 0) {
		context.strokeStyle = color;
		context.lineWidth = height * 0.07;
		context.lineCap = "round";
		context.beginPath();
		context.moveTo(x - height * 0.09, y - height * 0.66);
		context.lineTo(x - height * 0.2, y - height * (0.66 + 0.3 * armsUp));
		context.moveTo(x + height * 0.09, y - height * 0.66);
		context.lineTo(x + height * 0.2, y - height * (0.66 + 0.3 * armsUp));
		context.stroke();
	}
}

export default function HaveMercyOnUs({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<MercyState>(newMercy(seed));
	const taps = useRef(0);
	const rings = useRef<{ born: number; side: number }[]>([]);
	const ended = useRef(false);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: MercyEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "cry") play.tone(330 + Math.random() * 60, 0.16, { type: "sawtooth", volume: 0.12, to: 260 });
			if (event.type === "rebuke") play.noise(0.7, { volume: 0.22, filter: 3200, type: "highpass" });
			if (event.type === "heard") [392, 494, 587, 784].forEach((note, index) => play.tone(note, 1.4, { type: "triangle", volume: 0.16, delay: index * 0.09 }));
			if (event.type === "passed") play.tone(220, 0.8, { type: "sine", volume: 0.18, to: 150 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const pressed = takePresses(keys).some((key) => CRY_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const events: MercyEvent[] = [];
		stepMercy(run, { cry: pressed }, events);
		for (const event of events) {
			if (event.type === "cry") rings.current.push({ born: run.t, side: rings.current.length % 2 });
			sound(event);
		}
		onTime(Math.max(0, 12 - run.t));
		const result = mercyResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const along = jesusAlong(run);
			const rebuke = rebukeAt(run);
			const warning = run.rebukes.find((item) => run.t >= item.warn && run.t < item.to);
			// Dusk over Jericho.
			const sky = context.createLinearGradient(0, 0, 0, ROAD_Y);
			sky.addColorStop(0, "#2a2350");
			sky.addColorStop(0.6, "#b4566a");
			sky.addColorStop(1, "#f2a65a");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, ROAD_Y);
			context.fillStyle = "#f7d27a";
			context.beginPath();
			context.arc(310, 190, 34, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#5a3b4f";
			for (let i = 0; i < 6; i++) context.fillRect(20 + i * 26, 168 - (i % 3) * 14, 22, 82 + (i % 3) * 14);
			context.fillStyle = "#c98e5a";
			context.fillRect(0, ROAD_Y, STAGE, STAGE - ROAD_Y);
			context.fillStyle = "#b07a49";
			context.fillRect(0, ROAD_Y + 18, STAGE, 34);

			// The multitude following Jesus along the road.
			const jesusX = -30 + along * (STAGE + 60);
			const raise = rebuke ? 1 : warning ? Math.min(1, (run.t - warning.warn) / 0.5) : 0;
			for (let i = 1; i <= 7; i++) {
				const x = jesusX - 26 - i * 22;
				const bob = reducedMotion ? 0 : Math.sin(time * 6 + i) * 1.5;
				drawFigure(context, x, ROAD_Y + 46 + (i % 2) * 6 + bob, 46, i % 2 ? "#3d2a3a" : "#4b3446", raise);
			}
			// Jesus, a figure in light.
			const glow = context.createRadialGradient(jesusX, ROAD_Y + 10, 4, jesusX, ROAD_Y + 10, run.phase === "won" ? 90 : 46);
			glow.addColorStop(0, "rgba(255,244,214,.85)");
			glow.addColorStop(1, "rgba(255,244,214,0)");
			context.fillStyle = glow;
			context.fillRect(jesusX - 100, ROAD_Y - 90, 200, 200);
			drawFigure(context, jesusX, ROAD_Y + 50, 58, "#fbf3e2");
			context.fillStyle = "#c8452f";
			context.fillRect(jesusX - 7, ROAD_Y + 2, 14, 30);

			if (warning) {
				context.fillStyle = rebuke ? "#fff" : "rgba(255,255,255,.75)";
				context.strokeStyle = "#3d2a3a";
				context.lineWidth = 3;
				const bx = Math.max(70, Math.min(STAGE - 70, jesusX - 90));
				context.beginPath();
				context.roundRect(bx - 66, 110, 132, 40, 12);
				context.fill();
				context.stroke();
				context.fillStyle = "#3d2a3a";
				context.font = "900 20px system-ui, sans-serif";
				context.textAlign = "center";
				// Wordless: 20:31 tells the rebuke, it does not quote it.
				context.fillText(rebuke ? "SHH!" : "Shh…", bx, 137);
			}

			// The two blind men by the way side, crying out.
			drawFigure(context, 46, 372, 54, "#2f2430");
			drawFigure(context, 92, 376, 54, "#3a2b38");
			context.fillStyle = "#6f5440";
			context.fillRect(20, 372, 100, 10);
			rings.current = rings.current.filter((ring) => run.t - ring.born < 0.8);
			for (const ring of rings.current) {
				const age = (run.t - ring.born) / 0.8;
				context.strokeStyle = `rgba(255,236,170,${1 - age})`;
				context.lineWidth = 4;
				context.beginPath();
				context.arc(ring.side ? 92 : 46, 330, 14 + age * 70, -Math.PI / 2.4, Math.PI / 6);
				context.stroke();
			}

			// The voice meter and the line it must stay above.
			const meterX = 362;
			const meterTop = 278;
			const meterHeight = 110;
			context.fillStyle = "rgba(0,0,0,.45)";
			context.beginPath();
			context.roundRect(meterX - 4, meterTop - 4, 30, meterHeight + 8, 8);
			context.fill();
			const fill = (run.voice / 100) * meterHeight;
			context.fillStyle = run.voice >= MERCY_LINE ? "#ffd166" : "#f08a5d";
			context.fillRect(meterX, meterTop + meterHeight - fill, 22, fill);
			const lineY = meterTop + meterHeight - (MERCY_LINE / 100) * meterHeight;
			context.fillStyle = "#fff";
			context.fillRect(meterX - 8, lineY - 1.5, 38, 3);
			context.font = "800 12px system-ui, sans-serif";
			context.textAlign = "right";
			context.fillText(run.t < MERCY_HEAR_FROM ? "Wait…" : "Heard", meterX - 10, lineY + 4);
			// Being heard: the ring around the meter fills.
			context.strokeStyle = "#ffd166";
			context.lineWidth = 5;
			context.beginPath();
			context.arc(meterX + 11, meterTop - 26, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, run.heard / 2.5));
			context.stroke();
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,244,214,.18)";
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
			aria-label="Two blind men by the way side cry out as Jesus passes by. Tap, or press Space, to cry out."
		/>
	);
}
