"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	JORDAN_COUNT,
	JORDAN_DEPTH,
	JORDAN_RISE,
	JORDAN_SECONDS,
	JORDAN_WALK,
	jordanPenitent,
	jordanResult,
	newJordan,
	stepJordan,
	type JordanEvent,
	type JordanState,
	type Penitent,
} from "@/lib/beta/games/baptized-in-jordan-rules";

/**
 * Baptized in Jordan (LC-17908), Matthew 3:1-17. The river Jordan in the
 * wilderness of Judaea at morning, John in his raiment of camel's hair
 * standing in the water (v4), and the people coming down the bank to be
 * "baptized of him in Jordan, confessing their sins" (v6). Hold to lower each
 * back under the water, let go inside the band on the gauge beside them. When
 * all are baptized, Jesus comes from Galilee: he goes up straightway out of
 * the water, the heavens are opened and the Spirit descends like a dove and
 * lights upon him (vv13-16). He is a robed figure in light with no face;
 * the voice from heaven (v17) is only the light of the opened heavens.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, sans-serif";
/** The water's surface. */
const SURFACE = 262;
/** Where each is laid back: their hips, under the water. */
const PIVOT = { x: 214, y: 284 };
const TORSO = 60;
const JOHN_X = 168;
/** The queue down the far bank, the head of it first, and the hill above it where the baptized stand. */
const QUEUE = [
	{ x: 322, y: 228 },
	{ x: 346, y: 216 },
	{ x: 368, y: 207 },
	{ x: 388, y: 200 },
	{ x: 406, y: 195 },
];
const SHORE = { x: 300, y: 264 };
const FAR = (index: number) => ({ x: 298 + index * 21, y: 184 - (index % 2) * 3 });
const ROBES = ["#9a6b4a", "#5f7590", "#8a7a5c", "#6d5a7e", "#7f8d6a"];
/** The gauge beside them. */
const GAUGE = { x: 22, top: 84, bottom: 318, width: 22 };
const OUTRO_WON = 240;
const OUTRO_LOST = 60;

interface Drop {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	size: number;
	color: string;
}

interface Float {
	text: string;
	x: number;
	y: number;
	age: number;
	color: string;
}

const gaugeY = (depth: number) => GAUGE.top + ((GAUGE.bottom - GAUGE.top) * depth) / JORDAN_DEPTH;
const smooth = (value: number) => {
	const clamped = Math.max(0, Math.min(1, value));
	return clamped * clamped * (3 - 2 * clamped);
};

/** How far back a penitent is laid for a depth on the gauge: the head goes under the water just as the band begins. */
function leanFor(penitent: Penitent | null, depth: number): number {
	const low = penitent?.low ?? 58;
	const high = penitent?.high ?? 80;
	const under = (76 * Math.PI) / 180;
	const line = (88 * Math.PI) / 180;
	if (depth <= low) return (under * depth) / low;
	if (depth <= high) return under + ((line - under) * (depth - low)) / (high - low);
	return line + ((12 * Math.PI) / 180) * Math.min(1, (depth - high) / Math.max(1, JORDAN_DEPTH - high));
}

