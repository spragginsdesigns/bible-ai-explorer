"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, stagePoint, useStageLoop, useSynth } from "@/components/beta/games/stage-kit";
import type { StageProps } from "@/components/beta/games/types";
import {
	WEDDING_DOOR,
	WEDDING_HIGHWAYS,
	WEDDING_MISTAKE_LIMIT,
	WEDDING_SECONDS,
	WEDDING_UNCLOTHED_LIMIT,
	guestAt,
	isClothed,
	newWedding,
	stepWedding,
	weddingResult,
	type WeddingEvent,
	type WeddingGuest,
	type WeddingState,
} from "@/lib/beta/games/the-wedding-garment-rules";

/**
 * The Wedding Garment (LC-17851), Matthew 22:1-14: the king's wedding hall on
 * a festive evening, lanterns strung overhead and the banquet glowing through
 * the open door. Guests come in from the highways, both bad and good (v10);
 * those in drab road clothes are clothed in a white wedding garment with a tap
 * or click before they reach the door.
 */

const DRAB = ["#6b5642", "#5a5048", "#7a6347", "#4f4a3f", "#6e5a4c", "#5d4b3b", "#73624f", "#544537"];
const SKIN = ["#c99a74", "#a8775a", "#e0b48e", "#8d6047", "#b98563"];
const SASH = ["#d9a441", "#c25b4a", "#5b8bc2", "#7fae6b"];
const LANTERNS = [
	{ x: 30, color: "#ff8a3d" },
	{ x: 85, color: "#ffcf4a" },
	{ x: 140, color: "#ff5f5f" },
	{ x: 200, color: "#ffcf4a" },
	{ x: 260, color: "#ff5f5f" },
	{ x: 315, color: "#ffcf4a" },
	{ x: 370, color: "#ff8a3d" },
];

interface Spark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	born: number;
	life: number;
	color: string;
	size: number;
}

interface Popup {
	x: number;
	y: number;
	born: number;
	text: string;
	color: string;
}

