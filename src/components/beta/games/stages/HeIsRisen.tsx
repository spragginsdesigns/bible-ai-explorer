"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, STAGE_STEP, stagePoint, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	RISEN_DISCIPLES,
	RISEN_RING_LIFE,
	RISEN_RING_R,
	RISEN_SECONDS,
	RISEN_TELLINGS,
	RISEN_TOP,
	newRisen,
	ringRadius,
	risenResult,
	stepRisen,
	walkerAt,
	type RisenEvent,
	type RisenState,
} from "@/lib/beta/games/he-is-risen-rules";

/**
 * He Is Risen (LC-17908), Matthew 28:1-20: dawn over the garden and
 * Jerusalem. The sepulchre stands open at the left, the stone rolled back
 * from the door and the angel, a figure of light, sitting upon it (v2-3).
 * People walk about the garden, among them the eleven disciples in warm
 * robes, each with a little lamp, walking in twos and threes. Aim with the
 * arrows and tell with Space, or tap where to tell: a ring of light carries
 * the word "He is risen" (v6), and everyone it touches stops and passes it on
 * with a ring of their own. Reach all eleven; then "lo, I am with you alway"
 * (v20).
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const HORIZON = 128;
const MARKER_SPEED = 260;
const OUTRO_WON = 200;
const OUTRO_LOST = 45;
const FOLK_ROBES = ["#6d7d92", "#7f705d", "#62806c", "#8a7b9b", "#7b6767", "#6f8a8a"];
const DISCIPLE_ROBES = ["#c9772f", "#b8612b", "#d48f3c"];

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

/** A person in the garden: a robe, a covered head, no face drawn. Disciples carry a little lamp. */
function drawPerson(context: CanvasRenderingContext2D, x: number, y: number, robe: string, disciple: boolean, step: number, heard: number, glow: number) {
	if (heard > 0) {
		const aura = context.createRadialGradient(x, y + 6, 1, x, y + 6, 18);
		aura.addColorStop(0, `rgba(255,232,160,${0.55 * heard})`);
		aura.addColorStop(1, "rgba(255,232,160,0)");
		context.fillStyle = aura;
		context.beginPath();
		context.arc(x, y + 6, 18, 0, Math.PI * 2);
		context.fill();
	}
	context.fillStyle = "rgba(20,30,10,.25)";
	context.beginPath();
	context.ellipse(x, y + 10, 7, 2.5, 0, 0, Math.PI * 2);
	context.fill();
	const bob = step;
	context.fillStyle = robe;
	context.beginPath();
	context.moveTo(x - 6.5, y + 10);
	context.lineTo(x - 4.5, y - 4 + bob);
	context.quadraticCurveTo(x, y - 8 + bob, x + 4.5, y - 4 + bob);
	context.lineTo(x + 6.5, y + 10);
	context.closePath();
	context.fill();
	if (heard > 0) {
		// Arms lifted as they pass the word on.
		context.strokeStyle = robe;
		context.lineWidth = 2.6;
		context.lineCap = "round";
		context.beginPath();
		context.moveTo(x - 3.5, y - 2 + bob);
		context.lineTo(x - 7.5, y - 9 - heard * 2 + bob);
		context.moveTo(x + 3.5, y - 2 + bob);
		context.lineTo(x + 7.5, y - 9 - heard * 2 + bob);
		context.stroke();
	}
	context.fillStyle = "#c79b74";
	context.beginPath();
	context.arc(x, y - 9 + bob, 4, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = disciple ? "#7a3d1a" : "#4b4040";
	context.beginPath();
	context.arc(x, y - 10 + bob, 4.4, Math.PI * 0.95, Math.PI * 2.05);
	context.fill();
	context.fillRect(x - 4.4, y - 10 + bob, 2, 5);
	context.fillRect(x + 2.4, y - 10 + bob, 2, 5);
	if (disciple) {
		const lx = x + 7;
		const ly = y + 2 + bob;
		const light = context.createRadialGradient(lx, ly, 0.5, lx, ly, 9 + glow * 8);
		light.addColorStop(0, `rgba(255,236,150,${0.9})`);
		light.addColorStop(1, "rgba(255,200,90,0)");
		context.fillStyle = light;
		context.beginPath();
		context.arc(lx, ly, 9 + glow * 8, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = "#8a5a22";
		context.beginPath();
		context.ellipse(lx, ly + 1.5, 3.2, 1.8, 0, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = "#fff4c4";
		context.beginPath();
		context.arc(lx + 0.5, ly - 1, 1.6, 0, Math.PI * 2);
		context.fill();
	}
}

export default function HeIsRisen({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<RisenState>(newRisen(seed));
	const marker = useRef({ x: 200, y: 268 });
	const tap = useRef<{ x: number; y: number } | null>(null);
	const clock = useRef(0);
	const endClock = useRef(0);
	const outro = useRef(0);
	const ended = useRef(false);
	const particles = useRef<Particle[]>([]);
	const heardAt = useRef<Map<number, number>>(new Map());
	const notes = useRef(0);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number) => {
		const t = clock.current;
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const power = speed * (0.3 + Math.random() * 0.7);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power - 20, born: t, life: 0.5 + Math.random() * 0.5, color: colors[i % colors.length], size: 1 + Math.random() * 1.8 });
		}
	}, []);

	const react = useCallback(
		(event: RisenEvent) => {
			const play = synth.current;
			const t = clock.current;
			if (event.type === "tell") {
				play?.tone(659, 1.3, { type: "sine", volume: 0.12 });
				play?.tone(988, 1.1, { type: "sine", volume: 0.07, delay: 0.04 });
				play?.noise(0.4, { volume: 0.06, filter: 3000, type: "bandpass" });
				burst(event.x, event.y, 14, ["#fff3c4", "#ffd970", "#ffffff"], 70);
			}
			if (event.type === "heard") {
				heardAt.current.set(event.id, t);
				burst(event.x, event.y - 4, event.disciple ? 12 : 6, event.disciple ? ["#ffd970", "#fff3c4"] : ["#fff3c4", "#ffffff"], event.disciple ? 60 : 40);
				if (notes.current < 4) {
					notes.current++;
					// A rising scale as the word passes from hand to hand.
					const scale = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760];
					const note = scale[Math.min(scale.length - 1, event.depth - 1)];
					play?.tone(note, event.disciple ? 0.7 : 0.35, { type: event.disciple ? "sine" : "triangle", volume: event.disciple ? 0.12 : 0.06 });
					if (event.disciple) play?.tone(note * 2, 0.5, { type: "sine", volume: 0.05, delay: 0.05 });
				}
			}
			if (event.type === "faded" && event.player && event.caught === 0) play?.tone(247, 0.6, { type: "sine", volume: 0.08, to: 196 });
			if (event.type === "won") {
				[523, 659, 784, 1047, 1319].forEach((note, index) => play?.tone(note, 1.6, { type: "sine", volume: 0.11, delay: 0.1 + index * 0.12 }));
			}
			if (event.type === "lost") play?.tone(262, 0.9, { type: "sine", volume: 0.12, to: 175 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		clock.current += STAGE_STEP;
		notes.current = 0;
		if (run.phase !== "playing") {
			takePresses(keys);
			tap.current = null;
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = risenResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		// The aim: arrows move it; a tap tells where it lands.
		const aim = marker.current;
		const dx = (keys.held.has("arrowright") ? 1 : 0) - (keys.held.has("arrowleft") ? 1 : 0);
		const dy = (keys.held.has("arrowdown") ? 1 : 0) - (keys.held.has("arrowup") ? 1 : 0);
		const norm = dx && dy ? Math.SQRT1_2 : 1;
		aim.x = Math.max(10, Math.min(STAGE - 10, aim.x + dx * norm * MARKER_SPEED * STAGE_STEP));
		aim.y = Math.max(RISEN_TOP - 20, Math.min(STAGE - 8, aim.y + dy * norm * MARKER_SPEED * STAGE_STEP));
		const presses = takePresses(keys);
		let tell: { x: number; y: number } | null = null;
		if (tap.current) tell = tap.current;
		else if (presses.includes(" ")) tell = { x: aim.x, y: aim.y };
		tap.current = null;
		const events: RisenEvent[] = [];
		stepRisen(run, { tell }, events);
		for (const event of events) react(event);
		if (run.phase !== "playing") endClock.current = clock.current;
		onTime(Math.max(0, RISEN_SECONDS - run.t));
		const canvas = canvasRef.current;
		if (canvas) {
			// What the proof bot reads: the round, the aim, everyone in the garden and the rings of light.
			canvas.dataset.risen = `${run.t.toFixed(3)},${run.tellings},${run.disciples},${run.folk},${run.phase},${aim.x.toFixed(1)},${aim.y.toFixed(1)}`;
			canvas.dataset.walkers = run.walkers
				.map((walker) => `${walker.x.toFixed(1)},${walker.y.toFixed(1)},${walker.vx.toFixed(2)},${walker.vy.toFixed(2)},${walker.disciple ? 1 : 0},${walker.told === null ? -1 : (run.t - walker.told).toFixed(3)},${walker.passed ? 1 : 0},${walker.arrive},${walker.depth}`)
				.join(";");
			canvas.dataset.rings = run.rings.map((ring) => `${ring.x.toFixed(1)},${ring.y.toFixed(1)},${(run.t - ring.born).toFixed(3)},${ring.by},${ring.depth},${ring.caught}`).join(";");
		}
	}, [keys, onEnd, onTime, react]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const now = clock.current;
			const won = run.phase === "won";
			const vt = run.phase === "playing" ? run.t : (run.endedAt ?? run.t) + (now - endClock.current);
			const dawn = won ? Math.min(1, outro.current / 90) : Math.min(1, run.t / RISEN_SECONDS) * 0.4;
			const motion = reducedMotion ? 0 : 1;

			// The sky as it began to dawn (v1), lighter as the round runs and full sunrise at the end.
			const sky = context.createLinearGradient(0, 0, 0, HORIZON);
			sky.addColorStop(0, won ? "#5d78b8" : "#28305e");
			sky.addColorStop(0.55, won ? "#f0b9a0" : "#a46a8e");
			sky.addColorStop(1, "#ffd59a");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, HORIZON + 10);
			const sunY = HORIZON + 10 - dawn * 34;
			const sun = context.createRadialGradient(312, sunY, 4, 312, sunY, 90 + dawn * 120);
			sun.addColorStop(0, "rgba(255,248,220,1)");
			sun.addColorStop(0.15, `rgba(255,226,160,${0.7 + dawn * 0.3})`);
			sun.addColorStop(1, "rgba(255,200,130,0)");
			context.fillStyle = sun;
			context.fillRect(-10, -10, STAGE + 20, HORIZON + 40);
			if (won && !reducedMotion) {
				context.strokeStyle = `rgba(255,240,200,${0.18 * dawn})`;
				context.lineWidth = 6;
				for (let i = 0; i < 9; i++) {
					const angle = Math.PI + (i / 8) * Math.PI + Math.sin(time * 0.3 + i) * 0.03;
					context.beginPath();
					context.moveTo(312, sunY);
					context.lineTo(312 + Math.cos(angle) * 300, sunY + Math.sin(angle) * 300);
					context.stroke();
				}
			}
			// Jerusalem on the far hill.
			context.fillStyle = "#4d3d5c";
			context.beginPath();
			context.moveTo(150, HORIZON + 2);
			context.lineTo(150, 112);
			const city: [number, number][] = [
				[168, 112], [168, 100], [180, 100], [180, 108], [206, 108], [206, 96], [214, 92], [222, 96], [222, 108], [246, 108], [246, 88], [290, 88], [290, 80], [300, 80], [300, 88], [330, 88], [330, 104], [352, 104], [352, 94], [362, 94], [362, 106], [400, 106],
			];
			for (const [x, y] of city) context.lineTo(x, y);
			context.lineTo(400, HORIZON + 2);
			context.closePath();
			context.fill();
			context.fillStyle = "rgba(255,226,170,.5)";
			for (const [x, y] of [[190, 112], [232, 112], [262, 98], [276, 98], [316, 98], [372, 112]]) context.fillRect(x, y, 2, 3);

			// The garden.
			const ground = context.createLinearGradient(0, HORIZON - 8, 0, STAGE);
			ground.addColorStop(0, "#7f8a5e");
			ground.addColorStop(0.3, "#5f7448");
			ground.addColorStop(1, "#3c5233");
			context.fillStyle = ground;
			context.beginPath();
			context.moveTo(-10, HORIZON + 4);
			context.quadraticCurveTo(200, HORIZON - 10, 410, HORIZON + 2);
			context.lineTo(410, 410);
			context.lineTo(-10, 410);
			context.closePath();
			context.fill();
			context.fillStyle = "rgba(255,236,190,.08)";
			context.beginPath();
			context.moveTo(110, 150);
			context.bezierCurveTo(170, 210, 120, 300, 210, 410);
			context.lineTo(280, 410);
			context.bezierCurveTo(190, 300, 230, 210, 150, 150);
			context.closePath();
			context.fill();
			// Olive trees at the edges, and flowers in the grass.
			for (const [x, y, s] of [[372, 160, 1], [24, 392, 1.1], [384, 380, 0.9]] as [number, number, number][]) {
				context.fillStyle = "#5a4630";
				context.fillRect(x - 2 * s, y - 14 * s, 4 * s, 16 * s);
				context.fillStyle = "#6e8256";
				for (const [ox, oy, r] of [[-8, -18, 9], [6, -20, 10], [0, -28, 9], [-12, -26, 7], [12, -28, 7]]) {
					context.beginPath();
					context.arc(x + ox * s, y + oy * s, r * s, 0, Math.PI * 2);
					context.fill();
				}
			}
			for (let i = 0; i < 26; i++) {
				const fx = (i * 97.3) % 380 + 10;
				const fy = 160 + ((i * 53.7) % 230);
				context.fillStyle = i % 3 ? "rgba(255,244,214,.55)" : "rgba(240,170,190,.55)";
				context.fillRect(fx, fy, 2, 2);
			}

			// The sepulchre in the rock, the stone rolled back, the angel sitting upon it (v2-3).
			context.fillStyle = "#8c7e6c";
			context.beginPath();
			context.moveTo(-10, 160);
			context.quadraticCurveTo(10, 66, 80, 70);
			context.quadraticCurveTo(128, 74, 138, 150);
			context.lineTo(-10, 160);
			context.closePath();
			context.fill();
			context.fillStyle = "rgba(60,48,40,.25)";
			context.beginPath();
			context.moveTo(20, 150);
			context.quadraticCurveTo(40, 100, 90, 92);
			context.quadraticCurveTo(70, 120, 60, 150);
			context.fill();
			const door = context.createLinearGradient(0, 108, 0, 150);
			door.addColorStop(0, "#1a140f");
			door.addColorStop(1, "#2c231b");
			context.fillStyle = door;
			context.beginPath();
			context.moveTo(40, 150);
			context.lineTo(40, 122);
			context.arc(56, 122, 16, Math.PI, 0);
			context.lineTo(72, 150);
			context.closePath();
			context.fill();
			// The great stone, rolled back from the door.
			context.fillStyle = "#a39682";
			context.beginPath();
			context.ellipse(104, 134, 16, 19, 0, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = "#7c705f";
			context.lineWidth = 2;
			context.beginPath();
			context.ellipse(104, 134, 11, 13.5, 0, 0, Math.PI * 2);
			context.stroke();
			// The angel: raiment white as snow, a countenance of light, no face drawn.
			const angelGlow = context.createRadialGradient(104, 104, 2, 104, 104, 34 + motion * Math.sin(time * 2) * 2);
			angelGlow.addColorStop(0, "rgba(255,255,248,.95)");
			angelGlow.addColorStop(0.4, "rgba(255,250,225,.45)");
			angelGlow.addColorStop(1, "rgba(255,250,225,0)");
			context.fillStyle = angelGlow;
			context.beginPath();
			context.arc(104, 104, 36, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#ffffff";
			context.beginPath();
			context.moveTo(95, 118);
			context.lineTo(97, 100);
			context.quadraticCurveTo(104, 94, 111, 100);
			context.lineTo(115, 118);
			context.quadraticCurveTo(105, 122, 95, 118);
			context.closePath();
			context.fill();
			context.beginPath();
			context.arc(104, 91, 5.5, 0, Math.PI * 2);
			context.fill();

			// The rings of light: the word going out.
			for (const ring of run.rings) {
				const age = vt - ring.born;
				const radius = ringRadius(age);
				if (radius <= 0) continue;
				const life = Math.min(1, (RISEN_RING_LIFE - age) / 0.35);
				const player = ring.by < 0;
				const fill = context.createRadialGradient(ring.x, ring.y, radius * 0.2, ring.x, ring.y, radius);
				fill.addColorStop(0, `rgba(255,244,200,${0.05 * life})`);
				fill.addColorStop(1, `rgba(255,226,140,${(player ? 0.3 : 0.2) * life})`);
				context.fillStyle = fill;
				context.beginPath();
				context.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = player ? `rgba(255,246,206,${0.95 * life})` : `rgba(255,232,170,${0.7 * life})`;
				context.lineWidth = player ? 3 : 2;
				context.beginPath();
				context.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
				context.stroke();
				if (player) {
					context.globalAlpha = Math.min(1, age / 0.25) * life;
					context.fillStyle = "#fffbe8";
					context.font = `italic 700 15px ${SERIF}`;
					context.textAlign = "center";
					context.fillText("He is risen", Math.max(48, Math.min(STAGE - 48, ring.x)), ring.y - radius - 6 < HORIZON + 20 ? ring.y + 5 : ring.y - radius - 6);
					context.globalAlpha = 1;
				}
			}

			// Everyone in the garden, back to front.
			const order = [...run.walkers].sort((a, b) => walkerAt(a, vt).y - walkerAt(b, vt).y);
			for (const walker of order) {
				const at = walkerAt(walker, run.phase === "playing" ? run.t : vt);
				if (at.x < -20 || at.x > STAGE + 20 || at.y > STAGE + 20) continue;
				const walking = walker.told === null;
				const stepBob = walking && motion ? Math.abs(Math.sin(time * 9 + walker.id * 1.7)) * -1.4 : 0;
				const since = heardAt.current.get(walker.id);
				const heard = walker.told === null ? 0 : since === undefined ? 1 : Math.min(1, (now - since) / 0.25);
				const robe = walker.disciple ? DISCIPLE_ROBES[walker.id % DISCIPLE_ROBES.length] : FOLK_ROBES[walker.id % FOLK_ROBES.length];
				drawPerson(context, at.x, at.y, robe, walker.disciple, stepBob, heard, walker.told === null ? 0 : 1);
			}

			// Sparkle.
			particles.current = particles.current.filter((particle) => now - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = now - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				context.fillRect(particle.x + particle.vx * age - particle.size / 2, particle.y + particle.vy * age - particle.size / 2, particle.size, particle.size);
			}
			context.globalAlpha = 1;

			// The aim: where a telling would go, and how far its ring reaches.
			if (run.phase === "playing" && run.tellings > 0) {
				const aim = marker.current;
				context.setLineDash([5, 6]);
				context.lineDashOffset = -time * 14 * motion;
				context.strokeStyle = "rgba(255,248,220,.75)";
				context.lineWidth = 1.6;
				context.beginPath();
				context.arc(aim.x, aim.y, RISEN_RING_R, 0, Math.PI * 2);
				context.stroke();
				context.setLineDash([]);
				context.strokeStyle = "#fff3c4";
				context.lineWidth = 2.2;
				context.beginPath();
				context.moveTo(aim.x - 9, aim.y);
				context.lineTo(aim.x - 3, aim.y);
				context.moveTo(aim.x + 3, aim.y);
				context.lineTo(aim.x + 9, aim.y);
				context.moveTo(aim.x, aim.y - 9);
				context.lineTo(aim.x, aim.y - 3);
				context.moveTo(aim.x, aim.y + 3);
				context.lineTo(aim.x, aim.y + 9);
				context.stroke();
			}

			// How many disciples have heard, and the tellings left.
			context.fillStyle = "rgba(20,16,36,.6)";
			context.beginPath();
			context.roundRect(10, 10, 112, 36, 12);
			context.fill();
			const lamp = context.createRadialGradient(30, 28, 0.5, 30, 28, 11);
			lamp.addColorStop(0, "rgba(255,236,150,1)");
			lamp.addColorStop(1, "rgba(255,200,90,0)");
			context.fillStyle = lamp;
			context.beginPath();
			context.arc(30, 28, 11, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#8a5a22";
			context.beginPath();
			context.ellipse(30, 31, 6, 3, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#fff4c4";
			context.beginPath();
			context.arc(31, 26.5, 2.4, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = run.disciples >= RISEN_DISCIPLES ? "#ffe39a" : "#ffffff";
			context.font = "900 20px system-ui, sans-serif";
			context.textAlign = "left";
			context.fillText(`${run.disciples}/${RISEN_DISCIPLES}`, 48, 35);
			context.fillStyle = "rgba(20,16,36,.6)";
			context.beginPath();
			context.roundRect(STAGE - 112, 10, 102, 36, 12);
			context.fill();
			for (let i = 0; i < RISEN_TELLINGS; i++) {
				const x = STAGE - 88 + i * 30;
				const lit = i < run.tellings;
				context.strokeStyle = lit ? "#ffe39a" : "rgba(255,255,255,.25)";
				context.lineWidth = 2.5;
				context.beginPath();
				context.arc(x, 28, 8, 0, Math.PI * 2);
				context.stroke();
				if (lit) {
					context.fillStyle = "rgba(255,227,154,.55)";
					context.beginPath();
					context.arc(x, 28, 4, 0, Math.PI * 2);
					context.fill();
				}
			}
			if (run.phase === "playing" && run.tellings === RISEN_TELLINGS && run.t < 5) {
				context.fillStyle = "rgba(20,16,36,.55)";
				context.beginPath();
				context.roundRect(70, 54, 260, 28, 10);
				context.fill();
				context.fillStyle = "#fff4d8";
				context.font = "800 15px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Wait for them to gather, then tell", 200, 73);
			}

			// The closing beat (v20).
			if (won && outro.current > 40) {
				const fade = Math.min(1, (outro.current - 40) / 30, (OUTRO_WON - outro.current) / 25);
				context.globalAlpha = Math.max(0, fade);
				context.fillStyle = "rgba(255,250,236,.9)";
				context.beginPath();
				context.roundRect(36, 168, 328, 76, 16);
				context.fill();
				context.fillStyle = "#3a2508";
				context.textAlign = "center";
				context.font = `italic 700 20px ${SERIF}`;
				context.fillText("lo, I am with you alway,", 200, 200);
				context.fillText("even unto the end of the world.", 200, 228);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = `rgba(10,8,20,${0.45 * Math.min(1, outro.current / 30)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		const point = stagePoint(canvas, event);
		marker.current = { x: Math.max(10, Math.min(STAGE - 10, point.x)), y: Math.max(RISEN_TOP - 20, Math.min(STAGE - 8, point.y)) };
		tap.current = { ...marker.current };
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (paused || !canvas || event.pointerType !== "mouse") return;
		const point = stagePoint(canvas, event);
		marker.current = { x: Math.max(10, Math.min(STAGE - 10, point.x)), y: Math.max(RISEN_TOP - 20, Math.min(STAGE - 8, point.y)) };
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label={`Dawn over the garden. The sepulchre is open and the angel sits upon the stone. People walk about, among them the eleven disciples in warm robes carrying little lamps. Move the aim with the arrow keys and press Space, or tap, to tell the word: a ring of light spreads, and everyone it touches passes the word on. You have ${RISEN_TELLINGS} tellings; reach all ${RISEN_DISCIPLES} disciples.`}
		/>
	);
}
