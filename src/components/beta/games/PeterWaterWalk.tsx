"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronsUp, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { createStormAudio, type StormAudio } from "./water-walk-audio";
import { drawWalkScene } from "./water-walk-scene";
import { AwardSaveStatus, GameHeader, Passage, PassageSection, StoryScreen, chapterHref as chapterHrefFor, useGameAward, useMuted, verseText } from "./shared";
import type { ChapterGameProps } from "./types";
import { gradeFor } from "@/lib/beta/games/games-rules";
import {
	WALK_GOAL,
	WALK_STEP,
	newWalk,
	stepWalk,
	walkResult,
	type WalkEvent,
	type WalkResult,
	type WalkState,
} from "@/lib/beta/games/water-walk-rules";

/**
 * Peter's Water Walk (LC-17850, docs/beta/games.md), Matthew 14's chapter
 * game. The simulation lives in water-walk-rules.ts; this component runs it
 * on a fixed step from requestAnimationFrame, draws it, plays the storm and
 * tells the story around it in the passage's own words (the bundled KJV).
 */

type Screen = "intro" | "playing" | "paused" | "sinking" | "rescued" | "arrived";

/** How long the rescue and the arrival play before their words come up. */
const RESCUE_SCENE = 1.7;
const ARRIVAL_SCENE = 2.2;

