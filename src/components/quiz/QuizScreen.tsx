"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { BookOpen, Check, ChevronDown, ChevronRight, MessageCircle, X } from "lucide-react";
import { bookByOrder } from "@/lib/bible/books";
import { getChapter, isTranslationId } from "@/lib/bible/translations";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import type { ChapterQuiz, QuizDepth, QuizQuestion, QuizReflection } from "@/lib/quiz-contract";
import { AddLearnButton } from "@/components/learn/AddLearnButton";
import QuizGameStep from "@/components/beta/games/QuizGameStep";
import { postQuizAttempt, saveReflectionNote, useChapterQuiz } from "./quizClient";
import {
	askPrompt,
	attemptBody,
	countCorrect,
	keyToOption,
	loadingLine,
	nextChapterAfter,
	optionLetter,
	primaryVerse,
	resultsHeadline,
	resultsSubline,
	verseLabel,
} from "./quizView";

/** Second loading line, once the wait is long enough to need reassurance. */
const SLOW_LOAD_MS = 4000;
const SAVE_NOTE_ERROR = "The note could not be saved. Check your connection and try again.";

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]";
const GOLD_BUTTON = `flex min-h-12 w-full items-center justify-center rounded-xl bg-amber-500 px-5 text-[16px] font-bold text-neutral-950 motion-safe:transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-500 dark:bg-amber-400 dark:hover:bg-amber-300 dark:disabled:hover:bg-amber-400 ${FOCUS_RING}`;
const OUTLINE_BUTTON = `flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-black/[0.12] dark:border-white/[0.12] px-3 text-sm font-semibold text-neutral-700 dark:text-neutral-200 motion-safe:transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] ${FOCUS_RING}`;
const QUIET_BUTTON = `min-h-11 rounded-lg px-4 text-[15px] font-semibold text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100 ${FOCUS_RING}`;
const SCRIPTURE = "font-[family-name:var(--font-cormorant)]";
const PANEL =
	"rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-[hsl(var(--card))] shadow-sm";
const SMALL_CAPS_REF = "text-metadata font-bold uppercase tracking-[0.22em]";

interface Links {
	reader: (verse?: number) => string;
	next: { href: string; label: string } | null;
	ask: (question: QuizQuestion) => string;
}

