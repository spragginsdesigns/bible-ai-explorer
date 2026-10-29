"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { Lightbulb, Pause, Play, RotateCcw, Undo2, Volume2, VolumeX } from "lucide-react";
import AwardMedal from "@/components/beta/games/AwardMedal";
import { createChartAudio, type ChartAudio } from "@/components/beta/games/star-chart-audio";
import { cellAt, chartLayout, drawChartScene } from "@/components/beta/games/star-chart-scene";
import { AwardSaveStatus, GameHeader, Passage, PassageSection, StoryScreen, chapterHref as chapterHrefFor, useGameAward, useMuted, verseText } from "@/components/beta/games/shared";
import type { ChapterGameProps } from "@/components/beta/games/types";
import { gradeFor } from "@/lib/beta/games/games-rules";
import {
	CHART_LEGS,
	CHART_LEG_COUNT,
	CHART_STEP,
	CHART_TURN_SECONDS,
	chartResult,
	isTurnable,
	newChart,
	stepChart,
	type ChartAction,
	type ChartEvent,
	type ChartResult,
	type ChartState,
} from "@/lib/beta/games/star-chart-rules";

/**
 * Star Chart (LC-17851, docs/beta/games.md), the puzzle way to play Matthew
 * 2:1-12. The chart lives in star-chart-rules.ts; this component runs it on a
 * fixed step from requestAnimationFrame, draws it (star-chart-scene.ts),
 * plays its sound (star-chart-audio.ts) and tells the passage between its
 * four legs in the passage's own words (the bundled KJV).
 */

type Screen = "intro" | "playing" | "paused" | "story" | "lost" | "won";

const ROMAN = ["I", "II", "III", "IV"];
const KIND_NAMES: Record<string, string> = {
	straight: "a straight road tile",
	bend: "a bent road tile",
	start: "where the leg begins",
	goal: "where the leg ends",
	city: "Jerusalem",
	mountain: "mountains",
	wadi: "a wadi",
	desert: "open desert",
};

/** The words between the legs: the leg just charted, the verses that follow, and the next leg's button. */
const STORIES = [
	{ kicker: "Jerusalem", verses: [3, 6] as const, next: "Chart the scribes' answer" },
	{ kicker: "To Bethlehem", verses: [7, 9] as const, next: "Follow the star" },
	{ kicker: "The house", verses: [10, 12] as const, next: "Go home another way" },
];

