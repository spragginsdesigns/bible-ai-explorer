"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	BED_LIMIT,
	BED_SECONDS,
	BED_STUMBLES,
	BED_WALK_TICKS,
	BED_WARN,
	bedAlong,
	bedComing,
	bedResult,
	newBed,
	stepBed,
	type BedBump,
	type BedEvent,
	type BedState,
} from "@/lib/beta/games/take-up-thy-bed-rules";

/**
 * Take Up Thy Bed (LC-17908), Matthew 9:2-8. A street of his own city (9:1)
 * by the sea, side on, in the warm afternoon: four bearers carry the man
 * sick of the palsy on his bed toward Jesus, a simple robed figure in light
 * at the far end. The bed balances: once it leans it leans further, so hold
 * ← or → (or the left or right half of the stage) to lean it back, and ease
 * off before it swings past level. Each rough place in the road glows, with
 * the way it will tip the bed, a moment before the front bearer meets it.
 * Past the limit they stumble and stop to steady it; three stumbles lose.
 * At Jesus the man arises, takes up his bed and departs to his house, and
 * the multitude glorifies God.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const GROUND = 322;
const BED_X = 168;
const BED_Y = 198;
const HALF = 84;
/** The bearers' hands, along the bed from its middle. */
const GRIP = 64;
const FRONT_X = BED_X + GRIP;
/** Stage units of street from the first step to Jesus. */
const ROAD = 900;
const JESUS_GAP = 64;
const OUTRO_WON = 170;
const OUTRO_LOST = 60;
const HINT_TICKS = 110;
const DEG = Math.PI / 180;

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const ease = (value: number) => {
	const x = clamp(value);
	return x * x * (3 - 2 * x);
};

/** Where a walked tick lies on the street, in stage units, for the front bearer. */
function streetX(run: BedState, at: number) {
	return FRONT_X + ((at - run.walked) / BED_WALK_TICKS) * ROAD;
}

/** A plain robed figure, feet at (x, y), facing right (or left): no face, a head cloth falling behind. */
function figure(context: CanvasRenderingContext2D, x: number, y: number, height: number, robe: string, cloth: string, stride = 0, facing = 1) {
	const w = height * 0.17;
	const neck = y - height * 0.72;
	const head = y - height * 0.83;
	const r = height * 0.095;
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - w - stride, y);
	context.lineTo(x - w * 0.6, neck);
	context.quadraticCurveTo(x, neck - height * 0.03, x + w * 0.6, neck);
	context.lineTo(x + w + stride, y);
	context.closePath();
	context.fill();
	// A girdle, and the hem's shadow.
	context.fillStyle = "rgba(0,0,0,.18)";
	context.fillRect(x - w * 0.8, y - height * 0.42, w * 1.6, height * 0.035);
	context.fillRect(x - w - stride, y - 3, (w + stride) * 2, 3);
	context.fillStyle = "#b07c55";
	context.beginPath();
	context.arc(x + facing * r * 0.15, head, r, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = cloth;
	context.beginPath();
	context.arc(x, head - r * 0.1, r * 1.12, Math.PI, Math.PI * 2);
	context.lineTo(x - facing * r * 0.2 + (facing > 0 ? 0 : 0), head);
	context.lineTo(x - facing * r * 1.1, neck + height * 0.02);
	context.lineTo(x - facing * r * 1.25, head - r * 0.1);
	context.closePath();
	context.fill();
	context.fillRect(x - r * 1.12, head - r * 0.25, r * 2.24, r * 0.3);
}

/** A curved arrow over one end of the bed: the way the coming jolt will tip it. */
function tipArrow(context: CanvasRenderingContext2D, x: number, y: number, down: "front" | "back", alpha: number) {
	context.save();
	context.globalAlpha = alpha;
	context.translate(x, y);
	if (down === "back") context.scale(-1, 1);
	const from = -70 * (Math.PI / 180);
	const to = 15 * (Math.PI / 180);
	context.strokeStyle = "#ff6a2c";
	context.fillStyle = "#ff6a2c";
	context.lineWidth = 5;
	context.lineCap = "round";
	context.beginPath();
	context.arc(-30, 0, 30, from, to);
	context.stroke();
	const px = -30 + Math.cos(to) * 30;
	const py = Math.sin(to) * 30;
	const tx = -Math.sin(to);
	const ty = Math.cos(to);
	context.beginPath();
	context.moveTo(px + tx * 12, py + ty * 12);
	context.lineTo(px + Math.cos(to) * 8, py + Math.sin(to) * 8);
	context.lineTo(px - Math.cos(to) * 8, py - Math.sin(to) * 8);
	context.closePath();
	context.fill();
	context.restore();
}

