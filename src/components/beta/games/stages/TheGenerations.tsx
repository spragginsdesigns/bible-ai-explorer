"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	GENERATIONS_ARRIVE_TICKS,
	GENERATIONS_LINE,
	GENERATIONS_LINKS,
	GENERATIONS_PENALTY,
	GENERATIONS_TILE_H,
	GENERATIONS_TILE_W,
	generationsLeft,
	generationsPrompt,
	generationsReady,
	generationsResult,
	generationsTilePosition,
	newGenerations,
	stepGenerations,
	type GenerationsEvent,
	type GenerationsInput,
	type GenerationsState,
} from "@/lib/beta/games/the-generations-rules";

/**
 * The Generations (LC-17851), Matthew 1:1-17: who begat whom. A scroll over a
 * lapis night names the father; stone tablets float and shuffle below with
 * the names; tap (or click) the son. Lapis, gold leaf and sandstone.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SLOT_KEYS: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };
/** How long the won line glows before the round ends. */
const OUTRO_WON = 60;
const OUTRO_LOST = 30;

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	color: string;
}

function tablet(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
	context.beginPath();
	context.moveTo(x - w / 2, y + h / 2);
	context.lineTo(x - w / 2, y - h / 2 + 16);
	context.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + 16, y - h / 2);
	context.lineTo(x + w / 2 - 16, y - h / 2);
	context.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + 16);
	context.lineTo(x + w / 2, y + h / 2);
	context.closePath();
}