/** The SureWord day star, drawn small above the results headline. */
function DayStar({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 32 32" aria-hidden className={className}>
			<path
				d="M16 1 C17 11 21 15 31 16 C21 17 17 21 16 31 C15 21 11 17 1 16 C11 15 15 11 16 1 Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function Spinner() {
	return (
		<div className="h-7 w-7 rounded-full border-2 border-amber-500/30 border-t-amber-500 motion-safe:animate-spin dark:border-amber-400/30 dark:border-t-amber-400" />
	);
}

/**
 * The "Quiz me" route (`/bible/quiz?book=&chapter=`): a five question quiz on
 * one chapter, always from the KJV. Desktop sets the chapter beside the quiz
 * with the question's verses lit; narrow screens show the quiz alone, as on
 * Android (mobile/src/features/quiz).
 */
export default function QuizScreen() {
	const searchParams = useSearchParams();
	const { isLoaded, isSignedIn } = useUser();
	const pathname = usePathname();

	const order = Number.parseInt(searchParams.get("book") ?? "", 10);
	const chapter = Number.parseInt(searchParams.get("chapter") ?? "", 10);
	const book = Number.isInteger(order) ? bookByOrder(order) : null;
	const valid = !!book && Number.isInteger(chapter) && chapter >= 1 && chapter <= book.chapters;

	// The reader's route translation rides along so closing the quiz returns
	// to the same text; the quiz itself is always the KJV.
	const routeTranslation = searchParams.get("translation");
	const translationSuffix =
		isTranslationId(routeTranslation)
			? `&translation=${routeTranslation}`
			: "";

	const links = useMemo<Links | null>(() => {
		if (!book || !valid) return null;
		const next = nextChapterAfter(book.order, chapter, book.chapters);
		const nextBook = next ? bookByOrder(next.book) : null;
		return {
			reader: (verse?: number) =>
				`/bible/chapter?book=${book.order}&chapter=${chapter}${verse ? `&verse=${verse}` : ""}${translationSuffix}`,
			next:
				next && nextBook
					? {
							href: `/bible/chapter?book=${next.book}&chapter=${next.chapter}${translationSuffix}`,
							label: `${nextBook.name} ${next.chapter}`,
						}
					: null,
			ask: (question: QuizQuestion) => {
				const query = new URLSearchParams({
					prompt: askPrompt(question),
					attachRef: question.reference,
					attachText: question.verseText,
					attachTranslation: "KJV",
				});
				return `/?${query.toString()}`;
			},
		};
	}, [book, valid, chapter, translationSuffix]);

	if (!book || !valid || !links) {
		return (
			<CenteredNotice>
				<p className="text-sm text-neutral-500 dark:text-neutral-400">That chapter could not be found.</p>
				<Link href="/bible" className={`mt-4 text-[15px] font-semibold text-amber-600 dark:text-amber-400 ${FOCUS_RING}`}>
					Open the Bible
				</Link>
			</CenteredNotice>
		);
	}

	const title = `${book.name} ${chapter}`;

	if (!isLoaded) {
		return (
			<CenteredNotice>
				<Spinner />
			</CenteredNotice>
		);
	}

	if (!isSignedIn) {
		const back = `${pathname}?${searchParams.toString()}`;
		return (
			<CenteredNotice>
				<div className={`${PANEL} flex max-w-sm flex-col items-center gap-3 px-6 py-8 text-center`}>
					<DayStar className="h-7 w-7 text-amber-500 dark:text-amber-400" />
					<h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Quiz me on {title}</h1>
					<p className="text-[15px] leading-6 text-neutral-500 dark:text-neutral-400">
						Sign in to take a short quiz on this chapter. Every answer comes with its verse.
					</p>
					<Link href={`/sign-in?redirect_url=${encodeURIComponent(back)}`} className={`${GOLD_BUTTON} mt-2`}>
						Sign in
					</Link>
					<Link href={links.reader()} className={QUIET_BUTTON + " flex items-center"}>
						Back to {title}
					</Link>
				</div>
			</CenteredNotice>
		);
	}

	return <QuizSession key={`${book.order}:${chapter}`} order={book.order} chapter={chapter} title={title} links={links} />;
}

function CenteredNotice({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<div className="mx-auto flex min-h-[70dvh] w-full max-w-2xl flex-col items-center justify-center px-4 py-12">
				{children}
			</div>
		</div>
	);
}

/** KJV verses for the desktop chapter column; null while loading or if it failed. */
function useKjvChapter(order: number, chapter: number): string[] | null {
	const [verses, setVerses] = useState<string[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		getChapter("KJV", order, chapter)
			.then((list) => {
				if (!cancelled) setVerses(list.map(bibleVersePlainText));
			})
			.catch(() => {
				// The quiz carries its own verse text; the column simply stays empty.
			});
		return () => {
			cancelled = true;
		};
	}, [order, chapter]);
	return verses;
}

function QuizSession({ order, chapter, title, links }: { order: number; chapter: number; title: string; links: Links }) {
	const { state, load } = useChapterQuiz(order, chapter);
	const chapterVerses = useKjvChapter(order, chapter);
	const lastDepth = useRef<QuizDepth | null>(null);

	useEffect(() => {
		load(null);
	}, [load]);

	const changeDepth = useCallback(
		(depth: QuizDepth) => {
			lastDepth.current = depth;
			load(depth);
		},
		[load]
	);

	let body: React.ReactNode;
	if (state.status === "ready") {
		body = (
			<QuizRun
				key={state.run}
				quiz={state.quiz}
				title={title}
				links={links}
				chapterVerses={chapterVerses}
				onDepth={changeDepth}
			/>
		);
	} else {
		const panel =
			state.status === "error" ? (
				<div role="alert" className="flex flex-col items-center gap-4 px-2 py-16 text-center">
					<p className="max-w-sm text-[15px] leading-6 text-neutral-700 dark:text-neutral-200">{state.message}</p>
					<button
						type="button"
						onClick={() => load(lastDepth.current)}
						className={`rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2.5 text-sm font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 ${FOCUS_RING}`}
					>
						Retry
					</button>
					<Link href={links.reader()} className={QUIET_BUTTON + " flex items-center"}>
						Back to {title}
					</Link>
				</div>
			) : (
				<QuizLoading title={title} />
			);
		body = (
			<TwoColumn chapterTitle={title} chapterVerses={chapterVerses} lit={[]}>
				<QuizCard>
					<QuizHeader title={title} links={links} index={null} count={0} />
					{panel}
				</QuizCard>
			</TwoColumn>
		);
	}

	return <QuizShell>{body}</QuizShell>;
}

function QuizShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<div className="mx-auto w-full max-w-6xl px-4 pb-36 pt-3 sm:px-5 lg:pb-12 lg:pt-6">{children}</div>
		</div>
	);
}

