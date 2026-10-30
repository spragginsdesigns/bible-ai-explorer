"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	REED_ARC,
	REED_LIVES,
	REED_SECONDS,
	newReed,
	reedAngle,
	reedResult,
	reedShowing,
	reedTurn,
	reedWrap,
	stepReed,
	type ReedEvent,
	type ReedGust,
	type ReedState,
} from "@/lib/beta/games/a-bruised-reed-rules";

/**
 * A Bruised Reed (LC-17908), Matthew 12:14-21. Night in an open field, no
 * figures: at the centre a smoking flax (a clay lamp whose wick barely
 * burns, a thread of smoke rising) and a bruised reed bent beside it. Gusts
 * come at it from any of eight sides: the grass bends and dust streams in
 * from that side, the wind whistling, before each arrives. A pair of cupped
 * hands turns round the flame (← → held, or a tap or hold toward a point):
 * a gust that meets them is turned aside and the flame steadies; one that
 * gets through makes it gutter. Some gusts sway in and die away. Outlast the
 * round and the flame rises bright, "till he send forth judgment unto
 * victory". It opens on 12:14, the Pharisees' council against him, so the
 * wind reads as the chapter's plot and the flame as those he will not quench.
 */

const SERIF = "Georgia, 'Times New Roman', serif";
const CX = 200;
const CY = 214;
/** The cupped hands' inner radius and thickness. */
const HANDS = 58;
const HANDS_W = 17;
/** Where a gust's dust starts streaming in, and the rim's wind marks. */
const RIM = 196;
const MARK = 172;
const OUTRO_WON = 150;
const OUTRO_LOST = 70;
const HINT_TICKS = 120;
const DEG = Math.PI / 180;

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/** A stage angle (degrees clockwise from up) as canvas radians. */
const rad = (angle: number) => (angle - 90) * DEG;
const polar = (angle: number, radius: number) => ({ x: CX + Math.cos(rad(angle)) * radius, y: CY + Math.sin(rad(angle)) * radius });

interface Tuft {
	x: number;
	y: number;
	angle: number;
	size: number;
	hue: number;
}

interface Mote {
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
	color: string;
}

/** Grass tufts over the field, clear of the flame, the same every round. */
const TUFTS: Tuft[] = (() => {
	const tufts: Tuft[] = [];
	for (let gy = 0; gy < 11; gy++) {
		for (let gx = 0; gx < 11; gx++) {
			const jitter = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
			const j = jitter - Math.floor(jitter);
			const x = 18 + gx * 36.4 + (j - 0.5) * 20;
			const y = 22 + gy * 36.4 + ((j * 7) % 1 - 0.5) * 20;
			const dx = x - CX;
			const dy = y - CY;
			const distance = Math.hypot(dx, dy);
			if (distance < 92) continue;
			tufts.push({ x, y, angle: reedWrap(Math.atan2(dx, -dy) / DEG), size: 9 + j * 7, hue: j });
		}
	}
	return tufts;
})();

const STARS = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97.13) % STAGE, y: (i * 61.7) % STAGE, size: i % 6 ? 1 : 1.8, phase: i * 1.7 }));

/** How far in a gust's dust has come, 0 at the rim to 1 at the hands, and how strongly it shows. */
function gustReach(gust: ReedGust, t: number) {
	const span = gust.hit - gust.warn;
	if (gust.feint && gust.dies !== null && t >= gust.dies) {
		const reached = (gust.dies - gust.warn) / span;
		const back = clamp((t - gust.dies) / 0.35);
		return { reach: reached * (1 - back * 0.5), strength: 1 - back };
	}
	const reach = clamp((t - gust.warn) / span);
	return { reach, strength: clamp((t - gust.warn) / 0.25) };
}

