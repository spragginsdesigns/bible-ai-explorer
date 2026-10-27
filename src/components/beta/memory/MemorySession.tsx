"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { LearnResult } from "@/components/learn/learn";
import {
	MEMORY_EXERCISES,
	MEMORY_EXERCISE_LABELS,
	defaultExercise,
	describeNextReview,
	unitSeed,
	unitStage,
	type MemoryExercise as ExerciseType,
	type MemoryGrade,
} from "@/lib/beta/memory/memory-rules";
import { MemoryExercise, type ExerciseOutcome } from "./MemoryExercise";
import {
	browserTimezone,
	fetchSession,
	localDay,
	sendReview,
	writeQuestions,
	type MemorySession as SessionData,
	type MemorySessionUnit,
} from "./memoryClient";

const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
const PRIMARY =
	"min-h-12 w-full rounded-full bg-[#24281f] px-5 text-base font-bold text-white transition-opacity disabled:opacity-40 dark:bg-[#e5b664] dark:text-[#1c2118]";
const SECONDARY =
	"min-h-12 w-full rounded-full border border-black/15 px-5 text-base font-bold transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/[.04]";

/** A unit waits this many others before it comes back within the session. */
const REQUEUE_GAP = 2;

/** What was on screen when the answer came in, kept while the result shows. */
interface Shown {
	unit: MemorySessionUnit;
	type: ExerciseType;
	stage: number;
	seed: number;
}

interface Feedback {
	shown: Shown;
	grade: MemoryGrade;
	detail: string;
	/** Set once the review is saved: what Learn a verse's schedule now says. */
	next: string | null;
	/** The unit still has a step today. */
	again: boolean;
	newlyKnown: boolean;
	saving: boolean;
	error: string | null;
}

function unitText(unit: MemorySessionUnit): string {
	return unit.cards.map((item) => item.text).join(" ");
}

const GRADE_TITLE: Record<MemoryGrade, string> = { right: "Right", close: "Nearly", wrong: "Not quite" };

/**
 * Today's review (docs/beta/memory.md): due units one at a time, each in the
 * exercise its stage calls for, every answer graded on the spot and sent to
 * Learn a verse's own review route as "good" or "again". A unit with a step
 * left today comes back later in the session, as Learn a verse's ladder says.
 */
