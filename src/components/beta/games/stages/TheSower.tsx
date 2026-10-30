"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SOWER_BAG,
	SOWER_CELL,
	SOWER_COLS,
	SOWER_FIELD_BOTTOM,
	SOWER_FIELD_TOP,
	SOWER_GROUND_CODE,
	SOWER_ROWS,
	SOWER_SECONDS,
	SOWER_WIN_SHARE,
	newSower,
	sowerCellCentre,
	sowerResult,
	sowerShare,
	sowerSprayCells,
	stepSower,
	type SowerEvent,
	type SowerGround,
	type SowerState,
} from "@/lib/beta/games/the-sower-rules";

/**
 * The Sower (LC-17908), Matthew 13:3-9, seen from above: a patchwork field
 * of rich dark good ground in plots, a trodden way side where the fowls
 * wait, grey stony places and dark thorn bushes. The sower's hand moves over
 * it (the arrows, a finger, the mouse) and scatters seed while Space is held
 * or the finger is down. Good ground that takes the seed springs up and grows
 * toward the ear; seed on the way side the fowls swoop down and devour, on
 * the stones it springs up and withers, among the thorns it is choked. The
 * seed bag is shown, and runs dry.
 */

/** A finger hides what is under it: on touch the hand (and the seed) is this far above the finger. */
const FINGER_LIFT = 44;
/** The spray's reach drawn round the hand (two cells and a half). */
const SPRAY_RADIUS = 25;
/** Seconds a sown cell takes to grow from a shoot to a ripe ear. */
const GROW = 2.4;

const WORDS: Record<Exclude<SowerGround, "good">, string> = { wayside: "Devoured", stony: "Withered", thorns: "Choked" };

interface Grain {
	x: number;
	y: number;
	tx: number;
	ty: number;
	born: number;
	life: number;
}

interface Swoop {
	x: number;
	y: number;
	fromX: number;
	born: number;
}

interface Floater {
	text: string;
	x: number;
	y: number;
	born: number;
	color: string;
}

function hash(n: number) {
	const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return s - Math.floor(s);
}