function QuizLoading({ title }: { title: string }) {
	const [slow, setSlow] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-4 px-2 py-20 text-center">
			<Spinner />
			<p className="text-[16px] font-medium text-neutral-800 dark:text-neutral-100">{loadingLine(title)}</p>
			<p
				className={`text-[14px] text-neutral-500 dark:text-neutral-400 motion-safe:transition-opacity motion-safe:duration-500 ${
					slow ? "opacity-100" : "opacity-0"
				}`}
				aria-hidden={!slow}
			>
				Every answer is checked against the King James text.
			</p>
		</div>
	);
}

/* ------------------------------------------------------------------------ */
/* Layout                                                                    */
/* ------------------------------------------------------------------------ */

function TwoColumn({
	chapterTitle,
	chapterVerses,
	lit,
	children,
}: {
	chapterTitle: string;
	chapterVerses: string[] | null;
	lit: number[];
	children: React.ReactNode;
}) {
	return (
		<div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
			<ChapterColumn title={chapterTitle} verses={chapterVerses} lit={lit} />
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function QuizCard({ children }: { children: React.ReactNode }) {
	return <div className="lg:rounded-2xl lg:border lg:border-black/[0.08] lg:bg-[hsl(var(--card))] lg:p-8 lg:shadow-sm lg:dark:border-white/[0.08]">{children}</div>;
}

/**
 * Desktop only: the chapter in the KJV beside the quiz. The current question's
 * verses stay tinted and scroll into the column's view whenever they change,
 * so the reader can look back without leaving the quiz.
 */
function ChapterColumn({ title, verses, lit }: { title: string; verses: string[] | null; lit: number[] }) {
	const scroller = useRef<HTMLDivElement | null>(null);
	const litKey = lit.join(",");
	useEffect(() => {
		const container = scroller.current;
		const first = lit[0];
		if (!container || !first || !verses) return;
		const target = container.querySelector<HTMLElement>(`[data-quiz-verse="${first}"]`);
		if (!target) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		// Scroll the column alone; scrollIntoView would also move the page.
		container.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: reduce ? "auto" : "smooth" });
		// eslint-disable-next-line react-hooks/exhaustive-deps -- litKey stands in for lit
	}, [litKey, verses]);

	return (
		<aside aria-label={`${title}, King James Version`} className={`${PANEL} sticky top-6 hidden lg:block`}>
			<h2 className={`${SCRIPTURE} px-8 pb-2 pt-7 text-4xl font-semibold text-neutral-900 dark:text-neutral-100`}>{title}</h2>
			<div ref={scroller} className="relative max-h-[calc(100dvh-9.5rem)] overflow-y-auto px-5 pb-8">
				{verses ? (
					<ol className="flex flex-col gap-1">
						{verses.map((text, i) => {
							const n = i + 1;
							const on = lit.includes(n);
							return (
								<li
									key={n}
									data-quiz-verse={n}
									className={`flex gap-3 rounded-xl px-3 py-1.5 motion-safe:transition-colors motion-safe:duration-500 ${
										on ? "bg-amber-500/15 dark:bg-amber-400/15" : ""
									}`}
								>
									<span
										className={`w-6 flex-shrink-0 pt-1.5 text-right text-xs font-bold tabular-nums ${
											on ? "text-amber-700 dark:text-amber-400" : "text-neutral-400 dark:text-neutral-500"
										}`}
									>
										{n}
									</span>
									<span className={`${SCRIPTURE} text-[20px] leading-[1.5] text-neutral-800 dark:text-neutral-200`}>{text}</span>
								</li>
							);
						})}
					</ol>
				) : (
					<div className="flex justify-center py-16">
						<Spinner />
					</div>
				)}
			</div>
		</aside>
	);
}

function QuizHeader({
	title,
	links,
	index,
	count,
}: {
	title: string;
	links: Links;
	index: number | null;
	count: number;
}) {
	return (
		<header className="pb-5">
			<div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 lg:grid-cols-[1fr_auto]">
				<Link
					href={links.reader()}
					aria-label={`Close quiz, back to ${title}`}
					className={`flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.06] lg:order-2 lg:justify-self-end ${FOCUS_RING}`}
				>
					<X className="h-6 w-6" aria-hidden />
				</Link>
				<h1 className="text-center text-[19px] font-semibold text-neutral-900 dark:text-neutral-100 lg:order-1 lg:text-left lg:font-[family-name:var(--font-cormorant)] lg:text-4xl">
					{title} quiz
				</h1>
				<span className="text-right text-[15px] tabular-nums text-neutral-500 dark:text-neutral-400 lg:hidden">
					{index !== null ? `${index + 1} of ${count}` : ""}
				</span>
			</div>
			{index !== null ? (
				<div className="mt-4 flex items-center gap-3">
					<span className="hidden text-[15px] tabular-nums text-neutral-500 dark:text-neutral-400 lg:inline">
						{index + 1} of {count}
					</span>
					<div className="flex flex-1 gap-1.5" aria-hidden>
						{Array.from({ length: count }, (_, i) => (
							<span
								key={i}
								className={`h-1.5 flex-1 rounded-full motion-safe:transition-colors ${
									i <= index ? "bg-amber-500 dark:bg-amber-400" : "bg-black/[0.1] dark:bg-white/[0.1]"
								}`}
							/>
						))}
					</div>
					<span className="sr-only" aria-live="polite">
						Question {index + 1} of {count}
					</span>
				</div>
			) : null}
		</header>
	);
}

