"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Hand, Pause, Play, RotateCcw, Timer, Volume2, VolumeX, X } from "lucide-react";
import AwardMedal from "./AwardMedal";
import { AwardSaveStatus, useGameAward, useMuted } from "./shared";
import { unlockStageAudio } from "./stage-kit";
import { useVerseVoice } from "./verse-voice";
import type { ChapterGameProps, StageKeys, StageProps, StageResult } from "./types";
import { getKjvChapter } from "@/lib/bible/kjv";
import { gradeFor, type GameControl } from "@/lib/beta/games/games-rules";

/**
 * The player every chapter game runs in (LC-17851, docs/beta/games.md), in
 * the page where it is opened. Before a round it shows the game's command,
 * controls and tips big and highlighted; then a short countdown, a timer bar
 * and the controls kept in view under the stage; then the outcome, the award
 * and the cast speaking the chapter's verse. The game's stage only draws,
 * reads input and plays its rules.
 */

type Phase = "ready" | "countdown" | "playing" | "paused" | "won" | "lost";

/** The countdown before a round: the command flashes over it. */
const COUNTDOWN_MS = 1500;
/** After a round ends, keys from the round are ignored this long, so a held key never starts the next. */
const SETTLE_MS = 700;

/** Key caps as printed, to `KeyboardEvent.key` in lower case. */
const KEY_VALUES: Record<string, string> = { "←": "arrowleft", "→": "arrowright", "↑": "arrowup", "↓": "arrowdown", Space: " " };
const ALWAYS_HELD = new Set(["arrowleft", "arrowright", "arrowup", "arrowdown", " "]);

export function keyValue(cap: string): string | null {
	if (cap === "Click") return null;
	return KEY_VALUES[cap] ?? cap.toLowerCase();
}

