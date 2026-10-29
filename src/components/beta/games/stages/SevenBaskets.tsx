"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	BASKETS_COUNT,
	BASKETS_DISCIPLES,
	BASKETS_HALF,
	BASKETS_HANDS_Y,
	BASKETS_PER,
	BASKETS_SECONDS,
	BASKETS_Y,
	basketsResult,
	fragmentAt,
	newBaskets,
	stepBaskets,
	tumbling,
	type BasketsEvent,
	type BasketsState,
	type Fragment,
} from "@/lib/beta/games/seven-baskets-rules";

/**
 * Seven Baskets Full (LC-17851), Matthew 15:32-38: a hillside at sunset, the
 * multitude sat down on the ground and filled. Broken bread and little fishes
 * tumble from the disciples' hands; hold ← → (or drag) to move the basket
 * under them. A gold ring on the grass shows where each one comes down. A
 * full basket is set down in its place along the bottom and the next comes.
 */

const SLOT_Y = 382;
const slotX = (index: number) => 44 + index * 52;

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

function drawBasket(context: CanvasRenderingContext2D, x: number, y: number, scale: number, fill: number, glow: boolean) {
	context.save();
	context.translate(x, y);
	context.scale(scale, scale);
	if (glow) {
		const halo = context.createRadialGradient(0, 8, 4, 0, 8, 52);
		halo.addColorStop(0, "rgba(255,214,120,.55)");
		halo.addColorStop(1, "rgba(255,214,120,0)");
		context.fillStyle = halo;
		context.fillRect(-56, -40, 112, 96);
	}
	// What is in it, heaped above the rim.
	if (fill > 0) {
		context.fillStyle = "#d9a35b";
		context.beginPath();
		context.ellipse(0, 2, BASKETS_HALF - 5, 3 + fill * 5, 0, Math.PI, Math.PI * 2);
		context.fill();
		context.fillStyle = "#b97a35";
		for (let bun = 0; bun < Math.min(6, Math.round(fill * 4)); bun++) {
			context.beginPath();
			context.ellipse(-16 + bun * 7, 1 - fill * 3 - (bun % 2) * 3, 5, 3.5, 0.3, 0, Math.PI * 2);
			context.fill();
		}
	}
	// The wicker: a tapered bowl with a woven rim.
	context.fillStyle = "#9c6a33";
	context.beginPath();
	context.moveTo(-BASKETS_HALF, 0);
	context.lineTo(BASKETS_HALF, 0);
	context.lineTo(BASKETS_HALF - 7, 30);
	context.lineTo(-BASKETS_HALF + 7, 30);
	context.closePath();
	context.fill();
	context.strokeStyle = "#7a4f22";
	context.lineWidth = 1.5;
	for (let row = 1; row <= 3; row++) {
		const ry = row * 7.5;
		const inset = (ry / 30) * 7;
		context.beginPath();
		context.moveTo(-BASKETS_HALF + inset, ry);
		context.lineTo(BASKETS_HALF - inset, ry);
		context.stroke();
	}
	for (let col = -3; col <= 3; col++) {
		context.beginPath();
		context.moveTo(col * 8, 0);
		context.lineTo(col * 6.5, 30);
		context.stroke();
	}
	context.fillStyle = "#c48a45";
	context.beginPath();
	context.roundRect(-BASKETS_HALF - 3, -4, BASKETS_HALF * 2 + 6, 7, 3.5);
	context.fill();
	context.restore();
}

