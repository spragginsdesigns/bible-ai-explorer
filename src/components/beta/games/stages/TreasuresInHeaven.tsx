"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	TREASURE_CHEST_HALF,
	TREASURE_CHEST_Y,
	TREASURE_SECONDS,
	TREASURE_TARGET,
	falling,
	newTreasure,
	stepTreasure,
	treasureAt,
	treasureResult,
	type TreasureEvent,
	type TreasureItem,
	type TreasureState,
} from "@/lib/beta/games/treasures-in-heaven-rules";

/**
 * Treasures in Heaven (LC-17851), Matthew 6:19-21: a chest on the clouds in
 * heaven's light. Gold coins come down in trails and jewels fall fast; hold
 * ← → (or drag) to catch them. Moths flutter and rust drifts down in
 * wobbling paths, each leaving a dark trail; let them by, for each one that
 * reaches the chest corrupts part of what is laid up.
 */

const JEWELS = ["#e0315a", "#2f7ff0", "#1fb37a", "#9b4dea"];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
	size: number;
	gravity: number;
}

interface Floater {
	x: number;
	y: number;
	born: number;
	text: string;
	color: string;
}

function drawCoin(context: CanvasRenderingContext2D, x: number, y: number, spin: number, size = 8) {
	const width = Math.max(1.5, Math.abs(Math.cos(spin)) * size);
	context.fillStyle = "#b9851c";
	context.beginPath();
	context.ellipse(x, y + 1, width, size, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#ffd34d";
	context.beginPath();
	context.ellipse(x, y, width, size, 0, 0, Math.PI * 2);
	context.fill();
	if (width > 4) {
		context.strokeStyle = "#e9a91c";
		context.lineWidth = 1.5;
		context.beginPath();
		context.ellipse(x, y, width * 0.6, size * 0.6, 0, 0, Math.PI * 2);
		context.stroke();
	}
	context.fillStyle = "rgba(255,255,240,.85)";
	context.beginPath();
	context.ellipse(x - width * 0.35, y - size * 0.35, width * 0.22, size * 0.2, -0.5, 0, Math.PI * 2);
	context.fill();
}

function drawJewel(context: CanvasRenderingContext2D, x: number, y: number, color: string, shine: number) {
	context.save();
	context.translate(x, y);
	context.fillStyle = `rgba(255,255,255,${0.25 + 0.25 * shine})`;
	context.beginPath();
	context.arc(0, 0, 15, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = color;
	context.beginPath();
	context.moveTo(0, 11);
	context.lineTo(-10, -2);
	context.lineTo(-5, -8);
	context.lineTo(5, -8);
	context.lineTo(10, -2);
	context.closePath();
	context.fill();
	context.fillStyle = "rgba(255,255,255,.55)";
	context.beginPath();
	context.moveTo(-5, -8);
	context.lineTo(0, -2);
	context.lineTo(5, -8);
	context.closePath();
	context.fill();
	context.strokeStyle = "rgba(255,255,255,.7)";
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(-10, -2);
	context.lineTo(10, -2);
	context.stroke();
	context.restore();
}

function drawMoth(context: CanvasRenderingContext2D, x: number, y: number, flap: number) {
	context.save();
	context.translate(x, y);
	context.fillStyle = "rgba(120,20,30,.22)";
	context.beginPath();
	context.arc(0, 0, 17, 0, Math.PI * 2);
	context.fill();
	const wing = 0.35 + 0.65 * Math.abs(Math.sin(flap));
	context.fillStyle = "#6b5a4a";
	for (const side of [-1, 1]) {
		context.beginPath();
		context.ellipse(side * 7 * wing, -3, 9 * wing, 7, side * 0.5, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.ellipse(side * 5 * wing, 5, 6 * wing, 5, -side * 0.4, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "#3a2f27";
	context.beginPath();
	context.ellipse(0, 0, 2.6, 8, 0, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = "#3a2f27";
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(-1, -7);
	context.lineTo(-5, -13);
	context.moveTo(1, -7);
	context.lineTo(5, -13);
	context.stroke();
	context.restore();
}

function drawRust(context: CanvasRenderingContext2D, item: TreasureItem, x: number, y: number, time: number) {
	context.save();
	context.translate(x, y);
	context.fillStyle = "rgba(120,30,20,.2)";
	context.beginPath();
	context.arc(0, 0, 24, 0, Math.PI * 2);
	context.fill();
	const puffs = [
		[-9, -3, 9],
		[7, -5, 10],
		[0, 6, 10],
		[-12, 7, 6],
		[13, 6, 7],
	];
	for (let index = 0; index < puffs.length; index++) {
		const [px, py, r] = puffs[index];
		const breathe = 1 + 0.08 * Math.sin(time * 3 + index + item.id);
		context.fillStyle = index % 2 ? "#a24a1e" : "#7e3517";
		context.beginPath();
		context.arc(px, py, r * breathe, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "#d07a3a";
	for (let speck = 0; speck < 5; speck++) {
		context.beginPath();
		context.arc(-8 + speck * 4, -2 + (speck % 2) * 6, 1.6, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

export default function TreasuresInHeaven({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<TreasureState>(newTreasure(seed));
	const drag = useRef<number | null>(null);
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const flash = useRef<{ at: number; color: string } | null>(null);
	const shake = useRef(0);
	const ended = useRef(false);
	const lastData = useRef(-1);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, t: number, gravity = 300) => {
		for (let i = 0; i < count; i++) {
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
			const power = speed * (0.4 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, born: t, life: 0.5 + Math.random() * 0.45, color: colors[i % colors.length], size: 1.5 + Math.random() * 2.5, gravity });
		}
	}, []);

	const react = useCallback(
		(event: TreasureEvent, run: TreasureState) => {
			const play = synth.current;
			if (event.type === "keep") {
				const jewel = event.kind === "jewel";
				burst(event.x, TREASURE_CHEST_Y - 4, jewel ? 18 : 9, jewel ? ["#ffffff", "#ffe08a", "#9fd3ff"] : ["#ffe08a", "#fff6d0"], jewel ? 170 : 120, run.t);
				floaters.current.push({ x: event.x, y: TREASURE_CHEST_Y - 22, born: run.t, text: `+${event.value}`, color: jewel ? "#ffffff" : "#ffe08a" });
				flash.current = { at: run.t, color: "255,224,120" };
				if (jewel) [1175, 1568].forEach((note, index) => play?.tone(note, 0.22, { type: "sine", volume: 0.13, delay: index * 0.06 }));
				else play?.tone(1320 + (run.coins % 5) * 90, 0.09, { type: "square", volume: 0.06 });
			}
			if (event.type === "corrupt") {
				burst(event.x, TREASURE_CHEST_Y, 22, ["#7e3517", "#a24a1e", "#6b5a4a", "#ffd34d"], 190, run.t);
				floaters.current.push({ x: event.x, y: TREASURE_CHEST_Y - 26, born: run.t, text: event.lost > 0 ? `−${event.lost}` : event.kind === "moth" ? "Moth!" : "Rust!", color: "#ff7a5c" });
				flash.current = { at: run.t, color: "200,70,40" };
				if (!reducedMotion) shake.current = run.t + 0.32;
				play?.noise(0.35, { volume: 0.28, filter: 700 });
				play?.tone(220, 0.4, { type: "sawtooth", volume: 0.12, to: 110 });
			}
			if (event.type === "miss" && event.kind !== "moth" && event.kind !== "rust") play?.tone(520, 0.08, { type: "sine", volume: 0.04, to: 380 });
			if (event.type === "won") [659, 784, 988, 1319].forEach((note, index) => play?.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: index * 0.1 }));
			if (event.type === "lost") play?.tone(260, 0.8, { type: "sine", volume: 0.16, to: 170 });
		},
		[burst, reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		takePresses(keys);
		const left = keys.held.has("arrowleft");
		const right = keys.held.has("arrowright");
		const events: TreasureEvent[] = [];
		stepTreasure(run, { dir: (right ? 1 : 0) - (left ? 1 : 0), target: left || right ? null : drag.current }, events);
		for (const event of events) react(event, run);
		onTime(Math.max(0, TREASURE_SECONDS - run.t));
		const canvas = canvasRef.current;
		const tick = Math.floor(run.t * 10);
		if (canvas && tick !== lastData.current) {
			lastData.current = tick;
			canvas.dataset.chest = `${Math.round(run.chestX)},${run.treasure}`;
			canvas.dataset.drops = falling(run)
				.filter((item) => item.outcome === null)
				.map((item) => `${item.kind[0]}${Math.round(item.landX)}@${(item.landAt - run.t).toFixed(2)}`)
				.join(" ");
		}
		const result = treasureResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			const still = reducedMotion ? 0 : time;
			context.save();
			if (shake.current > t) context.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);

			// Heaven's light: sky, the rays from above, the clouds below.
			const sky = context.createLinearGradient(0, 0, 0, STAGE);
			sky.addColorStop(0, "#fff4cf");
			sky.addColorStop(0.35, "#bfe3fb");
			sky.addColorStop(1, "#7fb8e8");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			context.save();
			context.translate(200, -40);
			for (let ray = 0; ray < 9; ray++) {
				const angle = -0.75 + ray * 0.19 + Math.sin(still * 0.4 + ray) * 0.02;
				context.fillStyle = `rgba(255,248,215,${ray % 2 ? 0.22 : 0.14})`;
				context.beginPath();
				context.moveTo(0, 0);
				context.lineTo(Math.sin(angle - 0.05) * 520, Math.cos(angle - 0.05) * 520);
				context.lineTo(Math.sin(angle + 0.05) * 520, Math.cos(angle + 0.05) * 520);
				context.closePath();
				context.fill();
			}
			context.restore();
			for (let mote = 0; mote < 16; mote++) {
				const x = (mote * 83 + still * 9) % 400;
				const y = (mote * 47 + still * (14 + (mote % 4) * 5)) % 300;
				context.fillStyle = `rgba(255,236,170,${0.35 + 0.3 * Math.sin(still * 2 + mote)})`;
				context.beginPath();
				context.arc(x, y, 1.6, 0, Math.PI * 2);
				context.fill();
			}

			// Moth and rust trails: where they have wobbled, so their swing is plain.
			const items = falling(run);
			for (const item of items) {
				if ((item.kind !== "moth" && item.kind !== "rust") || item.outcome !== null) continue;
				context.fillStyle = item.kind === "moth" ? "rgba(90,70,60,.35)" : "rgba(150,60,25,.3)";
				for (let back = 1; back <= 8; back++) {
					const at = t - back * 0.07;
					if (at < item.born) break;
					const p = treasureAt(item, at);
					context.beginPath();
					context.arc(p.x, p.y, (item.kind === "moth" ? 3 : 5) * (1 - back / 10), 0, Math.PI * 2);
					context.fill();
				}
			}

			// The clouds the chest rests on.
			context.fillStyle = "#ffffff";
			for (let puff = 0; puff < 9; puff++) {
				const x = puff * 52 - 10 + Math.sin(still * 0.5 + puff) * 3;
				context.beginPath();
				context.arc(x, 372 + (puff % 2) * 8, 38 + (puff % 3) * 6, 0, Math.PI * 2);
				context.fill();
			}
			context.fillStyle = "rgba(200,225,248,.55)";
			context.fillRect(-10, 388, STAGE + 20, 20);

			// The chest, open, glowing with what is laid up in it.
			const chestX = run.chestX;
			const half = TREASURE_CHEST_HALF;
			const flashAge = flash.current ? t - flash.current.at : 9;
			const halo = context.createRadialGradient(chestX, TREASURE_CHEST_Y + 10, 6, chestX, TREASURE_CHEST_Y + 10, 70);
			halo.addColorStop(0, `rgba(255,226,130,${0.55 + Math.min(0.35, run.treasure / 120)})`);
			halo.addColorStop(1, "rgba(255,226,130,0)");
			context.fillStyle = halo;
			context.fillRect(chestX - 80, TREASURE_CHEST_Y - 60, 160, 130);
			// The lid, tipped back.
			context.fillStyle = "#7a4a22";
			context.beginPath();
			context.moveTo(chestX - half + 2, TREASURE_CHEST_Y - 2);
			context.lineTo(chestX - half + 8, TREASURE_CHEST_Y - 26);
			context.quadraticCurveTo(chestX, TREASURE_CHEST_Y - 38, chestX + half - 8, TREASURE_CHEST_Y - 26);
			context.lineTo(chestX + half - 2, TREASURE_CHEST_Y - 2);
			context.closePath();
			context.fill();
			context.strokeStyle = "#e6b84a";
			context.lineWidth = 3;
			context.stroke();
			// The treasure heaped inside.
			const heap = Math.min(16, run.treasure / 3.2);
			context.fillStyle = "#ffd34d";
			context.beginPath();
			context.ellipse(chestX, TREASURE_CHEST_Y + 4, half - 4, 4 + heap * 0.6, 0, Math.PI, Math.PI * 2);
			context.fill();
			for (let gem = 0; gem < Math.min(5, Math.floor(run.treasure / 9)); gem++) {
				context.fillStyle = JEWELS[gem % JEWELS.length];
				context.beginPath();
				context.arc(chestX - 18 + gem * 9, TREASURE_CHEST_Y + 2 - heap * 0.4 - (gem % 2) * 3, 3, 0, Math.PI * 2);
				context.fill();
			}
			// The box.
			const wood = context.createLinearGradient(0, TREASURE_CHEST_Y, 0, TREASURE_CHEST_Y + 34);
			wood.addColorStop(0, "#9a5e2c");
			wood.addColorStop(1, "#6b3d18");
			context.fillStyle = wood;
			context.beginPath();
			context.roundRect(chestX - half, TREASURE_CHEST_Y + 2, half * 2, 32, 5);
			context.fill();
			context.fillStyle = "#e6b84a";
			context.fillRect(chestX - half, TREASURE_CHEST_Y + 2, half * 2, 4);
			context.fillRect(chestX - half + 8, TREASURE_CHEST_Y + 2, 4, 32);
			context.fillRect(chestX + half - 12, TREASURE_CHEST_Y + 2, 4, 32);
			context.fillRect(chestX - 5, TREASURE_CHEST_Y + 12, 10, 10);
			// The mouth that catches: a gold line, red for a moment when corrupted.
			const hit = flashAge < 0.3 && flash.current;
			context.strokeStyle = hit ? `rgba(${flash.current?.color},1)` : "#fff1b8";
			context.lineWidth = 4;
			context.lineCap = "round";
			context.beginPath();
			context.moveTo(chestX - half, TREASURE_CHEST_Y);
			context.lineTo(chestX + half, TREASURE_CHEST_Y);
			context.stroke();

			// What is falling.
			for (const item of items) {
				const at = treasureAt(item, Math.min(t, item.landAt + 0.35));
				const fade = item.outcome === "missed" ? Math.max(0, 1 - (t - item.landAt) / 0.35) : 1;
				context.globalAlpha = fade;
				if (item.kind === "coin") drawCoin(context, at.x, at.y, still * 6 + item.id);
				if (item.kind === "jewel") drawJewel(context, at.x, at.y, JEWELS[item.id % JEWELS.length], 0.5 + 0.5 * Math.sin(still * 10 + item.id));
				if (item.kind === "moth") drawMoth(context, at.x, at.y, still * 16 + item.id);
				if (item.kind === "rust") drawRust(context, item, at.x, at.y, still);
				context.globalAlpha = 1;
			}

			// Sparkle and spill.
			particles.current = particles.current.filter((particle) => t - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = t - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x + particle.vx * age, particle.y + particle.vy * age + particle.gravity * age * age, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			floaters.current = floaters.current.filter((floater) => t - floater.born < 0.8);
			context.textAlign = "center";
			context.font = "900 19px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = (t - floater.born) / 0.8;
				context.globalAlpha = 1 - age;
				context.lineWidth = 3;
				context.strokeStyle = "rgba(60,40,10,.6)";
				context.strokeText(floater.text, floater.x, floater.y - age * 26);
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 26);
			}
			context.globalAlpha = 1;

			// Laid up so far, against the mark.
			context.fillStyle = "rgba(60,44,14,.55)";
			context.beginPath();
			context.roundRect(10, 10, 168, 36, 12);
			context.fill();
			drawCoin(context, 28, 28, 0, 9);
			context.textAlign = "left";
			context.font = "900 19px system-ui, sans-serif";
			context.fillStyle = run.treasure >= TREASURE_TARGET ? "#ffe08a" : "#ffffff";
			context.fillText(`${run.treasure}/${TREASURE_TARGET}`, 44, 35);
			context.fillStyle = "rgba(255,255,255,.25)";
			context.fillRect(112, 24, 56, 8);
			context.fillStyle = "#ffd34d";
			context.fillRect(112, 24, 56 * Math.min(1, run.treasure / TREASURE_TARGET), 8);

			// The first moments: what moves, what to catch, what to dodge.
			if (t < 2.4 && run.phase === "playing") {
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 7);
				context.strokeStyle = `rgba(214,150,20,${0.55 + 0.45 * pulse})`;
				context.lineWidth = 3;
				context.beginPath();
				context.ellipse(chestX, TREASURE_CHEST_Y + 10, half + 28 + pulse * 6, 32 + pulse * 3, 0, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "#c27c0e";
				context.font = "900 26px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("◀", chestX - half - 54, TREASURE_CHEST_Y + 20);
				context.fillText("▶", chestX + half + 54, TREASURE_CHEST_Y + 20);
				context.fillStyle = "rgba(60,44,14,.6)";
				context.beginPath();
				context.roundRect(58, 62, 284, 58, 14);
				context.fill();
				drawCoin(context, 82, 80, 0, 7);
				drawJewel(context, 104, 80, JEWELS[0], 0.4);
				context.textAlign = "left";
				context.font = "900 15px system-ui, sans-serif";
				context.fillStyle = "#ffe08a";
				context.fillText("Catch the gold", 122, 85);
				drawMoth(context, 82, 104, 1.2);
				drawRust(context, run.items[0], 106, 104, 0);
				context.fillStyle = "#ffb4a0";
				context.fillText("Dodge moth & rust", 122, 109);
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,240,190,.25)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (event.type === "pointerdown") {
			event.preventDefault();
			event.currentTarget.setPointerCapture?.(event.pointerId);
		} else if (event.buttons === 0 && event.pointerType === "mouse") return;
		const canvas = canvasRef.current;
		if (canvas) drag.current = stagePoint(canvas, event).x;
	};
	const onRelease = () => {
		drag.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointer}
			onPointerMove={onPointer}
			onPointerUp={onRelease}
			onPointerCancel={onRelease}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label={`A treasure chest on the clouds in heaven's light. Hold the left and right arrows, or drag, to move the chest: catch the falling gold and jewels and let the moths and rust go by. Lay up ${TREASURE_TARGET}.`}
		/>
	);
}
