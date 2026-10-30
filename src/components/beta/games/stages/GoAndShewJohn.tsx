"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SHEW_CARD_H,
	SHEW_CARD_W,
	SHEW_CARDS,
	SHEW_PLACES,
	SHEW_PREVIEW,
	SHEW_WORKS,
	newShew,
	shewCanTurn,
	shewFace,
	shewLeft,
	shewPlaceAt,
	shewPreviewing,
	shewResult,
	stepShew,
	type ShewEvent,
	type ShewInput,
	type ShewMove,
	type ShewState,
} from "@/lib/beta/games/go-and-shew-john-rules";

/**
 * Go and Shew John (LC-17908), Matthew 11:2-6: a flip-pairs memory game in
 * the morning light of Galilee. Twelve linen cards, teal backs, lie face up
 * a moment and turn down; turn two over to find each subject of 11:5 and its
 * work (an eye closed and opened, a staff and walking feet, hands and clean
 * hands, an ear and an ear that hears, the sun set and risen, a scroll shut
 * and opened). When all six are shewn, John's two disciples go to shew him.
 * Dawn peach, linen, teal and gold; soft wooden turns and bell-like chimes.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, sans-serif";
const MOVES: Record<string, ShewMove> = { arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down" };
/** Each found pair rings a step higher. */
const CHIMES = [523, 587, 659, 784, 880, 1047];
const OUTRO_WON = 150;
const OUTRO_LOST = 40;
const INK = "#1f3f44";
const GOLD = "#d0902a";
const SLATE = "#7d8a8f";

