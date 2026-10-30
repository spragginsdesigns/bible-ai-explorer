"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	DIRS,
	WEDDING_COLS,
	WEDDING_DOOR,
	WEDDING_GUESTS,
	WEDDING_ROWS,
	WEDDING_SECONDS,
	isRoad,
	newWedding,
	stepWedding,
	weddingResult,
	type Dir,
	type WeddingEvent,
	type WeddingState,
} from "@/lib/beta/games/bid-to-the-marriage-rules";

/**
 * Bid to the Marriage (LC-17908), Matthew 22:1-14: a map of highways in the
 * green of spring, seen from above, with fields, vineyards and olive groves
 * between the roads and the king's wedding hall in the middle, its tables
 * laid and its door on the south side. The servant runs the roads (arrows or
 * a swipe set his way; he turns at the next crossing where it opens). Guests
 * wait at the highways, a ring under each running down until he goes his way;
 * running past one bids him, and he walks in to the wedding by himself. At
 * the door he goes in and sits at the tables, which fill place by place.
 */

const T = 32;
const OX = 24;
const OY = 42;
const HALL = { x: OX + 4 * T, y: OY + 4 * T, w: 3 * T, h: 3 * T };
const KEY_DIRS: Record<string, Dir> = { arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right" };
/** Guests' looks: a traveller, a beggar, a merchant, an elder, a woman with a water pot, a husbandman. */
const KINDS = [
	{ robe: "#8a6440", head: "#6f5236", trim: "#c9a36a" },
	{ robe: "#8d8478", head: "#7a7066", trim: "#b5aa96" },
	{ robe: "#2f7a5a", head: "#e7c85a", trim: "#f2d679" },
	{ robe: "#ece2cc", head: "#f6efe0", trim: "#3d63a8" },
	{ robe: "#b0563f", head: "#3d5f9a", trim: "#e9d6b0" },
	{ robe: "#c79a4a", head: "#a7782e", trim: "#6e8a3a" },
];

const px = (x: number) => OX + x * T + T / 2;
const py = (y: number) => OY + y * T + T / 2;

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

/** The places at the tables, in the hall: four along the top of the board, three below it, and benches for more. */
function seatAt(index: number): { x: number; y: number } {
	const top = [0, 1, 2, 3];
	if (index < 4) return { x: HALL.x + 22 + top[index] * 17.5, y: HALL.y + 38 };
	if (index < WEDDING_GUESTS) return { x: HALL.x + 30 + (index - 4) * 17.5, y: HALL.y + 66 };
	return { x: HALL.x + 16 + ((index - WEDDING_GUESTS) % 4) * 21, y: HALL.y + 84 };
}

function drawPerson(context: CanvasRenderingContext2D, x: number, y: number, kind: number, scale: number, step: number, alpha = 1) {
	const look = KINDS[kind % KINDS.length];
	context.save();
	context.globalAlpha = alpha;
	context.translate(x, y);
	context.scale(scale, scale);
	context.fillStyle = "rgba(40,50,20,.28)";
	context.beginPath();
	context.ellipse(0, 7, 8, 3, 0, 0, Math.PI * 2);
	context.fill();
	const sway = Math.sin(step) * 1.2;
	context.fillStyle = look.robe;
	context.beginPath();
	context.moveTo(-5, -5);
	context.lineTo(5, -5);
	context.lineTo(7 + sway * 0.3, 7);
	context.lineTo(-7 + sway * 0.3, 7);
	context.closePath();
	context.fill();
	context.fillStyle = look.trim;
	context.fillRect(-6, 1, 12, 1.8);
	context.fillStyle = "#c48a5c";
	context.beginPath();
	context.arc(0, -9, 4.4, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = look.head;
	context.beginPath();
	context.arc(0, -10, 4.7, Math.PI * 1.05, Math.PI * 1.95);
	context.lineTo(4.8, -6);
	context.lineTo(-4.8, -6);
	context.closePath();
	context.fill();
	// What each carries: a staff, a bowl, a purse, a white beard, a water pot, a basket.
	context.lineCap = "round";
	if (kind === 0) {
		context.strokeStyle = "#5a3a20";
		context.lineWidth = 1.6;
		context.beginPath();
		context.moveTo(7, -10);
		context.lineTo(8, 8);
		context.stroke();
	} else if (kind === 1) {
		context.fillStyle = "#7a5530";
		context.beginPath();
		context.ellipse(6, -1, 3.2, 1.6, 0, 0, Math.PI);
		context.fill();
	} else if (kind === 2) {
		context.fillStyle = "#e7c85a";
		context.beginPath();
		context.arc(-6.5, 0, 2.6, 0, Math.PI * 2);
		context.fill();
	} else if (kind === 3) {
		context.fillStyle = "#ffffff";
		context.beginPath();
		context.ellipse(0, -5.5, 3, 2.6, 0, 0, Math.PI);
		context.fill();
	} else if (kind === 4) {
		context.fillStyle = "#b9704a";
		context.beginPath();
		context.ellipse(6.5, -3, 2.6, 3.4, 0, 0, Math.PI * 2);
		context.fill();
	} else {
		context.fillStyle = "#9a6a2a";
		context.fillRect(-9, -2, 5, 4);
	}
	context.restore();
}

function drawServant(context: CanvasRenderingContext2D, x: number, y: number, facing: Dir, step: number, moving: boolean) {
	context.save();
	context.translate(x, y);
	context.scale(1.15, 1.15);
	context.fillStyle = "rgba(40,50,20,.3)";
	context.beginPath();
	context.ellipse(0, 9, 10, 3.6, 0, 0, Math.PI * 2);
	context.fill();
	const lean = facing === "left" ? -1 : facing === "right" ? 1 : 0;
	const stride = moving ? Math.sin(step) * 3 : 0;
	// Running feet.
	context.fillStyle = "#4a2f1c";
	context.beginPath();
	context.ellipse(-3 + stride, 8.5, 2.6, 1.6, 0, 0, Math.PI * 2);
	context.ellipse(3 - stride, 8.5, 2.6, 1.6, 0, 0, Math.PI * 2);
	context.fill();
	// The king's servant: a blue tunic with a gold sash.
	context.fillStyle = "#2f4f9a";
	context.beginPath();
	context.moveTo(-6 + lean, -7);
	context.lineTo(6 + lean, -7);
	context.lineTo(8, 8);
	context.lineTo(-8, 8);
	context.closePath();
	context.fill();
	context.strokeStyle = "#f2c94c";
	context.lineWidth = 2.2;
	context.beginPath();
	context.moveTo(-6 + lean, -5);
	context.lineTo(6 + lean, 2);
	context.stroke();
	context.fillStyle = "#c48a5c";
	context.beginPath();
	context.arc(lean * 1.5, -11, 5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#f4ead2";
	context.beginPath();
	context.arc(lean * 1.5, -12, 5.3, Math.PI * 1.05, Math.PI * 1.95);
	context.lineTo(lean * 1.5 + 5.4, -8);
	context.lineTo(lean * 1.5 - 5.4, -8);
	context.closePath();
	context.fill();
	if (facing === "down" || lean) {
		context.fillStyle = "#2a1a12";
		context.beginPath();
		if (facing === "down") {
			context.arc(-1.8, -10.5, 0.8, 0, Math.PI * 2);
			context.arc(1.8, -10.5, 0.8, 0, Math.PI * 2);
		} else context.arc(lean * 4, -10.5, 0.8, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

/** The map that never changes (fields, highways, the hall and its tables), painted once at twice the size. */
function paintMap(): HTMLCanvasElement | null {
	if (typeof document === "undefined") return null;
	const layer = document.createElement("canvas");
	layer.width = STAGE * 2;
	layer.height = STAGE * 2;
	const context = layer.getContext("2d");
	if (!context) return null;
	context.scale(2, 2);
	context.fillStyle = "#6f9f4c";
	context.fillRect(0, 0, STAGE, STAGE);
	// Fields between the highways: vineyards, wheat, olive groves, meadow with flowers.
	for (let y = 0; y < WEDDING_ROWS; y++) {
		for (let x = 0; x < WEDDING_COLS; x++) {
			if (isRoad(x, y) || (x >= 4 && x <= 6 && y >= 4 && y <= 6)) continue;
			const left = OX + x * T;
			const top = OY + y * T;
			const kind = (x * 7 + y * 3 + ((x * y) % 3)) % 4;
			if (kind === 0) {
				context.fillStyle = "#7aa954";
				context.fillRect(left, top, T, T);
				context.fillStyle = "#4e7a34";
				for (let row = 0; row < 4; row++) context.fillRect(left + 3, top + 4 + row * 7, T - 6, 2.4);
				context.fillStyle = "#6b3b5e";
				for (let grape = 0; grape < 3; grape++) context.fillRect(left + 6 + grape * 9, top + 9 + (grape % 2) * 7, 2.4, 2.4);
			} else if (kind === 1) {
				context.fillStyle = "#e2c56e";
				context.fillRect(left, top, T, T);
				context.strokeStyle = "#c9a64a";
				context.lineWidth = 1;
				context.beginPath();
				for (let row = 0; row < 6; row++) {
					context.moveTo(left + 2, top + 3 + row * 5.2);
					context.lineTo(left + T - 2, top + 1 + row * 5.2);
				}
				context.stroke();
			} else if (kind === 2) {
				context.fillStyle = "#86b35e";
				context.fillRect(left, top, T, T);
				context.fillStyle = "rgba(40,50,20,.25)";
				context.beginPath();
				context.ellipse(left + 18, top + 21, 10, 4, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#5c7d4a";
				context.beginPath();
				context.arc(left + 15, top + 14, 9, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#7f9e66";
				context.beginPath();
				context.arc(left + 12, top + 11, 4.5, 0, Math.PI * 2);
				context.arc(left + 19, top + 15, 3.5, 0, Math.PI * 2);
				context.fill();
			} else {
				context.fillStyle = "#8dbb63";
				context.fillRect(left, top, T, T);
				for (let flower = 0; flower < 5; flower++) {
					context.fillStyle = flower % 2 ? "#f6f0d8" : "#e88aa0";
					context.beginPath();
					context.arc(left + 5 + ((flower * 11 + x * 5) % 22), top + 6 + ((flower * 7 + y * 3) % 20), 1.6, 0, Math.PI * 2);
					context.fill();
				}
			}
		}
	}
	// The highways: worn earth with a border, joined where they meet.
	for (const [color, inset] of [
		["#b8915a", 3],
		["#ecd6a4", 6],
	] as const) {
		context.fillStyle = color;
		for (let y = 0; y < WEDDING_ROWS; y++) {
			for (let x = 0; x < WEDDING_COLS; x++) {
				if (!isRoad(x, y)) continue;
				const left = OX + x * T;
				const top = OY + y * T;
				context.fillRect(left + inset, top + inset, T - inset * 2, T - inset * 2);
				if (isRoad(x + 1, y)) context.fillRect(left + T - inset, top + inset, inset * 2, T - inset * 2);
				if (isRoad(x, y + 1)) context.fillRect(left + inset, top + T - inset, T - inset * 2, inset * 2);
			}
		}
	}
	// Wheel ruts, and a waymark stone at every parting of the highways.
	for (let y = 0; y < WEDDING_ROWS; y++) {
		for (let x = 0; x < WEDDING_COLS; x++) {
			if (!isRoad(x, y)) continue;
			const ways = Object.values(DIRS).filter((dir) => isRoad(x + dir.x, y + dir.y)).length;
			context.fillStyle = "rgba(150,110,60,.25)";
			context.beginPath();
			context.arc(px(x) + ((x * 5 + y * 3) % 9) - 4, py(y) + ((x * 3 + y * 7) % 9) - 4, 1.2, 0, Math.PI * 2);
			context.fill();
			if (ways >= 3) {
				context.fillStyle = "#b9b0a0";
				context.beginPath();
				context.arc(OX + x * T + 5, OY + y * T + 5, 2.8, 0, Math.PI * 2);
				context.fill();
			}
		}
	}
	// The wedding hall: white stone walls, a floor of fired tiles, the board laid with white linen.
	context.fillStyle = "rgba(40,50,20,.28)";
	context.fillRect(HALL.x + 4, HALL.y + 6, HALL.w, HALL.h);
	context.fillStyle = "#f2e8d4";
	context.fillRect(HALL.x, HALL.y, HALL.w, HALL.h);
	context.fillStyle = "#d9a77a";
	context.fillRect(HALL.x + 6, HALL.y + 6, HALL.w - 12, HALL.h - 12);
	context.strokeStyle = "rgba(160,100,60,.35)";
	context.lineWidth = 0.8;
	context.beginPath();
	for (let line = 1; line < 7; line++) {
		context.moveTo(HALL.x + 6 + line * 12, HALL.y + 6);
		context.lineTo(HALL.x + 6 + line * 12, HALL.y + HALL.h - 6);
		context.moveTo(HALL.x + 6, HALL.y + 6 + line * 12);
		context.lineTo(HALL.x + HALL.w - 6, HALL.y + 6 + line * 12);
	}
	context.stroke();
	context.fillStyle = "#8a5a34";
	context.fillRect(HALL.x + 14, HALL.y + 46, HALL.w - 28, 12);
	context.fillStyle = "#fbf6ea";
	context.fillRect(HALL.x + 15, HALL.y + 47, HALL.w - 30, 10);
	// Bread and wine laid on it.
	for (let dish = 0; dish < 5; dish++) {
		context.fillStyle = dish % 2 ? "#c9893a" : "#7a1f3a";
		context.beginPath();
		context.arc(HALL.x + 22 + dish * 13, HALL.y + 52, 2.4, 0, Math.PI * 2);
		context.fill();
	}
	// The door on the south side.
	context.fillStyle = "#d9a77a";
	context.fillRect(HALL.x + HALL.w / 2 - 11, HALL.y + HALL.h - 7, 22, 8);
	// Garlands along the north wall.
	context.strokeStyle = "#5f8f3e";
	context.lineWidth = 2;
	context.beginPath();
	for (let swag = 0; swag < 4; swag++) {
		const sx = HALL.x + 6 + swag * 21;
		context.moveTo(sx, HALL.y + 4);
		context.quadraticCurveTo(sx + 10.5, HALL.y + 13, sx + 21, HALL.y + 4);
	}
	context.stroke();
	for (let bloom = 0; bloom < 5; bloom++) {
		context.fillStyle = bloom % 2 ? "#f6d0dc" : "#fff6e0";
		context.beginPath();
		context.arc(HALL.x + 6 + bloom * 21, HALL.y + 4, 2.4, 0, Math.PI * 2);
		context.fill();
	}
	return layer;
}

export default function BidToTheMarriage({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WeddingState>(newWedding(seed));
	const want = useRef<Dir | null>(null);
	const gesture = useRef<{ id: number; x: number; y: number; at: number; swiped: boolean } | null>(null);
	const map = useRef<HTMLCanvasElement | null>(null);
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const runPhase = useRef(0);
	const lastStep = useRef(0);
	const endedWall = useRef<number | null>(null);
	const ended = useRef(false);
	const lastData = useRef("");
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, t: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const power = speed * (0.4 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power - 20, born: t, life: 0.5 + Math.random() * 0.5, color: colors[i % colors.length], size: 1.3 + Math.random() * 1.8 });
		}
	}, []);

	const react = useCallback(
		(event: WeddingEvent, run: WeddingState) => {
			const play = synth.current;
			if (event.type === "appear") {
				const guest = run.guests[event.id];
				burst(px(guest.x), py(guest.y), 6, ["#fff6d0", "#ffffff"], 30, run.t);
				play?.tone(1318, 0.12, { type: "sine", volume: 0.05 });
			}
			if (event.type === "bid") {
				floaters.current.push({ x: px(event.x), y: py(event.y) - 20, born: run.t, text: "Come!", color: "#fff1b0" });
				burst(px(event.x), py(event.y), 10, ["#ffe08a", "#ffffff"], 50, run.t);
				play?.tone(660, 0.1, { type: "triangle", volume: 0.12 });
				play?.tone(880 + Math.min(event.bidden, 12) * 40, 0.16, { type: "triangle", volume: 0.12, delay: 0.08 });
			}
			if (event.type === "seat") {
				floaters.current.push({ x: px(WEDDING_DOOR.x), y: HALL.y + HALL.h - 14, born: run.t, text: `${Math.min(event.seated, WEDDING_GUESTS)}/${WEDDING_GUESTS}`, color: "#fff1b0" });
				burst(px(WEDDING_DOOR.x), py(WEDDING_DOOR.y) - 10, 12, ["#f6d0dc", "#fff6e0", "#ffe08a"], 60, run.t);
				[784, 988].forEach((note, index) => play?.tone(note, 0.4, { type: "sine", volume: 0.1, delay: index * 0.07 }));
			}
			if (event.type === "gone") {
				const guest = run.guests[event.id];
				burst(px(guest.x), py(guest.y), 5, ["rgba(220,200,160,.8)"], 25, run.t);
				play?.tone(440, 0.22, { type: "sine", volume: 0.05, to: 330 });
			}
			if (event.type === "furnished") {
				burst(HALL.x + HALL.w / 2, HALL.y + HALL.h / 2, 40, ["#f6d0dc", "#fff6e0", "#ffe08a", "#ffffff"], 110, run.t);
				[523, 659, 784, 1047, 1319].forEach((note, index) => play?.tone(note, 1.1, { type: "triangle", volume: 0.12, delay: 0.25 + index * 0.1 }));
			}
			if (event.type === "time") play?.tone(262, 0.6, { type: "triangle", volume: 0.1, to: 196 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		for (const key of takePresses(keys)) if (KEY_DIRS[key]) want.current = KEY_DIRS[key];
		const events: WeddingEvent[] = [];
		const fromX = run.x;
		const fromY = run.y;
		stepWedding(run, { want: want.current }, events);
		for (const event of events) react(event, run);
		if (run.x !== fromX || run.y !== fromY) {
			runPhase.current += 0.45;
			if (run.t - lastStep.current > 0.16) {
				lastStep.current = run.t;
				synth.current?.noise(0.03, { volume: 0.035, filter: 1100 });
			}
		}
		onTime(Math.max(0, WEDDING_SECONDS - run.t));
		const canvas = canvasRef.current;
		if (canvas) {
			const waiting = run.guests
				.filter((guest) => guest.state === "wait")
				.map((guest) => `${guest.x},${guest.y},${(guest.leaves - run.t).toFixed(1)}`)
				.join(" ");
			const data = `${run.phase} ${run.x.toFixed(2)} ${run.y.toFixed(2)} ${run.dir ?? "-"} ${run.going} ${run.seated}|${waiting}`;
			if (data !== lastData.current) {
				lastData.current = data;
				canvas.dataset.wed = data;
			}
		}
		const result = weddingResult(run);
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
			if (run.phase !== "playing" && endedWall.current === null) endedWall.current = time;
			if (!map.current) map.current = paintMap();
			if (map.current) context.drawImage(map.current, 0, 0, STAGE, STAGE);
			else {
				context.fillStyle = "#6f9f4c";
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// The door glows while bidden guests are on their way in.
			const doorX = px(WEDDING_DOOR.x);
			const doorY = py(WEDDING_DOOR.y);
			const pulse = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(time * 5);
			if (run.going > 0 && run.phase === "playing") {
				const glow = context.createRadialGradient(doorX, doorY - 8, 4, doorX, doorY - 8, 30);
				glow.addColorStop(0, `rgba(255,226,130,${0.55 + 0.3 * pulse})`);
				glow.addColorStop(1, "rgba(255,226,130,0)");
				context.fillStyle = glow;
				context.fillRect(doorX - 32, doorY - 40, 64, 64);
			}

			// The places at the tables: empty ones a faint gold ring, filled ones the guests who came.
			const seated = run.guests.filter((guest) => guest.state === "seated").sort((a, b) => a.at - b.at || a.id - b.id);
			const places = Math.max(WEDDING_GUESTS, seated.length);
			for (let index = 0; index < places; index++) {
				const seat = seatAt(index);
				if (index >= seated.length && index < WEDDING_GUESTS) {
					context.strokeStyle = `rgba(255,236,170,${0.45 + 0.25 * pulse})`;
					context.lineWidth = 1.4;
					context.beginPath();
					context.arc(seat.x, seat.y, 5.5, 0, Math.PI * 2);
					context.stroke();
				}
			}
			seated.forEach((guest, index) => {
				const seat = seatAt(index);
				const walk = Math.min(1, (t - guest.at) / 0.55);
				const x = doorX + (seat.x - doorX) * walk;
				const y = HALL.y + HALL.h - 4 + (seat.y - (HALL.y + HALL.h - 4)) * walk;
				drawPerson(context, x, y, guest.kind, 0.8, walk < 1 ? still * 12 : 0);
			});
			// Lamps on the walls, lit brighter as the wedding fills.
			const lit = Math.min(1, seated.length / WEDDING_GUESTS);
			for (const [lx, ly] of [
				[HALL.x + 8, HALL.y + 22],
				[HALL.x + HALL.w - 8, HALL.y + 22],
				[HALL.x + 8, HALL.y + HALL.h - 22],
				[HALL.x + HALL.w - 8, HALL.y + HALL.h - 22],
			]) {
				const flame = context.createRadialGradient(lx, ly, 1, lx, ly, 10 + lit * 10);
				flame.addColorStop(0, `rgba(255,214,120,${0.6 + 0.4 * lit})`);
				flame.addColorStop(1, "rgba(255,214,120,0)");
				context.fillStyle = flame;
				context.fillRect(lx - 22, ly - 22, 44, 44);
			}

			// Guests at the highways, each over a ring that runs down until he goes his way.
			for (const guest of run.guests) {
				if (guest.state === "wait") {
					const left = Math.max(0, (guest.leaves - t) / (guest.leaves - guest.appears));
					const gx = px(guest.x);
					const gy = py(guest.y);
					const urgent = guest.leaves - t < 1.6;
					context.strokeStyle = "rgba(60,40,20,.25)";
					context.lineWidth = 3.4;
					context.beginPath();
					context.arc(gx, gy + 1, 13.5, 0, Math.PI * 2);
					context.stroke();
					context.strokeStyle = urgent ? `rgba(255,120,90,${0.7 + 0.3 * pulse})` : "#ffd65a";
					context.beginPath();
					context.arc(gx, gy + 1, 13.5, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
					context.stroke();
					const pop = Math.min(1, (t - guest.appears) / 0.25);
					const wave = reducedMotion ? 0 : Math.sin(time * 6 + guest.id) * 0.06;
					drawPerson(context, gx, gy - 1, guest.kind, (0.8 + 0.35 * pop) * (1 + wave), 0);
				} else if (guest.state === "gone" && t - guest.at < 0.7) {
					const fade = (t - guest.at) / 0.7;
					drawPerson(context, px(guest.x), py(guest.y) - 1 - fade * 12, guest.kind, 1, still * 8, 1 - fade);
				}
			}

			// The bidden, walking in by the highways, a little light about each; then the servant.
			for (const guest of run.guests) {
				if (guest.state !== "going") continue;
				const gx = px(guest.x);
				const gy = py(guest.y);
				const halo = context.createRadialGradient(gx, gy, 2, gx, gy, 15);
				halo.addColorStop(0, "rgba(255,236,160,.55)");
				halo.addColorStop(1, "rgba(255,236,160,0)");
				context.fillStyle = halo;
				context.fillRect(gx - 16, gy - 16, 32, 32);
				drawPerson(context, gx, gy - 1, guest.kind, 0.95, still * 10 + guest.id);
			}
			drawServant(context, px(run.x), py(run.y) - 2, run.facing, runPhase.current, run.dir !== null && run.phase === "playing");
			// A small arrow for the way he will turn at the next crossing.
			if (want.current && want.current !== run.dir && run.phase === "playing") {
				const dir = DIRS[want.current];
				const ax = px(run.x) + dir.x * 17;
				const ay = py(run.y) - 2 + dir.y * 17;
				context.fillStyle = "rgba(255,240,170,.9)";
				context.beginPath();
				context.moveTo(ax + dir.x * 5, ay + dir.y * 5);
				context.lineTo(ax - dir.y * 4.5 - dir.x * 2, ay + dir.x * 4.5 - dir.y * 2);
				context.lineTo(ax + dir.y * 4.5 - dir.x * 2, ay - dir.x * 4.5 - dir.y * 2);
				context.closePath();
				context.fill();
			}

			particles.current = particles.current.filter((particle) => t - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = t - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x + particle.vx * age, particle.y + particle.vy * age + 30 * age * age, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			floaters.current = floaters.current.filter((floater) => t - floater.born < 0.9);
			context.textAlign = "center";
			context.font = "900 15px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = (t - floater.born) / 0.9;
				context.globalAlpha = 1 - age * age;
				context.lineWidth = 3;
				context.strokeStyle = "rgba(40,30,20,.75)";
				context.strokeText(floater.text, floater.x, floater.y - age * 18);
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 18);
			}
			context.globalAlpha = 1;

			// The HUD: guests seated of those the wedding needs, and those on their way in.
			context.fillStyle = "rgba(28,36,22,.72)";
			context.beginPath();
			context.roundRect(10, 6, 156, 30, 12);
			context.fill();
			context.fillStyle = "#fbf6ea";
			context.fillRect(20, 18, 22, 6);
			context.fillStyle = "#8a5a34";
			context.fillRect(22, 24, 2.4, 6);
			context.fillRect(37.6, 24, 2.4, 6);
			context.textAlign = "left";
			context.font = "900 17px system-ui, sans-serif";
			context.fillStyle = run.seated >= WEDDING_GUESTS ? "#ffe08a" : "#ffffff";
			context.fillText(`${Math.min(run.seated, 99)}/${WEDDING_GUESTS} seated`, 48, 27);
			if (run.going > 0) {
				context.fillStyle = "rgba(28,36,22,.72)";
				context.beginPath();
				context.roundRect(STAGE - 112, 6, 102, 30, 12);
				context.fill();
				context.fillStyle = "#ffe08a";
				context.font = "900 15px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(`+${run.going} coming`, STAGE - 61, 26);
			}

			// The first moments: what to do.
			if (t < 2.4 && run.phase === "playing") {
				context.fillStyle = "rgba(28,36,22,.78)";
				context.beginPath();
				context.roundRect(50, 362, 300, 30, 12);
				context.fill();
				context.fillStyle = "#ffffff";
				context.font = "900 14px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Run past the guests to bid them come", 200, 382);
			}
			if (run.phase === "won") {
				const since = endedWall.current === null ? 0 : time - endedWall.current;
				context.fillStyle = `rgba(255,240,200,${Math.min(0.3, since * 0.4)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused) return;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		const point = stagePoint(event.currentTarget, event);
		gesture.current = { id: event.pointerId, x: point.x, y: point.y, at: performance.now(), swiped: false };
	};
	const onMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const start = gesture.current;
		if (!start || start.id !== event.pointerId) return;
		const point = stagePoint(event.currentTarget, event);
		const dx = point.x - start.x;
		const dy = point.y - start.y;
		if (Math.hypot(dx, dy) < 16) return;
		// A swipe: its main direction is the way to run; the gesture may go on to swipe again.
		want.current = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
		gesture.current = { ...start, x: point.x, y: point.y, swiped: true };
	};
	const onUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const start = gesture.current;
		gesture.current = null;
		if (!start || start.id !== event.pointerId || start.swiped || performance.now() - start.at > 500) return;
		// A tap: run toward where it landed, from where he is.
		const run = state.current;
		const dx = start.x - px(run.x);
		const dy = start.y - py(run.y);
		if (Math.hypot(dx, dy) < 6) return;
		want.current = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
	};
	const onCancel = () => {
		gesture.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onCancel}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label={`A map of highways among fields and vineyards seen from above, with the king's wedding hall in the middle and its door on the south side. Guests, both bad and good, wait at the highways, each over a ring that runs down until he goes his way. Use the arrow keys, or swipe, or tap toward where you want to go, to set the servant's way: he runs until a wall and turns at the next crossing that opens. Run past a guest to bid him and he walks in to the wedding by himself. Seat ${WEDDING_GUESTS} to furnish the wedding.`}
		/>
	);
}