export default function TheWeddingGarment({ seed, paused, muted, reducedMotion, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<WeddingState>(newWedding(seed));
	const taps = useRef<{ x: number; y: number }[]>([]);
	const sparks = useRef<Spark[]>([]);
	const popups = useRef<Popup[]>([]);
	const misses = useRef<{ x: number; y: number; born: number }[]>([]);
	const doorFlash = useRef<{ at: number; good: boolean }>({ at: -9, good: true });
	const shake = useRef(0);
	const ended = useRef(false);
	const ticks = useRef(0);
	const synth = useSynth(muted);

	const burst = useCallback((x: number, y: number, count: number, colors: string[], speed: number, life: number) => {
		const t = state.current.t;
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
			const v = speed * (0.4 + Math.random() * 0.6);
			sparks.current.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v - 20, born: t, life: life * (0.6 + Math.random() * 0.6), color: colors[i % colors.length], size: 1.3 + Math.random() * 2.2 });
		}
	}, []);

	const handle = useCallback(
		(event: WeddingEvent) => {
			const play = synth.current;
			const t = state.current.t;
			if (event.type === "clothe") {
				burst(event.x, event.y, 16, ["#ffffff", "#fff3c4", "#ffd166"], 80, 0.6);
				play?.tone(784, 0.14, { type: "triangle", volume: 0.14 });
				play?.tone(1175, 0.22, { type: "triangle", volume: 0.1, delay: 0.05 });
			}
			if (event.type === "mistake") {
				popups.current.push({ x: event.x, y: event.y - 18, born: t, text: "Already clothed!", color: "#ff6b5a" });
				if (!reducedMotion) shake.current = 6;
				play?.tone(150, 0.25, { type: "sawtooth", volume: 0.12, to: 110 });
			}
			if (event.type === "miss") {
				misses.current.push({ x: event.x, y: event.y, born: t });
				play?.tone(260, 0.05, { type: "square", volume: 0.035 });
			}
			if (event.type === "welcome") {
				doorFlash.current = { at: t, good: true };
				burst(WEDDING_DOOR.x, WEDDING_DOOR.y - 20, 6, ["#ffd166", "#fff3c4"], 40, 0.5);
				play?.tone(1568, 0.25, { type: "sine", volume: 0.05 });
			}
			if (event.type === "unclothed") {
				doorFlash.current = { at: t, good: false };
				popups.current.push({ x: WEDDING_DOOR.x, y: WEDDING_DOOR.y - 60, born: t, text: "No garment!", color: "#ff6b5a" });
				if (!reducedMotion) shake.current = 8;
				play?.tone(196, 0.45, { type: "sawtooth", volume: 0.14, to: 98 });
			}
			if (event.type === "won") [523, 659, 784, 1047, 1319].forEach((note, index) => play?.tone(note, 1.2, { type: "triangle", volume: 0.12, delay: index * 0.08 }));
			if (event.type === "lost") play?.tone(262, 1, { type: "sine", volume: 0.18, to: 110 });
		},
		[burst, reducedMotion, synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") return;
		const events: WeddingEvent[] = [];
		stepWedding(run, { taps: taps.current.splice(0) }, events);
		for (const event of events) handle(event);
		onTime(Math.max(0, WEDDING_SECONDS - run.t));
		ticks.current += 1;
		const canvas = canvasRef.current;
		if (canvas && ticks.current % 6 === 0) {
			canvas.dataset.targets = run.guests
				.filter((guest) => !isClothed(guest))
				.map((guest) => {
					const at = guestAt(guest);
					return `${Math.round(at.cx)},${Math.round(at.cy)},${Math.round(guest.length - guest.along)}`;
				})
				.join(";");
			canvas.dataset.mistakes = String(run.mistakes);
		}
		const result = weddingResult(run);
		if (result && !ended.current) {
			ended.current = true;
			onEnd(result);
		}
	}, [handle, onEnd, onTime]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const t = run.t;
			context.save();
			if (shake.current > 0.2) {
				context.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);
				shake.current *= 0.85;
			}

			// An evening sky, the plaza, and the banquet's glow spilling out of the door.
			const sky = context.createLinearGradient(0, 0, 0, 160);
			sky.addColorStop(0, "#1d1840");
			sky.addColorStop(1, "#5a2f52");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, 180);
			const plaza = context.createLinearGradient(0, 150, 0, STAGE);
			plaza.addColorStop(0, "#5e3d33");
			plaza.addColorStop(1, "#3a2620");
			context.fillStyle = plaza;
			context.fillRect(-10, 150, STAGE + 20, STAGE);
			const feast = context.createRadialGradient(WEDDING_DOOR.x, WEDDING_DOOR.y, 10, WEDDING_DOOR.x, WEDDING_DOOR.y + 40, 260);
			feast.addColorStop(0, "rgba(255,205,120,.55)");
			feast.addColorStop(1, "rgba(255,205,120,0)");
			context.fillStyle = feast;
			context.fillRect(-10, 120, STAGE + 20, STAGE);

			// The highways, worn pale, all leading to the door.
			for (const from of WEDDING_HIGHWAYS) {
				const angle = Math.atan2(WEDDING_DOOR.y - from.y, WEDDING_DOOR.x - from.x) + Math.PI / 2;
				context.fillStyle = "rgba(230,190,140,.16)";
				context.beginPath();
				context.moveTo(from.x + Math.cos(angle) * 26, from.y + Math.sin(angle) * 26);
				context.lineTo(WEDDING_DOOR.x + Math.cos(angle) * 10, WEDDING_DOOR.y + Math.sin(angle) * 10);
				context.lineTo(WEDDING_DOOR.x - Math.cos(angle) * 10, WEDDING_DOOR.y - Math.sin(angle) * 10);
				context.lineTo(from.x - Math.cos(angle) * 26, from.y - Math.sin(angle) * 26);
				context.closePath();
				context.fill();
			}

			// The wedding hall: columns, a pediment, garlands and the open door.
			context.fillStyle = "#e9d8b8";
			context.fillRect(70, 70, 260, 84);
			context.fillStyle = "#d4bf98";
			context.beginPath();
			context.moveTo(60, 72);
			context.lineTo(200, 38);
			context.lineTo(340, 72);
			context.closePath();
			context.fill();
			context.fillStyle = "#c6ad84";
			context.fillRect(60, 70, 280, 6);
			for (const x of [84, 120, 270, 306]) {
				context.fillStyle = "#f4e8d0";
				context.fillRect(x, 78, 12, 74);
				context.fillStyle = "#c6ad84";
				context.fillRect(x - 2, 76, 16, 4);
			}
			context.strokeStyle = "#4f8a4a";
			context.lineWidth = 4;
			context.beginPath();
			for (let i = 0; i < 4; i++) {
				const left = 76 + i * 64;
				context.moveTo(left, 82);
				context.quadraticCurveTo(left + 32, 98, left + 64, 82);
			}
			context.stroke();
			const doorGlow = context.createLinearGradient(0, 96, 0, WEDDING_DOOR.y);
			const flashAge = t - doorFlash.current.at;
			const flash = flashAge < 0.4 ? 1 - flashAge / 0.4 : 0;
			doorGlow.addColorStop(0, "#ffe7a8");
			doorGlow.addColorStop(1, doorFlash.current.good ? "#ffb347" : `rgb(255,${Math.round(179 - 110 * flash)},${Math.round(71 - 30 * flash)})`);
			context.fillStyle = doorGlow;
			context.beginPath();
			context.moveTo(176, WEDDING_DOOR.y + 2);
			context.lineTo(176, 116);
			context.arc(200, 116, 24, Math.PI, 0);
			context.lineTo(224, WEDDING_DOOR.y + 2);
			context.closePath();
			context.fill();
			if (flash > 0) {
				const ring = context.createRadialGradient(200, 126, 4, 200, 126, 70);
				ring.addColorStop(0, doorFlash.current.good ? `rgba(255,230,150,${0.6 * flash})` : `rgba(255,70,50,${0.7 * flash})`);
				ring.addColorStop(1, "rgba(255,230,150,0)");
				context.fillStyle = ring;
				context.fillRect(120, 50, 160, 150);
			}
			// The banquet within: a long table and its lamps.
			context.fillStyle = "rgba(140,70,30,.55)";
			context.fillRect(180, 134, 40, 6);
			context.fillStyle = "#fff6d0";
			for (const x of [186, 200, 214]) {
				context.beginPath();
				context.arc(x, 130, 1.8, 0, Math.PI * 2);
				context.fill();
			}

			// Lanterns strung across the evening.
			context.strokeStyle = "rgba(40,30,30,.9)";
			context.lineWidth = 1.2;
			context.beginPath();
			context.moveTo(-10, 36);
			context.quadraticCurveTo(200, 70, 410, 36);
			context.stroke();
			for (const [index, lantern] of LANTERNS.entries()) {
				const along = (lantern.x + 10) / 420;
				const y = 36 + 4 * 17 * along * (1 - along) + 4;
				const sway = reducedMotion ? 0 : Math.sin(time * 1.6 + index) * 1.5;
				const glow = context.createRadialGradient(lantern.x + sway, y + 6, 1, lantern.x + sway, y + 6, 22);
				glow.addColorStop(0, `${lantern.color}aa`);
				glow.addColorStop(1, `${lantern.color}00`);
				context.fillStyle = glow;
				context.fillRect(lantern.x - 24, y - 16, 48, 48);
				context.fillStyle = lantern.color;
				context.beginPath();
				context.ellipse(lantern.x + sway, y + 6, 6, 8, 0, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = "#3a2a20";
				context.fillRect(lantern.x + sway - 3, y - 3, 6, 2);
			}

			// The guests, the farthest (nearest the door) first.
			const ordered = [...run.guests].sort((a, b) => guestAt(a).y - guestAt(b).y);
			for (const guest of ordered) drawGuest(context, run, guest, reducedMotion);

			// Clear marks on every guest still in road clothes: a ring, and "TAP!" at first.
			for (const guest of ordered) {
				if (isClothed(guest)) continue;
				const at = guestAt(guest);
				const pulse = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(time * 9 + guest.id);
				const near = guest.along / guest.length > 0.66;
				context.strokeStyle = near ? `rgba(255,95,80,${0.55 + 0.4 * pulse})` : `rgba(255,232,160,${0.45 + 0.35 * pulse})`;
				context.lineWidth = 2.2;
				context.beginPath();
				context.arc(at.cx, at.cy, 24 * at.scale + 4 + pulse * 2, 0, Math.PI * 2);
				context.stroke();
				if (t < 3) {
					context.font = "900 13px system-ui, sans-serif";
					context.textAlign = "center";
					context.lineWidth = 4;
					context.strokeStyle = "rgba(0,0,0,.75)";
					context.fillStyle = "#fff";
					context.strokeText("TAP!", at.cx, at.cy - 34 * at.scale - 8);
					context.fillText("TAP!", at.cx, at.cy - 34 * at.scale - 8);
				}
			}

			sparks.current = sparks.current.filter((item) => t - item.born < item.life);
			for (const item of sparks.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / item.life);
				context.fillStyle = item.color;
				context.beginPath();
				context.arc(item.x + item.vx * age, item.y + item.vy * age + 30 * age * age, item.size, 0, Math.PI * 2);
				context.fill();
			}
			context.globalAlpha = 1;
			misses.current = misses.current.filter((item) => t - item.born < 0.3);
			for (const item of misses.current) {
				context.strokeStyle = `rgba(255,255,255,${0.45 * (1 - (t - item.born) / 0.3)})`;
				context.lineWidth = 2;
				context.beginPath();
				context.arc(item.x, item.y, 6 + (t - item.born) * 40, 0, Math.PI * 2);
				context.stroke();
			}
			popups.current = popups.current.filter((item) => t - item.born < 0.9);
			for (const item of popups.current) {
				const age = t - item.born;
				context.globalAlpha = Math.max(0, 1 - age / 0.9);
				context.font = "900 14px system-ui, sans-serif";
				context.textAlign = "center";
				context.lineWidth = 4;
				context.strokeStyle = "rgba(0,0,0,.8)";
				context.fillStyle = item.color;
				context.strokeText(item.text, Math.max(60, Math.min(340, item.x)), item.y - age * 24);
				context.fillText(item.text, Math.max(60, Math.min(340, item.x)), item.y - age * 24);
				context.globalAlpha = 1;
			}

			// What is left to lose: guests at the door unclothed, and mistakes.
			const pill = (x: number, label: string, used: number, limit: number) => {
				context.fillStyle = "rgba(15,10,25,.6)";
				context.beginPath();
				context.roundRect(x, 6, 150, 26, 10);
				context.fill();
				context.font = "800 11px system-ui, sans-serif";
				context.textAlign = "left";
				context.fillStyle = "#fff";
				context.fillText(label, x + 10, 23);
				for (let i = 0; i < limit; i++) {
					context.beginPath();
					context.arc(x + 150 - 14 - (limit - 1 - i) * 17, 19, 6, 0, Math.PI * 2);
					if (i < used) {
						context.fillStyle = "#ff5a46";
						context.fill();
					} else {
						context.strokeStyle = "rgba(255,255,255,.7)";
						context.lineWidth = 2;
						context.stroke();
					}
				}
			};
			pill(8, "No garment", run.unclothed, WEDDING_UNCLOTHED_LIMIT);
			pill(242, "Mistakes", run.mistakes, WEDDING_MISTAKE_LIMIT);
			context.font = "800 11px system-ui, sans-serif";
			context.textAlign = "center";
			context.fillStyle = "rgba(255,255,255,.85)";
			context.fillText(`Clothed ${run.clothed}`, 200, 23);

			if (run.phase === "won") {
				context.fillStyle = "rgba(255,230,160,.18)";
				context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			}
			context.restore();
		},
		[reducedMotion],
	);

	useStageLoop(canvasRef, { paused, step, draw });

	const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		if (paused || !canvasRef.current) return;
		taps.current.push(stagePoint(canvasRef.current, event));
	};

	return (
		<canvas
			ref={canvasRef}
			onPointerDown={onPointerDown}
			className="absolute inset-0 h-full w-full touch-none"
			role="img"
			aria-label="Guests stream in from the highways toward the door of the wedding hall. Tap or click each guest in drab road clothes to clothe him in a white wedding garment; tapping one already clothed is a mistake."
		/>
	);
}