interface Mote {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	color: string;
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		const next = line ? `${line} ${word}` : word;
		if (line && context.measureText(next).width > width) {
			lines.push(line);
			line = word;
		} else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * The pictogram of a work of 11:5 at x, y (about `s` across): `after` false
 * is its subject (the eye shut, the staff, the hands, the ear, the sun set,
 * the scroll rolled), true is the work done.
 */
function pictogram(context: CanvasRenderingContext2D, pair: number, after: boolean, x: number, y: number, s: number, color: string) {
	const u = s / 32;
	context.save();
	context.translate(x, y);
	context.scale(u, u);
	context.strokeStyle = color;
	context.fillStyle = color;
	context.lineWidth = 2.4;
	context.lineCap = "round";
	context.lineJoin = "round";
	if (pair === 0) {
		// The blind: an eye shut; receive their sight: the eye open, with light.
		if (after) {
			context.beginPath();
			context.moveTo(-14, 0);
			context.quadraticCurveTo(0, -13, 14, 0);
			context.quadraticCurveTo(0, 13, -14, 0);
			context.stroke();
			context.beginPath();
			context.arc(0, 0, 4.6, 0, Math.PI * 2);
			context.fill();
			for (const angle of [-2.4, -1.57, -0.74]) {
				context.beginPath();
				context.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12 - 2);
				context.lineTo(Math.cos(angle) * 16, Math.sin(angle) * 16 - 3);
				context.stroke();
			}
		} else {
			context.beginPath();
			context.moveTo(-14, -1);
			context.quadraticCurveTo(0, 9, 14, -1);
			context.stroke();
			for (const dx of [-8, 0, 8]) {
				context.beginPath();
				context.moveTo(dx, 4);
				context.lineTo(dx * 1.15, 9);
				context.stroke();
			}
		}
	} else if (pair === 1) {
		// The lame: a staff; walk: two sandalled feet, stepping.
		if (after) {
			for (const [dx, dy, tilt] of [
				[-6, 4, -0.15],
				[6, -5, 0.15],
			] as const) {
				context.save();
				context.translate(dx, dy);
				context.rotate(tilt);
				context.beginPath();
				context.ellipse(0, 0, 4.2, 8, 0, 0, Math.PI * 2);
				context.fill();
				context.beginPath();
				context.arc(0, -11.5, 2.2, 0, Math.PI * 2);
				context.fill();
				context.restore();
			}
			context.beginPath();
			context.moveTo(-15, 12);
			context.lineTo(-11, 12);
			context.moveTo(15, -12);
			context.lineTo(11, -12);
			context.stroke();
		} else {
			context.beginPath();
			context.moveTo(2, 15);
			context.lineTo(2, -9);
			context.arc(-3, -9, 5, 0, Math.PI, true);
			context.stroke();
			context.beginPath();
			context.moveTo(-10, 15);
			context.lineTo(12, 15);
			context.stroke();
		}
	} else if (pair === 2) {
		// The lepers: two hands, held out; are cleansed: the hands clean, shining.
		for (const side of [-1, 1]) {
			context.save();
			context.translate(side * 7, 3);
			context.rotate(side * 0.12);
			context.beginPath();
			context.roundRect(-4.5, -3, 9, 12, 3);
			if (after) context.fill();
			else context.stroke();
			for (let finger = 0; finger < 4; finger++) {
				context.beginPath();
				context.moveTo(-3.4 + finger * 2.3, -3);
				context.lineTo(-3.4 + finger * 2.3, -9 - (finger === 1 || finger === 2 ? 2 : 0));
				context.stroke();
			}
			context.restore();
		}
		if (after) {
			for (const [sx, sy] of [
				[-13, -13],
				[14, -10],
			]) {
				context.beginPath();
				context.moveTo(sx - 3.5, sy);
				context.lineTo(sx + 3.5, sy);
				context.moveTo(sx, sy - 3.5);
				context.lineTo(sx, sy + 3.5);
				context.stroke();
			}
		} else {
			for (const [sx, sy] of [
				[-8, 5],
				[7, 2],
				[5, 8],
			]) {
				context.beginPath();
				context.arc(sx, sy, 1.1, 0, Math.PI * 2);
				context.fill();
			}
		}
	} else if (pair === 3) {
		// The deaf: an ear; hear: the ear, and the sound coming to it.
		context.beginPath();
		context.moveTo(-4, 12);
		context.quadraticCurveTo(-12, 12, -10, 4);
		context.bezierCurveTo(-14, -6, -8, -14, 0, -14);
		context.bezierCurveTo(8, -14, 10, -5, 4, 1);
		context.quadraticCurveTo(0, 5, 0, 10);
		context.stroke();
		context.beginPath();
		context.moveTo(-4, -2);
		context.quadraticCurveTo(-3, -8, 2, -7);
		context.stroke();
		if (after) {
			for (const r of [6, 11]) {
				context.beginPath();
				context.arc(6, -2, r, -0.7, 0.7);
				context.translate(8, 0);
				context.stroke();
				context.translate(-8, 0);
			}
		} else {
			context.beginPath();
			context.moveTo(9, -6);
			context.lineTo(15, 0);
			context.moveTo(15, -6);
			context.lineTo(9, 0);
			context.globalAlpha = 0.5;
			context.stroke();
			context.globalAlpha = 1;
		}
	} else if (pair === 4) {
		// The dead: the sun gone down; are raised up: the sun risen, with rays.
		context.beginPath();
		context.moveTo(-16, 8);
		context.lineTo(16, 8);
		context.stroke();
		if (after) {
			context.beginPath();
			context.arc(0, -3, 7, 0, Math.PI * 2);
			context.fill();
			for (let i = 0; i < 8; i++) {
				const angle = (i * Math.PI) / 4;
				context.beginPath();
				context.moveTo(Math.cos(angle) * 10, -3 + Math.sin(angle) * 10);
				context.lineTo(Math.cos(angle) * 14, -3 + Math.sin(angle) * 14);
				context.stroke();
			}
		} else {
			context.beginPath();
			context.arc(0, 8, 7, Math.PI, 0);
			context.stroke();
			context.beginPath();
			context.moveTo(-10, 13);
			context.lineTo(10, 13);
			context.globalAlpha = 0.5;
			context.stroke();
			context.globalAlpha = 1;
		}
	} else {
		// The poor: a scroll rolled up; have the gospel preached to them: the scroll open.
		if (after) {
			context.beginPath();
			context.rect(-10, -10, 20, 20);
			context.stroke();
			for (const side of [-1, 1]) {
				context.beginPath();
				context.ellipse(side * 12, 0, 3, 12, 0, 0, Math.PI * 2);
				context.fill();
			}
			for (const ly of [-5, 0, 5]) {
				context.beginPath();
				context.moveTo(-6, ly);
				context.lineTo(6, ly);
				context.stroke();
			}
		} else {
			context.beginPath();
			context.ellipse(0, 0, 5, 12, 0, 0, Math.PI * 2);
			context.stroke();
			context.beginPath();
			context.moveTo(-5, -4);
			context.lineTo(5, -4);
			context.moveTo(-5, 3);
			context.lineTo(5, 3);
			context.stroke();
		}
	}
	context.restore();
}

