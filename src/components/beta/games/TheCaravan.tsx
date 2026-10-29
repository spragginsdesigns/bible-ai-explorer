"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ChevronsDown, ChevronsUp, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { createCaravanAudio, type CaravanAudio } from "./the-caravan-audio";
import { drawCaravanScene, type TrailPoint } from "./the-caravan-scene";
import { AwardSaveStatus, GameHeader, Passage, PassageSection, StoryScreen, chapterHref as chapterHrefFor, useGameAward, useMuted, verseText } from "./shared";
import type { ChapterGameProps } from "./types";
import { gradeFor } from "@/lib/beta/games/games-rules";
import {
	CARAVAN_FOOT,
	CARAVAN_JERUSALEM,
	CARAVAN_STEP,
	caravanResult,
	legProgress,
	newCaravan,
	nextHazard,
	stepCaravan,
	stride,
	type CaravanEvent,
	type CaravanHazard,
	type CaravanResult,
	type CaravanState,
} from "@/lib/beta/games/the-caravan-rules";

/**
 * The Caravan (LC-17851, docs/beta/games.md), Matthew 2's side-scroller. The
 * simulation lives in the-caravan-rules.ts; this component runs it on a fixed
 * step from requestAnimationFrame, draws it, plays its sound and tells the
 * story around it in the passage's own words (the bundled KJV): verses 1-2 to
 * set out, 3-8 at the halt in Jerusalem, 9 as the star goes before them again,
 * 10 when it stands over the house, and 11-12 with the award.
 */

type Screen = "intro" | "playing" | "paused" | "jerusalem" | "lost" | "won";
type Ending = "fell" | "lost";

/** How long the halt, the arrival and an ending play before their words come up. */
const HALT_SCENE = 1.8;
const ARRIVAL_SCENE = 4.6;
const ENDING_SCENE = 1.4;
/** Paces between footfalls on the sand. */
const STRIDE_LENGTH = 1.35;

/** The first time each kind of hazard comes up, what to do about it. */
const HINTS: Record<string, string> = {
	rock: "A rock ahead: jump it",
	tall: "A tall rock: hold jump to go higher",
	ravine: "A ravine: jump across",
	wide: "A wide ravine: hold jump for a long leap",
	ledge: "A low ledge: duck under it",
	gust: "A gust of sand: duck until it passes",
};

function hazardKey(hazard: CaravanHazard): string {
	if (hazard.kind === "rock") return hazard.h > 0.8 ? "tall" : "rock";
	if (hazard.kind === "ravine") return hazard.w > 3.5 ? "wide" : "ravine";
	return hazard.kind;
}

function freshScene() {
	return {
		haltAt: null as number | null,
		arriveAt: null as number | null,
		endAt: null as number | null,
		starGlow: 0,
		shake: 0,
		trail: [] as TrailPoint[],
		foot: 0,
		seen: new Set<string>(),
	};
}

