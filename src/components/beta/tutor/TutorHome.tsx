"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, NotebookPen, Trash2 } from "lucide-react";
import { DESTINATION_TILE, IconTile, moduleIcon } from "@/components/beta/visuals";
import {
	TUTOR_LEVELS,
	TUTOR_LEVEL_BLURB,
	TUTOR_LEVEL_LABEL,
	TUTOR_STAGE_LABEL,
	type TutorLevel,
	type TutorSessionSummary,
} from "@/lib/beta/tutor/tutor-rules";
import TutorPicker, { type PickedPassage } from "./TutorPicker";
import { TutorRequestError, tutorApi } from "./tutor-api";

const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
const LEVEL_KEY = "sureword.beta.tutor.level";

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

/** The Socratic Tutor's start screen: choose a passage and a level, or pick a session back up. */
export default function TutorHome({ sessions: initialSessions, initialPassage }: { sessions: TutorSessionSummary[]; initialPassage: string }) {
	const router = useRouter();
	const [picked, setPicked] = useState<PickedPassage>({ reference: initialPassage, valid: false });
	const [level, setLevel] = useState<TutorLevel>("growing");
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sessions, setSessions] = useState(initialSessions);
	const [confirming, setConfirming] = useState<string | null>(null);

	// Back can restore this page from the router's cache, so the list is read fresh once it opens.
	useEffect(() => {
		let live = true;
		tutorApi
			.list()
			.then(({ sessions: fresh }) => {
				if (live) setSessions(fresh);
			})
			.catch(() => {
				/* Offline: the page's copy stands. */
			});
		return () => {
			live = false;
		};
	}, []);

	useEffect(() => {
		try {
			const stored = window.localStorage.getItem(LEVEL_KEY);
			if (stored && (TUTOR_LEVELS as readonly string[]).includes(stored)) setLevel(stored as TutorLevel);
		} catch {
			/* Private mode: the default level stands. */
		}
	}, []);

	function chooseLevel(next: TutorLevel) {
		setLevel(next);
		try {
			window.localStorage.setItem(LEVEL_KEY, next);
		} catch {
			/* Not remembered, still used. */
		}
	}

	async function start(event: React.FormEvent) {
		event.preventDefault();
		if (!picked.valid || starting) return;
		setStarting(true);
		setError(null);
		try {
			const { session } = await tutorApi.start(picked.reference, level);
			router.push(`/beta/study/tutor/${session.id}`);
		} catch (caught) {
			setError(caught instanceof TutorRequestError ? caught.message : "The session could not start. Please try again.");
			setStarting(false);
		}
	}

	async function remove(id: string) {
		try {
			await tutorApi.remove(id);
			setSessions((current) => current.filter((session) => session.id !== id));
		} catch (caught) {
			setError(caught instanceof TutorRequestError ? caught.message : "That session could not be deleted.");
		} finally {
			setConfirming(null);
		}
	}

	return (
		<main className="mx-auto w-full max-w-6xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/study" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon("tutor", "study")} tone={DESTINATION_TILE.study} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">Socratic Tutor</h1>
					<p className="mt-1.5 max-w-xl text-base leading-6 text-neutral-700 dark:text-[#d9d1c3]">
						Read a passage closely, one question at a time. The tutor asks before it tells, so you reach your own conclusion from the text and see it checked against the Word.
					</p>
				</div>
			</header>

			<div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
				<form onSubmit={start} className={`${card} flex flex-col gap-5 p-4 sm:p-5`} aria-labelledby="tutor-start-title">
					<h2 id="tutor-start-title" className={eyebrow}>
						Start a close reading
					</h2>
					<TutorPicker initial={initialPassage} onChange={setPicked} disabled={starting} />

					<fieldset disabled={starting}>
						<legend className="text-sm font-bold">Level</legend>
						<div className="mt-1.5 grid grid-cols-3 gap-1 rounded-2xl border border-black/10 p-1 dark:border-white/10" role="radiogroup" aria-label="Level">
							{TUTOR_LEVELS.map((option) => (
								<button
									key={option}
									type="button"
									role="radio"
									aria-checked={level === option}
									onClick={() => chooseLevel(option)}
									className={`min-h-11 rounded-xl px-1 text-sm font-bold transition-colors ${
										level === option ? "bg-[#24281f] text-white dark:bg-[#e5b664] dark:text-[#1c2118]" : "text-neutral-700 hover:bg-black/[.04] dark:text-neutral-200 dark:hover:bg-white/[.05]"
									}`}
								>
									{TUTOR_LEVEL_LABEL[option]}
								</button>
							))}
						</div>
						<p className="mt-1.5 text-sm text-neutral-600 dark:text-[#bbb3a7]">{TUTOR_LEVEL_BLURB[level]}. It adapts as you answer.</p>
					</fieldset>

					{error ? (
						<p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
							{error}
						</p>
					) : null}

					<button
						type="submit"
						disabled={!picked.valid || starting}
						className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#24281f] px-5 text-base font-bold text-white transition-opacity disabled:opacity-40 dark:bg-[#e5b664] dark:text-[#1c2118]"
					>
						{starting ? (
							<>
								<Loader2 size={18} className="animate-spin" aria-hidden /> Reading {picked.reference} with you
							</>
						) : (
							<>
								Begin {picked.valid ? picked.reference : "the close reading"} <ArrowRight size={18} aria-hidden />
							</>
						)}
					</button>
				</form>

				<section aria-labelledby="tutor-sessions-title" className="flex flex-col gap-3">
					<h2 id="tutor-sessions-title" className={eyebrow}>
						Pick up where you left off
					</h2>
					{sessions.length === 0 ? (
						<p className={`${card} px-5 py-5 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]`}>
							Your close readings appear here. Pause one at any point and it waits for you, question and all.
						</p>
					) : (
						<ul className="flex flex-col gap-2.5">
							{sessions.map((session) => (
								<li key={session.id} className={`${card} flex items-center gap-2 p-2 pl-4`}>
									<Link href={`/beta/study/tutor/${session.id}`} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-1">
										<span className="font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-tight">{session.reference}</span>
										<span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
											<span>{TUTOR_LEVEL_LABEL[session.level]}</span>
											<span aria-hidden>·</span>
											{session.finished ? (
												<span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
													<Check size={13} aria-hidden /> Conclusion checked
												</span>
											) : (
												<span>{TUTOR_STAGE_LABEL[session.stage]}</span>
											)}
											<span aria-hidden>·</span>
											<span>
												{session.answered} {session.answered === 1 ? "answer" : "answers"}
											</span>
											{session.noteId ? (
												<>
													<span aria-hidden>·</span>
													<span className="inline-flex items-center gap-1">
														<NotebookPen size={13} aria-hidden /> In Notes
													</span>
												</>
											) : null}
											<span aria-hidden>·</span>
											<span>{WHEN.format(new Date(session.updatedAt))}</span>
										</span>
									</Link>
									{confirming === session.id ? (
										<span className="flex shrink-0 items-center gap-1">
											<button type="button" onClick={() => void remove(session.id)} className="min-h-11 rounded-full bg-rose-700 px-3.5 text-sm font-bold text-white dark:bg-rose-400 dark:text-[#1c2118]">
												Delete
											</button>
											<button type="button" onClick={() => setConfirming(null)} className="min-h-11 rounded-full px-3 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5">
												Keep
											</button>
										</span>
									) : (
										<button
											type="button"
											onClick={() => setConfirming(session.id)}
											aria-label={`Delete the ${session.reference} session`}
											className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 hover:text-rose-700 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-rose-300"
										>
											<Trash2 size={18} aria-hidden />
										</button>
									)}
								</li>
							))}
						</ul>
					)}
					<p className="px-1 text-xs leading-5 text-neutral-600 dark:text-[#b3ad9e]">
						Scripture is quoted from the King James Version bundled with SureWord. The tutor&apos;s own reading appears only when you ask for it, labelled as interpretation.
					</p>
				</section>
			</div>
		</main>
	);
}
