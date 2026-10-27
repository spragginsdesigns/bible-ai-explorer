"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Check, ChevronDown, NotebookPen, RotateCcw, X } from "lucide-react";
import { AddLearnButton } from "@/components/learn/AddLearnButton";
import { saveReflectionNote } from "@/components/quiz/quizClient";
import type { SessionKind } from "@/lib/beta/paths/paths-types";
import { answeredCount, conceptTitle, draftResponse, emptyDraft, isRetry, localGrade, type Draft } from "@/lib/beta/paths/player-rules";
import type { AnswerResult, ExerciseView, SessionSummary, SessionView } from "@/lib/beta/paths/view-types";
import { BlankExercise, ChoiceExercise, FeedbackPanel, MatchExercise, OrderExercise, type Feedback } from "./ExerciseViews";
import { PathsRequestError, postAnswer, startSession, writeCurriculumLesson } from "./pathsClient";
import { CARD, CONCEPT_LABEL, EYEBROW, FOCUS, GOLD_BUTTON, MUTED, PATHS_BASE, QUIET_BUTTON, SERIF, TEXT_LINK, lessonHref, pathHref, reviewHref } from "./ui";

type Phase =
	| { name: "loading"; message: string }
	| { name: "error"; message: string; back: boolean }
	| { name: "reading" }
	| { name: "question" }
	| { name: "reflection" }
	| { name: "summary" };

interface Checked {
	feedback: Feedback;
	again: boolean;
	/** The server's answer, once it has recorded it. */
	result: AnswerResult | null;
	saveError: string | null;
}

const TYPE_LABEL: Record<ExerciseView["type"], string> = {
	choice: "Choose the answer",
	blank: "Fill in the blank",
	order: "Put them in order",
	match: "Match each verse to its truth",
};

export interface LessonPlayerProps {
	pathId: string;
	pathTitle: string;
	kind: SessionKind;
	target: string;
	title: string;
	/** A personal curriculum lesson whose questions are written the first time it is opened. */
	needsWriting: boolean;
	reading: string | null;
	/** Where this path's pages live; SureWord Academy (LC-17660) serves courses from /beta/learn/academy. */
	base?: string;
	/** Where leaving goes; the path's map by default. */
	leaveHref?: string;
	/** After a lesson's questions, the next step of a course lesson (its tutor and memory parts) instead of the next lesson. */
	continueTo?: { href: string; label: string };
}

/**
 * One Learning Paths session (LC-17648): a lesson (read the passage, answer,
 * reflect), a unit checkpoint, or a review of what was missed. Feedback is
 * instant and always shows the verse; the server grades and records every
 * answer, so leaving and coming back picks up at the same question.
 */