export default function ABruisedReed({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<ReedState>(newReed(seed));
	const toward = useRef<number | null>(null);
	const pointer = useRef<number | null>(null);
	const ended = useRef(false);
	const outro = useRef(0);
	const motes = useRef<Mote[]>([]);
	const gutter = useRef(-99);
	const steady = useRef(-99);
	const shake = useRef(0);
	const lastFrame = useRef(0);
	const synth = useSynth(muted);

	const burst = useCallback((angle: number, through: boolean) => {
		const hit = polar(angle, through ? HANDS - 6 : HANDS + HANDS_W + 4);
		for (let i = 0; i < (through ? 22 : 18); i++) {
			const side = i % 2 ? 1 : -1;
			// Turned aside: the dust slides off along the hands. Through: it rushes in at the flame.
			const along = through ? angle + 180 + (Math.random() - 0.5) * 50 : angle + side * (80 + Math.random() * 30);
			const speed = through ? 60 + Math.random() * 80 : 90 + Math.random() * 90;
			motes.current.push({
				x: hit.x,
				y: hit.y,
				vx: Math.cos(rad(along)) * speed,
				vy: Math.sin(rad(along)) * speed,
				age: 0,
				life: 0.45 + Math.random() * 0.4,
				color: through ? "255,190,120" : "214,222,236",
			});
		}
		if (motes.current.length > 220) motes.current.splice(0, motes.current.length - 220);
	}, []);

	const sound = useCallback(
		(event: ReedEvent, gust?: ReedGust) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "warn" && gust) {
				// A whistle rising as it comes; a feint's breaks off sooner.
				const length = (gust.feint && gust.dies !== null ? gust.dies : gust.hit) - gust.warn;
				const base = 420 + event.dir * 38;
				play.tone(base, length, { type: "sine", volume: 0.05, to: base * (1 + length * 1.1) });
				play.noise(length, { volume: 0.06, filter: 1600 + event.dir * 90, type: "bandpass" });
			}
			if (event.type === "fade") play.tone(700, 0.35, { type: "sine", volume: 0.03, to: 380 });
			if (event.type === "blocked") {
				play.noise(0.32, { volume: 0.2, filter: 900, type: "bandpass" });
				play.tone(event.grazed ? 440 : 660, 0.3, { type: "triangle", volume: 0.06, delay: 0.04 });
			}
			if (event.type === "through") {
				play.noise(0.55, { volume: 0.3, filter: 520 });
				play.tone(147, 0.6, { type: "sine", volume: 0.14, to: 98 });
			}
			if (event.type === "victory") [294, 370, 440, 587, 740, 880].forEach((note, index) => play.tone(note, 2.6, { type: "sine", volume: 0.09, delay: 0.15 + index * 0.13 }));
			if (event.type === "quenched") play.tone(110, 1.4, { type: "sine", volume: 0.14, to: 73 });
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = reedResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		keys.presses.length = 0;
		const dir = (keys.held.has("arrowright") ? 1 : 0) - (keys.held.has("arrowleft") ? 1 : 0);
		if (dir) toward.current = null;
		if (pointer.current !== null) toward.current = pointer.current;
		const aim = toward.current;
		const events: ReedEvent[] = [];
		const warnedBefore = new Set(run.gusts.filter((gust) => run.t >= gust.warn));
		stepReed(run, aim !== null && !dir ? { toward: aim } : { dir }, events);
		if (aim !== null && pointer.current === null && Math.abs(reedTurn(run.shield, aim)) < 1) toward.current = null;
		for (const event of events) {
			if (event.type === "warn") {
				const gust = run.gusts.find((each) => !warnedBefore.has(each) && run.t >= each.warn && each.dir === event.dir);
				sound(event, gust);
				continue;
			}
			sound(event);
			if (event.type === "blocked") {
				burst(reedAngle(event.dir), false);
				steady.current = run.t;
			}
			if (event.type === "through") {
				burst(reedAngle(event.dir), true);
				gutter.current = run.t;
				shake.current = 1;
			}
		}
		onTime(Math.max(0, REED_SECONDS - run.t));
		const canvas = canvasRef.current;
		if (canvas) {
			canvas.dataset.reed = `${Math.round(run.shield)},${run.through},${Math.round(run.flame)},${run.phase}`;
			canvas.dataset.gusts = reedShowing(run)
				.filter((gust) => !(gust.feint && gust.dies !== null && run.t >= gust.dies))
				.sort((a, b) => a.hit - b.hit)
				.map((gust) => `${gust.dir}@${Math.round((gust.hit - run.t) * 60)}`)
				.join(";");
		}
	}, [burst, keys, onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const won = run.phase === "won";
			const lost = run.phase === "lost";
			const out = outro.current;
			const motion = reducedMotion ? 0 : 1;
			const rise = won ? clamp(out / 70) : 0;
			const showing = run.phase === "playing" ? run.gusts.filter((gust) => run.t >= gust.warn && (gust.outcome === null || (gust.outcome === "faded" && run.t - (gust.dies ?? 0) < 0.35))) : [];

			context.save();
			if (shake.current > 0 && motion) context.translate(Math.sin(time * 51) * 2.5 * shake.current, Math.cos(time * 43) * 2 * shake.current);
			shake.current = Math.max(0, shake.current - dt * 2.5);

			// The field at night.
			const field = context.createRadialGradient(CX, CY, 20, CX, CY, 300);
			field.addColorStop(0, "#1d2a2a");
			field.addColorStop(0.55, "#121c22");
			field.addColorStop(1, "#080d16");
			context.fillStyle = field;
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			// Dew catching the starlight.
			for (const star of STARS) {
				const twinkle = motion ? 0.4 + 0.4 * Math.sin(time * 1.5 + star.phase) : 0.6;
				context.fillStyle = `rgba(200,214,255,${0.25 * twinkle})`;
				context.fillRect(star.x, star.y, star.size, star.size);
			}

			// The flame's light on the ground, brighter as it rises at the end.
			const flameLevel = clamp(run.flame / 100);
			const lightR = 70 + 60 * flameLevel + rise * 260;
			const pool = context.createRadialGradient(CX, CY - 6, 4, CX, CY - 6, lightR);
			pool.addColorStop(0, `rgba(255,196,110,${0.28 + 0.2 * flameLevel + 0.4 * rise})`);
			pool.addColorStop(1, "rgba(255,196,110,0)");
			context.fillStyle = pool;
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);

			// The grass, bending toward the flame where a gust is coming.
			const bendAt = (angle: number) => {
				let bend = 0;
				for (const gust of showing) {
					const { reach, strength } = gustReach(gust, run.t);
					const off = Math.abs(reedTurn(angle, reedAngle(gust.dir)));
					if (off < 38) bend = Math.max(bend, (1 - off / 38) * strength * (0.45 + 0.55 * reach));
				}
				return bend;
			};
			context.lineCap = "round";
			for (const tuft of TUFTS) {
				const bend = bendAt(tuft.angle);
				const sway = motion ? Math.sin(time * 1.3 + tuft.hue * 9) * 0.12 : 0;
				// Toward the flame is opposite to the tuft's own angle from it.
				const inward = rad(tuft.angle + 180);
				const lit = clamp(1 - Math.hypot(tuft.x - CX, tuft.y - CY) / (lightR * 1.1));
				context.strokeStyle = `rgb(${46 + 70 * lit + 30 * bend},${72 + 60 * lit + 20 * bend},${58 + 20 * lit})`;
				context.lineWidth = 2;
				for (let blade = -1; blade <= 1; blade++) {
					const lean = blade * 0.35 + sway;
					const tipX = tuft.x + Math.sin(lean) * tuft.size * (1 - bend * 0.5) + Math.cos(inward) * tuft.size * bend * 1.1;
					const tipY = tuft.y - Math.cos(lean) * tuft.size * (1 - bend * 0.7) + Math.sin(inward) * tuft.size * bend * 1.1;
					context.beginPath();
					context.moveTo(tuft.x + blade * 2, tuft.y);
					context.quadraticCurveTo(tuft.x + blade * 2, tuft.y - tuft.size * 0.5, tipX, tipY);
					context.stroke();
				}
			}

			// Each gust: a wind mark at the rim and dust streaming in toward the hands.
			for (const gust of showing) {
				const { reach, strength } = gustReach(gust, run.t);
				const angle = reedAngle(gust.dir);
				const front = RIM - (RIM - (HANDS + HANDS_W + 6)) * reach;
				const wedge = context.createRadialGradient(CX, CY, front, CX, CY, RIM + 40);
				wedge.addColorStop(0, `rgba(170,196,236,${0.2 * strength})`);
				wedge.addColorStop(1, "rgba(170,196,236,0)");
				context.fillStyle = wedge;
				context.beginPath();
				context.arc(CX, CY, RIM + 40, rad(angle - 22), rad(angle + 22));
				context.arc(CX, CY, front, rad(angle + 22), rad(angle - 22), true);
				context.closePath();
				context.fill();
				for (let lane = -3; lane <= 3; lane++) {
					const a = angle + lane * 6.5;
					const wobble = motion ? Math.sin(time * 9 + lane * 2) * 4 : 0;
					const head = front + Math.abs(lane) * 9 + wobble;
					const tail = Math.min(RIM + 30, head + 46 + (3 - Math.abs(lane)) * 10);
					const from = polar(a, tail);
					const to = polar(a, head);
					const streak = context.createLinearGradient(from.x, from.y, to.x, to.y);
					streak.addColorStop(0, "rgba(214,222,236,0)");
					streak.addColorStop(1, `rgba(226,234,248,${0.9 * strength})`);
					context.strokeStyle = streak;
					context.lineWidth = lane === 0 ? 4.5 : 3;
					context.beginPath();
					context.moveTo(from.x, from.y);
					context.lineTo(to.x, to.y);
					context.stroke();
				}
				// The mark: a chevron pointing in, filling as the gust comes on.
				const mark = polar(angle, MARK);
				context.save();
				context.translate(mark.x, mark.y);
				context.rotate(rad(angle + 180) - Math.PI / 2);
				const pulse = motion ? 0.8 + 0.2 * Math.sin(time * 14) : 1;
				context.globalAlpha = strength;
				context.fillStyle = `rgba(160,190,230,${0.25 * pulse})`;
				context.beginPath();
				context.arc(0, 0, 21, 0, Math.PI * 2);
				context.fill();
				context.strokeStyle = `rgba(235,242,255,${0.65 + 0.35 * reach})`;
				context.lineWidth = 4;
				context.lineJoin = "round";
				context.beginPath();
				context.moveTo(-11, -6);
				context.lineTo(0, 7);
				context.lineTo(11, -6);
				context.stroke();
				context.beginPath();
				context.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reach);
				context.stroke();
				context.restore();
			}

			// The lamp: a small clay lamp, its wick at the very centre.
			context.fillStyle = "#7a4a2c";
			context.beginPath();
			context.ellipse(CX - 14, CY + 10, 24, 11, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#93603a";
			context.beginPath();
			context.ellipse(CX - 16, CY + 6, 20, 7, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#3a2214";
			context.beginPath();
			context.ellipse(CX - 18, CY + 5, 6, 3, 0, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#93603a";
			context.beginPath();
			context.moveTo(CX - 4, CY + 2);
			context.quadraticCurveTo(CX + 6, CY, CX + 4, CY + 10);
			context.lineTo(CX - 6, CY + 14);
			context.closePath();
			context.fill();

			// The bruised reed beside it, bent at the bruise but not broken.
			context.strokeStyle = "#7d8a4a";
			context.lineWidth = 3;
			context.beginPath();
			context.moveTo(CX + 22, CY + 16);
			context.quadraticCurveTo(CX + 24, CY - 8, CX + 28, CY - 30);
			context.stroke();
			context.strokeStyle = "#6c7a3c";
			context.lineWidth = 2.6;
			context.beginPath();
			context.moveTo(CX + 28, CY - 30);
			context.quadraticCurveTo(CX + 38, CY - 34, CX + 44, CY - 18);
			context.stroke();
			context.fillStyle = "#a08a52";
			context.beginPath();
			context.ellipse(CX + 45, CY - 12, 3, 7, -0.3, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = "#5b4a2a";
			context.beginPath();
			context.arc(CX + 28, CY - 30, 2.4, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = "#7d8a4a";
			context.lineWidth = 2;
			context.beginPath();
			context.moveTo(CX + 23, CY + 4);
			context.quadraticCurveTo(CX + 14, CY - 6, CX + 12, CY - 14);
			context.stroke();

			// The flame: barely burning, guttering when the wind gets through, rising at the end.
			const sinceGutter = run.t - gutter.current;
			const sinceSteady = run.t - steady.current;
			const gutterAmount = sinceGutter < 0.8 ? 1 - sinceGutter / 0.8 : 0;
			const steadyAmount = sinceSteady < 0.5 ? 1 - sinceSteady / 0.5 : 0;
			const quench = lost ? clamp(out / 40) : 0;
			const flicker = motion ? Math.sin(time * 23) * 0.08 + Math.sin(time * 37) * 0.05 : 0;
			const height = (11 + 14 * flameLevel) * (1 + flicker - gutterAmount * 0.55 + steadyAmount * 0.15) * (1 - quench * 0.85) + rise * 44;
			const width = 5 + 3 * flameLevel + rise * 10;
			const sway = (motion ? Math.sin(time * 5) * 1.5 : 0) + gutterAmount * (motion ? Math.sin(time * 40) * 5 : 3);
			const glow = context.createRadialGradient(CX, CY - height * 0.5, 2, CX, CY - height * 0.5, 30 + height * 1.4);
			glow.addColorStop(0, `rgba(255,214,140,${0.55 * (1 - quench) + 0.3 * rise})`);
			glow.addColorStop(1, "rgba(255,180,90,0)");
			context.fillStyle = glow;
			context.beginPath();
			context.arc(CX, CY - height * 0.5, 30 + height * 1.4, 0, Math.PI * 2);
			context.fill();
			if (quench < 1) {
				const body = context.createLinearGradient(CX, CY, CX, CY - height);
				body.addColorStop(0, "rgba(120,170,255,.9)");
				body.addColorStop(0.25, "rgba(255,200,90,.95)");
				body.addColorStop(1, "rgba(255,246,214,.95)");
				context.fillStyle = body;
				context.beginPath();
				context.moveTo(CX - width, CY - 1);
				context.quadraticCurveTo(CX - width * 1.1, CY - height * 0.55, CX + sway, CY - height);
				context.quadraticCurveTo(CX + width * 1.1, CY - height * 0.55, CX + width, CY - 1);
				context.closePath();
				context.fill();
			} else {
				context.fillStyle = "#ff8a3c";
				context.beginPath();
				context.arc(CX, CY - 2, 2.5, 0, Math.PI * 2);
				context.fill();
			}
			// The smoke: always a thread rising, more when it gutters.
			for (let i = 0; i < 6; i++) {
				const age = ((time * 0.5 + i / 6) % 1) * (motion ? 1 : 0.5);
				const sx = CX + sway * 0.5 + Math.sin(age * 6 + i) * 6 * age;
				const sy = CY - height - 6 - age * 70;
				context.fillStyle = `rgba(170,170,180,${(0.1 + 0.22 * (gutterAmount + quench)) * (1 - age) * (1 - rise)})`;
				context.beginPath();
				context.ellipse(sx, sy, 2 + age * 6, 1.5 + age * 3, Math.sin(age * 5 + i) * 0.6, 0, Math.PI * 2);
				context.fill();
			}

			// The cupped hands, turned to face the wind.
			if (!won || rise < 1) {
				const start = rad(run.shield - REED_ARC / 2);
				const end = rad(run.shield + REED_ARC / 2);
				const middle = rad(run.shield);
				context.save();
				context.globalAlpha = won ? 1 - rise : 1;
				const skin = context.createRadialGradient(CX, CY, HANDS - 4, CX, CY, HANDS + HANDS_W + 4);
				skin.addColorStop(0, "#f2c58f");
				skin.addColorStop(0.55, "#c98f5f");
				skin.addColorStop(1, "#8a5c3b");
				const half = (REED_ARC / 2) * DEG;
				for (const side of [-1, 1]) {
					// Each hand: the palm along the arc, from the middle out to its side.
					const from = side < 0 ? middle - half : middle + 0.035;
					const to = side < 0 ? middle - 0.035 : middle + half;
					context.strokeStyle = skin;
					context.lineWidth = HANDS_W - 3;
					context.lineCap = "round";
					context.beginPath();
					context.arc(CX, CY, HANDS + (HANDS_W - 3) / 2, from, to);
					context.stroke();
					// Four fingers, cupped round the outside.
					for (let finger = 0; finger < 4; finger++) {
						const a = middle + side * half * (0.16 + finger * 0.2);
						const r = HANDS + HANDS_W - 3;
						context.fillStyle = finger % 2 ? "#c58a5a" : "#cf9564";
						context.beginPath();
						context.ellipse(CX + Math.cos(a) * r, CY + Math.sin(a) * r, 4.6, 6.2, a, 0, Math.PI * 2);
						context.fill();
						context.strokeStyle = "rgba(90,52,30,.45)";
						context.lineWidth = 1;
						context.stroke();
					}
					// The thumb at the hand's outer end, curled in toward the flame.
					const thumb = middle + side * half * 1.02;
					context.fillStyle = "#d9a06c";
					context.beginPath();
					context.ellipse(CX + Math.cos(thumb) * (HANDS + 3), CY + Math.sin(thumb) * (HANDS + 3), 4.5, 8, thumb + Math.PI / 2 + side * 0.5, 0, Math.PI * 2);
					context.fill();
				}
				// Warm light on the hands' inner face.
				context.strokeStyle = `rgba(255,220,160,${0.35 + 0.25 * flameLevel})`;
				context.lineWidth = 3;
				context.beginPath();
				context.arc(CX, CY, HANDS + 1.5, start + 0.05, end - 0.05);
				context.stroke();
				// Where a tap aims them.
				const aim = toward.current;
				if (aim !== null && run.phase === "playing") {
					const at = polar(aim, HANDS + HANDS_W + 16);
					context.fillStyle = "rgba(255,226,170,.55)";
					context.beginPath();
					context.arc(at.x, at.y, 5, 0, Math.PI * 2);
					context.fill();
				}
				context.restore();
			}

			// Dust turned aside, or rushing in.
			for (const mote of motes.current) {
				mote.age += dt;
				mote.x += mote.vx * dt;
				mote.y += mote.vy * dt;
				mote.vx *= 0.97;
				mote.vy *= 0.97;
				const life = 1 - mote.age / mote.life;
				if (life <= 0) continue;
				context.fillStyle = `rgba(${mote.color},${0.85 * life})`;
				context.beginPath();
				context.arc(mote.x, mote.y, 1.6 + life * 1.6, 0, Math.PI * 2);
				context.fill();
			}
			motes.current = motes.current.filter((mote) => mote.age < mote.life);

			// Rising light at the end.
			if (rise > 0) {
				for (let i = 0; i < 24; i++) {
					const age = (out / 60 + i / 24) % 1;
					const a = i * 137.5;
					const r = 30 + age * 170;
					context.fillStyle = `rgba(255,236,180,${0.7 * (1 - age) * rise})`;
					context.beginPath();
					context.arc(CX + Math.cos(a * DEG) * r * 0.6, CY - age * 150 + Math.sin(a * DEG) * 30, 2, 0, Math.PI * 2);
					context.fill();
				}
			}

			// The HUD: the flame's three chances, and the flame kept.
			if (!won || out < 40) {
				context.fillStyle = "rgba(6,10,18,.6)";
				context.beginPath();
				context.roundRect(10, 10, 100, 34, 12);
				context.fill();
				for (let i = 0; i < REED_LIVES; i++) {
					const x = 32 + i * 28;
					const left = i < REED_LIVES - run.through;
					context.fillStyle = left ? "#ffc46b" : "rgba(255,255,255,.18)";
					context.beginPath();
					context.moveTo(x, 17);
					context.quadraticCurveTo(x + 9, 28, x + 6, 34);
					context.quadraticCurveTo(x, 39, x - 6, 34);
					context.quadraticCurveTo(x - 9, 28, x, 17);
					context.fill();
				}
				context.fillStyle = "rgba(6,10,18,.6)";
				context.beginPath();
				context.roundRect(290, 10, 100, 34, 12);
				context.fill();
				context.fillStyle = "rgba(255,255,255,.2)";
				context.fillRect(302, 24, 76, 6);
				context.fillStyle = "#ffc46b";
				context.fillRect(302, 24, 76 * flameLevel, 6);
			}
			if (run.phase === "playing" && run.tick < HINT_TICKS) {
				const fade = 1 - clamp((run.tick - HINT_TICKS + 30) / 30);
				context.fillStyle = `rgba(6,10,18,${0.65 * fade})`;
				context.beginPath();
				context.roundRect(66, 340, 268, 40, 12);
				context.fill();
				context.fillStyle = `rgba(240,234,220,${fade})`;
				context.font = "800 16px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("← → or tap toward the wind", 200, 366);
				// Where the chapter stands: the wind is the council against him (12:14), and he will not quench the flax (12:20).
				// Only once the round is under way, so it never shows through the how-to-play card.
				if (run.tick > 0) {
					context.fillStyle = `rgba(6,10,18,${0.65 * fade})`;
					context.beginPath();
					context.roundRect(24, 46, 352, 60, 14);
					context.fill();
					context.fillStyle = `rgba(240,234,220,${fade})`;
					context.font = `italic 600 17px ${SERIF}`;
					context.fillText("Then the Pharisees went out,", 200, 70);
					context.fillText("and held a council against him", 200, 94);
				}
			}
			if (won && !ended.current && out > 30) {
				context.globalAlpha = clamp((out - 30) / 25);
				context.fillStyle = "rgba(20,14,6,.55)";
				context.beginPath();
				context.roundRect(24, 40, 352, 66, 14);
				context.fill();
				context.fillStyle = "#fff4dc";
				context.font = `italic 700 20px ${SERIF}`;
				context.textAlign = "center";
				context.fillText("till he send forth", 200, 68);
				context.fillText("judgment unto victory.", 200, 94);
				context.globalAlpha = 1;
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const aimAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return null;
		const point = stagePoint(canvas, event);
		const dx = point.x - CX;
		const dy = point.y - CY;
		if (Math.hypot(dx, dy) < 8) return null;
		return reedWrap(Math.atan2(dx, -dy) / DEG);
	};
	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		const canvas = canvasRef.current;
		if (paused || !canvas) return;
		canvas.setPointerCapture?.(event.pointerId);
		const aim = aimAt(event);
		if (aim !== null) pointer.current = aim;
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		if (pointer.current === null) return;
		const aim = aimAt(event);
		if (aim !== null) pointer.current = aim;
	};
	const onPointerUp = () => {
		// A tap keeps turning the hands until they face where it pointed.
		if (pointer.current !== null) toward.current = pointer.current;
		pointer.current = null;
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
			aria-label="Night in a field. At the centre a smoking flax, a lamp barely burning, with a bruised reed beside it, and a pair of cupped hands round it. Gusts of wind come from all sides: the grass bends and dust streams in from the side a gust is coming from. Turn the hands to meet each gust with the left and right arrows, or tap or hold toward the side it comes from."
		/>
	);
}