/** The field drawn once per round: each ground with its texture, the plots' edges marked. */
function paintField(state: SowerState): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	const scale = 2;
	canvas.width = STAGE * scale;
	canvas.height = STAGE * scale;
	const context = canvas.getContext("2d");
	if (!context) return canvas;
	context.scale(scale, scale);
	const at = (c: number, r: number): SowerGround | null => (c < 0 || r < 0 || c >= SOWER_COLS || r >= SOWER_ROWS ? null : state.ground[r * SOWER_COLS + c]);
	const base: Record<SowerGround, string[]> = {
		good: ["#3b2414", "#3b2414", "#3b2414"],
		wayside: ["#cdb489", "#c9b085", "#d0b78c"],
		stony: ["#8c7f6c", "#8a7d6a", "#8e816e"],
		thorns: ["#56602f", "#515b2b", "#5b6533"],
	};
	for (let r = 0; r < SOWER_ROWS; r++) {
		for (let c = 0; c < SOWER_COLS; c++) {
			const kind = state.ground[r * SOWER_COLS + c];
			const x = c * SOWER_CELL;
			const y = SOWER_FIELD_TOP + r * SOWER_CELL;
			const h = hash(r * 97 + c);
			context.fillStyle = base[kind][Math.floor(h * 3)];
			context.fillRect(x, y, SOWER_CELL + 0.4, SOWER_CELL + 0.4);
		}
	}
	// Textures, cell by cell.
	for (let r = 0; r < SOWER_ROWS; r++) {
		for (let c = 0; c < SOWER_COLS; c++) {
			const kind = state.ground[r * SOWER_COLS + c];
			const x = c * SOWER_CELL;
			const y = SOWER_FIELD_TOP + r * SOWER_CELL;
			const h = hash(r * 131 + c * 7);
			const h2 = hash(r * 17 + c * 211);
			if (kind === "good") {
				// Rich dark earth turned in furrows, with crumbs and clods.
				context.fillStyle = "#2b190c";
				context.fillRect(x, y + 2.6, SOWER_CELL + 0.4, 1.1);
				context.fillRect(x, y + 7.6, SOWER_CELL + 0.4, 1.1);
				context.fillStyle = "rgba(110,72,40,.55)";
				context.fillRect(x, y + 3.7, SOWER_CELL + 0.4, 0.7);
				context.fillRect(x, y + 8.7, SOWER_CELL + 0.4, 0.7);
				for (let k = 0; k < 3; k++) {
					const cx = x + hash(r * 41 + c * 13 + k * 7) * 9.5;
					const cy = y + hash(r * 23 + c * 59 + k * 3) * 9.5;
					context.fillStyle = k === 0 ? "#6a4527" : k === 1 ? "#24140a" : "#4d311b";
					context.fillRect(cx, cy, 1.3, 1.1);
				}
			} else if (kind === "wayside") {
				// Trodden earth: footprints and pebbles.
				if (h < 0.3) {
					context.fillStyle = "#b29870";
					context.beginPath();
					context.ellipse(x + 3 + h2 * 4, y + 3 + h * 6, 1.8, 2.8, 0.4, 0, Math.PI * 2);
					context.fill();
				}
				if (h2 < 0.35) {
					context.fillStyle = "#e6d8b8";
					context.beginPath();
					context.arc(x + 2 + h * 6, y + 2 + h2 * 16, 1.1, 0, Math.PI * 2);
					context.fill();
				}
			} else if (kind === "stony") {
				// Grey rock showing through the thin earth, here and there.
				context.fillStyle = "#7b6f5e";
				context.fillRect(x + h2 * 8, y + h * 8, 1.2, 1.2);
				if (h < 0.5) {
					const rx = x + 2 + h2 * 6;
					const ry = y + 2 + h * 6;
					const size = 2.4 + h2 * 3.2;
					context.fillStyle = "#5f574b";
					context.beginPath();
					context.ellipse(rx + 0.8, ry + 1, size, size * 0.72, h * 3, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = h2 > 0.5 ? "#b9b1a4" : "#a8a093";
					context.beginPath();
					context.ellipse(rx, ry, size, size * 0.72, h * 3, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = "#d9d2c6";
					context.beginPath();
					context.ellipse(rx - size * 0.3, ry - size * 0.3, size * 0.4, size * 0.25, h * 3, 0, Math.PI * 2);
					context.fill();
				}
			} else if (h < 0.55) {
				// Thorn bushes: dark tangled clumps with spikes.
				const bx = x + 5 + (h2 - 0.5) * 4;
				const by = y + 5 + (h - 0.3) * 6;
				const size = 4.4 + h2 * 2.4;
				context.fillStyle = "#222b13";
				context.beginPath();
				context.arc(bx, by, size, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = "#151a0b";
				context.lineWidth = 0.9;
				context.beginPath();
				for (let k = 0; k < 7; k++) {
					const angle = (k / 7) * Math.PI * 2 + h * 6;
					context.moveTo(bx + Math.cos(angle) * size * 0.6, by + Math.sin(angle) * size * 0.6);
					context.lineTo(bx + Math.cos(angle) * (size + 2.6), by + Math.sin(angle) * (size + 2.6));
				}
				context.stroke();
				context.fillStyle = "#6f7d3a";
				context.beginPath();
				context.arc(bx - size * 0.35, by - size * 0.35, 1.2, 0, Math.PI * 2);
				context.arc(bx + size * 0.3, by - size * 0.1, 0.9, 0, Math.PI * 2);
				context.fill();
			}
		}
	}
	// The plots' edges: a dark line where one ground meets another, and a raised rim round the good ground.
	context.lineCap = "round";
	for (let r = 0; r < SOWER_ROWS; r++) {
		for (let c = 0; c < SOWER_COLS; c++) {
			const kind = at(c, r);
			const x = c * SOWER_CELL;
			const y = SOWER_FIELD_TOP + r * SOWER_CELL;
			for (const [dc, dr] of [
				[1, 0],
				[0, 1],
			] as const) {
				const other = at(c + dc, r + dr);
				if (!other || other === kind) continue;
				const good = kind === "good" || other === "good";
				context.strokeStyle = good ? "rgba(18,10,3,.75)" : "rgba(30,24,14,.35)";
				context.lineWidth = good ? 1.6 : 1;
				context.beginPath();
				if (dc) {
					context.moveTo(x + SOWER_CELL, y);
					context.lineTo(x + SOWER_CELL, y + SOWER_CELL);
				} else {
					context.moveTo(x, y + SOWER_CELL);
					context.lineTo(x + SOWER_CELL, y + SOWER_CELL);
				}
				context.stroke();
				if (good) {
					// The rim on the good side.
					const inside = kind === "good" ? -1 : 1;
					context.strokeStyle = "rgba(122,82,46,.8)";
					context.lineWidth = 1;
					context.beginPath();
					if (dc) {
						context.moveTo(x + SOWER_CELL + inside * 1.4, y);
						context.lineTo(x + SOWER_CELL + inside * 1.4, y + SOWER_CELL);
					} else {
						context.moveTo(x, y + SOWER_CELL + inside * 1.4);
						context.lineTo(x + SOWER_CELL, y + SOWER_CELL + inside * 1.4);
					}
					context.stroke();
				}
			}
		}
	}
	// The verge below the field: grass and a few lilies of the field.
	const verge = context.createLinearGradient(0, SOWER_FIELD_BOTTOM, 0, STAGE);
	verge.addColorStop(0, "#4e6b2a");
	verge.addColorStop(1, "#3b5420");
	context.fillStyle = verge;
	context.fillRect(0, SOWER_FIELD_BOTTOM, STAGE, STAGE - SOWER_FIELD_BOTTOM);
	context.strokeStyle = "#6f8f3a";
	context.lineWidth = 1.2;
	context.beginPath();
	for (let i = 0; i < 90; i++) {
		const x = hash(i * 3.3) * STAGE;
		const y = SOWER_FIELD_BOTTOM + 4 + hash(i * 5.1) * (STAGE - SOWER_FIELD_BOTTOM - 6);
		context.moveTo(x, y);
		context.lineTo(x + (hash(i) - 0.5) * 4, y - 5);
	}
	context.stroke();
	for (let i = 0; i < 9; i++) {
		const x = 18 + hash(i * 9.7) * (STAGE - 36);
		const y = SOWER_FIELD_BOTTOM + 10 + hash(i * 4.3) * 20;
		context.fillStyle = i % 3 ? "#efe6f7" : "#e8c6f0";
		for (let p = 0; p < 5; p++) {
			const angle = (p / 5) * Math.PI * 2;
			context.beginPath();
			context.arc(x + Math.cos(angle) * 2, y + Math.sin(angle) * 2, 1.6, 0, Math.PI * 2);
			context.fill();
		}
		context.fillStyle = "#f2c94c";
		context.beginPath();
		context.arc(x, y, 1.2, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "rgba(20,14,6,.45)";
	context.fillRect(0, SOWER_FIELD_BOTTOM, STAGE, 2);
	return canvas;
}

function drawBird(context: CanvasRenderingContext2D, x: number, y: number, flap: number, facing: number, scale = 1) {
	// A fowl from above: body, head and beak, the wings out in flight.
	context.save();
	context.translate(x, y);
	context.scale(facing * scale, scale);
	context.fillStyle = "rgba(0,0,0,.18)";
	context.beginPath();
	context.ellipse(2, 9, 7, 2.5, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#2a2632";
	const spread = 4 + flap * 9;
	context.beginPath();
	context.moveTo(-2, -1);
	context.quadraticCurveTo(-4, -spread, 3, -spread - 2);
	context.lineTo(2, -1);
	context.moveTo(-2, 1);
	context.quadraticCurveTo(-4, spread, 3, spread + 2);
	context.lineTo(2, 1);
	context.fill();
	context.fillStyle = "#34303d";
	context.beginPath();
	context.ellipse(0, 0, 7, 3.6, 0, 0, Math.PI * 2);
	context.fill();
	context.beginPath();
	context.arc(6.5, 0, 2.9, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e0a43a";
	context.beginPath();
	context.moveTo(9, -1.1);
	context.lineTo(12.4, 0);
	context.lineTo(9, 1.1);
	context.fill();
	context.fillStyle = "#f3eadb";
	context.beginPath();
	context.arc(7.2, -1, 0.7, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

function drawHand(context: CanvasRenderingContext2D, x: number, y: number, open: number) {
	// The sower's hand from above, the sleeve of his robe behind it; open while it scatters.
	context.save();
	context.translate(x, y);
	context.fillStyle = "rgba(0,0,0,.22)";
	context.beginPath();
	context.ellipse(4, 18, 13, 5, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#7a5233";
	context.beginPath();
	context.moveTo(4, -8);
	context.lineTo(38, -36);
	context.lineTo(46, -24);
	context.lineTo(12, 4);
	context.closePath();
	context.fill();
	context.fillStyle = "#e9dcc0";
	context.beginPath();
	context.moveTo(4, -8);
	context.lineTo(8, -11);
	context.lineTo(15, 1);
	context.lineTo(12, 4);
	context.closePath();
	context.fill();
	context.fillStyle = "#c99567";
	context.strokeStyle = "#8f6240";
	context.lineWidth = 1;
	context.beginPath();
	context.ellipse(0, 0, 9, 7.5, -0.6, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	// Fingers: curled round the seed, or spread as it falls.
	for (let f = 0; f < 4; f++) {
		const angle = 2.0 + f * 0.32 - open * 0.35 + f * open * 0.18;
		const reach = 8 + open * 5;
		context.beginPath();
		context.ellipse(Math.cos(angle) * reach, Math.sin(angle) * reach, 2.6, 4.2 + open * 1.2, angle + Math.PI / 2, 0, Math.PI * 2);
		context.fill();
		context.stroke();
	}
	context.beginPath();
	context.ellipse(-2 + open * 2, -8 - open * 2, 2.6, 4.6, -1.2 + open * 0.4, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	if (open < 0.5) {
		context.fillStyle = "#f6ebc8";
		context.beginPath();
		context.arc(-4, 4, 1.3, 0, Math.PI * 2);
		context.arc(-1, 6, 1.1, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

export default function TheSower({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<SowerState>(newSower(seed));
	const field = useRef<HTMLCanvasElement | null>(null);
	const press = useRef<{ id: number; x: number; y: number } | null>(null);
	const hover = useRef<{ x: number; y: number } | null>(null);
	/** A fresh press: the hand lets go of the last point before it heads for the new one. */
	const fresh = useRef(false);
	const ended = useRef(false);
	const endedAt = useRef<number | null>(null);
	const grains = useRef<Grain[]>([]);
	const swoops = useRef<Swoop[]>([]);
	const floaters = useRef<Floater[]>([]);
	const lastSound = useRef({ rustle: 0, sown: 0, wayside: -1, stony: -1, thorns: -1 });
	const lastWord = useRef<Record<string, number>>({});
	const reached = useRef(false);
	const lowAt = useRef<number | null>(null);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const react = useCallback(
		(event: SowerEvent, run: SowerState) => {
			const play = synth.current;
			const t = run.t;
			const heard = lastSound.current;
			if (event.type === "sown") {
				if (t - heard.sown > 0.07) {
					heard.sown = t;
					play?.tone(420 + sowerShare(run) * 620, 0.09, { type: "triangle", volume: 0.07 });
				}
				return;
			}
			if (event.type === "fate") {
				const kind = event.ground;
				if (kind === "wayside" && swoops.current.length < 6 && !swoops.current.some((swoop) => Math.hypot(swoop.x - event.x, swoop.y - event.y) < 26)) {
					swoops.current.push({ x: event.x, y: event.y, fromX: event.x < 200 ? -30 : STAGE + 30, born: t });
				}
				if (t - heard[kind] > 0.3) {
					heard[kind] = t;
					if (kind === "wayside") {
						play?.tone(1700, 0.07, { type: "square", volume: 0.035, to: 2300 });
						play?.tone(1900, 0.07, { type: "square", volume: 0.03, to: 2500, delay: 0.09 });
					} else if (kind === "stony") {
						play?.noise(0.12, { volume: 0.1, filter: 900 });
						play?.tone(260, 0.25, { type: "sine", volume: 0.07, to: 150 });
					} else {
						play?.tone(150, 0.22, { type: "sawtooth", volume: 0.05, to: 95 });
					}
				}
				if ((lastWord.current[kind] ?? -9) < t - 1.1 && (lastWord.current.any ?? -9) < t - 0.5) {
					lastWord.current[kind] = t;
					lastWord.current.any = t;
					floaters.current.push({ text: WORDS[kind], x: Math.max(44, Math.min(STAGE - 44, event.x)), y: event.y - 14, born: t, color: "#ffb3a3" });
				}
				return;
			}
			if (event.type === "low") {
				lowAt.current = t;
				play?.tone(660, 0.12, { type: "sine", volume: 0.12 });
				play?.tone(440, 0.18, { type: "sine", volume: 0.12, delay: 0.14 });
				return;
			}
			if (event.type === "end") {
				if (event.won) [392, 523, 659, 784, 1047].forEach((note, index) => play?.tone(note, 1.1, { type: "triangle", volume: 0.13, delay: index * 0.09 }));
				else {
					play?.tone(330, 0.5, { type: "sine", volume: 0.14, to: 220 });
					play?.tone(247, 0.8, { type: "sine", volume: 0.12, to: 165, delay: 0.3 });
				}
			}
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		takePresses(keys);
		const held = keys.held;
		const dx = (held.has("arrowright") ? 1 : 0) - (held.has("arrowleft") ? 1 : 0);
		const dy = (held.has("arrowdown") ? 1 : 0) - (held.has("arrowup") ? 1 : 0);
		if (dx || dy) hover.current = null;
		const touch = press.current;
		let target = dx || dy ? null : touch ? { x: touch.x, y: touch.y } : hover.current;
		// On a fresh press the hand stays put for one step, so it must not sow where the last press left it.
		const settling = fresh.current;
		if (settling) {
			fresh.current = false;
			target = null;
		}
		const events: SowerEvent[] = [];
		const wasSowing = run.sowing;
		stepSower(run, { dx, dy, target, sow: !settling && (held.has(" ") || !!touch) }, events);
		for (const event of events) react(event, run);

		// The seed in the air, from the open hand to the ground under it.
		if (run.sowing) {
			for (let i = 0; i < (reducedMotion ? 1 : 3); i++) {
				const angle = Math.random() * Math.PI * 2;
				const reach = Math.sqrt(Math.random()) * (SPRAY_RADIUS - 3);
				grains.current.push({ x: run.hand.x - 2 + (Math.random() - 0.5) * 6, y: run.hand.y - 18, tx: run.hand.x + Math.cos(angle) * reach, ty: run.hand.y + Math.sin(angle) * reach, born: run.t, life: 0.2 + Math.random() * 0.12 });
			}
			if (run.t - lastSound.current.rustle > 0.12) {
				lastSound.current.rustle = run.t;
				synth.current?.noise(0.09, { volume: wasSowing ? 0.05 : 0.08, filter: 5200, type: "highpass" });
			}
		}
		grains.current = grains.current.filter((grain) => run.t - grain.born < grain.life);
		swoops.current = swoops.current.filter((swoop) => run.t - swoop.born < 1.5);
		floaters.current = floaters.current.filter((floater) => run.t - floater.born < 1);
		if (!reached.current && sowerShare(run) >= SOWER_WIN_SHARE) {
			reached.current = true;
			floaters.current.push({ text: "Enough sown!", x: 200, y: SOWER_FIELD_TOP + 40, born: run.t, color: "#d8ff9c" });
			synth.current?.tone(880, 0.3, { type: "triangle", volume: 0.12 });
			synth.current?.tone(1320, 0.45, { type: "triangle", volume: 0.1, delay: 0.1 });
		}
		onTime(Math.max(0, SOWER_SECONDS - run.t));

		// For the proof driver: the hand, the bag and the share sown (every step), and the field a letter a cell, capital once sown.
		ticks.current++;
		const canvas = canvasRef.current;
		if (canvas) {
			canvas.dataset.sower = `${Math.round(run.hand.x)},${Math.round(run.hand.y)},${Math.round((100 * run.bag) / SOWER_BAG)},${Math.round(100 * sowerShare(run))},${run.phase}`;
			if (ticks.current % 6 === 1 || run.phase !== "playing") {
				let cells = "";
				for (let i = 0; i < run.ground.length; i++) {
					const code = SOWER_GROUND_CODE[run.ground[i]];
					cells += run.sownAt[i] >= 0 ? code.toUpperCase() : code;
				}
				canvas.dataset.cells = cells;
			}
		}
		const result = sowerResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [keys, onEnd, onTime, react, reducedMotion, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			if (!field.current) field.current = paintField(run);
			context.drawImage(field.current, 0, 0, STAGE, STAGE);
			if (run.phase !== "playing" && endedAt.current === null) endedAt.current = time;
			// A won field ripens all at once as the round closes.
			const ripen = run.phase === "won" && endedAt.current !== null ? Math.min(1, (time - endedAt.current) / 1.2) : 0;

			// The first seconds: the good ground glows warm, to show what to sow.
			if (t < 2.6 && run.phase === "playing") {
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 6);
				context.fillStyle = `rgba(255,214,130,${(0.1 + 0.16 * pulse) * Math.min(1, (2.6 - t) / 0.6)})`;
				for (let i = 0; i < run.ground.length; i++) {
					if (run.ground[i] !== "good") continue;
					context.fillRect((i % SOWER_COLS) * SOWER_CELL, SOWER_FIELD_TOP + Math.floor(i / SOWER_COLS) * SOWER_CELL, SOWER_CELL, SOWER_CELL);
				}
			}

			// Seed lying on the ground, the green of what is sown, and its fate on bad ground.
			const specks = new Path2D();
			const tint = new Path2D();
			const stalks = new Path2D();
			const ears = new Path2D();
			const withered = new Path2D();
			const choked = new Path2D();
			const sprung = new Path2D();
			for (let i = 0; i < run.ground.length; i++) {
				const amount = run.seed[i];
				if (amount <= 0) continue;
				const kind = run.ground[i];
				const x = (i % SOWER_COLS) * SOWER_CELL;
				const y = SOWER_FIELD_TOP + Math.floor(i / SOWER_COLS) * SOWER_CELL;
				const h = hash(i * 3.7);
				const h2 = hash(i * 9.1);
				if (kind === "good" && run.sownAt[i] >= 0) {
					const grow = Math.max(ripen, Math.min(1, (t - run.sownAt[i]) / GROW));
					tint.rect(x, y, SOWER_CELL, SOWER_CELL);
					for (let s = 0; s < 2; s++) {
						const sx = x + 2.5 + s * 5 + (h - 0.5) * 2;
						const sy = y + 8.5 - s * 2 + (h2 - 0.5);
						const height = 1.5 + grow * (6 + h * 2.5);
						stalks.moveTo(sx, sy);
						stalks.quadraticCurveTo(sx + (h2 - 0.5) * 2, sy - height * 0.6, sx + (h - 0.5) * 2, sy - height);
						if (grow < 0.55) {
							// Two leaves of a fresh shoot.
							stalks.moveTo(sx, sy - height * 0.5);
							stalks.lineTo(sx - 2.2, sy - height * 0.5 - 1.6);
							stalks.moveTo(sx, sy - height * 0.6);
							stalks.lineTo(sx + 2.2, sy - height * 0.6 - 1.6);
						} else {
							const ear = (grow - 0.55) / 0.45;
							const ex = sx + (h - 0.5) * 2;
							const ey = sy - height - 1.6 * ear;
							ears.moveTo(ex + 1.3 * ear + 0.4, ey);
							ears.ellipse(ex, ey, 1.3 * ear + 0.4, 2.6 * ear + 0.6, 0, 0, Math.PI * 2);
						}
					}
					continue;
				}
				const fate = run.fateAt[i];
				if (kind === "wayside" && fate >= 0 && t - fate > 0.9) continue; // the fowls have devoured it
				if ((kind === "stony" || kind === "thorns") && fate >= 0) {
					// It springs up at once, then is scorched and withers away, or the thorns spring up and choke it.
					const age = t - fate;
					const up = Math.min(1, age / 0.3);
					const sx = x + 5 + (h - 0.5) * 3;
					const sy = y + 8;
					const fade = Math.min(1, Math.max(0, (age - 0.35) / 0.6));
					const path = fade < 0.5 ? sprung : kind === "stony" ? withered : choked;
					const droop = kind === "stony" ? fade * 4 : fade * 1.5;
					path.moveTo(sx, sy);
					path.quadraticCurveTo(sx + droop * 0.5, sy - 5 * up, sx + droop, sy - 6 * up + droop * 1.4);
					if (kind === "thorns" && fade > 0.3) {
						choked.moveTo(sx - 3.5, sy - 1);
						choked.quadraticCurveTo(sx, sy - 7 - fade * 2, sx + 3.5, sy - 1);
						choked.moveTo(sx - 3, sy - 5);
						choked.lineTo(sx + 3, sy - 2);
					}
					continue;
				}
				// Loose seed: a few pale grains, more as it piles up.
				const count = Math.min(4, Math.ceil(amount * 4));
				for (let s = 0; s < count; s++) {
					const gx = x + 1.5 + hash(i * 7 + s) * 7;
					const gy = y + 1.5 + hash(i * 13 + s * 3) * 7;
					specks.moveTo(gx + 0.9, gy);
					specks.arc(gx, gy, 0.9, 0, Math.PI * 2);
				}
			}
			context.fillStyle = "rgba(96,168,58,.32)";
			context.fill(tint);
			context.fillStyle = "#f7ecc9";
			context.fill(specks);
			context.lineCap = "round";
			context.strokeStyle = ripen > 0.5 ? "#b8b04a" : "#82d24c";
			context.lineWidth = 1.3;
			context.stroke(stalks);
			context.fillStyle = "#f1c64a";
			context.fill(ears);
			context.strokeStyle = "#86d34e";
			context.lineWidth = 1.3;
			context.stroke(sprung);
			context.strokeStyle = "#c9a356";
			context.stroke(withered);
			context.strokeStyle = "#1b2210";
			context.lineWidth = 1.5;
			context.stroke(choked);

			// The fowls waiting on the way side, and those that come down to devour the seed.
			const still = reducedMotion ? 0 : time;
			run.fowls.forEach((fowl, index) => {
				const peck = Math.max(0, Math.sin(still * 3 + index * 1.7)) ** 6;
				drawBird(context, fowl.x + Math.sin(still * 0.7 + index) * 2, fowl.y - peck * 1.5, 0, index % 2 ? 1 : -1, 0.95);
			});
			for (const swoop of swoops.current) {
				const age = t - swoop.born;
				let x: number;
				let y: number;
				let flap: number;
				let facing: number;
				if (age < 0.45) {
					// Down out of the sky to the seed.
					const k = age / 0.45;
					const ease = 1 - (1 - k) * (1 - k);
					x = swoop.fromX + (swoop.x - swoop.fromX) * ease;
					y = swoop.y - 70 * (1 - ease);
					flap = 0.5 + 0.5 * Math.sin(age * 40);
					facing = swoop.fromX < swoop.x ? 1 : -1;
				} else if (age < 0.95) {
					// Devouring it.
					x = swoop.x;
					y = swoop.y + Math.abs(Math.sin(age * 22)) * 1.5;
					flap = 0;
					facing = swoop.fromX < swoop.x ? 1 : -1;
				} else {
					// And away.
					const k = (age - 0.95) / 0.55;
					facing = swoop.fromX < swoop.x ? 1 : -1;
					x = swoop.x + facing * 110 * k * k;
					y = swoop.y - 90 * k;
					flap = 0.5 + 0.5 * Math.sin(age * 40);
				}
				drawBird(context, x, y, flap, facing, 1.05);
			}

			// The spray under the hand: green over good ground, warm over the rest.
			const hand = run.hand;
			if (run.phase === "playing") {
				const under = sowerSprayCells(hand.x, hand.y);
				const good = under.filter((cell) => run.ground[cell] === "good").length / Math.max(1, under.length);
				const onGood = good >= 0.6;
				context.lineWidth = run.sowing ? 2.4 : 1.6;
				context.setLineDash(run.sowing ? [] : [4, 4]);
				context.strokeStyle = onGood ? (run.sowing ? "rgba(190,255,140,.95)" : "rgba(190,255,140,.6)") : run.sowing ? "rgba(255,150,110,.95)" : "rgba(255,230,190,.55)";
				context.beginPath();
				context.arc(hand.x, hand.y, SPRAY_RADIUS, 0, Math.PI * 2);
				context.stroke();
				context.setLineDash([]);
				if (run.sowing) {
					context.fillStyle = onGood ? "rgba(190,255,140,.12)" : "rgba(255,120,90,.14)";
					context.beginPath();
					context.arc(hand.x, hand.y, SPRAY_RADIUS, 0, Math.PI * 2);
					context.fill();
				}
			}
			context.fillStyle = "#fff6d6";
			for (const grain of grains.current) {
				const k = Math.min(1, (t - grain.born) / grain.life);
				const x = grain.x + (grain.tx - grain.x) * k;
				const y = grain.y + (grain.ty - grain.y) * k * k;
				context.beginPath();
				context.arc(x, y, 1.5 - k * 0.5, 0, Math.PI * 2);
				context.fill();
			}
			drawHand(context, hand.x + 3, hand.y - 22, run.sowing ? 1 : 0);

			// Words over the field.
			context.textAlign = "center";
			context.font = "900 15px system-ui, sans-serif";
			for (const floater of floaters.current) {
				const age = t - floater.born;
				context.globalAlpha = Math.max(0, 1 - age);
				context.lineWidth = 4;
				context.strokeStyle = "rgba(20,12,4,.7)";
				context.strokeText(floater.text, floater.x, floater.y - age * 18);
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 18);
			}
			context.globalAlpha = 1;

			// The HUD: the good ground sown (with the share to reach), and the seed left in the bag.
			context.fillStyle = "#1c130a";
			context.fillRect(0, 0, STAGE, SOWER_FIELD_TOP);
			context.fillStyle = "rgba(255,230,180,.12)";
			context.fillRect(0, SOWER_FIELD_TOP - 1.5, STAGE, 1.5);
			const share = sowerShare(run);
			context.textAlign = "left";
			context.font = "800 10px system-ui, sans-serif";
			context.fillStyle = "#e9dcc0";
			context.fillText("GOOD GROUND SOWN", 12, 14);
			context.fillStyle = "rgba(255,255,255,.14)";
			context.beginPath();
			context.roundRect(12, 20, 196, 14, 7);
			context.fill();
			context.fillStyle = share >= SOWER_WIN_SHARE ? "#e8c64a" : "#7cc84a";
			context.beginPath();
			context.roundRect(12, 20, Math.max(14, 196 * Math.min(1, share)), 14, 7);
			context.fill();
			const mark = 12 + 196 * SOWER_WIN_SHARE;
			context.fillStyle = "#fff";
			context.fillRect(mark - 1, 17, 2.5, 20);
			context.font = "900 15px system-ui, sans-serif";
			context.fillStyle = "#fff";
			context.fillText(`${Math.round(share * 100)}%`, 216, 32);

			const bag = run.bag / SOWER_BAG;
			const low = bag <= 0.25;
			const blink = low && !reducedMotion ? 0.55 + 0.45 * Math.sin(time * 12) : 1;
			// The seed bag: a sack tied at the neck, filled to what is left.
			const sx = 286;
			context.fillStyle = "#b08d5a";
			context.beginPath();
			context.moveTo(sx - 9, 13);
			context.quadraticCurveTo(sx - 15, 36, sx, 38);
			context.quadraticCurveTo(sx + 15, 36, sx + 9, 13);
			context.closePath();
			context.fill();
			context.save();
			context.beginPath();
			context.rect(sx - 16, 38 - 25 * bag, 32, 25 * bag);
			context.clip();
			context.fillStyle = low ? `rgba(255,140,110,${blink})` : "#f3e2b3";
			context.beginPath();
			context.moveTo(sx - 9, 13);
			context.quadraticCurveTo(sx - 15, 36, sx, 38);
			context.quadraticCurveTo(sx + 15, 36, sx + 9, 13);
			context.closePath();
			context.fill();
			context.restore();
			context.strokeStyle = "#6b4f2c";
			context.lineWidth = 1.5;
			context.beginPath();
			context.moveTo(sx - 9, 13);
			context.quadraticCurveTo(sx - 15, 36, sx, 38);
			context.quadraticCurveTo(sx + 15, 36, sx + 9, 13);
			context.stroke();
			context.beginPath();
			context.moveTo(sx - 7, 11);
			context.lineTo(sx + 7, 11);
			context.stroke();
			context.textAlign = "left";
			context.font = "800 10px system-ui, sans-serif";
			context.fillStyle = "#e9dcc0";
			context.fillText("SEED", 304, 14);
			context.fillStyle = "rgba(255,255,255,.14)";
			context.beginPath();
			context.roundRect(304, 20, 84, 14, 7);
			context.fill();
			if (bag > 0) {
				context.fillStyle = low ? `rgba(255,120,90,${blink})` : "#f3e2b3";
				context.beginPath();
				context.roundRect(304, 20, Math.max(14, 84 * bag), 14, 7);
				context.fill();
			}

			// The first seconds: what to do, plainly.
			if (t < 2.6 && run.phase === "playing") {
				context.globalAlpha = Math.min(1, (2.6 - t) / 0.5);
				context.fillStyle = "rgba(20,12,4,.78)";
				context.beginPath();
				context.roundRect(88, SOWER_FIELD_TOP + 10, 224, 30, 10);
				context.fill();
				context.textAlign = "center";
				context.font = "900 15px system-ui, sans-serif";
				context.fillStyle = "#c8ff9a";
				context.fillText("Sow the good ground", 200, SOWER_FIELD_TOP + 30);
				context.globalAlpha = 1;
			}
			if (lowAt.current !== null && t - lowAt.current < 1.4 && run.phase === "playing") {
				context.globalAlpha = Math.max(0, 1 - (t - lowAt.current) / 1.4);
				context.textAlign = "center";
				context.font = "900 15px system-ui, sans-serif";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(20,12,4,.75)";
				context.strokeText("Seed running low", 200, SOWER_FIELD_TOP + 26);
				context.fillStyle = "#ffb3a3";
				context.fillText("Seed running low", 200, SOWER_FIELD_TOP + 26);
				context.globalAlpha = 1;
			}
			if (run.phase === "won") {
				context.fillStyle = `rgba(255,232,160,${0.2 * ripen})`;
				context.fillRect(0, 0, STAGE, STAGE);
			} else if (run.phase === "lost") {
				context.fillStyle = "rgba(10,8,14,.3)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (!canvas || paused) return;
		canvas.setPointerCapture?.(event.pointerId);
		const point = stagePoint(canvas, event);
		const lift = event.pointerType === "touch" ? FINGER_LIFT : 0;
		press.current = { id: event.pointerId, x: point.x, y: point.y - lift };
		hover.current = null;
		fresh.current = true;
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const point = stagePoint(canvas, event);
		const held = press.current;
		if (held && held.id === event.pointerId) {
			const lift = event.pointerType === "touch" ? FINGER_LIFT : 0;
			held.x = point.x;
			held.y = point.y - lift;
		} else if (!held && event.pointerType === "mouse") hover.current = point; // the mouse steers the hand, and sows while pressed
	};
	const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (press.current?.id !== event.pointerId) return;
		press.current = null;
		if (event.pointerType === "mouse") {
			const canvas = canvasRef.current;
			if (canvas) hover.current = stagePoint(canvas, event);
		}
	};
	const onPointerLeave = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (event.pointerType === "mouse" && !press.current) hover.current = null;
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onPointerLeave={onPointerLeave}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A field seen from above: dark good ground in plots, a trodden way side where the fowls wait, stony places and thorns. Move the sower's hand with the arrow keys and hold Space to scatter seed, or drag a finger or the mouse to sow under the hand. Sow the good ground and lift over the rest: the seed bag runs dry."
		/>
	);
}