/** A guest walking to the door: drab road clothes, or a white wedding garment (unfurling as it is given). */
function drawGuest(context: CanvasRenderingContext2D, run: WeddingState, guest: WeddingGuest, reducedMotion: boolean) {
	const at = guestAt(guest);
	const s = at.scale;
	const bob = reducedMotion ? 0 : Math.abs(Math.sin(guest.along * 0.16)) * 2 * s;
	const x = at.x;
	const y = at.y - bob;
	const skin = SKIN[guest.look % SKIN.length];
	const given = guest.clothedAt === null ? 0 : Math.min(1, (run.t - guest.clothedAt) / 0.22);
	context.fillStyle = "rgba(20,10,10,.3)";
	context.beginPath();
	context.ellipse(at.x, at.y + 1, 11 * s, 3 * s, 0, 0, Math.PI * 2);
	context.fill();
	const robe = (color: string) => {
		context.fillStyle = color;
		context.beginPath();
		context.moveTo(x - 11 * s, y);
		context.lineTo(x - 7 * s, y - 34 * s);
		context.lineTo(x + 7 * s, y - 34 * s);
		context.lineTo(x + 11 * s, y);
		context.closePath();
		context.fill();
	};
	if (!guest.drab || given < 1) {
		if (guest.drab) {
			// Road clothes: a dusty cloak with patches, a hood on some, a bundle on others.
			robe(DRAB[guest.look % DRAB.length]);
			context.fillStyle = "rgba(0,0,0,.22)";
			context.fillRect(x - 6 * s, y - 20 * s, 5 * s, 5 * s);
			context.fillRect(x + 2 * s, y - 10 * s, 5 * s, 4 * s);
			context.strokeStyle = "rgba(30,20,10,.5)";
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(x - 9 * s, y - 4 * s);
			context.lineTo(x - 4 * s, y - 2 * s);
			context.lineTo(x + 1 * s, y - 5 * s);
			context.stroke();
		}
	}
	if (!guest.drab || given > 0) {
		// The white wedding garment, with a festive sash; given ones unfurl from the shoulders down.
		context.save();
		if (guest.drab && given < 1) {
			context.beginPath();
			context.rect(x - 14 * s, y - 36 * s, 28 * s, 36 * s * given + 1);
			context.clip();
		}
		const glow = context.createRadialGradient(x, y - 18 * s, 2, x, y - 18 * s, 26 * s);
		glow.addColorStop(0, "rgba(255,250,230,.55)");
		glow.addColorStop(1, "rgba(255,250,230,0)");
		context.fillStyle = glow;
		context.fillRect(x - 28 * s, y - 46 * s, 56 * s, 56 * s);
		robe("#fbf7ee");
		context.fillStyle = SASH[guest.look % SASH.length];
		context.fillRect(x - 8 * s, y - 22 * s, 16 * s, 3 * s);
		context.fillStyle = "#e7c35a";
		context.fillRect(x - 11 * s, y - 2 * s, 22 * s, 2 * s);
		context.restore();
	}
	// The head: a hood for some of the road-weary, a festive head-cloth once clothed.
	context.fillStyle = skin;
	context.beginPath();
	context.arc(x, y - 40 * s, 6.5 * s, 0, Math.PI * 2);
	context.fill();
	if (guest.drab && given < 1 && guest.look % 3 === 0) {
		context.fillStyle = DRAB[(guest.look + 3) % DRAB.length];
		context.beginPath();
		context.arc(x, y - 41 * s, 7.5 * s, Math.PI, Math.PI * 2);
		context.fill();
	} else if (!guest.drab || given >= 1) {
		context.fillStyle = "#fbf7ee";
		context.beginPath();
		context.arc(x, y - 42 * s, 6.8 * s, Math.PI, Math.PI * 2);
		context.fill();
	}
	if (guest.drab && given < 1 && guest.look % 3 === 1) {
		context.fillStyle = "#8a6a44";
		context.beginPath();
		context.ellipse(x - 9 * s, y - 26 * s, 5 * s, 7 * s, 0.3, 0, Math.PI * 2);
		context.fill();
	}
}