/** A robed figure standing, feet at (x, y): a long robe, a head cloth, no face. */
function robed(context: CanvasRenderingContext2D, x: number, y: number, scale: number, robe: string, sway = 0) {
	context.save();
	context.translate(x, y);
	context.scale(scale, scale);
	context.rotate(sway);
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(-11, 0);
	context.lineTo(-7, -34);
	context.quadraticCurveTo(0, -40, 7, -34);
	context.lineTo(11, 0);
	context.closePath();
	context.fill();
	context.fillStyle = "rgba(0,0,0,.18)";
	context.fillRect(-1, -34, 2, 34);
	context.fillStyle = "#c79a74";
	context.beginPath();
	context.arc(0, -42, 6, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e7dcc4";
	context.beginPath();
	context.arc(0, -43, 6.6, Math.PI * 0.95, Math.PI * 2.05);
	context.lineTo(6, -36);
	context.lineTo(-6, -36);
	context.fill();
	context.restore();
}

/** The one in the water, laid back by `lean` about their hips. */
function penitentInWater(context: CanvasRenderingContext2D, x: number, y: number, lean: number, robe: string, glow: number) {
	context.save();
	context.translate(x, y);
	// Legs, standing in the river.
	context.fillStyle = robe;
	context.fillRect(-10, 0, 20, 34);
	context.rotate(lean);
	if (glow > 0) {
		context.shadowColor = `rgba(255,240,190,${glow})`;
		context.shadowBlur = 24 * glow;
	}
	context.beginPath();
	context.moveTo(-12, 4);
	context.lineTo(-9, -TORSO + 16);
	context.quadraticCurveTo(0, -TORSO + 10, 9, -TORSO + 16);
	context.lineTo(12, 4);
	context.closePath();
	context.fill();
	context.shadowBlur = 0;
	// Hands folded on the breast, confessing.
	context.strokeStyle = "rgba(0,0,0,.25)";
	context.lineWidth = 3;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(-8, -26);
	context.lineTo(2, -32);
	context.moveTo(8, -26);
	context.lineTo(-2, -32);
	context.stroke();
	context.fillStyle = "#c79a74";
	context.beginPath();
	context.arc(0, -TORSO + 4, 8, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e7dcc4";
	context.beginPath();
	context.arc(0, -TORSO + 3, 8.6, Math.PI * 0.95, Math.PI * 2.05);
	context.lineTo(8, -TORSO + 12);
	context.lineTo(-8, -TORSO + 12);
	context.fill();
	context.restore();
}

/** Where the penitent's shoulders are, for John's hand. */
function shoulder(lean: number) {
	return { x: PIVOT.x + Math.sin(lean) * (TORSO - 22), y: PIVOT.y - Math.cos(lean) * (TORSO - 22) };
}

/** John: raiment of camel's hair, a leathern girdle about his loins (v4), standing in the river. */
function john(context: CanvasRenderingContext2D, hand: { x: number; y: number }, time: number, reducedMotion: boolean) {
	const x = JOHN_X;
	const breathe = reducedMotion ? 0 : Math.sin(time * 1.6) * 0.8;
	context.save();
	context.fillStyle = "#86592f";
	context.beginPath();
	context.moveTo(x - 17, 350);
	context.lineTo(x - 14, 206 + breathe);
	context.quadraticCurveTo(x, 196 + breathe, x + 14, 206 + breathe);
	context.lineTo(x + 18, 350);
	context.closePath();
	context.fill();
	// The rough hair of the raiment.
	context.strokeStyle = "rgba(60,36,14,.55)";
	context.lineWidth = 1.2;
	for (let i = 0; i < 26; i++) {
		const hx = x - 13 + ((i * 7.3) % 27);
		const hy = 212 + ((i * 13.7) % 120);
		context.beginPath();
		context.moveTo(hx, hy);
		context.lineTo(hx + 2, hy + 5);
		context.stroke();
	}
	context.fillStyle = "#4a2c14";
	context.fillRect(x - 16, 252, 33, 7);
	// His arm, laying the penitent back.
	context.strokeStyle = "#7a4f28";
	context.lineWidth = 7;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(x + 9, 218 + breathe);
	context.quadraticCurveTo((x + hand.x) / 2, Math.min(hand.y, 232) + 6, hand.x - 4, hand.y);
	context.stroke();
	// The other hand lifted.
	context.beginPath();
	context.moveTo(x - 9, 218 + breathe);
	context.lineTo(x - 22, 196 + breathe);
	context.stroke();
	// Head: hair and beard, no detail.
	context.fillStyle = "#b9875f";
	context.beginPath();
	context.arc(x, 190 + breathe, 10, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#3b2414";
	context.beginPath();
	context.arc(x, 187 + breathe, 11, Math.PI * 1.05, Math.PI * 1.95);
	context.lineTo(x + 9, 196 + breathe);
	context.quadraticCurveTo(x, 210 + breathe, x - 9, 196 + breathe);
	context.closePath();
	context.fill();
	context.restore();
}

/** Jesus: a robed figure in light, no face. */
function jesus(context: CanvasRenderingContext2D, x: number, y: number, lean: number, glow: number, inWater: boolean) {
	context.save();
	context.translate(x, y);
	const halo = context.createRadialGradient(0, -40, 4, 0, -40, 70);
	halo.addColorStop(0, `rgba(255,250,228,${0.55 * glow})`);
	halo.addColorStop(1, "rgba(255,250,228,0)");
	context.fillStyle = halo;
	context.fillRect(-80, -120, 160, 160);
	context.fillStyle = "#f6f1e2";
	if (inWater) context.fillRect(-10, 0, 20, 34);
	context.rotate(lean);
	context.shadowColor = "rgba(255,244,200,.95)";
	context.shadowBlur = 14 + 16 * glow;
	context.beginPath();
	context.moveTo(-12, inWater ? 4 : 34);
	context.lineTo(-9, -TORSO + 16);
	context.quadraticCurveTo(0, -TORSO + 10, 9, -TORSO + 16);
	context.lineTo(12, inWater ? 4 : 34);
	context.closePath();
	context.fill();
	context.fillStyle = "#fffaf0";
	context.beginPath();
	context.arc(0, -TORSO + 4, 8.4, 0, Math.PI * 2);
	context.fill();
	context.shadowBlur = 0;
	context.restore();
}

/** The Spirit descending like a dove (v16). */
function dove(context: CanvasRenderingContext2D, x: number, y: number, flap: number) {
	context.save();
	context.translate(x, y);
	context.shadowColor = "rgba(255,250,230,.95)";
	context.shadowBlur = 16;
	context.fillStyle = "#ffffff";
	context.beginPath();
	context.ellipse(0, 0, 10, 4.5, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.arc(8, -2, 3.4, 0, Math.PI * 2);
	context.fill();
	for (const side of [-1, 1]) {
		context.beginPath();
		context.moveTo(-3, -1);
		context.quadraticCurveTo(-6, -14 * flap * side - 4 * side, -18, -10 * flap * side - 2 * side);
		context.quadraticCurveTo(-8, -3 * side, 4, -1);
		context.closePath();
		context.fill();
	}
	context.beginPath();
	context.moveTo(-9, 0);
	context.lineTo(-16, -3);
	context.lineTo(-16, 3);
	context.closePath();
	context.fill();
	context.restore();
}

export default function BaptizedInJordan({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<JordanState>(newJordan(seed));
	/** Fingers (or the mouse) held on the picture: any one of them holds. */
	const pointers = useRef(new Set<number>());
	const drops = useRef<Drop[]>([]);
	const floats = useRef<Float[]>([]);
	const leaving = useRef<{ index: number; age: number }[]>([]);
	const glow = useRef(0);
	const releaseMark = useRef<{ depth: number; age: number; good: boolean } | null>(null);
	const outro = useRef(0);
	const ended = useRef(false);
	const lastTick = useRef(-1);
	const synth = useSynth(muted);

	const splash = useCallback((x: number, y: number, count: number, spread: number) => {
		for (let i = 0; i < count; i++) {
			const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * spread;
			const speed = 1.4 + Math.random() * 2.6;
			drops.current.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, size: 1.5 + Math.random() * 2.2, color: "rgba(226,246,255," });
		}
	}, []);
	const bubbles = useCallback((x: number, y: number, count: number) => {
		for (let i = 0; i < count; i++) {
			drops.current.push({ x: x + (Math.random() * 2 - 1) * 9, y: y + Math.random() * 10, vx: (Math.random() * 2 - 1) * 0.2, vy: -0.5 - Math.random() * 0.7, life: 1, size: 1.6 + Math.random() * 2.4, color: "bubble" });
		}
	}, []);

	const react = useCallback(
		(event: JordanEvent) => {
			const play = synth.current;
			const run = state.current;
			const head = { x: PIVOT.x + Math.sin(leanFor(jordanPenitent(run), run.released)) * (TORSO - 4), y: SURFACE };
			if (event.type === "come" && event.index > 0) leaving.current.push({ index: event.index - 1, age: 0 });
			if (event.type === "lower") play?.noise(0.35, { volume: 0.06, filter: 500 });
			if (event.type === "under") {
				play?.noise(0.25, { volume: 0.08, filter: 380 });
				bubbles(head.x + 18, SURFACE + 8, 4);
			}
			if (event.type === "baptized") {
				splash(head.x + 14, SURFACE, 26, 0.9);
				glow.current = 1;
				releaseMark.current = { depth: run.released, age: 0, good: true };
				floats.current.push({ text: event.accuracy > 0.8 ? "Baptized!" : "Baptized", x: PIVOT.x + 30, y: 168, age: 0, color: "#fff6d8" });
				if (play) {
					play.noise(0.5, { volume: 0.22, filter: 2200 });
					const root = [392, 440, 494, 523, 587][event.index] ?? 392;
					[1, 1.25, 1.5, 2].forEach((ratio, i) => play.tone(root * ratio, 1.1, { type: "sine", volume: 0.09, delay: 0.05 + i * 0.05 }));
				}
			}
			if (event.type === "short") {
				splash(head.x + 8, SURFACE, 8, 0.6);
				releaseMark.current = { depth: run.released, age: 0, good: false };
				floats.current.push({ text: "Not under", x: PIVOT.x + 30, y: 168, age: 0, color: "#e8f3ff" });
				play?.tone(330, 0.18, { type: "sine", volume: 0.09, to: 294 });
			}
			if (event.type === "long") {
				bubbles(head.x + 18, SURFACE + 14, 14);
				releaseMark.current = { depth: run.released, age: 0, good: false };
				floats.current.push({ text: "Too long", x: PIVOT.x + 30, y: 168, age: 0, color: "#e8f3ff" });
				play?.noise(0.4, { volume: 0.1, filter: 420 });
				play?.tone(262, 0.35, { type: "sine", volume: 0.08, to: 220 });
			}
			if (event.type === "lost") play?.tone(196, 1.2, { type: "sine", volume: 0.12, to: 165 });
		},
		[bubbles, splash, synth],
	);

	const advanceEffects = useCallback(() => {
		for (const drop of drops.current) {
			if (drop.color === "bubble") {
				drop.x += drop.vx;
				drop.y += drop.vy;
				if (drop.y < SURFACE) drop.life = 0;
				drop.life -= 0.006;
			} else {
				drop.x += drop.vx;
				drop.y += drop.vy;
				drop.vy += 0.12;
				drop.life -= drop.y > SURFACE + 2 ? 0.2 : 0.018;
			}
		}
		drops.current = drops.current.filter((drop) => drop.life > 0);
		for (const float of floats.current) float.age += 1 / 60;
		floats.current = floats.current.filter((float) => float.age < 1.1);
		for (const leaver of leaving.current) leaver.age += 1 / 60;
		glow.current = Math.max(0, glow.current - 1 / 50);
		if (releaseMark.current) {
			releaseMark.current.age += 1 / 60;
			if (releaseMark.current.age > 1.4) releaseMark.current = null;
		}
	}, []);

	const step = useCallback(() => {
		const run = state.current;
		advanceEffects();
		const canvas = canvasRef.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			const f = outro.current;
			const play = synth.current;
			if (run.phase === "won" && play) {
				if (f === 100) play.noise(0.6, { volume: 0.14, filter: 1600 });
				if (f === 128) [262, 330, 392, 523, 659, 784].forEach((note, i) => play.tone(note, 2.6, { type: "sine", volume: 0.07, delay: i * 0.08 }));
				if (f === 196) [523, 659, 784, 1047].forEach((note, i) => play.tone(note, 1.6, { type: "triangle", volume: 0.05, delay: i * 0.06 }));
			}
			if (run.phase === "won" && f === 110) splash(PIVOT.x + 30, SURFACE, 30, 0.9);
			if (run.phase === "won" && f === 26) leaving.current.push({ index: JORDAN_COUNT - 1, age: 0 });
			if (canvas) canvas.dataset.jordan = `${run.index},${run.stage},0,0,0,${run.phase},0,0,0,${run.t.toFixed(3)}`;
			if (f >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = jordanResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		keys.presses.length = 0;
		const hold = pointers.current.size > 0 || keys.held.has(" ");
		const events: JordanEvent[] = [];
		stepJordan(run, { hold }, events);
		for (const event of events) react(event);
		const play = synth.current;
		const penitent = jordanPenitent(run);
		// The meter's voice: a soft tick rising with the depth while held.
		if (play && run.stage === "lower" && run.tick % 6 === 0) play.tone(180 + run.depth * 5, 0.05, { type: "triangle", volume: 0.035 });
		if (run.stage === "lower" && penitent && run.depth >= penitent.low && run.tick % 9 === 0) bubbles(PIVOT.x + 40, SURFACE + 12, 1);
		if (play && Math.floor(run.t * 0.5) !== Math.floor((run.t - 1 / 60) * 0.5)) play.noise(1.8, { volume: 0.025, filter: 700 });
		if (canvas && run.tick !== lastTick.current) {
			lastTick.current = run.tick;
			canvas.dataset.jordan = penitent
				? `${run.index},${run.stage},${run.depth.toFixed(2)},${penitent.low},${penitent.high},${run.phase},${penitent.pace.toFixed(3)},${penitent.surge.toFixed(4)},${run.held.toFixed(4)},${run.t.toFixed(3)}`
				: `${run.index},${run.stage},0,0,0,${run.phase},0,0,0,${run.t.toFixed(3)}`;
			canvas.dataset.baptized = String(run.accuracy.length);
		}
		onTime(Math.max(0, JORDAN_SECONDS - run.t));
	}, [advanceEffects, bubbles, keys, onEnd, onTime, react, splash, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const won = run.phase === "won";
			const f = outro.current;
			const penitent = jordanPenitent(run) ?? run.penitents[JORDAN_COUNT - 1];
			const opened = won ? smooth((f - 120) / 50) : 0;

			context.fillStyle = "#b48652";
			context.fillRect(0, 0, STAGE, STAGE);
			// The sky over the wilderness at morning, and the heavens opened at the end.
			const sky = context.createLinearGradient(0, 0, 0, 170);
			sky.addColorStop(0, "#5f8fbf");
			sky.addColorStop(0.6, "#b9cbd3");
			sky.addColorStop(1, "#efd9ad");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, 180);
			if (opened > 0) {
				const rift = context.createRadialGradient(200, 0, 4, 200, 0, 40 + 230 * opened);
				rift.addColorStop(0, `rgba(255,255,248,${opened})`);
				rift.addColorStop(0.35, `rgba(255,240,196,${0.8 * opened})`);
				rift.addColorStop(1, "rgba(255,226,160,0)");
				context.fillStyle = rift;
				context.fillRect(0, 0, STAGE, STAGE);
			}
			// The hills of Judaea.
			context.fillStyle = "#c9a571";
			context.beginPath();
			context.moveTo(0, 150);
			for (let x = 0; x <= STAGE; x += 20) context.lineTo(x, 132 + Math.sin(x / 47) * 10 + Math.sin(x / 19) * 4);
			context.lineTo(STAGE, 190);
			context.lineTo(0, 190);
			context.fill();
			context.fillStyle = "#b48652";
			context.beginPath();
			context.moveTo(0, 168);
			for (let x = 0; x <= STAGE; x += 20) context.lineTo(x, 156 + Math.sin(x / 31 + 2) * 8);
			context.lineTo(STAGE, 240);
			context.lineTo(0, 240);
			context.fill();

			// The river Jordan.
			const river = context.createLinearGradient(0, SURFACE - 30, 0, STAGE);
			river.addColorStop(0, "#4c97a3");
			river.addColorStop(1, "#173f58");
			context.fillStyle = river;
			context.fillRect(0, SURFACE - 30, STAGE, STAGE);
			// The near bank, sloping down to the water, and the far bank.
			context.fillStyle = "#d9b77d";
			context.beginPath();
			context.moveTo(0, 186);
			context.quadraticCurveTo(70, 200, 122, SURFACE + 2);
			context.lineTo(0, SURFACE + 2);
			context.closePath();
			context.fill();
			context.beginPath();
			context.moveTo(STAGE, 182);
			context.lineTo(280, 186);
			context.quadraticCurveTo(318, 210, 290, SURFACE + 2);
			context.lineTo(STAGE, SURFACE + 2);
			context.closePath();
			context.fill();
			context.fillStyle = "rgba(120,84,40,.25)";
			for (let i = 0; i < 16; i++) context.fillRect(300 + ((i * 53) % 96), 200 + ((i * 31) % 56), 6, 2);
			// Reeds at the water's edge.
			context.strokeStyle = "#6f8a45";
			context.lineWidth = 2;
			for (let i = 0; i < 9; i++) {
				const rx = i < 5 ? 100 + i * 6 : 254 + i * 7;
				const bend = reducedMotion ? 0 : Math.sin(time * 1.3 + i) * 2;
				context.beginPath();
				context.moveTo(rx, SURFACE + 2);
				context.quadraticCurveTo(rx + bend, SURFACE - 14, rx + bend * 2 + 2, SURFACE - 26 - (i % 3) * 5);
				context.stroke();
			}

			// Those already baptized, on the hill above the far bank, and the people waiting their turn down it.
			const standing = run.accuracy.length - leaving.current.filter((leaver) => leaver.age < 0.9).length - (won && f < 26 ? 1 : 0);
			for (let i = 0; i < Math.max(0, standing); i++) {
				const spot = FAR(i);
				const aura = context.createRadialGradient(spot.x, spot.y - 22, 2, spot.x, spot.y - 22, 26);
				aura.addColorStop(0, "rgba(255,248,214,.45)");
				aura.addColorStop(1, "rgba(255,248,214,0)");
				context.fillStyle = aura;
				context.fillRect(spot.x - 30, spot.y - 50, 60, 60);
				robed(context, spot.x, spot.y, 0.62, ROBES[i % ROBES.length]);
			}
			for (const leaver of leaving.current) {
				if (leaver.age >= 0.9) continue;
				const k = smooth(leaver.age / 0.9);
				const target = FAR(leaver.index);
				robed(context, PIVOT.x + (target.x - PIVOT.x) * k, PIVOT.y + 34 + (target.y - PIVOT.y - 34) * k, 1 - 0.38 * k, ROBES[leaver.index % ROBES.length]);
			}

			const waiting = won ? 0 : Math.max(0, JORDAN_COUNT - run.index - 1);
			for (let i = 0; i < waiting; i++) {
				const spot = QUEUE[i];
				robed(context, spot.x, spot.y, 0.82, ROBES[(run.index + 1 + i) % ROBES.length], reducedMotion ? 0 : Math.sin(time * 1.4 + i) * 0.03);
			}

			// Who is in the water: coming down, laid back, or raised.
			let lean = 0;
			let figure = { x: PIVOT.x, y: PIVOT.y };
			let inWater = true;
			if (!won && run.stage === "walk") {
				const k = run.stageT / JORDAN_WALK;
				const from = QUEUE[0];
				if (k < 0.55) {
					const a = smooth(k / 0.55);
					figure = { x: from.x + (SHORE.x - from.x) * a, y: from.y + (SHORE.y - from.y) * a };
				} else {
					const a = smooth((k - 0.55) / 0.45);
					figure = { x: SHORE.x + (PIVOT.x - SHORE.x) * a, y: SHORE.y + (PIVOT.y + 34 - SHORE.y) * a };
				}
				inWater = false;
			} else if (!won) lean = leanFor(penitent, run.depth);
			else lean = leanFor(penitent, Math.max(0, run.released * (1 - f / (JORDAN_RISE * 60))));
			const robe = ROBES[Math.min(run.index, JORDAN_COUNT - 1) % ROBES.length];

			// Jesus comes from Galilee, is baptized and goes up straightway out of the water.
			const comes = won ? smooth((f - 40) / 50) : 0;
			let jesusLean = 0;
			if (won && f >= 92 && f < 112) jesusLean = (80 * Math.PI) / 180 * Math.sin(((f - 92) / 20) * (Math.PI / 2));
			else if (won && f >= 112 && f < 124) jesusLean = (80 * Math.PI) / 180 * (1 - (f - 112) / 12);
			const hand = won && f >= 40 ? shoulder(jesusLean) : shoulder(inWater ? lean : 0);

			if (!(won && f >= 26)) {
				if (inWater) penitentInWater(context, figure.x, figure.y, lean, robe, glow.current);
				else robed(context, figure.x, figure.y, 1, robe);
			}
			john(context, inWater || (won && f >= 40) ? hand : { x: JOHN_X + 30, y: 236 }, time, reducedMotion);
			if (won && f >= 40) {
				const from = QUEUE[0];
				if (comes < 1) {
					const a = comes;
					const point = a < 0.55
						? { x: from.x + (SHORE.x - from.x) * (a / 0.55), y: from.y + (SHORE.y - from.y) * (a / 0.55) }
						: { x: SHORE.x + (PIVOT.x - SHORE.x) * ((a - 0.55) / 0.45), y: SHORE.y + (PIVOT.y - SHORE.y) * ((a - 0.55) / 0.45) };
					jesus(context, point.x, point.y, 0, 0.5, a >= 0.55);
				} else jesus(context, PIVOT.x, PIVOT.y, jesusLean, 0.5 + opened * 0.5, true);
			}

			// The water over all that is under it.
			context.fillStyle = "rgba(38,104,124,.56)";
			context.fillRect(0, SURFACE, STAGE, STAGE - SURFACE);
			context.strokeStyle = "rgba(220,244,250,.55)";
			context.lineWidth = 1.6;
			for (let row = 0; row < 6; row++) {
				const y = SURFACE + 3 + row * 22;
				const drift = reducedMotion ? 0 : time * (14 + row * 3);
				context.beginPath();
				for (let x = -20; x <= STAGE + 20; x += 8) {
					const wave = Math.sin((x + drift) / 18 + row) * 1.6;
					if (x === -20) context.moveTo(x, y + wave);
					else context.lineTo(x, y + wave);
				}
				context.globalAlpha = row === 0 ? 1 : 0.35;
				context.stroke();
			}
			context.globalAlpha = 1;
			// Rings on the water around them.
			const ring = reducedMotion ? 0.5 : (time * 0.8) % 1;
			context.strokeStyle = `rgba(230,248,255,${0.4 * (1 - ring)})`;
			context.lineWidth = 1.4;
			context.beginPath();
			context.ellipse(PIVOT.x + 20, SURFACE + 2, 40 + ring * 30, 5 + ring * 3, 0, 0, Math.PI * 2);
			context.stroke();

			// Splashes and bubbles.
			for (const drop of drops.current) {
				if (drop.color === "bubble") {
					context.strokeStyle = `rgba(230,250,255,${Math.min(1, drop.life * 1.5) * 0.85})`;
					context.lineWidth = 1.2;
					context.beginPath();
					context.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
					context.stroke();
				} else {
					context.fillStyle = `${drop.color}${Math.max(0, drop.life).toFixed(2)})`;
					context.beginPath();
					context.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
					context.fill();
				}
			}
			// Light on the one just baptized.
			if (glow.current > 0) {
				const light = context.createLinearGradient(0, 0, 0, SURFACE);
				light.addColorStop(0, "rgba(255,246,214,0)");
				light.addColorStop(1, `rgba(255,246,214,${0.4 * glow.current})`);
				context.fillStyle = light;
				context.fillRect(PIVOT.x - 30, 0, 60, SURFACE + 10);
			}

			// The heavens opened: rays on him, and the dove descending to light upon him.
			if (opened > 0) {
				context.save();
				context.globalAlpha = opened * 0.5;
				context.fillStyle = "#fff6d8";
				for (let i = -3; i <= 3; i++) {
					context.beginPath();
					context.moveTo(200 + i * 6, 0);
					context.lineTo(PIVOT.x + i * 18 - 8, SURFACE);
					context.lineTo(PIVOT.x + i * 18 + 8, SURFACE);
					context.closePath();
					context.fill();
				}
				context.restore();
			}
			if (won && f >= 150) {
				const k = smooth((f - 150) / 52);
				const flap = reducedMotion ? 0.5 : Math.sin(time * (k < 1 ? 9 : 3)) * 0.5 + 0.5;
				dove(context, 200 + (PIVOT.x - 200) * k + (reducedMotion ? 0 : Math.sin(k * Math.PI * 2) * 14 * (1 - k)), 14 + (PIVOT.y - TORSO - 28 - 14) * k, flap * (1 - 0.6 * k) + 0.2);
			}

			// The gauge beside them: under the water from the band's top, too long at its line.
			if (!won && run.phase !== "lost") {
				const top = GAUGE.top;
				const bottom = GAUGE.bottom;
				context.fillStyle = "rgba(14,26,34,.72)";
				context.beginPath();
				context.roundRect(GAUGE.x - 10, top - 26, 98, bottom - top + 40, 12);
				context.fill();
				context.fillStyle = "#e8d2a0";
				context.font = `800 11px ${SANS}`;
				context.textAlign = "left";
				context.fillText("DEPTH", GAUGE.x - 2, top - 10);
				context.fillStyle = "rgba(232,210,160,.25)";
				context.fillRect(GAUGE.x, top, GAUGE.width, gaugeY(penitent.low) - top);
				const bandTop = gaugeY(penitent.low);
				const bandBottom = gaugeY(penitent.high);
				const band = context.createLinearGradient(0, bandTop, 0, bandBottom);
				band.addColorStop(0, "#5fd0e8");
				band.addColorStop(0.5, "#b8f1ff");
				band.addColorStop(1, "#5fd0e8");
				context.fillStyle = band;
				context.fillRect(GAUGE.x, bandTop, GAUGE.width, bandBottom - bandTop);
				context.fillStyle = "rgba(10,18,26,.85)";
				context.fillRect(GAUGE.x, bandBottom, GAUGE.width, bottom - bandBottom);
				context.strokeStyle = "rgba(255,255,255,.6)";
				context.lineWidth = 1;
				context.strokeRect(GAUGE.x + 0.5, top + 0.5, GAUGE.width - 1, bottom - top - 1);
				// The band's centre.
				context.strokeStyle = "rgba(255,255,255,.9)";
				context.setLineDash([3, 3]);
				context.beginPath();
				context.moveTo(GAUGE.x, (bandTop + bandBottom) / 2);
				context.lineTo(GAUGE.x + GAUGE.width, (bandTop + bandBottom) / 2);
				context.stroke();
				context.setLineDash([]);
				// The line not to pass.
				context.strokeStyle = "#ffb15e";
				context.lineWidth = 3;
				context.beginPath();
				context.moveTo(GAUGE.x - 6, bandBottom);
				context.lineTo(GAUGE.x + GAUGE.width + 6, bandBottom);
				context.stroke();
				context.font = `800 12px ${SANS}`;
				context.fillStyle = "#b8f1ff";
				context.fillText("Under", GAUGE.x + GAUGE.width + 8, (bandTop + bandBottom) / 2 + 4);
				context.fillStyle = "#ffcf94";
				context.fillText("Too long", GAUGE.x + GAUGE.width + 8, bandBottom + 15);
				// Where you let go last.
				const mark = releaseMark.current;
				if (mark) {
					context.globalAlpha = Math.max(0, 1 - mark.age / 1.4);
					context.fillStyle = mark.good ? "#fff1b8" : "#ffd0d0";
					context.fillRect(GAUGE.x - 4, gaugeY(Math.min(JORDAN_DEPTH, mark.depth)) - 1.5, GAUGE.width + 8, 3);
					context.globalAlpha = 1;
				}
				// The depth now.
				const now = gaugeY(Math.min(JORDAN_DEPTH, run.depth));
				const inBand = run.depth >= penitent.low && run.depth < penitent.high;
				context.fillStyle = inBand ? "#ffffff" : "#f3e6c4";
				context.fillRect(GAUGE.x - 3, now - 2, GAUGE.width + 6, 4);
				context.beginPath();
				context.moveTo(GAUGE.x - 4, now);
				context.lineTo(GAUGE.x - 14, now - 7);
				context.lineTo(GAUGE.x - 14, now + 7);
				context.closePath();
				context.fill();
			}

			// Words that drift up from the water.
			for (const float of floats.current) {
				context.globalAlpha = Math.max(0, 1 - float.age / 1.1);
				context.fillStyle = "rgba(14,26,34,.55)";
				context.font = `800 17px ${SANS}`;
				context.textAlign = "center";
				const y = float.y - (reducedMotion ? 0 : float.age * 18);
				const width = context.measureText(float.text).width + 20;
				context.beginPath();
				context.roundRect(float.x - width / 2, y - 18, width, 26, 13);
				context.fill();
				context.fillStyle = float.color;
				context.fillText(float.text, float.x, y);
			}
			context.globalAlpha = 1;

			// Baptized so far.
			if (!won) {
				context.fillStyle = "rgba(14,26,34,.66)";
				context.beginPath();
				context.roundRect(10, 10, 138, 30, 15);
				context.fill();
				context.fillStyle = "#fff1c4";
				context.font = `800 15px ${SANS}`;
				context.textAlign = "left";
				context.fillText(`Baptized ${run.accuracy.length}/${JORDAN_COUNT}`, 22, 30);
				for (let i = 0; i < run.misses && i < 6; i++) {
					context.strokeStyle = "rgba(220,240,255,.8)";
					context.lineWidth = 1.4;
					context.beginPath();
					context.arc(160 + i * 12, 25, 4, 0, Math.PI * 2);
					context.stroke();
				}
				if (run.index === 0 && run.stage !== "lower" && run.t < 3 && run.misses === 0) {
					context.fillStyle = `rgba(255,248,226,${reducedMotion ? 0.95 : 0.75 + 0.25 * Math.sin(time * 6)})`;
					context.font = `800 15px ${SANS}`;
					context.textAlign = "center";
					context.fillText("Hold, then let go in the band", 246, 64);
				}
			}

			// The closing scene's words, from Matthew 3:13 and 3:16.
			if (won && f > 14) {
				const lines = f < 120 ? ["Then cometh Jesus from Galilee", "to Jordan unto John"] : ["and, lo, the heavens", "were opened unto him"];
				const fade = f < 120 ? smooth((f - 14) / 18) * (f > 108 ? 1 - smooth((f - 108) / 12) : 1) : smooth((f - 122) / 18);
				context.globalAlpha = fade;
				context.fillStyle = "rgba(255,250,236,.88)";
				context.beginPath();
				context.roundRect(40, 72, 320, 58, 14);
				context.fill();
				context.fillStyle = "#3a2508";
				context.font = `italic 700 18px ${SERIF}`;
				context.textAlign = "center";
				context.fillText(lines[0], 200, 96);
				context.fillText(lines[1], 200, 120);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(10,18,26,.5)";
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = "#f1eadc";
				context.font = `800 20px ${SANS}`;
				context.textAlign = "center";
				context.fillText(`Baptized ${run.accuracy.length} of ${JORDAN_COUNT}`, 200, 196);
				context.font = `600 15px ${SANS}`;
				context.fillText("Let go in the band, before the line", 200, 222);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const press = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused) return;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		pointers.current.add(event.pointerId);
	};
	const release = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		pointers.current.delete(event.pointerId);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={press}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="The river Jordan in the wilderness, John the Baptist standing in the water, and people coming down the bank one by one. Hold Space, or hold a finger or the mouse on the picture, to lower each one back under the water; let go when the marker on the depth gauge is in the band, under the water and before the line. When all five are baptized, Jesus comes to be baptized and the heavens are opened."
		/>
	);
}
