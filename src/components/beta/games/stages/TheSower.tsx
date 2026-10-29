"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SOWER_AHEAD,
	SOWER_CELL,
	SOWER_FLIGHT,
	SOWER_MAX_WASTED,
	SOWER_RAMP,
	SOWER_SECONDS,
	SOWER_SPEED,
	SOWER_WIN_SHARE,
	newSower,
	sowerCellAt,
	sowerGroundX,
	sowerMarkCell,
	sowerMarkX,
	sowerResult,
	sowerShare,
	stepSower,
	type SowerEvent,
	type SowerGround,
	type SowerState,
} from "@/lib/beta/games/the-sower-rules";

/**
 * The Sower (LC-17851), Matthew 13:3-9: a side view of the sower walking his
 * field on a harvest-gold morning while the ground passes beneath him. Space
 * or a tap scatters a handful of seed onto the spot the marker shows just
 * ahead: the dark good ground springs up; the way side feeds the fowls, the
 * stony places wither it and the thorns choke it.
 */

const SOW_KEYS = new Set([" "]);
const SOWER_X = 110;
const GROUND_Y = 282;
const MARK_X = SOWER_X + SOWER_AHEAD;

const GROUND_FILL: Record<SowerGround, string> = { wayside: "#d8c193", stony: "#9c8f80", thorns: "#6d6a3c", good: "#3a2414" };
const WASTE_WORD: Record<Exclude<SowerGround, "good">, string> = { wayside: "Devoured!", stony: "Withered!", thorns: "Choked!" };

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	age: number;
	color: string;
	size: number;
}

interface Word {
	text: string;
	x: number;
	y: number;
	age: number;
	color: string;
}

/** A handful of seed in the air, or its fate on the ground. */
interface Handful {
	t: number;
	at: number;
	ground: SowerGround;
	sowed: boolean;
	landed: boolean;
}

/** The time the marker reaches field x `x` (the round's clock). */
function markTimeFor(x: number) {
	const reach = x - SOWER_AHEAD;
	return (-SOWER_SPEED + Math.sqrt(SOWER_SPEED * SOWER_SPEED + 2 * SOWER_RAMP * reach)) / SOWER_RAMP;
}

function hash(n: number) {
	const s = Math.sin(n * 127.1) * 43758.5453;
	return s - Math.floor(s);
}

