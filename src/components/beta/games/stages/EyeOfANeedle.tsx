"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	NEEDLE_BOTTOM,
	NEEDLE_COUNT,
	NEEDLE_HEAD_X,
	NEEDLE_SECONDS,
	NEEDLE_SPEED,
	NEEDLE_STEP,
	NEEDLE_STRANDS,
	NEEDLE_TOP,
	NEEDLE_WIDTH,
	needleResult,
	needleX,
	newNeedle,
	nextNeedle,
	stepNeedle,
	type Needle,
	type NeedleEvent,
	type NeedleState,
} from "@/lib/beta/games/eye-of-a-needle-rules";

/**
 * The Eye of a Needle (LC-17851), Matthew 19:23-26: a golden thread drawn
 * across linen through the eyes of great brass needles. Hold Space, ↑ or a
 * finger on the cloth to lift the thread; let go and it falls. The eyes
 * narrow as the round goes on; "with God all things are possible" (v26).
 */

const LIFT_KEYS = [" ", "arrowup"];
const TRAIL = 64;
const HINT_UNTIL = 1.6;
const LINEN = 14;
const PLUCK = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319, 1568];

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	color: string;
	size: number;
}

interface Flash {
	text: string;
	x: number;
	y: number;
	born: number;
	color: string;
}

function brass(context: CanvasRenderingContext2D, x: number, width: number) {
	const gradient = context.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
	gradient.addColorStop(0, "#6b4a17");
	gradient.addColorStop(0.28, "#c8952f");
	gradient.addColorStop(0.45, "#fbe7a6");
	gradient.addColorStop(0.62, "#d7a845");
	gradient.addColorStop(1, "#7c5719");
	return gradient;
}

/** A great brass needle standing across the cloth, its eye a slot at `eyeY`. */
function drawNeedle(context: CanvasRenderingContext2D, needle: Needle, index: number, x: number, shine: number) {
	const half = needle.half;
	const w = NEEDLE_WIDTH;
	const pointDown = index % 2 === 0;
	context.save();
	// A soft shadow on the linen.
	context.fillStyle = "rgba(92,64,24,.13)";
	context.fillRect(x - w / 2 + 6, 0, w, STAGE);
	context.fillStyle = brass(context, x, w);
	// The shaft, tapering to its point past one hem.
	context.beginPath();
	if (pointDown) {
		context.moveTo(x - w / 2, -4);
		context.lineTo(x + w / 2, -4);
		context.lineTo(x + w / 2, NEEDLE_BOTTOM + 4);
		context.lineTo(x, STAGE + 2);
		context.lineTo(x - w / 2, NEEDLE_BOTTOM + 4);
	} else {
		context.moveTo(x - w / 2, STAGE + 4);
		context.lineTo(x + w / 2, STAGE + 4);
		context.lineTo(x + w / 2, NEEDLE_TOP - 4);
		context.lineTo(x, -2);
		context.lineTo(x - w / 2, NEEDLE_TOP - 4);
	}
	context.closePath();
	context.fill();
	// The eye: a bulge in the shaft with a long slot through it.
	const bulge = w + 8;
	context.fillStyle = brass(context, x, bulge);
	context.beginPath();
	context.roundRect(x - bulge / 2, needle.eyeY - half - 10, bulge, half * 2 + 20, bulge / 2);
	context.fill();
	const slot = 12;
	context.fillStyle = "#efe2c4";
	context.beginPath();
	context.roundRect(x - slot / 2, needle.eyeY - half, slot, half * 2, slot / 2);
	context.fill();
	context.strokeStyle = "rgba(74,50,14,.55)";
	context.lineWidth = 1.5;
	context.stroke();
	// The highlight running down the shaft.
	context.fillStyle = "rgba(255,248,214,.55)";
	context.fillRect(x - w * 0.12, 0, 2, needle.eyeY - half - 12);
	context.fillRect(x - w * 0.12, needle.eyeY + half + 12, 2, STAGE - needle.eyeY - half - 12);
	if (needle.state === "snagged") {
		context.fillStyle = "rgba(150,48,30,.18)";
		context.fillRect(x - bulge / 2, 0, bulge, STAGE);
	}
	if (shine > 0) {
		const glow = context.createRadialGradient(x, needle.eyeY, 2, x, needle.eyeY, half + 40);
		glow.addColorStop(0, `rgba(255,246,200,${0.9 * shine})`);
		glow.addColorStop(1, "rgba(255,246,200,0)");
		context.fillStyle = glow;
		context.fillRect(x - half - 40, needle.eyeY - half - 40, (half + 40) * 2, (half + 40) * 2);
	}
	context.restore();
}

