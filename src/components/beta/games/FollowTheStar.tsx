"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { createNightAudio, type NightAudio } from "./follow-the-star-audio";
import { drawStarScene } from "./follow-the-star-scene";
import { AwardSaveStatus, GameHeader, Passage, PassageSection, StoryScreen, chapterHref as chapterHrefFor, useGameAward, useMuted, verseText } from "./shared";
import type { ChapterGameProps } from "./types";
import { gradeFor } from "@/lib/beta/games/games-rules";
import {
	STAR_LOST_LIMIT,
	STAR_STEP,
	STAR_VIEW_HALF,
	journeyResult,
	keptCredit,
	keptSoFar,
	legProgress,
	newJourney,
	starOffset,
	stepJourney,
	type StarEvent,
	type StarResult,
	type StarState,
} from "@/lib/beta/games/follow-the-star-rules";

/**
 * Follow the Star (LC-17851, docs/beta/games.md), the night-sky way to play
 * Matthew 2:1-12. The simulation lives in follow-the-star-rules.ts; this
 * component runs it on a fixed step from requestAnimationFrame, draws it,
 * plays the night and tells the story around it in the passage's own words
 * (the bundled KJV): verses 1-2 to set out, 3-8 at Jerusalem, 9-10 as the
 * star goes before them, 11 at the house and 12 to close.
 */

type Screen = "intro" | "playing" | "jerusalem" | "paused" | "lost" | "house" | "won";

/** How long the arrivals and the loss play before their words come up. */
const CITY_SCENE = 0.9;
const HOUSE_SCENE = 3.2;
const LOST_SCENE = 1.8;
/** Verses 9 and 10 over the stage as the star goes before them: [from, to, shown from, shown until] seconds into the leg. */
const CAPTIONS = [
	[9, 9, 0.5, 8],
	[10, 10, 8, 12.5],
] as const;

const HINTS = {
	city: "Steer for the lamps of Jerusalem",
	ground: "Rough ground ahead: go around it",
	hidden: "A cloud hides the star: hold your course",
	astray: "Turn back toward the star",
} as const;

