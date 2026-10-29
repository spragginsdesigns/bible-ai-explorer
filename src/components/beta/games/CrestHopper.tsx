"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { createHopperAudio, type HopperAudio } from "./crest-hopper-audio";
import { createLook, drawHopper, hopperLayout, lookEvents, stepLook, type HopperLook } from "./crest-hopper-scene";
import { AwardSaveStatus, GameHeader, Passage, PassageSection, StoryScreen, chapterHref as chapterHrefFor, useGameAward, useMuted, verseText } from "./shared";
import type { ChapterGameProps } from "./types";
import { gradeFor } from "@/lib/beta/games/games-rules";
import {
	HOPPER_STEP,
	hopLanding,
	hopperReady,
	hopperResult,
	newHopper,
	shoveLands,
	stepHopper,
	type HopDir,
	type HopperEvent,
	type HopperResult,
	type HopperState,
} from "@/lib/beta/games/crest-hopper-rules";

/**
 * Crest Hopper (LC-17851, docs/beta/games.md), the arcade way to play
 * Matthew 14:22-33. The simulation lives in crest-hopper-rules.ts; this
 * component runs it on a fixed step from requestAnimationFrame, draws it as
 * pixel art, plays its chiptune and tells the story around it in the
 * passage's own words (the bundled KJV).
 */

type Screen = "intro" | "playing" | "paused" | "sinking" | "rescued" | "arriving" | "won";

/** How long the rescue and the arrival play before their words come up. */
const RESCUE_SCENE = 1.8;
const ARRIVAL_SCENE = 2.4;
/** A swipe shorter than this (CSS pixels) is a tap, and a tap hops toward Jesus. */
const SWIPE = 18;

const KEYS: Record<string, HopDir> = {
	arrowup: "up",
	w: "up",
	" ": "up",
	arrowdown: "down",
	s: "down",
	arrowleft: "left",
	a: "left",
	arrowright: "right",
	d: "right",
};

