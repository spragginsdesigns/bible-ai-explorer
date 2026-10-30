"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	SECRET_HYPOCRITES,
	SECRET_POOR_X,
	SECRET_SECONDS,
	SECRET_START_X,
	SECRET_STRIKES,
	hypocriteAt,
	newSecret,
	secretAlert,
	secretResult,
	stepSecret,
	stumbling,
	type SecretEvent,
	type SecretState,
} from "@/lib/beta/games/in-secret-rules";

/**
 * In Secret (LC-17908), Matthew 6:1-6: a street in Jerusalem in the low gold
 * of evening, seen from the side. The disciple walks while the walk is held
 * (→ or Space, or a touch held anywhere), past a poor man by the way, where
 * he gives his alms, and on to the open door of his closet. Three hypocrites
 * stand on the steps along the street with their trumpets, their backs to
 * him; when one lifts his trumpet and his head turns, he is about to look,
 * and while he looks a beam of his gaze falls across the street. Walking in
 * it is being seen. At the closet the door shuts and a soft light shines
 * behind it; the Father is never drawn.
 */

const FEET = 326;
const STEPS_Y = 262;
const POOR_Y = 376;
/** Where the hypocrites stand on the steps. */
const HYPOCRITE_X = [100, 214, 290];
const ROBES = [
	{ robe: "#8e2a3a", border: "#e0b44a", shawl: "#f1e3c4" },
	{ robe: "#4f3577", border: "#d9a441", shawl: "#efe2c8" },
	{ robe: "#24646a", border: "#e6c15a", shawl: "#f3e7cf" },
];
const DOOR = { left: 336, right: 374, top: 254 };
const POOR_DRAW_X = SECRET_POOR_X + 4;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
	size: number;
	note?: boolean;
}

interface Floater {
	x: number;
	y: number;
	born: number;
	text: string;
	color: string;
}

function eyeIcon(context: CanvasRenderingContext2D, x: number, y: number, size: number, open: number, color: string) {
	// open 0: a closed lid; 1: wide open, with the pupil.
	context.save();
	context.translate(x, y);
	context.strokeStyle = color;
	context.fillStyle = color;
	context.lineWidth = Math.max(1.5, size * 0.14);
	context.lineCap = "round";
	const w = size;
	const h = size * 0.55 * open;
	context.beginPath();
	context.moveTo(-w, 0);
	context.quadraticCurveTo(0, -h * 1.6 - 0.001, w, 0);
	context.quadraticCurveTo(0, h * 1.6 + size * 0.5 * (1 - open), -w, 0);
	if (open > 0.15) {
		context.stroke();
		context.beginPath();
		context.arc(0, 0, size * 0.36 * Math.min(1, open * 1.3), 0, Math.PI * 2);
		context.fill();
	} else {
		// A closed lid with lashes.
		context.stroke();
		for (const lash of [-0.55, 0, 0.55]) {
			context.beginPath();
			context.moveTo(lash * w, size * 0.32);
			context.lineTo(lash * w * 1.15, size * 0.62);
			context.stroke();
		}
	}
	context.restore();
}