/** One of John's two disciples, a simple robed figure walking (no face). */
function disciple(context: CanvasRenderingContext2D, x: number, y: number, robe: string, step: number) {
	context.fillStyle = "rgba(40,30,20,.18)";
	context.beginPath();
	context.ellipse(x, y + 2, 14, 4, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - 6, y - 34);
	context.lineTo(x + 6, y - 34);
	context.lineTo(x + 11 + step * 2, y);
	context.lineTo(x - 11 + step * 2, y);
	context.closePath();
	context.fill();
	context.fillStyle = "#e9d4b4";
	context.beginPath();
	context.arc(x + 1, y - 40, 6.5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = robe;
	context.beginPath();
	context.arc(x, y - 41, 7.2, Math.PI * 1.05, Math.PI * 1.95);
	context.lineTo(x - 7, y - 34);
	context.fill();
	// A staff.
	context.strokeStyle = "#6b4a2a";
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(x + 12, y - 44);
	context.lineTo(x + 10 + step, y);
	context.stroke();
}

export default function GoAndShewJohn({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<ShewState>(newShew(seed));
	const queue = useRef<ShewInput[]>([]);
	const keyboard = useRef(true);
	const outro = useRef(0);
	const ended = useRef(false);
	const motes = useRef<Mote[]>([]);
	const missAt = useRef<{ places: [number, number]; tick: number } | null>(null);
	const matchAt = useRef<number[]>(new Array(SHEW_CARDS).fill(-999));
	const lastFrame = useRef(0);
	const lastData = useRef("");
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = 40 + Math.random() * 120;
			const life = 0.6 + Math.random() * 0.6;
			motes.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 60, life, max: life, color: Math.random() < 0.5 ? "#ffe3a1" : "#fff8e6" });
		}
	}, []);

	const sound = useCallback(
		(event: ShewEvent, run: ShewState) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "move") play.tone(1180, 0.035, { type: "sine", volume: 0.035 });
			if (event.type === "turn") {
				play.noise(0.05, { volume: 0.12, filter: 2400, type: "bandpass" });
				play.tone(560, 0.07, { type: "sine", volume: 0.07, to: 480 });
			}
			if (event.type === "match") {
				const note = CHIMES[Math.min(CHIMES.length - 1, run.shewn.length - 1)];
				play.tone(note, 0.7, { type: "sine", volume: 0.18 });
				play.tone(note * 1.5, 0.55, { type: "sine", volume: 0.07, delay: 0.07 });
				play.tone(note * 2, 0.4, { type: "sine", volume: 0.04, delay: 0.12 });
			}
			if (event.type === "miss") play.tone(247, 0.3, { type: "sine", volume: 0.12, to: 220, delay: 0.05 });
			if (event.type === "hide") play.noise(0.06, { volume: 0.06, filter: 1600, type: "bandpass" });
			if (event.type === "cover") play.noise(0.25, { volume: 0.08, filter: 900 });
			if (event.type === "won") [440, 554, 659, 880, 1109].forEach((note, index) => play.tone(note, 1.4, { type: "sine", volume: 0.12, delay: 0.3 + index * 0.12 }));
			if (event.type === "lost") play.tone(330, 0.9, { type: "sine", volume: 0.14, to: 247 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		const canvas = canvasRef.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = shewResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		for (const key of takePresses(keys)) {
			if (MOVES[key]) queue.current.push({ move: MOVES[key] });
			else if (key === " ") queue.current.push({ turn: true });
			else continue;
			keyboard.current = true;
		}
		if (queue.current.length > 6) queue.current.splice(0, queue.current.length - 6);
		// Moves go at once; a turn waits until a card can be turned (two that differ still show), and is dropped in the preview.
		let input: ShewInput = {};
		const head = queue.current[0];
		if (head) {
			const turning = head.turn || (head.place !== undefined && head.place !== null);
			if (!turning) input = queue.current.shift() ?? {};
			else if (shewPreviewing(run)) queue.current.shift();
			else if (shewCanTurn(run)) input = queue.current.shift() ?? {};
		}
		const events: ShewEvent[] = [];
		stepShew(run, input, events);
		for (const event of events) {
			sound(event, run);
			if (event.type === "match") {
				for (const place of event.places) {
					matchAt.current[place] = run.tick;
					burst(SHEW_PLACES[place].x, SHEW_PLACES[place].y, 14);
				}
			}
			if (event.type === "miss") missAt.current = { places: event.places, tick: run.tick };
			if (event.type === "won") burst(200, 200, 40);
		}
		onTime(shewLeft(run));
		if (canvas) {
			const cards = run.cards.map((card) => `${card.pair}${card.matched ? "m" : card.up ? "u" : "d"}`).join(",");
			const data = [run.phase, run.cursor, run.open.join(","), shewCanTurn(run) ? 1 : 0, cards].join("|");
			if (data !== lastData.current) {
				lastData.current = data;
				canvas.dataset.shew = data;
			}
		}
	}, [burst, keys, onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const tick = run.tick;
			const won = run.phase === "won";
			const lost = run.phase === "lost";

			// Morning over Galilee: a peach sky, far blue hills, a limestone court.
			const sky = context.createLinearGradient(0, 0, 0, 90);
			sky.addColorStop(0, "#f9d9b0");
			sky.addColorStop(1, "#fbead0");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, 90);
			context.fillStyle = "#b9c9c0";
			context.beginPath();
			context.moveTo(0, 74);
			context.quadraticCurveTo(70, 52, 140, 66);
			context.quadraticCurveTo(220, 48, 300, 64);
			context.quadraticCurveTo(360, 54, 400, 62);
			context.lineTo(400, 90);
			context.lineTo(0, 90);
			context.fill();
			const court = context.createLinearGradient(0, 74, 0, STAGE);
			court.addColorStop(0, "#efdcb6");
			court.addColorStop(1, "#dcc195");
			context.fillStyle = court;
			context.fillRect(0, 74, STAGE, STAGE - 74);
			context.strokeStyle = "rgba(160,124,74,.18)";
			context.lineWidth = 1;
			for (let y = 90; y < STAGE; y += 36) {
				context.beginPath();
				context.moveTo(0, y);
				context.lineTo(STAGE, y);
				context.stroke();
			}

			// John's question, and the six works as they are shewn.
			context.textAlign = "center";
			context.textBaseline = "alphabetic";
			context.fillStyle = INK;
			context.font = `italic 600 14px ${SERIF}`;
			context.fillText("Art thou he that should come, or do we look for another?", 200, 22);
			if (shewPreviewing(run)) {
				context.fillStyle = "#8a4f1a";
				context.font = `900 16px ${SANS}`;
				context.fillText("Remember!", 200, 46);
				context.fillStyle = "rgba(31,63,68,.15)";
				context.fillRect(120, 54, 160, 5);
				context.fillStyle = GOLD;
				context.fillRect(120, 54, 160 * (1 - tick / SHEW_PREVIEW), 5);
			} else {
				for (let pair = 0; pair < SHEW_WORKS.length; pair++) {
					const x = 200 + (pair - 2.5) * 40;
					const shewn = run.shewn.includes(pair);
					context.beginPath();
					context.arc(x, 48, 15, 0, Math.PI * 2);
					context.fillStyle = shewn ? "#fff4d8" : "rgba(255,255,255,.35)";
					context.fill();
					context.strokeStyle = shewn ? GOLD : "rgba(31,63,68,.25)";
					context.lineWidth = shewn ? 2.2 : 1.2;
					context.stroke();
					context.globalAlpha = shewn ? 1 : 0.28;
					pictogram(context, pair, true, x, 48, 20, shewn ? GOLD : INK);
					context.globalAlpha = 1;
				}
			}

			// The cards.
			const miss = missAt.current && run.open.length === 2 ? missAt.current : null;
			for (let place = 0; place < SHEW_CARDS; place++) {
				const card = run.cards[place];
				const at = SHEW_PLACES[place];
				const face = won ? 1 : shewFace(run, place);
				const width = Math.abs(Math.cos((1 - face) * Math.PI));
				const showFace = face >= 0.5;
				const sinceMatch = tick - matchAt.current[place];
				const pop = card.matched && sinceMatch < 18 ? Math.sin((sinceMatch / 18) * Math.PI) * 0.06 : 0;
				const missed = miss?.places.includes(place);
				let x = at.x;
				if (missed && !reducedMotion && miss) {
					const since = tick - miss.tick;
					if (since < 14) x += Math.sin(since * 1.7) * 3.5 * (1 - since / 14);
				}
				const w = SHEW_CARD_W * (1 + pop);
				const h = SHEW_CARD_H * (1 + pop);
				context.save();
				if (won) context.globalAlpha = Math.max(0.18, 1 - outro.current / 40);
				// A matched card glows.
				if (card.matched && !won) {
					const glow = context.createRadialGradient(x, at.y, 20, x, at.y, 70);
					glow.addColorStop(0, "rgba(255,214,120,.55)");
					glow.addColorStop(1, "rgba(255,214,120,0)");
					context.fillStyle = glow;
					context.fillRect(x - 70, at.y - 70, 140, 140);
				}
				context.translate(x, at.y);
				context.scale(Math.max(0.04, width), 1);
				context.fillStyle = "rgba(60,40,20,.22)";
				context.beginPath();
				context.roundRect(-w / 2 + 3, -h / 2 + 5, w, h, 11);
				context.fill();
				if (showFace) {
					context.fillStyle = card.matched ? "#fff6e0" : "#fbf4e4";
					context.beginPath();
					context.roundRect(-w / 2, -h / 2, w, h, 11);
					context.fill();
					context.strokeStyle = card.matched ? GOLD : missed ? "#c46a5a" : "rgba(31,63,68,.35)";
					context.lineWidth = card.matched || missed ? 3 : 1.5;
					context.stroke();
					const after = card.half === 1;
					pictogram(context, card.pair, after, 0, -h / 2 + 27, 34, after ? GOLD : SLATE);
					const text = after ? SHEW_WORKS[card.pair].work : SHEW_WORKS[card.pair].subject;
					context.fillStyle = INK;
					let size = after ? 14 : 16;
					let lines: string[] = [];
					for (; ; size--) {
						context.font = after ? `italic 600 ${size}px ${SERIF}` : `700 ${size}px ${SERIF}`;
						lines = wrap(context, text, w - 12);
						if (size <= 10 || (lines.length * (size + 2) <= 48 && lines.every((line) => context.measureText(line).width <= w - 10))) break;
					}
					const lead = size + 2;
					const top = -2 + (48 - lines.length * lead) / 2 + size * 0.8;
					lines.forEach((line, index) => context.fillText(line, 0, top + index * lead));
				} else {
					const back = context.createLinearGradient(0, -h / 2, 0, h / 2);
					back.addColorStop(0, "#2f7b7c");
					back.addColorStop(1, "#1e5658");
					context.fillStyle = back;
					context.beginPath();
					context.roundRect(-w / 2, -h / 2, w, h, 11);
					context.fill();
					context.strokeStyle = "#f3e3c2";
					context.lineWidth = 2;
					context.beginPath();
					context.roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 8);
					context.stroke();
					// An olive sprig.
					context.strokeStyle = "rgba(243,227,194,.8)";
					context.fillStyle = "rgba(243,227,194,.8)";
					context.lineWidth = 1.6;
					context.beginPath();
					context.moveTo(0, 16);
					context.quadraticCurveTo(-3, 0, 0, -16);
					context.stroke();
					for (let i = 0; i < 4; i++) {
						const ly = 10 - i * 8;
						for (const side of [-1, 1]) {
							context.save();
							context.translate(-1 + side * 2, ly);
							context.rotate(side * 0.9);
							context.beginPath();
							context.ellipse(0, -5, 2.2, 5.2, 0, 0, Math.PI * 2);
							context.fill();
							context.restore();
						}
					}
				}
				context.restore();
			}

			// The keyboard's highlight.
			if (keyboard.current && run.phase === "playing" && !shewPreviewing(run)) {
				const at = SHEW_PLACES[run.cursor];
				const glow = reducedMotion ? 0.9 : 0.65 + 0.35 * Math.sin(time * 6);
				context.strokeStyle = `rgba(214,140,20,${glow})`;
				context.lineWidth = 4;
				context.beginPath();
				context.roundRect(at.x - SHEW_CARD_W / 2 - 5, at.y - SHEW_CARD_H / 2 - 5, SHEW_CARD_W + 10, SHEW_CARD_H + 10, 14);
				context.stroke();
			}

			// Won: the cards fade, and the two disciples go to shew John at the prison.
			if (won) {
				const k = Math.min(1, outro.current / 40);
				context.fillStyle = `rgba(251,234,208,${0.55 * k})`;
				context.fillRect(0, 74, STAGE, STAGE - 74);
				// The prison: a stone tower, its window lit.
				context.globalAlpha = k;
				context.fillStyle = "#8f7d66";
				context.fillRect(320, 250, 58, 112);
				context.fillStyle = "#7a6a55";
				for (let i = 0; i < 4; i++) context.fillRect(320 + i * 16, 242, 10, 10);
				context.fillStyle = "#ffd98a";
				context.fillRect(340, 278, 18, 24);
				context.strokeStyle = "#4e4033";
				context.lineWidth = 2;
				for (const bx of [346, 352]) {
					context.beginPath();
					context.moveTo(bx, 278);
					context.lineTo(bx, 302);
					context.stroke();
				}
				context.fillStyle = "#5e4e3e";
				context.beginPath();
				context.roundRect(338, 322, 22, 40, [11, 11, 0, 0]);
				context.fill();
				context.fillStyle = "#c9b48c";
				context.fillRect(0, 362, STAGE, 4);
				const walk = Math.max(0, (outro.current - 20) / (OUTRO_WON - 20));
				const along = 40 + walk * 230;
				const stride = reducedMotion ? 0 : Math.sin(outro.current * 0.35);
				disciple(context, along, 362, "#6d7f9a", stride);
				disciple(context, along - 30, 362, "#9a7a5a", -stride);
				context.fillStyle = INK;
				context.font = `800 26px ${SERIF}`;
				context.fillText("Go and shew John", 200, 150);
				context.font = `italic 600 16px ${SERIF}`;
				context.fillStyle = "#6a4a20";
				context.fillText("blessed is he, whosoever shall", 200, 186);
				context.fillText("not be offended in me", 200, 208);
				context.globalAlpha = 1;
			}
			if (lost) {
				context.fillStyle = `rgba(40,30,30,${Math.min(0.35, outro.current / 60)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// Motes of light.
			motes.current = motes.current.filter((mote) => (mote.life -= dt) > 0);
			for (const mote of motes.current) {
				mote.x += mote.vx * dt;
				mote.y += mote.vy * dt;
				mote.vy += 90 * dt;
				context.globalAlpha = Math.min(1, (mote.life / mote.max) * 1.4);
				context.fillStyle = mote.color;
				context.beginPath();
				context.arc(mote.x, mote.y, 2.2, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		const point = stagePoint(canvas, event);
		const place = shewPlaceAt(point.x, point.y);
		if (place === null) return;
		keyboard.current = false;
		queue.current.push({ place });
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="Go and shew John, Matthew 11. Twelve cards lie face up for a moment, then face down: six pairs, each a subject of verse 5 and its work, such as The blind and receive their sight. Tap two cards, or move the highlight with the arrow keys and press Space, to turn them over; find all six pairs before the time runs out."
		/>
	);
}
