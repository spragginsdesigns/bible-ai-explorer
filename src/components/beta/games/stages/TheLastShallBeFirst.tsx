"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	LAST_HOURS,
	LAST_LINES,
	LAST_SECONDS,
	lastHours,
	lastPaying,
	lastResult,
	lastTarget,
	newLast,
	stepLast,
	type LastEvent,
	type LastInput,
	type LastState,
} from "@/lib/beta/games/the-last-shall-be-first-rules";

/**
 * The Last Shall Be First (LC-17908), Matthew 20:1-16: the vineyard at even,
 * the sun going down behind the vines and the steward at the front of the
 * line with the pennies. Each labourer holds up the sign of the hour he was
 * hired: a sundial whose shadow points to the hour, in the colour of the sky
 * at that hour, and its name. Put the line in order from the last unto the
 * first by swapping two at a time (tap one, then another; or ← → and Space
 * to pick one up and Space again where he goes). In order, the steward pays
 * every man a penny, the same coin for each, and the next line comes.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, sans-serif";
/** The line stands between these, the front by the steward. */
const LINE = { left: 72, right: 394, foot: 352 };
const STEWARD = { x: 38, hand: { x: 56, y: 296 } };
const OUTRO_WON = 160;
const OUTRO_LOST = 48;
/** How long a penny takes to fly to a man, and the time between pennies. */
const COIN_FLIGHT = 0.3;
const COIN_GAP = 0.13;
/** Each hour's sky, for its sign: dawn, morning, noon, afternoon, dusk. */
const HOUR_SKY = ["#f7c6b2", "#f8e09a", "#fff4d2", "#f3b26c", "#bba2dc"];
const TUNICS = ["#8a5a3b", "#5d6b3a", "#7b4a5e", "#3f5d78", "#9a7b46", "#6a4f7a", "#4f6f5a", "#875f4a"];
const HEADCLOTHS = ["#e8dcc4", "#d9c3a0", "#c9b38f", "#efe6d2", "#bfae95"];

interface Coin {
	to: number;
	from: number;
	at: number;
}

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
}

function spacing(count: number) {
	return (LINE.right - LINE.left) / count;
}

function xFor(index: number, count: number) {
	return LINE.left + (index + 0.5) * spacing(count);
}

