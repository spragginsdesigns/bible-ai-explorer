"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop } from "../stage-kit";
import { createCaravanAudio, type CaravanAudio } from "../the-caravan-audio";
import { drawCaravanScene, type TrailPoint } from "../the-caravan-scene";
import type { StageProps } from "../types";
import {
	CARAVAN_FOOT,
	CARAVAN_JERUSALEM,
	CARAVAN_SECONDS,
	caravanResult,
	newCaravan,
	nextHazard,
	stepCaravan,
	type CaravanEvent,
	type CaravanState,
} from "@/lib/beta/games/the-caravan-rules";

/**
 * The Caravan (LC-17851), Matthew 2:1-12: fifteen seconds on the road under
 * the star. The rules are the-caravan-rules.ts, the picture
 * the-caravan-scene.ts and the music the-caravan-audio.ts; this stage feeds
 * them input (↑ or Space or a tap to jump, ↓ or a swipe down to duck) and
 * tells the player when the round is over.
 */

const JUMP_KEYS = new Set(["arrowup", " "]);
const DUCK_KEY = "arrowdown";
/** A touch that has not moved this long is a tap (a jump); a swipe down first is a duck. */
const TAP_MS = 90;
/** Stage units a finger travels down to make a swipe. */
const SWIPE = 22;
/** A swipe ducks at least this long (every ledge takes 0.42-0.66 s to pass), longer while the finger stays down. */
const SWIPE_DUCK = 0.8;
/** Paces between footfalls on the sand. */
const STRIDE_LENGTH = 1.35;

interface Touch {
	id: number;
	x: number;
	y: number;
	at: number;
	done: boolean;
	ducking: boolean;
}

