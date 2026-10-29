"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { STAGE, takePresses, useStageLoop, useSynth } from "../stage-kit";
import type { StageProps } from "../types";
import {
	HOUSE_ARRIVE_TICKS,
	HOUSE_COURSES,
	HOUSE_COURSE_H,
	HOUSE_FALL_TICKS,
	HOUSE_ROCK_W,
	HOUSE_ROCK_X,
	HOUSE_ROCK_Y,
	HOUSE_SECONDS,
	houseReady,
	houseResult,
	houseTop,
	newHouse,
	stepHouse,
	type HouseEvent,
	type HouseState,
} from "@/lib/beta/games/house-on-the-rock-rules";

/**
 * Built on the Rock (LC-17851), Matthew 7:24-27: a golden afternoon on a
 * granite outcrop; limestone blocks are let down on a rope and dropped
 * square on the course below. On the win the roof goes on, the sky darkens,
 * the rain descends, the floods come and the winds blow, and it fell not.
 */

const DROP_KEYS = new Set([" ", "arrowdown"]);
const SERIF = "Georgia, 'Times New Roman', serif";
const OUTRO_WON = 170;
const OUTRO_LOST = 45;
const LANE_GAP = 50;

function stone(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glow = 0) {
	const face = context.createLinearGradient(0, y, 0, y + h);
	face.addColorStop(0, "#efe1c0");
	face.addColorStop(1, "#c7ad7c");
	context.fillStyle = face;
	context.fillRect(x, y, w, h);
	context.fillStyle = "rgba(255,255,255,.35)";
	context.fillRect(x, y, w, 3);
	context.strokeStyle = "#8a6f45";
	context.lineWidth = 1.5;
	context.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
	if (glow > 0) {
		context.fillStyle = `rgba(255,236,160,${glow})`;
		context.fillRect(x - 3, y - 3, w + 6, h + 6);
	}
}

