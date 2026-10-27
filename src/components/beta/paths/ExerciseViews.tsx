"use client";

import Link from "next/link";
import { BookOpen, Check, X } from "lucide-react";
import { groupAnswers, placeTruth, toggleOrder, type Draft } from "@/lib/beta/paths/player-rules";
import type { ExerciseView } from "@/lib/beta/paths/view-types";
import { EYEBROW, FOCUS, MUTED, SERIF } from "./ui";

/**
 * The four Learning Paths exercises (LC-17648): multiple choice, fill in the
 * blank, put in order, and match the verse to its truth. Everything is a tap
 * target of at least 44px, nothing depends on hover or dragging, and after
 * Check every exercise shows the verse that answers it.
 */

export interface Feedback {
	correct: boolean;
	parts: boolean[];
}

interface ExerciseProps<T extends Draft> {
	ex: ExerciseView;
	draft: T;
	onDraft: (draft: T) => void;
	feedback: Feedback | null;
}

const LETTERS = ["A", "B", "C", "D", "E"];

function optionTone(state: "idle" | "selected" | "right" | "wrong" | "faded"): string {
	switch (state) {
		case "selected":
			return "border-amber-600 bg-amber-500/[.12] dark:border-amber-300 dark:bg-amber-300/[.1]";
		case "right":
			return "border-[#c99a45] bg-[#e5b664]/25 dark:border-[#e5b664] dark:bg-[#e5b664]/15";
		case "wrong":
			return "border-rose-700/50 bg-rose-500/[.08] dark:border-rose-300/50 dark:bg-rose-300/[.08]";
		case "faded":
			return "border-black/[.08] opacity-60 dark:border-white/[.08]";
		default:
			return "border-black/[.12] bg-white/50 hover:border-amber-700/40 hover:bg-white/80 dark:border-white/[.12] dark:bg-white/[.03] dark:hover:border-amber-300/40 dark:hover:bg-white/[.06]";
	}
}

