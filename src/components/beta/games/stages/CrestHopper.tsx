"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, STAGE_STEP, stagePoint, takePresses, useStageLoop } from "../stage-kit";
import type { StageProps } from "../types";
import { createHopperAudio, type HopperAudio } from "../crest-hopper-audio";
import { HOPPER_PIXELS, createLook, drawCues, drawHopper, gustTarget, lookEvents, ringState, stepLook, type HopperLook } from "../crest-hopper-scene";
import { CREST_SECONDS, crestProgress, crestResult, newCrest, stepCrest, type CrestEvent, type CrestState, type HopDir } from "@/lib/beta/games/crest-hopper-rules";

/**
 * Crest Hopper (LC-17851), Matthew 14:22-33: Peter comes down out of the
 * ship and hops from crest to crest toward Jesus in fifteen seconds. ↑, Space
 * or a tap hops forward; ← and → or a sideways swipe hop a lane across. The
 * gold ring on the next row says when a hop lands on a crest; a gust's arrow
 * and countdown say where it will shove him.
 */

const KEYS: Record<string, HopDir> = { arrowup: "up", " ": "up", arrowleft: "left", arrowright: "right" };
/** A pointer that moves less than this (stage units) is a tap; more, sideways, is a swipe. */
const SWIPE = 22;
/** The ostinato's beat, in seconds; it quickens toward Jesus. */
const BEAT = 0.3;

export default function CrestHopper({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<CrestState>(newCrest(seed));
	const look = useRef<HopperLook>(createLook());
	const buffer = useRef<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null>(null);
	const audio = useRef<HopperAudio | null>(null);
	const gestures = useRef<HopDir[]>([]);
	const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
	const ended = useRef(false);
	const beat = useRef({ index: 0, at: 0 });
	const lastFrame = useRef<number | null>(null);
	const ticks = useRef(0);

	useEffect(() => {
		audio.current?.setMuted(muted);
	}, [muted]);
	// Pausing mid-round hushes the sea; the round's ending plays out.
	useEffect(() => {
		if (state.current.phase !== "playing") return;
		if (paused) audio.current?.pause();
		else audio.current?.resume();
	}, [paused]);
	useEffect(
		() => () => {
			audio.current?.close();
			audio.current = null;
		},
		[],
	);

	const sound = useCallback((event: CrestEvent, run: CrestState) => {
		const play = audio.current;
		if (!play) return;
		if (event.type === "hop") {
			if (event.dir === "up") play.hop(crestProgress({ maxRow: run.row + 1 }));
			else play.side();
		}
		if (event.type === "land") play.land();
		if (event.type === "steady") play.steady();
		if (event.type === "slip") play.slip();
		if (event.type === "gustWarn") play.gustWarn();
		if (event.type === "gust") play.gust();
		if (event.type === "won") play.victory();
		if (event.type === "lost") play.lost();
	}, []);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		if (!audio.current) audio.current = createHopperAudio(muted);
		let hop: HopDir | null = null;
		for (const key of takePresses(keys)) hop = KEYS[key] ?? hop;
		if (gestures.current.length) hop = gestures.current.splice(0).pop() ?? hop;
		const events: CrestEvent[] = [];
		stepCrest(run, { hop }, events);
		lookEvents(look.current, run, events, reducedMotion);
		for (const event of events) sound(event, run);
		// The storm's ostinato, quickening toward Jesus.
		const progress = crestProgress(run);
		if (run.phase === "playing" && run.t >= beat.current.at) {
			audio.current?.beat(beat.current.index, progress);
			beat.current.index += 1;
			beat.current.at = run.t + BEAT * (1 - 0.25 * progress);
		}
		onTime(Math.max(0, CREST_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && (ticks.current % 6 === 0 || run.phase !== "playing")) {
			const target = gustTarget(run);
			canvas.dataset.crest = `${run.phase} ${run.row} ${run.faith} ${ringState(run) ?? "-"} ${target ? `${target.marked ? (target.safe ? "safe" : "move") : "air"}${run.gust && run.gust.dir > 0 ? ">" : "<"}` : "-"} ${run.x.toFixed(2)}`;
		}
		const result = crestResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, muted, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			if (!buffer.current) {
				const canvas = document.createElement("canvas");
				canvas.width = HOPPER_PIXELS;
				canvas.height = HOPPER_PIXELS;
				const paint = canvas.getContext("2d");
				if (!paint) return;
				buffer.current = { canvas, context: paint };
			}
			// The picture moves on while the round plays, and after it ends (the arrival, the splash); a pause freezes it.
			const dt = lastFrame.current === null ? 0 : Math.min(0.1, Math.max(0, time - lastFrame.current));
			lastFrame.current = time;
			if (!paused || run.phase !== "playing") stepLook(look.current, run, dt, reducedMotion);
			drawHopper(buffer.current.context, look.current, run, time, reducedMotion);
			const shake = look.current.shake > 0 && !reducedMotion ? look.current.shake * 14 : 0;
			context.imageSmoothingEnabled = false;
			context.drawImage(buffer.current.canvas, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, STAGE, STAGE);
			drawCues(context, look.current, run, time, reducedMotion);
		},
		[paused, reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused || !canvasRef.current) return;
		const at = stagePoint(canvasRef.current, event);
		swipe.current = { id: event.pointerId, x: at.x, y: at.y };
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const begun = swipe.current;
		swipe.current = null;
		if (!begun || begun.id !== event.pointerId || paused || !canvasRef.current) return;
		const at = stagePoint(canvasRef.current, event);
		const dx = at.x - begun.x;
		const dy = at.y - begun.y;
		if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) gestures.current.push("up");
		else if (Math.abs(dx) > Math.abs(dy)) gestures.current.push(dx > 0 ? "right" : "left");
		else if (dy < 0) gestures.current.push("up");
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerUp={onPointerUp}
			onPointerCancel={() => {
				swipe.current = null;
			}}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="Peter hops from crest to crest across the stormy sea toward Jesus. Tap, Space or the up arrow hops forward when the ring ahead glows gold; swipe or press left and right to hop sideways out of a gust's way."
		/>
	);
}