/** The strands left, as three short golden threads in the corner; a snapped one is broken and faded. */
function drawStrands(context: CanvasRenderingContext2D, strands: number, flash: number) {
	context.save();
	context.fillStyle = "rgba(60,42,16,.72)";
	context.beginPath();
	context.roundRect(10, 10, 104, 30, 15);
	context.fill();
	if (flash > 0) {
		context.strokeStyle = `rgba(236,96,64,${flash})`;
		context.lineWidth = 3;
		context.stroke();
	}
	context.lineCap = "round";
	for (let i = 0; i < NEEDLE_STRANDS; i++) {
		const x = 24 + i * 30;
		const alive = i < strands;
		context.strokeStyle = alive ? "#f3c759" : "rgba(243,199,89,.3)";
		context.lineWidth = 3.5;
		context.beginPath();
		if (alive) {
			context.moveTo(x, 25);
			context.bezierCurveTo(x + 6, 15, x + 12, 35, x + 18, 25);
		} else {
			context.moveTo(x, 25);
			context.quadraticCurveTo(x + 4, 19, x + 7, 23);
			context.moveTo(x + 11, 27);
			context.quadraticCurveTo(x + 14, 31, x + 18, 25);
		}
		context.stroke();
	}
	context.restore();
}

export default function EyeOfANeedle({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<NeedleState>(newNeedle(seed));
	const trail = useRef<number[]>(Array.from({ length: TRAIL }, () => state.current.y));
	const particles = useRef<Particle[]>([]);
	const flashes = useRef<Flash[]>([]);
	const shine = useRef<{ index: number; born: number }[]>([]);
	const snagAt = useRef(-10);
	const pointer = useRef(false);
	const ticks = useRef(0);
	const ended = useRef(false);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: NeedleEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "thread") {
				const note = PLUCK[event.index % PLUCK.length];
				play.tone(note, 0.35, { type: "triangle", volume: 0.18 });
				play.tone(note * 2, 0.18, { type: "sine", volume: 0.06, delay: 0.02 });
			}
			if (event.type === "snag") {
				play.tone(196, 0.42, { type: "sawtooth", volume: 0.13, to: 92 });
				play.noise(0.12, { volume: 0.12, filter: 2400, type: "bandpass" });
			}
			if (event.type === "won") [523, 659, 784, 1047, 1319].forEach((note, index) => play.tone(note, 1.3, { type: "triangle", volume: 0.15, delay: index * 0.1 }));
			if (event.type === "lost") play.tone(247, 0.9, { type: "sine", volume: 0.16, to: 123 });
		},
		[synth],
	);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const v = speed * (0.4 + Math.random() * 0.8);
			const max = 0.5 + Math.random() * 0.4;
			particles.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: max, max, color: colors[i % colors.length], size: 1.5 + Math.random() * 2 });
		}
	}, []);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const hold = pointer.current || LIFT_KEYS.some((key) => keys.held.has(key));
		takePresses(keys);
		const events: NeedleEvent[] = [];
		stepNeedle(run, { hold }, events);
		trail.current.push(run.y);
		if (trail.current.length > TRAIL) trail.current.shift();
		for (const event of events) {
			if (event.type === "thread") {
				const needle = run.needles[event.index];
				const x = needleX(needle, run.t);
				flashes.current.push({ text: "+1", x: x + 6, y: needle.eyeY - needle.half - 14, born: run.t, color: "#8a5a10" });
				shine.current.push({ index: event.index, born: run.t });
				burst(x, needle.eyeY, 14, ["#ffe7a0", "#f3c759", "#fff7da"], 70);
			}
			if (event.type === "snag") {
				snagAt.current = run.t;
				flashes.current.push({ text: "Snag!", x: NEEDLE_HEAD_X + 20, y: run.y - 18, born: run.t, color: "#9a3a22" });
				burst(NEEDLE_HEAD_X, run.y, 12, ["#e9b84c", "#b8873a", "#9a3a22"], 90);
			}
			if (event.type === "won") {
				const last = run.needles[NEEDLE_COUNT - 1];
				burst(needleX(last, run.t), last.eyeY, 30, ["#fff7da", "#ffe7a0", "#f3c759"], 110);
			}
			if (event.type === "lost") burst(NEEDLE_HEAD_X, run.y, 18, ["#e9b84c", "#9a3a22"], 70);
			sound(event);
		}
		for (const particle of particles.current) {
			particle.x += particle.vx * NEEDLE_STEP;
			particle.y += particle.vy * NEEDLE_STEP;
			particle.vy += 60 * NEEDLE_STEP;
			particle.life -= NEEDLE_STEP;
		}
		particles.current = particles.current.filter((particle) => particle.life > 0);
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			const next = nextNeedle(run);
			canvas.dataset.t = run.t.toFixed(2);
			canvas.dataset.y = run.y.toFixed(1);
			canvas.dataset.vy = run.vy.toFixed(1);
			canvas.dataset.nextEye = next ? String(next.eyeY) : "";
			canvas.dataset.strands = String(run.strands);
		}
		onTime(Math.max(0, NEEDLE_SECONDS - run.t));
		const result = needleResult(run);
		if (result && !ended.current) {
			ended.current = true;
			if (canvas) canvas.dataset.strands = String(run.strands);
			onEnd(result);
		}
	}, [burst, keys, onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const won = run.phase === "won";
			const lost = run.phase === "lost";
			const sinceSnag = run.t - snagAt.current;
			context.save();
			if (!reducedMotion && sinceSnag < 0.3 && run.phase === "playing") {
				const power = (1 - sinceSnag / 0.3) * 5;
				context.translate((Math.random() * 2 - 1) * power, (Math.random() * 2 - 1) * power);
			}

			// Parchment-coloured linen, its weave scrolling with the needles.
			const cloth = context.createLinearGradient(0, 0, 0, STAGE);
			cloth.addColorStop(0, "#f7eedb");
			cloth.addColorStop(0.5, "#f1e4c6");
			cloth.addColorStop(1, "#e8d5ad");
			context.fillStyle = cloth;
			context.fillRect(-8, -8, STAGE + 16, STAGE + 16);
			const offset = (run.t * NEEDLE_SPEED) % LINEN;
			context.lineWidth = 1;
			for (let pass = 0; pass < 2; pass++) {
				context.strokeStyle = pass ? "rgba(150,118,64,.05)" : "rgba(150,118,64,.1)";
				context.beginPath();
				for (let x = -offset + pass * (LINEN / 2); x < STAGE; x += LINEN) {
					context.moveTo(x, 0);
					context.lineTo(x, STAGE);
				}
				for (let y = 6 + pass * (LINEN / 2); y < STAGE; y += LINEN) {
					context.moveTo(0, y);
					context.lineTo(STAGE, y);
				}
				context.stroke();
			}
			// The hems top and bottom, with a running stitch.
			context.fillStyle = "rgba(176,138,74,.32)";
			context.fillRect(0, 0, STAGE, NEEDLE_TOP - 4);
			context.fillRect(0, NEEDLE_BOTTOM + 4, STAGE, STAGE - NEEDLE_BOTTOM - 4);
			context.strokeStyle = "rgba(120,84,30,.45)";
			context.setLineDash([8, 6]);
			context.lineDashOffset = offset;
			context.beginPath();
			context.moveTo(0, NEEDLE_TOP - 1);
			context.lineTo(STAGE, NEEDLE_TOP - 1);
			context.moveTo(0, NEEDLE_BOTTOM + 1);
			context.lineTo(STAGE, NEEDLE_BOTTOM + 1);
			context.stroke();
			context.setLineDash([]);

			// The needles, and a soft light in the next eye.
			const next = nextNeedle(run);
			shine.current = shine.current.filter((item) => run.t - item.born < 0.6);
			run.needles.forEach((needle, index) => {
				const x = needleX(needle, run.t);
				if (x < -40 || x > STAGE + 40) return;
				const lit = shine.current.find((item) => item.index === index);
				let glow = lit ? 1 - (run.t - lit.born) / 0.6 : 0;
				if (won && index === NEEDLE_COUNT - 1) glow = 0.85 + (reducedMotion ? 0 : 0.15 * Math.sin(time * 5));
				drawNeedle(context, needle, index, x, glow);
				if (needle === next && !won && !lost) {
					const early = run.t < HINT_UNTIL + 0.6;
					const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 6);
					const alpha = early ? 0.6 + 0.35 * pulse : 0.42 + 0.2 * pulse;
					const marker = context.createRadialGradient(x, needle.eyeY, 1, x, needle.eyeY, needle.half);
					marker.addColorStop(0, `rgba(255,214,102,${alpha})`);
					marker.addColorStop(1, "rgba(255,214,102,0)");
					context.fillStyle = marker;
					context.beginPath();
					context.ellipse(x, needle.eyeY, 14, needle.half, 0, 0, Math.PI * 2);
					context.fill();
					// A glowing outline round the next eye, ringing wider in the first moment.
					const ring = early ? 4 + 4 * pulse : 3 + 1.5 * pulse;
					context.strokeStyle = `rgba(255,190,50,${early ? 0.55 + 0.4 * pulse : 0.45 + 0.25 * pulse})`;
					context.lineWidth = early ? 3 : 2.5;
					context.beginPath();
					context.roundRect(x - (NEEDLE_WIDTH + 8) / 2 - ring, needle.eyeY - needle.half - 10 - ring, NEEDLE_WIDTH + 8 + ring * 2, needle.half * 2 + 20 + ring * 2, (NEEDLE_WIDTH + 8) / 2 + ring);
					context.stroke();
				}
			});

			// The thread: its tail is where the head has been, carried left with the cloth.
			const points = trail.current;
			const ripple = reducedMotion ? 0 : 1.2;
			const blink = run.t < run.guardUntil && run.phase === "playing" && Math.floor(run.t * 14) % 2 === 0;
			if (won) {
				// The thread glows: two soft golden halos along its length.
				context.lineCap = "round";
				context.lineJoin = "round";
				for (const [width, color] of [
					[22, "rgba(255,206,84,.22)"],
					[11, "rgba(255,196,64,.5)"],
				] as const) {
					context.strokeStyle = color;
					context.lineWidth = width;
					context.beginPath();
					points.forEach((y, i) => {
						const x = NEEDLE_HEAD_X - (points.length - 1 - i) * NEEDLE_SPEED * NEEDLE_STEP;
						if (i === 0) context.moveTo(x, y);
						else context.lineTo(x, y);
					});
					context.stroke();
				}
			}
			context.globalAlpha = blink ? 0.45 : 1;
			context.lineCap = "round";
			context.lineJoin = "round";
			for (const [width, color] of [
				[5.5, lost ? "#9b8a6a" : "#b8862a"],
				[3.2, lost ? "#c2b28c" : "#f0c24e"],
				[1.2, lost ? "#e4dac2" : "#fff3c2"],
			] as const) {
				context.strokeStyle = color;
				context.lineWidth = width;
				context.beginPath();
				points.forEach((y, i) => {
					const age = points.length - 1 - i;
					const x = NEEDLE_HEAD_X - age * NEEDLE_SPEED * NEEDLE_STEP;
					const wave = Math.sin(time * 4 + age * 0.35) * ripple * Math.min(1, age / 12);
					if (i === 0) context.moveTo(x, y + wave);
					else context.lineTo(x, y + wave);
				});
				context.stroke();
			}
			// The head: a bright bead of thread with a halo.
			const head = context.createRadialGradient(NEEDLE_HEAD_X, run.y, 0, NEEDLE_HEAD_X, run.y, won ? 26 : 13);
			head.addColorStop(0, "rgba(255,247,214,.95)");
			head.addColorStop(1, "rgba(255,214,102,0)");
			context.fillStyle = head;
			context.beginPath();
			context.arc(NEEDLE_HEAD_X, run.y, won ? 26 : 13, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = lost ? "#c2b28c" : "#ffe08a";
			context.beginPath();
			context.arc(NEEDLE_HEAD_X, run.y, 4.2, 0, Math.PI * 2);
			context.fill();
			context.globalAlpha = 1;

			// Sparkles and frayed fibres.
			for (const particle of particles.current) {
				context.globalAlpha = Math.max(0, particle.life / particle.max);
				context.fillStyle = particle.color;
				context.beginPath();
				context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;

			// "+1" and "Snag!" lift and fade.
			flashes.current = flashes.current.filter((item) => run.t - item.born < 0.8);
			context.textAlign = "center";
			for (const item of flashes.current) {
				const age = (run.t - item.born) / 0.8;
				context.globalAlpha = 1 - age;
				context.fillStyle = item.color;
				context.font = "900 20px system-ui, sans-serif";
				context.fillText(item.text, item.x, item.y - age * 22);
			}
			context.globalAlpha = 1;

			// "Hold to rise", pulsing beside the thread for the first moment.
			if (run.t < HINT_UNTIL && run.phase === "playing") {
				const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 7);
				const fade = Math.min(1, (HINT_UNTIL - run.t) / 0.3);
				context.globalAlpha = fade;
				const bx = NEEDLE_HEAD_X + 8;
				const by = Math.max(70, Math.min(340, run.y + 62));
				context.fillStyle = "rgba(60,42,16,.86)";
				context.beginPath();
				context.roundRect(bx - 74 * pulse, by - 19 * pulse, 148 * pulse, 38 * pulse, 19 * pulse);
				context.fill();
				context.strokeStyle = "#f3c759";
				context.lineWidth = 2.5;
				context.stroke();
				context.fillStyle = "#fff1c4";
				context.font = `900 ${Math.round(19 * pulse)}px system-ui, sans-serif`;
				context.fillText("▲ Hold to rise", bx, by + 7 * pulse);
				// A little arrow up from the hint to the thread.
				context.fillStyle = "rgba(60,42,16,.86)";
				context.beginPath();
				context.moveTo(bx - 8, by - 19 * pulse);
				context.lineTo(bx + 8, by - 19 * pulse);
				context.lineTo(NEEDLE_HEAD_X, by - 30 * pulse);
				context.closePath();
				context.fill();
				context.globalAlpha = 1;
			}

			// The snag flash over the whole cloth.
			if (sinceSnag < 0.25 && run.phase !== "won") {
				context.fillStyle = `rgba(190,70,40,${0.22 * (1 - sinceSnag / 0.25)})`;
				context.fillRect(-8, -8, STAGE + 16, STAGE + 16);
			}
			if (won) {
				const light = context.createRadialGradient(NEEDLE_HEAD_X, run.y, 10, NEEDLE_HEAD_X, run.y, 320);
				light.addColorStop(0, "rgba(255,246,210,.35)");
				light.addColorStop(1, "rgba(255,246,210,0)");
				context.fillStyle = light;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// The strands and the eyes threaded.
			drawStrands(context, run.strands, sinceSnag < 0.6 ? 1 - sinceSnag / 0.6 : 0);
			context.fillStyle = "rgba(60,42,16,.72)";
			context.beginPath();
			context.roundRect(STAGE - 118, 10, 108, 30, 15);
			context.fill();
			context.fillStyle = "#fff1c4";
			context.font = "800 15px system-ui, sans-serif";
			context.textAlign = "center";
			context.fillText(`Eyes ${run.threaded}/${NEEDLE_COUNT}`, STAGE - 64, 30);
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const press = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		pointer.current = true;
	};
	const release = () => {
		pointer.current = false;
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
			aria-label="A golden thread drawn through the eyes of great brass needles. Hold Space, the up arrow or a finger on the cloth to lift the thread; let go and it falls."
		/>
	);
}