export function ChoiceExercise({ ex, draft, onDraft, feedback }: ExerciseProps<Extract<Draft, { type: "choice" | "blank" }>>) {
	const options = ex.options ?? [];
	return (
		<div role="radiogroup" aria-label="Choices" className="flex flex-col gap-3">
			{options.map((option, index) => {
				const chosen = draft.choice === index;
				const state = feedback ? (index === ex.answerIndex ? "right" : chosen ? "wrong" : "faded") : chosen ? "selected" : "idle";
				return (
					<button
						key={option}
						type="button"
						role="radio"
						aria-checked={chosen}
						disabled={Boolean(feedback)}
						onClick={() => onDraft({ ...draft, choice: index })}
						className={`flex min-h-[56px] w-full items-center gap-4 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${optionTone(state)} ${FOCUS}`}
					>
						<span
							aria-hidden
							className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
								state === "selected" || state === "right" ? "border-transparent bg-[#e5b664] text-[#1c2118]" : "border-black/15 dark:border-white/20"
							}`}
						>
							{state === "right" ? <Check size={18} strokeWidth={3} /> : state === "wrong" ? <X size={18} strokeWidth={3} /> : LETTERS[index]}
						</span>
						<span className="flex-1 text-[16px] leading-[1.4]">{option}</span>
						{state === "right" && <span className="sr-only">, the right answer</span>}
						{state === "wrong" && <span className="sr-only">, your answer</span>}
					</button>
				);
			})}
		</div>
	);
}

export function BlankExercise({ ex, draft, onDraft, feedback }: ExerciseProps<Extract<Draft, { type: "choice" | "blank" }>>) {
	const options = ex.options ?? [];
	const chosen = draft.choice === null ? null : options[draft.choice];
	const right = options[ex.answerIndex ?? 0];
	return (
		<div>
			<figure className="rounded-[22px] border border-black/[.09] bg-white/45 px-5 py-5 dark:border-white/[.09] dark:bg-white/[.03]">
				<blockquote className={`${SERIF} text-[23px] leading-[1.6]`}>
					{ex.blank?.before}
					{feedback ? (
						<>
							{!feedback.correct && chosen && <span className="mx-1 text-neutral-500 line-through decoration-rose-600/70">{chosen}</span>}
							<span className="rounded-md bg-[#e5b664]/30 px-1.5 font-semibold">{right}</span>
						</>
					) : (
						<button
							type="button"
							onClick={() => onDraft({ ...draft, choice: null })}
							disabled={chosen === null}
							aria-label={chosen ? `Blank filled with ${chosen}. Tap to clear.` : "Blank, choose a word below"}
							className={`mx-0.5 inline-flex min-h-11 min-w-[6.5rem] items-center justify-center rounded-lg border-b-2 border-dashed px-2 align-middle text-[21px] font-semibold ${
								chosen ? "border-amber-700 bg-amber-500/[.12] dark:border-amber-300" : "border-neutral-400 dark:border-neutral-500"
							} ${FOCUS}`}
						>
							{chosen ?? " "}
						</button>
					)}
					{ex.blank?.after}
				</blockquote>
				<figcaption className={`${EYEBROW} mt-3`}>{ex.blank?.ref} · KJV</figcaption>
			</figure>
			{!feedback && (
				<div role="group" aria-label="Words to choose from" className="mt-4 flex flex-wrap gap-2.5">
					{options.map((option, index) => (
						<button
							key={option}
							type="button"
							aria-pressed={draft.choice === index}
							onClick={() => onDraft({ ...draft, choice: draft.choice === index ? null : index })}
							className={`min-h-12 rounded-2xl border px-4 text-[16px] font-bold transition-colors ${draft.choice === index ? optionTone("selected") : optionTone("idle")} ${FOCUS}`}
						>
							{option}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export function OrderExercise({ ex, draft, onDraft, feedback }: ExerciseProps<Extract<Draft, { type: "order" }>>) {
	const items = ex.items ?? [];
	const remaining = items.map((_, index) => index).filter((index) => !draft.order.includes(index));
	return (
		<div>
			<p className={`${EYEBROW} mb-2`}>Your order</p>
			<ol className="flex flex-col gap-2">
				{items.map((_, place) => {
					const shown = draft.order[place];
					const filled = shown !== undefined;
					const ok = feedback?.parts[place];
					return (
						<li key={place} className="flex items-stretch gap-3">
							<span aria-hidden className="flex w-8 shrink-0 items-center justify-center text-sm font-bold text-neutral-500 dark:text-neutral-400">
								{place + 1}
							</span>
							{filled ? (
								<button
									type="button"
									disabled={Boolean(feedback)}
									onClick={() => onDraft({ ...draft, order: toggleOrder(draft.order, shown) })}
									aria-label={`${place + 1}: ${items[shown]}.${feedback ? (ok ? " Right place." : " Wrong place.") : " Tap to take it back."}`}
									className={`flex min-h-[52px] flex-1 items-center gap-3 rounded-2xl border px-4 py-2 text-left text-[16px] leading-snug transition-colors disabled:cursor-default ${
										feedback ? optionTone(ok ? "right" : "wrong") : optionTone("selected")
									} ${FOCUS}`}
								>
									<span className="flex-1">{items[shown]}</span>
									{feedback && (ok ? <Check size={18} strokeWidth={3} aria-hidden /> : <X size={18} strokeWidth={3} aria-hidden />)}
								</button>
							) : (
								<span className="flex min-h-[52px] flex-1 items-center rounded-2xl border-2 border-dashed border-black/[.12] px-4 text-sm text-neutral-500 dark:border-white/[.14] dark:text-neutral-400">
									{place === draft.order.length ? "Tap the step that comes next" : ""}
								</span>
							)}
						</li>
					);
				})}
			</ol>
			{!feedback && remaining.length > 0 && (
				<div className="mt-5">
					<p className={`${EYEBROW} mb-2`}>Steps</p>
					<div role="group" aria-label="Steps to place" className="flex flex-col gap-2">
						{remaining.map((index) => (
							<button
								key={index}
								type="button"
								onClick={() => onDraft({ ...draft, order: toggleOrder(draft.order, index) })}
								className={`min-h-[52px] rounded-2xl border px-4 py-2 text-left text-[16px] leading-snug transition-colors ${optionTone("idle")} ${FOCUS}`}
							>
								{items[index]}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export function MatchExercise({ ex, draft, onDraft, feedback, selected, onSelect }: ExerciseProps<Extract<Draft, { type: "match" }>> & { selected: number | null; onSelect: (verse: number | null) => void }) {
	const verses = ex.verses ?? [];
	const truths = ex.truths ?? [];
	const free = truths.map((_, index) => index).filter((index) => !draft.pairs.includes(index));
	const target = selected ?? draft.pairs.findIndex((pair) => pair === null);
	return (
		<div>
			<ol className="flex flex-col gap-2.5">
				{verses.map((ref, verse) => {
					const truth = draft.pairs[verse];
					const ok = feedback?.parts[verse];
					const active = !feedback && target === verse;
					return (
						<li key={ref}>
							<button
								type="button"
								disabled={Boolean(feedback)}
								aria-pressed={active}
								onClick={() => {
									if (truth !== null) onDraft({ ...draft, pairs: draft.pairs.map((pair, index) => (index === verse ? null : pair)) });
									onSelect(verse);
								}}
								className={`flex min-h-[60px] w-full flex-col items-start gap-1 rounded-2xl border px-4 py-2.5 text-left transition-colors disabled:cursor-default ${
									feedback ? optionTone(ok ? "right" : "wrong") : active ? "border-amber-600 bg-amber-500/[.08] dark:border-amber-300" : optionTone("idle")
								} ${FOCUS}`}
							>
								<span className="flex w-full items-center justify-between gap-2">
									<span className="text-xs font-bold uppercase tracking-[.16em] text-amber-800 dark:text-[#e5b664]">{ref}</span>
									{feedback && (ok ? <Check size={18} strokeWidth={3} aria-label="right" /> : <X size={18} strokeWidth={3} aria-label="not this one" />)}
								</span>
								<span className={`text-[16px] leading-snug ${truth === null ? "text-neutral-500 dark:text-neutral-400" : "font-semibold"}`}>
									{truth === null ? (active ? "Now tap the truth it states" : "Tap to choose its truth") : truths[truth]}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
			{!feedback && free.length > 0 && (
				<div className="mt-5">
					<p className={`${EYEBROW} mb-2`}>Truths</p>
					<div role="group" aria-label="Truths to match" className="flex flex-col gap-2">
						{free.map((index) => (
							<button
								key={index}
								type="button"
								onClick={() => {
									onDraft({ ...draft, pairs: placeTruth(draft.pairs, index, target >= 0 ? target : null) });
									onSelect(null);
								}}
								className={`min-h-[52px] rounded-2xl border px-4 py-2 text-left text-[16px] leading-snug transition-colors ${optionTone("idle")} ${FOCUS}`}
							>
								{truths[index]}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

/** After Check: right or not, and always the verse that answers it (once, however many steps it holds). */
export function FeedbackPanel({ ex, feedback, again, retry }: { ex: ExerciseView; feedback: Feedback; again: boolean; retry: boolean }) {
	const groups = groupAnswers(ex.answers);
	const numbered = ex.answers.length > 1;
	return (
		<section
			role="status"
			aria-live="polite"
			className={`mt-6 rounded-[22px] border px-5 py-5 ${
				feedback.correct ? "border-[#c99a45]/50 bg-[#e5b664]/[.14] dark:border-[#e5b664]/40 dark:bg-[#e5b664]/[.08]" : "border-rose-700/25 bg-rose-500/[.06] dark:border-rose-300/25 dark:bg-rose-300/[.06]"
			}`}
		>
			<p className="flex items-center gap-2 text-[18px] font-bold">
				{feedback.correct ? <Check size={20} strokeWidth={3} className="text-amber-700 dark:text-[#e5b664]" aria-hidden /> : <X size={20} strokeWidth={3} className="text-rose-700 dark:text-rose-300" aria-hidden />}
				{feedback.correct ? (retry ? "Right this time" : "Right") : "Not quite"}
			</p>
			<p className={`mt-1 text-sm ${MUTED}`}>
				{again
					? "Read the verse; this one comes back at the end of the lesson, and in later lessons until it sticks."
					: feedback.correct
						? groups.length > 1 ? "Here are the verses that say it." : "Here is the verse that says it."
						: groups.length > 1 ? "Here is what the verses say." : "Here is what the verse says."}
			</p>
			<div className={`mt-4 flex flex-col ${groups.length > 1 ? "gap-4" : ""}`}>
				{groups.map((answer) => (
					<figure key={answer.ref} className="border-l-2 border-[#e5b664] pl-4">
						{answer.labels.length > 0 && (
							<ul className="flex flex-col gap-0.5">
								{answer.labels.map((item) => (
									<li key={item.n} className="text-[15px] font-bold leading-snug">
										{numbered ? `${item.n}. ` : ""}
										{item.label}
									</li>
								))}
							</ul>
						)}
						<blockquote className={`${SERIF} mt-1 text-[21px] leading-[1.45]`}>{answer.text}</blockquote>
						<figcaption className="mt-1 flex flex-wrap items-center gap-x-3">
							<span className={EYEBROW}>{answer.ref} · KJV</span>
							<Link
								href={`/bible/chapter?book=${answer.book}&chapter=${answer.chapter}&verse=${answer.verse}&translation=KJV`}
								className={`inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664] ${FOCUS}`}
							>
								<BookOpen size={15} aria-hidden /> Read in context
							</Link>
						</figcaption>
					</figure>
				))}
			</div>
			{ex.note && (
				<p className="mt-4 border-t border-black/[.08] pt-3 text-[15px] leading-6 dark:border-white/[.08]">
					<span className={`${EYEBROW} mr-2`}>Why it matters</span>
					{ex.note}
				</p>
			)}
		</section>
	);
}