export default function LessonPlayer(props: LessonPlayerProps) {
	const { pathId, pathTitle, kind, target, title, needsWriting, reading, base = PATHS_BASE, continueTo } = props;
	const leaveHref = props.leaveHref ?? pathHref(pathId, base);
	const router = useRouter();
	const [phase, setPhase] = useState<Phase>({ name: "loading", message: "Opening your lesson..." });
	const [session, setSession] = useState<SessionView | null>(null);
	const [queue, setQueue] = useState<string[]>([]);
	const [index, setIndex] = useState(0);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [checked, setChecked] = useState<Checked | null>(null);
	const [summary, setSummary] = useState<SessionSummary | null>(null);
	const [matchTarget, setMatchTarget] = useState<number | null>(null);
	const [showPassage, setShowPassage] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const promptRef = useRef<HTMLHeadingElement>(null);
	const wroteRef = useRef(false);

	const load = useCallback(
		async (restart = false, message = "Opening your lesson...") => {
			setPhase({ name: "loading", message });
			try {
				if (needsWriting && !wroteRef.current) {
					setPhase({ name: "loading", message: `Writing this lesson from ${reading ?? "the passage"}. Every answer is checked against the verse, so this can take up to a minute.` });
					await writeCurriculumLesson(pathId, target);
					wroteRef.current = true;
				}
				const view = await startSession(pathId, kind, target, restart);
				setSession(view);
				setQueue(view.queue);
				setIndex(view.index);
				setChecked(null);
				setSummary(null);
				setMatchTarget(null);
				setDraft(emptyDraft(view.exercises[view.queue[view.index]]));
				setNotice(view.resumed ? `Picking up where you left off: question ${answeredCount(view.queue, view.index) + 1} of ${view.total}.` : null);
				setPhase(view.kind === "lesson" && !view.resumed && view.reading ? { name: "reading" } : { name: "question" });
			} catch (error) {
				const message = error instanceof Error ? error.message : "This lesson could not be opened. Please try again.";
				setPhase({ name: "error", message, back: error instanceof PathsRequestError && (error.status === 404 || error.status === 409) });
			}
		},
		[kind, needsWriting, pathId, reading, target]
	);

	useEffect(() => {
		void load();
	}, [load]);

	const exercise = session ? session.exercises[queue[index]] : null;
	const retry = isRetry(queue, index);
	const response = exercise && draft ? draftResponse(exercise, draft) : null;

	const save = useCallback(
		async (ex: ExerciseView, body: NonNullable<typeof response>) => {
			if (!session) return;
			try {
				const result = await postAnswer(session.pathId, session.sessionId, ex.id, body);
				setChecked((current) => (current ? { ...current, feedback: { correct: result.correct, parts: result.parts }, again: result.again, result, saveError: null } : current));
			} catch (error) {
				if (error instanceof PathsRequestError && error.status === 409) {
					await load(false, "This lesson moved on in another window. Catching up...");
					return;
				}
				setChecked((current) => (current ? { ...current, saveError: error instanceof Error ? error.message : "Your answer was not saved." } : current));
			}
		},
		[load, session]
	);

	const check = useCallback(() => {
		if (!exercise || !response || checked) return;
		const feedback = localGrade(exercise, response);
		setChecked({ feedback, again: !feedback.correct && !retry, result: null, saveError: null });
		void save(exercise, response);
	}, [checked, exercise, response, retry, save]);

	const advance = useCallback(() => {
		const result = checked?.result;
		if (!result || !session) return;
		setNotice(null);
		setChecked(null);
		setMatchTarget(null);
		if (result.finished) {
			setSummary(result.finished);
			setPhase(session.kind === "lesson" && session.reflection ? { name: "reflection" } : { name: "summary" });
			return;
		}
		setQueue(result.queue);
		setIndex(result.index);
		setDraft(emptyDraft(session.exercises[result.queue[result.index]]));
		requestAnimationFrame(() => promptRef.current?.focus());
	}, [checked, session]);

	// Keyboard: A-D or 1-4 choose, Enter checks and continues.
	useEffect(() => {
		if (phase.name !== "question" || !exercise) return;
		const onKey = (event: KeyboardEvent) => {
			const tag = (event.target as HTMLElement | null)?.tagName ?? "";
			if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
			if (event.key === "Enter") {
				// A focused button or link handles its own Enter (choosing an option, opening a link).
				if (tag === "BUTTON" || tag === "A") return;
				if (checked?.result) advance();
				else if (!checked && response) check();
				else return;
				event.preventDefault();
				return;
			}
			if (checked || (exercise.type !== "choice" && exercise.type !== "blank")) return;
			const key = event.key.toUpperCase();
			const option = key >= "A" && key <= "D" ? key.charCodeAt(0) - 65 : key >= "1" && key <= "4" ? Number(key) - 1 : -1;
			if (option >= 0 && option < (exercise.options?.length ?? 0)) setDraft({ type: exercise.type, choice: option });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [advance, check, checked, exercise, phase.name, response]);

	const total = session?.total ?? 0;
	const done = phase.name === "reflection" || phase.name === "summary" ? total : answeredCount(queue, index) + (checked && !retry ? 1 : 0);

	if (phase.name === "loading") {
		return (
			<Frame leaveHref={leaveHref} done={0} total={0} title={title}>
				<div role="status" aria-live="polite" className="flex flex-col items-center gap-4 py-24 text-center">
					<span className="h-8 w-8 rounded-full border-2 border-amber-500/30 border-t-amber-600 motion-safe:animate-spin dark:border-t-amber-300" aria-hidden />
					<p className="max-w-sm text-[16px] leading-6">{phase.message}</p>
				</div>
			</Frame>
		);
	}

	if (phase.name === "error") {
		return (
			<Frame leaveHref={leaveHref} done={0} total={0} title={title}>
				<div role="alert" className="flex flex-col items-center gap-4 py-20 text-center">
					<p className="max-w-sm text-[16px] leading-6">{phase.message}</p>
					<div className="flex flex-wrap justify-center gap-3">
						{!phase.back && (
							<button type="button" onClick={() => void load()} className={GOLD_BUTTON}>
								Try again
							</button>
						)}
						<Link href={pathHref(pathId, base)} className={QUIET_BUTTON}>
							Back to {pathTitle}
						</Link>
					</div>
				</div>
			</Frame>
		);
	}

	if (!session) return null;

	if (phase.name === "reading" && session.reading) {
		return (
			<Frame leaveHref={leaveHref} done={0} total={total} title={session.title}>
				<p className={EYEBROW}>Read · {session.pathTitle}</p>
				<h1 className={`${SERIF} mt-1 text-[clamp(2rem,7vw,2.7rem)] font-semibold leading-[1.05]`}>{session.title}</h1>
				<Passage reading={session.reading} />
				<Teaching text={session.reading.teaching} />
				<div className="mt-6 flex flex-col items-center gap-2">
					<button type="button" onClick={() => setPhase({ name: "question" })} className={`${GOLD_BUTTON} w-full sm:w-auto sm:min-w-64`}>
						Start the questions <ArrowRight size={18} aria-hidden />
					</button>
					<p className={`text-sm ${MUTED}`}>{total} questions. Every answer is shown with the verse that says it.</p>
				</div>
			</Frame>
		);
	}

	if (phase.name === "reflection" && session.reflection) {
		return (
			<Frame leaveHref={leaveHref} done={total} total={total} title={session.title}>
				<Reflection session={session} onDone={() => setPhase({ name: "summary" })} />
			</Frame>
		);
	}

	if ((phase.name === "summary" || phase.name === "reflection") && summary) {
		return (
			<Frame leaveHref={leaveHref} done={total} total={total} title={session.title}>
				<Summary
					session={session}
					summary={summary}
					onAgain={() => void load(true)}
					onNext={(lessonId) => router.push(lessonHref(pathId, lessonId, base))}
					base={base}
					continueTo={continueTo}
				/>
			</Frame>
		);
	}

	if (!exercise || !draft) return null;

	return (
		<Frame leaveHref={leaveHref} done={done} total={total} title={session.title}>
			{notice && (
				<p role="status" className="mb-4 rounded-2xl bg-amber-500/[.1] px-4 py-3 text-sm font-bold dark:bg-amber-300/[.08]">
					{notice}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<p className={EYEBROW}>{TYPE_LABEL[exercise.type]}</p>
				{exercise.fromReview && <span className="rounded-full border border-amber-700/40 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:border-amber-300/40 dark:text-amber-200">From an earlier lesson</span>}
				{retry && <span className="rounded-full border border-amber-700/40 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:border-amber-300/40 dark:text-amber-200">Once more</span>}
			</div>
			<h1 ref={promptRef} tabIndex={-1} className="mt-2 text-[21px] font-semibold leading-[1.35] outline-none sm:text-[23px]">
				{exercise.prompt}
			</h1>
			<div className="mt-5">
				{(draft.type === "choice" || draft.type === "blank") &&
					(exercise.type === "blank" ? (
						<BlankExercise ex={exercise} draft={draft} onDraft={setDraft} feedback={checked?.feedback ?? null} />
					) : (
						<ChoiceExercise ex={exercise} draft={draft} onDraft={setDraft} feedback={checked?.feedback ?? null} />
					))}
				{draft.type === "order" && <OrderExercise ex={exercise} draft={draft} onDraft={setDraft} feedback={checked?.feedback ?? null} />}
				{draft.type === "match" && <MatchExercise ex={exercise} draft={draft} onDraft={setDraft} feedback={checked?.feedback ?? null} selected={matchTarget} onSelect={setMatchTarget} />}
			</div>

			{checked && <FeedbackPanel ex={exercise} feedback={checked.feedback} again={checked.again} retry={retry} />}

			<div className="sticky bottom-[calc(var(--sureword-mobile-tab-clearance)+8px)] z-20 mt-6 lg:bottom-6">
				{checked ? (
					checked.saveError ? (
						<div role="alert" className={`${CARD} flex flex-col items-center gap-2 bg-[#f6f2e9] p-3 dark:bg-[#0d100d]`}>
							<p className="text-sm">{checked.saveError}</p>
							<button type="button" onClick={() => void save(exercise, response!)} className={`${GOLD_BUTTON} w-full`}>
								Try saving again
							</button>
						</div>
					) : (
						<button type="button" onClick={advance} disabled={!checked.result} className={`${GOLD_BUTTON} w-full shadow-[0_8px_24px_-12px_rgba(0,0,0,.45)]`}>
							{checked.result ? (checked.result.finished ? "Finish" : "Continue") : "Saving..."} {checked.result && <ArrowRight size={18} aria-hidden />}
						</button>
					)
				) : (
					<button type="button" onClick={check} disabled={!response} className={`${GOLD_BUTTON} w-full shadow-[0_8px_24px_-12px_rgba(0,0,0,.45)]`}>
						Check
					</button>
				)}
			</div>

			{session.reading && (
				<div className="mt-8">
					<button type="button" onClick={() => setShowPassage((value) => !value)} aria-expanded={showPassage} className={TEXT_LINK}>
						<BookOpen size={16} aria-hidden /> {showPassage ? "Hide the passage" : `Read ${session.reading.ref} again`}
						<ChevronDown size={16} aria-hidden className={showPassage ? "rotate-180" : ""} />
					</button>
					{showPassage && <Passage reading={session.reading} />}
				</div>
			)}
		</Frame>
	);
}

/** The session's frame: leave, the progress bar, and the count. */
function Frame({ leaveHref, done, total, title, children }: { leaveHref: string; done: number; total: number; title: string; children: React.ReactNode }) {
	return (
		<main className="mx-auto w-full max-w-2xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-3 lg:pb-16 lg:pt-8">
			<div className="mb-5 flex items-center gap-3">
				<Link href={leaveHref} aria-label={`Leave ${title}. Your place is saved.`} className={`-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5 ${FOCUS}`}>
					<X size={24} aria-hidden />
				</Link>
				<div className="flex flex-1 gap-1.5" aria-hidden>
					{Array.from({ length: Math.max(total, 1) }, (_, step) => (
						<span key={step} className={`h-2 flex-1 rounded-full ${step < done ? "bg-[#e5b664]" : "bg-black/[.09] dark:bg-white/[.1]"}`} />
					))}
				</div>
				<span className="min-w-[3.5rem] text-right text-sm font-bold tabular-nums text-neutral-600 dark:text-[#bbb3a7]">{total ? `${Math.min(done, total)} / ${total}` : ""}</span>
				<span className="sr-only" aria-live="polite">{total ? `${Math.min(done, total)} of ${total} answered` : ""}</span>
			</div>
			{children}
		</main>
	);
}

function Passage({ reading }: { reading: NonNullable<SessionView["reading"]> }) {
	return (
		<figure className={`${CARD} mt-5 px-5 py-5`}>
			<figcaption className={`${EYEBROW} flex flex-wrap items-center justify-between gap-2`}>
				<span>{reading.ref} · KJV</span>
				<Link href={`/bible/chapter?book=${reading.book}&chapter=${reading.chapter}&verse=${reading.verses[0]?.n ?? 1}&translation=KJV`} className={`${TEXT_LINK} normal-case tracking-normal`}>
					Open the chapter
				</Link>
			</figcaption>
			<div className="mt-3 flex flex-col gap-2">
				{reading.verses.map((verse) => (
					<p key={verse.n} className={`${SERIF} text-[21px] leading-[1.5]`}>
						<sup className="mr-1 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse.n}</sup>
						{verse.text}
					</p>
				))}
			</div>
		</figure>
	);
}

function Teaching({ text }: { text: string }) {
	return (
		<section aria-label="Teaching" className="mt-4 rounded-[22px] border border-dashed border-black/[.14] px-5 py-4 dark:border-white/[.16]">
			<p className={EYEBROW}>Teaching</p>
			<p className="mt-2 text-[16px] leading-7">{text}</p>
			<p className={`mt-2 text-xs ${MUTED}`}>An explanation of the passage, not Scripture. Search the Scriptures to see whether these things are so.</p>
		</section>
	);
}

function Reflection({ session, onDone }: { session: SessionView; onDone: () => void }) {
	const reflection = session.reflection!;
	const key = session.keyVerse;
	const [words, setWords] = useState("");
	const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const saveNote = async () => {
		if (!words.trim() || state === "saving") return;
		setState("saving");
		try {
			await saveReflectionNote(
				`${session.pathTitle}: ${session.title}`,
				{ verse: reflection.verse.verse, reference: reflection.verse.ref, verseText: reflection.verse.text, prompt: reflection.prompt },
				words
			);
			setState("saved");
		} catch {
			setState("error");
		}
	};
	return (
		<div>
			<p className={EYEBROW}>Carry it with you</p>
			<h1 className={`${SERIF} mt-1 text-[clamp(2rem,7vw,2.6rem)] font-semibold leading-[1.05]`}>A moment to reflect</h1>
			<figure className="mt-5 border-l-2 border-[#e5b664] pl-4">
				<blockquote className={`${SERIF} text-[22px] leading-[1.45]`}>{reflection.verse.text}</blockquote>
				<figcaption className={`${EYEBROW} mt-1`}>{reflection.verse.ref} · KJV</figcaption>
			</figure>
			<label htmlFor="paths-reflection" className="mt-5 block text-[17px] font-semibold leading-snug">
				{reflection.prompt}
			</label>
			<textarea
				id="paths-reflection"
				value={words}
				onChange={(event) => setWords(event.target.value)}
				rows={4}
				maxLength={2000}
				placeholder="Write a few honest words. Only you will see them."
				className="mt-3 w-full rounded-2xl border border-black/10 bg-white/80 p-4 text-base leading-6 outline-none placeholder:text-neutral-500 focus:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:focus:border-amber-300/40"
			/>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				{state === "saved" ? (
					<p role="status" className="flex items-center gap-2 text-sm font-bold">
						<Check size={16} aria-hidden /> Saved to your notes.{" "}
						<Link href="/notes" className={TEXT_LINK}>Open Notes</Link>
					</p>
				) : (
					<button type="button" onClick={() => void saveNote()} disabled={!words.trim() || state === "saving"} className={QUIET_BUTTON}>
						<NotebookPen size={16} aria-hidden /> {state === "saving" ? "Saving..." : "Save to Notes"}
					</button>
				)}
				{state === "error" && <p role="alert" className="text-sm text-red-700 dark:text-red-300">The note could not be saved. Try again.</p>}
			</div>
			{key && (
				<section aria-labelledby="paths-key-verse" className={`${CARD} mt-6 p-5`}>
					<h2 id="paths-key-verse" className={EYEBROW}>The verse to carry</h2>
					<p className={`${SERIF} mt-2 text-[21px] leading-[1.45]`}>{key.text}</p>
					<p className={`${EYEBROW} mt-1`}>{key.ref} · KJV</p>
					<AddLearnButton book={key.book} chapter={key.chapter} verse={key.verse} translation="KJV" source="quiz" accessibilityLabel={`Learn ${key.ref}`} />
				</section>
			)}
			<button type="button" onClick={onDone} className={`${GOLD_BUTTON} mt-6 w-full`}>
				Finish the lesson <ArrowRight size={18} aria-hidden />
			</button>
		</div>
	);
}

function Summary({
	session,
	summary,
	onAgain,
	onNext,
	base,
	continueTo,
}: {
	session: SessionView;
	summary: SessionSummary;
	onAgain: () => void;
	onNext: (lessonId: string) => void;
	base: string;
	continueTo?: { href: string; label: string };
}) {
	const heading =
		summary.kind === "lesson" ? (continueTo ? "Questions complete" : "Lesson complete") : summary.kind === "checkpoint" ? "Checkpoint complete" : summary.kind === "final" ? "Final review complete" : "Review complete";
	// A course lesson goes on to its tutor and memory parts rather than straight to the next lesson.
	const next = summary.kind === "lesson" && !continueTo ? summary.next : null;
	return (
		<div className="text-center">
			<svg viewBox="0 0 32 32" aria-hidden className="mx-auto h-10 w-10 text-[#e5b664]">
				<path d="M16 1 C17 11 21 15 31 16 C21 17 17 21 16 31 C15 21 11 17 1 16 C11 15 15 11 16 1 Z" fill="currentColor" />
			</svg>
			<h1 className={`${SERIF} mt-3 text-[clamp(2.2rem,8vw,3rem)] font-semibold leading-tight`}>{summary.pathDone && summary.kind === "lesson" && !continueTo ? `You finished ${session.pathTitle}` : heading}</h1>
			<p className={`mt-2 text-[17px] ${MUTED}`}>
				You answered {summary.score.right} of {summary.score.total} from the Word the first time.
			</p>
			{summary.concepts.length > 0 && (
				<ul className="mx-auto mt-6 flex max-w-md flex-col gap-2 text-left">
					{summary.concepts.map((item) => (
						<li key={item.concept} className={`${CARD} flex items-center justify-between gap-3 px-4 py-3`}>
							<span>{conceptTitle(item.concept)}</span>
							<span className="text-sm font-bold text-amber-800 dark:text-[#e5b664]">{CONCEPT_LABEL[item.state]}</span>
						</li>
					))}
				</ul>
			)}
			{summary.reviewCount > 0 && (
				<p className="mt-5 flex items-center justify-center gap-2 text-[15px]">
					<RotateCcw size={16} aria-hidden /> {summary.reviewCount === 1 ? "One question comes back" : `${summary.reviewCount} questions come back`} in later lessons and in review.
				</p>
			)}
			<div className="mx-auto mt-8 flex max-w-md flex-col gap-3">
				{continueTo && summary.kind === "lesson" && (
					<Link href={continueTo.href} className={GOLD_BUTTON}>
						{continueTo.label} <ArrowRight size={18} aria-hidden />
					</Link>
				)}
				{next && (
					<button type="button" onClick={() => onNext(next.id)} className={GOLD_BUTTON}>
						Next: {next.title} <ArrowRight size={18} aria-hidden />
					</button>
				)}
				{summary.reviewCount > 0 && summary.kind !== "review" && (
					<Link href={reviewHref(session.pathId, base)} className={QUIET_BUTTON}>
						<RotateCcw size={16} aria-hidden /> Review what you missed
					</Link>
				)}
				{/* A review that cleared the list has nothing to go again on. */}
				{(summary.kind === "checkpoint" || summary.kind === "final" || (summary.kind === "review" && summary.reviewCount > 0)) && (
					<button type="button" onClick={onAgain} className={QUIET_BUTTON}>
						Go again
					</button>
				)}
				<Link href={pathHref(session.pathId, base)} className={next || (continueTo && summary.kind === "lesson") ? TEXT_LINK + " justify-center" : GOLD_BUTTON}>
					{base === PATHS_BASE ? "Back to the path" : "Back to the course"}
				</Link>
			</div>
		</div>
	);
}