export default function PeterWaterWalk({ game, verses, initialAward }: ChapterGameProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const faithRef = useRef<HTMLDivElement>(null);
	const faithLabelRef = useRef<HTMLSpanElement>(null);
	const distanceRef = useRef<HTMLDivElement>(null);
	const distanceLabelRef = useRef<HTMLSpanElement>(null);
	const balanceRef = useRef<HTMLDivElement>(null);
	const hintRef = useRef<HTMLParagraphElement>(null);
	const cryRef = useRef<HTMLButtonElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);

	const walk = useRef<WalkState>(newWalk(1));
	const screenRef = useRef<Screen>("intro");
	const keys = useRef({ left: false, right: false });
	const held = useRef({ left: 0, right: 0 });
	const queued = useRef({ jump: false, cry: false });
	const audio = useRef<StormAudio | null>(null);
	const scene = useRef({ rescueAt: null as number | null, arriveAt: null as number | null, flash: 0, nextFlash: 3, storm: 1, swellsSeen: 0 });

	const [screen, setScreenState] = useState<Screen>("intro");
	const { muted, toggleMute } = useMuted(useCallback((next: boolean) => audio.current?.setMuted(next), []));
	const [result, setResult] = useState<WalkResult | null>(null);
	const { award, saving, save: saveRun, resetSaving } = useGameAward(game.slug, initialAward);
	const [announcement, setAnnouncement] = useState("");
	const [rescuing, setRescuing] = useState(false);

	const setScreen = useCallback((next: Screen) => {
		screenRef.current = next;
		setScreenState(next);
	}, []);

	const handleEvent = useCallback(
		(event: WalkEvent, now: number) => {
			const sound = audio.current;
			const buzz = (pattern: number | number[]) => navigator.vibrate?.(pattern);
			switch (event.type) {
				case "swell":
					scene.current.swellsSeen += 1;
					break;
				case "jump":
					sound?.step();
					break;
				case "hit":
					sound?.splash();
					buzz(45);
					break;
				case "sinking":
					sound?.splash();
					buzz([70, 50, 70]);
					setAnnouncement("He is sinking. Cry out: Lord, save me.");
					setScreen("sinking");
					break;
				case "rescued":
					scene.current.rescueAt = now;
					setRescuing(true);
					setAnnouncement("Jesus stretched forth his hand and caught him.");
					break;
				case "arrived": {
					scene.current.arriveAt = now;
					sound?.calm();
					const run = walkResult(walk.current);
					if (run) {
						setResult(run);
						void saveRun(run);
					}
					setAnnouncement("You reached Jesus. The wind ceased.");
					break;
				}
			}
		},
		[saveRun, setScreen],
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
		const events: WalkEvent[] = [];
		const tick = (time: number) => {
			frame = requestAnimationFrame(tick);
			const now = time / 1000;
			const elapsed = Math.min(0.1, (time - last) / 1000);
			last = time;
			const state = walk.current;
			const current = screenRef.current;
			const running = current === "playing" || current === "sinking" || current === "arrived" || current === "rescued";
			if (running) {
				carry += elapsed;
				while (carry >= WALK_STEP) {
					const lean = (keys.current.right || held.current.right > 0 ? 1 : 0) - (keys.current.left || held.current.left > 0 ? 1 : 0);
					stepWalk(state, { lean, jump: queued.current.jump, cry: queued.current.cry }, events);
					queued.current.jump = false;
					queued.current.cry = false;
					carry -= WALK_STEP;
				}
				for (const event of events.splice(0)) handleEvent(event, now);
			}

			const look = scene.current;
			// The wind ceases once he is safe with Jesus (verse 32).
			const calmFrom = look.arriveAt ?? (look.rescueAt !== null ? look.rescueAt + 0.6 : null);
			look.storm = calmFrom === null ? 1 : Math.min(1, Math.max(0, 1 - (now - calmFrom) / 2.5));
			if (!reduceMotion && running && current !== "arrived" && look.storm > 0.5) {
				look.nextFlash -= elapsed;
				if (look.nextFlash <= 0) {
					look.flash = 0.32;
					look.nextFlash = 4 + Math.random() * 6;
					audio.current?.thunder();
				}
			}
			look.flash = Math.max(0, look.flash - elapsed * 1.6);
			audio.current?.set(look.storm, state.wind);

			if (look.rescueAt !== null && current === "sinking" && now - look.rescueAt > RESCUE_SCENE) setScreen("rescued");
			if (look.arriveAt !== null && current === "playing" && now - look.arriveAt > ARRIVAL_SCENE) setScreen("arrived");

			drawWalkScene(context, {
				width: size.width,
				height: size.height,
				state,
				now,
				storm: look.storm,
				flash: look.flash,
				rescue: look.rescueAt === null ? null : now - look.rescueAt,
				arrival: look.arriveAt === null ? null : now - look.arriveAt,
			});

			// The HUD is written straight to the DOM: no React render per frame.
			const faith = Math.round(state.faith);
			if (faithRef.current) {
				faithRef.current.style.width = `${faith}%`;
				faithRef.current.dataset.low = faith < 30 ? "true" : "false";
			}
			if (faithLabelRef.current) faithLabelRef.current.textContent = `${faith}%`;
			if (distanceRef.current) distanceRef.current.style.width = `${(state.x / WALK_GOAL) * 100}%`;
			if (distanceLabelRef.current) distanceLabelRef.current.textContent = `${Math.min(100, Math.floor((state.x / WALK_GOAL) * 100))}% of the way to Jesus`;
			if (balanceRef.current) balanceRef.current.style.left = `${50 + Math.max(-1, Math.min(1, state.tilt / 1.15)) * 50}%`;
			if (hintRef.current) {
				const ahead = state.swells.find((swell) => swell.outcome === null && swell.x > state.x);
				const show = current === "playing" && state.phase === "walking" && look.swellsSeen <= 2 && !!ahead && ahead.x - state.x < 9;
				hintRef.current.style.opacity = show ? "1" : "0";
			}
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
		walk.current = newWalk(Math.floor(Math.random() * 2 ** 31));
		scene.current = { rescueAt: null, arriveAt: null, flash: 0, nextFlash: 3, storm: 1, swellsSeen: 0 };
		keys.current = { left: false, right: false };
		held.current = { left: 0, right: 0 };
		queued.current = { jump: false, cry: false };
		setResult(null);
		setRescuing(false);
		resetSaving();
		if (!audio.current) audio.current = createStormAudio(muted);
		audio.current?.resume();
		setAnnouncement("You stepped out of the ship. Keep your eyes on Jesus.");
		setScreen("playing");
		const stage = stageRef.current;
		stage?.focus({ preventScroll: true });
		// The stage and the controls under it, together on a phone.
		if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
		else if (stage && controlsRef.current && controlsRef.current.getBoundingClientRect().bottom > window.innerHeight) stage.scrollIntoView({ block: "start" });
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

	// Keyboard: arrows or A/D to lean, Up/W/Space to step up, P or Escape to pause.
	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			const current = screenRef.current;
			if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
			const key = event.key.toLowerCase();
			if (current === "playing") {
				if (key === "arrowleft" || key === "a") keys.current.left = true;
				else if (key === "arrowright" || key === "d") keys.current.right = true;
				else if (key === "arrowup" || key === "w" || key === " ") {
					if (!event.repeat) queued.current.jump = true;
				} else if (key === "p" || key === "escape") pause();
				else return;
				event.preventDefault();
			} else if (current === "sinking" && scene.current.rescueAt === null && (key === "arrowup" || key === "w" || key === " " || key === "enter")) {
				event.preventDefault();
				queued.current.cry = true;
			} else if (current === "paused" && (key === "p" || key === "escape")) {
				event.preventDefault();
				resume();
			}
		};
		const up = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			if (key === "arrowleft" || key === "a") keys.current.left = false;
			if (key === "arrowright" || key === "d") keys.current.right = false;
		};
		const blur = () => {
			keys.current = { left: false, right: false };
			held.current = { left: 0, right: 0 };
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
		if (screen === "sinking") cryRef.current?.focus();
	}, [screen]);

	// Touch and mouse: hold a side to lean; each pointer is counted so two thumbs never stick.
	const holdProps = (side: "left" | "right") => ({
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
		"flex min-h-16 select-none touch-none flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm font-bold transition-colors disabled:opacity-40 [-webkit-touch-callout:none] [-webkit-user-select:none]";

	return (
		<main className="mx-auto w-full max-w-4xl px-3 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-3 sm:px-5 lg:px-8 lg:pb-16 lg:pt-8">
			<GameHeader game={game} />

			<div
				ref={stageRef}
				tabIndex={-1}
				role="region"
				aria-label={`${game.title}, a game of ${game.reference}`}
				className="relative mt-3 aspect-[4/5] w-full scroll-mt-3 select-none overflow-hidden rounded-[22px] border border-black/[.09] bg-[#070b12] outline-none sm:aspect-[16/10] dark:border-white/[.09]"
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
						<div className="mt-2 flex items-center justify-between text-xs font-bold text-[#d9d1c3]">
							<span ref={distanceLabelRef}>0% of the way to Jesus</span>
						</div>
						<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
							<div ref={distanceRef} className="h-full rounded-full bg-[#f1eadc]/80" style={{ width: "0%" }} />
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

				{/* Balance: keep the marker in the steady middle. */}
				<div className={`pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 transition-opacity ${playing ? "opacity-100" : "opacity-0"}`}>
					<p ref={hintRef} className="rounded-full bg-black/45 px-3 py-1 text-sm font-bold text-[#f1eadc] opacity-0 transition-opacity">
						A swell! Step up as the crest reaches you
					</p>
					<div className="relative h-3 w-[min(60%,280px)] rounded-full bg-white/15">
						<div className="absolute inset-y-0 left-[37.8%] right-[37.8%] rounded-full bg-[#e5b664]/35" />
						<div ref={balanceRef} className="absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f1eadc]" style={{ left: "50%" }} />
					</div>
					<span className="text-xs font-bold uppercase tracking-[.18em] text-[#d9d1c3]">Balance</span>
				</div>

				{screen === "intro" && (
					<StoryScreen
						actions={
							<>
								<button type="button" onClick={start} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1d1a12] hover:bg-[#edc47c]">
									<Play size={18} aria-hidden /> Step out of the ship
								</button>
								{award && (
									<span className="inline-flex items-center gap-2 text-sm font-bold text-[#d9d1c3]">
										<AwardMedal grade={award.grade} size={36} /> Your award: {game.grades[award.grade]}
									</span>
								)}
							</>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">The fourth watch of the night</p>
						<Passage verses={verseText(verses, 28, 29)} className="mt-2 max-w-2xl" />
						<ul className="mt-3 max-w-2xl space-y-1 text-sm leading-6 text-[#d9d1c3]">
							<li>
								<b className="text-[#f1eadc]">Lean against the wind:</b> hold left or right (or A, D) to keep the balance marker in the middle.
							</li>
							<li>
								<b className="text-[#f1eadc]">Step up over each swell</b> as its crest reaches you (Up, W or Space).
							</li>
							<li>
								<b className="text-[#f1eadc]">Keep your eyes on Jesus:</b> standing steady builds faith; tipping and swells drain it.
							</li>
						</ul>
					</StoryScreen>
				)}

				{screen === "paused" && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#070b12]/75 p-6 text-center text-[#f1eadc]">
						<p className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold">Paused</p>
						<button type="button" onClick={resume} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 font-bold text-[#1d1a12]">
							<Play size={18} aria-hidden /> Keep walking
						</button>
					</div>
				)}

				{screen === "sinking" && !rescuing && (
					<div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-[#070b12]/95 to-transparent p-5 pt-12 text-center text-[#f1eadc]">
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

				{screen === "arrived" && result && grade && (
					<StoryScreen
						centered
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
						<AwardMedal grade={grade} size={76} title={`${grade} medal`} />
						<p className="mt-2 text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Award · {game.award}</p>
						<h2 className="font-[family-name:var(--font-cormorant)] text-[2rem] font-semibold leading-tight">{game.grades[grade]}</h2>
						<p className="mt-1 text-sm text-[#d9d1c3]">
							Faith kept {result.faithKept}% · {result.seconds}s · {result.swellsCleared} {result.swellsCleared === 1 ? "swell" : "swells"} stepped over
						</p>
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => void saveRun(result)} />
						<Passage verses={verseText(verses, 32, 33)} className="mt-3 max-w-xl pb-2 text-left" />
					</StoryScreen>
				)}
			</div>

			{/* Controls: one per thumb on a phone, and clickable on a desktop. */}
			<div ref={controlsRef} className="mt-3 grid grid-cols-3 gap-2.5" aria-label="Controls">
				<button type="button" disabled={!playing} aria-label="Lean left" {...holdProps("left")} className={`${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`}>
					<ArrowLeft size={22} aria-hidden />
					<span>Lean</span>
				</button>
				<button
					type="button"
					disabled={!playing}
					onPointerDown={(event) => {
						event.preventDefault();
						queued.current.jump = true;
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") queued.current.jump = true;
					}}
					onContextMenu={(event) => event.preventDefault()}
					className={`${control} border-amber-600/40 bg-amber-500/15 text-amber-900 active:bg-amber-500/30 dark:border-[#e5b664]/40 dark:text-[#e5b664]`}
				>
					<ChevronsUp size={22} aria-hidden />
					<span>Step up</span>
				</button>
				<button type="button" disabled={!playing} aria-label="Lean right" {...holdProps("right")} className={`${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`}>
					<ArrowRight size={22} aria-hidden />
					<span>Lean</span>
				</button>
			</div>
			<p className="mt-2 hidden px-1 text-sm text-neutral-600 sm:block dark:text-[#bbb3a7]">Keyboard: ← → or A D to lean, ↑ W or Space to step up, P to pause.</p>
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<PassageSection game={game} verses={verses} />
		</main>
	);
}
