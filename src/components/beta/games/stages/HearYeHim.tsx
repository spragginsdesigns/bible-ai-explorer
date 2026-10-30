"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	HEAR_HALF,
	HEAR_MARKS,
	HEAR_SECONDS,
	HEAR_SUMMIT,
	hearResult,
	ledgeX,
	newHear,
	stepHear,
	type HearEvent,
	type HearState,
	type Ledge,
} from "@/lib/beta/games/hear-ye-him-rules";

/**
 * Hear Ye Him (LC-17908), Matthew 17:1-8. Peter climbing "an high mountain
 * apart" (v1) at evening, the sky brightening toward the summit, where the
 * bright cloud rests. He springs by himself from each ledge of rock; ← → (or
 * holding a side of the picture) steer him. At the summit: Jesus transfigured,
 * "his raiment was white as the light" (v2), a figure of light with no face;
 * Moses and Elias as robed figures (v3); the bright cloud overshadowing them
 * (v5); then "they saw no man, save Jesus only" (v8). The voice out of the
 * cloud is only light; the Father is never drawn.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, sans-serif";
const OUTRO_WON = 270;
const OUTRO_LOST = 60;
const ROBE = "#8a5b36";

interface Chip {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	size: number;
}

const smooth = (value: number) => {
	const clamped = Math.max(0, Math.min(1, value));
	return clamped * clamped * (3 - 2 * clamped);
};

/** A ledge of rock, drawn with its top at `top` on screen. */
function ledge(context: CanvasRenderingContext2D, item: Ledge, x: number, top: number, time: number, reducedMotion: boolean) {
	const left = x - item.w / 2;
	if (item.kind === "loose") {
		// Loose stones, small and cracked.
		const stones = 5;
		const size = item.w / stones;
		for (let i = 0; i < stones; i++) {
			const sx = left + i * size;
			const lift = (i % 2) * 1.5;
			context.fillStyle = i % 2 ? "#8a7b6a" : "#7a6c5c";
			context.beginPath();
			context.roundRect(sx + 0.5, top - 1 + lift, size - 1, 10 - lift, 3);
			context.fill();
			context.fillStyle = "rgba(255,240,210,.25)";
			context.fillRect(sx + 2, top - 1 + lift, size - 4, 1.5);
		}
		context.strokeStyle = "rgba(30,22,16,.6)";
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(left + item.w * 0.35, top);
		context.lineTo(left + item.w * 0.42, top + 8);
		context.moveTo(left + item.w * 0.7, top + 1);
		context.lineTo(left + item.w * 0.64, top + 9);
		context.stroke();
		return;
	}
	const ground = item.kind === "ground";
	const depth = ground ? 60 : item.kind === "narrow" ? 12 : 15;
	const body = context.createLinearGradient(0, top, 0, top + depth);
	body.addColorStop(0, item.kind === "wind" ? "#9aa6b4" : "#a39178");
	body.addColorStop(1, item.kind === "wind" ? "#4c5664" : "#54473a");
	context.fillStyle = body;
	context.beginPath();
	context.moveTo(left, top);
	context.lineTo(left + item.w, top);
	context.lineTo(left + item.w - 6, top + depth * 0.7);
	context.quadraticCurveTo(x, top + depth + 4, left + 6, top + depth * 0.7);
	context.closePath();
	context.fill();
	context.fillStyle = "rgba(255,244,214,.45)";
	context.fillRect(left + 2, top, item.w - 4, 2);
	if (item.kind === "wind") {
		// The wind across it: streaks drifting the way it moves.
		const drift = reducedMotion ? 0 : (time * 60) % 30;
		context.strokeStyle = "rgba(220,236,255,.55)";
		context.lineWidth = 1.4;
		for (let i = 0; i < 3; i++) {
			const sy = top - 7 - i * 5;
			const sx = left - 6 + ((i * 17 + drift) % (item.w + 12));
			context.beginPath();
			context.moveTo(sx, sy);
			context.lineTo(sx + 14, sy);
			context.stroke();
		}
	}
}