function drawFragment(context: CanvasRenderingContext2D, fragment: Fragment, x: number, y: number, t: number) {
	context.save();
	context.translate(x, y);
	context.rotate((t - fragment.born) * (fragment.id % 2 ? 5 : -4));
	if (fragment.kind === "bread") {
		context.fillStyle = "#c98a3f";
		context.beginPath();
		context.moveTo(-9, 4);
		context.quadraticCurveTo(-10, -6, -2, -7);
		context.lineTo(4, -4);
		context.lineTo(9, -6);
		context.quadraticCurveTo(11, 3, 6, 6);
		context.closePath();
		context.fill();
		context.fillStyle = "#f2d9a8";
		context.beginPath();
		context.moveTo(-2, -7);
		context.lineTo(4, -4);
		context.lineTo(9, -6);
		context.lineTo(3, 0);
		context.closePath();
		context.fill();
	} else {
		context.fillStyle = "#b8c7cf";
		context.beginPath();
		context.ellipse(0, 0, 10, 4.5, 0, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.moveTo(-8, 0);
		context.lineTo(-14, -5);
		context.lineTo(-14, 5);
		context.closePath();
		context.fill();
		context.fillStyle = "#2a3238";
		context.beginPath();
		context.arc(6, -1, 1.2, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

function drawPerson(context: CanvasRenderingContext2D, x: number, foot: number, height: number, robe: string, head: string, armsOut: number) {
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - height * 0.17, foot);
	context.lineTo(x - height * 0.1, foot - height * 0.72);
	context.lineTo(x + height * 0.1, foot - height * 0.72);
	context.lineTo(x + height * 0.17, foot);
	context.closePath();
	context.fill();
	context.fillStyle = head;
	context.beginPath();
	context.arc(x, foot - height * 0.84, height * 0.12, 0, Math.PI * 2);
	context.fill();
	if (armsOut > 0) {
		context.strokeStyle = robe;
		context.lineWidth = height * 0.08;
		context.lineCap = "round";
		context.beginPath();
		context.moveTo(x - height * 0.08, foot - height * 0.62);
		context.lineTo(x - height * 0.24, foot - height * (0.5 + 0.12 * armsOut));
		context.moveTo(x + height * 0.08, foot - height * 0.62);
		context.lineTo(x + height * 0.24, foot - height * (0.5 + 0.12 * armsOut));
		context.stroke();
	}
}

export default function SevenBaskets({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<BasketsState>(newBaskets(seed));
	const drag = useRef<number | null>(null);
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const settling = useRef<{ from: number; slot: number; at: number }[]>([]);
	const flash = useRef<{ at: number; good: boolean } | null>(null);
	const ended = useRef(false);
	const lastData = useRef(-1);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, t: number) => {
		for (let i = 0; i < count; i++) {
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
			const power = speed * (0.4 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, born: t, life: 0.45 + Math.random() * 0.4, color: colors[i % colors.length], size: 1.5 + Math.random() * 2.2 });
		}
	}, []);

	const react = useCallback(
		(event: BasketsEvent, run: BasketsState) => {
			const play = synth.current;
			if (event.type === "gather") {
				burst(event.x, BASKETS_Y - 4, 10, ["#ffe2a0", "#ffffff", "#e8b766"], 120, run.t);
				flash.current = { at: run.t, good: true };
				play?.tone(520 + run.inBasket * 130, 0.12, { type: "triangle", volume: 0.15, to: 700 + run.inBasket * 130 });
			}
			if (event.type === "full") {
				settling.current.push({ from: run.basketX, slot: event.full - 1, at: run.t });
				floaters.current.push({ x: run.basketX, y: BASKETS_Y - 30, born: run.t, text: `${event.full} full!`, color: "#ffe2a0" });
				burst(run.basketX, BASKETS_Y, 20, ["#ffd36b", "#ffffff", "#ffb347"], 170, run.t);
				[784, 988, 1175].forEach((note, index) => play?.tone(note, 0.4, { type: "sine", volume: 0.12, delay: index * 0.06 }));
			}
			if (event.type === "lost") {
				burst(event.x, BASKETS_Y + 18, 6, ["#5d7a34", "#c98a3f"], 70, run.t);
				floaters.current.push({ x: event.x, y: BASKETS_Y + 4, born: run.t, text: "Lost", color: "#ffb4a0" });
				flash.current = { at: run.t, good: false };
				play?.noise(0.12, { volume: 0.12, filter: 500 });
			}
			if (event.type === "won") [523, 659, 784, 1047, 1319].forEach((note, index) => play?.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: 0.25 + index * 0.09 }));
			if (event.type === "timeup") play?.tone(260, 0.8, { type: "sine", volume: 0.16, to: 170 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		takePresses(keys);
		const left = keys.held.has("arrowleft");
		const right = keys.held.has("arrowright");
		const events: BasketsEvent[] = [];
		stepBaskets(run, { dir: (right ? 1 : 0) - (left ? 1 : 0), target: left || right ? null : drag.current }, events);
		for (const event of events) react(event, run);
		onTime(Math.max(0, BASKETS_SECONDS - run.t));
		const canvas = canvasRef.current;
		const tick = Math.floor(run.t * 10);
		if (canvas && tick !== lastData.current) {
			lastData.current = tick;
			canvas.dataset.basket = `${Math.round(run.basketX)},${run.full},${run.inBasket}`;
			canvas.dataset.drops = tumbling(run)
				.filter((fragment) => fragment.outcome === null)
				.map((fragment) => `${Math.round(fragment.landX)}@${(fragment.landAt - run.t).toFixed(2)}`)
				.join(" ");
		}
		const result = basketsResult(run);
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

			// Sunset over the mountain by the sea of Galilee (v29).
			const sky = context.createLinearGradient(0, 0, 0, 150);
			sky.addColorStop(0, "#3b2e5a");
			sky.addColorStop(0.55, "#d9645a");
			sky.addColorStop(1, "#ffb562");
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, 150);
			const sun = context.createRadialGradient(330, 112, 6, 330, 112, 60);
			sun.addColorStop(0, "rgba(255,236,170,1)");
			sun.addColorStop(0.3, "rgba(255,190,100,.7)");
			sun.addColorStop(1, "rgba(255,170,90,0)");
			context.fillStyle = sun;
			context.fillRect(260, 50, 140, 110);
			// The hillside, the ridge the disciples stand on, then the slope of the multitude.
			context.fillStyle = "#6b7a3a";
			context.beginPath();
			context.moveTo(0, 116);
			context.bezierCurveTo(90, 98, 170, 108, 230, 102);
			context.bezierCurveTo(300, 96, 360, 110, 400, 106);
			context.lineTo(400, STAGE);
			context.lineTo(0, STAGE);
			context.closePath();
			context.fill();
			const slope = context.createLinearGradient(0, 120, 0, STAGE);
			slope.addColorStop(0, "#8a8f43");
			slope.addColorStop(0.5, "#6f8a3c");
			slope.addColorStop(1, "#4f6e2e");
			context.fillStyle = slope;
			context.beginPath();
			context.moveTo(0, 132);
			context.bezierCurveTo(120, 120, 280, 126, 400, 122);
			context.lineTo(400, STAGE);
			context.lineTo(0, STAGE);
			context.closePath();
			context.fill();
			// The multitude, sat down on the ground in rows, warm in the last light.
			const robes = ["#7b4b3a", "#5a4a6a", "#8a6a3a", "#4a5a6a", "#6a3a3a"];
			for (let row = 0; row < 5; row++) {
				const y = 156 + row * 26;
				const size = 12 + row * 2.5;
				for (let seat = 0; seat < 13; seat++) {
					const x = ((seat * 33 + row * 17) % 420) - 10;
					const sway = Math.sin(still * 1.5 + seat + row) * 0.6;
					context.fillStyle = robes[(seat + row) % robes.length];
					context.beginPath();
					context.ellipse(x, y + sway, size * 0.5, size * 0.38, 0, Math.PI, Math.PI * 2);
					context.fill();
					context.fillStyle = "#a9785a";
					context.beginPath();
					context.arc(x, y - size * 0.5 + sway, size * 0.2, 0, Math.PI * 2);
					context.fill();
				}
			}
			context.fillStyle = "rgba(255,170,90,.12)";
			context.fillRect(0, 140, STAGE, 140);

			// Jesus on the ridge in soft light, who gave thanks and brake them (v36).
			const light = context.createRadialGradient(162, 60, 4, 162, 60, 54);
			light.addColorStop(0, "rgba(255,246,220,.95)");
			light.addColorStop(1, "rgba(255,246,220,0)");
			context.fillStyle = light;
			context.fillRect(100, 0, 124, 120);
			drawPerson(context, 162, 96, 46, "#fbf3e2", "#fbf3e2", 0.6);
			context.fillStyle = "#c8452f";
			context.fillRect(158, 68, 8, 22);
			// The disciples along the ridge; the one letting a fragment fall lifts his hands.
			const throwing = new Set(run.fragments.filter((fragment) => t >= fragment.born - 0.2 && t < fragment.born + 0.15).map((fragment) => fragment.from));
			BASKETS_DISCIPLES.forEach((x, index) => {
				const foot = BASKETS_HANDS_Y + 26 - (index === 2 ? 0 : 2);
				drawPerson(context, x, foot, 40, index % 2 ? "#5d4a3a" : "#4a3f55", "#a9785a", throwing.has(index) ? 1 : 0.2);
				if (throwing.has(index)) {
					context.fillStyle = "rgba(255,226,140,.5)";
					context.beginPath();
					context.arc(x, BASKETS_HANDS_Y - 2, 9, 0, Math.PI * 2);
					context.fill();
				}
			});

			// The grass the basket moves along, and the rings where fragments come down.
			context.fillStyle = "#4a6a2a";
			context.fillRect(0, BASKETS_Y + 26, STAGE, STAGE - BASKETS_Y);
			const inAir = tumbling(run);
			for (const fragment of inAir) {
				if (fragment.outcome !== null) continue;
				const flight = fragment.landAt - fragment.born;
				const left = Math.max(0, (fragment.landAt - t) / flight);
				context.strokeStyle = `rgba(255,214,102,${0.95 - left * 0.55})`;
				context.lineWidth = 3;
				context.beginPath();
				context.ellipse(fragment.landX, BASKETS_Y + 22, 8 + left * 20, 3 + left * 6, 0, 0, Math.PI * 2);
				context.stroke();
			}

			// The seven places along the bottom; full baskets are set down there.
			context.fillStyle = "rgba(30,40,16,.45)";
			context.fillRect(0, SLOT_Y - 20, STAGE, 40);
			for (let slot = 0; slot < BASKETS_COUNT; slot++) {
				const settled = settling.current.find((item) => item.slot === slot);
				const landed = settled && t - settled.at >= 0.45;
				if (landed) drawBasket(context, slotX(slot), SLOT_Y - 12, 0.62, 1, false);
				else {
					context.strokeStyle = slot === run.full ? "rgba(255,226,140,.85)" : "rgba(255,255,255,.3)";
					context.setLineDash([4, 4]);
					context.lineWidth = 2;
					context.strokeRect(slotX(slot) - 17, SLOT_Y - 12, 34, 22);
					context.setLineDash([]);
					context.fillStyle = slot === run.full ? "#ffe2a0" : "rgba(255,255,255,.55)";
					context.font = "800 12px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText(String(slot + 1), slotX(slot), SLOT_Y + 4);
				}
			}
			// A full basket being carried down to its place.
			for (const item of settling.current) {
				const age = (t - item.at) / 0.45;
				if (age >= 1) continue;
				const ease = 1 - (1 - age) * (1 - age);
				drawBasket(context, item.from + (slotX(item.slot) - item.from) * ease, BASKETS_Y + (SLOT_Y - 12 - BASKETS_Y) * ease - Math.sin(age * Math.PI) * 30, 1 - 0.38 * ease, 1, false);
			}

			// The basket being filled.
			const flashAge = flash.current ? t - flash.current.at : 9;
			drawBasket(context, run.basketX, BASKETS_Y, 1, run.inBasket / BASKETS_PER, flashAge < 0.2 && !!flash.current?.good);
			if (flashAge < 0.25 && flash.current && !flash.current.good) {
				context.strokeStyle = "rgba(255,120,90,.8)";
				context.lineWidth = 3;
				context.beginPath();
				context.roundRect(run.basketX - BASKETS_HALF - 6, BASKETS_Y - 8, BASKETS_HALF * 2 + 12, 44, 8);
				context.stroke();
			}
			// Pips for the fragments it still needs.
			for (let pip = 0; pip < BASKETS_PER; pip++) {
				context.fillStyle = pip < run.inBasket ? "#ffd36b" : "rgba(60,36,12,.55)";
				context.beginPath();
				context.arc(run.basketX - 12 + pip * 12, BASKETS_Y + 16, 4.5, 0, Math.PI * 2);
				context.fill();
			}

			// What is tumbling down.
			for (const fragment of inAir) {
				const at = fragmentAt(fragment, Math.min(t, fragment.landAt + 0.35));
				context.globalAlpha = fragment.outcome === "lost" ? Math.max(0, 1 - (t - fragment.landAt) / 0.35) : 1;
				drawFragment(context, fragment, at.x, Math.min(at.y, BASKETS_Y + 24), t);
				context.globalAlpha = 1;
			}

			particles.current = particles.current.filter((particle) => t - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = t - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x + particle.vx * age, particle.y + particle.vy * age + 280 * age * age, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			floaters.current = floaters.current.filter((floater) => t - floater.born < 0.8);
			context.textAlign = "center";
			context.font = "900 18px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = (t - floater.born) / 0.8;
				context.globalAlpha = 1 - age;
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 24);
			}
			context.globalAlpha = 1;

			// Baskets full, of seven.
			context.fillStyle = "rgba(40,24,40,.6)";
			context.beginPath();
			context.roundRect(10, 10, 150, 34, 12);
			context.fill();
			drawBasket(context, 30, 22, 0.42, 1, false);
			context.textAlign = "left";
			context.font = "900 18px system-ui, sans-serif";
			context.fillStyle = run.full >= BASKETS_COUNT ? "#ffe2a0" : "#ffffff";
			context.fillText(`${run.full}/${BASKETS_COUNT} full`, 50, 33);

			if (t < 2.2 && run.phase === "playing") {
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 7);
				context.strokeStyle = `rgba(255,226,140,${0.5 + 0.5 * pulse})`;
				context.lineWidth = 3;
				context.beginPath();
				context.ellipse(run.basketX, BASKETS_Y + 14, BASKETS_HALF + 26 + pulse * 6, 30 + pulse * 3, 0, 0, Math.PI * 2);
				context.stroke();
				context.fillStyle = "#ffe2a0";
				context.font = "900 26px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("◀", run.basketX - BASKETS_HALF - 52, BASKETS_Y + 24);
				context.fillText("▶", run.basketX + BASKETS_HALF + 52, BASKETS_Y + 24);
				context.fillStyle = "rgba(40,24,40,.6)";
				context.beginPath();
				context.roundRect(70, 236, 260, 34, 12);
				context.fill();
				context.fillStyle = "#ffffff";
				context.font = "900 16px system-ui, sans-serif";
				context.fillText(`Catch the fragments: ${BASKETS_PER} fill a basket`, 200, 258);
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,230,180,.22)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
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
			aria-label={`A hillside at sunset. Broken bread and little fishes tumble from the disciples' hands. Hold the left and right arrows, or drag, to move the basket under them; every ${BASKETS_PER} fill a basket. Fill all ${BASKETS_COUNT}.`}
		/>
	);
}