export default function TheCaravan({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<CaravanState>(newCaravan(seed));
	const audio = useRef<CaravanAudio | null>(null);
	const look = useRef({ trail: [] as TrailPoint[], starGlow: 0, shake: 0, flash: 0, arriveAt: null as number | null, foot: 0, city: false, lastDraw: 0 });
	const touch = useRef<Touch | null>(null);
	const tapped = useRef(false);
	const duckUntil = useRef(0);
	const ended = useRef(false);
	const ticks = useRef(0);

	const mutedRef = useRef(muted);

	// The music starts with the round (after Start, a user gesture) and stops with the stage.
	useEffect(() => {
		if (paused) {
			if (!ended.current) audio.current?.pause();
			return;
		}
		if (!audio.current) audio.current = createCaravanAudio(mutedRef.current);
		audio.current?.resume();
	}, [paused]);
	useEffect(() => {
		mutedRef.current = muted;
		audio.current?.setMuted(muted);
	}, [muted]);
	useEffect(() => () => audio.current?.close(), []);

	const handle = useCallback(
		(event: CaravanEvent) => {
			const sound = audio.current;
			const scene = look.current;
			if (event.type === "jump") sound?.jump();
			else if (event.type === "land") sound?.land();
			else if (event.type === "cleared") {
				sound?.chime();
				scene.starGlow = Math.min(1, scene.starGlow + 0.6);
			} else if (event.type === "stumble") {
				sound?.stumble();
				scene.flash = 1;
				scene.shake = reducedMotion ? 0 : 1;
				navigator.vibrate?.(40);
			} else if (event.type === "arrived") {
				sound?.joy();
				scene.arriveAt = performance.now() / 1000;
				scene.starGlow = 1;
			} else if (event.type === "lost") sound?.lost();
		},
		[reducedMotion],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "running") return;
		let jump = takePresses(keys).some((key) => JUMP_KEYS.has(key));
		const finger = touch.current;
		if (finger && !finger.done && performance.now() - finger.at >= TAP_MS) {
			finger.done = true;
			tapped.current = true;
		}
		if (tapped.current) {
			jump = true;
			tapped.current = false;
		}
		const duck = keys.held.has(DUCK_KEY) || !!finger?.ducking || run.t < duckUntil.current;
		const events: CaravanEvent[] = [];
		stepCaravan(run, { jump, duck }, events);
		for (const event of events) handle(event);

		const scene = look.current;
		const trail = scene.trail;
		const tail = trail[trail.length - 1];
		if (!tail || run.x - tail.x > 0.04) trail.push({ x: run.x, y: run.y });
		while (trail.length > 2 && trail[0].x < run.x - 22) trail.shift();
		const foot = Math.floor(run.x / STRIDE_LENGTH);
		if (foot !== scene.foot && run.grounded) audio.current?.footfall();
		scene.foot = foot;
		if (!scene.city && run.x > CARAVAN_JERUSALEM - 8) {
			scene.city = true;
			audio.current?.city();
		}
		let gust = 0;
		for (const hazard of run.hazards) if (hazard.kind === "gust") gust = Math.max(gust, 1 - Math.abs(hazard.x + hazard.w / 2 - run.x) / 9);
		audio.current?.set({ running: run.phase === "running", level: run.hits >= 2 ? 1 : run.hits === 1 ? 2 : run.cleared >= 2 ? 3 : 2, gust });

		// What the road holds next, for the proof driver, about ten times a second.
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && (ticks.current % 6 === 0 || run.phase !== "running")) {
			const ahead = nextHazard(run);
			canvas.dataset.phase = run.phase;
			canvas.dataset.hits = String(run.hits);
			canvas.dataset.t = run.t.toFixed(2);
			canvas.dataset.hazard = ahead ? `${ahead.id}:${ahead.kind}:${((ahead.x - CARAVAN_FOOT - run.x) / (run.speed + (ahead.kind === "gust" ? 4 : 0))).toFixed(2)}:${ahead.w.toFixed(2)}` : "none";
		}

		onTime(Math.max(0, CARAVAN_SECONDS - run.t));
		const result = caravanResult(run);
		if (result && !ended.current) {
			ended.current = true;
			audio.current?.set({ running: false, level: 0, gust: 0 });
			onEnd(result);
		}
	}, [handle, keys, onEnd, onTime]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const scene = look.current;
			const elapsed = Math.min(0.1, Math.max(0, time - scene.lastDraw));
			scene.lastDraw = time;
			scene.starGlow = Math.max(0, scene.starGlow - elapsed * 1.1);
			scene.shake = Math.max(0, scene.shake - elapsed * 4);
			scene.flash = Math.max(0, scene.flash - elapsed * 2.2);
			drawCaravanScene(context, {
				width: STAGE,
				height: STAGE,
				state: run,
				now: time,
				trail: scene.trail,
				starGlow: scene.starGlow,
				shake: reducedMotion ? 0 : scene.shake,
				arrival: scene.arriveAt === null ? null : time - scene.arriveAt,
				flash: scene.flash,
				// The opening cue once the round is under way (the player shows the controls before it).
				hint: run.phase === "running" && run.t > 0 ? Math.min(1, run.t / 0.15, (2.6 - run.t) / 0.6) : 0,
			});
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused || !canvasRef.current) return;
		const point = stagePoint(canvasRef.current, event);
		event.currentTarget.setPointerCapture?.(event.pointerId);
		touch.current = { id: event.pointerId, x: point.x, y: point.y, at: performance.now(), done: false, ducking: false };
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const finger = touch.current;
		if (!finger || finger.id !== event.pointerId || finger.done || !canvasRef.current) return;
		const point = stagePoint(canvasRef.current, event);
		const dy = point.y - finger.y;
		if (dy > SWIPE && dy > Math.abs(point.x - finger.x)) {
			finger.done = true;
			finger.ducking = true;
			duckUntil.current = state.current.t + SWIPE_DUCK;
		}
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const finger = touch.current;
		if (!finger || finger.id !== event.pointerId) return;
		if (!finger.done && !paused) tapped.current = true;
		touch.current = null;
	};
	// A touch the browser takes back (a system gesture) is not a tap.
	const onPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (touch.current?.id === event.pointerId) touch.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="The wise men's caravan crosses the desert under the star to Bethlehem. Jump the rocks and ravines with Up, Space or a tap; duck the low ledges and gusts of sand with Down or a swipe down."
		/>
	);
}