/* ------------------------------------------------------------------------ */
/* One quiz, question by question, then the results                          */
/* ------------------------------------------------------------------------ */

interface QuizRunProps {
	quiz: ChapterQuiz;
	title: string;
	links: Links;
	chapterVerses: string[] | null;
	onDepth: (depth: QuizDepth) => void;
}

function QuizRun({ quiz, title, links, chapterVerses, onDepth }: QuizRunProps) {
	const count = quiz.questions.length;
	const [index, setIndex] = useState(0);
	const [selected, setSelected] = useState<number | null>(null);
	const [checked, setChecked] = useState(false);
	const [revealed, setRevealed] = useState(false);
	const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.questions.map(() => null));
	const [finished, setFinished] = useState(false);
	const promptRef = useRef<HTMLHeadingElement | null>(null);
	const verseCardRef = useRef<HTMLDivElement | null>(null);
	const firstRender = useRef(true);
	const attemptSent = useRef(false);

	const question = quiz.questions[index];
	const quizTitle = quiz.title || title;

	// A new question starts at the top with focus on its prompt, so keyboard
	// and screen reader users land where the question begins.
	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		if (finished) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
		promptRef.current?.focus({ preventScroll: true });
	}, [index, finished]);

	// Bring the verse card into view on narrow screens once it appears.
	useEffect(() => {
		if (!(checked || revealed)) return;
		const card = verseCardRef.current;
		if (!card) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		card.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
	}, [checked, revealed]);

	// Results: record the attempt exactly once, when they first appear.
	useEffect(() => {
		if (!finished || attemptSent.current) return;
		attemptSent.current = true;
		void postQuizAttempt(attemptBody(quiz, answers));
	}, [finished, quiz, answers]);

	const check = useCallback(() => {
		if (checked || selected === null) return;
		setChecked(true);
		setAnswers((list) => list.map((value, i) => (i === index ? selected : value)));
	}, [checked, selected, index]);

	const advance = useCallback(() => {
		if (!checked) return;
		if (index + 1 >= count) {
			setFinished(true);
			const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
			return;
		}
		setIndex(index + 1);
		setSelected(null);
		setChecked(false);
		setRevealed(false);
	}, [checked, index, count]);

	// A-D or 1-4 choose, Enter checks and then moves on. Typing in a field,
	// using a modifier, or pressing Enter on another control is left alone.
	useEffect(() => {
		if (finished) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			if (document.querySelector('dialog:modal, [role="dialog"][aria-modal="true"]')) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
			if (event.key === "Enter") {
				if (target?.closest("a, button:not([data-quiz-option])")) return;
				event.preventDefault();
				if (checked) advance();
				else check();
				return;
			}
			if (checked) return;
			const option = keyToOption(event.key, question.options.length);
			if (option === null) return;
			event.preventDefault();
			setSelected(option);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [finished, checked, check, advance, question.options.length]);

	if (finished) {
		return (
			<Results
				quiz={quiz}
				title={quizTitle}
				answers={answers}
				links={links}
			/>
		);
	}

	const chosenRight = checked && selected === question.answerIndex;
	const isLast = index + 1 >= count;

	return (
		<TwoColumn chapterTitle={quizTitle} chapterVerses={chapterVerses} lit={question.verses}>
			<QuizCard>
				<QuizHeader title={quizTitle} links={links} index={index} count={count} />

				{index === 0 && !checked ? <DepthSwitch value={quiz.depth} onChange={onDepth} /> : null}

				<p className="text-[13px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
					{verseLabel(question.reference, question.verses)}
				</p>
				<h2
					ref={promptRef}
					tabIndex={-1}
					className="mt-2 text-[23px] font-semibold leading-[1.3] text-neutral-900 outline-none dark:text-neutral-50 lg:text-[26px]"
				>
					{question.prompt}
				</h2>

				<div role="group" aria-label="Choices" className="mt-6 flex flex-col gap-3">
					{question.options.map((option, i) => (
						<OptionRow
							key={i}
							index={i}
							text={option}
							selected={selected === i}
							checked={checked}
							correct={i === question.answerIndex}
							onSelect={() => {
								if (!checked) setSelected(i);
							}}
						/>
					))}
				</div>

				<p className="sr-only" role="status">
					{checked
						? chosenRight
							? "Right."
							: `Not quite. The answer is ${optionLetter(question.answerIndex)}, ${question.options[question.answerIndex]}.`
						: ""}
				</p>

				{checked || revealed ? (
					<div ref={verseCardRef} className="mt-6 scroll-mb-40">
						<VerseCard question={question} links={links} />
					</div>
				) : null}

				<div className="mt-6 flex flex-col items-center gap-1">
					{checked ? (
						<button type="button" onClick={advance} className={GOLD_BUTTON}>
							{isLast ? "See how you did" : "Next question"}
						</button>
					) : (
						<button type="button" onClick={check} disabled={selected === null} className={GOLD_BUTTON}>
							Check answer
						</button>
					)}
					<p className="hidden pt-2 text-[13px] text-neutral-400 dark:text-neutral-500 lg:block" aria-hidden>
						Press Enter
					</p>
					{!checked && !revealed ? (
						<button
							type="button"
							onClick={() => setRevealed(true)}
							className={`mt-1 min-h-11 rounded-lg px-3 text-[15px] font-medium text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100 ${FOCUS_RING}`}
						>
							Show me the verse first
						</button>
					) : null}
				</div>

				<p className="mt-6 hidden border-t border-black/[0.08] pt-5 text-[13px] text-neutral-500 dark:border-white/[0.08] dark:text-neutral-400 lg:block">
					Every answer is checked against the King James text.
				</p>
			</QuizCard>
		</TwoColumn>
	);
}