function drawPenny(context: CanvasRenderingContext2D, x: number, y: number, r: number) {
	// One penny, the same for every man: a silver coin with a rim.
	context.fillStyle = "#8f9aa6";
	context.beginPath();
	context.arc(x, y + 0.8, r, 0, Math.PI * 2);
	context.fill();
	const face = context.createRadialGradient(x - r * 0.35, y - r * 0.35, 0.5, x, y, r);
	face.addColorStop(0, "#ffffff");
	face.addColorStop(0.6, "#d6dde4");
	face.addColorStop(1, "#a5b0bb");
	context.fillStyle = face;
	context.beginPath();
	context.arc(x, y, r, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = "rgba(90,100,112,.7)";
	context.lineWidth = 0.9;
	context.beginPath();
	context.arc(x, y, r * 0.7, 0, Math.PI * 2);
	context.stroke();
}

/** A labourer: a simple robed figure with a headcloth and no face, holding up his sign. */
function drawMan(context: CanvasRenderingContext2D, x: number, foot: number, id: number, s: number) {
	context.fillStyle = "rgba(0,0,0,.22)";
	context.beginPath();
	context.ellipse(x, foot + 1, 15 * s, 4 * s, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#5a3d2b";
	context.fillRect(x - 6 * s, foot - 9 * s, 4 * s, 9 * s);
	context.fillRect(x + 2 * s, foot - 9 * s, 4 * s, 9 * s);
	context.fillStyle = TUNICS[id % TUNICS.length];
	context.beginPath();
	context.moveTo(x - 9 * s, foot - 52 * s);
	context.lineTo(x + 9 * s, foot - 52 * s);
	context.lineTo(x + 14 * s, foot - 8 * s);
	context.lineTo(x - 14 * s, foot - 8 * s);
	context.closePath();
	context.fill();
	context.fillStyle = "rgba(0,0,0,.18)";
	context.fillRect(x - 12 * s, foot - 30 * s, 24 * s, 3 * s);
	// The arm raised to the sign's staff.
	context.strokeStyle = TUNICS[id % TUNICS.length];
	context.lineWidth = 5 * s;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(x + 7 * s, foot - 48 * s);
	context.lineTo(x + 12 * s, foot - 62 * s);
	context.stroke();
	context.fillStyle = "#b98a65";
	context.beginPath();
	context.arc(x, foot - 60 * s, 8 * s, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = HEADCLOTHS[id % HEADCLOTHS.length];
	context.beginPath();
	context.arc(x, foot - 62 * s, 8.6 * s, Math.PI * 1.02, Math.PI * 1.98);
	context.lineTo(x + 9 * s, foot - 52 * s);
	context.lineTo(x + 6 * s, foot - 61 * s);
	context.lineTo(x - 6 * s, foot - 61 * s);
	context.lineTo(x - 9 * s, foot - 52 * s);
	context.closePath();
	context.fill();
}

/** The sign of a man's hour: a sundial whose shadow points to it, on that hour's sky, and its name. */
function drawSign(context: CanvasRenderingContext2D, x: number, top: number, width: number, hour: number, glow: number) {
	const height = 58;
	context.strokeStyle = "#6b4a2a";
	context.lineWidth = 3;
	context.beginPath();
	context.moveTo(x + width * 0.3, top + height);
	context.lineTo(x + width * 0.3, top + height + 22);
	context.stroke();
	if (glow > 0) {
		context.fillStyle = `rgba(255,214,110,${0.55 * glow})`;
		context.beginPath();
		context.roundRect(x - width / 2 - 5, top - 5, width + 10, height + 10, 9);
		context.fill();
	}
	context.fillStyle = HOUR_SKY[hour];
	context.beginPath();
	context.roundRect(x - width / 2, top, width, height, 6);
	context.fill();
	context.strokeStyle = glow > 0 ? "#fff1c0" : "#6b4a2a";
	context.lineWidth = 2;
	context.stroke();
	// The dial: a half round with five marks and the shadow on this hour's mark.
	const cx = x;
	const cy = top + 24;
	const r = Math.min(15, width * 0.3);
	context.fillStyle = "rgba(255,255,255,.65)";
	context.beginPath();
	context.arc(cx, cy, r, Math.PI, 0);
	context.closePath();
	context.fill();
	context.strokeStyle = "rgba(60,40,24,.55)";
	context.lineWidth = 1;
	context.stroke();
	for (let mark = 0; mark < 5; mark++) {
		const angle = Math.PI + (mark / 4) * Math.PI;
		context.beginPath();
		context.moveTo(cx + Math.cos(angle) * r * 0.78, cy + Math.sin(angle) * r * 0.78);
		context.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
		context.stroke();
	}
	const angle = Math.PI + (hour / 4) * Math.PI;
	context.strokeStyle = "#2b2118";
	context.lineWidth = 2.6;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(cx, cy);
	context.lineTo(cx + Math.cos(angle) * r * 0.92, cy + Math.sin(angle) * r * 0.92);
	context.stroke();
	context.fillStyle = "#2b2118";
	context.beginPath();
	context.arc(cx, cy, 2, 0, Math.PI * 2);
	context.fill();
	// The hour's name, shrunk to fit the sign.
	const word = LAST_HOURS[hour];
	context.fillStyle = "#2b2118";
	context.textAlign = "center";
	context.textBaseline = "alphabetic";
	context.font = `900 13px ${SANS}`;
	const fit = Math.min(13, (13 * (width - 6)) / Math.max(1, context.measureText(word).width));
	context.font = `900 ${fit.toFixed(1)}px ${SANS}`;
	context.fillText(word, x, top + (hour === 0 ? 47 : 42));
	if (hour > 0) {
		context.font = `800 9px ${SANS}`;
		context.fillText("hour", x, top + 53);
	}
}

export default function TheLastShallBeFirst({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [initial] = useState(() => newLast(seed));
	const state = useRef<LastState>(initial);
	const taps = useRef<number[]>([]);
	const cursor = useRef(0);
	const showCursor = useRef<boolean | null>(null);
	/** Where each man is drawn, by id: he walks to his place. */
	const drawn = useRef(new Map<number, { x: number; lift: number }>());
	const coins = useRef<Coin[]>([]);
	const sparks = useRef<Spark[]>([]);
	const paidAt = useRef(-9);
	const outro = useRef(0);
	const ended = useRef(false);
	const clock = useRef(0);
	const lastFrame = useRef(0);
	const lastData = useRef(0);
	const synth = useSynth(muted);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = lastResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		const count = run.men.length;
		const input: LastInput = {};
		for (const key of takePresses(keys)) {
			showCursor.current = true;
			if (key === "arrowleft") cursor.current = Math.max(0, cursor.current - 1);
			if (key === "arrowright") cursor.current = Math.min(count - 1, cursor.current + 1);
			if (key === " " && input.select === undefined) input.select = cursor.current;
		}
		const tap = taps.current.shift();
		if (input.select === undefined && tap !== undefined) input.select = tap;
		taps.current.length = 0;

		const events: LastEvent[] = [];
		stepLast(run, input, events);
		const play = synth.current;
		for (const event of events) {
			if (event.type === "pick") play?.tone(392, 0.12, { type: "triangle", volume: 0.12, to: 523 });
			if (event.type === "drop") play?.tone(392, 0.12, { type: "triangle", volume: 0.08, to: 294 });
			if (event.type === "swap") {
				play?.noise(0.16, { volume: 0.06, filter: 900 });
				const target = lastTarget(lastHours(run));
				const settledNow = [event.a, event.b].filter((index) => run.men[index].hour === target[index]).length;
				play?.tone(settledNow ? 659 : 494, 0.18, { type: "sine", volume: 0.1, delay: 0.12 });
				if (settledNow === 2) play?.tone(988, 0.22, { type: "sine", volume: 0.06, delay: 0.2 });
			}
			if (event.type === "paid") {
				paidAt.current = clock.current;
				coins.current = run.men.map((man, index) => ({ to: man.id, from: clock.current + 0.25 + index * COIN_GAP, at: index }));
				run.men.forEach((_, index) => {
					const delay = 0.25 + index * COIN_GAP + COIN_FLIGHT;
					play?.tone(2093, 0.18, { type: "sine", volume: 0.07, delay });
					play?.tone(3136, 0.12, { type: "sine", volume: 0.03, delay: delay + 0.02 });
				});
				[392, 493.88, 587.33].forEach((note, index) => play?.tone(note, 0.9, { type: "sine", volume: 0.07, delay: index * 0.05 }));
			}
			if (event.type === "next") {
				cursor.current = 0;
				coins.current = [];
				run.men.forEach((man, index) => drawn.current.set(man.id, { x: STAGE + 30 + index * 26, lift: 0 }));
				play?.noise(0.4, { volume: 0.04, filter: 500 });
			}
			if (event.type === "won") [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => play?.tone(note, 1.6, { type: "sine", volume: 0.08, delay: 1.1 + index * 0.12 }));
			if (event.type === "lost") play?.tone(147, 1.2, { type: "sine", volume: 0.12, to: 110 });
		}
		onTime(Math.max(0, LAST_SECONDS - run.t));
	}, [keys, onEnd, onTime, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			clock.current += dt;
			const now = clock.current;
			const count = run.men.length;
			const gap = spacing(count);
			const scale = Math.min(1, gap / 62);
			const paying = lastPaying(run) || run.phase === "won";
			const hours = lastHours(run);
			const target = lastTarget(hours);
			if (showCursor.current === null && typeof window !== "undefined") showCursor.current = !window.matchMedia("(pointer: coarse)").matches;

			const canvas = canvasRef.current;
			if (canvas && time - lastData.current > 0.03) {
				lastData.current = time;
				canvas.dataset.line = `${run.line},${count},${run.phase},${lastPaying(run) ? 1 : 0},${run.picked ?? -1},${cursor.current}`;
				canvas.dataset.hours = hours.join(",");
			}

			// The vineyard at even: the sun going down behind the hills.
			const sky = context.createLinearGradient(0, 0, 0, 200);
			sky.addColorStop(0, "#2b1d4a");
			sky.addColorStop(0.55, "#9b4a6c");
			sky.addColorStop(1, "#f1a35c");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, 200);
			const sun = context.createRadialGradient(318, 150, 4, 318, 150, 70);
			sun.addColorStop(0, "rgba(255,236,170,.95)");
			sun.addColorStop(0.25, "rgba(255,190,110,.5)");
			sun.addColorStop(1, "rgba(255,160,90,0)");
			context.fillStyle = sun;
			context.fillRect(240, 70, 160, 140);
			context.fillStyle = "#ffe2a0";
			context.beginPath();
			context.arc(318, 152, 17, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#5a3a5e";
			context.beginPath();
			context.moveTo(0, 168);
			context.quadraticCurveTo(110, 120, 230, 160);
			context.quadraticCurveTo(320, 138, 400, 156);
			context.lineTo(400, 210);
			context.lineTo(0, 210);
			context.fill();
			context.fillStyle = "#3e3a2c";
			context.beginPath();
			context.moveTo(0, 190);
			context.quadraticCurveTo(200, 160, 400, 186);
			context.lineTo(400, 222);
			context.lineTo(0, 222);
			context.fill();
			// Rows of vines on the hill, with grapes.
			for (let row = 0; row < 3; row++) {
				const y = 180 + row * 13;
				for (let x = 8 + (row % 2) * 14; x < STAGE; x += 28) {
					const yy = y - Math.sin((x / STAGE) * Math.PI) * (16 - row * 4);
					context.fillStyle = "#2c3a22";
					context.beginPath();
					context.ellipse(x, yy, 11, 5, 0, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = "#5b2f5c";
					context.beginPath();
					context.arc(x + 4, yy + 3, 2.2, 0, Math.PI * 2);
					context.arc(x - 3, yy + 3.5, 2, 0, Math.PI * 2);
					context.fill();
				}
			}
			// The ground before the steward, warm in the low sun.
			const ground = context.createLinearGradient(0, 214, 0, STAGE);
			ground.addColorStop(0, "#8a6040");
			ground.addColorStop(1, "#4a3122");
			context.fillStyle = ground;
			context.fillRect(0, 214, STAGE, STAGE - 214);
			context.fillStyle = "rgba(255,210,150,.08)";
			for (let i = 0; i < 9; i++) context.fillRect(0, 230 + i * 19, STAGE, 1);

			const won = run.phase === "won";
			// The line walks off once paid, at the end of the pay.
			const payEnd = run.payUntil ?? 0;
			const walkOff = lastPaying(run) ? Math.max(0, Math.min(1, 1 - (payEnd - run.t) / 0.35)) : 0;
			const inPlace = run.men.map((man, index) => man.hour === target[index]);

			// Ground marks: a warm patch under each man where he belongs.
			run.men.forEach((man, index) => {
				const x = xFor(index, count);
				if (inPlace[index]) {
					context.fillStyle = paying ? "rgba(255,220,130,.5)" : "rgba(255,214,120,.32)";
					context.beginPath();
					context.ellipse(x, LINE.foot + 2, gap * 0.42, 7, 0, 0, Math.PI * 2);
					context.fill();
				}
			});
			context.font = `800 11px ${SANS}`;
			context.textBaseline = "middle";
			context.fillStyle = "rgba(255,236,200,.7)";
			context.textAlign = "left";
			context.fillText("◀ front", LINE.left - 2, 380);
			context.textAlign = "right";
			context.fillText("back ▶", LINE.right - 2, 380);

			// The steward at the front of the line with the pennies.
			const sx = STEWARD.x;
			context.fillStyle = "rgba(0,0,0,.25)";
			context.beginPath();
			context.ellipse(sx, LINE.foot + 1, 18, 4.5, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#2f3f6b";
			context.beginPath();
			context.moveTo(sx - 10, LINE.foot - 60);
			context.lineTo(sx + 10, LINE.foot - 60);
			context.lineTo(sx + 17, LINE.foot);
			context.lineTo(sx - 17, LINE.foot);
			context.closePath();
			context.fill();
			context.fillStyle = "#e5b664";
			context.fillRect(sx - 13, LINE.foot - 34, 26, 4);
			context.fillStyle = "#b98a65";
			context.beginPath();
			context.arc(sx, LINE.foot - 69, 9, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#1f2a4a";
			context.beginPath();
			context.arc(sx, LINE.foot - 71, 9.6, Math.PI * 1.02, Math.PI * 1.98);
			context.lineTo(sx + 10, LINE.foot - 58);
			context.lineTo(sx - 10, LINE.foot - 58);
			context.closePath();
			context.fill();
			context.fillStyle = "#7a5230";
			context.beginPath();
			context.ellipse(STEWARD.hand.x - 4, STEWARD.hand.y + 6, 8, 10, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#5a3a20";
			context.fillRect(STEWARD.hand.x - 9, STEWARD.hand.y - 4, 10, 3);
			if (paying && !reducedMotion) drawPenny(context, STEWARD.hand.x + 2, STEWARD.hand.y - 6 - Math.abs(Math.sin(now * 6)) * 3, 5);

			// The labourers walk to their places; the one chosen is lifted.
			const order = run.men.map((man, index) => ({ man, index }));
			order.sort((a, b) => (a.index === run.picked ? 1 : 0) - (b.index === run.picked ? 1 : 0));
			for (const { man, index } of order) {
				const home = xFor(index, count) + walkOff * (STAGE + 60);
				const place = drawn.current.get(man.id) ?? { x: home, lift: 0 };
				const lift = run.picked === index ? 1 : 0;
				if (reducedMotion) {
					place.x = home;
					place.lift = lift;
				} else {
					place.x += (home - place.x) * Math.min(1, dt * 14);
					if (Math.abs(home - place.x) < 0.3) place.x = home;
					place.lift += (lift - place.lift) * Math.min(1, dt * 16);
				}
				drawn.current.set(man.id, place);
				const moving = Math.min(1, Math.abs(home - place.x) / 40);
				const hop = reducedMotion ? 0 : Math.abs(Math.sin(now * 14 + man.id)) * 5 * moving;
				const foot = LINE.foot - place.lift * 16 - hop;
				const bob = run.picked === index && !reducedMotion ? Math.sin(now * 7) * 1.5 : 0;
				drawMan(context, place.x, foot + bob, man.id, scale);
				const width = Math.min(58, gap - 5);
				drawSign(context, place.x + 4 * scale, foot + bob - 62 * scale - 22 - 58, width, man.hour, place.lift);
				const coin = coins.current.find((item) => item.to === man.id);
				if (coin && now >= coin.from + COIN_FLIGHT) drawPenny(context, place.x + 12 * scale, foot - 46 * scale, 5.5);
			}

			// The keyboard's cursor, and the swap waiting to be made.
			if (showCursor.current && run.phase === "playing" && !lastPaying(run)) {
				const x = xFor(cursor.current, count);
				const pulse = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(now * 6);
				context.fillStyle = `rgba(255,214,110,${pulse})`;
				context.beginPath();
				context.moveTo(x, LINE.foot + 6);
				context.lineTo(x - 9, LINE.foot + 18);
				context.lineTo(x + 9, LINE.foot + 18);
				context.closePath();
				context.fill();
				if (run.picked !== null && run.picked !== cursor.current) {
					const from = xFor(run.picked, count);
					context.strokeStyle = "rgba(255,226,150,.85)";
					context.lineWidth = 2.5;
					context.setLineDash([5, 5]);
					context.beginPath();
					context.moveTo(from, LINE.foot + 10);
					context.quadraticCurveTo((from + x) / 2, LINE.foot + 30, x, LINE.foot + 10);
					context.stroke();
					context.setLineDash([]);
				}
			}

			// Pennies flying from the steward's hand, beginning from the last unto the first.
			for (const coin of coins.current) {
				const age = now - coin.from;
				if (age < 0 || age >= COIN_FLIGHT) continue;
				const place = drawn.current.get(coin.to);
				if (!place) continue;
				const p = age / COIN_FLIGHT;
				const tx = place.x + 12 * scale;
				const ty = LINE.foot - 46 * scale;
				const x = STEWARD.hand.x + (tx - STEWARD.hand.x) * p;
				const y = STEWARD.hand.y + (ty - STEWARD.hand.y) * p - Math.sin(p * Math.PI) * 60;
				drawPenny(context, x, y, 5.5);
				if (p > 0.92 && !reducedMotion && sparks.current.length < 160) {
					for (let i = 0; i < 4; i++) sparks.current.push({ x: tx, y: ty, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 60, born: now, life: 0.4 + Math.random() * 0.3 });
				}
			}
			sparks.current = sparks.current.filter((spark) => now - spark.born < spark.life);
			for (const spark of sparks.current) {
				spark.x += spark.vx * dt;
				spark.y += spark.vy * dt;
				spark.vy += 160 * dt;
				context.fillStyle = `rgba(255,248,220,${1 - (now - spark.born) / spark.life})`;
				context.fillRect(spark.x - 1, spark.y - 1, 2.2, 2.2);
			}

			// The count, and the first line's reminder of the order.
			context.textBaseline = "middle";
			context.font = `900 14px ${SANS}`;
			context.textAlign = "left";
			context.fillStyle = "#fff4dc";
			context.fillText(`Line ${Math.min(run.line + 1, LAST_LINES.length)}/${LAST_LINES.length}`, 12, 20);
			const paidMen = run.lines.slice(0, run.paid).reduce((sum, line) => sum + line.length, 0);
			const total = run.lines.reduce((sum, line) => sum + line.length, 0);
			context.textAlign = "right";
			context.fillText(`${paidMen}/${total}`, STAGE - 12, 20);
			drawPenny(context, STAGE - 22 - context.measureText(`${paidMen}/${total}`).width, 20, 6);
			if (run.line === 0 && run.swaps === 0 && run.t < 3.5 && run.phase === "playing") {
				context.globalAlpha = Math.min(1, (3.5 - run.t) / 0.5);
				context.fillStyle = "rgba(30,18,40,.82)";
				context.beginPath();
				context.roundRect(70, 44, 260, 34, 17);
				context.fill();
				context.fillStyle = "#ffd98a";
				context.font = `900 15px ${SANS}`;
				context.textAlign = "center";
				context.fillText("◀ Eleventh hour to the front", 200, 61);
				context.globalAlpha = 1;
			}
			if (lastPaying(run) || (won && outro.current < 70)) {
				const since = now - paidAt.current;
				context.globalAlpha = Math.min(1, since / 0.25) * (lastPaying(run) ? Math.min(1, ((run.payUntil ?? 0) - run.t) / 0.25) : 1);
				context.fillStyle = "rgba(30,18,40,.7)";
				context.beginPath();
				context.roundRect(90, 46, 220, 36, 18);
				context.fill();
				context.fillStyle = "#fff1cf";
				context.font = `italic 700 19px ${SERIF}`;
				context.textAlign = "center";
				context.fillText("every man a penny", 200, 64);
				context.globalAlpha = 1;
			}
			if (won && outro.current >= 70) {
				context.globalAlpha = Math.min(1, (outro.current - 70) / 30);
				const glow = context.createRadialGradient(200, 90, 10, 200, 90, 220);
				glow.addColorStop(0, "rgba(255,226,160,.5)");
				glow.addColorStop(1, "rgba(255,226,160,0)");
				context.fillStyle = glow;
				context.fillRect(0, 0, STAGE, 220);
				context.fillStyle = "rgba(30,18,40,.72)";
				context.beginPath();
				context.roundRect(34, 50, 332, 76, 20);
				context.fill();
				context.fillStyle = "#ffe7b0";
				context.font = `italic 700 24px ${SERIF}`;
				context.textAlign = "center";
				context.fillText("So the last shall be first,", 200, 74);
				context.fillText("and the first last", 200, 106);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = `rgba(20,10,24,${Math.min(0.55, outro.current / 40)})`;
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = "#fff1dc";
				context.font = `800 20px ${SANS}`;
				context.textAlign = "center";
				context.fillText("The line was not yet in order", 200, 120);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		const point = stagePoint(canvas, event);
		const count = state.current.men.length;
		if (point.y < 120 || point.x < LINE.left || point.x >= LINE.right) return;
		const index = Math.floor((point.x - LINE.left) / spacing(count));
		if (index < 0 || index >= count) return;
		cursor.current = index;
		if (event.pointerType !== "mouse") showCursor.current = false;
		taps.current.push(index);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="The vineyard at even. A line of labourers stands before the steward, each holding up the sign of the hour he was hired. Put the line in order from the last unto the first, the eleventh hour at the front and the early at the back: tap one labourer and then another to swap them, or move with the left and right arrows and press Space on each."
		/>
	);
}