export default function MemorySession() {
	const [session, setSession] = useState<SessionData | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [units, setUnits] = useState<Record<string, MemorySessionUnit>>({});
	const [queue, setQueue] = useState<string[]>([]);
	const [cleared, setCleared] = useState<string[]>([]);
	const [firstTry, setFirstTry] = useState<Record<string, boolean>>({});
	const [reviews, setReviews] = useState(0);
	const [exercise, setExercise] = useState<ExerciseType | null>(null);
	const [round, setRound] = useState(0);
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const [writing, setWriting] = useState(false);
	const [writeError, setWriteError] = useState<string | null>(null);
	const resultRef = useRef<HTMLElement | null>(null);

	const load = useCallback(() => {
		setLoadError(null);
		fetchSession()
			.then((data) => {
				setSession(data);
				setUnits(Object.fromEntries(data.units.map((unit) => [unit.key, unit])));
				setQueue(data.units.map((unit) => unit.key));
				setCleared([]);
				setFirstTry({});
				setReviews(0);
				setFeedback(null);
				setExercise(null);
				setRound((value) => value + 1);
			})
			.catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load your review."));
	}, []);
	useEffect(load, [load]);

	const live = queue.length > 0 ? units[queue[0]] : undefined;
	const liveDue = useMemo(() => live?.cards.filter((item) => item.due) ?? [], [live]);
	const liveStage = unitStage(liveDue);
	const liveSeed = unitSeed(liveDue);
	const liveType: ExerciseType = exercise ?? defaultExercise(liveStage, liveSeed, Boolean(live?.questions?.length));
	// While a result shows, the exercise stays as it was answered, even though the
	// review has already moved the card on.
	const shown: Shown | null = feedback?.shown ?? (live ? { unit: live, type: liveType, stage: liveStage, seed: liveSeed } : null);
	const current = shown?.unit;
	const total = session?.units.length ?? 0;

	useEffect(() => {
		if (feedback?.next || feedback?.grade === "close") resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [feedback?.next, feedback?.grade]);

	const send = async (result: LearnResult, outcome: ExerciseOutcome, at: Shown) => {
		const current = at.unit;
		setFeedback({ shown: at, ...outcome, next: null, again: false, newlyKnown: false, saving: true, error: null });
		const today = localDay(new Date());
		const timezone = browserTimezone();
		try {
			const updated = [...current.cards];
			let newlyKnown = false;
			for (const [index, item] of updated.entries()) {
				if (!item.due) continue;
				const saved = await sendReview(item, result);
				newlyKnown ||= !item.knownAt && Boolean(saved.knownAt);
				updated[index] = {
					...item,
					revision: saved.revision,
					stage: saved.stage,
					intervalDays: saved.intervalDays,
					dueAt: saved.dueAt,
					knownAt: saved.knownAt,
					due: localDay(saved.dueAt, timezone) <= today,
				};
			}
			const next = { ...current, cards: updated };
			setUnits((old) => ({ ...old, [current.key]: next }));
			setReviews((count) => count + 1);
			setFirstTry((old) => (current.key in old ? old : { ...old, [current.key]: result === "good" }));
			const stillDue = updated.filter((item) => item.due);
			const reviewed = updated.filter((_, index) => current.cards[index].due);
			const describe = stillDue.length > 0
				? describeNextReview({ stage: unitStage(stillDue), dueDay: today }, today)
				: describeNextReview({ stage: 3, dueDay: reviewed.map((item) => localDay(item.dueAt, timezone)).sort()[0] }, today);
			const date = describe.later
				? ` (${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: timezone }).format(new Date(reviewed.map((item) => item.dueAt).sort()[0]))})`
				: "";
			setFeedback({ shown: at, ...outcome, next: `${describe.text}${date}`, again: stillDue.length > 0, newlyKnown, saving: false, error: null });
		} catch (error) {
			setFeedback({ shown: at, ...outcome, next: null, again: false, newlyKnown: false, saving: false, error: error instanceof Error ? error.message : "The review was not saved." });
		}
	};

	const answer = (outcome: ExerciseOutcome) => {
		if (!shown) return;
		if (outcome.grade === "close") {
			setFeedback({ shown, ...outcome, next: null, again: false, newlyKnown: false, saving: false, error: null });
			return;
		}
		void send(outcome.grade === "right" ? "good" : "again", outcome, shown);
	};

	const advance = () => {
		if (!current || !feedback) return;
		setQueue((old) => {
			const [head, ...rest] = old;
			if (!feedback.again) return rest;
			const at = Math.min(REQUEUE_GAP, rest.length);
			return [...rest.slice(0, at), head, ...rest.slice(at)];
		});
		if (!feedback.again) setCleared((old) => [...old, current.key]);
		setFeedback(null);
		setExercise(null);
		setWriteError(null);
		setRound((value) => value + 1);
	};

	const askForQuestions = async () => {
		if (!current) return;
		setWriting(true);
		setWriteError(null);
		try {
			const { questions } = await writeQuestions(current.reference);
			setUnits((old) => ({ ...old, [current.key]: { ...old[current.key], questions } }));
		} catch (error) {
			setWriteError(error instanceof Error ? error.message : "Questions could not be written.");
		} finally {
			setWriting(false);
		}
	};

	const shell = (children: React.ReactNode) => (
		<main className="mx-auto w-full max-w-2xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">{children}</main>
	);

	if (loadError) {
		return shell(
			<div role="alert" className={`${card} p-5`}>
				<p className="font-bold">{loadError}</p>
				<button type="button" onClick={load} className={`${SECONDARY} mt-4`}>Try again</button>
			</div>,
		);
	}
	if (!session) return shell(<p role="status" className="py-16 text-center text-neutral-600 dark:text-[#bbb3a7]">Loading your review...</p>);

	const done = cleared.length;
	const header = (
		<div className="flex items-center gap-3">
			<Link href="/beta/learn/memory" aria-label="End review" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/5">
				<X size={22} aria-hidden />
			</Link>
			<div
				className="flex h-2.5 flex-1 gap-1"
				role="progressbar"
				aria-label="Verses done today"
				aria-valuemin={0}
				aria-valuemax={total}
				aria-valuenow={done}
			>
				{Array.from({ length: Math.max(total, 1) }, (_, index) => (
					<span key={index} className={`h-full flex-1 rounded-full ${index < done ? "bg-[#e5b664]" : "bg-black/[.08] dark:bg-white/[.1]"}`} />
				))}
			</div>
			<span className="shrink-0 text-sm font-bold tabular-nums text-neutral-700 dark:text-[#d9d1c3]">
				{done}/{total}
			</span>
		</div>
	);

	if (!current || !shown) {
		const right = Object.values(firstTry).filter(Boolean).length;
		return shell(
			<>
				{header}
				<section aria-labelledby="memory-done" className={`${card} mt-6 p-6 text-center`}>
					<span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118]" aria-hidden>
						<Check size={28} />
					</span>
					<h1 id="memory-done" className="mt-4 font-[family-name:var(--font-cormorant)] text-[2.2rem] font-semibold leading-tight">
						{total === 0 ? "Nothing is due" : "Today's review is done"}
					</h1>
					<p className="mt-2 text-base leading-7 text-neutral-700 dark:text-[#d9d1c3]">
						{total === 0
							? "Your verses will be back when they are due."
							: `${total} ${total === 1 ? "card" : "cards"}, ${reviews} answers, ${right} right the first time.${session.dueUnits > total ? ` ${session.dueUnits - total} more ${session.dueUnits - total === 1 ? "is" : "are"} due; start another round when you are ready.` : ""}`}
					</p>
					<div className="mt-6 grid gap-2.5 sm:grid-cols-2">
						<Link href="/beta/learn/memory" className={`${PRIMARY} flex items-center justify-center`}>Back to Scripture Memory</Link>
						<Link href="/bible/learn" className={`${SECONDARY} flex items-center justify-center`}>Open Learn a verse</Link>
					</div>
					{session.dueUnits > total && total > 0 ? (
						<button type="button" onClick={load} className="mt-4 min-h-11 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664]">
							Start another round
						</button>
					) : null}
				</section>
			</>,
		);
	}

	const { type, stage, seed } = shown;
	const text = unitText(current);
	const translation = [...new Set(current.cards.map((item) => item.translation))].join(" / ");
	const answered = feedback !== null;

	return shell(
		<>
			{header}
			<section aria-label="Exercise" className={`${card} mt-5 px-5 pb-6 pt-5 sm:px-7`}>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className={eyebrow}>{MEMORY_EXERCISE_LABELS[type]}</p>
					<p className="text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
						Step {Math.min(stage, 3) + 1} of 4 · {session.dueUnits} due today
					</p>
				</div>
				<h1 className="mt-2 text-sm font-bold uppercase tracking-[.14em] text-amber-800 dark:text-[#e5b664]">
					{current.reference} · {translation}
				</h1>
				<div className="mt-4">
					<MemoryExercise
						key={`${current.key}:${round}:${type}`}
						type={type}
						text={text}
						reference={current.reference}
						stage={stage}
						seed={seed}
						pool={current.pool}
						questions={current.questions}
						answered={answered}
						disabled={Boolean(feedback?.saving)}
						onAnswer={answer}
						onWriteQuestions={() => void askForQuestions()}
						writingQuestions={writing}
					/>
					{writeError ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700 dark:text-rose-300">{writeError}</p> : null}
				</div>
			</section>

			{feedback ? (
				<section
					ref={resultRef}
					aria-live="polite"
					aria-label="Result"
					className={`mt-4 rounded-[22px] border p-5 sm:px-7 ${
						feedback.grade === "right"
							? "border-emerald-700/25 bg-emerald-500/10 dark:border-emerald-300/25"
							: feedback.grade === "close"
								? "border-amber-700/30 bg-amber-500/10 dark:border-amber-300/30"
								: "border-rose-700/25 bg-rose-500/10 dark:border-rose-300/25"
					}`}
				>
					<p className="flex items-center gap-2 text-lg font-bold">
						{feedback.grade === "right" ? <Check size={20} aria-hidden /> : <RotateCcw size={18} aria-hidden />}
						{GRADE_TITLE[feedback.grade]}
						<span className="text-sm font-semibold text-neutral-700 dark:text-[#d9d1c3]">· {feedback.detail}</span>
					</p>
					<blockquote className="mt-3 font-[family-name:var(--font-cormorant)] text-[1.35rem] leading-snug">
						{current.cards.map((item) => (
							<span key={item.id}>
								{current.cards.length > 1 ? <sup className="mr-0.5 font-sans text-[0.6em] font-bold text-neutral-500">{item.verse}</sup> : null}
								{item.text}{" "}
							</span>
						))}
					</blockquote>
					<p className="mt-1 text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-[#b3ad9e]">{current.reference} · {translation}</p>
					{feedback.grade === "close" && !feedback.next && !feedback.saving && !feedback.error ? (
						<>
							<p className="mt-4 text-base">A slip or two. Was it a typo, or do you want this one again?</p>
							<div className="mt-3 grid gap-2.5 sm:grid-cols-2">
								<button type="button" onClick={() => void send("good", feedback, feedback.shown)} className={PRIMARY}>Count it as remembered</button>
								<button type="button" onClick={() => void send("again", feedback, feedback.shown)} className={SECONDARY}>Practise it again</button>
							</div>
						</>
					) : null}
					{feedback.saving ? <p role="status" className="mt-4 text-sm font-bold">Saving to your schedule...</p> : null}
					{feedback.error ? (
						<div role="alert" className="mt-4">
							<p className="text-sm font-bold text-rose-700 dark:text-rose-300">{feedback.error}</p>
							<button type="button" onClick={load} className={`${SECONDARY} mt-3`}>Reload the review</button>
						</div>
					) : null}
					{feedback.next ? (
						<>
							<p className="mt-4 text-base font-bold">{feedback.next}</p>
							{feedback.newlyKnown ? <p className="mt-1 text-sm">It now counts among the verses you know.</p> : null}
							<button type="button" autoFocus onClick={advance} className={`${PRIMARY} mt-4`}>
								Continue
							</button>
						</>
					) : null}
				</section>
			) : null}

			<div className="mt-5">
				<p className="text-center text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">Try another way</p>
				<div role="group" aria-label="Exercise type" className="mt-2 flex flex-wrap justify-center gap-2">
					{MEMORY_EXERCISES.map((item) => (
						<button
							key={item}
							type="button"
							aria-pressed={item === type}
							disabled={answered}
							onClick={() => {
								setExercise(item);
								setRound((value) => value + 1);
							}}
							className={`min-h-11 rounded-full border px-3.5 text-sm font-bold transition-colors disabled:opacity-40 ${
								item === type
									? "border-amber-700/50 bg-amber-500/15 text-amber-900 dark:border-amber-300/50 dark:text-amber-200"
									: "border-black/10 text-neutral-700 hover:bg-black/[.04] dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/[.04]"
							}`}
						>
							{MEMORY_EXERCISE_LABELS[item]}
						</button>
					))}
				</div>
			</div>
		</>,
	);
}
