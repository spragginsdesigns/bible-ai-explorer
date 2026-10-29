"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SAVE_DANGER,
	SAVE_FUMBLE_STUN,
	SAVE_SECONDS,
	SAVE_WAVE_SURGE,
	SAVE_WAVE_WARN,
	newSave,
	nextSide,
	saveResult,
	stepSave,
	type SaveEvent,
	type SaveSide,
	type SaveState,
} from "@/lib/beta/games/lord-save-us-rules";

/**
 * Lord, Save Us (LC-17851), Matthew 8:23-27: a small ship in a great tempest
 * at night, Jesus asleep in the hinder part. Two disciples bail: left, right,
 * left, right (arrow keys, or a tap on the left then the right half). Big
 * waves rise as a dark wall before they pour in. Outlast the storm and he
 * arises, rebukes the winds and the sea, and there is a great calm.
 */

const SIDE_OF_KEY: Record<string, SaveSide> = { arrowleft: "left", arrowright: "right" };
const SHIP_X = 200;
const SHIP_Y = 250;
/** The hull's inside, top (brim) to floor, in the ship's own units. */
const HOLD_TOP = -24;
const HOLD_FLOOR = 38;
/** Where each disciple stands in the hull, and which way he throws. */
const BAILER: Record<SaveSide, { x: number; dir: number }> = { left: { x: -72, dir: -1 }, right: { x: 18, dir: 1 } };
const HINT_SECONDS = 1.6;