export default function TheGenerations({ game, seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<GenerationsState>(newGenerations(seed));
	const taps = useRef<{ x: number; y: number }[]>([]);
	const outro = useRef(0);
	const ended = useRef(false);
	const sparks = useRef<Spark[]>([]);
	const flyer = useRef<{ name: string; from: { x: number; y: number }; tick: number } | null>(null);
	const shake = useRef(0);
	const lastFrame = useRef(0);
	const lastData = useRef(0);
	const synth = useSynth(muted);
	const numbered = game.controls.some((control) => control.keys.includes("1"));

	const burst = useCallback((x: number, y: number, color: string, count: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 60 + Math.random() * 160;
			sparks.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40, life: 0.6 + Math.random() * 0.4, color });
		}
	}, []);

	const sound = useCallback(
		(event: GenerationsEvent, link: number) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "right") {
				// A rising lyre: each link a step up the scale.
				const scale = [294, 330, 370, 392, 440, 494, 554, 587];
				const note = scale[Math.min(scale.length - 1, Math.max(0, link - 1))];
				play.tone(note, 0.35, { type: "triangle", volume: 0.2 });
				play.tone(note * 1.5, 0.3, { type: "sine", volume: 0.08, delay: 0.04 });
			}
			if (event.type === "wrong") {
				play.tone(150, 0.3, { type: "square", volume: 0.1, to: 110 });
				play.noise(0.18, { volume: 0.2, filter: 500 });
			}
			if (event.type === "shuffle") play.noise(0.12, { volume: 0.05, filter: 2400, type: "bandpass" });
			if (event.type === "won") [587, 740, 880, 1175].forEach((note, index) => play.tone(note, 1.2, { type: "triangle", volume: 0.15, delay: 0.1 + index * 0.1 }));
			if (event.type === "lost") play.tone(220, 0.9, { type: "sine", volume: 0.18, to: 140 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = generationsResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		const presses = takePresses(keys);
		const input: GenerationsInput = {};
		const slot = presses.map((key) => SLOT_KEYS[key]).find((value) => value !== undefined);
		if (slot !== undefined) input.slot = slot;
		else if (taps.current.length) input.tap = taps.current[0];
		taps.current.length = 0;
		const before = run.tiles;
		const events: GenerationsEvent[] = [];
		stepGenerations(run, input, events);
		for (const event of events) {
			sound(event, run.link);
			if (event.type === "right") {
				const tile = before.find((item) => item.correct);
				const at = tile ? generationsTilePosition(run, tile, run.tick - 1) : { x: 200, y: 280 };
				flyer.current = { name: event.name, from: at, tick: run.tick };
				burst(at.x, at.y, "#f4d27a", 26);
			}
			if (event.type === "wrong") shake.current = 1;
			if (event.type === "won") burst(200, 70, "#fff1c1", 60);
		}
		onTime(generationsLeft(run));
	}, [burst, keys, onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const canvas = canvasRef.current;
			const prompt = generationsPrompt(run);
			const correct = run.tiles.find((tile) => tile.correct);
			if (canvas && correct && time - lastData.current > 0.1) {
				lastData.current = time;
				const at = generationsTilePosition(run, correct);
				canvas.dataset.target = `${Math.round(at.x)},${Math.round(at.y)},${generationsReady(run) ? 1 : 0},${correct.slot},${run.phase}`;
			}
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 70) * 6 * shake.current, 0);
			shake.current = Math.max(0, shake.current - dt * 3);

			// A lapis night with gold-leaf stars.
			const sky = context.createLinearGradient(0, 0, 0, STAGE);
			sky.addColorStop(0, "#0e1a3d");
			sky.addColorStop(0.55, "#16295c");
			sky.addColorStop(1, "#0a1330");
			context.fillStyle = sky;
			context.fillRect(-10, 0, STAGE + 20, STAGE);
			for (let i = 0; i < 46; i++) {
				const x = (i * 97.3) % STAGE;
				const y = (i * 53.7) % STAGE;
				const twinkle = reducedMotion ? 0.5 : 0.35 + 0.35 * Math.sin(time * 1.6 + i);
				context.fillStyle = `rgba(244,210,122,${twinkle})`;
				context.fillRect(x, y, 1.6, 1.6);
			}

			// The scroll: "<Name> begat …".
			context.fillStyle = "#e9d8b0";
			context.beginPath();
			context.roundRect(26, 16, STAGE - 52, 96, 10);
			context.fill();
			context.fillStyle = "#c8ae7c";
			for (const x of [26, STAGE - 26]) {
				context.beginPath();
				context.ellipse(x, 64, 12, 54, 0, 0, Math.PI * 2);
				context.fill();
			}
			context.strokeStyle = "#a8854a";
			context.lineWidth = 1.5;
			context.strokeRect(42, 24, STAGE - 84, 80);
			context.textAlign = "center";
			context.fillStyle = "#3b2a17";
			context.font = `700 34px ${SERIF}`;
			const name = run.phase === "won" ? GENERATIONS_LINE[run.start + GENERATIONS_LINKS] : prompt.name;
			context.fillText(run.phase === "won" ? `… ${name}` : name, 200, 62);
			context.font = `italic 600 22px ${SERIF}`;
			context.fillStyle = "#7a4f1e";
			const blink = reducedMotion || Math.sin(time * 6) > -0.3 ? "…" : "";
			context.fillText(run.phase === "won" ? "the line is kept" : `begat ${blink}`, 200, 92);

			// The line so far: a gold chain of eight links.
			for (let i = 0; i < GENERATIONS_LINKS; i++) {
				const x = 60 + i * 40;
				const done = i < run.link;
				context.strokeStyle = done ? "#f4d27a" : "rgba(244,210,122,.35)";
				context.lineWidth = 3;
				if (i > 0) {
					context.beginPath();
					context.moveTo(x - 30, 140);
					context.lineTo(x - 10, 140);
					context.stroke();
				}
				context.beginPath();
				context.ellipse(x, 140, 10, 8, 0, 0, Math.PI * 2);
				if (done) {
					context.fillStyle = "#f4d27a";
					context.fill();
				}
				context.stroke();
				if (i === run.link && run.phase === "playing" && !reducedMotion) {
					context.strokeStyle = `rgba(255,241,193,${0.4 + 0.4 * Math.sin(time * 8)})`;
					context.beginPath();
					context.ellipse(x, 140, 15, 12, 0, 0, Math.PI * 2);
					context.stroke();
				}
			}
			context.font = `600 13px ${SERIF}`;
			context.fillStyle = "rgba(233,216,176,.8)";
			context.fillText(`${GENERATIONS_LINE[run.start]} → ${GENERATIONS_LINE[run.start + GENERATIONS_LINKS]}`, 200, 172);

			// The tablets, floating in, then bobbing and trading places.
			const arriving = Math.min(1, (run.tick - run.arrivedAt) / GENERATIONS_ARRIVE_TICKS);
			if (run.phase === "playing") {
				for (const tile of run.tiles) {
					const at = generationsTilePosition(run, tile);
					const bob = reducedMotion ? 0 : Math.sin(time * 2.2 + tile.slot * 1.7) * 3;
					const rise = (1 - arriving) * 60;
					// A wrong name shakes, then crumbles away.
					const wrong = tile.gone !== null;
					const since = wrong ? run.tick - (tile.gone ?? 0) : 0;
					if (since > 40) continue;
					const crumble = wrong ? Math.max(0, (since - 16) / 24) : 0;
					const jiggle = wrong && !reducedMotion ? Math.sin(since * 1.6) * 6 * (1 - crumble) : 0;
					const x = at.x + jiggle;
					const y = at.y + bob + rise + crumble * crumble * 60;
					context.globalAlpha = (0.25 + 0.75 * arriving) * (1 - crumble);
					context.fillStyle = "rgba(0,0,0,.35)";
					tablet(context, x + 4, y + 6, GENERATIONS_TILE_W, GENERATIONS_TILE_H);
					context.fill();
					const stone = context.createLinearGradient(0, y - GENERATIONS_TILE_H / 2, 0, y + GENERATIONS_TILE_H / 2);
					stone.addColorStop(0, wrong ? "#f0a08a" : "#ead7ad");
					stone.addColorStop(1, wrong ? "#b9503a" : "#bf9d68");
					context.fillStyle = stone;
					tablet(context, x, y, GENERATIONS_TILE_W, GENERATIONS_TILE_H);
					context.fill();
					context.strokeStyle = wrong ? "#7a1f12" : "#8a6a3a";
					context.lineWidth = 2;
					context.stroke();
					context.fillStyle = wrong ? "#3d0d06" : "#3b2a17";
					context.font = `700 ${tile.name.length > 8 ? 25 : 28}px ${SERIF}`;
					context.fillText(tile.name, x, y + 10);
					if (numbered) {
						context.fillStyle = "rgba(59,42,23,.6)";
						context.font = "800 12px system-ui, sans-serif";
						context.fillText(String(tile.slot + 1), x - GENERATIONS_TILE_W / 2 + 14, y + GENERATIONS_TILE_H / 2 - 8);
					}
					context.globalAlpha = 1;
					if (wrong) {
						context.fillStyle = "#ff8a73";
						context.font = "900 18px system-ui, sans-serif";
						context.fillText(`−${GENERATIONS_PENALTY}s`, x, y - GENERATIONS_TILE_H / 2 - 8 - since);
					}
				}
				// The first link: a pulsing hint over the field.
				if (run.link === 0 && run.tick < 150) {
					context.fillStyle = `rgba(255,241,193,${0.65 + 0.35 * Math.sin(time * 7)})`;
					context.font = "900 15px system-ui, sans-serif";
					context.fillText(`Who did ${prompt.name} beget? Tap the son`, 200, 192);
				}
			}

			// The right name flies up into the chain.
			const fly = flyer.current;
			if (fly) {
				const k = Math.min(1, (run.tick - fly.tick + (run.phase === "playing" ? 0 : outro.current)) / 20);
				if (k >= 1) flyer.current = null;
				else {
					const x = fly.from.x + (60 + (run.link - 1) * 40 - fly.from.x) * k;
					const y = fly.from.y + (140 - fly.from.y) * k;
					context.globalAlpha = 1 - k * 0.6;
					context.fillStyle = "#fff1c1";
					context.font = `700 ${28 - k * 12}px ${SERIF}`;
					context.fillText(fly.name, x, y);
					context.globalAlpha = 1;
				}
			}

			// Won: the whole line in gold.
			if (run.phase === "won") {
				const k = Math.min(1, outro.current / 30);
				context.fillStyle = `rgba(244,210,122,${0.12 * k})`;
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = "#f4d27a";
				context.font = `700 20px ${SERIF}`;
				const names = GENERATIONS_LINE.slice(run.start, run.start + GENERATIONS_LINKS + 1);
				names.forEach((item, index) => {
					context.globalAlpha = Math.max(0, Math.min(1, k * 9 - index));
					context.fillText(item, index % 2 ? 290 : 110, 205 + Math.floor(index / 2) * 40 + (index % 2) * 20);
				});
				context.globalAlpha = 1;
			}

			// Sparks.
			sparks.current = sparks.current.filter((spark) => (spark.life -= dt) > 0);
			for (const spark of sparks.current) {
				spark.x += spark.vx * dt;
				spark.y += spark.vy * dt;
				spark.vy += 220 * dt;
				context.globalAlpha = Math.min(1, spark.life * 2);
				context.fillStyle = spark.color;
				context.fillRect(spark.x - 2, spark.y - 2, 4, 4);
			}
			context.globalAlpha = 1;
			context.restore();
		},
		[numbered, reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		taps.current.push(stagePoint(canvas, event));
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="The generations of Matthew 1. A scroll names a father; tap the stone tablet with the name of the son he begat, eight times in order."
		/>
	);
}