/** Peter: a robed figure, no face; he squashes as he springs and leans as he steers. */
function peter(context: CanvasRenderingContext2D, x: number, feet: number, vy: number, vx: number, squash: number) {
	context.save();
	context.translate(x, feet);
	context.rotate(Math.max(-0.25, Math.min(0.25, vx / 900)));
	const stretch = 1 + Math.max(-0.12, Math.min(0.12, vy / 5000)) - squash * 0.22;
	context.scale(1 + squash * 0.18, stretch);
	context.fillStyle = ROBE;
	context.beginPath();
	context.moveTo(-HEAR_HALF - 1, 0);
	context.lineTo(-6, -24);
	context.quadraticCurveTo(0, -29, 6, -24);
	context.lineTo(HEAR_HALF + 1, 0);
	context.closePath();
	context.fill();
	context.fillStyle = "#3f5f7a";
	context.fillRect(-6, -22, 12, 4);
	// Arms: up while he rises, out while he falls.
	context.strokeStyle = ROBE;
	context.lineWidth = 3.5;
	context.lineCap = "round";
	context.beginPath();
	const lift = vy > 0 ? -12 : -2;
	context.moveTo(-5, -20);
	context.lineTo(-11, -20 + lift);
	context.moveTo(5, -20);
	context.lineTo(11, -20 + lift);
	context.stroke();
	context.fillStyle = "#c69a72";
	context.beginPath();
	context.arc(0, -31, 5.5, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e3d6bc";
	context.beginPath();
	context.arc(0, -32, 6, Math.PI * 0.95, Math.PI * 2.05);
	context.lineTo(6, -26);
	context.lineTo(-6, -26);
	context.fill();
	context.restore();
}

/** A robed figure standing or kneeling, feet at (x, y), no face. */
function robed(context: CanvasRenderingContext2D, x: number, y: number, scale: number, robe: string, kneel: number, alpha = 1) {
	context.save();
	context.globalAlpha *= alpha;
	context.translate(x, y);
	context.scale(scale, scale);
	const h = 34 - kneel * 14;
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(-11, 0);
	context.lineTo(-7, -h);
	context.quadraticCurveTo(0, -h - 6, 7, -h);
	context.lineTo(11, 0);
	context.closePath();
	context.fill();
	context.fillStyle = "#c69a72";
	context.beginPath();
	context.arc(kneel * 4, -h - 8, 6, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#e3d6bc";
	context.beginPath();
	context.arc(kneel * 4, -h - 9, 6.6, Math.PI * 0.95, Math.PI * 2.05);
	context.lineTo(kneel * 4 + 6, -h - 2);
	context.lineTo(kneel * 4 - 6, -h - 2);
	context.fill();
	context.restore();
}

/** Jesus transfigured: a figure of white light, raiment white as the light, no face. */
function transfigured(context: CanvasRenderingContext2D, x: number, y: number, glow: number) {
	const light = context.createRadialGradient(x, y - 40, 4, x, y - 40, 120 + 80 * glow);
	light.addColorStop(0, `rgba(255,255,250,${0.95 * glow})`);
	light.addColorStop(0.3, `rgba(255,246,214,${0.6 * glow})`);
	light.addColorStop(1, "rgba(255,236,190,0)");
	context.fillStyle = light;
	context.fillRect(0, 0, STAGE, STAGE);
	context.save();
	context.shadowColor = "rgba(255,250,230,1)";
	context.shadowBlur = 24;
	context.fillStyle = "#ffffff";
	context.beginPath();
	context.moveTo(x - 15, y);
	context.lineTo(x - 10, y - 50);
	context.quadraticCurveTo(x, y - 58, x + 10, y - 50);
	context.lineTo(x + 15, y);
	context.closePath();
	context.fill();
	context.beginPath();
	context.arc(x, y - 63, 9, 0, Math.PI * 2);
	context.fill();
	context.restore();
}

export default function HearYeHim({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<HearState>(newHear(seed));
	const touches = useRef(new Map<number, number>());
	const view = useRef(-60);
	const squash = useRef(0);
	const chips = useRef<Chip[]>([]);
	const dim = useRef(0);
	const outro = useRef(0);
	const ended = useRef(false);
	const lastWind = useRef(0);
	const synth = useSynth(muted);

	const react = useCallback(
		(event: HearEvent) => {
			const play = synth.current;
			const run = state.current;
			if (event.type === "spring") {
				squash.current = 1;
				if (play) {
					const rise = Math.min(1, run.y / HEAR_SUMMIT);
					play.tone(220 + rise * 330, 0.16, { type: "triangle", volume: 0.08, to: 330 + rise * 440 });
					play.noise(0.05, { volume: 0.06, filter: 900 });
					if (event.kind === "wind") play.noise(0.4, { volume: 0.06, filter: 2400, type: "bandpass" });
				}
			}
			if (event.type === "crumble") {
				const item = run.ledges[event.index];
				const x = ledgeX(item, run.t);
				for (let i = 0; i < 9; i++) chips.current.push({ x: x - item.w / 2 + Math.random() * item.w, y: item.y, vx: (Math.random() * 2 - 1) * 40, vy: 30 + Math.random() * 60, life: 1, size: 3 + Math.random() * 4 });
				play?.noise(0.3, { volume: 0.12, filter: 700 });
			}
			if (event.type === "stumble") {
				dim.current = 1;
				play?.tone(196, 0.5, { type: "sine", volume: 0.1, to: 147 });
			}
			if (event.type === "summit" && play) {
				[262, 330, 392, 523, 659, 784].forEach((note, i) => play.tone(note, 3, { type: "sine", volume: 0.07, delay: i * 0.09 }));
				play.noise(1.4, { volume: 0.05, filter: 3000, type: "bandpass" });
			}
			if (event.type === "lost") play?.tone(147, 1.1, { type: "sine", volume: 0.12, to: 110 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		const dt = 1 / 60;
		squash.current = Math.max(0, squash.current - dt * 7);
		dim.current = Math.max(0, dim.current - dt * 1.6);
		for (const chip of chips.current) {
			chip.x += chip.vx * dt;
			chip.y -= chip.vy * dt;
			chip.vy += 500 * dt;
			chip.life -= dt * 1.3;
		}
		chips.current = chips.current.filter((chip) => chip.life > 0);
		const canvas = canvasRef.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			const play = synth.current;
			if (run.phase === "won" && play) {
				if (outro.current === 110) [392, 494, 587, 784].forEach((note, i) => play.tone(note, 2.4, { type: "sine", volume: 0.06, delay: i * 0.12 }));
				if (outro.current === 190) [523, 659, 784].forEach((note, i) => play.tone(note, 2, { type: "triangle", volume: 0.045, delay: i * 0.08 }));
			}
			if (canvas) canvas.dataset.hear = `${run.t.toFixed(3)},${run.x.toFixed(1)},${run.y.toFixed(1)},0,0,${run.camera.toFixed(1)},${run.phase},${run.stumbles},${run.springs}`;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = hearResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		keys.presses.length = 0;
		let dir = (keys.held.has("arrowright") ? 1 : 0) - (keys.held.has("arrowleft") ? 1 : 0);
		for (const side of touches.current.values()) dir += side;
		const events: HearEvent[] = [];
		stepHear(run, { dir: Math.sign(dir) }, events);
		for (const event of events) react(event);
		const play = synth.current;
		if (play && run.t - lastWind.current > 2.2) {
			lastWind.current = run.t;
			play.noise(2.4, { volume: 0.03, filter: 500 });
		}
		if (canvas) {
			canvas.dataset.hear = `${run.t.toFixed(3)},${run.x.toFixed(2)},${run.y.toFixed(2)},${run.vx.toFixed(2)},${run.vy.toFixed(2)},${run.camera.toFixed(2)},${run.phase},${run.stumbles},${run.springs}`;
			canvas.dataset.ledges = run.ledges
				.map((item, index) => ({ item, index }))
				.filter(({ item }) => item.y > run.camera - 60 && item.y < run.camera + 470)
				.map(({ item, index }) => `${index}:${item.kind}:${item.x.toFixed(2)}:${item.y.toFixed(2)}:${item.w}:${item.amp.toFixed(3)}:${item.omega.toFixed(4)}:${item.phase.toFixed(4)}:${item.broken === null ? 0 : 1}`)
				.join(";");
		}
		onTime(Math.max(0, HEAR_SECONDS - run.t));
	}, [keys, onEnd, onTime, react, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const won = run.phase === "won";
			const f = outro.current;
			// The view follows the climb smoothly, and comes back down after a stumble.
			view.current += (run.camera - view.current) * (reducedMotion ? 1 : 0.18);
			const cam = view.current;
			const screen = (y: number) => STAGE - (y - cam);
			const height = Math.max(0, Math.min(1, cam / HEAR_SUMMIT));

			// Evening on the mountain, brightening toward the cloud at the summit.
			const sky = context.createLinearGradient(0, 0, 0, STAGE);
			sky.addColorStop(0, `rgb(${Math.round(32 + 200 * height)},${Math.round(36 + 190 * height)},${Math.round(76 + 150 * height)})`);
			sky.addColorStop(1, `rgb(${Math.round(70 + 120 * height)},${Math.round(58 + 110 * height)},${Math.round(92 + 70 * height)})`);
			context.fillStyle = sky;
			context.fillRect(0, 0, STAGE, STAGE);
			// Stars low on the mountain, fading as he climbs.
			if (height < 0.7) {
				context.fillStyle = `rgba(255,248,226,${0.7 * (1 - height / 0.7)})`;
				for (let i = 0; i < 28; i++) {
					const sx = (i * 97.3) % STAGE;
					const sy = ((i * 53.1 + cam * 0.05) % 260) + 4;
					context.fillRect(sx, sy, 1.6, 1.6);
				}
			}
			// Far mountains, slow; the mountain's own flanks, nearer.
			context.fillStyle = `rgba(${Math.round(40 + 90 * height)},${Math.round(44 + 80 * height)},${Math.round(70 + 70 * height)},.85)`;
			context.beginPath();
			context.moveTo(0, STAGE);
			for (let x = 0; x <= STAGE; x += 25) context.lineTo(x, 300 + cam * 0.08 + Math.sin(x / 41 + 1) * 26 + Math.sin(x / 17) * 8);
			context.lineTo(STAGE, STAGE);
			context.fill();
			for (const side of [-1, 1]) {
				context.fillStyle = `rgba(${Math.round(52 + 60 * height)},${Math.round(42 + 50 * height)},${Math.round(40 + 50 * height)},.9)`;
				context.beginPath();
				const edge = side < 0 ? 0 : STAGE;
				context.moveTo(edge, 0);
				for (let y = -20; y <= STAGE + 20; y += 20) {
					const world = cam + STAGE - y;
					context.lineTo(edge - side * (12 + Math.abs(Math.sin(world / 53)) * 14 + Math.sin(world / 19) * 4), y);
				}
				context.lineTo(edge, STAGE + 20);
				context.fill();
			}

			// The bright cloud resting on the summit.
			const cloudY = screen(HEAR_SUMMIT);
			if (cloudY > -200) {
				const glow = context.createLinearGradient(0, cloudY - 140, 0, cloudY + 40);
				glow.addColorStop(0, "rgba(255,255,250,.98)");
				glow.addColorStop(0.7, "rgba(255,250,230,.85)");
				glow.addColorStop(1, "rgba(255,246,220,0)");
				context.fillStyle = glow;
				context.fillRect(0, cloudY - 400, STAGE, 440);
				context.fillStyle = "rgba(255,255,255,.9)";
				for (let i = 0; i < 8; i++) {
					const bx = ((i * 61 + (reducedMotion ? 0 : time * 6)) % (STAGE + 80)) - 40;
					context.beginPath();
					context.arc(bx, cloudY + 8 + (i % 3) * 6, 26 + (i % 4) * 7, 0, Math.PI * 2);
					context.fill();
				}
			}

			if (!won) {
				// Where to hold on a touch screen, lit while held.
				let held = (keys.held.has("arrowright") ? 1 : 0) - (keys.held.has("arrowleft") ? 1 : 0);
				for (const side of touches.current.values()) held += side;
				for (const side of [-1, 1]) {
					const on = Math.sign(held) === side;
					context.fillStyle = on ? "rgba(255,226,150,.5)" : "rgba(255,255,255,.16)";
					context.beginPath();
					context.arc(side < 0 ? 34 : STAGE - 60, STAGE - 32, 22, 0, Math.PI * 2);
					context.fill();
					context.strokeStyle = on ? "#fff3cf" : "rgba(255,255,255,.7)";
					context.lineWidth = 4;
					context.lineCap = "round";
					context.lineJoin = "round";
					const cx = side < 0 ? 34 : STAGE - 60;
					context.beginPath();
					context.moveTo(cx + side * -5, STAGE - 42);
					context.lineTo(cx + side * 5, STAGE - 32);
					context.lineTo(cx + side * -5, STAGE - 22);
					context.stroke();
				}
			}

			// The ledges.
			for (const item of run.ledges) {
				const top = screen(item.y);
				if (top < -30 || top > STAGE + 70) continue;
				if (item.broken !== null) continue;
				ledge(context, item, ledgeX(item, run.t), top, time, reducedMotion);
			}
			// Crumbled stones falling away.
			for (const chip of chips.current) {
				context.fillStyle = `rgba(122,108,92,${chip.life})`;
				context.fillRect(chip.x, screen(chip.y), chip.size, chip.size);
			}

			// Peter, unless the summit's scene has begun.
			if (!won || f < 30) peter(context, run.x, screen(run.y), run.vy, run.vx, squash.current);

			// The summit: transfigured before them, Moses and Elias, the bright cloud, then Jesus only.
			if (won) {
				const enter = smooth(f / 36);
				context.fillStyle = `rgba(255,252,240,${enter})`;
				context.fillRect(0, 0, STAGE, STAGE);
				if (f > 18) {
					const scene = smooth((f - 18) / 30);
					context.globalAlpha = scene;
					const tableau = context.createLinearGradient(0, 0, 0, STAGE);
					tableau.addColorStop(0, "#fffaf0");
					tableau.addColorStop(0.65, "#f1e2c2");
					tableau.addColorStop(1, "#bfa27a");
					context.fillStyle = tableau;
					context.fillRect(0, 0, STAGE, STAGE);
					// The mountain top.
					context.fillStyle = "#a88d6a";
					context.beginPath();
					context.moveTo(0, STAGE);
					context.lineTo(0, 300);
					context.quadraticCurveTo(200, 262, STAGE, 300);
					context.lineTo(STAGE, STAGE);
					context.fill();
					const glow = smooth((f - 30) / 50);
					transfigured(context, 200, 276, glow);
					// Moses and Elias talking with him, until the cloud lifts.
					const them = smooth((f - 50) / 30) * (1 - smooth((f - 160) / 30));
					if (them > 0) {
						robed(context, 136, 282, 1.25, "#6e5a86", 0, them);
						robed(context, 264, 282, 1.25, "#7d6a4c", 0, them);
					}
					// Peter, James and John before him: on their faces at the voice, then lifting up their eyes.
					const fallen = smooth((f - 120) / 20) * (1 - smooth((f - 200) / 30));
					robed(context, 150, 352, 1.1, ROBE, fallen);
					robed(context, 200, 360, 1.1, "#4f6b85", fallen);
					robed(context, 250, 352, 1.1, "#5f7a5a", fallen);
					// The bright cloud overshadows them.
					const cloud = smooth((f - 104) / 26) * (1 - smooth((f - 168) / 30));
					if (cloud > 0) {
						context.fillStyle = `rgba(255,255,252,${0.82 * cloud})`;
						context.fillRect(0, 0, STAGE, STAGE);
						context.fillStyle = `rgba(255,255,255,${0.9 * cloud})`;
						for (let i = 0; i < 9; i++) {
							context.beginPath();
							context.arc(i * 50, 70 + (i % 2) * 22 + (reducedMotion ? 0 : Math.sin(time + i) * 4), 54, 0, Math.PI * 2);
							context.fill();
						}
					}
					context.globalAlpha = 1;
					// The words, quoted.
					const line = f < 104 ? ["And was transfigured", "before them"] : f < 180 ? ["behold, a bright cloud", "overshadowed them"] : ["they saw no man,", "save Jesus only"];
					const shown = f < 104 ? smooth((f - 34) / 16) : f < 180 ? smooth((f - 108) / 16) : smooth((f - 184) / 16);
					context.globalAlpha = shown;
					context.fillStyle = "rgba(58,37,8,.08)";
					context.beginPath();
					context.roundRect(46, 24, 308, 64, 14);
					context.fill();
					context.fillStyle = "#3a2508";
					context.font = `italic 700 21px ${SERIF}`;
					context.textAlign = "center";
					context.fillText(line[0], 200, 50);
					context.fillText(line[1], 200, 77);
					context.globalAlpha = 1;
				}
			}

			// Marks of faith, and the climb so far.
			if (!won) {
				context.fillStyle = "rgba(14,16,30,.55)";
				context.beginPath();
				context.roundRect(10, 10, 104, 30, 15);
				context.fill();
				for (let i = 0; i < HEAR_MARKS; i++) {
					const kept = i < HEAR_MARKS - run.stumbles;
					const cx = 30 + i * 32;
					context.fillStyle = kept ? "#ffd27a" : "rgba(255,255,255,.18)";
					context.beginPath();
					context.moveTo(cx, 15);
					context.quadraticCurveTo(cx + 9, 26, cx, 35);
					context.quadraticCurveTo(cx - 9, 26, cx, 15);
					context.fill();
					if (kept) {
						context.fillStyle = "#fff6d8";
						context.beginPath();
						context.arc(cx, 28, 3, 0, Math.PI * 2);
						context.fill();
					}
				}
				const barTop = 54;
				const barBottom = 330;
				context.fillStyle = "rgba(14,16,30,.45)";
				context.beginPath();
				context.roundRect(STAGE - 22, barTop - 6, 12, barBottom - barTop + 12, 6);
				context.fill();
				context.fillStyle = "#fffaf0";
				context.beginPath();
				context.arc(STAGE - 16, barTop, 7, 0, Math.PI * 2);
				context.fill();
				const along = Math.max(0, Math.min(1, run.highest / HEAR_SUMMIT));
				context.fillStyle = "#ffd27a";
				context.fillRect(STAGE - 18, barBottom - (barBottom - barTop) * along, 4, (barBottom - barTop) * along);
				const at = Math.max(0, Math.min(1, run.y / HEAR_SUMMIT));
				context.fillStyle = "#ffffff";
				context.beginPath();
				context.arc(STAGE - 16, barBottom - (barBottom - barTop) * at, 4.5, 0, Math.PI * 2);
				context.fill();

				if (run.t < 2.2 && run.stumbles === 0) {
					context.fillStyle = `rgba(255,248,226,${reducedMotion ? 0.95 : 0.75 + 0.25 * Math.sin(time * 6)})`;
					context.font = `800 16px ${SANS}`;
					context.textAlign = "center";
					context.fillText("Steer onto the ledges", 200, 66);
				}
			}
			if (dim.current > 0) {
				context.fillStyle = `rgba(10,10,24,${0.35 * dim.current})`;
				context.fillRect(0, 0, STAGE, STAGE);
				context.globalAlpha = Math.min(1, dim.current * 1.5);
				context.fillStyle = "#f6ecd6";
				context.font = `800 18px ${SANS}`;
				context.textAlign = "center";
				context.fillText(`Stumbled: ${Math.max(0, HEAR_MARKS - run.stumbles)} left`, 200, 120);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(10,10,24,.5)";
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = "#f1eadc";
				context.font = `800 20px ${SANS}`;
				context.textAlign = "center";
				context.fillText(run.stumbles >= HEAR_MARKS ? "No marks of faith left" : "Climb higher, sooner", 200, 196);
			}
		},
		[keys, reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const sideOf = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		return canvas && stagePoint(canvas, event).x < STAGE / 2 ? -1 : 1;
	};
	const press = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused) return;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		touches.current.set(event.pointerId, sideOf(event));
	};
	const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, sideOf(event));
	};
	const release = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		touches.current.delete(event.pointerId);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={press}
			onPointerMove={move}
			onPointerUp={release}
			onPointerCancel={release}
			onLostPointerCapture={release}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="Peter climbing an high mountain, springing from ledge to ledge of rock toward a bright cloud at the summit. Hold the left or right arrow, or hold a finger on the left or right half of the picture, to steer him onto the ledges; loose stones crumble after one landing and wind-swept ledges drift. Falling below the picture is a stumble; three stumbles end the climb."
		/>
	);
}
