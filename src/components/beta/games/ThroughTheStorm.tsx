"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, RotateCcw, Volume2, VolumeX, Waves } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { createStormSoundscape, type StormSoundscape } from "./through-the-storm-audio";
import { drawStormScene, stormLayout } from "./through-the-storm-scene";
import { AwardSaveStatus, GameHeader, Passage, PassageSection, StoryScreen, chapterHref as chapterHrefFor, useGameAward, useMuted, verseText } from "./shared";
import type { ChapterGameProps } from "./types";
import { gradeFor } from "@/lib/beta/games/games-rules";
import {
	BRACE_HOLD,
	STORM_GOAL,
	STORM_STEP,
	SWELL_WARNING,
	newStorm,
	nextSwell,
	stepStorm,
	stormResult,
	type StormEvent,
	type StormResult,
	type StormState,
} from "@/lib/beta/games/through-the-storm-rules";

/**
 * Through the Storm (LC-17851, docs/beta/games.md): Matthew 14:22-33 seen
 * through Peter's eyes. The simulation lives in through-the-storm-rules.ts;
 * this component runs it on a fixed step from requestAnimationFrame, draws it
 * (through-the-storm-scene.ts), plays the storm around the player
 * (through-the-storm-audio.ts) and tells the story in the passage's own words.
 */

type Screen = "intro" | "playing" | "paused" | "sinking" | "rescued" | "won";
type Direction = "left" | "right" | "up" | "down";

/** How long the rescue and the arrival play before their words come up. */
const RESCUE_SCENE = 2.1;
const ARRIVAL_SCENE = 2.8;
const IDLE_HELD = { left: 0, right: 0, up: 0, down: 0 };

