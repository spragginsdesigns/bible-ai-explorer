"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Lightbulb, Loader2, NotebookPen, Pause, ScrollText, Send, ShieldCheck } from "lucide-react";
import {
	TUTOR_LEVELS,
	TUTOR_LEVEL_LABEL,
	TUTOR_STAGES,
	TUTOR_STAGE_LABEL,
	latestCheck,
	openQuestion,
	type TutorAction,
	type TutorLevel,
	type TutorSessionView,
} from "@/lib/beta/tutor/tutor-rules";
import TutorTurnView, { NoteLink } from "./TutorTurns";
import { TutorRequestError, tutorApi } from "./tutor-api";

const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
const quietButton =
	"inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-black/10 px-3.5 text-sm font-bold transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[.05]";

const PENDING_LABEL: Record<TutorAction, string> = {
	answer: "The tutor is reading your answer against the text",
	hint: "Finding a hint",
	reading: "The tutor is writing its reading",
	conclude: "Checking your conclusion against the text",
};

/**
 * A close reading in progress: the passage from the bundled KJV beside the
 * conversation on desktop (above it on a phone), the tutor's one open
 * question, and the founder's answer, hint, reading and conclusion actions.
 * Every change is saved as it happens, so leaving is pausing.
 */
export default function TutorSession({ initial }: { initial: TutorSessionView }) {
	const router = useRouter();
	const [view, setView] = useState(initial);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState<{ action: TutorAction; text: string } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [concluding, setConcluding] = useState(false);
	const [passageOpen, setPassageOpen] = useState(true);
	const [saving, setSaving] = useState(false);
	const [busy, setBusy] = useState(false);
	const endRef = useRef<HTMLDivElement>(null);
	const composerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	// A resumed session opens at its live question; a new one opens at the passage.
	const turnCount = useRef(initial.turns.length > 1 ? 0 : initial.turns.length);

	const open = openQuestion(view.turns);
	const check = latestCheck(view.turns);
	const checkedSinceQuestion = Boolean(check && open && view.turns.indexOf(check) > view.turns.indexOf(open));
	const conclusionMode = concluding || !open || open.stage === "conclusion" || checkedSinceQuestion;
	const focus = new Set(open && !checkedSinceQuestion ? open.focus : []);
	// A conclusion checked early ends the guided questions, so only the stages actually reached show as done.
	const stageIndex = TUTOR_STAGES.indexOf(view.stage);
	const working = pending !== null || busy;

	// Bring each new reply into view, without animation for anyone who asked for less motion.
	useEffect(() => {
		if (view.turns.length === turnCount.current && !pending) return;
		turnCount.current = view.turns.length;
		const end = endRef.current;
		const composer = composerRef.current;
		if (!end) return;
		// The sticky composer (and on a phone the tab bar under it) covers the bottom of the
		// screen, so the newest reply must stop above it rather than at the screen's edge.
		const covered = composer ? composer.offsetHeight + (Number.parseFloat(getComputedStyle(composer).bottom) || 0) + 12 : 0;
		end.style.scrollMarginBottom = `${covered}px`;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		end.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
	}, [view.turns.length, pending]);

	// The router can hand this page back from its cache (Back, or a session reopened soon after it
	// was left), so the screen reads the session fresh once it opens. The newer copy wins, so a
	// turn that lands first is never replaced by an older read.
	useEffect(() => {
		let live = true;
		tutorApi
			.read(initial.id)
			.then(({ session }) => {
				if (live) setView((current) => (Date.parse(session.updatedAt) >= Date.parse(current.updatedAt) ? session : current));
			})
			.catch(() => {
				/* Offline: the page's copy stands, and the server refuses a send from a stale screen. */
			});
		return () => {
			live = false;
		};
	}, [initial.id]);

	async function refresh() {
		try {
			const { session } = await tutorApi.read(view.id);
			setView(session);
		} catch {
			/* The error already shown is enough. */
		}
	}

	async function act(action: TutorAction) {
		if (working) return;
		const text = action === "answer" || action === "conclude" ? draft.trim() : "";
		if ((action === "answer" || action === "conclude") && !text) {
			setError(action === "conclude" ? "Write your conclusion first: what does this passage teach?" : "Write your answer first.");
			inputRef.current?.focus();
			return;
		}
		setError(null);
		setPending({ action, text });
		if (text) setDraft("");
		try {
			const { session } = await tutorApi.turn(view.id, action, text, view.turns.length);
			setView(session);
			setConcluding(false);
		} catch (caught) {
			if (text) setDraft(text);
			setError(caught instanceof TutorRequestError ? caught.message : "The tutor could not answer just now. Please try again.");
			if (caught instanceof TutorRequestError && caught.code === "stale") await refresh();
		} finally {
			setPending(null);
		}
	}

	async function changeLevel(level: TutorLevel) {
		if (working || level === view.level) return;
		setBusy(true);
		setError(null);
		try {
			const { session } = await tutorApi.change(view.id, { level });
			setView(session);
		} catch (caught) {
			setError(caught instanceof TutorRequestError ? caught.message : "The level could not be changed.");
			if (caught instanceof TutorRequestError && caught.code === "stale") await refresh();
		} finally {
			setBusy(false);
		}
	}

	async function pause() {
		if (working) return;
		setBusy(true);
		try {
			await tutorApi.change(view.id, { paused: true });
		} catch {
			/* Every turn is already saved; pausing only stamps the time. */
		}
		router.push("/beta/study/tutor");
	}

	async function saveNote() {
		if (working) return;
		setSaving(true);
		setBusy(true);
		setError(null);
		try {
			const { session } = await tutorApi.saveNote(view.id);
			setView(session);
		} catch (caught) {
			setError(caught instanceof TutorRequestError ? caught.message : "The note could not be saved. Please try again.");
		} finally {
			setSaving(false);
			setBusy(false);
		}
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void act(conclusionMode ? "conclude" : "answer");
		}
	}

	const answered = view.turns.some((turn) => turn.role === "you" && (turn.kind === "answer" || turn.kind === "conclusion"));

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-8">
			<Link href="/beta/study/tutor" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Socratic Tutor
			</Link>

			<header className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div className="min-w-0">
					<p className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">Close reading · KJV</p>
					<h1 className="mt-1 font-[family-name:var(--font-cormorant)] text-[clamp(2rem,7vw,2.6rem)] font-semibold leading-[1.05]">{view.passage.reference}</h1>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label className="flex min-h-11 items-center gap-2 rounded-full border border-black/10 pl-3.5 pr-1 text-sm font-bold dark:border-white/10">
						<span className="text-neutral-600 dark:text-[#b3ad9e]">Level</span>
						<select
							value={view.level}
							disabled={working}
							onChange={(event) => void changeLevel(event.target.value as TutorLevel)}
							className="min-h-11 rounded-full bg-transparent pr-1 text-base font-bold outline-none dark:bg-[#0d100d] lg:text-sm"
						>
							{TUTOR_LEVELS.map((level) => (
								<option key={level} value={level}>
									{TUTOR_LEVEL_LABEL[level]}
								</option>
							))}
						</select>
					</label>
					<button type="button" onClick={() => void pause()} disabled={working} className={quietButton}>
						<Pause size={16} aria-hidden /> Pause
					</button>
					{view.noteCurrent && view.noteId ? (
						<span className="inline-flex items-center gap-2 pl-1 text-sm font-bold text-emerald-800 dark:text-emerald-300">
							<Check size={16} aria-hidden /> Saved to Notes <NoteLink noteId={view.noteId} />
						</span>
					) : (
						<button type="button" onClick={() => void saveNote()} disabled={working || !answered} className={quietButton} title={answered ? undefined : "Answer a question first"}>
							{saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <NotebookPen size={16} aria-hidden />}
							{saving ? "Saving" : view.noteId ? "Update note" : "Save as note"}
						</button>
					)}
				</div>
			</header>

			<ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Where you are in the study">
				{TUTOR_STAGES.map((stage, index) => {
					const done = index < stageIndex || (view.finished && stage === "conclusion");
					const now = !view.finished && index === stageIndex;
					return (
						<li key={stage} aria-current={now ? "step" : undefined} className="flex flex-col gap-1.5">
							<span className={`h-1.5 rounded-full ${done ? "bg-emerald-600/70 dark:bg-emerald-300/60" : now ? "bg-[#e5b664]" : "bg-black/[.08] dark:bg-white/[.08]"}`} />
							<span className={`flex items-center gap-1 text-xs font-bold ${now ? "text-neutral-900 dark:text-[#f1eadc]" : "text-neutral-500 dark:text-neutral-400"}`}>
								{done ? <Check size={12} aria-hidden /> : null}
								{TUTOR_STAGE_LABEL[stage]}
							</span>
						</li>
					);
				})}
			</ol>

			<div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-8">
				<aside className={`${card} lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto`} aria-label={`${view.passage.reference}, King James Version`}>
					<button
						type="button"
						onClick={() => setPassageOpen((value) => !value)}
						aria-expanded={passageOpen}
						aria-controls="tutor-passage-text"
						className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left lg:pointer-events-none"
					>
						<span className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">The passage</span>
						<ChevronDown size={18} className={`transition-transform lg:hidden ${passageOpen ? "rotate-180" : ""}`} aria-hidden />
					</button>
					<div id="tutor-passage-text" className={`${passageOpen ? "block" : "hidden"} max-h-[42dvh] overflow-y-auto px-4 pb-4 lg:block lg:max-h-none`}>
						{view.verses.map((row) => (
							<p
								key={row.verse}
								data-focus={focus.has(row.verse) || undefined}
								className={`-mx-2 rounded-xl px-2 py-1 font-[family-name:var(--font-cormorant)] text-[19px] leading-[1.45] ${focus.has(row.verse) ? "bg-amber-500/[.16] dark:bg-amber-300/[.12]" : ""}`}
							>
								<sup className="mr-1 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{row.verse}</sup>
								{row.text}
							</p>
						))}
					</div>
				</aside>

				<section aria-label="The conversation" className="flex min-w-0 flex-col gap-3">
					<div className="flex flex-col gap-3" aria-live="polite" aria-relevant="additions">
						{view.turns.map((turn) => (
							<TutorTurnView key={turn.id} turn={turn} verses={view.verses} isOpen={turn === open && !checkedSinceQuestion && !view.finished} />
						))}
						{pending ? (
							<>
								{pending.text ? (
									<div className="ml-auto max-w-[88%] rounded-[22px] rounded-br-md bg-amber-500/[.15] px-4 py-3 opacity-80 dark:bg-amber-300/[.11]">
										<p className="text-xs font-bold uppercase tracking-[.14em] text-amber-900 dark:text-amber-200">{pending.action === "conclude" ? "Your conclusion" : "You"}</p>
										<p className="mt-1 whitespace-pre-wrap text-[16px] leading-6">{pending.text}</p>
									</div>
								) : null}
								<p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-[#bbb3a7]" role="status">
									<Loader2 size={16} className="animate-spin" aria-hidden /> {PENDING_LABEL[pending.action]}
								</p>
							</>
						) : null}
					</div>
					<div ref={endRef} />

					<div
						ref={composerRef}
						className="sticky bottom-[calc(var(--sureword-mobile-tab-clearance)+8px)] z-10 rounded-[22px] border border-black/[.09] bg-[#f6f2e9] p-3 shadow-[0_-12px_24px_-12px_rgba(36,40,31,.18)] dark:border-white/[.09] dark:bg-[#121612] dark:shadow-[0_-12px_24px_-12px_rgba(0,0,0,.6)] lg:bottom-4"
					>
						{error ? (
							<p role="alert" className="mb-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
								{error}
							</p>
						) : null}
						{view.full ? (
							<p className="px-1 py-2 text-sm leading-6">This session is full. Save it as a note, then start a fresh close reading of {view.passage.reference}.</p>
						) : (
							<>
								<label htmlFor="tutor-answer" className="sr-only">
									{conclusionMode ? "Your conclusion" : "Your answer"}
								</label>
								<textarea
									id="tutor-answer"
									ref={inputRef}
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
									onKeyDown={onKeyDown}
									disabled={working}
									rows={2}
									maxLength={2000}
									placeholder={conclusionMode ? "Your conclusion: what does this passage teach?" : "Your answer, from the text"}
									className="block max-h-48 min-h-[52px] w-full resize-y rounded-2xl border border-black/10 bg-white/85 px-3.5 py-3 text-[16px] leading-6 outline-none placeholder:text-neutral-500 focus:border-amber-700/50 disabled:opacity-60 dark:border-white/10 dark:bg-white/[.05] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/50"
								/>
								<div className="mt-2 flex flex-wrap items-center gap-2">
									<button
										type="button"
										onClick={() => void act(conclusionMode ? "conclude" : "answer")}
										disabled={working || !draft.trim()}
										className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#24281f] px-4 text-sm font-bold text-white transition-opacity disabled:opacity-40 dark:bg-[#e5b664] dark:text-[#1c2118]"
									>
										{conclusionMode ? <ShieldCheck size={16} aria-hidden /> : <Send size={16} aria-hidden />}
										{conclusionMode ? "Check my conclusion" : "Answer"}
									</button>
									{!conclusionMode ? (
										<button type="button" onClick={() => void act("hint")} disabled={working || view.hintsLeft < 1} className={quietButton}>
											<Lightbulb size={16} aria-hidden /> {view.hintsLeft < 1 ? "No hints left" : "Hint"}
										</button>
									) : null}
									<button type="button" onClick={() => void act("reading")} disabled={working} className={quietButton}>
										<ScrollText size={16} aria-hidden /> Your reading
									</button>
									{!conclusionMode ? (
										<button type="button" onClick={() => setConcluding(true)} disabled={working} className={quietButton}>
											<ShieldCheck size={16} aria-hidden /> Conclude
										</button>
									) : concluding ? (
										<button type="button" onClick={() => setConcluding(false)} disabled={working} className={quietButton}>
											Back to the question
										</button>
									) : null}
								</div>
							</>
						)}
					</div>
				</section>
			</div>
		</main>
	);
}