export default function StarChart({ game, verses, initialAward }: ChapterGameProps) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const nightRef = useRef<HTMLDivElement>(null);
	const nightLabelRef = useRef<HTMLSpanElement>(null);
	const turnsRef = useRef<HTMLSpanElement>(null);
	const statusRef = useRef<HTMLParagraphElement>(null);

	const chart = useRef<ChartState>(newChart(1));
	const screenRef = useRef<Screen>("intro");
	const pending = useRef<ChartAction[]>([]);
	const shown = useRef<number[]>([]);
	const cursor = useRef({ cell: 0, visible: false });
	const audio = useRef<ChartAudio | null>(null);
	const look = useRef({ hint: null as { cell: number; at: number } | null, connectedAt: null as number | null, status: "", statusUntil: 0 });
	const sizeRef = useRef({ width: 0, height: 0 });

	const [screen, setScreenState] = useState<Screen>("intro");
	const [leg, setLeg] = useState(0);
	const [storyLeg, setStoryLeg] = useState(0);
	const [result, setResult] = useState<ChartResult | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const { muted, toggleMute } = useMuted(useCallback((next: boolean) => audio.current?.setMuted(next), []));
	const { award, saving, save: saveRun, resetSaving } = useGameAward(game.slug, initialAward);

	const setScreen = useCallback((next: Screen) => {
		screenRef.current = next;
		setScreenState(next);
	}, []);

	const say = useCallback((text: string, seconds = 3.2) => {
		look.current.status = text;
		look.current.statusUntil = performance.now() / 1000 + seconds;
	}, []);

	const handleEvent = useCallback(
		(event: ChartEvent, now: number) => {
			const sound = audio.current;
			const buzz = (pattern: number | number[]) => navigator.vibrate?.(pattern);
			switch (event.type) {
				case "turn":
				case "undo":
					sound?.quill();
					break;
				case "hint":
					sound?.hint();
					look.current.hint = { cell: event.cell, at: now };
					setAnnouncement("A hint turned one tile of the road into place.");
					break;
				case "astray":
					sound?.astray();
					buzz(30);
					if (event.reason === "star") {
						say("That road reaches the house but not beneath the star. Pass under every star mark.", 4.5);
						setAnnouncement("The road reaches the house but does not pass beneath the star.");
					} else {
						say("That way goes back through Jerusalem. Chart another way.", 4.5);
						setAnnouncement("That way goes back through Jerusalem. Chart another way.");
					}
					break;
				case "connected":
					sound?.bell();
					buzz(20);
					look.current.connectedAt = now;
					look.current.statusUntil = 0;
					setAnnouncement(`The road is charted: ${CHART_LEGS[event.leg].from} to ${CHART_LEGS[event.leg].to}.`);
					break;
				case "charted":
					if (event.leg === 2) sound?.chord();
					if (event.leg < CHART_LEG_COUNT - 1) {
						setStoryLeg(event.leg);
						setScreen("story");
					}
					break;
				case "dawn":
					sound?.dawn();
					buzz([60, 40, 60]);
					setAnnouncement("Dawn came and the stars faded before the way was charted.");
					setScreen("lost");
					break;
				case "finished": {
					const run = chartResult(chart.current);
					if (run) {
						setResult(run);
						void saveRun(run);
					}
					setAnnouncement("They departed into their own country another way. The chart is finished.");
					setScreen("won");
					break;
				}
				case "next":
					break;
			}
		},
		[saveRun, say, setScreen],
	);

	// The loop: fixed simulation steps, one draw per frame, the HUD written straight to the DOM.
	useEffect(() => {
		const canvas = canvasRef.current;
		const stage = stageRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !stage || !context) return;
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const serif = `${getComputedStyle(document.body).getPropertyValue("--font-cormorant").trim() || "'Cormorant Garamond'"}, Georgia, serif`;
		const resize = () => {
			const rect = stage.getBoundingClientRect();
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			sizeRef.current = { width: rect.width, height: rect.height };
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
		let written = "";
		const events: ChartEvent[] = [];
		const tick = (time: number) => {
			frame = requestAnimationFrame(tick);
			const now = time / 1000;
			const elapsed = Math.min(0.1, (time - last) / 1000);
			last = time;
			const state = chart.current;
			if (screenRef.current === "playing") {
				carry += elapsed;
				while (carry >= CHART_STEP) {
					stepChart(state, pending.current.splice(0), events);
					carry -= CHART_STEP;
				}
				for (const event of events.splice(0)) handleEvent(event, now);
			}

			// Each tile turns toward where the chart says it is, at the turn's own pace.
			const turned = shown.current;
			for (let i = 0; i < state.cells.length; i++) {
				const target = state.cells[i].spin;
				const at = turned[i] ?? target;
				const gap = target - at;
				turned[i] = reduceMotion || Math.abs(gap) < 0.01 ? target : at + Math.sign(gap) * Math.min(Math.abs(gap), elapsed * Math.max(1 / CHART_TURN_SECONDS, Math.abs(gap) * 5));
			}

			const { width, height } = sizeRef.current;
			drawChartScene(context, {
				width,
				height,
				state,
				now,
				shown: turned,
				cursor: cursor.current.cell,
				showCursor: cursor.current.visible,
				reduceMotion,
				serif,
				hint: look.current.hint,
				connectedAt: look.current.connectedAt,
			});

			const night = state.nightTotal ? Math.max(0, state.night / state.nightTotal) : 1;
			if (nightRef.current) {
				nightRef.current.style.width = `${night * 100}%`;
				nightRef.current.dataset.low = night < 0.3 ? "true" : "false";
			}
			if (nightLabelRef.current) nightLabelRef.current.textContent = night < 0.3 ? "Dawn is near" : "Night left";
			if (turnsRef.current) turnsRef.current.textContent = `${state.legTurns} ${state.legTurns === 1 ? "turn" : "turns"} · fewest ${state.par}`;
			if (statusRef.current) {
				const text = now < look.current.statusUntil ? look.current.status : "";
				if (statusRef.current.textContent !== text) statusRef.current.textContent = text;
				statusRef.current.style.opacity = text ? "1" : "0";
			}
			// What the chart is right now, for a test or an assistive tool to read.
			const layout = chartLayout(width, height, CHART_LEGS[state.leg]);
			const board = `${state.leg}|${state.phase}|${state.cells.map((cell) => cell.rot).join("")}|${layout.x0.toFixed(1)},${layout.y0.toFixed(1)},${layout.tile.toFixed(1)}|${cursor.current.cell}`;
			if (board !== written) {
				written = board;
				stage.dataset.leg = String(state.leg);
				stage.dataset.phase = state.phase;
				stage.dataset.rotations = state.cells.map((cell) => cell.rot).join("");
				stage.dataset.board = `${layout.x0.toFixed(1)},${layout.y0.toFixed(1)},${layout.tile.toFixed(1)},${layout.cols},${layout.rows}`;
				stage.dataset.cursor = String(cursor.current.cell);
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

	const focusStage = useCallback(() => {
		const stage = stageRef.current;
		stage?.focus({ preventScroll: true });
		// The stage and the controls under it, together on a phone.
		if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: "start" });
		else if (stage && controlsRef.current && controlsRef.current.getBoundingClientRect().bottom > window.innerHeight) stage.scrollIntoView({ block: "start" });
	}, []);

	const enterLegView = useCallback((index: number) => {
		shown.current = chart.current.cells.map((cell) => cell.spin);
		const first = chart.current.cells.findIndex((cell) => isTurnable(cell));
		cursor.current = { cell: first, visible: cursor.current.visible };
		look.current = { hint: null, connectedAt: null, status: "", statusUntil: 0 };
		setLeg(index);
	}, []);

	const start = useCallback(() => {
		chart.current = newChart(Math.floor(Math.random() * 2 ** 31));
		pending.current = [];
		enterLegView(0);
		setResult(null);
		resetSaving();
		if (!audio.current) audio.current = createChartAudio(muted);
		audio.current?.resume();
		audio.current?.rustle();
		setAnnouncement(`${CHART_LEGS[0].title}. ${CHART_LEGS[0].objective}`);
		setScreen("playing");
		focusStage();
	}, [enterLegView, focusStage, muted, resetSaving, setScreen]);

	const continueChart = useCallback(() => {
		const state = chart.current;
		if (state.phase !== "between") return;
		stepChart(state, [{ type: "next" }]);
		pending.current = [];
		enterLegView(state.leg);
		audio.current?.rustle();
		setAnnouncement(`Leg ${state.leg + 1} of ${CHART_LEG_COUNT}: ${CHART_LEGS[state.leg].title}. ${CHART_LEGS[state.leg].objective}`);
		setScreen("playing");
		focusStage();
	}, [enterLegView, focusStage, setScreen]);

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

	const act = useCallback((action: ChartAction) => {
		if (screenRef.current !== "playing" || chart.current.phase !== "charting") return;
		pending.current.push(action);
	}, []);

	const describe = useCallback((index: number) => {
		const state = chart.current;
		const def = CHART_LEGS[state.leg];
		const cell = state.cells[index];
		const where = `Row ${Math.floor(index / def.cols) + 1}, column ${(index % def.cols) + 1}`;
		const onRoad = state.route.includes(index) ? ", joined to the road" : "";
		return `${where}: ${cell?.kind === "start" ? def.from : cell?.kind === "goal" ? def.to : KIND_NAMES[cell?.kind ?? "desert"]}${onRoad}.`;
	}, []);

	// Keyboard: arrows move the cursor, Space or Enter turns its tile, U or Z undoes, H hints, P or Escape pauses.
	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			const current = screenRef.current;
			if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
			const key = event.key.toLowerCase();
			if (current === "playing") {
				const def = CHART_LEGS[chart.current.leg];
				const move = { arrowup: -def.cols, arrowdown: def.cols, arrowleft: -1, arrowright: 1 }[key];
				if (move !== undefined) {
					const at = cursor.current.cell;
					const row = Math.floor(at / def.cols);
					const col = at % def.cols;
					const nextRow = Math.min(def.rows - 1, Math.max(0, row + (key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0)));
					const nextCol = Math.min(def.cols - 1, Math.max(0, col + (key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0)));
					cursor.current = { cell: nextRow * def.cols + nextCol, visible: true };
					setAnnouncement(describe(cursor.current.cell));
				} else if (key === " " || key === "enter") {
					// A focused button keeps Enter and Space for itself.
					if (event.target instanceof HTMLButtonElement) return;
					cursor.current.visible = true;
					if (!event.repeat) act({ type: "turn", cell: cursor.current.cell });
				} else if (key === "u" || key === "z" || key === "backspace") act({ type: "undo" });
				else if (key === "h") act({ type: "hint" });
				else if (key === "p" || key === "escape") pause();
				else return;
				event.preventDefault();
			} else if (current === "paused" && (key === "p" || key === "escape")) {
				event.preventDefault();
				resume();
			}
		};
		window.addEventListener("keydown", down);
		return () => window.removeEventListener("keydown", down);
	}, [act, describe, pause, resume]);

	const tap = useCallback(
		(event: ReactPointerEvent<HTMLCanvasElement>) => {
			if (screenRef.current !== "playing") return;
			event.preventDefault();
			const rect = event.currentTarget.getBoundingClientRect();
			const { width, height } = sizeRef.current;
			const index = cellAt(chartLayout(width, height, CHART_LEGS[chart.current.leg]), event.clientX - rect.left, event.clientY - rect.top);
			if (index < 0) return;
			cursor.current = { cell: index, visible: event.pointerType !== "touch" && cursor.current.visible };
			if (isTurnable(chart.current.cells[index])) act({ type: "turn", cell: index });
		},
		[act],
	);

	const playing = screen === "playing";
	const grade = result ? gradeFor(result.faithKept) : null;
	const chapterHref = chapterHrefFor(game);
	const legDef = CHART_LEGS[leg];
	const story = STORIES[storyLeg];
	const overlay = "bg-[#0b0f2e]/85 text-[#f3e9d2]";
	const primary = "inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1d1a12] hover:bg-[#edc47c]";
	const secondary = "inline-flex min-h-12 items-center rounded-full border border-white/25 px-5 font-bold";
	const control =
		"flex min-h-14 select-none items-center justify-center gap-2 rounded-2xl border text-sm font-bold transition-colors disabled:opacity-40 [-webkit-touch-callout:none] [-webkit-user-select:none]";

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
				aria-label={`${game.title}, a puzzle of ${game.reference}`}
				className="relative mt-3 aspect-[4/5] w-full scroll-mt-3 select-none overflow-hidden rounded-[22px] border border-black/[.09] bg-[#0b0f2e] outline-none sm:aspect-[16/10] dark:border-white/[.09]"
			>
				<canvas ref={canvasRef} aria-hidden onPointerDown={tap} onContextMenu={(event) => event.preventDefault()} className="absolute inset-0 h-full w-full touch-manipulation" />

				{/* HUD */}
				<div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-3 transition-opacity ${playing || screen === "paused" ? "opacity-100" : "opacity-0"}`}>
					<div className="min-w-0 flex-1">
						<div className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[.12em] text-[#f3e9d2] sm:tracking-[.16em]">
							<span className="whitespace-nowrap">
								Leg {ROMAN[leg]} of IV
								<span className="hidden sm:inline">
									{" · "}
									<span ref={nightLabelRef}>Night left</span>
								</span>
							</span>
							<span ref={turnsRef} className="whitespace-nowrap normal-case tracking-normal text-[#d9cfb8]">
								0 turns
							</span>
						</div>
						<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/15">
							<div ref={nightRef} className="h-full rounded-full bg-[#e5b664] data-[low=true]:bg-[#e79a6a]" style={{ width: "100%" }} />
						</div>
					</div>
					<div className="pointer-events-auto flex gap-1.5">
						<button type="button" onClick={toggleMute} aria-label={muted ? "Turn sound on" : "Turn sound off"} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-[#f3e9d2] hover:bg-black/50">
							{muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
						</button>
						{playing && (
							<button type="button" onClick={pause} aria-label="Pause" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-[#f3e9d2] hover:bg-black/50">
								<Pause size={20} aria-hidden />
							</button>
						)}
					</div>
				</div>

				{/* The leg's aim along the foot, and a word when the road goes astray. */}
				<div className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-3 pb-2.5 text-center transition-opacity ${playing ? "opacity-100" : "opacity-0"}`}>
					<p ref={statusRef} className="rounded-full bg-[#5a2316]/90 px-3 py-1 text-xs font-bold text-[#f8e6d2] opacity-0 transition-opacity sm:text-sm" />
					<p className="text-xs font-semibold leading-5 text-[#e6dcc4] sm:text-sm">{legDef.objective}</p>
				</div>

				{screen === "intro" && (
					<StoryScreen
						className={overlay}
						actions={
							<>
								<button type="button" onClick={start} className={primary}>
									<Play size={18} aria-hidden /> Unroll the chart
								</button>
								{award && (
									<span className="inline-flex items-center gap-2 text-sm font-bold text-[#d9cfb8]">
										<AwardMedal grade={award.grade} emblem={game.emblem} size={36} /> Your award: {game.grades[award.grade]}
									</span>
								)}
							</>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">From the east</p>
						<Passage verses={verseText(verses, 1, 2)} className="mt-2 max-w-2xl" />
						<ul className="mt-3 max-w-2xl space-y-1 text-sm leading-6 text-[#d9cfb8]">
							<li>
								<b className="text-[#f3e9d2]">Chart the way in four legs.</b> Tap a tile to turn it a quarter turn (or move with the arrow keys and press Space) until one unbroken road joins the start of the leg to its end.
							</li>
							<li>
								<b className="text-[#f3e9d2]">Chart it before dawn.</b> Every turn spends a little of the night, and the night passes while you think.
							</li>
							<li>
								<b className="text-[#f3e9d2]">Kept to the star:</b> the fewest turns keep the most. Undo turns your last tile back; a Hint turns one tile into place but costs some of the score.
							</li>
						</ul>
					</StoryScreen>
				)}

				{screen === "paused" && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0b0f2e]/75 p-6 text-center text-[#f3e9d2]">
						<p className="font-[family-name:var(--font-cormorant)] text-3xl font-semibold">Paused</p>
						<button type="button" onClick={resume} className={primary}>
							<Play size={18} aria-hidden /> Keep charting
						</button>
					</div>
				)}

				{screen === "story" && (
					<StoryScreen
						className={overlay}
						actions={
							<button type="button" onClick={continueChart} autoFocus className={primary}>
								<Play size={18} aria-hidden /> {story.next}
							</button>
						}
					>
						<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">
							Leg {ROMAN[storyLeg]} charted · {story.kicker}
						</p>
						<Passage verses={verseText(verses, story.verses[0], story.verses[1])} className="mt-2 max-w-2xl" />
						{storyLeg === 2 && (
							<p className="mt-3 max-w-2xl text-sm leading-6 text-[#d9cfb8]">
								<b className="text-[#f3e9d2]">The last leg:</b> chart a road to their own country that does not pass back through Jerusalem.
							</p>
						)}
					</StoryScreen>
				)}

				{screen === "lost" && (
					<StoryScreen
						centered
						className="bg-gradient-to-t from-[#5c3433]/90 via-[#1c1a3c]/85 to-[#0b0f2e]/85 text-[#f3e9d2]"
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
							<p className="text-xs font-bold uppercase tracking-[.2em] text-[#e5b664]">Dawn</p>
							<p className="mt-1 font-[family-name:var(--font-cormorant)] text-[1.9rem] font-semibold leading-tight">The stars faded before the way was charted</p>
							<p className="mt-2 text-sm text-[#d9cfb8]">Nothing is recorded. Unroll the chart and try again, with fewer turns.</p>
							<Passage verses={verseText(verses, 2)} className="mt-3 max-w-xl text-left" />
						</div>
					</StoryScreen>
				)}

				{screen === "won" && result && grade && (
					<StoryScreen
						centered
						className={overlay}
						actions={
							<>
								<button type="button" onClick={start} className={primary}>
									<RotateCcw size={18} aria-hidden /> Chart it again
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
						<p className="mt-1 text-sm text-[#d9cfb8]">
							Kept to the star {result.faithKept}% · {result.seconds}s · {result.swellsCleared} {result.swellsCleared === 1 ? "turn" : "turns"} of the chart
							{chart.current.hints > 0 && ` · ${chart.current.hints} ${chart.current.hints === 1 ? "hint" : "hints"}`}
						</p>
						<AwardSaveStatus game={game} award={award} saving={saving} onRetry={() => void saveRun(result)} />
						<Passage verses={verseText(verses, 11)} className="mt-3 max-w-xl pb-2 text-left" />
					</StoryScreen>
				)}
			</div>

			<div ref={controlsRef} className="mt-3 grid grid-cols-2 gap-2.5" aria-label="Controls">
				<button
					type="button"
					disabled={!playing}
					onClick={() => act({ type: "undo" })}
					// A click keeps the keyboard on the chart, so Space still turns the tile under the cursor.
					onMouseDown={(event) => event.preventDefault()}
					className={`${control} border-black/[.09] bg-white/35 active:bg-amber-500/20 dark:border-white/[.09] dark:bg-white/[.04]`}
				>
					<Undo2 size={20} aria-hidden /> Undo
				</button>
				<button
					type="button"
					disabled={!playing}
					onClick={() => act({ type: "hint" })}
					// A click keeps the keyboard on the chart, so Space still turns the tile under the cursor.
					onMouseDown={(event) => event.preventDefault()}
					className={`${control} border-amber-600/40 bg-amber-500/15 text-amber-900 active:bg-amber-500/30 dark:border-[#e5b664]/40 dark:text-[#e5b664]`}
				>
					<Lightbulb size={20} aria-hidden /> Hint <span className="font-semibold opacity-75">(costs score)</span>
				</button>
			</div>
			<p className="mt-2 hidden px-1 text-sm text-neutral-600 sm:block dark:text-[#bbb3a7]">
				Keyboard: arrow keys move the cursor, Space or Enter turns its tile, U to undo, H for a hint, P to pause.
			</p>
			<p className="sr-only" role="status" aria-live="polite">
				{announcement}
			</p>

			<PassageSection game={game} verses={verses} />
		</main>
	);
}
