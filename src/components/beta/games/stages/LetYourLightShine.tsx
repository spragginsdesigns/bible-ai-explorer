"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	LIGHT_DIRS,
	LIGHT_HOUSES,
	LIGHT_KINDLE,
	LIGHT_SECONDS,
	LIGHT_SHINE,
	LIGHT_TURN_GAP,
	lightAllLit,
	lightBoard,
	lightMirrorAt,
	lightResult,
	lightShining,
	newLight,
	stepLight,
	type LightBoard,
	type LightEvent,
	type LightInput,
	type LightState,
} from "@/lib/beta/games/let-your-light-shine-rules";

/**
 * Let Your Light Shine (LC-17908), Matthew 5:14-16: a house at night seen
 * from above, its rooms in a grid. A candle on its candlestick at one wall
 * casts a beam into the house; brass mirrors in some rooms turn it through a
 * right angle, and every lamp it passes catches light. Turn the mirrors (tap
 * one, or move the gold cursor with the arrows and press Space) until the
 * beam gives light unto all that are in the house, then the next house comes.
 * When the third is lit, the whole city on the hill glows.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, sans-serif";
/** The house: a square of rooms below the window and the count. */
const BOARD = { x: 52, y: 50, size: 296 };
/** How fast the beam runs out from a turned mirror, in stage units a second. */
const BEAM_SPEED = 1700;
const OUTRO_WON = 150;
const OUTRO_LOST = 48;
const STARS = Array.from({ length: 40 }, (_, index) => ({
	x: (index * 97.3) % STAGE,
	y: (index * 41.7) % 60,
	r: index % 5 === 0 ? 1.3 : 0.7,
	phase: index * 1.7,
}));
/** The city on the hill: each house's left edge, width and height, in a 100-wide picture. */
const CITY = [
	[2, 12, 10],
	[13, 10, 16],
	[22, 14, 22],
	[35, 9, 30],
	[43, 15, 24],
	[57, 11, 18],
	[67, 13, 21],
	[79, 10, 14],
	[88, 10, 10],
];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	size: number;
}

type Point = { x: number; y: number };

function cellSize(board: LightBoard) {
	return BOARD.size / board.size;
}

function cellCenter(board: LightBoard, r: number, c: number): Point {
	const cell = cellSize(board);
	return { x: BOARD.x + (c + 0.5) * cell, y: BOARD.y + (r + 0.5) * cell };
}

/** Where the candle's flame stands, just outside the wall the beam enters by. */
function candleAt(board: LightBoard): Point {
	const { r, c, dir } = board.entry;
	const center = cellCenter(board, r, c);
	const cell = cellSize(board);
	const back = cell / 2 + 18;
	return { x: center.x - LIGHT_DIRS[dir].dc * back, y: center.y - LIGHT_DIRS[dir].dr * back };
}

/** The beam as a line: from the flame, through each mirror that turned it, to the wall it ends on. */
function beamPoints(board: LightBoard, cells: LightState["beam"]["cells"]): Point[] {
	const points = [candleAt(board)];
	let dir = board.entry.dir;
	for (const cell of cells) {
		if (cell.dir !== dir) points.push(cellCenter(board, cell.r, cell.c));
		dir = cell.dir;
	}
	const last = cells.at(-1);
	if (last) {
		const center = cellCenter(board, last.r, last.c);
		const half = cellSize(board) / 2;
		points.push({ x: center.x + LIGHT_DIRS[last.dir].dc * half, y: center.y + LIGHT_DIRS[last.dir].dr * half });
	}
	return points;
}

/** How far along the line a point on it lies (or the line's length when it is not on it). */
function distanceAlong(points: Point[], point: Point): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const onX = Math.abs(a.x - b.x) < 0.5 && Math.abs(point.x - a.x) < 0.5 && point.y >= Math.min(a.y, b.y) - 0.5 && point.y <= Math.max(a.y, b.y) + 0.5;
		const onY = Math.abs(a.y - b.y) < 0.5 && Math.abs(point.y - a.y) < 0.5 && point.x >= Math.min(a.x, b.x) - 0.5 && point.x <= Math.max(a.x, b.x) + 0.5;
		if (onX || onY) return total + Math.hypot(point.x - a.x, point.y - a.y);
		total += length;
	}
	return total;
}

function lineLength(points: Point[]) {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
	return total;
}