export default function TheCaravan({ game, verses, initialAward }: ChapterGameProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const keepRef = useRef<HTMLDivElement>(null);
	const keepLabelRef = useRef<HTMLSpanElement>(null);
	const legRef = useRef<HTMLDivElement>(null);
	const legLabelRef = useRef<HTMLSpanElement>(null);
	const strideRef = useRef<HTMLSpanElement>(null);
	const hintRef = useRef<HTMLParagraphElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const primaryRef = useRef<HTMLButtonElement>(null);

	const caravan = useRef<CaravanState>(newCaravan(1));
	const checkpoint = useRef<CaravanState | null>(null);
	const screenRef = useRef<Screen>("intro");
	const keys = useRef({ jump: false, duck: false });
	const held = useRef({ jump: 0, duck: 0 });
	const queued = useRef({ jump: false, go: false });
	const audio = useRef<CaravanAudio | null>(null);
	const scene = useRef(freshScene());
	const captionTimer = useRef<number | null>(null);

	const [screen, setScreenState] = useState<Screen>("intro");
	const { muted, toggleMute } = useMuted(useCallback((next: boolean) => audio.current?.setMuted(next), []));
	const [result, setResult] = useState<CaravanResult | null>(null);
	const [ending, setEnding] = useState<Ending | null>(null);
	const [secondLeg, setSecondLeg] = useState(false);
	const [caption, setCaption] = useState<[number, number] | null>(null);
	const { award, saving, save: saveRun, resetSaving } = useGameAward(game.slug, initialAward);
	const [announcement, setAnnouncement] = useState("");

	const setScreen = useCallback((next: Screen) => {
		screenRef.current = next;
		setScreenState(next);
	}, []);

	const showCaption = useCallback((from: number, to: number, seconds: number) => {
		if (captionTimer.current !== null) window.clearTimeout(captionTimer.current);
		setCaption([from, to]);
		captionTimer.current = window.setTimeout(() => {
			captionTimer.current = null;
			setCaption(null);
		}, seconds * 1000);
	}, []);

	const handleEvent = useCallback(
		(event: CaravanEvent, now: number, reduceMotion: boolean) => {
			const sound = audio.current;
			const look = scene.current;
			const buzz = (pattern: number | number[]) => navigator.vibrate?.(pattern);
			switch (event.type) {
				case "jump":
					sound?.jump();
					break;
				case "land":
					sound?.land();
					break;
				case "stumble":
					sound?.stumble();
					buzz(40);
					look.shake = reduceMotion ? 0 : 1;
					break;
				case "star":
					sound?.chime();
					look.starGlow = 1;
					break;
				case "slipping":
					setAnnouncement("The star is drawing ahead. Keep up with it.");
					break;
				case "jerusalem":
					look.haltAt = now;
					sound?.city();
					checkpoint.current = structuredClone(caravan.current);
					setAnnouncement("The caravan has come to Jerusalem.");
					break;
				case "depart":
					look.haltAt = null;
					look.starGlow = 1;
					sound?.chime();
					showCaption(9, 9, 6);
					setAnnouncement("They departed, and the star went before them.");
					break;
				case "arrived": {
					look.arriveAt = now;
					sound?.joy();
					buzz([30, 40, 30]);
					const run = caravanResult(caravan.current);
					if (run) {
						setResult(run);
						void saveRun(run);
					}
					showCaption(10, 10, ARRIVAL_SCENE);
					setAnnouncement("The star came and stood over where the young child was.");
					break;
				}
				case "fell":
				case "lost":
					look.endAt = now;
					if (event.type === "fell") {
						sound?.fall();
						buzz([70, 50, 70]);
					} else sound?.lost();
					setEnding(event.type);
					setSecondLeg(caravan.current.x > CARAVAN_JERUSALEM);
					setAnnouncement(event.type === "fell" ? "A misstep at the ravine. The journey stops here." : "The star went out of sight. The journey stops here.");
					break;
			}
		},
		[saveRun, showCaption],
	);

	// The loop: fixed simulation steps, one draw per frame.
	useEffect(() => {
		const canvas = canvasRef.current;
		const stage = stageRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !stage || !context) return;
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let size = { width: 0, height: 0 };
		const resize = () => {
			const rect = stage.getBoundingClientRect();
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			size = { width: rect.width, height: rect.height };
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
		const events: CaravanEvent[] = [];
		const tick = (time: number) => {
			frame = requestAnimationFrame(tick);
			const now = time / 1000;
			const elapsed = Math.min(0.1, (time - last) / 1000);
			last = time;
			const state = caravan.current;
			const current = screenRef.current;
			const look = scene.current;
			const running = current === "playing";
			if (running) {
				carry += elapsed;
				while (carry >= CARAVAN_STEP) {
					stepCaravan(
						state,
						{
							jump: keys.current.jump || held.current.jump > 0 || queued.current.jump,
							duck: keys.current.duck || held.current.duck > 0,
							go: queued.current.go,
						},
						events,
					);
					queued.current.jump = false;
					queued.current.go = false;
					carry -= CARAVAN_STEP;
				}
				for (const event of events.splice(0)) handleEvent(event, now, reduceMotion);

				// Where his feet have been, for those walking behind him.
				const trail = look.trail;
				const tail = trail[trail.length - 1];
				if (!tail || state.x - tail.x > 0.04) trail.push({ x: state.x, y: state.y });
				while (trail.length > 2 && trail[0].x < state.x - 16) trail.shift();
				const foot = Math.floor(state.x / STRIDE_LENGTH);
				if (foot !== look.foot && state.grounded && state.speed > 1) audio.current?.footfall();
				look.foot = foot;
			}
			look.starGlow = Math.max(0, look.starGlow - elapsed * (reduceMotion ? 0.5 : 1.1));
			look.shake = Math.max(0, look.shake - elapsed * 4);

			const onRoad = running && (state.phase === "east" || state.phase === "bethlehem");
			const ahead = nextHazard(state);
			let gust = 0;
			for (const hazard of state.hazards) if (hazard.kind === "gust") gust = Math.max(gust, 1 - Math.abs(hazard.x + hazard.w / 2 - state.x) / 9);
			const kept = state.keep;
			const strideLevel = stride(state);
			audio.current?.set({ running: onRoad, level: kept < 55 ? 0 : strideLevel >= 1 ? 3 : strideLevel >= 0.5 ? 2 : 1, gust: Math.max(0, gust) });

			if (look.haltAt !== null && current === "playing" && state.phase === "jerusalem" && now - look.haltAt > HALT_SCENE) setScreen("jerusalem");
			if (look.arriveAt !== null && current === "playing" && now - look.arriveAt > ARRIVAL_SCENE) setScreen("won");
			if (look.endAt !== null && current === "playing" && now - look.endAt > ENDING_SCENE) setScreen("lost");

			drawCaravanScene(context, {
				width: size.width,
				height: size.height,
				state,
				now,
				trail: look.trail,
				starGlow: look.starGlow,
				shake: reduceMotion ? 0 : look.shake,
				halt: look.haltAt === null ? null : now - look.haltAt,
				arrival: look.arriveAt === null ? null : now - look.arriveAt,
			});

			// The HUD is written straight to the DOM: no React render per frame.
			const keep = Math.round(kept);
			if (keepRef.current) {
				keepRef.current.style.width = `${keep}%`;
				keepRef.current.dataset.low = keep < 40 ? "true" : "false";
			}
			if (keepLabelRef.current) keepLabelRef.current.textContent = `${keep}%`;
			const toBethlehem = state.x > CARAVAN_JERUSALEM || state.phase === "bethlehem" || state.phase === "arrived";
			const leg = legProgress(state);
			if (legRef.current) legRef.current.style.width = `${leg * 100}%`;
			if (legLabelRef.current) legLabelRef.current.textContent = `To ${toBethlehem ? "Bethlehem" : "Jerusalem"} · ${Math.floor(leg * 100)}%`;
			if (strideRef.current) strideRef.current.dataset.stride = String(Math.round(strideLevel * 3));
			if (hintRef.current) {
				const key = ahead ? hazardKey(ahead) : "";
				const near = ahead && ahead.x - CARAVAN_FOOT - state.x < 10;
				const show = onRoad && !!ahead && !!near && !look.seen.has(key);
				if (show && hintRef.current.textContent !== HINTS[key]) hintRef.current.textContent = HINTS[key];
				hintRef.current.style.opacity = show ? "1" : "0";
				for (const hazard of state.hazards) if (hazard.outcome !== null) look.seen.add(hazardKey(hazard));
			}
			// What the road holds next, for anyone (or any test) reading the stage.
			const data = stage.dataset;
			data.phase = state.phase;
			data.x = state.x.toFixed(2);
			data.speed = state.speed.toFixed(2);
			data.grounded = state.grounded ? "1" : "0";
			data.keep = String(keep);
			data.hazard = ahead ? ahead.kind : "none";
			data.hid = ahead ? String(ahead.id) : "";
			data.hx = ahead ? ahead.x.toFixed(2) : "";
			data.hw = ahead ? ahead.w.toFixed(2) : "";
			data.hh = ahead ? ahead.h.toFixed(2) : "";
		};
		frame = requestAnimationFrame(tick);

		const hidden = () => {
			if (document.hidden && screenRef.current === "playing") {
				const phase = caravan.current.phase;
				if (phase !== "east" && phase !== "bethlehem") return;
				audio.current?.pause();
				setScreen("paused");
			}
		};
		document.addEventListener("visibilitychange", hidden);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener("visibilitychange", hidden);
		};
	}, [handleEvent, setScreen]);

	useEffect(
		() => () => {
			audio.current?.close();
			if (captionTimer.current !== null) window.clearTimeout(captionTimer.current);
		},
		[],
	);

	const begin = useCallback(
		(state: CaravanState, go: boolean) => {
			caravan.current = state;
			scene.current = freshScene();
			keys.current = { jump: false, duck: false };
			held.current = { jump: 0, duck: 0 };
			queued.current = { jump: false, go };
			if (captionTimer.current !== null) window.clearTimeout(captionTimer.current);
			setCaption(null);
			setResult(null);
			setEnding(null);
			resetSaving();
			if (!audio.current) audio.current = createCaravanAudio(muted);
			audio.current?.resume();
			setScreen("playing");
			const stage = stageRef.current;
			stage?.focus({ preventScroll: true });
			// The stage and the controls under it, together on a phone.
			if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
			else if (stage && controlsRef.current && controlsRef.current.getBoundingClientRect().bottom > window.innerHeight) stage.scrollIntoView({ block: "start" });
		},
		[muted, resetSaving, setScreen],
	);

	const start = useCallback(() => {
		checkpoint.current = null;
		begin(newCaravan(Math.floor(Math.random() * 2 ** 31)), false);
		setAnnouncement("The caravan sets out from the east. Keep to the star.");
	}, [begin]);

	const fromJerusalem = useCallback(() => {
		if (!checkpoint.current) return start();
		begin(structuredClone(checkpoint.current), true);
	}, [begin, start]);

	const depart = useCallback(() => {
		queued.current.go = true;
		// Cleared here, not by the depart step: a frame too short for a step must not show the halt again.
		scene.current.haltAt = null;
		keys.current = { jump: false, duck: false };
		held.current = { jump: 0, duck: 0 };
		setScreen("playing");
		stageRef.current?.focus({ preventScroll: true });
	}, [setScreen]);

	const pause = useCallback(() => {
		if (screenRef.current !== "playing") return;
		const phase = caravan.current.phase;
		if (phase !== "east" && phase !== "bethlehem") return;
		audio.current?.pause();
		setScreen("paused");
	}, [setScreen]);

	const resume = useCallback(() => {
		audio.current?.resume();
		keys.current = { jump: false, duck: false };
		held.current = { jump: 0, duck: 0 };
		setScreen("playing");
		stageRef.current?.focus({ preventScroll: true });
	}, [setScreen]);

	// Keyboard: Space, Up or W to jump (hold for a longer leap), Down or S to duck, P or Escape to pause.
	useEffect(() => {
		const isJump = (key: string) => key === " " || key === "arrowup" || key === "w";
		const isDuck = (key: string) => key === "arrowdown" || key === "s";
		const down = (event: KeyboardEvent) => {
			if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
			const key = event.key.toLowerCase();
			const current = screenRef.current;
			if (current === "playing") {
				if (isJump(key)) {
					if (!event.repeat) queued.current.jump = true;
					keys.current.jump = true;
				} else if (isDuck(key)) keys.current.duck = true;
				else if (key === "p" || key === "escape") pause();
				else return;
				event.preventDefault();
			} else if (current === "paused" && (key === "p" || key === "escape")) {
				event.preventDefault();
				resume();
			}
		};
		const up = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			if (isJump(key)) keys.current.jump = false;
			if (isDuck(key)) keys.current.duck = false;
		};
		const blur = () => {
			keys.current = { jump: false, duck: false };
			held.current = { jump: 0, duck: 0 };
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", blur);
		};
	}, [pause, resume]);

	useEffect(() => {
		if (screen === "jerusalem" || screen === "lost") primaryRef.current?.focus({ preventScroll: true });
	}, [screen]);

	// Touch and mouse: hold Jump or Duck (or a finger on the stage to jump); each pointer is counted so two thumbs never stick.
	const holdProps = (action: "jump" | "duck") => ({
		onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
			if (screenRef.current !== "playing") return;
			if (event.currentTarget === stageRef.current && event.target instanceof HTMLElement && event.target.closest("button, a")) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			held.current[action] += 1;
			if (action === "jump") queued.current.jump = true;
		},
		onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
			if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
			event.currentTarget.releasePointerCapture(event.pointerId);
			held.current[action] = Math.max(0, held.current[action] - 1);
		},
		onPointerCancel: () => {
			held.current[action] = Math.max(0, held.current[action] - 1);
		},
		onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
	});

	const playing = screen === "playing";
	const grade = result ? gradeFor(result.faithKept) : null;
	const chapterHref = chapterHrefFor(game);
	const primary = "inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1d1a12] hover:bg-[#edc47c]";
	const secondary = "inline-flex min-h-12 items-center rounded-full border border-white/25 px-5 font-bold hover:bg-white/5";
	const control =
		"flex min-h-16 select-none touch-none flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm font-bold transition-colors disabled:opacity-40 [-webkit-touch-callout:none] [-webkit-user-select:none]";
	const veil = "bg-gradient-to-b from-[#0b0814]/85 via-[#0b0814]/80 to-[#0b0814]/92 text-[#f1eadc]";

	return (
		<main data-game={game.slug} data-screen={screen} className="mx-auto w-full max-w-4xl px-3 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-3 sm:px-5 lg:px-8 lg:pb-16 lg:pt-8">
			<GameHeader game={game} />

			<div
				ref={stageRef}
				tabIndex={-1}
				role="region"
				aria-label={`${game.title}, a game of ${game.reference}`}
				{...holdProps("jump")}
				className="relative mt-3 aspect-[4/5] w-full touch-none scroll-mt-3 select-none overflow-hidden rounded-[22px] border border-black/[.09] bg-[#0b0814] outline-none sm:aspect-[16/9] dark:border-white/[.09]"
			>
				<canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

				{/* HUD */}
				<div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-3 transition-opacity ${playing || screen === "paused" ? "opacity-100" : "opacity-0"}`}>
					<div className="min-w-0 max-w-[340px] flex-1">
						<div className="flex items-center justify-between text-xs font-bold uppercase tracking-[.16em] text-[#f1eadc]">
							<span>Kept to the star</span>
							<span ref={keepLabelRef}>100%</span>
						</div>
						<div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/15">
							<div ref={keepRef} className="h-full rounded-full bg-[#e5b664] data-[low=true]:bg-[#e2735a]" style={{ width: "100%" }} />
						</div>
						<div className="mt-2 flex items-center justify-between gap-2 text-xs font-bold text-[#d9d1c3]">
							<span ref={legLabelRef} className="truncate">
								To Jerusalem · 0%
							</span>
							<span ref={strideRef} data-stride="0" className="group flex shrink-0 items-center gap-1" aria-hidden>
								<span className="sr-only">Stride</span>
								<i className="h-1.5 w-1.5 rounded-full bg-white/20 group-data-[stride='1']:bg-[#e5b664] group-data-[stride='2']:bg-[#e5b664] group-data-[stride='3']:bg-[#e5b664]" />
								<i className="h-1.5 w-1.5 rounded-full bg-white/20 group-data-[stride='2']:bg-[#e5b664] group-data-[stride='3']:bg-[#e5b664]" />
								<i className="h-1.5 w-1.5 rounded-full bg-white/20 group-data-[stride='3']:bg-[#e5b664]" />
							</span>
						</div>
						<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
							<div ref={legRef} className="h-full rounded-full bg-[#f1eadc]/80" style={{ width: "0%" }} />
						</div>
					</div>
					<div className="pointer-events-auto ml-auto flex gap-1.5">
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

				<p ref={hintRef} className={`pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] rounded-full bg-black/55 px-3 py-1 text-center text-sm font-bold text-[#f1eadc] opacity-0 transition-opacity ${playing ? "" : "hidden"}`} />

				{caption && (playing || screen === "paused") && (
					<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-3 pt-10 text-[#f1eadc] sm:px-8 sm:pb-5">
						<Passage verses={verseText(verses, caption[0], caption[1])} className="mx-auto max-w-2xl text-[16px] leading-6 sm:text-[19px] sm:leading-7" />
					</div>
				)}

				{screen === "intro" && (
					<StoryScreen
						className={veil}
						actions={
							<>
								<button type="button" onClick={start} className={primary}>
									<Play size={18} aria-hidden /> Set out from the east
								</button>
								{award && (
									<span className="inline-flex items-center gap-2 text-sm font-bold text-[#d9d1c3]">
										<AwardMedal grade={award.grade} emblem={game.emblem} size={36} /> Your award: {game.grades[award.grade]}
									</span>
								)}
							</>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">From the east</p>
						<Passage verses={verseText(verses, 1, 2)} className="mt-2 max-w-2xl" />
						<ul className="mt-3 max-w-2xl space-y-1 text-sm leading-6 text-[#d9d1c3]">
							<li>
								<b className="text-[#f1eadc]">Jump rocks and ravines:</b> Space, Up or W, or tap the stage. Hold it for a longer, higher leap.
							</li>
							<li>
								<b className="text-[#f1eadc]">Duck under low ledges and gusts of sand:</b> hold Down or S, or hold Duck.
							</li>
							<li>
								<b className="text-[#f1eadc]">Keep to the star:</b> every stumble lets it draw ahead. Lose sight of it, or fall into a ravine, and the journey stops.
							</li>
						</ul>
					</StoryScreen>
				)}

				{screen === "paused" && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0b0814]/75 p-6 text-center text-[#f1eadc]">
						<p className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold">Paused</p>
						<button type="button" onClick={resume} className={primary}>
							<Play size={18} aria-hidden /> Go on
						</button>
					</div>
				)}

				{screen === "jerusalem" && (
					<StoryScreen
						className={veil}
						actions={
							<button ref={primaryRef} type="button" onClick={depart} className={primary}>
								<Play size={18} aria-hidden /> Depart for Bethlehem
							</button>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Jerusalem</p>
						<Passage verses={verseText(verses, 3, 8)} className="mt-2 max-w-2xl" />
					</StoryScreen>
				)}

				{screen === "lost" && ending && (
					<StoryScreen
						centered
						className={veil}
						actions={
							<>
								{secondLeg && checkpoint.current ? (
									<>
										<button ref={primaryRef} type="button" onClick={fromJerusalem} className={primary}>
											<RotateCcw size={18} aria-hidden /> Try again from Jerusalem
										</button>
										<button type="button" onClick={start} className={secondary}>
											Start over
										</button>
									</>
								) : (
									<button ref={primaryRef} type="button" onClick={start} className={primary}>
										<RotateCcw size={18} aria-hidden /> Try again
									</button>
								)}
								<Link href={chapterHref} className={secondary}>
									Read Matthew 2
								</Link>
							</>
						}
					>
						<div className="my-auto">
							<h2 className="font-[family-name:var(--font-cormorant)] text-[2rem] font-semibold leading-tight">{ending === "fell" ? "A misstep at the ravine" : "The star went out of sight"}</h2>
							<p className="mt-1 text-sm text-[#d9d1c3]">{ending === "fell" ? "Take heart and set out again: jump a little sooner, and hold for the wide ones." : "Keep close behind it and set out again: every stumble lets it draw ahead."}</p>
							<Passage verses={verseText(verses, 2)} className="mx-auto mt-4 max-w-xl" />
						</div>
					</StoryScreen>
				)}

				{screen === "won" && result && grade && (
					<StoryScreen
						centered
						className="bg-gradient-to-b from-[#0b0814]/40 via-[#0b0814]/80 to-[#0b0814]/95 text-[#f1eadc]"
						actions={
							<>
								<button type="button" onClick={start} className={primary}>
									<RotateCcw size={18} aria-hidden /> Play again
								</button>
								<Link href={chapterHref} className={secondary}>
									Back to Matthew 2
								</Link>
							</>
						}
					>
						<AwardMedal grade={grade} emblem={game.emblem} size={64} title={`${grade} medal`} />
						<p className="mt-2 text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Award · {game.award}</p>
						<h2 className="font-[family-name:var(--font-cormorant)] text-[1.75rem] font-semibold leading-tight sm:text-[2rem]">{game.grades[grade]}</h2>
						<p className="mt-1 text-sm text-[#d9d1c3]">
							Kept to the star {result.faithKept}% · {result.seconds}s · {result.swellsCleared} {result.swellsCleared === 1 ? "hazard" : "hazards"} of the road passed
						</p>
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => void saveRun(result)} />
						<Passage verses={verseText(verses, 11, 12)} className="mt-3 max-w-xl pb-2 text-left" />
					</StoryScreen>
				)}
			</div>

			{/* Controls: one per thumb on a phone, and clickable on a desktop. */}
			<div ref={controlsRef} className="mt-3 grid grid-cols-2 gap-2.5" aria-label="Controls">
				<button type="button" disabled={!playing} {...holdProps("duck")} className={`${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`}>
					<ChevronsDown size={22} aria-hidden />
					<span>Duck</span>
				</button>
				<button
					type="button"
					disabled={!playing}
					{...holdProps("jump")}
					onKeyDown={(event) => {
						if (event.key === "Enter") queued.current.jump = true;
					}}
					className={`${control} border-amber-600/40 bg-amber-500/15 text-amber-900 active:bg-amber-500/30 dark:border-[#e5b664]/40 dark:text-[#e5b664]`}
				>
					<ChevronsUp size={22} aria-hidden />
					<span>Jump</span>
				</button>
			</div>
			<p className="mt-2 hidden px-1 text-sm text-neutral-600 sm:block dark:text-[#bbb3a7]">Keyboard: Space, ↑ or W to jump (hold for a longer leap), ↓ or S to duck, P to pause.</p>
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<PassageSection game={game} verses={verses} />
		</main>
	);
}