export default function CrestHopper({ game, verses, initialAward }: ChapterGameProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const hintRef = useRef<HTMLParagraphElement>(null);
	const cryRef = useRef<HTMLButtonElement>(null);

	const run = useRef<HopperState>(newHopper(1));
	const look = useRef<HopperLook>(createLook());
	const screenRef = useRef<Screen>("intro");
	const queued = useRef<{ hop: HopDir | null; cry: boolean }>({ hop: null, cry: false });
	const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
	const audio = useRef<HopperAudio | null>(null);
	const scene = useRef({ rescueAt: null as number | null, arriveAt: null as number | null, gustsSeen: 0 });

	const [screen, setScreenState] = useState<Screen>("intro");
	const { muted, toggleMute } = useMuted(useCallback((next: boolean) => audio.current?.setMuted(next), []));
	const [result, setResult] = useState<HopperResult | null>(null);
	const { award, saving, save: saveRun, resetSaving } = useGameAward(game.slug, initialAward);
	const [announcement, setAnnouncement] = useState("");
	const [rescuing, setRescuing] = useState(false);

	const setScreen = useCallback((next: Screen) => {
		screenRef.current = next;
		setScreenState(next);
	}, []);

	const handleEvent = useCallback(
		(event: HopperEvent, now: number) => {
			const sound = audio.current;
			const buzz = (pattern: number | number[]) => navigator.vibrate?.(pattern);
			switch (event.type) {
				case "hop":
					if (event.dir === "up") sound?.hop(event.combo);
					else sound?.side();
					break;
				case "rest":
					sound?.rest();
					setAnnouncement("A calm swell. Catch your breath.");
					break;
				case "slip":
					sound?.slip();
					buzz(45);
					if (event.faith > 0) setAnnouncement(`Slipped into a trough. Faith ${Math.round(event.faith)} percent.`);
					break;
				case "gustWarn":
					scene.current.gustsSeen += 1;
					sound?.gustWarn();
					setAnnouncement(`A gust is coming from the ${event.dir > 0 ? "left" : "right"}.`);
					break;
				case "gust":
					sound?.gust();
					break;
				case "shoved":
					buzz(20);
					break;
				case "sinking":
					sound?.sinking();
					buzz([70, 50, 70]);
					setAnnouncement("He is sinking. Cry out: Lord, save me.");
					setScreen("sinking");
					break;
				case "rescued":
					scene.current.rescueAt = now;
					sound?.rescued();
					setRescuing(true);
					setAnnouncement(verseText(verses, 31)[0]?.text ?? "Jesus caught him.");
					break;
				case "arrived": {
					scene.current.arriveAt = now;
					sound?.victory();
					buzz([30, 40, 30]);
					const finished = hopperResult(run.current);
					if (finished) {
						setResult(finished);
						void saveRun({ faithKept: finished.faithKept, seconds: finished.seconds, swellsCleared: finished.swellsCleared });
					}
					setAnnouncement("You reached Jesus. The wind ceased.");
					setScreen("arriving");
					break;
				}
				default:
					break;
			}
		},
		[saveRun, setScreen, verses],
	);

	// The loop: fixed simulation steps, one draw per frame, the picture painted small and scaled up crisp.
	useEffect(() => {
		const canvas = canvasRef.current;
		const stage = stageRef.current;
		const context = canvas?.getContext("2d");
		const buffer = document.createElement("canvas");
		const paint = buffer.getContext("2d");
		if (!canvas || !stage || !context || !paint) return;
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let size = { w: 0, h: 0, k: 1 };
		const resize = () => {
			const rect = stage.getBoundingClientRect();
			const { scale, w, h } = hopperLayout(rect.width, rect.height);
			const k = Math.max(1, Math.round(scale * Math.min(window.devicePixelRatio || 1, 2)));
			size = { w, h, k };
			buffer.width = w;
			buffer.height = h;
			canvas.width = w * k;
			canvas.height = h * k;
			canvas.style.width = `${w * scale}px`;
			canvas.style.height = `${h * scale}px`;
			canvas.style.left = `${Math.round((rect.width - w * scale) / 2)}px`;
			canvas.style.top = `${Math.round((rect.height - h * scale) / 2)}px`;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(stage);

		let frame = 0;
		let last = performance.now();
		let carry = 0;
		const events: HopperEvent[] = [];
		const marks: Record<string, string> = {};
		const mark = (name: string, value: string) => {
			if (marks[name] === value) return;
			marks[name] = value;
			stage.dataset[name] = value;
		};
		const tick = (time: number) => {
			frame = requestAnimationFrame(tick);
			const now = time / 1000;
			const elapsed = Math.min(0.1, (time - last) / 1000);
			last = time;
			const state = run.current;
			const current = screenRef.current;
			const running = current === "playing" || current === "sinking" || current === "arriving";
			if (running) {
				carry += elapsed;
				while (carry >= HOPPER_STEP) {
					stepHopper(state, { hop: queued.current.hop, cry: queued.current.cry }, events);
					queued.current.hop = null;
					queued.current.cry = false;
					carry -= HOPPER_STEP;
				}
				lookEvents(look.current, state, events, now, reduceMotion);
				for (const event of events.splice(0)) handleEvent(event, now);
			}
			if (current !== "paused") stepLook(look.current, state, elapsed, size.w, size.h, reduceMotion);

			const view = scene.current;
			if (view.rescueAt !== null && screenRef.current === "sinking" && now - view.rescueAt > RESCUE_SCENE) setScreen("rescued");
			if (view.arriveAt !== null && screenRef.current === "arriving" && now - view.arriveAt > ARRIVAL_SCENE) setScreen("won");

			drawHopper(paint, look.current, { state, now, reduceMotion });
			context.imageSmoothingEnabled = false;
			context.drawImage(buffer, 0, 0, size.w * size.k, size.h * size.k);

			if (hintRef.current) {
				const playing = screenRef.current === "playing" && state.phase === "playing";
				const hint = !playing ? "" : state.maxRow < 2 && state.t > 1.5 ? "Hop when a light crest is in front of you" : state.gust && view.gustsSeen <= 2 ? "A gust will shove you a lane: stand where the crest goes on" : "";
				if (hintRef.current.textContent !== hint && hint) hintRef.current.textContent = hint;
				hintRef.current.style.opacity = hint ? "1" : "0";
			}
			// What the stage is doing, for anyone reading it (the proof scripts play from these).
			mark("phase", state.phase);
			mark("row", String(state.row));
			mark("faith", String(Math.round(state.faith)));
			mark("ready", hopperReady(state) ? "1" : "0");
			mark("x", state.x.toFixed(2));
			for (const dir of ["up", "down", "left", "right"] as const) mark(dir, hopLanding(state, dir, 0.25) ? "1" : "0");
			const wind = state.shove?.dir ?? state.gust?.dir ?? 0;
			mark("gust", wind ? String(wind) : "");
			mark("braced", wind ? (shoveLands(state, wind) ? "1" : "0") : "");
		};
		frame = requestAnimationFrame(tick);

		const hidden = () => {
			if (document.hidden && screenRef.current === "playing") {
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

	useEffect(() => () => audio.current?.close(), []);

	const start = useCallback(() => {
		run.current = newHopper(Math.floor(Math.random() * 2 ** 31));
		look.current = createLook();
		scene.current = { rescueAt: null, arriveAt: null, gustsSeen: 0 };
		queued.current = { hop: null, cry: false };
		setResult(null);
		setRescuing(false);
		resetSaving();
		if (!audio.current) audio.current = createHopperAudio(muted);
		audio.current?.resume();
		setAnnouncement("You are in the ship. Hop crest to crest toward Jesus.");
		setScreen("playing");
		const stage = stageRef.current;
		stage?.focus({ preventScroll: true });
		// The stage and the pad under it, together on a phone (clear of the tab bar).
		if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
		else if (stage && controlsRef.current && controlsRef.current.getBoundingClientRect().bottom > window.innerHeight - 96) stage.scrollIntoView({ block: "start" });
	}, [muted, resetSaving, setScreen]);

	const pause = useCallback(() => {
		if (screenRef.current !== "playing") return;
		audio.current?.pause();
		setScreen("paused");
	}, [setScreen]);

	const resume = useCallback(() => {
		audio.current?.resume();
		setScreen("playing");
		stageRef.current?.focus({ preventScroll: true });
	}, [setScreen]);

	const press = useCallback((dir: HopDir) => {
		if (screenRef.current === "playing") queued.current.hop = dir;
	}, []);

	const cry = useCallback(() => {
		if (screenRef.current === "sinking" && scene.current.rescueAt === null) queued.current.cry = true;
	}, []);

	// Keyboard: arrows or WASD (Space hops forward), P or Escape to pause.
	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			const current = screenRef.current;
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (target?.closest("input, textarea, select")) return;
			const key = event.key.toLowerCase();
			// A focused button answers its own Enter, and its own Space outside play (Space always hops).
			if ((key === "enter" || (key === " " && current !== "playing")) && target?.closest("button, a")) return;
			if (current === "playing") {
				const dir = KEYS[key];
				if (dir) {
					if (!event.repeat) press(dir);
				} else if (key === "p" || key === "escape") pause();
				else return;
				event.preventDefault();
			} else if (current === "sinking" && (key === "arrowup" || key === "w" || key === " " || key === "enter")) {
				event.preventDefault();
				cry();
			} else if (KEYS[key] && (current === "sinking" || current === "arriving")) {
				// A held key's repeats must not scroll the stage away.
				event.preventDefault();
			} else if (current === "paused" && (key === "p" || key === "escape")) {
				event.preventDefault();
				resume();
			}
		};
		window.addEventListener("keydown", down);
		return () => window.removeEventListener("keydown", down);
	}, [cry, pause, press, resume]);

	useEffect(() => {
		if (screen === "sinking") cryRef.current?.focus();
	}, [screen]);

	// Swipe on the stage to hop that way; a tap hops toward Jesus.
	const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (screenRef.current !== "playing" || (event.target instanceof HTMLElement && event.target.closest("button"))) return;
		swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
	};
	const onStageUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const begun = swipe.current;
		swipe.current = null;
		if (!begun || begun.id !== event.pointerId || screenRef.current !== "playing") return;
		const dx = event.clientX - begun.x;
		const dy = event.clientY - begun.y;
		if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) press("up");
		else if (Math.abs(dx) > Math.abs(dy)) press(dx > 0 ? "right" : "left");
		else press(dy < 0 ? "up" : "down");
	};

	const padProps = (dir: HopDir) => ({
		disabled: screen !== "playing",
		onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
			event.preventDefault();
			press(dir);
		},
		// A keyboard press on a focused pad button (a pointer already hopped on its way down).
		onClick: (event: { detail: number }) => {
			if (event.detail === 0) press(dir);
		},
		onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
	});

	const playing = screen === "playing";
	const grade = result ? gradeFor(result.faithKept) : null;
	const chapterHref = chapterHrefFor(game);
	const pad =
		"flex select-none touch-none items-center justify-center gap-1.5 rounded-2xl border text-sm font-bold transition-colors disabled:opacity-40 [-webkit-touch-callout:none] [-webkit-user-select:none]";
	const plain = `${pad} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`;

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
				onPointerDown={onStageDown}
				onPointerUp={onStageUp}
				onPointerCancel={() => {
					swipe.current = null;
				}}
				className={`relative mt-3 aspect-[4/5] w-full scroll-mt-3 select-none overflow-hidden rounded-[22px] border border-black/[.09] bg-[#05071a] outline-none sm:aspect-[16/10] dark:border-white/[.09] ${playing ? "touch-none" : ""}`}
			>
				<canvas ref={canvasRef} aria-hidden className="absolute left-0 top-0 [image-rendering:pixelated]" />

				<div className={`pointer-events-none absolute right-2 top-2 flex gap-1.5 transition-opacity sm:right-3 sm:top-3 ${screen === "intro" ? "opacity-0" : "opacity-100"}`}>
					<button type="button" onClick={toggleMute} aria-label={muted ? "Turn sound on" : "Turn sound off"} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-[#f1eadc] hover:bg-black/60">
						{muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
					</button>
					{playing && (
						<button type="button" onClick={pause} aria-label="Pause" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-[#f1eadc] hover:bg-black/60">
							<Pause size={20} aria-hidden />
						</button>
					)}
				</div>

				<p
					ref={hintRef}
					aria-hidden
					className="pointer-events-none absolute inset-x-6 top-[4.25rem] mx-auto w-fit rounded-md bg-[#05071a]/85 px-3 py-1 text-center text-sm font-bold text-[#f1eadc] opacity-0 transition-opacity sm:top-14"
				/>

				{screen === "intro" && (
					<StoryScreen
						className="bg-[#05071a]/85 text-[#f1eadc]"
						actions={
							<>
								<button type="button" onClick={start} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1d1a12] hover:bg-[#edc47c]">
									<Play size={18} aria-hidden /> Start
								</button>
								{award && (
									<span className="inline-flex items-center gap-2 text-sm font-bold text-[#d9d1c3]">
										<AwardMedal grade={award.grade} emblem={game.emblem} size={36} /> Your award: {game.grades[award.grade]}
									</span>
								)}
							</>
						}
					>
						<p className="font-mono text-xs font-bold uppercase tracking-[.24em] text-[#e5b664]">Arcade · Hop to Jesus</p>
						<Passage verses={verseText(verses, 28, 29)} className="mt-2 max-w-2xl" />
						<ul className="mt-3 max-w-2xl space-y-1 text-sm leading-6 text-[#d9d1c3]">
							<li>
								<b className="text-[#f1eadc]">Hop crest to crest</b> with the arrows or WASD, the pad under the stage, or a swipe on it. A tap hops forward.
							</li>
							<li>
								<b className="text-[#f1eadc]">Light crests carry you; dark troughs are a slip</b> and cost faith. Do not ride a crest into the edge of the sea.
							</li>
							<li>
								<b className="text-[#f1eadc]">Gusts are shown before they shove you</b> a lane downwind: stand where the crest goes on.
							</li>
							<li>
								<b className="text-[#f1eadc]">Hop steadily</b> to win faith back and build a combo, all the way to Jesus in his light.
							</li>
						</ul>
					</StoryScreen>
				)}

				{screen === "paused" && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#05071a]/80 p-6 text-center text-[#f1eadc]">
						<p className="font-mono text-2xl font-bold uppercase tracking-[.3em]">Paused</p>
						<button type="button" onClick={resume} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 font-bold text-[#1d1a12]">
							<Play size={18} aria-hidden /> Keep hopping
						</button>
					</div>
				)}

				{screen === "sinking" && !rescuing && (
					<div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-[#05071a] via-[#05071a]/90 to-transparent p-5 pt-14 text-center text-[#f1eadc]">
						<Passage verses={verseText(verses, 30)} className="max-w-xl" />
						<button ref={cryRef} type="button" onClick={cry} className="inline-flex min-h-14 items-center gap-2 rounded-full bg-[#e5b664] px-7 text-lg font-bold text-[#1d1a12] hover:bg-[#edc47c]">
							Lord, save me
						</button>
					</div>
				)}

				{screen === "rescued" && (
					<StoryScreen
						centered
						className="bg-[#05071a]/85 text-[#f1eadc]"
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
							<p className="mt-3 text-sm text-[#d9d1c3]">Keep your eyes on Jesus and hop it again.</p>
						</div>
					</StoryScreen>
				)}

				{screen === "won" && result && grade && (
					<StoryScreen
						centered
						className="bg-[#05071a]/85 text-[#f1eadc]"
						actions={
							<>
								<button type="button" onClick={start} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 font-bold text-[#1d1a12]">
									<RotateCcw size={18} aria-hidden /> Play again
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
						<p className="mt-1 font-mono text-sm font-bold tracking-wider text-[#e5b664]">SCORE {String(result.score).padStart(6, "0")}</p>
						<p className="mt-1 text-sm text-[#d9d1c3]">
							Faith kept {result.faithKept}% · {result.seconds}s · {result.swellsCleared} clean {result.swellsCleared === 1 ? "hop" : "hops"}
							{result.slips > 0 ? ` · ${result.slips} ${result.slips === 1 ? "slip" : "slips"}` : ""}
						</p>
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => void saveRun({ faithKept: result.faithKept, seconds: result.seconds, swellsCleared: result.swellsCleared })} />
						<Passage verses={verseText(verses, 32, 33)} className="mt-3 max-w-xl pb-2 text-left" />
					</StoryScreen>
				)}
			</div>

			{/* The pad: a thumb's reach under the stage on a phone, and clickable on a desktop. */}
			<div ref={controlsRef} className="mx-auto mt-3 grid max-w-md grid-cols-3 grid-rows-[3.75rem_2.75rem] gap-2" aria-label="Hop controls">
				<button type="button" aria-label="Hop left" {...padProps("left")} className={`${plain} row-span-2`}>
					<ChevronLeft size={24} aria-hidden />
					<span className="sr-only sm:not-sr-only">Left</span>
				</button>
				<button type="button" aria-label="Hop forward" {...padProps("up")} className={`${pad} border-amber-600/40 bg-amber-500/15 text-amber-900 active:bg-amber-500/30 dark:border-[#e5b664]/40 dark:text-[#e5b664]`}>
					<ChevronUp size={26} aria-hidden />
					<span>Hop</span>
				</button>
				<button type="button" aria-label="Hop right" {...padProps("right")} className={`${plain} row-span-2`}>
					<span className="sr-only sm:not-sr-only">Right</span>
					<ChevronRight size={24} aria-hidden />
				</button>
				<button type="button" aria-label="Hop back" {...padProps("down")} className={`${plain} col-start-2 row-start-2`}>
					<ChevronDown size={22} aria-hidden />
					<span className="sr-only sm:not-sr-only">Back</span>
				</button>
			</div>
			<p className="mt-2 hidden px-1 text-center text-sm text-neutral-600 sm:block dark:text-[#bbb3a7]">Keyboard: ↑ W or Space to hop forward, ← → or A D across, ↓ S back, P to pause.</p>
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<PassageSection game={game} verses={verses} />
		</main>
	);
}
