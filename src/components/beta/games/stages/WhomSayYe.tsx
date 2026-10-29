"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	WHOM_REVEAL_WRONG,
	WHOM_ROLL,
	WHOM_ROUNDS,
	WHOM_SECONDS,
	newWhom,
	stepWhom,
	whomLayout,
	whomResult,
	whomTrueSlot,
	type WhomEvent,
	type WhomState,
} from "@/lib/beta/games/whom-say-ye-rules";

/**
 * Whom Say Ye? (LC-17851), Matthew 16:13-18: the coasts of Caesarea
 * Philippi under a great rock. The scrolls open, Peter's confession glowing
 * gold among what men said; they roll shut and shuffle; tap (or click, or
 * press its number) the true one.
 */

const ROW_Y = 236;
const DIGITS = ["1", "2", "3", "4"];

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	color: string;
	size: number;
}

function spacingFor(count: number) {
	return count === 3 ? 118 : 92;
}

function slotX(slot: number, count: number) {
	return 200 + (slot - (count - 1) / 2) * spacingFor(count);
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

/** A scroll on two wooden rollers: `open` 0 is rolled shut and tied, 1 is open with its words. */
function drawScroll(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	open: number,
	openWidth: number,
	label: string,
	{ glow = 0, wrong = false, number = 0 }: { glow?: number; wrong?: boolean; number?: number },
) {
	const half = 8 + (openWidth / 2 - 8) * open;
	const height = 188;
	if (glow > 0) {
		const aura = context.createRadialGradient(x, y, 10, x, y, 110);
		aura.addColorStop(0, `rgba(255,214,102,${0.75 * glow})`);
		aura.addColorStop(1, "rgba(255,214,102,0)");
		context.fillStyle = aura;
		context.fillRect(x - 120, y - 130, 240, 260);
	}
	if (open > 0.02) {
		if (glow > 0) {
			// The true answer: a gold frame and warm gold parchment, unmistakable.
			context.fillStyle = `rgba(255,200,60,${0.9 * glow})`;
			context.beginPath();
			context.roundRect(x - half - 12, y - height / 2 - 4, half * 2 + 24, height + 8, 10);
			context.fill();
		}
		context.fillStyle = glow > 0.3 ? "#ffefb8" : "#f4e6c3";
		context.fillRect(x - half, y - height / 2 + 8, half * 2, height - 16);
		context.fillStyle = "rgba(150,110,60,.18)";
		context.fillRect(x - half, y - height / 2 + 8, half * 2, 6);
		context.fillRect(x - half, y + height / 2 - 14, half * 2, 6);
		if (open > 0.55) {
			context.globalAlpha = Math.min(1, (open - 0.55) / 0.35);
			const isTrue = glow > 0;
			context.fillStyle = isTrue ? "#7a4a00" : "#3d2f22";
			context.font = `${isTrue ? 800 : 700} ${openWidth > 90 ? 15 : 13}px Georgia, 'Times New Roman', serif`;
			context.textAlign = "center";
			const lines = wrap(context, label, half * 2 - 12);
			const lineHeight = openWidth > 90 ? 18 : 16;
			lines.forEach((text, index) => context.fillText(text, x, y - ((lines.length - 1) * lineHeight) / 2 + index * lineHeight + 5));
			context.globalAlpha = 1;
		}
	}
	// The rollers, thicker as the parchment winds onto them.
	const wound = 5 + (1 - open) * 4;
	for (const side of [-1, 1]) {
		const rx = x + side * half;
		context.fillStyle = "#e9d6a8";
		context.fillRect(rx - wound, y - height / 2 + 8, wound * 2, height - 16);
		context.fillStyle = "#6b3f1d";
		context.fillRect(rx - 2.5, y - height / 2 - 4, 5, height + 8);
		context.fillStyle = "#d9a441";
		context.beginPath();
		context.arc(rx, y - height / 2 - 6, 5, 0, Math.PI * 2);
		context.arc(rx, y + height / 2 + 6, 5, 0, Math.PI * 2);
		context.fill();
	}
	if (open < 0.1) {
		// Tied shut with a cord, all alike.
		context.fillStyle = "#9e2f2a";
		context.fillRect(x - 16, y - 7, 32, 14);
		context.fillStyle = "#c9a227";
		context.beginPath();
		context.arc(x, y, 5, 0, Math.PI * 2);
		context.fill();
	}
	if (wrong) {
		context.strokeStyle = "#ff5a4a";
		context.lineWidth = 4;
		context.strokeRect(x - half - 14, y - height / 2 - 14, half * 2 + 28, height + 28);
	}
	if (number) {
		context.fillStyle = "rgba(20,24,40,.7)";
		context.beginPath();
		context.arc(x, y + height / 2 + 26, 11, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = "#fff4d6";
		context.font = "900 13px system-ui, sans-serif";
		context.textAlign = "center";
		context.fillText(String(number), x, y + height / 2 + 31);
	}
}

export default function WhomSayYe({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WhomState>(newWhom(seed));
	const taps = useRef<number[]>([]);
	const sparks = useRef<Spark[]>([]);
	const shake = useRef(0);
	const lastData = useRef("");
	const ended = useRef(false);
	const synth = useSynth(muted);

	const react = useCallback(
		(event: WhomEvent, run: WhomState) => {
			const play = synth.current;
			if (event.type === "show") [523, 659, 784].forEach((note, index) => play?.tone(note, 0.5, { type: "sine", volume: 0.07, delay: index * 0.04 }));
			if (event.type === "roll") play?.noise(0.22, { volume: 0.12, filter: 3000, type: "bandpass" });
			if (event.type === "swap") play?.noise(0.12, { volume: 0.09, filter: 1600, type: "bandpass" });
			if (event.type === "choose") play?.tone(880, 0.12, { type: "triangle", volume: 0.1 });
			if (event.type === "pick") {
				const count = WHOM_ROUNDS[run.round].scrolls;
				const x = slotX(run.picked?.slot ?? 0, count);
				if (event.right) {
					[587, 740, 880, 1175].forEach((note, index) => play?.tone(note, 0.7, { type: "triangle", volume: 0.12, delay: index * 0.07 }));
					for (let i = 0; i < 26; i++) {
						const angle = Math.random() * Math.PI * 2;
						const v = 60 + Math.random() * 90;
						sparks.current.push({ x, y: ROW_Y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 40, life: 0, max: 0.6 + Math.random() * 0.5, color: i % 2 ? "#ffd666" : "#fff6d6", size: 2 + Math.random() * 2.5 });
					}
				} else {
					play?.tone(150, 0.35, { type: "square", volume: 0.12, to: 90 });
					shake.current = run.t + 0.3;
				}
			}
			if (event.type === "won") [523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1.2, { type: "triangle", volume: 0.12, delay: 0.2 + index * 0.1 }));
			if (event.type === "lost") play?.tone(220, 0.8, { type: "sine", volume: 0.18, to: 120 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		for (const spark of sparks.current) {
			spark.life += 1 / 60;
			spark.x += spark.vx / 60;
			spark.y += spark.vy / 60;
			spark.vy += 140 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.life < spark.max);
		if (run.phase !== "playing") return;
		let pick: number | null = null;
		for (const key of takePresses(keys)) {
			const digit = DIGITS.indexOf(key);
			if (digit >= 0 && pick === null) pick = digit;
		}
		if (pick === null && taps.current.length) pick = taps.current.shift() ?? null;
		if (run.stage !== "choose") taps.current.length = 0;
		const events: WhomEvent[] = [];
		stepWhom(run, { pick }, events);
		for (const event of events) react(event, run);
		onTime(Math.max(0, WHOM_SECONDS - run.t));
		const data = `${run.stage}:${run.stage === "choose" ? whomTrueSlot(run) : ""}:${WHOM_ROUNDS[run.round].scrolls}:${run.right}/${run.misses}`;
		if (data !== lastData.current && canvasRef.current) {
			lastData.current = data;
			canvasRef.current.dataset.whom = data;
		}
		const result = whomResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const round = WHOM_ROUNDS[run.round];
			context.save();
			if (!reducedMotion && run.t < shake.current) context.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5);

			// Caesarea Philippi: morning over a great rock face and its grotto.
			const sky = context.createLinearGradient(0, 0, 0, 260);
			sky.addColorStop(0, "#5b7fa8");
			sky.addColorStop(1, "#c9d9e6");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 280);
			context.fillStyle = "#8f7d73";
			context.beginPath();
			context.moveTo(-10, 120);
			context.lineTo(40, 70);
			context.lineTo(120, 86);
			context.lineTo(190, 56);
			context.lineTo(280, 74);
			context.lineTo(350, 52);
			context.lineTo(410, 80);
			context.lineTo(410, 410);
			context.lineTo(-10, 410);
			context.fill();
			context.fillStyle = "#a8958a";
			for (const [bx, by, bw, bh] of [
				[10, 120, 90, 60],
				[110, 104, 110, 50],
				[240, 96, 140, 56],
				[30, 300, 120, 60],
				[260, 310, 130, 60],
			]) {
				context.beginPath();
				context.roundRect(bx, by, bw, bh, 10);
				context.fill();
			}
			context.fillStyle = "#3d3330";
			context.beginPath();
			context.moveTo(160, 360);
			context.lineTo(160, 150);
			context.quadraticCurveTo(200, 110, 240, 150);
			context.lineTo(240, 360);
			context.fill();
			context.fillStyle = "#6c5a52";
			context.fillRect(-10, 352, STAGE + 20, 60);
			context.fillStyle = "#7fb0c9";
			context.fillRect(-10, 380, STAGE + 20, 30);

			// The question, and the rounds answered.
			context.fillStyle = "rgba(20,24,40,.62)";
			context.beginPath();
			context.roundRect(46, 10, 308, 56, 16);
			context.fill();
			context.fillStyle = "#fff4d6";
			context.textAlign = "center";
			context.font = "italic 700 20px Georgia, 'Times New Roman', serif";
			context.fillText("“But whom say ye that I am?”", 200, 36);
			for (let i = 0; i < WHOM_ROUNDS.length; i++) {
				const x = 176 + i * 24;
				context.beginPath();
				context.arc(x, 52, 6, 0, Math.PI * 2);
				context.fillStyle = i < run.right ? "#ffd666" : i === run.round ? "rgba(255,244,214,.6)" : "rgba(255,244,214,.2)";
				context.fill();
			}
			for (let i = 0; i < run.misses; i++) {
				context.strokeStyle = "#ff6b5e";
				context.lineWidth = 2.5;
				const x = 254 + i * 14;
				context.beginPath();
				context.moveTo(x - 4, 48);
				context.lineTo(x + 4, 56);
				context.moveTo(x + 4, 48);
				context.lineTo(x - 4, 56);
				context.stroke();
			}

			// The scrolls.
			const count = round.scrolls;
			const openWidth = count === 3 ? 104 : 84;
			const elapsed = run.t - run.since;
			const layout = whomLayout(run);
			const trueSlot = whomTrueSlot(run);
			const picked = run.stage === "reveal" ? run.picked : null;
			for (const item of layout) {
				const x = 200 + (item.x - (count - 1) / 2) * spacingFor(count);
				const y = ROW_Y + item.lift * 48;
				const atSlot = Math.round(item.x);
				let open = 0;
				let glow = 0;
				let wrong = false;
				if (run.stage === "show") {
					open = 1;
					glow = item.scroll === 0 ? 0.75 + 0.25 * Math.sin(time * 6) : 0;
				} else if (run.stage === "roll") {
					open = Math.max(0, 1 - elapsed / WHOM_ROLL);
					glow = item.scroll === 0 ? open : 0;
				} else if (picked) {
					const reveal = Math.min(1, elapsed / 0.18);
					if (atSlot === picked.slot) {
						open = reveal;
						glow = picked.right ? 1 : 0;
						wrong = !picked.right;
					}
					if (!picked.right && atSlot === trueSlot) {
						open = Math.min(1, Math.max(0, (elapsed - 0.25) / 0.18));
						glow = open;
					}
				}
				drawScroll(context, x, y, open, openWidth, run.labels[item.scroll], { glow, wrong, number: run.stage === "choose" ? atSlot + 1 : 0 });
			}

			if (run.stage === "choose") {
				const pulse = 0.5 + 0.5 * Math.sin(time * 8);
				context.strokeStyle = `rgba(255,214,102,${0.35 + pulse * 0.5})`;
				context.lineWidth = 3;
				for (let slot = 0; slot < count; slot++) {
					const x = slotX(slot, count);
					context.beginPath();
					context.roundRect(x - 26, ROW_Y - 104, 52, 208, 12);
					context.stroke();
				}
				context.fillStyle = "rgba(20,24,40,.7)";
				context.beginPath();
				context.roundRect(90, 360, 220, 32, 16);
				context.fill();
				context.fillStyle = "#ffe08a";
				context.font = "900 17px system-ui, sans-serif";
				context.fillText("Tap the true answer", 200, 382);
			} else if (run.stage === "show") {
				context.fillStyle = "rgba(20,24,40,.7)";
				context.beginPath();
				context.roundRect(100, 360, 200, 32, 16);
				context.fill();
				context.fillStyle = "#ffe08a";
				context.font = "900 17px system-ui, sans-serif";
				context.fillText("Watch the gold one!", 200, 382);
			} else if (run.stage === "reveal" && picked) {
				context.fillStyle = picked.right ? "#ffe08a" : "#ff7a6b";
				context.strokeStyle = "rgba(20,24,40,.8)";
				context.lineWidth = 4;
				context.font = "900 20px system-ui, sans-serif";
				const label = picked.right ? "Thou art the Christ" : "Not that one: look again";
				context.strokeText(label, 200, 384);
				context.fillText(label, 200, 384);
				if (!picked.right) {
					context.fillStyle = "rgba(255,90,74,.85)";
					context.fillRect(0, 0, (STAGE * Math.max(0, WHOM_REVEAL_WRONG - elapsed)) / WHOM_REVEAL_WRONG, 4);
				}
			}

			for (const spark of sparks.current) {
				context.globalAlpha = Math.max(0, 1 - spark.life / spark.max);
				context.fillStyle = spark.color;
				context.beginPath();
				context.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,236,170,.2)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused || !canvasRef.current) return;
		const run = state.current;
		if (run.stage !== "choose") return;
		const point = stagePoint(canvasRef.current, event);
		const count = WHOM_ROUNDS[run.round].scrolls;
		if (point.y < ROW_Y - 130 || point.y > ROW_Y + 140) return;
		let best = -1;
		let distance = spacingFor(count) / 2 + 6;
		for (let slot = 0; slot < count; slot++) {
			const gap = Math.abs(point.x - slotX(slot, count));
			if (gap < distance) {
				best = slot;
				distance = gap;
			}
		}
		if (best >= 0) taps.current.push(best);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="Scrolls open, the true answer, Thou art the Christ, the Son of the living God, glowing gold among what men said. They roll shut and shuffle. Then tap the true one."
		/>
	);
}