/**
 * Foundations or Going deeper. Offered only before the first answer, and
 * worded as what the questions are, never as a label on the reader.
 */
function DepthSwitch({ value, onChange }: { value: QuizDepth; onChange: (depth: QuizDepth) => void }) {
	const choices: { depth: QuizDepth; label: string }[] = [
		{ depth: "seeking", label: "Foundations" },
		{ depth: "growing", label: "Going deeper" },
	];
	return (
		<div
			role="radiogroup"
			aria-label="Kind of questions"
			className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-black/[0.1] bg-black/[0.03] p-1 dark:border-white/[0.08] dark:bg-white/[0.03]"
		>
			{choices.map((choice) => {
				const on = choice.depth === value;
				return (
					<button
						key={choice.depth}
						type="button"
						role="radio"
						aria-checked={on}
						onClick={() => {
							if (!on) onChange(choice.depth);
						}}
						className={`min-h-10 rounded-lg text-[14px] font-semibold motion-safe:transition-colors ${FOCUS_RING} ${
							on
								? "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
								: "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
						}`}
					>
						{choice.label}
					</button>
				);
			})}
		</div>
	);
}

function OptionRow({
	index,
	text,
	selected,
	checked,
	correct,
	onSelect,
}: {
	index: number;
	text: string;
	selected: boolean;
	checked: boolean;
	correct: boolean;
	onSelect: () => void;
}) {
	const letter = optionLetter(index);
	const wrongPick = checked && selected && !correct;
	const rightPick = checked && selected && correct;
	const showCorrect = checked && correct;
	const dim = checked && !selected && !correct;
	const gold = (!checked && selected) || showCorrect;

	let state = "";
	if (checked) state = rightPick ? ", your answer, correct" : wrongPick ? ", your answer, incorrect" : correct ? ", correct answer" : "";

	return (
		<button
			type="button"
			data-quiz-option
			aria-label={`Option ${letter}: ${text}${state}`}
			aria-pressed={checked ? undefined : selected}
			aria-disabled={checked || undefined}
			onClick={onSelect}
			className={`flex min-h-[52px] w-full items-center gap-4 rounded-xl border px-3 py-2.5 text-left motion-safe:transition-colors ${FOCUS_RING} ${
				gold
					? "border-amber-500 bg-amber-500/10 dark:border-amber-400 dark:bg-amber-400/10"
					: wrongPick
						? "border-red-400/70 bg-red-500/[0.06] dark:border-red-300/40 dark:bg-red-400/[0.06]"
						: "border-black/[0.1] bg-black/[0.015] dark:border-white/[0.08] dark:bg-white/[0.02]"
			} ${checked ? "cursor-default" : "hover:border-black/[0.2] dark:hover:border-white/[0.18]"} ${dim ? "opacity-50" : ""}`}
		>
			<span
				aria-hidden
				className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border text-[14px] font-bold ${
					gold
						? "border-transparent bg-amber-500 text-neutral-950 dark:bg-amber-400"
						: wrongPick
							? "border-red-400/70 text-red-700 dark:border-red-300/50 dark:text-red-300"
							: "border-black/[0.15] text-neutral-600 dark:border-white/[0.15] dark:text-neutral-300"
				}`}
			>
				{letter}
			</span>
			<span className="flex-1 text-[16px] leading-[1.4] text-neutral-800 dark:text-neutral-100">{text}</span>
			{showCorrect ? (
				<span aria-hidden className="flex flex-shrink-0 items-center gap-2 text-[15px] font-semibold text-amber-700 dark:text-amber-400">
					<span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-neutral-950 dark:bg-amber-400">
						<Check className="h-4 w-4" strokeWidth={3} />
					</span>
					{rightPick ? "Right" : null}
				</span>
			) : wrongPick ? (
				<span aria-hidden className="flex-shrink-0 text-[15px] font-semibold text-red-700/90 dark:text-red-300/90">
					Not quite
				</span>
			) : null}
		</button>
	);
}

/** The answer's verse: gold rule, reference, the KJV words, the note, and two ways on. */
function VerseCard({ question, links }: { question: QuizQuestion; links: Links }) {
	return (
		<div className={`${PANEL} relative overflow-hidden px-6 py-6`}>
			<span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-amber-500 dark:bg-amber-400" />
			<p className={`${SMALL_CAPS_REF} text-amber-700 dark:text-amber-400`}>{question.reference}</p>
			<p className={`${SCRIPTURE} mt-3 text-[23px] leading-[1.45] text-neutral-900 dark:text-neutral-100`}>{question.verseText}</p>
			{question.note ? (
				<p className="mt-4 border-t border-black/[0.08] pt-4 text-[14.5px] leading-[1.55] text-neutral-500 dark:border-white/[0.08] dark:text-neutral-400">
					{question.note}
				</p>
			) : null}
			<div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Link href={links.reader(primaryVerse(question))} className={OUTLINE_BUTTON}>
					<BookOpen className="h-4 w-4" aria-hidden />
					Read in context
				</Link>
				<Link href={links.ask(question)} className={OUTLINE_BUTTON}>
					<MessageCircle className="h-4 w-4" aria-hidden />
					Ask about this
				</Link>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------------ */
/* Results                                                                   */
/* ------------------------------------------------------------------------ */

function Results({
	quiz,
	title,
	answers,
	links,
}: {
	quiz: ChapterQuiz;
	title: string;
	answers: (number | null)[];
	links: Links;
}) {
	const total = quiz.questions.length;
	const correct = countCorrect(quiz.questions, answers);
	const missed = quiz.questions.filter((question, i) => answers[i] !== question.answerIndex);
	const headingRef = useRef<HTMLHeadingElement | null>(null);
	// Misses start open on desktop, as the review is the point of the list.
	const [open, setOpen] = useState<Set<string>>(() => new Set(missed.map((question) => question.id)));

	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
	}, []);

	const toggle = (id: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<div>
			<div className="grid grid-cols-[2.75rem_1fr] items-center gap-2 pb-2 lg:hidden">
				<Link
					href={links.reader()}
					aria-label={`Close quiz, back to ${title}`}
					className={`flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.06] ${FOCUS_RING}`}
				>
					<X className="h-6 w-6" aria-hidden />
				</Link>
				<p className="text-[19px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
			</div>

			<div className={quiz.reflection ? "lg:grid lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:items-start lg:gap-6" : "mx-auto max-w-3xl"}>
				<section className="min-w-0 lg:rounded-2xl lg:border lg:border-black/[0.08] lg:bg-[hsl(var(--card))] lg:p-9 lg:shadow-sm lg:dark:border-white/[0.08]">
					<div className="flex flex-col items-center text-center lg:items-start lg:text-left">
						<DayStar className="h-9 w-9 text-amber-500 dark:text-amber-400" />
						<h1
							ref={headingRef}
							tabIndex={-1}
							className={`${SCRIPTURE} mt-3 text-[40px] font-semibold leading-[1.1] text-neutral-900 outline-none dark:text-neutral-50 lg:text-[46px]`}
						>
							{resultsHeadline(correct, total)}
							<span className="hidden lg:inline"> from {title}</span>
						</h1>
						<p className="mt-2 text-[16px] text-neutral-500 dark:text-neutral-400">{resultsSubline(missed.length)}</p>
					</div>

					{/* Narrow screens: one card per miss, as on Android. */}
					<div className="mt-6 flex flex-col gap-4 lg:hidden">
						{quiz.questions.map((question, i) =>
							answers[i] === question.answerIndex ? null : (
								<div key={question.id} className={`${PANEL} p-5`}>
									<span className="inline-block rounded-lg bg-amber-500/15 px-3 py-1 text-[14px] font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">
										Missed
									</span>
									<p className="mt-3 text-[17px] font-semibold leading-[1.4] text-neutral-900 dark:text-neutral-100">{question.prompt}</p>
									<MissDetail quiz={quiz} question={question} answer={answers[i]} links={links} />
								</div>
							)
						)}
					</div>

					{/* Desktop: the whole quiz, each row opening to its verse. */}
					<ul className="mt-7 hidden divide-y divide-black/[0.08] dark:divide-white/[0.08] lg:block">
						{quiz.questions.map((question, i) => {
							const right = answers[i] === question.answerIndex;
							const isOpen = open.has(question.id);
							const panelId = `quiz-result-${question.id}`;
							return (
								<li key={question.id} className="py-1">
									<button
										type="button"
										aria-expanded={isOpen}
										aria-controls={panelId}
										onClick={() => toggle(question.id)}
										className={`flex min-h-[56px] w-full items-center gap-4 rounded-lg px-1 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] ${FOCUS_RING}`}
									>
										{right ? (
											<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-neutral-950 dark:bg-amber-400">
												<Check className="h-4 w-4" strokeWidth={3} aria-hidden />
											</span>
										) : (
											<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center" aria-hidden>
												<span className="h-5 w-5 rounded-full border-2 border-amber-500/70 bg-amber-500/15 dark:border-amber-400/60" />
											</span>
										)}
										<span className="sr-only">{right ? "Right:" : "Missed:"}</span>
										<span className="flex-1 text-[16px] text-neutral-800 dark:text-neutral-100">{question.prompt}</span>
										<span className="flex-shrink-0 text-[15px] text-neutral-500 dark:text-neutral-400">{question.reference}</span>
										{isOpen ? (
											<ChevronDown className="h-4 w-4 flex-shrink-0 text-neutral-400" aria-hidden />
										) : (
											<ChevronRight className="h-4 w-4 flex-shrink-0 text-neutral-400" aria-hidden />
										)}
									</button>
									{isOpen ? (
										<div id={panelId} className="mb-3 mt-1 rounded-xl border border-black/[0.08] bg-black/[0.015] px-6 py-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
											{right ? (
												<>
													<p className={`${SCRIPTURE} text-[21px] leading-[1.45] text-neutral-900 dark:text-neutral-100`}>{question.verseText}</p>
													<Link
														href={links.reader(primaryVerse(question))}
														className={`mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400 ${FOCUS_RING}`}
													>
														<BookOpen className="h-4 w-4" aria-hidden />
														Read in context
													</Link>
												</>
											) : (
												<MissDetail quiz={quiz} question={question} answer={answers[i]} links={links} />
											)}
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
				</section>

				{quiz.reflection ? (
					<div className="mt-6 lg:sticky lg:top-6 lg:mt-0">
						<ReflectionCard quizTitle={title} reflection={quiz.reflection} />
					</div>
				) : null}
			</div>

			<div className="mt-8 flex flex-col items-center gap-2 lg:flex-row lg:gap-6 lg:border-t lg:border-black/[0.08] lg:pt-7 lg:dark:border-white/[0.08]">
				{/* Founders: the chapter's game, while it is not yet won (SureWord Beta, LC-17905). */}
				<QuizGameStep book={quiz.book} chapter={quiz.chapter} className={`${OUTLINE_BUTTON} lg:w-auto lg:min-w-64`} />
				{links.next ? (
					<Link href={links.next.href} className={`${GOLD_BUTTON} lg:w-auto lg:min-w-64`}>
						Continue to {links.next.label}
					</Link>
				) : null}
				<Link href={links.reader()} className={`${QUIET_BUTTON} flex items-center`}>
					Done
				</Link>
			</div>
		</div>
	);
}

/** A missed question's review: both answers, the verse, and Learn / Ask. */
function MissDetail({
	quiz,
	question,
	answer,
	links,
}: {
	quiz: Pick<ChapterQuiz, "book" | "chapter">;
	question: QuizQuestion;
	answer: number | null;
	links: Links;
}) {
	return (
		<div>
			<p className="mt-4 text-[13.5px] text-neutral-500 dark:text-neutral-400">Your answer</p>
			<p className={`${SCRIPTURE} mt-0.5 text-[20px] text-neutral-500 line-through decoration-neutral-400 dark:text-neutral-500`}>
				{answer === null ? "No answer" : question.options[answer]}
			</p>
			<p className="mt-3 text-[13.5px] font-semibold text-amber-700 dark:text-amber-400">Correct answer</p>
			<p className={`${SCRIPTURE} mt-0.5 text-[22px] font-semibold text-amber-700 dark:text-amber-400`}>
				{question.options[question.answerIndex]}
			</p>
			<div className="mt-4 border-t border-black/[0.08] pt-4 dark:border-white/[0.08]">
				<p className={`${SCRIPTURE} text-[21px] leading-[1.45] text-neutral-900 dark:text-neutral-100`}>{question.verseText}</p>
				<p className={`${SMALL_CAPS_REF} mt-2 text-neutral-500 dark:text-neutral-400`}>{question.reference}</p>
			</div>
			<div className="mt-3 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
				<AddLearnButton
					book={quiz.book}
					chapter={quiz.chapter}
					verse={primaryVerse(question)}
					translation="KJV"
					source="quiz"
					accessibilityLabel={`Learn ${question.reference}`}
				/>
				<div className="my-2">
					<Link href={links.ask(question)} className={OUTLINE_BUTTON}>
						<MessageCircle className="h-4 w-4" aria-hidden />
						Ask about it
					</Link>
				</div>
			</div>
		</div>
	);
}

/** "Carry it with you": one verse, one question, and a note in the reader's words. */
function ReflectionCard({ quizTitle, reflection }: { quizTitle: string; reflection: QuizReflection }) {
	const [words, setWords] = useState("");
	const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
	const [savedId, setSavedId] = useState<string | null>(null);

	const save = async () => {
		if (!words.trim() || status === "saving" || savedId) return;
		setStatus("saving");
		try {
			const id = await saveReflectionNote(quizTitle, reflection, words);
			setSavedId(id);
			setStatus("idle");
		} catch {
			setStatus("error");
		}
	};

	return (
		<section aria-labelledby="quiz-carry-title" className={`${PANEL} p-6 lg:p-7`}>
			<h2 id="quiz-carry-title" className={`${SCRIPTURE} text-[28px] font-semibold text-neutral-900 dark:text-neutral-100`}>
				Carry it with you
			</h2>
			<p className="mt-2 text-[15px] leading-[1.55] text-neutral-500 dark:text-neutral-400">{reflection.prompt}</p>
			<div className="mt-4">
				<p className={`${SCRIPTURE} text-[20px] leading-[1.45] text-neutral-900 dark:text-neutral-100`}>{reflection.verseText}</p>
				<p className={`${SMALL_CAPS_REF} mt-2 text-amber-700 dark:text-amber-400`}>{reflection.reference}</p>
			</div>
			{savedId ? (
				<p role="status" className="mt-5 flex flex-wrap items-center gap-x-3 text-[15px] text-neutral-700 dark:text-neutral-200">
					<span className="inline-flex items-center gap-2">
						<Check className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
						Saved to your notes
					</span>
					<Link
						href={`/notes?note=${encodeURIComponent(savedId)}`}
						className={`inline-flex min-h-11 items-center font-semibold text-amber-700 dark:text-amber-400 ${FOCUS_RING}`}
					>
						Open
					</Link>
				</p>
			) : (
				<>
					<textarea
						value={words}
						onChange={(event) => {
							setWords(event.target.value);
							if (status === "error") setStatus("idle");
						}}
						rows={5}
						aria-label="Your reflection"
						placeholder="Write a few words..."
						className="mt-5 w-full resize-y rounded-xl border border-black/[0.1] bg-black/[0.02] px-4 py-3 text-[15px] leading-6 text-neutral-900 placeholder:text-neutral-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-white/[0.1] dark:bg-white/[0.02] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-amber-400"
					/>
					<div className="mt-3 flex justify-end">
						<button
							type="button"
							onClick={() => void save()}
							disabled={!words.trim() || status === "saving"}
							className={`flex min-h-11 items-center justify-center rounded-xl border border-black/[0.12] px-5 text-sm font-semibold text-neutral-700 hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.12] dark:text-neutral-200 dark:hover:bg-white/[0.05] lg:w-full ${FOCUS_RING}`}
						>
							{status === "saving" ? "Saving..." : "Save as a note"}
						</button>
					</div>
					{status === "error" ? (
						<p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
							{SAVE_NOTE_ERROR}
						</p>
					) : null}
				</>
			)}
		</section>
	);
}