interface Drop {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	age: number;
	size: number;
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

function holdPath(context: CanvasRenderingContext2D) {
	context.beginPath();
	context.moveTo(-114, HOLD_TOP);
	context.quadraticCurveTo(-104, 34, -40, HOLD_FLOOR);
	context.lineTo(40, HOLD_FLOOR);
	context.quadraticCurveTo(106, 34, 114, HOLD_TOP);
	context.closePath();
}

/** A simple robed figure standing, feet at (x, y). */
function drawRobed(context: CanvasRenderingContext2D, x: number, y: number, height: number, color: string, head: string) {
	context.fillStyle = color;
	context.beginPath();
	context.moveTo(x - height * 0.17, y);
	context.lineTo(x - height * 0.1, y - height * 0.74);
	context.lineTo(x + height * 0.1, y - height * 0.74);
	context.lineTo(x + height * 0.17, y);
	context.closePath();
	context.fill();
	context.fillStyle = head;
	context.beginPath();
	context.arc(x, y - height * 0.86, height * 0.13, 0, Math.PI * 2);
	context.fill();
}

export default function LordSaveUs({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<SaveState>(newSave(seed));
	const taps = useRef<SaveSide[]>([]);
	const ended = useRef(false);
	const ticks = useRef(0);
	const lastBail = useRef<Record<SaveSide, number>>({ left: -9, right: -9 });
	const fumble = useRef<{ at: number; side: SaveSide } | null>(null);
	const drops = useRef<Drop[]>([]);
	const flash = useRef(-9);
	const bolt = useRef<number[]>([]);
	const shake = useRef(0);
	const endedAt = useRef<number | null>(null);
	const lastDraw = useRef<number | null>(null);
	const synth = useSynth(muted);

	const splash = useCallback((x: number, y: number, dir: number, count: number, speed: number) => {
		for (let i = 0; i < count; i++) {
			drops.current.push({
				x,
				y,
				vx: dir * (speed * (0.4 + Math.random() * 0.8)) + (dir === 0 ? (Math.random() - 0.5) * speed * 2 : 0),
				vy: -speed * (0.5 + Math.random() * 0.9),
				life: 0.5 + Math.random() * 0.5,
				age: 0,
				size: 1.5 + Math.random() * 2.5,
			});
		}
		if (drops.current.length > 260) drops.current.splice(0, drops.current.length - 260);
	}, []);

	const sound = useCallback(
		(event: SaveEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "bail") {
				play.noise(0.22, { volume: 0.2, filter: 1600 + Math.random() * 900, type: "bandpass" });
				play.tone(event.side === "left" ? 520 : 620, 0.08, { type: "sine", volume: 0.06, to: 380 });
			}
			if (event.type === "fumble") {
				play.tone(120, 0.18, { type: "square", volume: 0.14, to: 70 });
				play.noise(0.15, { volume: 0.2, filter: 320 });
			}
			if (event.type === "warn") {
				play.noise(SAVE_WAVE_WARN, { volume: 0.12, filter: 420 });
				play.tone(70, SAVE_WAVE_WARN, { type: "sawtooth", volume: 0.05, to: 130 });
			}
			if (event.type === "surge") play.noise(1, { volume: 0.38, filter: 1400 });
			if (event.type === "thunder") {
				play.noise(1.8, { volume: 0.4, filter: 180, delay: 0.12 });
				play.noise(0.25, { volume: 0.18, filter: 2400, type: "highpass" });
			}
			if (event.type === "calm") [262, 330, 392, 523, 659].forEach((note, index) => play.tone(note, 2.8, { type: "triangle", volume: 0.12, delay: 0.3 + index * 0.14 }));
			if (event.type === "sank") play.tone(196, 1.3, { type: "sine", volume: 0.2, to: 82 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const presses: SaveSide[] = [];
		for (const key of takePresses(keys)) {
			const side = SIDE_OF_KEY[key];
			if (side) presses.push(side);
		}
		presses.push(...taps.current.splice(0));
		const events: SaveEvent[] = [];
		stepSave(run, { presses }, events);
		for (const event of events) {
			if (event.type === "bail") {
				lastBail.current[event.side] = run.t;
				const bailer = BAILER[event.side];
				splash(SHIP_X + bailer.dir * 130, SHIP_Y - 44, bailer.dir, 12, 120);
			}
			if (event.type === "fumble") {
				fumble.current = { at: run.t, side: event.side };
				shake.current = Math.max(shake.current, 2.5);
			}
			if (event.type === "surge") {
				shake.current = 9;
				splash(event.side === "left" ? 70 : 330, 170, event.side === "left" ? 1 : -1, 40, 170);
			}
			if (event.type === "thunder") {
				flash.current = run.t;
				const points: number[] = [];
				let x = 60 + Math.random() * 280;
				for (let y = 0; y <= 150; y += 18) {
					points.push(x, y);
					x += (Math.random() - 0.5) * 40;
				}
				bolt.current = points;
			}
			sound(event);
		}
		onTime(Math.max(0, SAVE_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && (ticks.current % 6 === 0 || run.phase !== "playing")) {
			canvas.dataset.water = String(Math.round(run.water));
			canvas.dataset.next = nextSide(run) ?? "any";
		}
		const result = saveResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, sound, splash]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const frame = lastDraw.current === null ? 0 : clamp(time - lastDraw.current, 0, 0.05);
			lastDraw.current = time;
			if (run.phase !== "playing" && endedAt.current === null) endedAt.current = time;
			const since = endedAt.current === null ? 0 : time - endedAt.current;
			const calm = run.phase === "won" ? clamp(since / 2.2) : 0;
			const storm = 1 - calm;
			const sinking = run.phase === "lost" ? clamp(since / 2.5) : 0;
			const motion = reducedMotion ? 0.25 : 1;

			// The sky: storm-black, easing to a clear deep blue in the calm.
			const sky = context.createLinearGradient(0, 0, 0, 300);
			sky.addColorStop(0, `rgb(${mix(10, 14, calm)},${mix(13, 30, calm)},${mix(24, 70, calm)})`);
			sky.addColorStop(1, `rgb(${mix(26, 40, calm)},${mix(34, 70, calm)},${mix(52, 120, calm)})`);
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, STAGE);
			if (calm > 0) {
				for (let i = 0; i < 46; i++) {
					const x = (i * 97.3) % STAGE;
					const y = (i * 53.7) % 190;
					const twinkle = 0.55 + 0.45 * Math.sin(time * 2 + i);
					context.fillStyle = `rgba(255,248,225,${calm * twinkle * 0.9})`;
					context.fillRect(x, y, i % 5 ? 1.6 : 2.4, i % 5 ? 1.6 : 2.4);
				}
				const moon = context.createRadialGradient(312, 72, 6, 312, 72, 80);
				moon.addColorStop(0, `rgba(255,246,214,${0.55 * calm})`);
				moon.addColorStop(1, "rgba(255,246,214,0)");
				context.fillStyle = moon;
				context.fillRect(220, 0, 180, 170);
				context.fillStyle = `rgba(255,248,226,${calm})`;
				context.beginPath();
				context.arc(312, 72, 20, 0, Math.PI * 2);
				context.fill();
			}
			// Storm clouds, parting in the calm.
			for (let i = 0; i < 7; i++) {
				const away = (i < 3.5 ? -1 : 1) * calm * 260;
				const x = ((i * 71 + time * (6 + i) * motion) % 520) - 60 + away;
				const y = 24 + (i % 3) * 26;
				context.fillStyle = `rgba(${18 + i * 3},${22 + i * 3},${34 + i * 3},${0.92 * storm})`;
				context.beginPath();
				context.ellipse(x, y, 90, 34, 0, 0, Math.PI * 2);
				context.ellipse(x + 50, y + 14, 70, 28, 0, 0, Math.PI * 2);
				context.fill();
			}

			// The sea's height at x, rough in the storm and still in the calm.
			const amp = 13 * storm + 1.2;
			const seaY = (x: number, base: number, speed: number) =>
				base + Math.sin(x * 0.021 + time * speed * motion) * amp + Math.sin(x * 0.05 - time * speed * 1.7 * motion) * amp * 0.45;
			const sea = (base: number, speed: number, color: string, foam: number) => {
				context.fillStyle = color;
				context.beginPath();
				context.moveTo(0, STAGE);
				for (let x = 0; x <= STAGE; x += 10) context.lineTo(x, seaY(x, base, speed));
				context.lineTo(STAGE, STAGE);
				context.closePath();
				context.fill();
				if (foam > 0) {
					context.strokeStyle = `rgba(220,236,255,${foam})`;
					context.lineWidth = 2;
					context.beginPath();
					for (let x = 0; x <= STAGE; x += 10) context.lineTo(x, seaY(x, base, speed));
					context.stroke();
				}
			};
			sea(282, 1.3, calm > 0 ? `rgb(${mix(16, 22, calm)},${mix(44, 52, calm)},${mix(68, 96, calm)})` : "#102c44", 0.25 * storm + 0.15 * calm);
			if (calm > 0) {
				// The moon's path on the still water.
				context.fillStyle = `rgba(255,240,200,${0.18 * calm})`;
				for (let i = 0; i < 6; i++) context.fillRect(290 - i * 3, 296 + i * 14, 44 + i * 6, 2);
			}

			// Big waves: a dark wall rising on one side behind the ship, then pouring in.
			const waveShape = (wave: (typeof run.waves)[number]) => {
				const dir = wave.side === "left" ? 1 : -1;
				const edge = wave.side === "left" ? 0 : STAGE;
				const rising = clamp((run.t - wave.warn) / SAVE_WAVE_WARN);
				const falling = clamp((run.t - wave.hit) / (SAVE_WAVE_SURGE + 0.3));
				return { dir, edge, top: 300 - 175 * rising * (1 - falling), reach: 105 + 45 * falling, falling };
			};
			const liveWaves = run.phase === "won" ? [] : run.waves.filter((wave) => run.t >= wave.warn && run.t <= wave.hit + SAVE_WAVE_SURGE + 0.3);
			for (const wave of liveWaves) {
				const { dir, edge, top, reach } = waveShape(wave);
				context.fillStyle = "#081a2a";
				context.beginPath();
				context.moveTo(edge, STAGE);
				context.lineTo(edge, top + 10);
				context.quadraticCurveTo(edge + dir * reach * 0.6, top - 26, edge + dir * reach, top + 18);
				context.quadraticCurveTo(edge + dir * reach * 0.85, top + 40, edge + dir * (reach - 10), 320);
				context.lineTo(edge + dir * (reach + 10), STAGE);
				context.closePath();
				context.fill();
				context.strokeStyle = "rgba(225,240,255,.85)";
				context.lineWidth = 4;
				context.beginPath();
				context.moveTo(edge, top + 10);
				context.quadraticCurveTo(edge + dir * reach * 0.6, top - 26, edge + dir * reach, top + 18);
				context.stroke();
			}
			const waveOverlays = () => {
				for (const wave of liveWaves) {
					const { dir, edge, top, reach, falling } = waveShape(wave);
					if (run.t < wave.hit) {
						const pulse = 0.7 + 0.3 * Math.sin(time * 18);
						const cx = edge + dir * (wave.side === "left" ? 62 : 84);
						const cy = Math.max(70, Math.min(120, top - 34));
						context.fillStyle = `rgba(255,90,70,${pulse})`;
						context.beginPath();
						context.arc(cx, cy, 17, 0, Math.PI * 2);
						context.fill();
						context.fillStyle = "#fff";
						context.font = "900 24px system-ui, sans-serif";
						context.textAlign = "center";
						context.fillText("!", cx, cy + 8);
						context.font = "900 14px system-ui, sans-serif";
						context.fillText("Big wave!", cx, cy + 34);
					} else {
						// The surge pouring over the gunwale.
						const pour = 1 - falling;
						context.strokeStyle = `rgba(120,180,225,${0.85 * pour})`;
						context.lineWidth = 16 * pour + 2;
						context.beginPath();
						context.moveTo(edge + dir * reach, top + 18);
						context.quadraticCurveTo(SHIP_X + dir * 40, 130, SHIP_X - dir * 6, SHIP_Y - 8);
						context.stroke();
					}
				}
			};

			// The ship, rocking (and listing toward a surging wave).
			const surging = run.waves.find((wave) => run.t >= wave.hit && run.t < wave.hit + SAVE_WAVE_SURGE + 0.4);
			const list = surging && run.phase === "playing" ? (surging.side === "left" ? 0.1 : -0.1) * (1 - clamp((run.t - surging.hit) / (SAVE_WAVE_SURGE + 0.4))) : 0;
			const rock = (Math.sin(time * 1.7) * 0.07 + Math.sin(time * 0.9) * 0.03) * storm * motion + list * motion;
			shake.current = Math.max(0, shake.current - frame * 22);
			const jolt = reducedMotion ? 0 : shake.current;
			const bob = Math.sin(time * 1.3) * 5 * storm * motion + sinking * 26;
			context.save();
			context.translate(SHIP_X + (Math.random() - 0.5) * jolt, SHIP_Y + bob + (Math.random() - 0.5) * jolt);
			context.rotate(rock + sinking * 0.1);
			// The mast and a torn, furled sail.
			context.fillStyle = "#5a3f28";
			context.fillRect(-23, -150, 6, 160);
			context.fillRect(-60, -132, 80, 5);
			context.fillStyle = "#cdbf9f";
			context.beginPath();
			context.moveTo(-58, -127);
			context.quadraticCurveTo(-20 + Math.sin(time * 5) * 6 * storm, -95, 18, -127);
			context.lineTo(18, -118);
			context.quadraticCurveTo(-20, -102, -58, -118);
			context.closePath();
			context.fill();
			// The hull, cut away to show the hold.
			context.fillStyle = "#6b4527";
			context.beginPath();
			context.moveTo(-136, -40);
			context.quadraticCurveTo(-124, 44, -44, 50);
			context.lineTo(44, 50);
			context.quadraticCurveTo(124, 44, 136, -44);
			context.lineTo(118, -30);
			context.lineTo(-118, -28);
			context.closePath();
			context.fill();
			context.fillStyle = "#2c1c12";
			holdPath(context);
			context.fill();
			context.strokeStyle = "rgba(0,0,0,.25)";
			context.lineWidth = 1;
			for (let y = -10; y < HOLD_FLOOR; y += 12) {
				context.beginPath();
				context.moveTo(-110, y);
				context.lineTo(110, y);
				context.stroke();
			}
			// The water in the hold: level with the world, sloshing in the storm.
			const fill = run.water / 100;
			const level = HOLD_FLOOR - fill * (HOLD_FLOOR - HOLD_TOP);
			context.save();
			holdPath(context);
			context.clip();
			context.save();
			context.translate(0, level);
			context.rotate(-(rock + sinking * 0.1));
			const danger = run.water >= SAVE_DANGER;
			context.fillStyle = danger ? "rgba(52,118,170,.92)" : "rgba(44,110,160,.88)";
			context.beginPath();
			context.moveTo(-200, 200);
			for (let x = -200; x <= 200; x += 10) context.lineTo(x, Math.sin(x * 0.05 + time * 6 * storm) * 3 * storm * motion);
			context.lineTo(200, 200);
			context.closePath();
			context.fill();
			context.strokeStyle = "rgba(200,232,255,.7)";
			context.lineWidth = 2;
			context.beginPath();
			for (let x = -200; x <= 200; x += 10) context.lineTo(x, Math.sin(x * 0.05 + time * 6 * storm) * 3 * storm * motion);
			context.stroke();
			context.restore();
			context.restore();

			// The two disciples bailing, the next one glowing.
			const want = nextSide(run);
			for (const side of ["left", "right"] as SaveSide[]) {
				const bailer = BAILER[side];
				const swing = run.t - lastBail.current[side];
				const lift = swing < 0.28 ? Math.sin((swing / 0.28) * Math.PI) : 0;
				const fumbled = fumble.current && fumble.current.side === side && run.t - fumble.current.at < SAVE_FUMBLE_STUN + 0.1;
				const glowing = run.phase === "playing" && (want === null || want === side);
				if (glowing) {
					const pulse = 0.6 + 0.4 * Math.sin(time * 10);
					const halo = context.createRadialGradient(bailer.x, -20, 4, bailer.x, -20, 46);
					halo.addColorStop(0, `rgba(255,200,80,${0.5 * pulse})`);
					halo.addColorStop(1, "rgba(255,200,80,0)");
					context.fillStyle = halo;
					context.fillRect(bailer.x - 50, -70, 100, 100);
				}
				drawRobed(context, bailer.x, HOLD_FLOOR - 4, 62, side === "left" ? "#7d5a3a" : "#5d6b4a", "#d7b48c");
				// The arm and bucket: down in the water, swung up and out on a bail.
				const handX = bailer.x + bailer.dir * (6 + lift * 30) + (fumbled ? Math.sin(time * 40) * 3 : 0);
				const handY = (fumbled ? 22 : 12) - lift * 58;
				context.strokeStyle = "#d7b48c";
				context.lineWidth = 4;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(bailer.x + bailer.dir * 4, -10);
				context.lineTo(handX, handY);
				context.stroke();
				context.save();
				context.translate(handX, handY + 6);
				context.rotate(bailer.dir * (lift * 1.6 + (fumbled ? 0.9 : 0)));
				context.fillStyle = glowing ? "#f2c14e" : "#a77a3c";
				context.beginPath();
				context.moveTo(-8, -6);
				context.lineTo(8, -6);
				context.lineTo(6, 8);
				context.lineTo(-6, 8);
				context.closePath();
				context.fill();
				context.strokeStyle = "#3b2512";
				context.lineWidth = 1.5;
				context.stroke();
				context.restore();
			}

			// The hinder part: Jesus asleep on a cushion, in soft light; arisen in the calm.
			context.fillStyle = "#4a2f1b";
			context.fillRect(64, -18, 50, 8);
			const glowSize = 36 + calm * 70;
			const light = context.createRadialGradient(92, -30, 4, 92, -30, glowSize);
			light.addColorStop(0, `rgba(255,240,200,${0.55 + 0.3 * calm})`);
			light.addColorStop(1, "rgba(255,240,200,0)");
			context.fillStyle = light;
			context.fillRect(92 - glowSize, -30 - glowSize, glowSize * 2, glowSize * 2);
			if (run.phase === "won") {
				// He arose: standing, one arm raised over the sea.
				const rise = clamp(since / 0.8);
				context.globalAlpha = rise;
				drawRobed(context, 92, -18, 64, "#f6efe0", "#f6efe0");
				context.fillStyle = "#b8473a";
				context.fillRect(88, -60, 8, 30);
				context.strokeStyle = "#f6efe0";
				context.lineWidth = 5;
				context.lineCap = "round";
				context.beginPath();
				context.moveTo(98, -60);
				context.lineTo(98 + 22 * rise, -60 - 26 * rise);
				context.stroke();
				context.globalAlpha = 1;
			}
			if (run.phase !== "won" || since < 0.8) {
				const lying = run.phase === "won" ? 1 - clamp(since / 0.8) : 1;
				context.globalAlpha = lying;
				context.fillStyle = "#c9b8a0";
				context.beginPath();
				context.ellipse(106, -23, 8, 5, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#f6efe0";
				context.beginPath();
				context.ellipse(84, -23, 22, 7, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#b8473a";
				context.fillRect(80, -29, 6, 12);
				context.fillStyle = "#f6efe0";
				context.beginPath();
				context.arc(104, -31, 6, 0, Math.PI * 2);
				context.fill();
				context.globalAlpha = 1;
			}
			context.restore();

			// The sea in front of the ship.
			sea(326, 1.6, calm > 0 ? `rgb(${mix(11, 18, calm)},${mix(34, 44, calm)},${mix(54, 84, calm)})` : "#0b2236", 0.35 * storm);

			waveOverlays();

			// Rain, slanting hard, gone in the calm.
			if (storm > 0) {
				context.strokeStyle = `rgba(170,195,230,${0.4 * storm})`;
				context.lineWidth = 1.2;
				context.beginPath();
				const fall = reducedMotion ? time * 120 : time * 520;
				for (let i = 0; i < 80; i++) {
					const x = (i * 61.7 + fall * 0.35) % 440 - 20;
					const y = (i * 37.3 + fall) % 420 - 20;
					context.moveTo(x, y);
					context.lineTo(x - 7, y + 16);
				}
				context.stroke();
			}

			// Spray.
			for (const drop of drops.current) {
				drop.age += frame;
				drop.vy += 420 * frame;
				drop.x += drop.vx * frame;
				drop.y += drop.vy * frame;
				const alpha = clamp(1 - drop.age / drop.life);
				context.fillStyle = `rgba(190,225,255,${alpha})`;
				context.beginPath();
				context.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
				context.fill();
			}
			drops.current = drops.current.filter((drop) => drop.age < drop.life);

			// Lightning.
			const flashAge = run.t - flash.current;
			if (flashAge >= 0 && flashAge < 0.35 && run.phase !== "won") {
				const strength = (1 - flashAge / 0.35) * (reducedMotion ? 0.35 : 1);
				context.fillStyle = `rgba(220,230,255,${0.45 * strength})`;
				context.fillRect(0, 0, STAGE, STAGE);
				context.strokeStyle = `rgba(255,255,255,${strength})`;
				context.lineWidth = 3;
				context.beginPath();
				for (let i = 0; i < bolt.current.length; i += 2) context.lineTo(bolt.current[i], bolt.current[i + 1]);
				context.stroke();
			}

			// The water meter, with its danger line.
			const meterX = 366;
			const meterTop = 96;
			const meterHeight = 170;
			context.globalAlpha = 1 - 0.6 * calm;
			context.fillStyle = "rgba(0,0,0,.5)";
			context.beginPath();
			context.roundRect(meterX - 5, meterTop - 5, 26, meterHeight + 10, 8);
			context.fill();
			const level100 = (run.water / 100) * meterHeight;
			context.fillStyle = danger ? (Math.sin(time * 16) > 0 ? "#ff5a4a" : "#ff8a5a") : "#4aa3e0";
			context.fillRect(meterX, meterTop + meterHeight - level100, 16, level100);
			const lineY = meterTop + meterHeight - (SAVE_DANGER / 100) * meterHeight;
			context.fillStyle = "#ff5a4a";
			context.fillRect(meterX - 6, lineY - 1.5, 28, 3);
			context.fillStyle = "#fff";
			context.textAlign = "center";
			context.font = "800 10px system-ui, sans-serif";
			context.fillText("WATER", meterX + 8, meterTop - 10);
			context.globalAlpha = 1;

			// Which side bails next: a key on each half, the next one lit.
			if (run.phase === "playing") {
				const hint = run.t < HINT_SECONDS;
				const pulse = 0.5 + 0.5 * Math.sin(time * 9);
				if (hint) {
					context.strokeStyle = `rgba(255,255,255,${0.25 + 0.2 * pulse})`;
					context.setLineDash([6, 6]);
					context.lineWidth = 2;
					context.beginPath();
					context.moveTo(200, 190);
					context.lineTo(200, 400);
					context.stroke();
					context.setLineDash([]);
				}
				for (const side of ["left", "right"] as SaveSide[]) {
					const lit = want === null || want === side;
					const cx = side === "left" ? 100 : 300;
					const cy = 360;
					const size = lit ? 26 + (hint ? 6 * pulse : 2 * pulse) : 20;
					context.fillStyle = lit ? `rgba(255,196,64,${0.85 + 0.15 * pulse})` : "rgba(255,255,255,.18)";
					context.beginPath();
					context.roundRect(cx - size, cy - size * 0.8, size * 2, size * 1.6, 10);
					context.fill();
					context.fillStyle = lit ? "#2a1a05" : "rgba(255,255,255,.55)";
					context.font = `900 ${Math.round(size * 1.05)}px system-ui, sans-serif`;
					context.textAlign = "center";
					context.fillText(side === "left" ? "←" : "→", cx, cy + size * 0.36);
					if (hint) {
						context.fillStyle = "#fff";
						context.font = "900 16px system-ui, sans-serif";
						context.fillText(side === "left" ? "tap left" : "then right", cx, cy - size - 8);
					}
				}
				if (hint) {
					context.fillStyle = `rgba(255,255,255,${0.75 + 0.25 * pulse})`;
					context.font = "900 22px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("← then →  Bail!", 200, 178);
				}
			}

			// A fumble: the same side twice.
			const slip = fumble.current;
			if (slip && run.t - slip.at < 0.8 && run.phase === "playing") {
				const age = (run.t - slip.at) / 0.8;
				context.globalAlpha = 1 - age * age;
				context.fillStyle = "rgba(160,30,30,.92)";
				context.beginPath();
				context.roundRect(100, 140 - age * 10, 200, 40, 12);
				context.fill();
				context.fillStyle = "#fff";
				context.font = "900 20px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Left, then right!", 200, 167 - age * 10);
				context.globalAlpha = 1;
			}

			// The great calm.
			if (calm > 0) {
				const glow = context.createRadialGradient(SHIP_X + 92, SHIP_Y - 40, 10, SHIP_X + 92, SHIP_Y - 40, 260);
				glow.addColorStop(0, `rgba(255,236,190,${0.28 * calm})`);
				glow.addColorStop(1, "rgba(255,236,190,0)");
				context.fillStyle = glow;
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = `rgba(255,246,222,${clamp(since - 1)})`;
				context.font = "italic 700 18px Georgia, serif";
				context.textAlign = "center";
				context.fillText("And there was a great calm.", 200, 140);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		taps.current.push(stagePoint(canvas, event).x < STAGE / 2 ? "left" : "right");
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A small ship in a great tempest at night, Jesus asleep in the hinder part. Bail left, then right: press the left and right arrows in turn, or tap the left half then the right half."
		/>
	);
}