function drawSower(context: CanvasRenderingContext2D, x: number, y: number, walk: number, throwing: number) {
	const legA = Math.sin(walk) * 7;
	context.strokeStyle = "#4a3324";
	context.lineCap = "round";
	context.lineWidth = 6;
	context.beginPath();
	context.moveTo(x - 2, y - 30);
	context.lineTo(x - 2 + legA, y);
	context.moveTo(x + 2, y - 30);
	context.lineTo(x + 2 - legA, y);
	context.stroke();
	// Robe.
	context.fillStyle = "#8a5a36";
	context.beginPath();
	context.moveTo(x - 15, y - 22);
	context.lineTo(x - 10, y - 78);
	context.lineTo(x + 10, y - 78);
	context.lineTo(x + 16, y - 22);
	context.closePath();
	context.fill();
	context.fillStyle = "#6b4026";
	context.fillRect(x - 11, y - 56, 23, 5);
	// The seed bag on his hip.
	context.fillStyle = "#c9a46a";
	context.beginPath();
	context.ellipse(x - 12, y - 46, 9, 12, -0.3, 0, Math.PI * 2);
	context.fill();
	// Head and headcloth.
	context.fillStyle = "#c58f63";
	context.beginPath();
	context.arc(x + 1, y - 88, 9, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#efe2c4";
	context.beginPath();
	context.moveTo(x - 10, y - 86);
	context.quadraticCurveTo(x + 1, y - 104, x + 11, y - 88);
	context.lineTo(x + 2, y - 92);
	context.closePath();
	context.fill();
	// The throwing arm: back, then flung forward.
	const angle = -2.2 + throwing * 2.6;
	context.strokeStyle = "#8a5a36";
	context.lineWidth = 7;
	context.beginPath();
	context.moveTo(x + 4, y - 70);
	context.lineTo(x + 4 + Math.cos(angle) * 24, y - 70 + Math.sin(angle) * 24);
	context.stroke();
}

function drawBird(context: CanvasRenderingContext2D, x: number, y: number, flap: number, scale = 1) {
	context.fillStyle = "#262230";
	context.beginPath();
	context.ellipse(x, y, 7 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.arc(x + 6 * scale, y - 3 * scale, 3.4 * scale, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e0a43a";
	context.beginPath();
	context.moveTo(x + 9 * scale, y - 3 * scale);
	context.lineTo(x + 13 * scale, y - 2 * scale);
	context.lineTo(x + 9 * scale, y - 1 * scale);
	context.fill();
	context.strokeStyle = "#262230";
	context.lineWidth = 2.2 * scale;
	context.beginPath();
	context.moveTo(x - 2 * scale, y - 2 * scale);
	context.lineTo(x - 8 * scale, y - 2 * scale - flap * 8 * scale);
	context.stroke();
}

export default function TheSower({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<SowerState>(newSower(seed));
	const taps = useRef(0);
	const ended = useRef(false);
	const handfuls = useRef<Handful[]>([]);
	const sparks = useRef<Spark[]>([]);
	const words = useRef<Word[]>([]);
	const shake = useRef(0);
	const flash = useRef<{ color: string; age: number } | null>(null);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: SowerEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "throw") {
				play.noise(0.18, { volume: 0.16, filter: 4200, type: "highpass" });
				if (event.sowed) {
					play.tone(523, 0.18, { type: "triangle", volume: 0.16, delay: SOWER_FLIGHT });
					play.tone(784, 0.22, { type: "triangle", volume: 0.12, delay: SOWER_FLIGHT + 0.07 });
				} else if (event.ground === "wayside") {
					play.tone(1500, 0.08, { type: "square", volume: 0.06, to: 1900, delay: SOWER_FLIGHT });
					play.tone(1700, 0.08, { type: "square", volume: 0.06, to: 2200, delay: SOWER_FLIGHT + 0.1 });
				} else if (event.ground !== "good") play.tone(196, 0.3, { type: "sawtooth", volume: 0.1, to: 110, delay: SOWER_FLIGHT });
			}
			if (event.type === "end") {
				if (event.won) [392, 523, 659, 784].forEach((note, index) => play.tone(note, 1.2, { type: "triangle", volume: 0.14, delay: index * 0.1 }));
				else play.tone(247, 0.9, { type: "sine", volume: 0.16, to: 165 });
			}
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const pressed = takePresses(keys).some((key) => SOW_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const events: SowerEvent[] = [];
		stepSower(run, { sow: pressed }, events);
		for (const event of events) {
			if (event.type === "throw") handfuls.current.push({ t: run.t, at: event.at, ground: event.ground, sowed: event.sowed, landed: false });
			sound(event);
		}
		// Land the handfuls whose flight is over: sparks and a word for each.
		const ground = sowerGroundX(run.t);
		for (const handful of handfuls.current) {
			if (handful.landed || run.t - handful.t < SOWER_FLIGHT) continue;
			const x = handful.at - ground + SOWER_X;
			const good = handful.ground === "good";
			for (let i = 0; i < (good ? 14 : 8); i++) {
				sparks.current.push({
					x: x + (Math.random() - 0.5) * 18,
					y: GROUND_Y - 2,
					vx: (Math.random() - 0.5) * 70,
					vy: -40 - Math.random() * 90,
					life: 0.6,
					age: 0,
					color: good ? (i % 2 ? "#9be15d" : "#ffe08a") : handful.ground === "wayside" ? "#f3e3bd" : "#b9a58a",
					size: 2 + Math.random() * 2,
				});
			}
			if (good) words.current.push({ text: handful.sowed ? "Sown!" : "Sown already", x, y: GROUND_Y - 34, age: 0, color: handful.sowed ? "#c8ff8a" : "#f4ead2" });
			else {
				words.current.push({ text: WASTE_WORD[handful.ground as Exclude<SowerGround, "good">], x, y: GROUND_Y - 34, age: 0, color: "#ff8a7a" });
				flash.current = { color: "rgba(255,80,60,.22)", age: 0 };
				if (!reducedMotion) shake.current = 0.25;
			}
			handful.landed = true;
		}
		handfuls.current = handfuls.current.filter((handful) => run.t - handful.t < 2);
		for (const spark of sparks.current) {
			spark.age += 1 / 60;
			spark.x += spark.vx / 60;
			spark.y += spark.vy / 60;
			spark.vy += 260 / 60;
		}
		sparks.current = sparks.current.filter((spark) => spark.age < spark.life);
		for (const word of words.current) word.age += 1 / 60;
		words.current = words.current.filter((word) => word.age < 0.9);
		if (flash.current) {
			flash.current.age += 1 / 60;
			if (flash.current.age > 0.25) flash.current = null;
		}
		shake.current = Math.max(0, shake.current - 1 / 60);
		onTime(Math.max(0, SOWER_SECONDS - run.t));
		// For the proof driver: the clock and when the marker next reaches the middle of unsown good ground.
		ticks.current++;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			const mark = sowerMarkX(run.t);
			let i = sowerCellAt(mark);
			while (i < run.cells.length && !(run.cells[i] === "good" && !run.sown[i] && (i + 0.5) * SOWER_CELL >= mark)) i++;
			canvas.dataset.sow = `${run.t.toFixed(2)}|${markTimeFor((i + 0.5) * SOWER_CELL).toFixed(3)}`;
		}
		const result = sowerResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, reducedMotion, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const ground = sowerGroundX(run.t);
			context.save();
			if (shake.current > 0 && !reducedMotion) context.translate(Math.sin(time * 90) * shake.current * 10, 0);

			// A harvest-gold morning over the hills of Galilee.
			const sky = context.createLinearGradient(0, 0, 0, GROUND_Y);
			sky.addColorStop(0, "#8fc0dc");
			sky.addColorStop(0.65, "#f7e2a8");
			sky.addColorStop(1, "#f3c983");
			context.fillStyle = sky;
			context.fillRect(-20, 0, STAGE + 40, GROUND_Y);
			context.fillStyle = "rgba(255,247,214,.9)";
			context.beginPath();
			context.arc(300, 118, 24, 0, Math.PI * 2);
			context.fill();
			for (const [depth, color, height] of [
				[0.15, "#b9b48a", 70],
				[0.35, "#8f9a62", 44],
			] as const) {
				context.fillStyle = color;
				context.beginPath();
				context.moveTo(-10, GROUND_Y);
				for (let x = -10; x <= STAGE + 10; x += 10) {
					const wx = x + ground * depth;
					context.lineTo(x, GROUND_Y - 20 - height * (0.5 + 0.5 * Math.sin(wx / 70) * Math.cos(wx / 130)));
				}
				context.lineTo(STAGE + 10, GROUND_Y);
				context.fill();
			}

			// The field: cells of way side, stones, thorns and good ground.
			const first = Math.max(0, Math.floor((ground - SOWER_X) / SOWER_CELL) - 1);
			for (let i = first; i < run.cells.length; i++) {
				const x = i * SOWER_CELL - ground + SOWER_X;
				if (x > STAGE + 4) break;
				const kind = run.cells[i];
				context.fillStyle = GROUND_FILL[kind];
				context.fillRect(x, GROUND_Y, SOWER_CELL + 0.5, STAGE - GROUND_Y);
				const h = hash(i);
				if (kind === "good") {
					// Rich dark soil: furrows, a green band on top marking it.
					context.fillStyle = "#4e321c";
					for (let r = 0; r < 5; r++) context.fillRect(x, GROUND_Y + 12 + r * 22, SOWER_CELL, 5);
					context.fillStyle = "#5fbf3a";
					context.fillRect(x, GROUND_Y - 1, SOWER_CELL + 0.5, 5);
					if (run.sown[i]) {
						const sownAt = run.throws.find((item) => item.sowed && Math.floor(item.at / SOWER_CELL) === i)?.t ?? run.t;
						const grow = Math.min(1, Math.max(0, (run.t - sownAt - SOWER_FLIGHT) / 1.4));
						for (let s = 0; s < 3; s++) {
							const sx = x + 6 + s * 9;
							const height = 6 + grow * (22 + hash(i * 3 + s) * 10);
							context.strokeStyle = "#6fcf3d";
							context.lineWidth = 2.4;
							context.beginPath();
							context.moveTo(sx, GROUND_Y);
							context.lineTo(sx, GROUND_Y - height);
							context.stroke();
							if (grow > 0.6) {
								context.fillStyle = "#f2c94c";
								context.beginPath();
								context.ellipse(sx, GROUND_Y - height - 3, 2.6, 6, 0, 0, Math.PI * 2);
								context.fill();
							}
						}
					}
				} else if (kind === "wayside") {
					context.fillStyle = "#c4ab7a";
					context.beginPath();
					context.ellipse(x + 8 + h * 12, GROUND_Y + 14, 5, 2.5, 0, 0, Math.PI * 2);
					context.ellipse(x + 18 - h * 6, GROUND_Y + 30, 5, 2.5, 0, 0, Math.PI * 2);
					context.fill();
				} else if (kind === "stony") {
					context.fillStyle = "#c9c1b4";
					for (let s = 0; s < 3; s++) {
						context.beginPath();
						context.ellipse(x + 5 + s * 10 + h * 4, GROUND_Y + 2 + hash(i + s) * 6, 6 + hash(i * 7 + s) * 4, 4.5, 0, Math.PI, 0);
						context.fill();
					}
					context.fillStyle = "#7d7266";
					context.fillRect(x, GROUND_Y + 30, SOWER_CELL + 0.5, 70);
				} else {
					context.strokeStyle = "#3e3a1c";
					context.lineWidth = 2;
					context.beginPath();
					for (let s = 0; s < 2; s++) {
						const bx = x + 8 + s * 14;
						context.moveTo(bx, GROUND_Y + 2);
						for (let k = 1; k <= 5; k++) context.lineTo(bx + (k % 2 ? -6 : 6), GROUND_Y + 2 - k * 6);
					}
					context.stroke();
				}
			}

			// The fowls waiting on the way side.
			for (let i = first; i < run.cells.length; i++) {
				const x = i * SOWER_CELL - ground + SOWER_X + SOWER_CELL / 2;
				if (x > STAGE + 10) break;
				if (run.cells[i] !== "wayside" || hash(i * 11) > 0.55) continue;
				const hop = reducedMotion ? 0 : Math.abs(Math.sin(time * 5 + i)) * 2;
				drawBird(context, x, GROUND_Y - 30 - hash(i) * 14 - hop, reducedMotion ? 0.3 : 0.5 + 0.5 * Math.sin(time * 18 + i), 0.9);
			}

			// The marker: where the next handful lands, green over unsown good ground.
			const mark = sowerMarkCell(run);
			const ready = mark.ground === "good" && !mark.sown;
			const markColor = ready ? "#7dff6a" : mark.ground === "good" ? "#f4ead2" : "#ff6b5a";
			const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 10);
			context.strokeStyle = markColor;
			context.lineWidth = ready ? 4 : 2.5;
			context.setLineDash(ready ? [] : [5, 4]);
			context.beginPath();
			context.ellipse(MARK_X, GROUND_Y + 2, 16 + (ready ? pulse * 3 : 0), 6, 0, 0, Math.PI * 2);
			context.stroke();
			context.setLineDash([]);
			context.fillStyle = markColor;
			context.beginPath();
			context.moveTo(MARK_X - 9, GROUND_Y - 30);
			context.lineTo(MARK_X + 9, GROUND_Y - 30);
			context.lineTo(MARK_X, GROUND_Y - 16);
			context.closePath();
			context.fill();
			if (ready) {
				context.fillStyle = `rgba(125,255,106,${0.12 + pulse * 0.12})`;
				context.fillRect(MARK_X - SOWER_CELL / 2, GROUND_Y - 40, SOWER_CELL, 40);
			}

			// The sower, mid-stride, his arm flung after a throw.
			const sinceThrow = run.t - run.lastThrow;
			const throwing = run.lastThrow >= 0 && sinceThrow < 0.25 ? Math.min(1, sinceThrow / 0.1) : 0;
			drawSower(context, SOWER_X, GROUND_Y + 2, reducedMotion ? 0 : run.t * 9, throwing);

			// Handfuls in the air, and the fate of the wasted ones.
			for (const handful of handfuls.current) {
				const age = run.t - handful.t;
				const landX = handful.at - ground + SOWER_X;
				if (age < SOWER_FLIGHT) {
					const k = age / SOWER_FLIGHT;
					const fromX = SOWER_X + 24;
					const fromY = GROUND_Y - 92;
					const x = fromX + (landX - fromX) * k;
					const y = fromY + (GROUND_Y - 4 - fromY) * k - Math.sin(k * Math.PI) * 30;
					context.fillStyle = "#fff3c4";
					for (let s = 0; s < 6; s++) {
						context.beginPath();
						context.arc(x + (s - 2.5) * 3 * (0.5 + k), y + Math.sin(s * 2.1) * 3 * k, 1.8, 0, Math.PI * 2);
						context.fill();
					}
					continue;
				}
				const fate = age - SOWER_FLIGHT;
				if (fate > 1.4 || landX < -30) continue;
				if (handful.ground === "wayside") {
					// A fowl swoops down and away with it.
					const k = fate / 1.4;
					drawBird(context, landX - 40 + k * 90, GROUND_Y - 10 - Math.abs(Math.cos(k * Math.PI)) * 60 + 10, 0.5 + 0.5 * Math.sin(time * 22), 1.1);
				} else if (handful.ground === "stony" || handful.ground === "thorns") {
					// It springs up, then withers or is choked.
					const k = Math.min(1, fate / 0.35);
					const wilt = Math.max(0, (fate - 0.45) / 0.6);
					context.strokeStyle = wilt > 0 ? (handful.ground === "stony" ? "#c9a04a" : "#5b6b2a") : "#7bd148";
					context.lineWidth = 2.5;
					context.beginPath();
					context.moveTo(landX, GROUND_Y);
					context.quadraticCurveTo(landX + wilt * 10, GROUND_Y - 14 * k, landX + wilt * 14, GROUND_Y - 18 * k + wilt * 12);
					context.stroke();
					if (handful.ground === "thorns" && fate > 0.4) {
						context.strokeStyle = "#2e2a12";
						context.lineWidth = 2;
						context.beginPath();
						context.arc(landX + 4, GROUND_Y - 10, 9, 0, Math.PI * 2);
						context.stroke();
					}
				}
			}

			for (const spark of sparks.current) {
				context.globalAlpha = 1 - spark.age / spark.life;
				context.fillStyle = spark.color;
				context.fillRect(spark.x, spark.y, spark.size, spark.size);
			}
			context.globalAlpha = 1;
			context.textAlign = "center";
			context.font = "900 18px system-ui, sans-serif";
			for (const word of words.current) {
				context.globalAlpha = 1 - word.age / 0.9;
				context.lineWidth = 4;
				context.strokeStyle = "rgba(0,0,0,.55)";
				context.strokeText(word.text, word.x, word.y - word.age * 30);
				context.fillStyle = word.color;
				context.fillText(word.text, word.x, word.y - word.age * 30);
			}
			context.globalAlpha = 1;
			context.restore();

			if (flash.current) {
				context.fillStyle = flash.current.color;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			// The good ground sown, with the line to reach; and the waste allowed.
			context.fillStyle = "rgba(20,14,6,.55)";
			context.beginPath();
			context.roundRect(10, 10, 230, 50, 12);
			context.fill();
			context.fillStyle = "#fff";
			context.font = "800 13px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillText(`Good ground sown ${run.sownCount}/${run.goodTotal}`, 20, 29);
			context.fillStyle = "rgba(255,255,255,.18)";
			context.fillRect(20, 38, 210, 12);
			context.fillStyle = "#8be05a";
			context.fillRect(20, 38, 210 * Math.min(1, sowerShare(run)), 12);
			context.fillStyle = "#fff";
			context.fillRect(20 + 210 * SOWER_WIN_SHARE - 1, 34, 3, 20);
			context.fillStyle = "rgba(20,14,6,.55)";
			context.beginPath();
			context.roundRect(STAGE - 128, 10, 118, 50, 12);
			context.fill();
			context.fillStyle = "#fff";
			context.fillText("Wasted", STAGE - 118, 29);
			for (let i = 0; i < SOWER_MAX_WASTED + 1; i++) {
				const used = i < run.wasted;
				context.fillStyle = used ? "#ff6b5a" : i === SOWER_MAX_WASTED ? "rgba(255,107,90,.25)" : "rgba(255,255,255,.3)";
				context.beginPath();
				context.arc(STAGE - 110 + i * 22, 44, 7, 0, Math.PI * 2);
				context.fill();
			}

			// The first seconds: what to do, plainly.
			if (run.t < 2.2 && run.phase === "playing") {
				const alpha = run.t < 1.7 ? 1 : 1 - (run.t - 1.7) / 0.5;
				context.globalAlpha = alpha;
				context.fillStyle = "rgba(20,14,6,.7)";
				context.beginPath();
				context.roundRect(MARK_X - 20, 92, 200, 54, 12);
				context.fill();
				context.fillStyle = "#c8ff8a";
				context.font = "900 16px system-ui, sans-serif";
				context.fillText("Sow when the arrow", MARK_X - 8, 114);
				context.fillText("turns green", MARK_X - 8, 134);
				context.strokeStyle = "#7dff6a";
				context.lineWidth = 3;
				context.beginPath();
				context.arc(MARK_X, GROUND_Y - 6, 26 + (reducedMotion ? 0 : (time * 40) % 18), 0, Math.PI * 2);
				context.stroke();
				context.globalAlpha = 1;
			}
			if (run.phase === "won") {
				context.fillStyle = "rgba(255,240,170,.18)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (!paused) taps.current += 1;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A sower walks his field. Tap, or press Space, to scatter seed where the arrow points; sow only when it is green over the dark good ground."
		/>
	);
}