function useCoarsePointer() {
	const [coarse, setCoarse] = useState(false);
	useEffect(() => {
		const query = window.matchMedia("(pointer: coarse)");
		setCoarse(query.matches);
		const change = () => setCoarse(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	return coarse;
}

/** Arrow keys and number keys read as one group of caps; anything else is "or". */
function sameGroup(a: string, b: string) {
	const arrows = "←→↑↓";
	return (arrows.includes(a) && arrows.includes(b)) || (/^\d$/.test(a) && /^\d$/.test(b));
}

function KeyCap({ cap, size = "lg" }: { cap: string; size?: "lg" | "sm" }) {
	const big = size === "lg";
	return (
		<kbd
			className={`inline-flex items-center justify-center rounded-lg border-2 border-b-4 border-amber-300 bg-[#fff7e6] font-sans font-black text-neutral-900 shadow-[0_0_0_3px_rgba(251,191,36,.25)] ${
				big ? "h-11 min-w-11 px-2.5 text-lg" : "h-7 min-w-7 px-1.5 text-xs"
			}`}
		>
			{cap === "Click" ? "Click" : cap}
		</kbd>
	);
}

function TouchChip({ gesture, size = "lg" }: { gesture: string; size?: "lg" | "sm" }) {
	const big = size === "lg";
	const lower = gesture.toLowerCase();
	const Arrow = lower.includes("left") && !lower.includes("right") ? ArrowLeft : lower.includes("right") && !lower.includes("left") ? ArrowRight : lower.includes("down") ? ArrowDown : null;
	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-amber-300 bg-amber-300/15 font-black text-amber-100 ${big ? "h-11 px-3.5 text-base" : "h-7 px-2.5 text-xs"}`}
		>
			<Hand size={big ? 20 : 14} aria-hidden />
			{Arrow ? <Arrow size={big ? 18 : 13} aria-hidden /> : null}
			{gesture}
		</span>
	);
}

/** One control: the keys (or the gesture first on a touch screen) and what it does. */
function ControlRow({ control, coarse, size }: { control: GameControl; coarse: boolean; size: "lg" | "sm" }) {
	const keys = (
		<span className="inline-flex shrink-0 flex-wrap items-center gap-1.5">
			{control.keys.map((cap, index) => (
				<span key={cap} className="inline-flex items-center gap-1.5">
					{index > 0 && !sameGroup(control.keys[index - 1], cap) ? <span className="text-xs font-bold text-white/60">or</span> : null}
					<KeyCap cap={cap} size={size} />
				</span>
			))}
		</span>
	);
	const touch = <TouchChip gesture={control.touch} size={size} />;
	if (size === "sm") {
		return (
			<li className="flex items-center gap-2 text-sm font-bold text-white/90">
				{coarse ? touch : keys}
				<span>{control.action}</span>
			</li>
		);
	}
	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-white/[.07] px-2.5 py-2 sm:px-3 sm:py-2.5">
			{coarse ? touch : keys}
			<span className="text-base font-extrabold leading-tight text-white sm:text-lg">{control.action}</span>
			{coarse ? null : <span className="basis-full text-xs font-semibold text-white/60">On a phone: {control.touch.toLowerCase()}</span>}
		</li>
	);
}

/** A screen over the stage: its words scroll if they must, its footer (the main button) never leaves the stage. */
function Overlay({ children, footer, tone = "bg-[#070b12]/80", centered = false }: { children: ReactNode; footer?: ReactNode; tone?: string; centered?: boolean }) {
	return (
		<div className={`absolute inset-0 z-10 flex flex-col text-white ${tone}`}>
			<div className={`min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 sm:px-6 sm:pt-5 ${centered ? "flex flex-col items-center text-center" : ""}`}>{children}</div>
			{footer ? <div className="flex shrink-0 justify-center px-3.5 pb-3 pt-2 sm:px-6 sm:pb-5">{footer}</div> : null}
		</div>
	);
}

export default function MicroGame({ game, Stage, initialAward, onClose }: ChapterGameProps & { Stage: ComponentType<StageProps> }) {
	const wrapperRef = useRef<HTMLElement>(null);
	const startRef = useRef<HTMLButtonElement>(null);
	const timerRef = useRef<HTMLDivElement>(null);
	const keys = useRef<StageKeys>({ held: new Set(), presses: [] });
	const [phase, setPhaseState] = useState<Phase>("ready");
	const phaseRef = useRef<Phase>("ready");
	const endedAt = useRef(0);
	const [round, setRound] = useState(0);
	const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 2 ** 30));
	const [result, setResult] = useState<StageResult | null>(null);
	const [verses, setVerses] = useState<string[] | null>(null);
	const [reducedMotion, setReducedMotion] = useState(false);
	const coarse = useCoarsePointer();
	const { muted, toggleMute } = useMuted();
	const voice = useVerseVoice(game.book, game.chapter, muted);
	const { award, saving, save, resetSaving } = useGameAward(game.slug, initialAward);

	const gameKeys = useMemo(() => new Set(game.controls.flatMap((control) => control.keys.map(keyValue).filter((key): key is string => !!key))), [game.controls]);

	const setPhase = useCallback((next: Phase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);

	useEffect(() => {
		setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
		let live = true;
		getKjvChapter(game.book, game.chapter)
			.then((chapter) => live && setVerses(chapter))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [game.book, game.chapter]);

	// Leaving the tab pauses a round.
	useEffect(() => {
		const hidden = () => {
			if (document.hidden && phaseRef.current === "playing") setPhase("paused");
		};
		document.addEventListener("visibilitychange", hidden);
		return () => document.removeEventListener("visibilitychange", hidden);
	}, [setPhase]);

	// The countdown, then the round.
	useEffect(() => {
		if (phase !== "countdown") return;
		const timer = window.setTimeout(() => setPhase("playing"), COUNTDOWN_MS);
		return () => window.clearTimeout(timer);
	}, [phase, round, setPhase]);

	const start = useCallback(() => {
		keys.current.held.clear();
		keys.current.presses.length = 0;
		if (timerRef.current) timerRef.current.style.transform = "scaleX(1)";
		setResult(null);
		resetSaving();
		if (phaseRef.current !== "ready") {
			setSeed((value) => (value * 48271) % 2147483647 || 1);
			setRound((value) => value + 1);
		}
		setPhase("countdown");
		unlockStageAudio();
		voice.say(game.voice.intro);
		wrapperRef.current?.focus({ preventScroll: true });
	}, [game.voice.intro, resetSaving, setPhase, voice]);

	const resume = useCallback(() => {
		keys.current.held.clear();
		unlockStageAudio();
		setPhase("playing");
		wrapperRef.current?.focus({ preventScroll: true });
	}, [setPhase]);

	const onTime = useCallback(
		(left: number) => {
			if (timerRef.current) timerRef.current.style.transform = `scaleX(${Math.max(0, Math.min(1, left / game.seconds))})`;
		},
		[game.seconds],
	);

	const onEnd = useCallback(
		(ended: StageResult) => {
			if (phaseRef.current !== "playing") return;
			const score = Math.max(0, Math.min(100, Math.round(ended.score)));
			const count = Math.max(0, Math.min(500, Math.round(ended.count)));
			const finished = { ...ended, score, count };
			setResult(finished);
			endedAt.current = performance.now();
			keys.current.held.clear();
			if (finished.won) {
				setPhase("won");
				voice.say(game.voice.win);
				void save({ faithKept: score, seconds: finished.seconds, swellsCleared: count });
			} else {
				setPhase("lost");
			}
		},
		[game.voice.win, save, setPhase, voice],
	);

	// After a round, focus Again so Enter or Space plays again.
	useEffect(() => {
		if (phase === "won" || phase === "lost") startRef.current?.focus({ preventScroll: true });
	}, [phase]);

	const onKeyDown = (event: ReactKeyboardEvent) => {
		const key = event.key.toLowerCase();
		const gameKey = ALWAYS_HELD.has(key) || gameKeys.has(key);
		if (phaseRef.current === "won" || phaseRef.current === "lost") {
			// A key still held from the round, or pressed just as it ended, neither scrolls the page nor presses Play again.
			const settling = performance.now() - endedAt.current < SETTLE_MS;
			if (key.startsWith("arrow") || ((gameKey || key === "enter") && (event.repeat || settling || event.target === wrapperRef.current))) event.preventDefault();
			return;
		}
		if (phaseRef.current !== "playing") {
			if (phaseRef.current === "paused" && (key === "enter" || key === " ") && event.target === wrapperRef.current) {
				event.preventDefault();
				resume();
			}
			if (phaseRef.current === "countdown" && (ALWAYS_HELD.has(key) || gameKeys.has(key))) event.preventDefault();
			return;
		}
		if (key === "escape") {
			setPhase("paused");
			return;
		}
		if (!ALWAYS_HELD.has(key) && !gameKeys.has(key)) return;
		event.preventDefault();
		if (!event.repeat) keys.current.presses.push(key);
		keys.current.held.add(key);
	};
	const onKeyUp = (event: ReactKeyboardEvent) => {
		const key = event.key.toLowerCase();
		keys.current.held.delete(key);
		// Space presses a focused button on key up: not the one that ended the round.
		if ((phaseRef.current === "won" || phaseRef.current === "lost") && key === " " && performance.now() - endedAt.current < SETTLE_MS) event.preventDefault();
	};
	const onBlur = (event: ReactFocusEvent) => {
		if (wrapperRef.current?.contains(event.relatedTarget as Node | null)) return;
		keys.current.held.clear();
	};

	const verseOf = (number: number) => verses?.[number - 1] ?? null;
	const grade = result ? gradeFor(result.score) : "bronze";
	const playing = phase === "playing";

	return (
		<section
			ref={wrapperRef}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onKeyUp={onKeyUp}
			onBlur={onBlur}
			aria-label={`${game.title}, the chapter game for ${game.reference}`}
			data-game={game.slug}
			data-phase={phase}
			className="mx-auto w-full max-w-[520px] overflow-hidden rounded-[20px] bg-[#0b0f17] text-white shadow-lg outline-none ring-amber-300/70 focus-visible:ring-2"
		>
			<div className="flex items-center gap-2 px-3 py-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[15px] font-extrabold leading-tight">{game.title}</p>
					<p className="truncate text-xs font-semibold text-white/60">{game.reference}</p>
				</div>
				{playing ? (
					<button type="button" onClick={() => setPhase("paused")} aria-label="Pause" className="flex h-11 w-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10">
						<Pause size={20} aria-hidden />
					</button>
				) : null}
				<button type="button" onClick={toggleMute} aria-label={muted ? "Turn sound on" : "Mute"} aria-pressed={muted} className="flex h-11 w-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10">
					{muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
				</button>
				{onClose ? (
					<button type="button" onClick={onClose} aria-label="Close the game" className="flex h-11 w-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10">
						<X size={20} aria-hidden />
					</button>
				) : null}
			</div>

			<div className="h-2 w-full bg-white/10" aria-hidden>
				<div ref={timerRef} className="h-full w-full origin-left bg-gradient-to-r from-amber-400 to-amber-200" style={{ transform: "scaleX(1)" }} />
			</div>

			<div className="relative aspect-square w-full select-none">
				<Stage
					key={round}
					game={game}
					seed={seed}
					paused={!playing}
					muted={muted}
					reducedMotion={reducedMotion}
					keys={keys.current}
					onTime={onTime}
					onEnd={onEnd}
				/>

				{phase === "ready" ? (
					<Overlay
						footer={
							<button
								ref={startRef}
								type="button"
								onClick={start}
								className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 text-lg font-black text-neutral-950 shadow-[0_0_0_4px_rgba(251,191,36,.3)] hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
							>
								<Play size={20} aria-hidden /> Start
							</button>
						}
					>
						<div className="flex items-center gap-2">
							<span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-black uppercase tracking-[.14em] text-neutral-950">How to play</span>
							<span className="inline-flex items-center gap-1 text-xs font-bold text-white/70">
								<Timer size={14} aria-hidden /> {game.seconds} seconds
							</span>
						</div>
						<p className="mt-1.5 text-[clamp(1.9rem,9vw,3.2rem)] font-black uppercase leading-none tracking-tight text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,.5)]">{game.command}</p>
						<ul className="mt-2.5 space-y-1.5 sm:space-y-2" aria-label="Controls">
							{game.controls.map((control) => (
								<ControlRow key={control.action} control={control} coarse={coarse} size="lg" />
							))}
						</ul>
						<ul className="mt-2.5 space-y-0.5" aria-label="Tips">
							{game.tips.map((tip) => (
								<li key={tip} className="flex gap-2 text-sm font-bold leading-snug text-white sm:text-[15px]">
									<span aria-hidden className="text-amber-300">
										★
									</span>
									{tip}
								</li>
							))}
						</ul>
					</Overlay>
				) : null}

				{phase === "countdown" ? (
					<div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/35 text-center" aria-live="assertive">
						<p className={`text-[clamp(3rem,16vw,5rem)] font-black uppercase leading-none text-amber-300 drop-shadow-[0_3px_0_rgba(0,0,0,.6)] ${reducedMotion ? "" : "animate-pulse"}`}>{game.command}</p>
						<ul className="mt-4 flex flex-wrap justify-center gap-2">
							{game.controls.map((control) => (
								<ControlRow key={control.action} control={control} coarse={coarse} size="sm" />
							))}
						</ul>
					</div>
				) : null}

				{phase === "paused" ? (
					<Overlay
						tone="bg-[#070b12]/85"
						centered
						footer={
							<button type="button" onClick={resume} className="flex min-h-12 items-center gap-2 rounded-2xl bg-amber-400 px-6 text-lg font-black text-neutral-950 hover:bg-amber-300">
								<Play size={20} aria-hidden /> Resume
							</button>
						}
					>
						<p className="mt-[18%] text-3xl font-black">Paused</p>
					</Overlay>
				) : null}

				{phase === "won" && result ? (
					<Overlay
						tone="bg-[#070b12]/85"
						centered
						footer={
							<button ref={startRef} type="button" onClick={start} className="flex min-h-12 items-center gap-2 rounded-2xl bg-amber-400 px-6 text-lg font-black text-neutral-950 hover:bg-amber-300">
								<RotateCcw size={20} aria-hidden /> Play again
							</button>
						}
					>
						<AwardMedal grade={grade} emblem={game.emblem} size={coarse ? 64 : 84} title={`${grade} medal`} />
						<p className="mt-1 text-xs font-black uppercase tracking-[.16em] text-amber-300">{game.award}</p>
						<p className="font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-tight sm:text-3xl">{game.grades[grade]}</p>
						<p className="mt-0.5 text-sm font-bold text-white/80">
							{game.measure.charAt(0).toUpperCase() + game.measure.slice(1)} {result.score}% · {result.seconds.toFixed(1)}s
						</p>
						{verseOf(game.voice.win) ? (
							<blockquote className="mt-2 max-w-md font-[family-name:var(--font-cormorant)] text-[17px] leading-[1.35] text-[#f1eadc] sm:text-[19px]">
								<sup className="mr-1 font-sans text-xs font-bold text-amber-300">{game.voice.win}</sup>
								{verseOf(game.voice.win)}
							</blockquote>
						) : null}
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => result && void save({ faithKept: result.score, seconds: result.seconds, swellsCleared: result.count })} className="text-white/70" />
					</Overlay>
				) : null}

				{phase === "lost" ? (
					<Overlay
						tone="bg-[#070b12]/85"
						centered
						footer={
							<button ref={startRef} type="button" onClick={start} className="flex min-h-12 items-center gap-2 rounded-2xl bg-amber-400 px-6 text-lg font-black text-neutral-950 hover:bg-amber-300">
								<RotateCcw size={20} aria-hidden /> Try again
							</button>
						}
					>
						<p className="text-3xl font-black text-amber-300">So close!</p>
						<p className="mt-0.5 text-sm font-bold text-white/80">Try again: you have {game.seconds} seconds.</p>
						<ul className="mt-2.5 w-full max-w-sm space-y-1.5 text-left" aria-label="Controls">
							{game.controls.map((control) => (
								<ControlRow key={control.action} control={control} coarse={coarse} size="lg" />
							))}
						</ul>
						<p className="mt-2 text-sm font-bold sm:text-[15px]">
							<span aria-hidden className="text-amber-300">
								★{" "}
							</span>
							{game.tips[0]}
						</p>
					</Overlay>
				) : null}
			</div>

			<ul className="flex min-h-12 flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-white/10 px-3 py-2" aria-label="Controls">
				{game.controls.map((control) => (
					<ControlRow key={control.action} control={control} coarse={coarse} size="sm" />
				))}
			</ul>
		</section>
	);
}