export default function FollowTheStar({ game, verses, initialAward }: ChapterGameProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const keptRef = useRef<HTMLSpanElement>(null);
	const legRef = useRef<HTMLSpanElement>(null);
	const wayRef = useRef<HTMLDivElement>(null);
	const wayLabelRef = useRef<HTMLSpanElement>(null);
	const hintRef = useRef<HTMLParagraphElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const departRef = useRef<HTMLButtonElement>(null);
	const continueRef = useRef<HTMLButtonElement>(null);

	const journey = useRef<StarState>(newJourney(1));
	const screenRef = useRef<Screen>("intro");
	const keys = useRef({ left: false, right: false });
	const held = useRef({ left: 0, right: 0 });
	const drag = useRef<{ id: number; x: number; steer: number } | null>(null);
	const queued = useRef({ go: false });
	const audio = useRef<NightAudio | null>(null);
	const scene = useRef({ cityAt: null as number | null, houseAt: null as number | null, lostAt: null as number | null, shimmer: 0, caption: -1, hint: "" });

	const [screen, setScreenState] = useState<Screen>("intro");
	const { muted, toggleMute } = useMuted(useCallback((next: boolean) => audio.current?.setMuted(next), []));
	const [result, setResult] = useState<StarResult | null>(null);
	const { award, saving, save: saveRun, resetSaving } = useGameAward(game.slug, initialAward);
	const [announcement, setAnnouncement] = useState("");
	const [caption, setCaption] = useState(-1);

	const setScreen = useCallback((next: Screen) => {
		screenRef.current = next;
		setScreenState(next);
	}, []);

	const handleEvent = useCallback(
		(event: StarEvent, now: number, reduceMotion: boolean) => {
			const sound = audio.current;
			const look = scene.current;
			const buzz = (pattern: number | number[]) => navigator.vibrate?.(pattern);
			switch (event.type) {
				case "struck":
					sound?.rough();
					buzz(35);
					break;
				case "jerusalem":
					look.cityAt = now;
					setAnnouncement("You have come to Jerusalem.");
					break;
				case "depart":
					sound?.chime();
					look.shimmer = reduceMotion ? 0 : 1;
					setAnnouncement("The star went before them. Keep it before you.");
					break;
				case "clouded":
					setAnnouncement("A cloud hides the star. Hold your course.");
					break;
				case "cleared":
					sound?.chime();
					look.shimmer = reduceMotion ? 0 : 1;
					setAnnouncement(event.inView ? "The star is seen again." : "The star is seen again. Turn toward it.");
					break;
				case "astray":
					buzz(20);
					setAnnouncement("You are losing sight of the star.");
					break;
				case "stood":
					setAnnouncement("The star stands over the house.");
					break;
				case "lost":
					look.lostAt = now;
					sound?.lost();
					buzz([60, 40, 60]);
					setAnnouncement("You lost sight of the star.");
					break;
				case "arrived": {
					look.houseAt = now;
					sound?.arrive();
					const run = journeyResult(journey.current);
					if (run) {
						setResult(run);
						void saveRun({ faithKept: run.faithKept, seconds: run.seconds, swellsCleared: run.swellsCleared });
					}
					setAnnouncement("You have come to the house where the star stood.");
					break;
				}
			}
		},
		[saveRun],
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
		const events: StarEvent[] = [];
		const tick = (time: number) => {
			frame = requestAnimationFrame(tick);
			const now = time / 1000;
			const elapsed = Math.min(0.1, (time - last) / 1000);
			last = time;
			const state = journey.current;
			const current = screenRef.current;
			const look = scene.current;
			if (current === "playing") {
				carry += elapsed;
				const fromKeys = (keys.current.right || held.current.right > 0 ? 1 : 0) - (keys.current.left || held.current.left > 0 ? 1 : 0);
				const steer = Math.max(-1, Math.min(1, fromKeys + (drag.current?.steer ?? 0)));
				while (carry >= STAR_STEP) {
					stepJourney(state, { steer, go: queued.current.go }, events);
					queued.current.go = false;
					carry -= STAR_STEP;
				}
				for (const event of events.splice(0)) handleEvent(event, now, reduceMotion);
			} else carry = 0;
			look.shimmer = Math.max(0, look.shimmer - elapsed * 0.9);

			if (current === "playing") {
				if (look.cityAt !== null && state.phase === "jerusalem" && now - look.cityAt > CITY_SCENE) setScreen("jerusalem");
				if (look.houseAt !== null && now - look.houseAt > HOUSE_SCENE) setScreen("house");
				if (look.lostAt !== null && now - look.lostAt > LOST_SCENE) setScreen("lost");
			}

			const second = state.phase === "star";
			const off = starOffset(state);
			const close = second && !state.hidden ? keptCredit(off) : 0.5;
			audio.current?.set(state.wind, close, state.hidden, state.lostFor / STAR_LOST_LIMIT);

			drawStarScene(context, {
				width: size.width,
				height: size.height,
				state,
				now,
				reduceMotion,
				shimmer: look.shimmer,
				arrival: look.houseAt === null ? null : now - look.houseAt,
				lost: look.lostAt === null ? null : now - look.lostAt,
			});

			// The HUD is written straight to the DOM: no React render per frame.
			const progress = legProgress(state);
			const toCity = state.phase === "east" || state.phase === "jerusalem";
			if (legRef.current) legRef.current.textContent = toCity ? "Toward Jerusalem" : "Kept to the star";
			if (keptRef.current) keptRef.current.textContent = toCity ? "" : `${keptSoFar(state)}%`;
			if (wayRef.current) wayRef.current.style.width = `${progress * 100}%`;
			if (wayLabelRef.current) wayLabelRef.current.textContent = `${Math.min(100, Math.floor(progress * 100))}% of the way to ${toCity ? "Jerusalem" : "Bethlehem"}`;

			// The story's words over the stage as the star goes before them (a render only when they change).
			const captionNow = second ? CAPTIONS.findIndex(([, , from, until]) => state.legT >= from && state.legT < until) : -1;
			if (captionNow !== look.caption) {
				look.caption = captionNow;
				setCaption(captionNow);
			}

			// One hint at a time, and only what the player needs now.
			let hint = "";
			if (current === "playing" && (state.phase === "east" || second)) {
				const next = state.obstacles.find((o) => o.outcome === null && o.s - state.s < 14 && o.s - state.s > -1);
				const inWay = !!next && Math.abs(state.lat + (next.s - state.s) * Math.tan(state.heading) - next.lat) < next.half + 0.7;
				if (second && state.hidden) hint = HINTS.hidden;
				else if (second && Math.abs(off) > STAR_VIEW_HALF) hint = HINTS.astray;
				else if (inWay && next && next.id <= 4) hint = HINTS.ground;
				else if (!second && state.legT < 6) hint = HINTS.city;
			}
			if (hint !== look.hint && hintRef.current) {
				look.hint = hint;
				hintRef.current.textContent = hint;
				hintRef.current.style.opacity = hint ? "1" : "0";
			}

			// What the player can see, for tests that play it by its controls (never read back into the game).
			if (current === "playing") {
				const next = state.obstacles.find((o) => o.outcome === null && o.s + o.depth / 2 > state.s);
				stage.dataset.leg = state.phase;
				stage.dataset.aim = state.phase === "east" || (second && !state.hidden) ? off.toFixed(3) : "hidden";
				stage.dataset.heading = state.heading.toFixed(3);
				stage.dataset.turn = state.turnVel.toFixed(3);
				stage.dataset.ground = next ? [next.s - next.depth / 2 - state.s, next.lat - next.half - 0.7 - state.lat, next.lat + next.half + 0.7 - state.lat].map((n) => n.toFixed(2)).join(",") : "";
			}
		};
		frame = requestAnimationFrame(tick);

		const hidden = () => {
			if (document.hidden && screenRef.current === "playing" && (journey.current.phase === "east" || journey.current.phase === "star")) {
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

	useEffect(() => {
		if (screen === "jerusalem") departRef.current?.focus({ preventScroll: true });
		if (screen === "house") continueRef.current?.focus({ preventScroll: true });
	}, [screen]);

	const start = useCallback(() => {
		journey.current = newJourney(Math.floor(Math.random() * 2 ** 31));
		scene.current = { cityAt: null, houseAt: null, lostAt: null, shimmer: 0, caption: -1, hint: "" };
		keys.current = { left: false, right: false };
		held.current = { left: 0, right: 0 };
		drag.current = null;
		queued.current = { go: false };
		setResult(null);
		setCaption(-1);
		resetSaving();
		if (!audio.current) audio.current = createNightAudio(muted);
		audio.current?.resume();
		setAnnouncement("You set out from the east. Steer for Jerusalem.");
		setScreen("playing");
		const stage = stageRef.current;
		stage?.focus({ preventScroll: true });
		// The stage and the controls under it, together on a phone.
		if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
		else if (stage && controlsRef.current && controlsRef.current.getBoundingClientRect().bottom > window.innerHeight) stage.scrollIntoView({ block: "start" });
	}, [muted, resetSaving, setScreen]);

	const depart = useCallback(() => {
		queued.current.go = true;
		// Cleared here, not by the step that leaves Jerusalem: a frame too short for a step must not show the city again.
		scene.current.cityAt = null;
		keys.current = { left: false, right: false };
		held.current = { left: 0, right: 0 };
		drag.current = null;
		setScreen("playing");
		stageRef.current?.focus({ preventScroll: true });
	}, [setScreen]);

	const pause = useCallback(() => {
		if (screenRef.current !== "playing") return;
		const phase = journey.current.phase;
		if (phase !== "east" && phase !== "star") return;
		audio.current?.pause();
		setScreen("paused");
	}, [setScreen]);

	const resume = useCallback(() => {
		audio.current?.resume();
		keys.current = { left: false, right: false };
		held.current = { left: 0, right: 0 };
		drag.current = null;
		setScreen("playing");
		stageRef.current?.focus({ preventScroll: true });
	}, [setScreen]);

	// Keyboard: arrows or A/D to steer, P or Escape to pause.
	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			const current = screenRef.current;
			if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
			const key = event.key.toLowerCase();
			if (current === "playing") {
				if (key === "arrowleft" || key === "a") keys.current.left = true;
				else if (key === "arrowright" || key === "d") keys.current.right = true;
				else if (key === "p" || key === "escape") pause();
				// Keys the page would scroll on while the stage has focus.
				else if (key !== " " && key !== "arrowup" && key !== "arrowdown") return;
				event.preventDefault();
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
			drag.current = null;
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

	// Touch and mouse: hold a Turn button; each pointer is counted so two thumbs never stick.
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

	// Or drag across the sky: the further from where the finger went down, the harder the turn.
	const dragProps = {
		onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
			if (screenRef.current !== "playing" || (event.target instanceof HTMLElement && event.target.closest("button"))) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			drag.current = { id: event.pointerId, x: event.clientX, steer: 0 };
		},
		onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
			if (drag.current?.id !== event.pointerId) return;
			drag.current.steer = Math.max(-1, Math.min(1, (event.clientX - drag.current.x) / 55));
		},
		onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
			if (drag.current?.id === event.pointerId) drag.current = null;
		},
		onPointerCancel: () => {
			drag.current = null;
		},
	};

	const playing = screen === "playing";
	const grade = result ? gradeFor(result.faithKept) : null;
	const chapterHref = chapterHrefFor(game);
	const control =
		"flex min-h-16 select-none touch-none items-center justify-center gap-2 rounded-2xl border text-sm font-bold transition-colors disabled:opacity-40 [-webkit-touch-callout:none] [-webkit-user-select:none]";
	const primary = "inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1d1a12] hover:bg-[#edc47c]";
	const secondary = "inline-flex min-h-12 items-center rounded-full border border-white/25 px-5 font-bold text-[#f1eadc] hover:bg-white/5";
	const story = "bg-[#05071a]/80 text-[#f1eadc]";
	const shown = caption >= 0 ? CAPTIONS[caption] : null;
	const passed = result?.swellsCleared ?? 0;

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
				{...dragProps}
				className={`relative mt-3 aspect-[4/5] w-full scroll-mt-3 select-none overflow-hidden rounded-[22px] border border-black/[.09] bg-[#05071a] outline-none sm:aspect-[16/10] dark:border-white/[.09] ${playing ? "touch-none" : ""}`}
			>
				<canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />

				{/* HUD */}
				<div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-3 transition-opacity ${playing || screen === "paused" ? "opacity-100" : "opacity-0"}`}>
					<div className="min-w-0 max-w-[16rem] flex-1">
						<div className="flex items-baseline justify-between gap-2 text-xs font-bold uppercase tracking-[.16em] text-[#f1eadc]">
							<span ref={legRef}>Toward Jerusalem</span>
							<span ref={keptRef} className="text-sm text-[#f3d79d]" />
						</div>
						<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
							<div ref={wayRef} className="h-full rounded-full bg-[#e5b664]/85" style={{ width: "0%" }} />
						</div>
						<span ref={wayLabelRef} className="mt-1 block text-xs font-bold text-[#cfc8ba]">
							0% of the way to Jerusalem
						</span>
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

				{/* Verses 9 and 10 as the star goes before them. */}
				{playing && shown && (
					<div className="pointer-events-none absolute inset-x-3 bottom-12 flex justify-center sm:bottom-auto sm:top-24">
						<Passage verses={verseText(verses, shown[0], shown[1])} className="max-w-xl rounded-2xl bg-[#05071a]/65 px-4 py-2.5 text-center text-[16px] leading-[1.35rem] text-[#f6efe0] sm:text-[19px] sm:leading-7" />
					</div>
				)}

				<p
					ref={hintRef}
					className={`pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/45 px-3 py-1 text-sm font-bold text-[#f1eadc] opacity-0 transition-opacity ${playing ? "" : "hidden"}`}
				/>

				{screen === "intro" && (
					<StoryScreen
						className={story}
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
								<b className="text-[#f1eadc]">Steer the company:</b> hold left or right (or A, D), the Turn buttons, or drag across the sky.
							</li>
							<li>
								<b className="text-[#f1eadc]">First, to Jerusalem:</b> steer for its lamps on the horizon.
							</li>
							<li>
								<b className="text-[#f1eadc]">Then keep the star before you.</b> When a cloud hides it, hold your course. Go around ravines and rocky rises, then find it again.
							</li>
						</ul>
					</StoryScreen>
				)}

				{screen === "jerusalem" && (
					<StoryScreen
						className={story}
						actions={
							<button ref={departRef} type="button" onClick={depart} className={primary}>
								<Play size={18} aria-hidden /> Depart for Bethlehem
							</button>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Jerusalem</p>
						<Passage verses={verseText(verses, 3, 8)} className="mt-2 max-w-2xl pb-1" />
					</StoryScreen>
				)}

				{screen === "paused" && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#05071a]/75 p-6 text-center text-[#f1eadc]">
						<p className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold">Paused</p>
						<button type="button" onClick={resume} className={primary}>
							<Play size={18} aria-hidden /> Travel on
						</button>
					</div>
				)}

				{screen === "lost" && (
					<StoryScreen
						centered
						className={story}
						actions={
							<>
								<button type="button" onClick={start} className={primary}>
									<RotateCcw size={18} aria-hidden /> Try again
								</button>
								<Link href={chapterHref} className={secondary}>
									Read Matthew 2
								</Link>
							</>
						}
					>
						<div className="my-auto">
							<h2 className="font-[family-name:var(--font-cormorant)] text-[2rem] font-semibold leading-tight">You lost sight of the star</h2>
							<p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#d9d1c3]">The company is lost in the night. Set out again, keep the star before you, and hold your course when a cloud passes over it.</p>
						</div>
					</StoryScreen>
				)}

				{screen === "house" && (
					<StoryScreen
						centered
						className="bg-[#120d06]/65 text-[#f6efe0]"
						actions={
							<button ref={continueRef} type="button" onClick={() => setScreen("won")} className={primary}>
								Continue
							</button>
						}
					>
						<div className="my-auto">
							<p className="text-xs font-bold uppercase tracking-[.2em] text-[#f3d79d]">The house</p>
							<Passage verses={verseText(verses, 11)} className="mt-2 max-w-xl" numberClassName="text-[#f3d79d]" />
						</div>
					</StoryScreen>
				)}

				{screen === "won" && result && grade && (
					<StoryScreen
						centered
						className={story}
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
						<AwardMedal grade={grade} emblem={game.emblem} size={76} title={`${grade} medal`} />
						<p className="mt-2 text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Award · {game.award}</p>
						<h2 className="font-[family-name:var(--font-cormorant)] text-[2rem] font-semibold leading-tight">{game.grades[grade]}</h2>
						<p className="mt-1 text-sm text-[#d9d1c3]">
							Kept to the star {result.faithKept}% · {result.seconds}s · {passed} {passed === 1 ? "ravine or rise" : "ravines and rises"} gone around
						</p>
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => void saveRun({ faithKept: result.faithKept, seconds: result.seconds, swellsCleared: result.swellsCleared })} />
						<Passage verses={verseText(verses, 12)} className="mt-3 max-w-xl pb-2 text-left" />
					</StoryScreen>
				)}
			</div>

			{/* Controls: one per thumb on a phone, and clickable on a desktop. */}
			<div ref={controlsRef} className="mt-3 grid grid-cols-2 gap-2.5" aria-label="Controls">
				<button type="button" disabled={!playing} aria-label="Turn left" {...holdProps("left")} className={`${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`}>
					<ArrowLeft size={22} aria-hidden />
					<span>Turn</span>
				</button>
				<button type="button" disabled={!playing} aria-label="Turn right" {...holdProps("right")} className={`${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`}>
					<span>Turn</span>
					<ArrowRight size={22} aria-hidden />
				</button>
			</div>
			<p className="mt-2 hidden px-1 text-sm text-neutral-600 sm:block dark:text-[#bbb3a7]">Keyboard: ← → or A D to steer, P to pause. Or drag across the sky.</p>
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<PassageSection game={game} verses={verses} />
		</main>
	);
}