/** The first `length` of the line. */
function tracePrefix(context: CanvasRenderingContext2D, points: Point[], length: number) {
	context.beginPath();
	context.moveTo(points[0].x, points[0].y);
	let left = length;
	for (let i = 1; i < points.length && left > 0; i++) {
		const a = points[i - 1];
		const b = points[i];
		const segment = Math.hypot(b.x - a.x, b.y - a.y);
		if (segment <= left) context.lineTo(b.x, b.y);
		else context.lineTo(a.x + ((b.x - a.x) * left) / segment, a.y + ((b.y - a.y) * left) / segment);
		left -= segment;
	}
}

function pointAt(points: Point[], length: number): Point {
	let left = length;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const segment = Math.hypot(b.x - a.x, b.y - a.y);
		if (segment >= left) return { x: a.x + ((b.x - a.x) * left) / Math.max(1e-6, segment), y: a.y + ((b.y - a.y) * left) / Math.max(1e-6, segment) };
		left -= segment;
	}
	return points.at(-1) ?? { x: 0, y: 0 };
}

function flame(context: CanvasRenderingContext2D, x: number, y: number, height: number, sway: number) {
	context.beginPath();
	context.moveTo(x, y);
	context.bezierCurveTo(x - height * 0.42, y - height * 0.3, x - height * 0.18 + sway, y - height * 0.8, x + sway, y - height);
	context.bezierCurveTo(x + height * 0.18 + sway, y - height * 0.8, x + height * 0.42, y - height * 0.3, x, y);
	context.closePath();
}

function drawCity(context: CanvasRenderingContext2D, x: number, y: number, width: number, lit: number, glow: number, time: number) {
	// A hill, and the city set on it; `lit` (0 to 1) of its windows shine.
	const s = width / 100;
	context.save();
	context.translate(x, y);
	if (glow > 0) {
		const halo = context.createRadialGradient(50 * s, 10 * s, 2, 50 * s, 10 * s, 70 * s);
		halo.addColorStop(0, `rgba(255,214,140,${0.55 * glow})`);
		halo.addColorStop(1, "rgba(255,214,140,0)");
		context.fillStyle = halo;
		context.fillRect(-30 * s, -60 * s, 160 * s, 110 * s);
	}
	context.fillStyle = "#151026";
	context.beginPath();
	context.moveTo(-6 * s, 34 * s);
	context.quadraticCurveTo(50 * s, -8 * s, 106 * s, 34 * s);
	context.closePath();
	context.fill();
	CITY.forEach(([left, w, h], index) => {
		const hillTop = 34 - (1 - Math.pow((left + w / 2 - 50) / 56, 2)) * 21;
		const top = hillTop - h;
		context.fillStyle = "#231a33";
		context.fillRect(left * s, top * s, w * s, (h + 4) * s);
		context.fillStyle = "#2c2140";
		context.beginPath();
		context.moveTo((left - 1) * s, top * s);
		context.lineTo((left + w / 2) * s, (top - 4) * s);
		context.lineTo((left + w + 1) * s, top * s);
		context.fill();
		const on = index / CITY.length < lit;
		const flicker = 0.85 + 0.15 * Math.sin(time * 3 + index);
		context.fillStyle = on ? `rgba(255,${200 + index * 4},120,${flicker})` : "rgba(80,70,110,.55)";
		for (let wy = top + 4; wy < top + h - 2; wy += 7) {
			for (let wx = left + 2.5; wx < left + w - 3; wx += 5) context.fillRect(wx * s, wy * s, 2.4 * s, 3 * s);
		}
	});
	context.restore();
}