export default function HouseOnTheRock({ seed, paused, muted, reducedMotion, keys, onTime, onEnd }: StageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const state = useRef<HouseState>(newHouse(seed));
	const taps = useRef(0);
	const outro = useRef(0);
	const ended = useRef(false);
	const shake = useRef(0);
	const flashes = useRef<{ text: string; tick: number; good: boolean }[]>([]);
	const dust = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
	const lastFrame = useRef(0);
	const lastData = useRef(0);
	const synth = useSynth(muted);

	const sound = useCallback(
		(event: HouseEvent) => {
			const play = synth.current;
			if (!play) return;
			if (event.type === "drop") play.tone(520, 0.12, { type: "sine", volume: 0.08, to: 300 });
			if (event.type === "land") {
				play.noise(0.16, { volume: 0.32, filter: 380 });
				play.tone(event.perfect ? 660 : 180, event.perfect ? 0.3 : 0.18, { type: event.perfect ? "triangle" : "square", volume: event.perfect ? 0.16 : 0.07 });
				if (event.perfect) play.tone(990, 0.25, { type: "sine", volume: 0.08, delay: 0.06 });
			}
			if (event.type === "fell") {
				play.noise(0.7, { volume: 0.35, filter: 260 });
				play.tone(160, 0.7, { type: "sawtooth", volume: 0.08, to: 60 });
			}
			if (event.type === "time") play.tone(240, 0.8, { type: "sine", volume: 0.16, to: 150 });
			if (event.type === "roof") {
				play.noise(0.2, { volume: 0.3, filter: 500 });
				// Rain, thunder and wind, then the chord: it fell not.
				play.noise(2.4, { volume: 0.14, filter: 3500, type: "highpass", delay: 0.4 });
				play.noise(1.3, { volume: 0.4, filter: 140, delay: 0.6 });
				play.noise(1.6, { volume: 0.12, filter: 700, type: "bandpass", delay: 1.0 });
				[392, 494, 587, 784].forEach((note, index) => play.tone(note, 1.4, { type: "triangle", volume: 0.14, delay: 1.6 + index * 0.08 }));
			}
		},
		[synth],
	);

	const step = useCallback(() => {
		const run = state.current;
		if (run.phase !== "playing") {
			if (ended.current) return;
			outro.current += 1;
			if (outro.current >= (run.phase === "won" ? OUTRO_WON : OUTRO_LOST)) {
				const result = houseResult(run);
				if (result) {
					ended.current = true;
					onEnd(result);
				}
			}
			return;
		}
		const drop = takePresses(keys).some((key) => DROP_KEYS.has(key)) || taps.current > 0;
		taps.current = 0;
		const events: HouseEvent[] = [];
		stepHouse(run, { drop }, events);
		for (const event of events) {
			sound(event);
			if (event.type === "land") {
				const top = run.courses.at(-1);
				if (top) {
					const y = HOUSE_ROCK_Y - run.courses.length * HOUSE_COURSE_H + HOUSE_COURSE_H;
					for (let i = 0; i < 14; i++) dust.current.push({ x: top.x + (Math.random() - 0.5) * top.w, y, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 50, life: 0.5 });
				}
				flashes.current.push({ text: event.perfect ? "Square!" : `−${Math.round(event.cut)}`, tick: run.tick, good: event.perfect });
				shake.current = event.perfect ? 0.3 : 0.6;
			}
			if (event.type === "fell") shake.current = 1.2;
		}
		onTime(Math.max(0, HOUSE_SECONDS - run.t));
	}, [keys, onEnd, onTime, sound]);

	const draw = useCallback(
		(context: CanvasRenderingContext2D, time: number) => {
			const run = state.current;
			const dt = Math.min(0.05, Math.max(0, time - (lastFrame.current || time)));
			lastFrame.current = time;
			const won = run.phase === "won";
			const storm = won ? Math.max(0, Math.min(1, (outro.current - 20) / 40)) : 0;
			const top = houseTop(run);
			const canvas = canvasRef.current;
			if (canvas && time - lastData.current > 0.05) {
				lastData.current = time;
				canvas.dataset.stone = `${Math.round(run.stone.x)},${Math.round(top.x)},${houseReady(run) ? 1 : 0},${run.stone.dir},${run.phase}`;
			}

			context.save();
			const quake = (shake.current > 0 ? shake.current : 0) + storm * 0.15;
			if (quake > 0 && !reducedMotion) context.translate(Math.sin(time * 60) * 3 * quake, Math.cos(time * 47) * 2 * quake);
			shake.current = Math.max(0, shake.current - dt * 3);

			// Sky: a golden afternoon, then the storm.
			const sky = context.createLinearGradient(0, 0, 0, HOUSE_ROCK_Y);
			sky.addColorStop(0, storm ? `rgb(${Math.round(120 - 80 * storm)},${Math.round(170 - 120 * storm)},${Math.round(210 - 130 * storm)})` : "#78aad2");
			sky.addColorStop(1, storm ? `rgb(${Math.round(246 - 170 * storm)},${Math.round(212 - 140 * storm)},${Math.round(150 - 70 * storm)})` : "#f6d496");
			context.fillStyle = sky;
			context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
			context.fillStyle = `rgba(255,236,170,${0.8 * (1 - storm)})`;
			context.beginPath();
			context.arc(330, 70, 26, 0, Math.PI * 2);
			context.fill();
			// Far hills and the sand below, where the foolish man built.
			context.fillStyle = storm ? "#4a5560" : "#9bb08a";
			context.beginPath();
			context.moveTo(0, 300);
			context.quadraticCurveTo(90, 250, 180, 292);
			context.quadraticCurveTo(300, 240, 400, 286);
			context.lineTo(400, 400);
			context.lineTo(0, 400);
			context.fill();
			context.fillStyle = storm ? "#6f6248" : "#e3c98f";
			context.fillRect(0, 372, STAGE, 28);

			// The rock.
			const rock = context.createLinearGradient(0, HOUSE_ROCK_Y, 0, 400);
			rock.addColorStop(0, "#8e8f94");
			rock.addColorStop(1, "#4d4f57");
			context.fillStyle = rock;
			context.beginPath();
			context.moveTo(HOUSE_ROCK_X - HOUSE_ROCK_W / 2, HOUSE_ROCK_Y);
			context.lineTo(HOUSE_ROCK_X + HOUSE_ROCK_W / 2, HOUSE_ROCK_Y);
			context.lineTo(HOUSE_ROCK_X + HOUSE_ROCK_W / 2 + 40, 400);
			context.lineTo(HOUSE_ROCK_X - HOUSE_ROCK_W / 2 - 46, 400);
			context.closePath();
			context.fill();
			context.strokeStyle = "rgba(255,255,255,.18)";
			context.lineWidth = 2;
			context.beginPath();
			context.moveTo(HOUSE_ROCK_X - 50, HOUSE_ROCK_Y + 14);
			context.lineTo(HOUSE_ROCK_X - 20, HOUSE_ROCK_Y + 34);
			context.moveTo(HOUSE_ROCK_X + 40, HOUSE_ROCK_Y + 10);
			context.lineTo(HOUSE_ROCK_X + 62, HOUSE_ROCK_Y + 40);
			context.stroke();

			// The courses laid so far.
			const sway = won && !reducedMotion ? Math.sin(time * 5) * storm * 1.2 : 0;
			run.courses.forEach((course, index) => {
				const y = HOUSE_ROCK_Y - (index + 1) * HOUSE_COURSE_H;
				const age = run.tick - run.stone.spawnedAt;
				const glow = index === run.courses.length - 1 && course.perfect && !won ? Math.max(0, 0.5 - age / 40) : 0;
				stone(context, course.x - course.w / 2 + sway * (index / HOUSE_COURSES), y, course.w, HOUSE_COURSE_H, glow);
			});

			// The target: the top course's edges glow while a stone hangs.
			if (run.phase === "playing") {
				const pulse = reducedMotion ? 0.7 : 0.5 + 0.4 * Math.sin(time * 7);
				context.strokeStyle = `rgba(255,214,102,${pulse})`;
				context.lineWidth = 3;
				context.setLineDash([6, 5]);
				context.beginPath();
				context.moveTo(top.x - top.w / 2, top.y);
				context.lineTo(top.x - top.w / 2, top.y - LANE_GAP + 8);
				context.moveTo(top.x + top.w / 2, top.y);
				context.lineTo(top.x + top.w / 2, top.y - LANE_GAP + 8);
				context.stroke();
				context.setLineDash([]);
			}

			// The hanging stone: let down on a rope, then dropped.
			const hang = run.stone;
			if (run.phase === "playing" || (run.phase === "lost" && run.fell === "narrow")) {
				const laneY = top.y - LANE_GAP - HOUSE_COURSE_H / 2;
				let y = laneY;
				if (hang.droppedAt === null) {
					const k = Math.min(1, (run.tick - hang.spawnedAt) / HOUSE_ARRIVE_TICKS);
					y = laneY - (1 - k) * (1 - k) * 70;
					context.strokeStyle = "#5b4630";
					context.lineWidth = 2;
					context.beginPath();
					context.moveTo(hang.x, -10);
					context.lineTo(hang.x, y - HOUSE_COURSE_H / 2);
					context.stroke();
					// The plumb line: where it will land.
					context.strokeStyle = "rgba(255,255,255,.55)";
					context.lineWidth = 1.5;
					context.setLineDash([3, 5]);
					context.beginPath();
					context.moveTo(hang.x, y + HOUSE_COURSE_H / 2);
					context.lineTo(hang.x, top.y);
					context.stroke();
					context.setLineDash([]);
				} else {
					const k = Math.min(1, (run.tick - hang.droppedAt + (run.phase === "lost" ? outro.current : 0)) / HOUSE_FALL_TICKS);
					y = laneY + k * k * (LANE_GAP + (run.phase === "lost" ? outro.current * 6 : 0));
				}
				if (!(run.phase === "lost" && outro.current > 40)) stone(context, hang.x - hang.w / 2, y - HOUSE_COURSE_H / 2, hang.w, HOUSE_COURSE_H);
				if (run.phase === "playing" && run.courses.length === 0 && hang.droppedAt === null && run.tick > HOUSE_ARRIVE_TICKS && run.tick < 200) {
					context.fillStyle = `rgba(59,42,23,${0.6 + 0.4 * Math.sin(time * 8)})`;
					context.font = "900 17px system-ui, sans-serif";
					context.textAlign = "center";
					context.fillText("Drop it square on the rock!", 200, 40);
				}
			}

			// The cut-off pieces fall away.
			for (const chip of run.chips) {
				const age = (run.tick - chip.tick + (run.phase === "playing" ? 0 : outro.current)) / 60;
				if (age > 1.2) continue;
				context.save();
				context.translate(chip.x + chip.side * age * 60, chip.y + age * age * 400);
				context.rotate(reducedMotion ? 0 : chip.side * age * 3);
				stone(context, -chip.w / 2, -HOUSE_COURSE_H / 2, chip.w, HOUSE_COURSE_H);
				context.restore();
			}

			// Won: the roof, then the storm, and it fell not.
			if (won) {
				const crown = run.courses.at(-1);
				if (crown) {
					const roofY = HOUSE_ROCK_Y - run.courses.length * HOUSE_COURSE_H;
					const drop = Math.min(1, outro.current / 16);
					const ry = roofY - (1 - drop) * 60;
					context.fillStyle = "#8b3f2a";
					context.beginPath();
					context.moveTo(crown.x - crown.w / 2 - 12 + sway, ry);
					context.lineTo(crown.x + sway, ry - Math.max(26, crown.w * 0.42));
					context.lineTo(crown.x + crown.w / 2 + 12 + sway, ry);
					context.closePath();
					context.fill();
					context.strokeStyle = "#5e2617";
					context.lineWidth = 2;
					context.stroke();
					// The door.
					const base = run.courses[0];
					context.fillStyle = "#5b3b22";
					context.beginPath();
					context.roundRect(base.x - 10, HOUSE_ROCK_Y - HOUSE_COURSE_H * 1.6, 20, HOUSE_COURSE_H * 1.6, [10, 10, 0, 0]);
					context.fill();
				}
				if (storm > 0) {
					context.fillStyle = `rgba(20,26,40,${0.35 * storm})`;
					context.fillRect(-10, -10, STAGE + 20, STAGE + 20);
					// The rain descended.
					context.strokeStyle = `rgba(190,210,235,${0.6 * storm})`;
					context.lineWidth = 1.5;
					context.beginPath();
					for (let i = 0; i < 70; i++) {
						const x = (i * 61.7 + time * 120) % (STAGE + 60) - 30;
						const y = (i * 37.3 + time * 520) % (STAGE + 40) - 20;
						context.moveTo(x, y);
						context.lineTo(x - 7, y + 16);
					}
					context.stroke();
					// The floods came.
					const flood = 372 - storm * 26 + Math.sin(time * 3) * 3;
					context.fillStyle = "rgba(70,96,120,.85)";
					context.beginPath();
					context.moveTo(-10, flood);
					for (let x = -10; x <= STAGE + 10; x += 20) context.lineTo(x, flood + Math.sin(x / 18 + time * 4) * 4);
					context.lineTo(STAGE + 10, 410);
					context.lineTo(-10, 410);
					context.fill();
					// The winds blew.
					context.strokeStyle = `rgba(255,255,255,${0.35 * storm})`;
					context.lineWidth = 2;
					for (let i = 0; i < 5; i++) {
						const y = 90 + i * 46;
						const x = ((time * 260 + i * 140) % 560) - 120;
						context.beginPath();
						context.moveTo(x, y);
						context.quadraticCurveTo(x + 40, y - 10, x + 90, y);
						context.stroke();
					}
					if (outro.current > 90) {
						context.globalAlpha = Math.min(1, (outro.current - 90) / 25);
						context.fillStyle = "#fff4d6";
						context.font = `italic 700 30px ${SERIF}`;
						context.textAlign = "center";
						context.fillText("and it fell not", 200, 56);
						context.globalAlpha = 1;
					}
				}
			}

			// Course count, and the flash of each landing.
			context.textAlign = "left";
			context.font = "800 14px system-ui, sans-serif";
			context.fillStyle = storm ? "rgba(255,255,255,.8)" : "rgba(40,30,20,.75)";
			context.fillText(`Course ${Math.min(HOUSE_COURSES, run.courses.length + (won ? 0 : 1))} of ${HOUSE_COURSES}`, 12, 22);
			context.textAlign = "center";
			flashes.current = flashes.current.filter((flash) => run.tick - flash.tick < 40 && run.phase === "playing");
			for (const flash of flashes.current) {
				const age = run.tick - flash.tick;
				context.globalAlpha = 1 - age / 40;
				context.fillStyle = flash.good ? "#fff1a8" : "#ffb199";
				context.strokeStyle = "rgba(0,0,0,.55)";
				context.lineWidth = 4;
				context.font = "900 22px system-ui, sans-serif";
				const fx = Math.min(STAGE - 40, top.x + top.w / 2 + 34);
				context.strokeText(flash.text, fx, top.y - 8 - age);
				context.fillText(flash.text, fx, top.y - 8 - age);
				context.globalAlpha = 1;
			}
			if (run.phase === "lost") {
				context.fillStyle = "rgba(20,10,5,.35)";
				context.fillRect(0, 0, STAGE, STAGE);
				context.fillStyle = "#fff";
				context.font = "900 24px system-ui, sans-serif";
				context.fillText(run.fell === "narrow" ? "Too narrow to stand" : "The rain came first", 200, 200);
			}
			dust.current = dust.current.filter((mote) => (mote.life -= dt) > 0);
			context.fillStyle = "rgba(240,225,190,.8)";
			for (const mote of dust.current) {
				mote.x += mote.vx * dt;
				mote.y += mote.vy * dt;
				context.globalAlpha = mote.life * 2;
				context.fillRect(mote.x - 2, mote.y - 2, 4, 4);
			}
			context.globalAlpha = 1;
			context.restore();
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
			aria-label="A stone block slides above the rock. Tap, or press Space or the down arrow, to drop it square on the course below; build eight courses before the rain."
		/>
	);
}