function drawDisciple(context: CanvasRenderingContext2D, x: number, phase: number, moving: boolean, blush: number, alms: boolean) {
	const stride = moving ? Math.sin(phase) : 0;
	const bob = moving ? Math.abs(Math.cos(phase)) * 1.6 : 0;
	context.save();
	context.translate(x, FEET - bob);
	context.scale(1.2, 1.2);
	// His long evening shadow.
	context.fillStyle = "rgba(60,30,50,.28)";
	context.beginPath();
	context.ellipse(16, bob + 1, 26, 4, 0, 0, Math.PI * 2);
	context.fill();
	if (blush > 0) {
		const glow = context.createRadialGradient(0, -26, 4, 0, -26, 40);
		glow.addColorStop(0, `rgba(255,120,110,${0.5 * blush})`);
		glow.addColorStop(1, "rgba(255,120,110,0)");
		context.fillStyle = glow;
		context.fillRect(-40, -70, 80, 80);
	}
	// Feet, stepping.
	context.fillStyle = "#5a3b24";
	context.beginPath();
	context.ellipse(-4 + stride * 6, -1, 5, 2.4, 0, 0, Math.PI * 2);
	context.ellipse(4 - stride * 6, -1, 5, 2.4, 0, 0, Math.PI * 2);
	context.fill();
	// The robe of plain linen, and a brown mantle over it.
	context.fillStyle = "#eadfc6";
	context.beginPath();
	context.moveTo(-9, -36);
	context.lineTo(9, -36);
	context.lineTo(12 + stride * 2, -3);
	context.lineTo(-12 + stride * 2, -3);
	context.closePath();
	context.fill();
	context.fillStyle = "#8a6544";
	context.beginPath();
	context.moveTo(-9, -38);
	context.lineTo(6, -38);
	context.lineTo(2, -10);
	context.lineTo(-11 + stride, -14);
	context.closePath();
	context.fill();
	// His right hand, holding the alms until he gives them.
	context.strokeStyle = "#c98f63";
	context.lineWidth = 3.4;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(5, -32);
	context.lineTo(10, -20);
	context.stroke();
	if (!alms) {
		context.fillStyle = "#7a5530";
		context.beginPath();
		context.arc(11, -18, 3.4, 0, Math.PI * 2);
		context.fill();
	}
	// Head with a head cloth, turned toward the way ahead.
	context.fillStyle = "#c98f63";
	context.beginPath();
	context.arc(1, -44, 7.4, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#d8cbb0";
	context.beginPath();
	context.moveTo(-8, -40);
	context.quadraticCurveTo(-7, -54, 2, -53);
	context.quadraticCurveTo(9, -52, 8, -46);
	context.lineTo(1, -46);
	context.lineTo(-3, -36);
	context.closePath();
	context.fill();
	context.restore();
}

/** A hypocrite on the steps. `turn` 0 is his back to the street, .5 his head turned, 1 facing it. `lift` raises his trumpet. */
function drawHypocrite(context: CanvasRenderingContext2D, index: number, turn: number, lift: number, toward: number, idleBlow: number) {
	const x = HYPOCRITE_X[index];
	const colors = ROBES[index];
	context.save();
	context.translate(x, STEPS_Y);
	context.scale(1.15, 1.15);
	context.fillStyle = "rgba(60,30,50,.25)";
	context.beginPath();
	context.ellipse(14, 0, 24, 4, 0, 0, Math.PI * 2);
	context.fill();
	// A fine robe with a broad border.
	context.fillStyle = colors.robe;
	context.beginPath();
	context.moveTo(-10, -42);
	context.lineTo(10, -42);
	context.lineTo(15, 0);
	context.lineTo(-15, 0);
	context.closePath();
	context.fill();
	context.fillStyle = colors.border;
	context.fillRect(-15, -5, 30, 3.5);
	context.fillRect(-1.5, -40, 3, 36);
	// The prayer shawl over his shoulders.
	context.fillStyle = colors.shawl;
	context.beginPath();
	context.moveTo(-12, -40);
	context.lineTo(12, -40);
	context.lineTo(9, -26);
	context.lineTo(-9, -26);
	context.closePath();
	context.fill();
	context.fillStyle = "#3a5a9a";
	context.fillRect(-9, -29, 18, 1.6);
	// The trumpet: at his side, raised to his lips on a warning, or blown to the sky.
	const raise = Math.max(lift, idleBlow);
	const angle = -0.35 - raise * 1.05 + (lift > idleBlow ? toward * lift * 0.35 : 0);
	const handX = 10;
	const handY = -30 - raise * 14;
	context.save();
	context.translate(handX, handY);
	context.rotate(angle);
	context.fillStyle = "#e0b44a";
	context.fillRect(0, -1.6, 30, 3.2);
	context.beginPath();
	context.moveTo(28, -2);
	context.lineTo(38, -7);
	context.lineTo(38, 7);
	context.lineTo(28, 2);
	context.closePath();
	context.fill();
	context.fillStyle = "#fff2b8";
	context.fillRect(2, -1.4, 24, 1);
	context.restore();
	context.strokeStyle = colors.robe;
	context.lineWidth = 4.5;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(8, -38);
	context.lineTo(handX, handY);
	context.stroke();
	// The head, turning from his back to the street.
	const headX = turn * toward * 1.5;
	context.fillStyle = "#c48a5c";
	context.beginPath();
	context.arc(headX, -50, 8, 0, Math.PI * 2);
	context.fill();
	// The head covering: all of it seen from behind, its edge sliding back as he turns.
	context.fillStyle = colors.shawl;
	context.beginPath();
	context.arc(headX, -51, 8.6, Math.PI * (1.02 - turn * 0.02), Math.PI * (2 - turn * 0.02));
	context.fill();
	if (turn < 0.3) {
		// Seen from behind: the covering hangs down his back, a dark cord round it.
		context.beginPath();
		context.moveTo(headX - 8.6, -51);
		context.lineTo(headX - 10, -36);
		context.lineTo(headX + 10, -36);
		context.lineTo(headX + 8.6, -51);
		context.closePath();
		context.fill();
		context.strokeStyle = "rgba(60,40,30,.35)";
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(headX - 2, -47);
		context.lineTo(headX - 3, -37);
		context.moveTo(headX + 3, -47);
		context.lineTo(headX + 4, -37);
		context.stroke();
		context.strokeStyle = "#3a2a20";
		context.lineWidth = 2;
		context.beginPath();
		context.arc(headX, -51, 8.4, Math.PI * 1.05, Math.PI * 1.95);
		context.stroke();
	}
	if (turn >= 0.3 && turn < 0.75) {
		// His head in profile, toward the street side the disciple is on.
		context.fillStyle = "#2a1a12";
		context.beginPath();
		context.arc(headX + toward * 4, -50, 1.3, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = colors.shawl;
		context.beginPath();
		context.ellipse(headX - toward * 4, -48, 5, 7, 0, 0, Math.PI * 2);
		context.fill();
	}
	if (turn >= 0.75) {
		context.fillStyle = "#2a1a12";
		context.beginPath();
		context.arc(headX - 3 + toward * 1.2, -50, 1.4, 0, Math.PI * 2);
		context.arc(headX + 3 + toward * 1.2, -50, 1.4, 0, Math.PI * 2);
		context.fill();
		context.strokeStyle = "#2a1a12";
		context.lineWidth = 1.1;
		context.beginPath();
		context.moveTo(headX - 5, -53.5);
		context.lineTo(headX - 1.4, -53);
		context.moveTo(headX + 1.4, -53);
		context.lineTo(headX + 5, -53.5);
		context.stroke();
		context.fillStyle = "#8a6a52";
		context.beginPath();
		context.ellipse(headX, -43, 5, 2.6, 0, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

function drawPoorMan(context: CanvasRenderingContext2D, given: number, time: number) {
	const x = POOR_DRAW_X;
	context.save();
	context.translate(x, POOR_Y);
	context.fillStyle = "rgba(60,30,50,.25)";
	context.beginPath();
	context.ellipse(10, 2, 26, 4, 0, 0, Math.PI * 2);
	context.fill();
	// A worn mat, and a man sitting on it in a patched cloak.
	context.fillStyle = "#9a7a4e";
	context.fillRect(-22, -2, 44, 4);
	context.fillStyle = "#7c6a58";
	context.beginPath();
	context.moveTo(-14, 0);
	context.quadraticCurveTo(-16, -26, -2, -28);
	context.quadraticCurveTo(10, -26, 14, 0);
	context.closePath();
	context.fill();
	context.fillStyle = "#93806a";
	context.fillRect(-6, -18, 7, 6);
	context.fillStyle = "#b9845a";
	context.beginPath();
	context.arc(-2, -33 + given * -2, 6.6, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#6a5a4a";
	context.beginPath();
	context.arc(-2, -35 + given * -2, 7, Math.PI, Math.PI * 2);
	context.fill();
	// His bowl, held out; after the alms, hands lifted a little in thanks and a coin in it.
	const lift = given * 5;
	context.strokeStyle = "#b9845a";
	context.lineWidth = 3;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(4, -20);
	context.lineTo(14, -12 - lift);
	context.stroke();
	context.fillStyle = "#8a5a32";
	context.beginPath();
	context.ellipse(17, -11 - lift, 7, 3, 0, 0, Math.PI);
	context.fill();
	if (given > 0) {
		const glint = 0.6 + 0.4 * Math.sin(time * 5);
		context.fillStyle = `rgba(255,214,90,${glint})`;
		context.beginPath();
		context.arc(17, -12.5 - lift, 2.6, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}


/** Steps the closing picture plays before the round is handed back (as the other stages do). */
const OUTRO_WON = 120;
const OUTRO_LOST = 70;

export default function InSecret({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<SecretState>(newSecret(seed));
	const pointers = useRef<Set<number>>(new Set());
	const particles = useRef<Particle[]>([]);
	const floaters = useRef<Floater[]>([]);
	const turns = useRef<number[]>(Array.from({ length: SECRET_HYPOCRITES }, () => 0));
	const lifts = useRef<number[]>(Array.from({ length: SECRET_HYPOCRITES }, () => 0));
	const shownX = useRef(SECRET_START_X);
	const walkPhase = useRef(0);
	const lastStep = useRef(-1);
	const seenAt = useRef(-9);
	const almsAt = useRef(-9);
	const endedWall = useRef<number | null>(null);
	const lastFrame = useRef(0);
	const ended = useRef(false);
	const outro = useRef(0);
	const lastData = useRef("");
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, t: number, rise = 0) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const power = speed * (0.4 + Math.random() * 0.8);
			particles.current.push({ x, y, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power - rise, born: t, life: 0.5 + Math.random() * 0.4, color: colors[i % colors.length], size: 1.2 + Math.random() * 2 });
		}
	}, []);

	const react = useCallback(
		(event: SecretEvent, run: SecretState) => {
			const play = synth.current;
			if (event.type === "warn") {
				const hx = HYPOCRITE_X[event.who];
				particles.current.push({ x: hx + 22, y: STEPS_Y - 84, vx: 6, vy: -22, born: run.t, life: 0.9, color: "#ffe08a", size: 13, note: true });
				play?.tone(523, 0.16, { type: "sawtooth", volume: 0.06 });
				play?.tone(784, 0.26, { type: "sawtooth", volume: 0.07, delay: 0.13 });
			}
			if (event.type === "look") play?.tone(185, 0.38, { type: "triangle", volume: 0.12, to: 175 });
			if (event.type === "feint") play?.tone(660, 0.22, { type: "sine", volume: 0.07, to: 440 });
			if (event.type === "seen") {
				seenAt.current = run.t;
				floaters.current.push({ x: run.x, y: FEET - 84, born: run.t, text: "Seen!", color: "#ffb3a8" });
				burst(run.x, FEET - 30, 14, ["#ff9a8a", "#ffd2c8"], 60, run.t);
				play?.tone(330, 0.4, { type: "triangle", volume: 0.15, to: 210 });
				play?.noise(0.18, { volume: 0.12, filter: 700 });
			}
			if (event.type === "alms") {
				almsAt.current = run.t;
				floaters.current.push({ x: POOR_DRAW_X, y: POOR_Y - 52, born: run.t, text: "In secret", color: "#ffe08a" });
				burst(POOR_DRAW_X + 17, POOR_Y - 16, 12, ["#ffe08a", "#fff6d0"], 45, run.t, 20);
				play?.tone(2093, 0.12, { type: "sine", volume: 0.1 });
				play?.tone(2637, 0.2, { type: "sine", volume: 0.09, delay: 0.07 });
			}
			if (event.type === "shut") {
				play?.noise(0.2, { volume: 0.45, filter: 260 });
				[392, 494, 587, 784].forEach((note, index) => play?.tone(note, 1.4, { type: "sine", volume: 0.09, delay: 0.35 + index * 0.12 }));
			}
			if (event.type === "reward") {
				floaters.current.push({ x: 200, y: 200, born: run.t, text: "They have their reward", color: "#ffd2c8" });
				play?.tone(294, 0.7, { type: "triangle", volume: 0.12, to: 196 });
			}
			if (event.type === "time") play?.tone(262, 0.6, { type: "triangle", volume: 0.1, to: 220 });
		},
		[burst, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			// The closing picture (the door shut on him, or the street) plays out before the player's card covers it.
			const result = secretResult(run);
			if (!result || ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				ended.current = true;
				onEnd(result);
			}
			return;
		}
		takePresses(keys);
		const walk = keys.held.has("arrowright") || keys.held.has(" ") || pointers.current.size > 0;
		const events: SecretEvent[] = [];
		stepSecret(run, { walk }, events);
		for (const event of events) react(event, run);
		if (run.walking) {
			walkPhase.current += 0.16;
			if (run.t - lastStep.current > 0.3) {
				lastStep.current = run.t;
				synth.current?.noise(0.04, { volume: 0.05, filter: 900 });
				particles.current.push({ x: run.x - 6, y: FEET - 2, vx: -12, vy: -8, born: run.t, life: 0.5, color: "rgba(200,160,110,.6)", size: 3 });
			}
		}
		onTime(Math.max(0, SECRET_SECONDS - run.t));
		const canvas = canvasRef.current;
		const alert = stumbling(run) ? "stumble" : secretAlert(run);
		const data = `${run.phase} ${Math.round(run.x)} ${run.strikes} ${alert} ${run.alms ? 1 : 0}`;
		if (canvas && data !== lastData.current) {
			lastData.current = data;
			canvas.dataset.secret = data;
		}
		if (secretResult(run) && canvas) canvas.dataset.secret = `${run.phase} ${Math.round(run.x)} ${run.strikes} clear ${run.alms ? 1 : 0}`;
	}, [keys, onEnd, onTime, react, synth]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			const frameDt = Math.min(0.1, Math.max(0, time - lastFrame.current));
			lastFrame.current = time;
			const still = reducedMotion ? 0 : time;
			if (run.phase !== "playing" && endedWall.current === null) endedWall.current = time;
			const since = endedWall.current === null ? 0 : time - endedWall.current;
			const alert = secretAlert(run);
			shownX.current += (run.x - shownX.current) * Math.min(1, frameDt * 14);
			const dx = shownX.current;

			const seenAge = t - seenAt.current;
			const shake = !reducedMotion && seenAge < 0.25 ? (1 - seenAge / 0.25) * 3 : 0;
			context.save();
			if (shake) context.translate(Math.sin(time * 90) * shake, 0);

			// The evening sky, rose and gold over the city.
			const sky = context.createLinearGradient(0, 0, 0, 200);
			sky.addColorStop(0, "#3b3f78");
			sky.addColorStop(0.55, "#c47a6a");
			sky.addColorStop(1, "#f3c487");
			context.fillStyle = sky;
			context.fillRect(-10, 0, STAGE + 20, 200);
			// The low sun, behind the far wall.
			const sun = context.createRadialGradient(54, 150, 6, 54, 150, 80);
			sun.addColorStop(0, "rgba(255,240,190,.95)");
			sun.addColorStop(0.25, "rgba(255,214,140,.5)");
			sun.addColorStop(1, "rgba(255,214,140,0)");
			context.fillStyle = sun;
			context.fillRect(0, 60, 160, 160);
			// The far city: walls, towers and a dome.
			context.fillStyle = "#8a5f78";
			context.beginPath();
			context.moveTo(-10, 176);
			for (const [x, y] of [
				[20, 150],
				[46, 150],
				[46, 136],
				[64, 136],
				[64, 156],
				[150, 156],
				[150, 128],
				[166, 128],
				[166, 152],
				[250, 152],
				[262, 138],
				[300, 138],
				[300, 150],
				[410, 150],
			])
				context.lineTo(x, y);
			context.lineTo(410, 180);
			context.closePath();
			context.fill();
			context.beginPath();
			context.arc(210, 152, 22, Math.PI, Math.PI * 2);
			context.fill();

			// The street's buildings: the synagogue with its columns, houses either side.
			context.fillStyle = "#d6a873";
			context.fillRect(-10, 168, 330, 96);
			context.fillStyle = "#c69462";
			context.fillRect(150, 150, 130, 114);
			context.fillStyle = "#e3b985";
			context.fillRect(150, 146, 130, 8);
			for (let column = 0; column < 5; column++) {
				const cx = 160 + column * 27;
				context.fillStyle = "#e9c895";
				context.fillRect(cx, 160, 10, 92);
				context.fillStyle = "rgba(90,50,40,.18)";
				context.fillRect(cx + 7, 160, 3, 92);
			}
			context.fillStyle = "#6d4a3a";
			context.beginPath();
			context.moveTo(199, 252);
			context.lineTo(199, 214);
			context.arc(215, 214, 16, Math.PI, Math.PI * 2);
			context.lineTo(231, 252);
			context.closePath();
			context.fill();
			for (const [wx, wy] of [
				[24, 190],
				[70, 196],
				[112, 186],
				[296, 188],
			]) {
				context.fillStyle = "#6a4636";
				context.beginPath();
				context.moveTo(wx, wy + 18);
				context.lineTo(wx, wy + 6);
				context.arc(wx + 8, wy + 6, 8, Math.PI, Math.PI * 2);
				context.lineTo(wx + 16, wy + 18);
				context.closePath();
				context.fill();
			}
			// The steps where the hypocrites stand, "in the synagogues and in the streets".
			context.fillStyle = "#c59a68";
			context.fillRect(-10, 252, 340, 12);
			context.fillStyle = "#b48957";
			context.fillRect(-10, 262, 340, 8);

			// The street, paved, in the long evening light.
			const ground = context.createLinearGradient(0, 270, 0, 400);
			ground.addColorStop(0, "#c0915e");
			ground.addColorStop(1, "#8f6646");
			context.fillStyle = ground;
			context.fillRect(-10, 270, STAGE + 20, 130);
			context.strokeStyle = "rgba(90,58,40,.35)";
			context.lineWidth = 1;
			context.beginPath();
			for (let row = 0; row < 6; row++) {
				const y = 280 + row * 21;
				context.moveTo(-10, y);
				context.lineTo(410, y);
				for (let col = 0; col < 12; col++) {
					const x = col * 38 + (row % 2) * 19;
					context.moveTo(x, y);
					context.lineTo(x - 4, y + 21);
				}
			}
			context.stroke();

			// The closet: a small house at the end of the street, its door open.
			context.fillStyle = "#c79d6b";
			context.fillRect(320, 178, 90, 152);
			context.fillStyle = "#b38856";
			context.fillRect(316, 172, 94, 10);
			context.fillStyle = "#5a3a28";
			context.fillRect(354, 206, 12, 12);
			const shutting = run.phase === "won" ? Math.min(1, since / 0.35) : 0;
			const doorW = DOOR.right - DOOR.left;
			context.fillStyle = "#2a1a14";
			context.fillRect(DOOR.left, DOOR.top, doorW, FEET + 4 - DOOR.top);
			if (run.phase !== "won") {
				const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3);
				context.fillStyle = `rgba(255,226,150,${0.12 + 0.12 * pulse})`;
				context.fillRect(DOOR.left + 3, DOOR.top + 3, doorW - 6, FEET - DOOR.top);
			}
			// The door leaf, swung open against the wall, then shut.
			const open = 1 - shutting;
			context.fillStyle = "#7a4c2a";
			context.beginPath();
			context.moveTo(DOOR.right, DOOR.top);
			context.lineTo(DOOR.right + open * 14 - (1 - open) * doorW, DOOR.top + open * 4);
			context.lineTo(DOOR.right + open * 14 - (1 - open) * doorW, FEET + 4 - open * 4);
			context.lineTo(DOOR.right, FEET + 4);
			context.closePath();
			context.fill();
			context.strokeStyle = "#5a361c";
			context.lineWidth = 1;
			context.strokeRect(DOOR.left - 2, DOOR.top - 2, doorW + 4, FEET + 6 - DOOR.top);
			if (run.phase === "won") {
				// A soft light behind the shut door: the Father which seeth in secret, never drawn.
				const light = Math.min(1, Math.max(0, (since - 0.3) / 0.8));
				const halo = context.createRadialGradient(355, 290, 4, 355, 290, 90);
				halo.addColorStop(0, `rgba(255,240,190,${0.55 * light})`);
				halo.addColorStop(1, "rgba(255,240,190,0)");
				context.fillStyle = halo;
				context.fillRect(260, 190, 140, 160);
				context.fillStyle = `rgba(255,246,210,${0.9 * light})`;
				context.fillRect(DOOR.left - 2, DOOR.top - 2, doorW + 4, 2.5);
				context.fillRect(DOOR.left - 2, DOOR.top, 2.5, FEET + 4 - DOOR.top);
				context.fillRect(DOOR.right - 0.5, DOOR.top, 2.5, FEET + 4 - DOOR.top);
				context.fillRect(355, 207, 10, 10);
				if (!reducedMotion && light > 0)
					for (let mote = 0; mote < 6; mote++) {
						const a = (time * 0.6 + mote / 6) % 1;
						context.fillStyle = `rgba(255,240,190,${(1 - a) * 0.7 * light})`;
						context.beginPath();
						context.arc(342 + mote * 5.5, FEET - a * 60, 1.4, 0, Math.PI * 2);
						context.fill();
					}
			}

			// The gaze of every hypocrite who looks, a warm beam across the street.
			for (let who = 0; who < SECRET_HYPOCRITES; who++) {
				const { mode, look } = hypocriteAt(run, who);
				if (mode !== "look" || !look || run.phase !== "playing") continue;
				const hx = HYPOCRITE_X[who];
				const grow = Math.min(1, (t - look.from) / 0.12);
				const beam = context.createLinearGradient(hx, STEPS_Y - 58, dx, FEET - 28);
				beam.addColorStop(0, `rgba(255,120,80,${0.5 * grow})`);
				beam.addColorStop(1, `rgba(255,120,80,${0.16 * grow})`);
				context.fillStyle = beam;
				context.beginPath();
				context.moveTo(hx, STEPS_Y - 58);
				context.lineTo(dx - 34 * grow, FEET + 4);
				context.lineTo(dx + 34 * grow, FEET + 4);
				context.closePath();
				context.fill();
			}

			// The hypocrites, sounding their trumpets "that they may have glory of men".
			for (let who = 0; who < SECRET_HYPOCRITES; who++) {
				const { mode, look } = hypocriteAt(run, who);
				const target = run.phase !== "playing" ? 0 : mode === "look" ? 1 : mode === "warn" && look ? 0.2 + 0.4 * Math.min(1, (t - look.warn) / Math.max(0.01, look.from - look.warn)) : 0;
				const liftTarget = run.phase === "playing" && mode === "warn" ? 1 : mode === "look" ? 0.35 : 0;
				const rate = Math.min(1, frameDt * (target > turns.current[who] ? 18 : 10));
				turns.current[who] += (target - turns.current[who]) * rate;
				lifts.current[who] += (liftTarget - lifts.current[who]) * Math.min(1, frameDt * 16);
				const toward = dx >= HYPOCRITE_X[who] ? 1 : -1;
				// Now and then, turned away, he sounds his trumpet to the crowd.
				const cycle = (still * 0.45 + who * 0.37) % 1;
				const idle = mode === "away" && run.phase === "playing" && !reducedMotion ? Math.max(0, Math.sin(Math.min(1, cycle / 0.18) * Math.PI)) * (cycle < 0.18 ? 1 : 0) : 0;
				if (idle > 0.95 && Math.random() < 0.15)
					particles.current.push({ x: HYPOCRITE_X[who] + 18, y: STEPS_Y - 92, vx: -4 + Math.random() * 8, vy: -18, born: t, life: 0.8, color: "rgba(255,240,200,.8)", size: 9, note: true });
				drawHypocrite(context, who, turns.current[who], lifts.current[who], toward, idle * 0.8);
				// Over his head: a half-open eye as he turns, wide open while he looks.
				if (run.phase === "playing" && mode !== "away") {
					const pulse = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(time * 14);
					const hx = HYPOCRITE_X[who];
					context.fillStyle = mode === "look" ? "rgba(120,20,20,.75)" : "rgba(80,50,10,.65)";
					context.beginPath();
					context.arc(hx, STEPS_Y - 90, 14, 0, Math.PI * 2);
					context.fill();
					eyeIcon(context, hx, STEPS_Y - 90, 9 * (mode === "warn" ? pulse : 1), mode === "look" ? 1 : 0.45, mode === "look" ? "#ff8a78" : "#ffd36a");
				}
			}

			// The disciple crossing the street, and the poor man by the way in front of it.
			const blush = Math.max(0, 1 - seenAge / 0.9);
			if (run.phase !== "won" || since < 0.25) {
				context.save();
				if (run.phase === "won") context.globalAlpha = Math.max(0, 1 - since / 0.25);
				drawDisciple(context, dx, walkPhase.current, run.walking && run.phase === "playing", blush, run.alms);
				context.restore();
			}
			drawPoorMan(context, run.alms ? Math.min(1, (t - almsAt.current) / 0.4) : 0, still);

			// Particles: dust, notes, coins, light.
			particles.current = particles.current.filter((particle) => t - particle.born < particle.life);
			for (const particle of particles.current) {
				const age = t - particle.born;
				context.globalAlpha = Math.max(0, 1 - age / particle.life);
				context.fillStyle = particle.color;
				const px = particle.x + particle.vx * age;
				const py = particle.y + particle.vy * age;
				if (particle.note) {
					context.font = `900 ${particle.size}px system-ui, sans-serif`;
					context.textAlign = "center";
					context.fillText("♪", px, py);
				} else {
					context.beginPath();
					context.arc(px, py, particle.size, 0, Math.PI * 2);
					context.fill();
				}
			}
			context.globalAlpha = 1;
			context.restore();

			// A warm blush over the street when he is seen.
			if (seenAge < 0.5 && run.phase !== "won" && !reducedMotion) {
				context.fillStyle = `rgba(255,110,100,${0.28 * (1 - seenAge / 0.5)})`;
				context.fillRect(0, 0, STAGE, STAGE);
			}

			floaters.current = floaters.current.filter((floater) => t - floater.born < 1.1);
			context.textAlign = "center";
			for (const floater of floaters.current) {
				const age = (t - floater.born) / 1.1;
				context.font = floater.text.length > 12 ? "900 20px Georgia, serif" : "900 17px system-ui, sans-serif";
				context.globalAlpha = 1 - age * age;
				context.lineWidth = 3.5;
				context.strokeStyle = "rgba(40,20,20,.75)";
				context.strokeText(floater.text, floater.x, floater.y - age * 20);
				context.fillStyle = floater.color;
				context.fillText(floater.text, floater.x, floater.y - age * 20);
			}
			context.globalAlpha = 1;

			// The street at a glance: eyes closed (walk), one turning (freeze), one looking (be still).
			const chipColor = alert === "look" ? "rgba(130,24,24,.82)" : alert === "warn" ? "rgba(120,78,10,.82)" : "rgba(26,52,48,.72)";
			context.fillStyle = chipColor;
			context.beginPath();
			context.roundRect(166, 14, 68, 40, 14);
			context.fill();
			if (run.phase === "playing") {
				const pulse = alert === "warn" && !reducedMotion ? 0.85 + 0.15 * Math.sin(time * 16) : 1;
				eyeIcon(context, 200, 32, 17 * pulse, alert === "look" ? 1 : alert === "warn" ? 0.45 : 0, alert === "look" ? "#ffb0a2" : alert === "warn" ? "#ffd36a" : "#bdeedd");
			} else eyeIcon(context, 200, 32, 17, 0, "#bdeedd");

			// Seen so far: three lids, red once seen.
			context.fillStyle = "rgba(30,20,36,.62)";
			context.beginPath();
			context.roundRect(14, 18, 112, 32, 12);
			context.fill();
			for (let strike = 0; strike < SECRET_STRIKES; strike++) {
				const hit = strike < run.strikes;
				eyeIcon(context, 36 + strike * 34, 34, 10, hit ? 1 : 0, hit ? "#ff8a78" : "rgba(255,255,255,.55)");
			}
			// The alms: a coin, gold once given.
			context.fillStyle = "rgba(30,20,36,.62)";
			context.beginPath();
			context.roundRect(STAGE - 70, 18, 56, 32, 12);
			context.fill();
			context.strokeStyle = "#ffd36a";
			context.lineWidth = 2.5;
			context.beginPath();
			context.arc(STAGE - 54, 34, 8, 0, Math.PI * 2);
			context.stroke();
			if (run.alms) {
				context.fillStyle = "#ffd36a";
				context.fill();
			}
			context.fillStyle = run.phase === "won" ? "#fff2c0" : "rgba(255,255,255,.55)";
			context.fillRect(STAGE - 38, 24, 14, 20);
			context.fillStyle = "rgba(30,20,36,.9)";
			context.fillRect(STAGE - 35, 27, 8, 17);

			// The first moments: what to do.
			if (t < 2.4 && run.phase === "playing") {
				context.fillStyle = "rgba(30,20,36,.72)";
				context.beginPath();
				context.roundRect(60, 366, 280, 26, 12);
				context.fill();
				context.fillStyle = "#ffffff";
				context.font = "900 14px system-ui, sans-serif";
				context.textAlign = "center";
				context.fillText("Hold to walk · freeze when they turn", 200, 384);
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(20,10,30,.25)";
				context.fillRect(0, 0, STAGE, STAGE);
			}
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		pointers.current.add(event.pointerId);
	};
	const onUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		pointers.current.delete(event.pointerId);
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onDown}
			onPointerUp={onUp}
			onPointerCancel={onUp}
			onLostPointerCapture={onUp}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="A street in Jerusalem at evening, seen from the side. A disciple crosses it to give alms to a poor man by the way and then to shut the door of his closet. Hypocrites with trumpets stand on the steps along the street with their backs to him. Hold the right arrow or Space, or touch and hold, to walk; let go to stand still. When a hypocrite lifts his trumpet and turns his head, stand still: walking while one of them looks is being seen, and the third time loses."
		/>
	);
}