export default function LetYourLightShine({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	// Laying the houses checks each one, so do it once, not on every render.
	const [initial] = useState(() => newLight(seed));
	const state = useRef<LightState>(initial);
	const taps = useRef<number[]>([]);
	const cursor = useRef({ r: 1, c: 1 });
	const showCursor = useRef<boolean | null>(null);
	/** Each mirror's drawn angle and the angle it swings to (a quarter turn a press). */
	const angles = useRef<{ now: number; to: number }[]>([]);
	const beam = useRef<{ points: Point[]; shown: number }>({ points: [], shown: 0 });
	const lampGlow = useRef<number[]>([]);
	const particles = useRef<Particle[]>([]);
	const houseFrom = useRef(0);
	const solvedFlash = useRef(-9);
	const outro = useRef(0);
	const ended = useRef(false);
	const lastFrame = useRef(0);
	const lastData = useRef(0);
	const synth = useSynth(muted);

	const startHouse = useCallback((run: LightState) => {
		const board = lightBoard(run);
		angles.current = board.mirrors.map((mirror) => {
			const angle = mirror.tilt === 0 ? -Math.PI / 4 : Math.PI / 4;
			return { now: angle, to: angle };
		});
		beam.current = { points: beamPoints(board, run.beam.cells), shown: 0 };
		lampGlow.current = board.lamps.map(() => 0);
		cursor.current = { r: Math.floor(board.size / 2), c: Math.floor(board.size / 2) };
		houseFrom.current = run.t;
	}, []);

	const burst = useCallback((x: number, y: number, count: number, speed: number, up: number) => {
		const t = lastFrame.current;
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
			const v = speed * (0.35 + Math.random() * 0.65);
			particles.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - up, born: t, life: 0.5 + Math.random() * 0.6, size: 1.2 + Math.random() * 2.2 });
		}
		if (particles.current.length > 220) particles.current.splice(0, particles.current.length - 220);
	}, []);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = lightResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		const board = lightBoard(run);
		const input: LightInput = {};
		for (const key of takePresses(keys)) {
			showCursor.current = true;
			const { r, c } = cursor.current;
			if (key === "arrowleft") cursor.current = { r, c: Math.max(0, c - 1) };
			if (key === "arrowright") cursor.current = { r, c: Math.min(board.size - 1, c + 1) };
			if (key === "arrowup") cursor.current = { r: Math.max(0, r - 1), c };
			if (key === "arrowdown") cursor.current = { r: Math.min(board.size - 1, r + 1), c };
			if (key === " " && input.turn === undefined) {
				const mirror = lightMirrorAt(board, cursor.current.r, cursor.current.c);
				if (mirror >= 0) input.turn = mirror;
				else synth.current?.tone(150, 0.08, { type: "sine", volume: 0.05 });
			}
		}
		const tap = taps.current.shift();
		if (input.turn === undefined && tap !== undefined) input.turn = tap;
		taps.current.length = 0;

		const events: LightEvent[] = [];
		stepLight(run, input, events);
		const play = synth.current;
		for (const event of events) {
			if (event.type === "turn") {
				const angle = angles.current[event.mirror];
				if (angle) angle.to += Math.PI / 2;
				const mirror = board.mirrors[event.mirror];
				const points = beamPoints(board, run.beam.cells);
				const keep = distanceAlong(points, cellCenter(board, mirror.r, mirror.c));
				beam.current = { points, shown: reducedMotion ? lineLength(points) : Math.min(beam.current.shown, keep) };
				play?.noise(0.07, { volume: 0.07, filter: 3200, type: "bandpass" });
				play?.tone(330, 0.09, { type: "triangle", volume: 0.1, to: 420 });
				play?.tone(1250, 0.22, { type: "sine", volume: 0.035, delay: 0.05 });
			}
			if (event.type === "light") {
				const lamp = board.lamps[event.lamp];
				const at = cellCenter(board, lamp.r, lamp.c);
				const delay = reducedMotion ? 0 : Math.max(0, distanceAlong(beam.current.points, at) - beam.current.shown) / BEAM_SPEED;
				const note = [523.25, 659.25, 783.99, 1046.5][event.lamp % 4];
				play?.tone(note, 0.7, { type: "sine", volume: 0.13, delay });
				play?.tone(note * 2, 0.4, { type: "sine", volume: 0.04, delay: delay + 0.02 });
			}
			if (event.type === "dim") play?.tone(233, 0.3, { type: "sine", volume: 0.06, to: 196 });
			if (event.type === "house") {
				solvedFlash.current = run.t;
				for (const lamp of board.lamps) {
					const at = cellCenter(board, lamp.r, lamp.c);
					burst(at.x, at.y, 14, 70, 40);
				}
				[392, 493.88, 587.33, 783.99].forEach((note, index) => play?.tone(note, 1.1, { type: "sine", volume: 0.08, delay: index * 0.06 }));
			}
			if (event.type === "next") {
				startHouse(run);
				play?.noise(0.25, { volume: 0.05, filter: 700 });
			}
			if (event.type === "won") [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((note, index) => play?.tone(note, 1.8, { type: "sine", volume: 0.08, delay: 0.25 + index * 0.11 }));
			if (event.type === "lost") play?.tone(131, 1.2, { type: "sine", volume: 0.12, to: 98 });
		}
		onTime(Math.max(0, LIGHT_SECONDS - run.t));
	}, [burst, keys, onEnd, onTime, reducedMotion, startHouse, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			if (!angles.current.length) startHouse(run);
			const board = lightBoard(run);
			const cell = cellSize(board);
			const shining = lightShining(run) || run.phase === "won";
			const kindle = run.phase === "playing" && !lightShining(run) && lightAllLit(run.beam) ? Math.min(1, run.kindle / LIGHT_KINDLE) : shining ? 1 : 0;
			if (showCursor.current === null && typeof window !== "undefined") showCursor.current = !window.matchMedia("(pointer: coarse)").matches;

			const canvas = canvasRef.current;
			if (canvas && time - lastData.current > 0.03) {
				lastData.current = time;
				const { r, c, dir } = board.entry;
				canvas.dataset.light = `${run.house},${board.size},${r},${c},${dir},${run.phase},${lightShining(run) ? 1 : 0},${cursor.current.r},${cursor.current.c}`;
				canvas.dataset.mirrors = board.mirrors.map((mirror) => `${mirror.r},${mirror.c},${mirror.tilt}`).join(";");
				canvas.dataset.lamps = board.lamps.map((lamp, index) => `${lamp.r},${lamp.c},${run.beam.lit[index] ? 1 : 0}`).join(";");
			}

			// The beam runs out from the candle (or from the mirror just turned).
			const total = lineLength(beam.current.points);
			beam.current.shown = reducedMotion ? total : Math.min(total, beam.current.shown + BEAM_SPEED * dt);
			const front = beam.current.shown;

			// Night, the stars, and the window's city on the hill.
			const sky = context.createLinearGradient(0, 0, 0, STAGE);
			sky.addColorStop(0, "#0b0a1f");
			sky.addColorStop(1, "#141026");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, STAGE);
			for (const star of STARS) {
				context.fillStyle = `rgba(230,225,255,${reducedMotion ? 0.6 : 0.45 + 0.3 * Math.sin(time * 1.5 + star.phase)})`;
				context.fillRect(star.x, star.y, star.r * 1.6, star.r * 1.6);
			}

			const won = run.phase === "won";
			const fade = won ? Math.min(1, outro.current / 45) : 0;

			if (fade < 1) {
				context.save();
				context.globalAlpha = 1 - fade;
				const enter = Math.min(1, (run.t - houseFrom.current) / 0.35);
				// The house: plaster walls round the rooms.
				const pad = 9;
				context.fillStyle = "#4a3a30";
				context.beginPath();
				context.roundRect(BOARD.x - pad, BOARD.y - pad, BOARD.size + pad * 2, BOARD.size + pad * 2, 10);
				context.fill();
				context.fillStyle = "#2e241f";
				context.fillRect(BOARD.x - 3, BOARD.y - 3, BOARD.size + 6, BOARD.size + 6);
				context.globalAlpha = (1 - fade) * (reducedMotion ? 1 : 0.4 + 0.6 * enter);
				for (let r = 0; r < board.size; r++) {
					for (let c = 0; c < board.size; c++) {
						const x = BOARD.x + c * cell;
						const y = BOARD.y + r * cell;
						context.fillStyle = (r + c) % 2 ? "#1d1830" : "#201a34";
						context.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
						// Floor boards.
						context.fillStyle = "rgba(255,255,255,.025)";
						for (let line = 1; line < 4; line++) context.fillRect(x + 4, y + (line * cell) / 4, cell - 8, 1);
					}
				}
				// The light fills the rooms it passes through, and the whole house as the lamps catch.
				if (kindle > 0) {
					context.fillStyle = `rgba(255,196,110,${0.16 * kindle})`;
					context.fillRect(BOARD.x, BOARD.y, BOARD.size, BOARD.size);
				}
				const points = beam.current.points;
				if (points.length > 1 && front > 0) {
					context.save();
					context.beginPath();
					context.rect(BOARD.x - 40, BOARD.y - 40, BOARD.size + 80, BOARD.size + 80);
					context.clip();
					context.lineCap = "round";
					context.lineJoin = "round";
					tracePrefix(context, points, front);
					context.strokeStyle = "rgba(255,190,100,.11)";
					context.lineWidth = cell * 0.8;
					context.stroke();
					const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 7);
					context.strokeStyle = `rgba(255,200,110,${0.32 * pulse})`;
					context.lineWidth = 12;
					context.stroke();
					context.strokeStyle = "rgba(255,226,160,.85)";
					context.lineWidth = 5;
					context.stroke();
					context.strokeStyle = "#fff8e2";
					context.lineWidth = 2;
					context.stroke();
					context.restore();
					// Where the light meets the wall.
					if (front >= total - 1 && run.phase === "playing") {
						const end = points.at(-1)!;
						const splash = context.createRadialGradient(end.x, end.y, 1, end.x, end.y, 16);
						splash.addColorStop(0, "rgba(255,236,190,.8)");
						splash.addColorStop(1, "rgba(255,200,120,0)");
						context.fillStyle = splash;
						context.beginPath();
						context.arc(end.x, end.y, 16, 0, Math.PI * 2);
						context.fill();
					} else if (front < total) {
						const tip = pointAt(points, front);
						context.fillStyle = "#fffbe8";
						context.beginPath();
						context.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
						context.fill();
					}
				}

				// The lamps: dark with a gold ring until the light reaches them, then aflame.
				board.lamps.forEach((lamp, index) => {
					const at = cellCenter(board, lamp.r, lamp.c);
					const reached = run.beam.lit[index] && distanceAlong(beam.current.points, at) <= front + 1;
					const glow = lampGlow.current[index] ?? 0;
					const target = reached ? 1 : 0;
					lampGlow.current[index] = reducedMotion ? target : glow + (target - glow) * Math.min(1, dt * 12);
					const g = lampGlow.current[index];
					if (g < 0.98) {
						context.strokeStyle = `rgba(229,182,100,${(1 - g) * (reducedMotion ? 0.75 : 0.55 + 0.25 * Math.sin(time * 4 + index))})`;
						context.lineWidth = 2;
						context.setLineDash([5, 4]);
						context.beginPath();
						context.arc(at.x, at.y, cell * 0.3, 0, Math.PI * 2);
						context.stroke();
						context.setLineDash([]);
					}
					if (g > 0.02) {
						const reach = cell * (0.55 + 0.25 * kindle);
						const halo = context.createRadialGradient(at.x, at.y - 4, 1, at.x, at.y - 4, reach);
						halo.addColorStop(0, `rgba(255,228,150,${0.75 * g})`);
						halo.addColorStop(1, "rgba(255,180,90,0)");
						context.fillStyle = halo;
						context.fillRect(at.x - reach, at.y - 4 - reach, reach * 2, reach * 2);
					}
					// The clay lamp: a body, a spout and a handle.
					const s = Math.min(1.2, cell / 70);
					context.fillStyle = "#8d5a36";
					context.beginPath();
					context.ellipse(at.x, at.y + 5 * s, 13 * s, 7 * s, 0, 0, Math.PI * 2);
					context.fill();
					context.beginPath();
					context.moveTo(at.x + 8 * s, at.y + 1 * s);
					context.lineTo(at.x + 18 * s, at.y + 2 * s);
					context.lineTo(at.x + 9 * s, at.y + 9 * s);
					context.fill();
					context.fillStyle = "#5e3a22";
					context.beginPath();
					context.ellipse(at.x - 2 * s, at.y + 3 * s, 5 * s, 2.5 * s, 0, 0, Math.PI * 2);
					context.fill();
					if (g > 0.02) {
						const height = (12 + 6 * kindle) * s * g;
						const sway = reducedMotion ? 0 : Math.sin(time * 9 + index) * 1.6;
						context.fillStyle = "rgba(255,170,60,.95)";
						flame(context, at.x + 16 * s, at.y + 2 * s, height, sway);
						context.fill();
						context.fillStyle = "rgba(255,248,214,.95)";
						flame(context, at.x + 16 * s, at.y + 1 * s, height * 0.55, sway * 0.6);
						context.fill();
					} else {
						context.fillStyle = "#2a2018";
						context.fillRect(at.x + 14.5 * s, at.y - 1 * s, 2.5 * s, 4 * s);
					}
				});

				// The mirrors: brass plates on a stand, swinging a quarter turn a press.
				board.mirrors.forEach((mirror, index) => {
					const at = cellCenter(board, mirror.r, mirror.c);
					const angle = angles.current[index];
					if (!angle) return;
					angle.now = reducedMotion ? angle.to : angle.now + (angle.to - angle.now) * Math.min(1, dt / (LIGHT_TURN_GAP / 4));
					context.fillStyle = "rgba(0,0,0,.35)";
					context.beginPath();
					context.arc(at.x + 2, at.y + 3, cell * 0.2, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = "#2e2740";
					context.beginPath();
					context.arc(at.x, at.y, cell * 0.2, 0, Math.PI * 2);
					context.fill();
					context.save();
					context.translate(at.x, at.y);
					context.rotate(angle.now);
					const length = cell * 0.78;
					const thick = Math.max(6, cell * 0.1);
					context.fillStyle = "#6b4a1c";
					context.beginPath();
					context.roundRect(-length / 2, -thick / 2 + 2, length, thick, 3);
					context.fill();
					const brass = context.createLinearGradient(0, -thick / 2, 0, thick / 2);
					brass.addColorStop(0, "#fff0b8");
					brass.addColorStop(0.45, "#e5b664");
					brass.addColorStop(1, "#9c6d27");
					context.fillStyle = brass;
					context.beginPath();
					context.roundRect(-length / 2, -thick / 2, length, thick, 3);
					context.fill();
					context.restore();
					context.fillStyle = "#3b2c14";
					context.beginPath();
					context.arc(at.x, at.y, 2.6, 0, Math.PI * 2);
					context.fill();
				});

				// The keyboard's cursor.
				if (showCursor.current && run.phase === "playing" && !lightShining(run)) {
					const x = BOARD.x + cursor.current.c * cell;
					const y = BOARD.y + cursor.current.r * cell;
					context.strokeStyle = reducedMotion ? "#ffd27a" : `rgba(255,210,122,${0.75 + 0.25 * Math.sin(time * 6)})`;
					context.lineWidth = 3;
					context.beginPath();
					context.roundRect(x + 4, y + 4, cell - 8, cell - 8, 8);
					context.stroke();
				}

				// The candle on its candlestick, at the wall.
				const candle = candleAt(board);
				const sway = reducedMotion ? 0 : Math.sin(time * 8) * 1.2;
				const halo = context.createRadialGradient(candle.x, candle.y, 2, candle.x, candle.y, 34);
				halo.addColorStop(0, "rgba(255,226,150,.65)");
				halo.addColorStop(1, "rgba(255,180,90,0)");
				context.fillStyle = halo;
				context.fillRect(candle.x - 34, candle.y - 34, 68, 68);
				context.fillStyle = "#b8893c";
				context.fillRect(candle.x - 2, candle.y + 20, 4, 9);
				context.beginPath();
				context.ellipse(candle.x, candle.y + 30, 10, 3.5, 0, 0, Math.PI * 2);
				context.fill();
				context.beginPath();
				context.ellipse(candle.x, candle.y + 19, 8, 2.5, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#f3ead6";
				context.fillRect(candle.x - 4.5, candle.y + 3, 9, 16);
				context.fillStyle = "rgba(255,170,60,.95)";
				flame(context, candle.x, candle.y + 4, 15, sway);
				context.fill();
				context.fillStyle = "#fff8dc";
				flame(context, candle.x, candle.y + 3, 8, sway * 0.6);
				context.fill();
				context.restore();
			}

			// Sparks rising from the lamps.
			particles.current = particles.current.filter((particle) => time - particle.born < particle.life);
			if (!reducedMotion) {
				for (const particle of particles.current) {
					const age = time - particle.born;
					particle.x += particle.vx * dt;
					particle.y += particle.vy * dt;
					particle.vy -= 20 * dt;
					context.fillStyle = `rgba(255,${210 + Math.round(40 * (1 - age / particle.life))},140,${1 - age / particle.life})`;
					context.beginPath();
					context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
					context.fill();
				}
			}

			// The count and the city on the hill, one part of it lit for each house.
			if (fade < 1) {
				context.save();
				context.globalAlpha = 1 - fade;
				const intro = run.house === 0 && run.turns === 0 && run.t < 3.5;
				drawCity(context, 164, 16, 72, run.solved / LIGHT_HOUSES.length, solvedFlash.current > run.t - LIGHT_SHINE ? 1 : 0, time);
				context.font = `900 14px ${SANS}`;
				context.textBaseline = "middle";
				context.textAlign = "left";
				context.fillStyle = "#f1eadc";
				context.fillText(`House ${Math.min(run.house + 1, LIGHT_HOUSES.length)}/${LIGHT_HOUSES.length}`, 12, 25);
				const litNow = board.lamps.filter((_, index) => (lampGlow.current[index] ?? 0) > 0.5).length;
				context.textAlign = "right";
				context.fillStyle = litNow === board.lamps.length ? "#ffd27a" : "#f1eadc";
				context.fillText(`${litNow}/${board.lamps.length}`, STAGE - 12, 25);
				context.fillStyle = "#ffb347";
				flame(context, STAGE - 12 - context.measureText(`${litNow}/${board.lamps.length}`).width - 10, 32, 13, 0);
				context.fill();
				if (intro) {
					context.globalAlpha = (1 - fade) * Math.min(1, (3.5 - run.t) / 0.5);
					context.fillStyle = "rgba(11,10,31,.85)";
					context.beginPath();
					context.roundRect(110, 8, 180, 34, 17);
					context.fill();
					context.fillStyle = "#ffd27a";
					context.font = `900 15px ${SANS}`;
					context.textAlign = "center";
					context.fillText("Light every lamp", 200, 25);
				}
				if (lightShining(run)) {
					const left = Math.max(0, (run.shineUntil ?? 0) - run.t) / LIGHT_SHINE;
					context.globalAlpha = (1 - fade) * Math.min(1, left * 3);
					context.fillStyle = "rgba(11,10,31,.8)";
					context.beginPath();
					context.roundRect(130, BOARD.y + BOARD.size / 2 - 22, 140, 44, 22);
					context.fill();
					context.fillStyle = "#ffd27a";
					context.font = `900 18px ${SANS}`;
					context.textAlign = "center";
					context.fillText("Lit!", 200, BOARD.y + BOARD.size / 2);
				}
				context.restore();
			}

			// The last house lit: the whole city on the hill glows.
			if (won) {
				const rise = Math.min(1, outro.current / 60);
				context.save();
				context.globalAlpha = fade;
				const glow = context.createRadialGradient(200, 300, 10, 200, 300, 260);
				glow.addColorStop(0, `rgba(255,206,130,${0.45 * rise})`);
				glow.addColorStop(1, "rgba(255,206,130,0)");
				context.fillStyle = glow;
				context.fillRect(0, 0, STAGE, STAGE);
				drawCity(context, 40, 262 + (1 - rise) * 30, 320, Math.min(1, outro.current / 90), rise, time);
				context.fillStyle = "#1a1330";
				context.fillRect(0, 360, STAGE, 40);
				if (outro.current > 55) {
					context.globalAlpha = Math.min(1, (outro.current - 55) / 30);
					context.fillStyle = "#ffe7b0";
					context.font = `italic 700 23px ${SERIF}`;
					context.textAlign = "center";
					context.textBaseline = "alphabetic";
					context.fillText("A city that is set on an hill", 200, 120);
					context.fillText("cannot be hid.", 200, 152);
				}
				context.restore();
			}
			if (run.phase === "lost") {
				context.fillStyle = `rgba(5,4,14,${Math.min(0.6, outro.current / 40)})`;
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = "#f1eadc";
				context.font = `800 20px ${SANS}`;
				context.textAlign = "center";
				context.textBaseline = "middle";
				context.fillText("Not every lamp was lit", 200, 200);
			}
		},
		[reducedMotion, startHouse],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		const point = stagePoint(canvas, event);
		const board = lightBoard(state.current);
		const cell = cellSize(board);
		const c = Math.floor((point.x - BOARD.x) / cell);
		const r = Math.floor((point.y - BOARD.y) / cell);
		if (r < 0 || c < 0 || r >= board.size || c >= board.size) return;
		cursor.current = { r, c };
		if (event.pointerType !== "mouse") showCursor.current = false;
		const mirror = lightMirrorAt(board, r, c);
		if (mirror >= 0) taps.current.push(mirror);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A house at night seen from above, its rooms in a grid. A candle at one wall casts a beam of light; brass mirrors turn it. Tap a mirror, or move the gold cursor with the arrow keys and press Space, to turn it until the beam lights every lamp in the house. Three houses."
		/>
	);
}