export default function TakeUpThyBed({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<BedState>(newBed(seed));
	const pointers = useRef(new Map<number, number>());
	const ended = useRef(false);
	const outro = useRef(0);
	const lean = useRef(0);
	const stumbleAt = useRef(-99);
	const joltAt = useRef(-99);
	const shake = useRef(0);
	const dust = useRef<{ x: number; y: number; vx: number; vy: number; age: number; life: number }[]>([]);
	const lastFrame = useRef(0);
	const lastStep = useRef(-1);
	const synth = useSynth(muted);

	const puff = useCallback((x: number, count: number) => {
		for (let i = 0; i < count; i++) {
			dust.current.push({ x: x + (Math.random() - 0.5) * 16, y: GROUND - 2, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, age: 0, life: 0.5 + Math.random() * 0.4 });
		}
		if (dust.current.length > 120) dust.current.splice(0, dust.current.length - 120);
	}, []);

	const sound = useCallback(
		(event: BedEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "warn") play.tone(event.kick > 0 ? 660 : 520, 0.09, { type: "triangle", volume: 0.07, to: event.kick > 0 ? 480 : 700 });
			if (event.type === "jolt") {
				if (event.kind === "press") play.noise(0.28, { volume: 0.16, filter: 700, type: "bandpass" });
				else play.noise(0.18, { volume: 0.32, filter: 240 });
				play.tone(150, 0.16, { type: "sine", volume: 0.14, to: 90 });
				play.tone(330, 0.12, { type: "triangle", volume: 0.04, delay: 0.05, to: 290 });
			}
			if (event.type === "stumble") {
				play.noise(0.5, { volume: 0.34, filter: 200 });
				play.tone(196, 0.5, { type: "sine", volume: 0.12, to: 147 });
			}
			if (event.type === "steady") play.tone(392, 0.25, { type: "sine", volume: 0.07 });
			if (event.type === "arrived") [262, 330, 392, 523, 659, 784].forEach((note, index) => play.tone(note, 2.4, { type: "sine", volume: 0.1, delay: 0.2 + index * 0.12 }));
			if (event.type === "lost") play.tone(147, 1.2, { type: "sine", volume: 0.14, to: 110 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current === 90 && run.phase === "won") synth.current?.tone(523, 2, { type: "sine", volume: 0.08 });
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = bedResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		keys.presses.length = 0;
		let dir = (keys.held.has("arrowright") ? 1 : 0) - (keys.held.has("arrowleft") ? 1 : 0);
		if (pointers.current.size) {
			let touch = 0;
			for (const side of pointers.current.values()) touch += side;
			dir = Math.sign(dir + Math.sign(touch));
		}
		lean.current = dir;
		const events: BedEvent[] = [];
		stepBed(run, { dir }, events);
		for (const event of events) {
			sound(event);
			if (event.type === "jolt") {
				joltAt.current = run.tick;
				shake.current = Math.max(shake.current, event.kind === "press" ? 0.5 : 1);
				if (event.kind !== "press") puff(FRONT_X, 10);
			}
			if (event.type === "stumble") {
				stumbleAt.current = run.tick;
				shake.current = 1.4;
				puff(BED_X - GRIP, 12);
				puff(FRONT_X, 12);
			}
		}
		// Footfalls while they walk, and the bed creaking near its limit.
		const play = synth.current;
		if (play && run.phase === "playing" && run.stopped === 0) {
			const pace = Math.floor(run.walked / 19);
			if (pace !== lastStep.current) {
				lastStep.current = pace;
				play.noise(0.07, { volume: 0.07, filter: 380 });
			}
			if (Math.abs(run.tilt) > BED_LIMIT * 0.62 && run.tick % 14 === 0) play.tone(210 + Math.abs(run.tilt) * 6, 0.09, { type: "sawtooth", volume: 0.025, to: 180 });
		}
		onTime(Math.max(0, BED_SECONDS - run.tick / 60));
		const canvas = canvasRef.current;
		if (canvas) {
			const coming = bedComing(run);
			canvas.dataset.bed = `${run.tilt.toFixed(1)},${run.swing.toFixed(0)},${run.walked},${run.stumbles},${run.stopped > 0 ? 1 : 0},${run.phase}`;
			canvas.dataset.coming = coming ? `${coming.kind},${Math.round(coming.kick)},${coming.at - run.walked}` : "";
		}
	}, [keys, onEnd, onTime, puff, sound, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const won = run.phase === "won";
			const lost = run.phase === "lost";
			const out = outro.current;
			const motion = reducedMotion ? 0 : 1;
			const scroll = bedAlong(run) * ROAD;
			const walking = run.phase === "playing" && run.stopped === 0 && !paused;
			const stride = walking ? Math.sin(run.walked * (Math.PI / 19)) : 0;

			context.save();
			if (shake.current > 0 && motion) context.translate(Math.sin(time * 47) * 3 * shake.current, Math.cos(time * 39) * 2 * shake.current);
			shake.current = Math.max(0, shake.current - dt * 3);

			// The sky over the sea of Galilee, warm afternoon.
			const sky = context.createLinearGradient(0, 0, 0, 240);
			sky.addColorStop(0, "#f2c58c");
			sky.addColorStop(1, "#fbe7c2");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 260);
			const sun = context.createRadialGradient(330, 70, 4, 330, 70, 90);
			sun.addColorStop(0, "rgba(255,250,228,.95)");
			sun.addColorStop(1, "rgba(255,240,200,0)");
			context.fillStyle = sun;
			context.fillRect(230, -10, 180, 180);
			// The far hills and a strip of the sea.
			context.fillStyle = "#c79f7e";
			context.beginPath();
			context.moveTo(-10, 200);
			for (let x = -10; x <= STAGE + 10; x += 20) context.lineTo(x, 182 + Math.sin((x + scroll * 0.06) * 0.018) * 10 + Math.sin(x * 0.05) * 3);
			context.lineTo(STAGE + 10, 214);
			context.lineTo(-10, 214);
			context.closePath();
			context.fill();
			context.fillStyle = "#7fa9b8";
			context.fillRect(-10, 208, STAGE + 20, 14);
			context.fillStyle = "rgba(255,255,255,.35)";
			for (let i = 0; i < 6; i++) context.fillRect(((i * 83 - scroll * 0.1) % 440 + 440) % 440 - 20, 212 + (i % 2) * 4, 22, 1.5);

			// Flat-roofed houses of the city, drifting by.
			const houseShift = scroll * 0.35;
			for (let i = -1; i < 9; i++) {
				const base = Math.floor(houseShift / 70);
				const index = base + i;
				const x = index * 70 - houseShift;
				const h = 56 + ((index * 37) % 5) * 12;
				const w = 58 + ((index * 13) % 3) * 8;
				const shade = (index * 29) % 3;
				context.fillStyle = ["#e6cfa6", "#dcc095", "#efdcb9"][shade];
				context.fillRect(x, 262 - h, w, h + 6);
				context.fillStyle = "rgba(120,80,40,.18)";
				context.fillRect(x + w - 8, 262 - h, 8, h + 6);
				context.fillStyle = "#b99868";
				context.fillRect(x - 2, 262 - h - 4, w + 4, 5);
				context.fillStyle = "#5a3d26";
				context.beginPath();
				context.roundRect(x + 14 + (index % 2) * 18, 238, 13, 24, [6, 6, 0, 0]);
				context.fill();
				if (index % 3 === 0) {
					context.fillStyle = "#6e4a2e";
					context.fillRect(x + w - 24, 262 - h + 14, 8, 8);
				}
			}

			// The multitude along the street (9:8): they lift their hands at the end.
			const praise = won ? ease((out - 95) / 30) : 0;
			const crowdShift = scroll * 0.72;
			const robes = ["#8a6a52", "#6f7c8e", "#9b5d48", "#7d7458", "#a88b62", "#5f6d5a"];
			for (let i = -1; i < 14; i++) {
				const index = Math.floor(crowdShift / 34) + i;
				const x = index * 34 - crowdShift + ((index * 17) % 9);
				const h = 58 + ((index * 7) % 4) * 4;
				const feet = GROUND - 26 + ((index * 5) % 3) * 2;
				figure(context, x, feet, h, robes[((index % robes.length) + robes.length) % robes.length], "#d9c7a5", 0, index % 2 ? 1 : -1);
				if (praise > 0) {
					context.strokeStyle = "#b07c55";
					context.lineWidth = 3;
					context.lineCap = "round";
					context.beginPath();
					context.moveTo(x - 4, feet - h * 0.66);
					context.lineTo(x - 9, feet - h * 0.66 - 18 * praise);
					context.moveTo(x + 4, feet - h * 0.66);
					context.lineTo(x + 9, feet - h * 0.66 - 18 * praise);
					context.stroke();
				}
			}

			// The street.
			const road = context.createLinearGradient(0, GROUND - 18, 0, STAGE);
			road.addColorStop(0, "#c49a68");
			road.addColorStop(1, "#a97d50");
			context.fillStyle = road;
			context.fillRect(-10, GROUND - 18, STAGE + 20, STAGE - GROUND + 30);
			context.fillStyle = "rgba(90,60,30,.22)";
			for (let i = 0; i < 26; i++) {
				const x = ((i * 53 - scroll) % 440 + 440) % 440 - 20;
				context.beginPath();
				context.ellipse(x, GROUND + 8 + ((i * 31) % 60), 6 + (i % 3) * 2, 2.5, 0, 0, Math.PI * 2);
				context.fill();
			}

			// The rough places ahead, the next one glowing with the way it will tip the bed.
			const coming = run.phase === "playing" ? bedComing(run) : null;
			const warn = (bump: BedBump) => (bump === coming ? clamp(1 - (bump.at - run.walked) / (BED_WARN * 60)) : 0);
			for (const bump of run.bumps) {
				const x = streetX(run, bump.at);
				if (x < -40 || x > STAGE + 40) continue;
				const glow = warn(bump);
				if (glow > 0) {
					const pulse = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(time * 16);
					context.fillStyle = `rgba(255,130,60,${0.35 * glow * pulse})`;
					context.beginPath();
					context.ellipse(x, GROUND + 2, 30, 10, 0, 0, Math.PI * 2);
					context.fill();
				}
				if (bump.kind === "stone") {
					context.fillStyle = "#8f8578";
					context.beginPath();
					context.ellipse(x, GROUND - 2, 14, 9, 0, Math.PI, Math.PI * 2);
					context.fill();
					context.fillStyle = "#a99f92";
					context.beginPath();
					context.ellipse(x - 3, GROUND - 6, 7, 4, -0.3, 0, Math.PI * 2);
					context.fill();
				} else if (bump.kind === "rut") {
					context.fillStyle = "#6e4c2c";
					context.beginPath();
					context.ellipse(x, GROUND + 3, 18, 5, 0, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = "#4f351f";
					context.beginPath();
					context.ellipse(x, GROUND + 4, 12, 3, 0, 0, Math.PI * 2);
					context.fill();
				} else if (bump.kind === "step-up") {
					context.fillStyle = "#d8c29a";
					context.fillRect(x - 4, GROUND - 9, 40, 11);
					context.fillStyle = "#b59f78";
					context.fillRect(x - 4, GROUND - 9, 4, 11);
				} else if (bump.kind === "step-down") {
					context.fillStyle = "#d8c29a";
					context.fillRect(x - 40, GROUND - 9, 40, 11);
					context.fillStyle = "#8a6a46";
					context.fillRect(x - 2, GROUND - 9, 4, 11);
				} else {
					// One of the press, leaning in toward the end of the bed it will push down.
					const lift = clamp(glow * 1.4);
					context.save();
					context.translate(x + (bump.kick > 0 ? 18 : -18), GROUND + 4);
					context.rotate((bump.kick > 0 ? -1 : 1) * 0.28 * lift);
					figure(context, 0, 0, 76, "#7a5a8c", "#e2d3b6");
					context.strokeStyle = "#b07c55";
					context.lineWidth = 3.5;
					context.lineCap = "round";
					context.beginPath();
					context.moveTo(0, -52);
					context.lineTo((bump.kick > 0 ? -1 : 1) * 16 * lift, -70 - 14 * lift);
					context.stroke();
					context.restore();
				}
				if (glow > 0) {
					context.fillStyle = "#fff4e6";
					context.strokeStyle = "#ff7a3d";
					context.lineWidth = 3;
					context.beginPath();
					context.arc(x, GROUND - 34, 10, 0, Math.PI * 2);
					context.fill();
					context.stroke();
					context.fillStyle = "#d4501c";
					context.font = "900 15px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("!", x, GROUND - 29);
				}
			}

			// Jesus at the far end of the street, a robed figure in light.
			const jesusX = streetX(run, BED_WALK_TICKS) + JESUS_GAP;
			if (jesusX < STAGE + 60) {
				const bright = won ? 1 : 0.7;
				const halo = context.createRadialGradient(jesusX, GROUND - 70, 6, jesusX, GROUND - 70, 120);
				halo.addColorStop(0, `rgba(255,252,236,${0.95 * bright})`);
				halo.addColorStop(0.45, `rgba(255,238,190,${0.45 * bright})`);
				halo.addColorStop(1, "rgba(255,230,170,0)");
				context.fillStyle = halo;
				context.fillRect(jesusX - 130, GROUND - 200, 260, 220);
				context.fillStyle = "#fffaf0";
				context.beginPath();
				context.moveTo(jesusX - 20, GROUND);
				context.lineTo(jesusX - 11, GROUND - 92);
				context.lineTo(jesusX + 11, GROUND - 92);
				context.lineTo(jesusX + 20, GROUND);
				context.closePath();
				context.fill();
				context.fillStyle = "rgba(196,170,120,.5)";
				context.fillRect(jesusX - 3, GROUND - 90, 4, 88);
				context.fillStyle = "#f6e7cc";
				context.beginPath();
				context.arc(jesusX, GROUND - 104, 12, 0, Math.PI * 2);
				context.fill();
				if (won) {
					// He speaks to the sick of the palsy: one hand stretched toward him.
					context.strokeStyle = "#fffaf0";
					context.lineWidth = 5;
					context.lineCap = "round";
					context.beginPath();
					context.moveTo(jesusX - 6, GROUND - 82);
					context.lineTo(jesusX - 30, GROUND - 74 - 8 * ease(out / 30));
					context.stroke();
				}
			}

			// The bearers and the bed.
			const setDown = won ? ease((out - 20) / 30) : lost ? ease(out / 30) : 0;
			const stumbling = run.stopped > 0 || lost;
			const sinceStumble = (run.tick - stumbleAt.current) / 60;
			const dip = stumbling ? Math.sin(clamp(sinceStumble / 0.35) * Math.PI) * 6 : 0;
			const bob = (walking ? Math.abs(stride) * 2.5 : 0) + dip;
			const bedY = BED_Y + bob + setDown * (GROUND - 22 - BED_Y);
			const tilt = (won || lost ? run.tilt * (1 - setDown) : run.tilt) * DEG;
			const cos = Math.cos(tilt);
			const sin = Math.sin(tilt);
			const at = (u: number) => ({ x: BED_X + u * cos, y: bedY + u * sin });
			const bearerFeet = GROUND + 2;
			const bearers: { x: number; far: boolean; u: number }[] = [
				{ x: BED_X - GRIP + 10, far: true, u: -GRIP + 10 },
				{ x: FRONT_X + 10, far: true, u: GRIP + 10 },
				{ x: BED_X - GRIP, far: false, u: -GRIP },
				{ x: FRONT_X, far: false, u: GRIP },
			];
			const drawBearer = (bearer: (typeof bearers)[number], index: number) => {
				const gait = walking ? Math.sin(run.walked * (Math.PI / 19) + index * 1.3) * 4 : 0;
				const leave = won ? ease((out - 50) / 30) * -26 : 0;
				const bx = bearer.x + leave * (bearer.u < 0 ? 1 : 0.4);
				const feet = bearerFeet - (bearer.far ? 6 : 0);
				const height = bearer.far ? 112 : 118;
				const robe = bearer.far ? ["#6b4d3a", "#4f5b6b"][index % 2] : ["#8f6545", "#5d6f80"][index % 2];
				figure(context, bx, feet - Math.abs(gait) * 0.4, height, robe, bearer.far ? "#cbb894" : "#e6d6b4", gait * 0.5);
				const hand = at(bearer.u);
				const shoulder = { x: bx + 4, y: feet - height * 0.66 };
				const handX = won && out > 50 ? shoulder.x - 6 : hand.x;
				const handY = won && out > 50 ? shoulder.y + 26 : hand.y + 6;
				context.strokeStyle = robe;
				context.lineWidth = 7;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(shoulder.x + 2, shoulder.y + 4);
				context.lineTo((shoulder.x + handX) / 2 + 2, (shoulder.y + handY) / 2);
				context.stroke();
				context.strokeStyle = bearer.far ? "#94684a" : "#b07c55";
				context.lineWidth = 5;
				context.beginPath();
				context.moveTo((shoulder.x + handX) / 2 + 2, (shoulder.y + handY) / 2);
				context.lineTo(handX, handY);
				context.stroke();
			};
			bearers.slice(0, 2).forEach(drawBearer);

			// The bed: a pallet on two poles, the man lying wrapped on it, his head at the back.
			const rising = won ? ease((out - 50) / 35) : 0;
			const departing = won ? ease((out - 90) / 70) : 0;
			const danger = run.phase === "playing" ? clamp((Math.abs(run.tilt) - BED_LIMIT * 0.55) / (BED_LIMIT * 0.45)) : 0;
			if (!(won && out > 90)) {
				context.save();
				context.translate(BED_X, bedY);
				context.rotate(tilt);
				context.fillStyle = "#7a5530";
				context.fillRect(-HALF - 10, 2, HALF * 2 + 20, 5);
				context.fillStyle = "#d9c49a";
				context.beginPath();
				context.roundRect(-HALF, -6, HALF * 2, 10, 4);
				context.fill();
				context.strokeStyle = danger > 0 ? `rgba(230,70,30,${0.4 + 0.6 * danger})` : "rgba(120,90,50,.6)";
				context.lineWidth = danger > 0 ? 3 : 1.5;
				context.stroke();
				for (let x = -HALF + 8; x < HALF; x += 12) {
					context.fillStyle = "rgba(150,120,80,.35)";
					context.fillRect(x, -5, 2, 8);
				}
				if (rising === 0) {
					// The man, lying still: a blanket over him, his head on a rolled cloth.
					context.fillStyle = "#c8b8d4";
					context.beginPath();
					context.roundRect(-HALF + 24, -19, HALF * 2 - 34, 15, 8);
					context.fill();
					context.fillStyle = "#e9dfc9";
					context.beginPath();
					context.roundRect(-HALF + 4, -13, 18, 9, 4);
					context.fill();
					context.fillStyle = "#b07c55";
					context.beginPath();
					context.arc(-HALF + 16, -19, 9, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = "#4a3324";
					context.beginPath();
					context.arc(-HALF + 13, -21, 9, Math.PI * 0.6, Math.PI * 1.7);
					context.fill();
				}
				context.restore();
			}
			bearers.slice(2).forEach((bearer, index) => drawBearer(bearer, index + 2));

			// He arises, takes up his bed and departs to his house (9:6-7).
			if (rising > 0) {
				const manX = BED_X + 20 - departing * 230;
				const manFeet = GROUND + 4;
				const height = 64 + 58 * rising;
				context.globalAlpha = 1 - clamp((departing - 0.85) / 0.15);
				figure(context, manX, manFeet, height, "#c8b8d4", "#e9dfc9", Math.sin(out * 0.3) * 3 * (departing > 0 && departing < 1 ? 1 : 0), departing > 0 ? -1 : 1);
				if (out > 90) {
					// The bed, rolled on his shoulder.
					context.fillStyle = "#d9c49a";
					context.save();
					context.translate(manX, manFeet - height * 0.7);
					context.rotate(-0.35);
					context.beginPath();
					context.roundRect(-30, -6, 60, 12, 6);
					context.fill();
					context.fillStyle = "#7a5530";
					context.fillRect(-36, -2, 72, 3);
					context.restore();
				}
				context.globalAlpha = 1;
			}

			// The tip arrow for the coming jolt, over the end that will drop.
			if (coming) {
				const glow = warn(coming);
				const end = coming.kick > 0 ? at(HALF) : at(-HALF);
				tipArrow(context, end.x, end.y - 46, coming.kick > 0 ? "front" : "back", 0.35 + 0.65 * glow);
			}

			// Dust from the bearers' feet.
			for (const mote of dust.current) {
				mote.age += dt;
				mote.x += mote.vx * dt - (walking ? 78 * dt : 0);
				mote.y += mote.vy * dt;
				mote.vy += 60 * dt;
				const life = 1 - mote.age / mote.life;
				if (life <= 0) continue;
				context.fillStyle = `rgba(214,186,140,${0.7 * life})`;
				context.beginPath();
				context.arc(mote.x, mote.y, 3 + (1 - life) * 4, 0, Math.PI * 2);
				context.fill();
			}
			dust.current = dust.current.filter((mote) => mote.age < mote.life);

			// The HUD: the level, the stumbles, the way to Jesus.
			if (run.phase === "playing") {
				const gx = 200;
				const gy = 62;
				context.fillStyle = "rgba(40,24,12,.55)";
				context.beginPath();
				context.roundRect(gx - 74, 8, 148, 64, 14);
				context.fill();
				context.lineCap = "butt";
				context.lineWidth = 10;
				context.strokeStyle = "rgba(255,255,255,.18)";
				context.beginPath();
				context.arc(gx, gy, 46, Math.PI * 1.1, Math.PI * 1.9);
				context.stroke();
				context.strokeStyle = "#6fcf7a";
				context.beginPath();
				context.arc(gx, gy, 46, Math.PI * 1.5 - 0.12, Math.PI * 1.5 + 0.12);
				context.stroke();
				context.strokeStyle = "#e5552a";
				context.beginPath();
				context.arc(gx, gy, 46, Math.PI * 1.1, Math.PI * 1.17);
				context.stroke();
				context.beginPath();
				context.arc(gx, gy, 46, Math.PI * 1.83, Math.PI * 1.9);
				context.stroke();
				const needle = -Math.PI / 2 + clamp(run.tilt / BED_LIMIT, -1, 1) * Math.PI * 0.4;
				context.strokeStyle = danger > 0 ? "#ff8a5c" : "#fff6e6";
				context.lineWidth = 4;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(gx, gy);
				context.lineTo(gx + Math.cos(needle) * 44, gy + Math.sin(needle) * 44);
				context.stroke();
				context.fillStyle = "#fff6e6";
				context.beginPath();
				context.arc(gx, gy, 5, 0, Math.PI * 2);
				context.fill();
				// Stumbles: three marks, filled as they happen.
				context.fillStyle = "rgba(40,24,12,.55)";
				context.beginPath();
				context.roundRect(10, 10, 92, 30, 10);
				context.fill();
				for (let i = 0; i < BED_STUMBLES; i++) {
					context.fillStyle = i < run.stumbles ? "#e5552a" : "rgba(255,246,230,.85)";
					context.beginPath();
					context.arc(30 + i * 26, 25, 8, 0, Math.PI * 2);
					context.fill();
				}
				// The way to Jesus.
				context.fillStyle = "rgba(40,24,12,.55)";
				context.beginPath();
				context.roundRect(298, 10, 92, 30, 10);
				context.fill();
				context.fillStyle = "rgba(255,246,230,.35)";
				context.fillRect(308, 23, 64, 4);
				context.fillStyle = "#fff6e6";
				context.fillRect(308, 23, 64 * bedAlong(run), 4);
				context.beginPath();
				context.arc(308 + 64 * bedAlong(run), 25, 5, 0, Math.PI * 2);
				context.fill();
				const shine = context.createRadialGradient(380, 25, 1, 380, 25, 10);
				shine.addColorStop(0, "#fffbe8");
				shine.addColorStop(1, "rgba(255,240,190,0)");
				context.fillStyle = shine;
				context.beginPath();
				context.arc(380, 25, 10, 0, Math.PI * 2);
				context.fill();

				// The two halves to hold, lit while held.
				for (const side of [-1, 1]) {
					const held = lean.current === side;
					const cx = side < 0 ? 46 : 354;
					context.fillStyle = held ? "rgba(255,196,64,.95)" : "rgba(40,24,12,.4)";
					context.beginPath();
					context.roundRect(cx - 32, 348, 64, 42, 12);
					context.fill();
					context.fillStyle = held ? "#2a1a05" : "rgba(255,246,230,.9)";
					context.font = "900 26px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText(side < 0 ? "←" : "→", cx, 378);
				}
				if (run.tick < HINT_TICKS) {
					context.fillStyle = `rgba(40,24,12,${0.6 * (1 - clamp((run.tick - HINT_TICKS + 30) / 30))})`;
					context.beginPath();
					context.roundRect(84, 92, 232, 34, 12);
					context.fill();
					context.fillStyle = `rgba(255,246,230,${1 - clamp((run.tick - HINT_TICKS + 30) / 30)})`;
					context.font = "800 16px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("Hold ← or → to lean it back", 200, 115);
				}
				if (run.stopped > 0) {
					context.fillStyle = "rgba(160,50,20,.9)";
					context.beginPath();
					context.roundRect(130, 96, 140, 34, 12);
					context.fill();
					context.fillStyle = "#fff";
					context.font = "900 18px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText(`Stumble ${run.stumbles}/${BED_STUMBLES}`, 200, 119);
				}
			}

			if (won && !ended.current) {
				context.textAlign = "center";
				const first = clamp(out / 20) * (1 - clamp((out - 88) / 14));
				if (first > 0) {
					context.globalAlpha = first;
					context.fillStyle = "rgba(255,250,236,.82)";
					context.beginPath();
					context.roundRect(40, 46, 320, 64, 14);
					context.fill();
					context.fillStyle = "#4a2f12";
					context.font = `italic 700 19px ${SERIF}`;
					context.fillText("Arise, take up thy bed,", 200, 73);
					context.fillText("and go unto thine house.", 200, 98);
				}
				const second = clamp((out - 100) / 20);
				if (second > 0) {
					context.globalAlpha = second;
					context.fillStyle = "rgba(255,250,236,.82)";
					context.beginPath();
					context.roundRect(30, 58, 340, 40, 14);
					context.fill();
					context.fillStyle = "#4a2f12";
					context.font = `italic 700 18px ${SERIF}`;
					context.fillText("And he arose, and departed to his house.", 200, 84);
				}
				context.globalAlpha = 1;
			}
			if (lost) {
				context.fillStyle = `rgba(30,18,8,${0.35 * clamp(out / 30)})`;
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
				context.fillStyle = ended.current ? "rgba(0,0,0,0)" : "#fff6e6";
				context.font = "800 20px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText(run.stumbles >= BED_STUMBLES ? "Three stumbles" : "Too slow", 200, 110);
			}
			context.restore();
		},
		[paused, reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const sideOf = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		return canvas && stagePoint(canvas, event).x < STAGE / 2 ? -1 : 1;
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		canvas.setPointerCapture?.(event.pointerId);
		pointers.current.set(event.pointerId, sideOf(event));
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, sideOf(event));
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		pointers.current.delete(event.pointerId);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onLostPointerCapture={onPointerUp}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A street of the city. Four bearers carry the sick of the palsy on his bed toward Jesus, who stands in light at the far end. The bed leans further once it leans: hold the left or right arrow, or hold the left or right half of the picture, to lean it back level. A glowing mark in the road and an arrow over the bed show which way the next rough place will tip it."
		/>
	);
}