export default function ThroughTheStorm({ game, verses, initialAward }: ChapterGameProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const faithRef = useRef<HTMLDivElement>(null);
	const faithLabelRef = useRef<HTMLSpanElement>(null);
	const wayRef = useRef<HTMLDivElement>(null);
	const wayLabelRef = useRef<HTMLSpanElement>(null);
	const hintRef = useRef<HTMLParagraphElement>(null);
	const cryRef = useRef<HTMLButtonElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);

	const storm = useRef<StormState>(newStorm(1));
	const screenRef = useRef<Screen>("intro");
	const keys = useRef({ left: false, right: false, up: false, down: false });
	const held = useRef({ ...IDLE_HELD });
	const drag = useRef({ x: 0, y: 0, pointer: null as number | null, lastX: 0, lastY: 0 });
	const queued = useRef({ brace: false, cry: false });
	const audio = useRef<StormSoundscape | null>(null);
	const ringPx = useRef(40);
	const scene = useRef({ rescueAt: null as number | null, arriveAt: null as number | null, flash: 0, boltAt: 0.3, nextFlash: 4, calm: 1, swellsSeen: 0, lostAt: -10, hint: "" });

	const [screen, setScreenState] = useState<Screen>("intro");
	const { muted, toggleMute } = useMuted(useCallback((next: boolean) => audio.current?.setMuted(next), []));
	const [result, setResult] = useState<StormResult | null>(null);
	const { award, saving, save: saveRun, resetSaving } = useGameAward(game.slug, initialAward);
	const [announcement, setAnnouncement] = useState("");
	const [rescuing, setRescuing] = useState(false);

	const setScreen = useCallback((next: Screen) => {
		screenRef.current = next;
		setScreenState(next);
	}, []);

	const handleEvent = useCallback(
		(event: StormEvent, now: number) => {
			const sound = audio.current;
			const look = scene.current;
			const buzz = (pattern: number | number[]) => navigator.vibrate?.(pattern);
			switch (event.type) {
				case "swell":
					look.swellsSeen += 1;
					if (look.swellsSeen === 1) setAnnouncement("A great swell is rising ahead. Brace as it reaches you.");
					break;
				case "brace":
					sound?.brace();
					break;
				case "braced":
					sound?.braced();
					buzz(20);
					break;
				case "struck":
					sound?.struck();
					buzz([60, 40, 30]);
					setAnnouncement("The swell broke over you. Find Jesus again.");
					break;
				case "lost":
					if (now - look.lostAt > 6) setAnnouncement("Your eyes have left Jesus. Look back to him.");
					look.lostAt = now;
					break;
				case "sinking":
					sound?.sinking();
					buzz([80, 60, 80]);
					setAnnouncement("Beginning to sink. Cry out: Lord, save me.");
					setScreen("sinking");
					break;
				case "rescued":
					look.rescueAt = now;
					sound?.rescue();
					setRescuing(true);
					setAnnouncement(verseText(verses, 31)[0]?.text ?? "Jesus caught you.");
					break;
				case "arrived": {
					look.arriveAt = now;
					sound?.calm();
					const run = stormResult(storm.current);
					if (run) {
						setResult(run);
						void saveRun(run);
					}
					setAnnouncement("You reached Jesus and took his hand. The wind ceased.");
					break;
				}
			}
		},
		[saveRun, setScreen, verses],
	);

	// The loop: fixed simulation steps, one draw per frame.
	useEffect(() => {
		const canvas = canvasRef.current;
		const stage = stageRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !stage || !context) return;
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let size = { width: 0, height: 0 };
		// The canvas resolution steps down (never below 1) if a device cannot keep the storm smooth.
		let ratioCap = 2;
		let frameTime = 1 / 60;
		let framesSinceCheck = 0;
		const resize = () => {
			const rect = stage.getBoundingClientRect();
			const ratio = Math.min(window.devicePixelRatio || 1, ratioCap);
			size = { width: rect.width, height: rect.height };
			ringPx.current = stormLayout(rect.width, rect.height).ring;
			stage.dataset.ring = ringPx.current.toFixed(1);
			canvas.width = Math.round(rect.width * ratio);
			canvas.height = Math.round(rect.height * ratio);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(stage);

		let frame = 0;
		let last = performance.now();
		let carry = 0;
		const events: StormEvent[] = [];
		const tick = (time: number) => {
			frame = requestAnimationFrame(tick);
			const now = time / 1000;
			const interval = (time - last) / 1000;
			const elapsed = Math.min(0.1, interval);
			last = time;
			frameTime += (Math.min(interval, 0.25) - frameTime) * 0.05;
			if (++framesSinceCheck > 90) {
				framesSinceCheck = 0;
				if (frameTime > 1 / 30 && ratioCap > 1 && Math.min(window.devicePixelRatio || 1, ratioCap) > 1 && !document.hidden) {
					ratioCap = Math.max(1, ratioCap - 0.5);
					resize();
				}
			}
			const state = storm.current;
			const current = screenRef.current;
			const look = scene.current;
			const running = current === "playing" || current === "sinking";
			if (running) {
				carry += elapsed;
				while (carry >= STORM_STEP) {
					const k = keys.current;
					const h = held.current;
					const lookX = (k.right || h.right > 0 ? 1 : 0) - (k.left || h.left > 0 ? 1 : 0);
					const lookY = (k.down || h.down > 0 ? 1 : 0) - (k.up || h.up > 0 ? 1 : 0);
					// A drag moves Jesus with the finger, a step's worth at a time.
					const d = drag.current;
					const ring = ringPx.current;
					const dragX = Math.max(-0.4, Math.min(0.4, d.x / ring));
					const dragY = Math.max(-0.4, Math.min(0.4, d.y / ring));
					d.x -= dragX * ring;
					d.y -= dragY * ring;
					stepStorm(state, { lookX, lookY, dragX, dragY, brace: queued.current.brace, cry: queued.current.cry }, events);
					queued.current.brace = false;
					queued.current.cry = false;
					carry -= STORM_STEP;
				}
				for (const event of events.splice(0)) handleEvent(event, now);
			}

			// The wind ceases once he is safe with Jesus (verse 32).
			const calmFrom = look.arriveAt ?? (look.rescueAt !== null ? look.rescueAt + 0.5 : null);
			look.calm = calmFrom === null ? 1 : Math.min(1, Math.max(0, 1 - (now - calmFrom) / 2.5));
			if (current === "playing" && state.phase === "walking" && look.calm > 0.5) {
				look.nextFlash -= elapsed;
				if (look.nextFlash <= 0) {
					const near = Math.random();
					// Lightning lights the whole sea; with reduced motion only the thunder is heard.
					if (!reduceMotion) {
						look.flash = 0.6 + 0.4 * near;
						look.boltAt = Math.random();
					}
					look.nextFlash = 5 + Math.random() * 7;
					audio.current?.thunder(near);
				}
			}
			look.flash = Math.max(0, look.flash - elapsed * 2.2);
			const swell = nextSwell(state);
			// The sound's levels glide on their own; twenty updates a second are plenty.
			if (framesSinceCheck % 3 === 0)
				audio.current?.mix({
					storm: look.calm,
					wind: state.wind,
					focus: state.phase === "walking" ? state.focus : 0.6,
					swell: swell ? Math.max(0, 1 - swell.eta / SWELL_WARNING) : 0,
					faith: state.faith,
					now,
				});

			if (look.rescueAt !== null && current === "sinking" && now - look.rescueAt > RESCUE_SCENE) setScreen("rescued");
			if (look.arriveAt !== null && current === "playing" && now - look.arriveAt > ARRIVAL_SCENE) setScreen("won");

			drawStormScene(context, {
				width: size.width,
				height: size.height,
				state,
				now,
				storm: look.calm,
				flash: look.flash,
				boltAt: look.boltAt,
				rescue: look.rescueAt === null ? null : now - look.rescueAt,
				arrival: look.arriveAt === null ? null : now - look.arriveAt,
				guides: current === "playing" || current === "paused",
				reduceMotion,
			});

			// The HUD is written straight to the DOM: no React render per frame.
			const faith = Math.round(state.faith);
			if (faithRef.current) {
				faithRef.current.style.width = `${faith}%`;
				faithRef.current.dataset.low = faith < 30 ? "true" : "false";
			}
			if (faithLabelRef.current) faithLabelRef.current.textContent = `${faith}%`;
			const way = Math.min(100, Math.floor((state.x / STORM_GOAL) * 100));
			if (wayRef.current) wayRef.current.style.width = `${way}%`;
			if (wayLabelRef.current) wayLabelRef.current.textContent = `${way}% of the way to Jesus`;
			let hint = "";
			if (current === "playing" && state.phase === "walking") {
				if (swell && swell.eta < 1.4 && look.swellsSeen <= 3) hint = swell.eta <= BRACE_HOLD ? "Brace now!" : "A great swell! Brace as the rings meet";
				else if (!state.onTarget && state.t < 25) hint = "Look back to Jesus: bring him into the ring";
			}
			if (hintRef.current && hint !== look.hint) {
				look.hint = hint;
				hintRef.current.textContent = hint;
				hintRef.current.style.opacity = hint ? "1" : "0";
			}
			// What the view shows, for anyone (or any test) reading the stage.
			stage.dataset.gazeX = state.gazeX.toFixed(2);
			stage.dataset.gazeY = state.gazeY.toFixed(2);
			stage.dataset.swell = swell ? swell.eta.toFixed(2) : "";
			stage.dataset.braced = state.brace > 0 ? "true" : "false";
		};
		frame = requestAnimationFrame(tick);

		// A hidden tab pauses play and silences the storm on every screen; it sounds again on return unless paused.
		const hidden = () => {
			if (document.hidden) {
				audio.current?.pause();
				if (screenRef.current === "playing") setScreen("paused");
			} else if (screenRef.current !== "paused") audio.current?.resume();
		};
		document.addEventListener("visibilitychange", hidden);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener("visibilitychange", hidden);
		};
	}, [handleEvent, setScreen]);

	useEffect(() => () => audio.current?.close(), []);

	const releaseAll = useCallback(() => {
		keys.current = { left: false, right: false, up: false, down: false };
		held.current = { ...IDLE_HELD };
		drag.current = { x: 0, y: 0, pointer: null, lastX: 0, lastY: 0 };
	}, []);

	const start = useCallback(() => {
		storm.current = newStorm(Math.floor(Math.random() * 2 ** 31));
		scene.current = { rescueAt: null, arriveAt: null, flash: 0, boltAt: 0.3, nextFlash: 4, calm: 1, swellsSeen: 0, lostAt: -10, hint: "" };
		releaseAll();
		queued.current = { brace: false, cry: false };
		setResult(null);
		setRescuing(false);
		resetSaving();
		if (!audio.current) audio.current = createStormSoundscape(muted);
		audio.current?.resume();
		setAnnouncement("You came down out of the ship. Keep your eyes on Jesus.");
		setScreen("playing");
		const stage = stageRef.current;
		stage?.focus({ preventScroll: true });
		// The stage and the controls under it, together on a phone.
		if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
		else if (stage && controlsRef.current && controlsRef.current.getBoundingClientRect().bottom > window.innerHeight) stage.scrollIntoView({ block: "start" });
	}, [muted, releaseAll, resetSaving, setScreen]);

	const pause = useCallback(() => {
		if (screenRef.current !== "playing") return;
		audio.current?.pause();
		releaseAll();
		setScreen("paused");
	}, [releaseAll, setScreen]);

	const resume = useCallback(() => {
		audio.current?.resume();
		setScreen("playing");
		stageRef.current?.focus({ preventScroll: true });
	}, [setScreen]);

	// Keyboard: arrows or WASD to look, Space or Enter to brace, P or Escape to pause.
	useEffect(() => {
		const direction = (key: string): Direction | null =>
			key === "arrowleft" || key === "a" ? "left" : key === "arrowright" || key === "d" ? "right" : key === "arrowup" || key === "w" ? "up" : key === "arrowdown" || key === "s" ? "down" : null;
		const down = (event: KeyboardEvent) => {
			const current = screenRef.current;
			if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
			const key = event.key.toLowerCase();
			// A focused button (Mute, Pause, Brace) answers its own Enter; Space always braces.
			if (key === "enter" && event.target instanceof HTMLElement && event.target.closest("button, a")) return;
			if (current === "playing") {
				const side = direction(key);
				if (side) keys.current[side] = true;
				else if (key === " " || key === "enter" || key === "b") {
					if (!event.repeat) queued.current.brace = true;
				} else if (key === "p" || key === "escape") pause();
				else return;
				event.preventDefault();
			} else if (current === "sinking" && scene.current.rescueAt === null && (key === " " || key === "enter")) {
				event.preventDefault();
				queued.current.cry = true;
			} else if (direction(key) && current === "sinking") {
				// A held look key's repeats must not scroll the stage away.
				event.preventDefault();
			} else if (current === "paused" && (key === "p" || key === "escape")) {
				event.preventDefault();
				resume();
			}
		};
		const up = (event: KeyboardEvent) => {
			const side = direction(event.key.toLowerCase());
			if (side) keys.current[side] = false;
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", releaseAll);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", releaseAll);
		};
	}, [pause, releaseAll, resume]);

	useEffect(() => {
		if (screen === "sinking") cryRef.current?.focus();
	}, [screen]);

	// A finger (or the mouse) on the stage drags the view: Jesus moves with it.
	const stageDrag = {
		onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
			if (screenRef.current !== "playing" || drag.current.pointer !== null) return;
			if (event.target instanceof HTMLElement && event.target.closest("button, a")) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			drag.current = { ...drag.current, pointer: event.pointerId, lastX: event.clientX, lastY: event.clientY };
		},
		onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
			const d = drag.current;
			if (d.pointer !== event.pointerId || screenRef.current !== "playing") return;
			d.x += event.clientX - d.lastX;
			d.y += event.clientY - d.lastY;
			d.lastX = event.clientX;
			d.lastY = event.clientY;
		},
		onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
			if (drag.current.pointer !== event.pointerId) return;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
			drag.current.pointer = null;
		},
		onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
			if (drag.current.pointer === event.pointerId) drag.current.pointer = null;
		},
	};

	// Look buttons: hold to turn; each pointer is counted so two thumbs never stick.
	const holdProps = (side: Direction) => ({
		onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			held.current[side] += 1;
		},
		onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
			if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
			held.current[side] = Math.max(0, held.current[side] - 1);
		},
		onPointerCancel: () => {
			held.current[side] = Math.max(0, held.current[side] - 1);
		},
		onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
	});

	const playing = screen === "playing";
	const grade = result ? gradeFor(result.faithKept) : null;
	const chapterHref = chapterHrefFor(game);
	const control =
		"flex min-h-14 select-none touch-none flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-bold transition-colors disabled:opacity-40 [-webkit-touch-callout:none] [-webkit-user-select:none]";
	const look = `${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`;

	return (
		<main
			data-game={game.slug}
			data-screen={screen}
			className="mx-auto w-full max-w-4xl px-3 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-3 sm:px-5 lg:px-8 lg:pb-16 lg:pt-8"
		>
			<GameHeader game={game} />

			<div
				ref={stageRef}
				tabIndex={-1}
				role="region"
				aria-label={`${game.title}, a game of ${game.reference}`}
				{...stageDrag}
				className={`relative mt-3 aspect-[4/5] w-full scroll-mt-3 select-none overflow-hidden rounded-[22px] border border-black/[.09] bg-[#05080d] outline-none sm:aspect-[16/10] dark:border-white/[.09] ${playing ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
			>
				<canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

				{/* HUD */}
				<div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-3 transition-opacity ${playing || screen === "paused" || screen === "sinking" ? "opacity-100" : "opacity-0"}`}>
					<div className="min-w-0 flex-1">
						<div className="flex items-center justify-between text-xs font-bold uppercase tracking-[.16em] text-[#f1eadc]">
							<span>Faith</span>
							<span ref={faithLabelRef}>80%</span>
						</div>
						<div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/15">
							<div ref={faithRef} className="h-full rounded-full bg-[#e5b664] data-[low=true]:bg-[#e2735a]" style={{ width: "80%" }} />
						</div>
						<div className="mt-2 text-xs font-bold text-[#d9d1c3]">
							<span ref={wayLabelRef}>0% of the way to Jesus</span>
						</div>
						<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
							<div ref={wayRef} className="h-full rounded-full bg-[#f1eadc]/80" style={{ width: "0%" }} />
						</div>
					</div>
					<div className="pointer-events-auto flex gap-1.5">
						<button type="button" onClick={toggleMute} aria-label={muted ? "Turn sound on" : "Turn sound off"} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-[#f1eadc] hover:bg-black/50">
							{muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
						</button>
						{playing && (
							<button type="button" onClick={pause} aria-label="Pause" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-[#f1eadc] hover:bg-black/50">
								<Pause size={20} aria-hidden />
							</button>
						)}
					</div>
				</div>

				<p
					ref={hintRef}
					aria-hidden
					className={`pointer-events-none absolute inset-x-0 bottom-4 mx-auto w-fit max-w-[90%] rounded-full bg-black/50 px-3 py-1 text-center text-sm font-bold text-[#f1eadc] opacity-0 transition-opacity ${playing ? "" : "hidden"}`}
				/>

				{screen === "intro" && (
					<StoryScreen
						className="bg-gradient-to-b from-[#05080d]/90 via-[#05080d]/60 to-[#05080d]/20 text-[#f1eadc]"
						actions={
							<>
								<button type="button" onClick={start} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1d1a12] hover:bg-[#edc47c]">
									<Play size={18} aria-hidden /> Come down out of the ship
								</button>
								{award && (
									<span className="inline-flex items-center gap-2 text-sm font-bold text-[#d9d1c3]">
										<AwardMedal grade={award.grade} emblem={game.emblem} size={36} /> Your award: {game.grades[award.grade]}
									</span>
								)}
							</>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Through Peter&rsquo;s eyes</p>
						<Passage verses={verseText(verses, 28, 29)} className="mt-2 max-w-2xl" />
						<ul className="mt-3 max-w-2xl space-y-1 text-sm leading-6 text-[#d9d1c3]">
							<li>
								<b className="text-[#f1eadc]">Keep your eyes on Jesus:</b> while he is inside the ring you walk toward him and your faith holds. Look away and you stop, and the sea climbs.
							</li>
							<li>
								<b className="text-[#f1eadc]">The wind drags your gaze aside:</b> steer it back with the arrow keys or WASD, by dragging the view, or with the look buttons.
							</li>
							<li>
								<b className="text-[#f1eadc]">Brace for each great swell</b> (Space or Brace) as its ring closes on yours.
							</li>
						</ul>
					</StoryScreen>
				)}

				{screen === "paused" && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#05080d]/75 p-6 text-center text-[#f1eadc]">
						<p className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold">Paused</p>
						<button type="button" onClick={resume} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 font-bold text-[#1d1a12]">
							<Play size={18} aria-hidden /> Keep walking
						</button>
					</div>
				)}

				{screen === "sinking" && !rescuing && (
					<div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-[#05080d]/95 to-transparent p-5 pt-12 text-center text-[#f1eadc]">
						<Passage verses={verseText(verses, 30)} className="max-w-xl" />
						<button
							ref={cryRef}
							type="button"
							onClick={() => {
								queued.current.cry = true;
							}}
							className="inline-flex min-h-14 items-center gap-2 rounded-full bg-[#e5b664] px-7 text-lg font-bold text-[#1d1a12] hover:bg-[#edc47c]"
						>
							Lord, save me
						</button>
					</div>
				)}

				{screen === "rescued" && (
					<StoryScreen
						centered
						className="bg-gradient-to-t from-[#05080d]/95 via-[#05080d]/80 to-[#05080d]/50 text-[#f1eadc]"
						actions={
							<>
								<button type="button" onClick={start} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 font-bold text-[#1d1a12]">
									<RotateCcw size={18} aria-hidden /> Try again
								</button>
								<Link href={chapterHref} className="inline-flex min-h-12 items-center rounded-full border border-white/25 px-5 font-bold">
									Read Matthew 14
								</Link>
							</>
						}
					>
						<div className="my-auto">
							<Passage verses={verseText(verses, 31)} className="max-w-xl" />
							<p className="mt-3 text-sm text-[#d9d1c3]">Keep your eyes on Jesus and walk it again.</p>
						</div>
					</StoryScreen>
				)}

				{screen === "won" && result && grade && (
					<StoryScreen
						centered
						className="bg-gradient-to-t from-[#05080d]/95 via-[#05080d]/80 to-[#05080d]/45 text-[#f1eadc]"
						actions={
							<>
								<button type="button" onClick={start} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 font-bold text-[#1d1a12]">
									<RotateCcw size={18} aria-hidden /> Walk it again
								</button>
								<Link href={chapterHref} className="inline-flex min-h-12 items-center rounded-full border border-white/25 px-5 font-bold">
									Back to Matthew 14
								</Link>
							</>
						}
					>
						<AwardMedal grade={grade} emblem={game.emblem} size={76} title={`${grade} medal`} />
						<p className="mt-2 text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Award · {game.award}</p>
						<h2 className="font-[family-name:var(--font-cormorant)] text-[2rem] font-semibold leading-tight">{game.grades[grade]}</h2>
						<p className="mt-1 text-sm text-[#d9d1c3]">
							Faith kept {result.faithKept}% · {result.seconds}s · {result.swellsCleared} {result.swellsCleared === 1 ? "swell" : "swells"} braced
						</p>
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => void saveRun(result)} />
						<Passage verses={verseText(verses, 32, 33)} className="mt-3 max-w-xl pb-2 text-left" />
					</StoryScreen>
				)}
			</div>

			{/* Controls: look buttons for either thumb, and Brace; drag the stage itself to look on a phone. */}
			<div ref={controlsRef} className="mt-3 grid grid-cols-6 gap-2" aria-label="Controls">
				<button type="button" disabled={!playing} aria-label="Look left" {...holdProps("left")} className={look}>
					<ArrowLeft size={20} aria-hidden />
					<span className="sr-only sm:not-sr-only">Left</span>
				</button>
				<button type="button" disabled={!playing} aria-label="Look up" {...holdProps("up")} className={look}>
					<ArrowUp size={20} aria-hidden />
					<span className="sr-only sm:not-sr-only">Up</span>
				</button>
				<button type="button" disabled={!playing} aria-label="Look down" {...holdProps("down")} className={look}>
					<ArrowDown size={20} aria-hidden />
					<span className="sr-only sm:not-sr-only">Down</span>
				</button>
				<button type="button" disabled={!playing} aria-label="Look right" {...holdProps("right")} className={look}>
					<ArrowRight size={20} aria-hidden />
					<span className="sr-only sm:not-sr-only">Right</span>
				</button>
				<button
					type="button"
					disabled={!playing}
					onPointerDown={(event) => {
						event.preventDefault();
						queued.current.brace = true;
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") queued.current.brace = true;
					}}
					onContextMenu={(event) => event.preventDefault()}
					className={`${control} col-span-2 border-amber-600/40 bg-amber-500/15 text-sm text-amber-900 active:bg-amber-500/30 dark:border-[#e5b664]/40 dark:text-[#e5b664]`}
				>
					<Waves size={22} aria-hidden />
					<span>Brace</span>
				</button>
			</div>
			<p className="mt-2 hidden px-1 text-sm text-neutral-600 sm:block dark:text-[#bbb3a7]">Keyboard: arrows or W A S D to look, Space to brace, P to pause. Or drag the view.</p>
			<p className="mt-2 px-1 text-sm text-neutral-600 sm:hidden dark:text-[#bbb3a7]">Drag the sea to bring Jesus into the ring.</p>
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<PassageSection game={game} verses={verses} />
		</main>
	);
}
