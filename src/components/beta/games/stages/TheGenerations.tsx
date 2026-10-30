"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	GENERATIONS_AGES,
	GENERATIONS_LINE,
	GENERATIONS_RUNS,
	GENERATIONS_SHOW_RIGHT,
	GENERATIONS_SLOTS,
	GENERATIONS_TILE_H,
	GENERATIONS_TILE_W,
	GENERATIONS_WRITE,
	generationsCanPick,
	generationsDown,
	generationsLeft,
	generationsLit,
	generationsResult,
	generationsSlotAt,
	newGenerations,
	stepGenerations,
	type GenerationsEvent,
	type GenerationsState,
} from "@/lib/beta/games/the-generations-rules";

/**
 * The Generations (LC-17908), Matthew 1:1-25: a watch-then-repeat memory
 * game on the line of 1:2-16. Six sandstone tablets under a lapis night
 * light up in the order of the generations, each with its own lyre note,
 * then turn face down; pick them in the order they lit (tap, click or keys
 * 1-6). Each kept run is inked into the scroll above, age by age (1:17),
 * until the line ends in JESUS. Lapis, gold leaf and sandstone.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, sans-serif";
const DIGITS: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5 };
/** Each tablet's own lyre note, by place (a pentatonic run, Simon-like). */
const NOTES = [294, 370, 440, 494, 587, 740];
/** How long the won line glows, and the dimming of a lost one, before the round ends. */
const OUTRO_WON = 100;
const OUTRO_LOST = 40;
const ROW_Y = [56, 80, 104];
const JESUS_Y = 130;

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	color: string;
}

interface Flyer {
	name: string;
	from: { x: number; y: number };
	age: number;
	index: number;
	tick: number;
}

/** An arch-topped tablet path centred on x, y. */
function tabletPath(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
	const r = Math.min(w / 2, 30);
	context.beginPath();
	context.moveTo(x - w / 2, y + h / 2 - 6);
	context.lineTo(x - w / 2, y - h / 2 + r);
	context.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
	context.lineTo(x + w / 2 - r, y - h / 2);
	context.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
	context.lineTo(x + w / 2, y + h / 2 - 6);
	context.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - 6, y + h / 2);
	context.lineTo(x - w / 2 + 6, y + h / 2);
	context.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - 6);
	context.closePath();
}

/** Sets a font no wider than `max`, from `size` down. */
function fitFont(context: CanvasRenderingContext2D, text: string, max: number, size: number, weight = "700", family = SERIF) {
	let px = size;
	context.font = `${weight} ${px}px ${family}`;
	while (px > 10 && context.measureText(text).width > max) {
		px -= 1;
		context.font = `${weight} ${px}px ${family}`;
	}
	return px;
}

/** A four-pointed star of light. */
function star(context: CanvasRenderingContext2D, x: number, y: number, r: number) {
	context.beginPath();
	for (let i = 0; i < 8; i++) {
		const angle = (i * Math.PI) / 4 - Math.PI / 2;
		const reach = i % 2 === 0 ? r : r * 0.28;
		context.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
	}
	context.closePath();
}

/** The names of an age's row, where each one's centre falls, and the dot before it. */
function rowLayout(context: CanvasRenderingContext2D, names: string[]): { font: string; xs: number[]; dots: number[] } {
	const text = names.join("  ·  ");
	fitFont(context, text, 336, 15, "700");
	const font = context.font;
	const total = context.measureText(text).width;
	const dot = context.measureText("  ·  ").width;
	let x = 200 - total / 2;
	const dots: number[] = [];
	const xs = names.map((name) => {
		const width = context.measureText(name).width;
		const centre = x + width / 2;
		x += width + dot;
		dots.push(x - dot / 2);
		return centre;
	});
	return { font, xs, dots };
}

export default function TheGenerations({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<GenerationsState>(newGenerations(seed));
	const picks = useRef<number[]>([]);
	const outro = useRef(0);
	const ended = useRef(false);
	const sparks = useRef<Spark[]>([]);
	const flyers = useRef<Flyer[]>([]);
	/** The tick a tablet was last struck (lit or picked), by place, for its pulse. */
	const struck = useRef<number[]>([-999, -999, -999, -999, -999, -999]);
	const lastFrame = useRef(0);
	const lastData = useRef("");
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, color: string, count: number, speed = 140) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.8);
			const life = 0.5 + Math.random() * 0.5;
			sparks.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 50, life, max: life, color });
		}
	}, []);

	const sound = useCallback(
		(event: GenerationsEvent, run: GenerationsState) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "light" || event.type === "right") {
				const note = NOTES[event.slot];
				play.tone(note, 0.32, { type: "triangle", volume: 0.22 });
				play.tone(note * 2, 0.22, { type: "sine", volume: 0.05, delay: 0.01 });
			}
			if (event.type === "flip") play.noise(0.14, { volume: 0.07, filter: 1800, type: "bandpass" });
			if (event.type === "wrong") {
				play.tone(130, 0.35, { type: "square", volume: 0.08, to: 82 });
				play.noise(0.16, { volume: 0.22, filter: 2600, type: "highpass" });
			}
			if (event.type === "replay") play.noise(0.25, { volume: 0.05, filter: 900 });
			if (event.type === "kept") run.run.forEach((place, index) => play.tone(NOTES[place], 0.25, { type: "triangle", volume: 0.12, delay: 0.08 + index * 0.06 }));
			if (event.type === "won") [294, 370, 440, 587, 740, 880].forEach((note, index) => play.tone(note, 1.6, { type: "triangle", volume: 0.12, delay: 0.25 + index * 0.09 }));
			if (event.type === "lost") play.tone(294, 1, { type: "sine", volume: 0.16, to: 196 });
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
				const result = generationsResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		for (const key of takePresses(keys)) if (DIGITS[key] !== undefined) picks.current.push(DIGITS[key]);
		// Picks made while the names still lie face up, or while a run is shown or written, do not wait for the turn.
		if (run.stage === "wrong" || run.stage === "write" || (run.stage === "watch" && generationsDown(run) === 0)) picks.current.length = 0;
		if (picks.current.length > 3) picks.current.splice(0, picks.current.length - 3);
		const slot = generationsCanPick(run) ? (picks.current.shift() ?? null) : null;
		const age = run.age;
		const events: GenerationsEvent[] = [];
		stepGenerations(run, { slot }, events);
		for (const event of events) {
			sound(event, run);
			if (event.type === "light" || event.type === "right") {
				struck.current[event.slot] = run.tick;
				const at = GENERATIONS_SLOTS[event.slot];
				burst(at.x, at.y - 10, event.type === "right" ? "#ffe59a" : "#fff4cf", event.type === "right" ? 16 : 8, event.type === "right" ? 150 : 90);
			}
			if (event.type === "wrong") {
				const at = GENERATIONS_SLOTS[event.slot];
				burst(at.x, at.y, "#c9b9a0", 14, 120);
			}
			if (event.type === "kept") {
				run.run.forEach((place, index) => {
					flyers.current.push({ name: GENERATIONS_LINE[run.tablets[place]], from: GENERATIONS_SLOTS[place], age, index, tick: run.tick });
				});
			}
			if (event.type === "won") {
				burst(200, 280, "#fff6d6", 50, 220);
				burst(200, JESUS_Y, "#ffe08a", 24, 120);
			}
		}
		onTime(generationsLeft(run));
		if (canvas) {
			const data = [run.phase, run.age, run.stage, run.run.join(""), run.progress, run.replays, generationsCanPick(run) ? 1 : 0, generationsLit(run)?.slot ?? "-"].join("|");
			if (data !== lastData.current) {
				lastData.current = data;
				canvas.dataset.gen = data;
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
			const since = tick - run.stageAt;

			// A lapis night with gold-leaf stars.
			const sky = context.createLinearGradient(0, 0, 0, STAGE);
			sky.addColorStop(0, "#0c1638");
			sky.addColorStop(0.5, "#15265a");
			sky.addColorStop(1, "#0a1230");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, STAGE);
			for (let i = 0; i < 54; i++) {
				const x = (i * 97.3 + 13) % STAGE;
				const y = 140 + ((i * 53.7) % 260);
				const twinkle = reducedMotion ? 0.45 : 0.3 + 0.35 * Math.sin(time * 1.4 + i * 1.7);
				context.fillStyle = `rgba(244,210,122,${twinkle})`;
				context.fillRect(x, y, 1.6, 1.6);
			}

			// The scroll of the generations.
			context.fillStyle = "rgba(0,0,0,.3)";
			context.fillRect(22, 14, STAGE - 44, 132);
			const vellum = context.createLinearGradient(0, 8, 0, 142);
			vellum.addColorStop(0, "#f3e6c4");
			vellum.addColorStop(1, "#e2cc9b");
			context.fillStyle = vellum;
			context.fillRect(20, 8, STAGE - 40, 134);
			for (const x of [16, STAGE - 16]) {
				const rod = context.createLinearGradient(x - 9, 0, x + 9, 0);
				rod.addColorStop(0, "#7a5328");
				rod.addColorStop(0.5, "#c8945a");
				rod.addColorStop(1, "#6a4520");
				context.fillStyle = rod;
				context.beginPath();
				context.roundRect(x - 9, 2, 18, 146, 8);
				context.fill();
			}
			context.strokeStyle = "rgba(138,104,52,.5)";
			context.lineWidth = 1;
			context.strokeRect(32, 14, STAGE - 64, 122);

			context.textAlign = "center";
			context.textBaseline = "alphabetic";
			const label = won ? "unto Christ" : GENERATIONS_AGES[run.age].label;
			fitFont(context, label, 320, 15, "italic 600");
			context.fillStyle = "#7a4f1e";
			context.fillText(label, 200, 32);

			// Each age's row: its kept names, ink still wet as they arrive; dots for the run still to keep.
			let keptAt = 0;
			for (let age = 0; age < GENERATIONS_RUNS.length; age++) {
				const length = GENERATIONS_RUNS[age];
				const names = run.kept.slice(keptAt, keptAt + length).map((index) => GENERATIONS_LINE[index]);
				keptAt += length;
				const y = ROW_Y[age];
				if (names.length === length) {
					const { font, xs, dots } = rowLayout(context, names);
					context.font = font;
					names.forEach((name, index) => {
						const flyer = flyers.current.find((item) => item.age === age && item.index === index);
						const k = flyer ? Math.min(1, (tick - flyer.tick + outro.current) / (GENERATIONS_WRITE * 0.8)) : 1;
						context.globalAlpha = k * k;
						context.fillStyle = "#3b2a17";
						context.fillText(name, xs[index], y);
						if (index > 0) {
							context.fillStyle = "#a8854a";
							context.fillText("·", dots[index - 1], y);
						}
					});
					context.globalAlpha = 1;
				} else {
					const current = age === run.age && !won;
					const spacing = 22;
					for (let i = 0; i < length; i++) {
						const x = 200 + (i - (length - 1) / 2) * spacing;
						context.beginPath();
						context.arc(x, y - 5, current ? 5 : 3.5, 0, Math.PI * 2);
						if (current && run.stage === "recall" && i < run.progress) {
							context.fillStyle = "#c98a1c";
							context.fill();
						} else {
							context.strokeStyle = current ? "#a8742a" : "rgba(138,104,52,.4)";
							context.lineWidth = 1.6;
							context.stroke();
						}
					}
				}
			}
			// The line ends in JESUS.
			if (won) {
				const k = Math.min(1, outro.current / 30);
				context.globalAlpha = k;
				context.fillStyle = "#b8860b";
				context.font = `800 19px ${SERIF}`;
				context.fillText("JESUS", 200, JESUS_Y);
				star(context, 200 + context.measureText("JESUS").width / 2 + 14, JESUS_Y - 7, 7);
				context.fill();
				context.globalAlpha = 1;
			} else {
				context.fillStyle = "rgba(138,104,52,.45)";
				context.font = `600 12px ${SERIF}`;
				context.fillText("·  ·  ·", 200, JESUS_Y);
			}

			// What to do now.
			context.font = `900 16px ${SANS}`;
			const cue = won
				? ""
				: lost
					? ""
					: run.stage === "watch"
						? generationsDown(run) > 0
							? "Remember!"
							: run.replays && since < 60
								? "Again: watch"
								: "Watch"
						: run.stage === "recall"
							? run.age === 0 && run.progress === 0
								? "Your turn: in the order they lit"
								: `Your turn  ${run.progress}/${run.run.length}`
							: run.stage === "wrong"
								? "Not that one"
								: "Kept!";
			if (cue) {
				context.fillStyle = run.stage === "wrong" ? "#ffb39a" : run.stage === "recall" ? "#fff1c1" : "#f4d27a";
				context.fillText(cue, 200, 165);
			}

			// The tablets.
			const lit = generationsLit(run);
			const down = generationsDown(run);
			const picked = new Set(run.stage === "recall" || run.stage === "wrong" || run.stage === "write" || won ? run.run.slice(0, run.progress) : []);
			for (let place = 0; place < GENERATIONS_SLOTS.length; place++) {
				const at = GENERATIONS_SLOTS[place];
				const name = GENERATIONS_LINE[run.tablets[place]];
				const isLit = lit?.slot === place;
				const isPicked = picked.has(place);
				const cracked = run.stage === "wrong" && run.wrong?.slot === place;
				const shown = run.stage === "wrong" && run.wrong?.right === place;
				const writing = run.stage === "write" && run.run.includes(place);
				// Face up while watching (until they turn), when picked right, or shown after a wrong pick.
				let turn = isPicked || shown || writing ? 0 : down;
				if (won) turn = 0;
				const width = Math.abs(Math.cos(turn * Math.PI));
				const faceUp = turn < 0.5;
				const pulse = Math.max(0, 1 - (tick - struck.current[place]) / 20);
				const grow = isLit ? 1.06 : 1 + pulse * 0.04;
				let x = at.x;
				const y = at.y;
				if (cracked && !reducedMotion && since < 16) x += Math.sin(since * 1.9) * 5 * (1 - since / 16);
				const w = GENERATIONS_TILE_W * grow;
				const h = GENERATIONS_TILE_H * grow;
				context.save();
				if (won || lost) context.globalAlpha = Math.max(0.25, 1 - outro.current / (won ? 40 : 30));
				if (writing) context.globalAlpha = Math.max(0.35, 1 - since / GENERATIONS_WRITE);
				// A glow behind a lit tablet.
				if (isLit || shown || (isPicked && pulse > 0)) {
					const glow = context.createRadialGradient(x, y, 20, x, y, 92);
					const strength = isLit ? 0.75 : shown ? 0.45 + (reducedMotion ? 0 : 0.2 * Math.sin(since * 0.4)) : 0.5 * pulse;
					glow.addColorStop(0, `rgba(255,214,110,${strength})`);
					glow.addColorStop(1, "rgba(255,214,110,0)");
					context.fillStyle = glow;
					context.fillRect(x - 100, y - 100, 200, 200);
				}
				context.translate(x, y);
				context.scale(Math.max(0.04, width), 1);
				context.fillStyle = "rgba(0,0,0,.35)";
				tabletPath(context, 4, 6, w, h);
				context.fill();
				if (faceUp) {
					const stone = context.createLinearGradient(0, -h / 2, 0, h / 2);
					if (isLit) {
						stone.addColorStop(0, "#fffbe8");
						stone.addColorStop(1, "#f2c14e");
					} else if (isPicked || shown || writing) {
						stone.addColorStop(0, "#f8e7b4");
						stone.addColorStop(1, "#d9aa52");
					} else {
						stone.addColorStop(0, "#efe0bd");
						stone.addColorStop(1, "#c4a26c");
					}
					context.fillStyle = stone;
					tabletPath(context, 0, 0, w, h);
					context.fill();
					context.strokeStyle = isLit ? "#fff6d6" : "#8a6a3a";
					context.lineWidth = isLit ? 3 : 2;
					context.stroke();
					context.strokeStyle = "rgba(120,88,44,.35)";
					context.lineWidth = 1;
					tabletPath(context, 0, 2, w - 16, h - 16);
					context.stroke();
					context.fillStyle = "#3b2a17";
					fitFont(context, name, w - 18, 23, "700");
					context.fillText(name, 0, 8);
				} else {
					const back = context.createLinearGradient(0, -h / 2, 0, h / 2);
					back.addColorStop(0, cracked ? "#5a4a5e" : "#36508f");
					back.addColorStop(1, cracked ? "#2c2232" : "#1d2c5c");
					context.fillStyle = back;
					tabletPath(context, 0, 0, w, h);
					context.fill();
					context.strokeStyle = cracked ? "#c79a8a" : "#d8b25e";
					context.lineWidth = 2;
					context.stroke();
					// A carved arch and a gold-leaf mark.
					context.strokeStyle = cracked ? "rgba(199,154,138,.5)" : "rgba(216,178,94,.55)";
					context.lineWidth = 1.5;
					tabletPath(context, 0, 2, w - 22, h - 22);
					context.stroke();
					context.fillStyle = cracked ? "rgba(199,154,138,.6)" : "rgba(244,210,122,.75)";
					star(context, 0, -4, 13);
					context.fill();
					if (cracked) {
						context.strokeStyle = "#140c16";
						context.lineWidth = 2.4;
						context.beginPath();
						context.moveTo(-8, -h / 2 + 4);
						context.lineTo(4, -18);
						context.lineTo(-6, 0);
						context.lineTo(10, 16);
						context.lineTo(2, h / 2 - 4);
						context.moveTo(-6, 0);
						context.lineTo(-30, 12);
						context.moveTo(4, -18);
						context.lineTo(28, -26);
						context.stroke();
					}
				}
				// Its number, small, in the corner.
				context.fillStyle = faceUp ? "rgba(59,42,23,.7)" : "rgba(244,226,180,.85)";
				context.font = `800 12px ${SANS}`;
				context.fillText(String(place + 1), -w / 2 + 14, h / 2 - 9);
				context.restore();
			}

			// After a wrong pick: an arrow of light to the right tablet.
			if (run.stage === "wrong" && run.wrong) {
				const to = GENERATIONS_SLOTS[run.wrong.right];
				context.strokeStyle = `rgba(255,236,170,${0.55 + 0.3 * Math.sin(since * (reducedMotion ? 0 : 0.35))})`;
				context.lineWidth = 3;
				context.beginPath();
				context.roundRect(to.x - GENERATIONS_TILE_W / 2 - 5, to.y - GENERATIONS_TILE_H / 2 - 5, GENERATIONS_TILE_W + 10, GENERATIONS_TILE_H + 10, 30);
				context.stroke();
				const left = Math.max(0, GENERATIONS_SHOW_RIGHT - since);
				if (left > 0) {
					// Above the tablet, except the top middle one, where the cue line sits: there, inside its top edge.
					const under = Math.abs(to.x - 200) < 1 && to.y - GENERATIONS_TILE_H / 2 - 9 < 180;
					context.fillStyle = under ? "#8a3b22" : "#ffd9c9";
					context.font = `800 12px ${SANS}`;
					context.fillText("then", to.x, under ? to.y - GENERATIONS_TILE_H / 2 + 18 : to.y - GENERATIONS_TILE_H / 2 - 9);
				}
			}

			// Kept names fly up into the scroll.
			flyers.current = flyers.current.filter((flyer) => tick - flyer.tick + outro.current < GENERATIONS_WRITE * 0.8);
			if (flyers.current.length) {
				const byAge = new Map<number, string[]>();
				let at = 0;
				GENERATIONS_RUNS.forEach((length, age) => {
					byAge.set(age, run.kept.slice(at, at + length).map((index) => GENERATIONS_LINE[index]));
					at += length;
				});
				for (const flyer of flyers.current) {
					const names = byAge.get(flyer.age) ?? [];
					const { xs } = rowLayout(context, names);
					const k = Math.min(1, (tick - flyer.tick + outro.current) / (GENERATIONS_WRITE * 0.8));
					const e = k * k * (3 - 2 * k);
					const x = flyer.from.x + ((xs[flyer.index] ?? 200) - flyer.from.x) * e;
					const y = flyer.from.y + (ROW_Y[flyer.age] - flyer.from.y) * e;
					context.globalAlpha = 1 - k * k;
					context.fillStyle = "#ffe9a8";
					context.font = `800 ${Math.round(22 - k * 7)}px ${SERIF}`;
					context.fillText(flyer.name, x, y);
				}
				context.globalAlpha = 1;
			}

			// Won: a tablet of light, and the star.
			if (won) {
				const k = Math.min(1, outro.current / 36);
				const e = 1 - (1 - k) * (1 - k);
				context.fillStyle = `rgba(8,12,34,${0.45 * e})`;
				context.fillRect(0, 150, STAGE, 250);
				const cx = 200;
				const cy = 292;
				context.save();
				context.translate(cx, cy);
				if (!reducedMotion) context.rotate(time * 0.15);
				for (let i = 0; i < 12; i++) {
					context.rotate(Math.PI / 6);
					context.fillStyle = `rgba(255,236,170,${0.13 * e})`;
					context.beginPath();
					context.moveTo(-8, 0);
					context.lineTo(8, 0);
					context.lineTo(0, -190);
					context.closePath();
					context.fill();
				}
				context.restore();
				const w = 150 * e;
				const h = 130 * e;
				const light = context.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
				light.addColorStop(0, "#ffffff");
				light.addColorStop(1, "#ffe08a");
				context.fillStyle = light;
				tabletPath(context, cx, cy, w, h);
				context.fill();
				context.strokeStyle = "#fff6d6";
				context.lineWidth = 3;
				context.stroke();
				if (k > 0.5) {
					context.globalAlpha = Math.min(1, (k - 0.5) * 2);
					context.fillStyle = "#7a4f1e";
					context.font = `800 32px ${SERIF}`;
					context.fillText("JESUS", cx, cy + 14);
					context.fillStyle = "#fff8dc";
					star(context, cx, cy - h / 2 - 22, 18);
					context.fill();
					context.fillStyle = "#f4e6c4";
					context.font = `italic 600 14px ${SERIF}`;
					context.fillText("thou shalt call his name JESUS", cx, 388);
					context.globalAlpha = 1;
				}
			}
			if (lost) {
				context.fillStyle = `rgba(6,8,20,${Math.min(0.45, outro.current / 60)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// Sparks of gold leaf.
			sparks.current = sparks.current.filter((spark) => (spark.life -= dt) > 0);
			for (const spark of sparks.current) {
				spark.x += spark.vx * dt;
				spark.y += spark.vy * dt;
				spark.vy += 200 * dt;
				context.globalAlpha = Math.min(1, (spark.life / spark.max) * 1.5);
				context.fillStyle = spark.color;
				context.fillRect(spark.x - 1.8, spark.y - 1.8, 3.6, 3.6);
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
		const place = generationsSlotAt(point.x, point.y);
		if (place !== null) picks.current.push(place);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="The generations of Matthew 1. Six stone tablets with names from the line light up one after another in the order of the generations, then turn face down. Tap them, or press their numbers 1 to 6, in the order they lit. Three ages, from Abraham to David, to the carrying away into Babylon, and unto Christ."
		/>
	);
}
