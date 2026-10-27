"use client";

import { useMemo, useRef, useState } from "react";
import { verseWords, type LearnStage } from "@/components/learn/learn";
import { scoreTypedVerse, type TypedScore } from "@/components/learn/practice";
import {
	choiceRound,
	firstLetter,
	foldWord,
	gradeBlanks,
	gradeRecall,
	letterTargets,
	memoryTokens,
	type MemoryExercise as ExerciseType,
	type MemoryGrade,
} from "@/lib/beta/memory/memory-rules";
import type { QuizQuestion } from "@/lib/quiz-contract";

/** What an answered exercise reports: its grade and, for the record, how it went. */
export interface ExerciseOutcome {
	grade: MemoryGrade;
	/** One line for the feedback, such as "23 of 25 first letters". */
	detail: string;
}

export interface MemoryExerciseProps {
	type: ExerciseType;
	text: string;
	reference: string;
	stage: number;
	seed: number;
	pool: readonly string[];
	questions: QuizQuestion[] | null;
	/** Answered; the parent shows feedback and sends the review. */
	answered: boolean;
	disabled: boolean;
	onAnswer: (outcome: ExerciseOutcome) => void;
	/** Comprehension without questions yet: ask for them. */
	onWriteQuestions: () => void;
	writingQuestions: boolean;
}

const VERSE = "font-[family-name:var(--font-cormorant)] text-[clamp(1.55rem,6.2vw,2.15rem)] font-medium leading-[1.4]";
const OPTION =
	"flex min-h-12 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-base font-semibold transition-colors disabled:cursor-default";
const LETTER = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold";
const PRIMARY =
	"min-h-12 w-full rounded-full bg-[#24281f] px-5 text-base font-bold text-white transition-opacity disabled:opacity-40 dark:bg-[#e5b664] dark:text-[#1c2118]";
const INPUT_TYPING = { autoCapitalize: "none", autoCorrect: "off", autoComplete: "off", spellCheck: false } as const;

function optionTone(index: number, answerIndex: number, picked: number | null): string {
	if (picked === null) {
		return "border-black/10 bg-white/70 hover:border-amber-700/40 dark:border-white/10 dark:bg-white/[.04] dark:hover:border-amber-300/40";
	}
	if (index === answerIndex) return "border-emerald-600/60 bg-emerald-500/15 text-emerald-950 dark:border-emerald-300/50 dark:text-emerald-100";
	if (index === picked) return "border-rose-600/50 bg-rose-500/10 text-rose-900 dark:border-rose-300/40 dark:text-rose-100";
	return "border-black/[.06] bg-white/40 opacity-70 dark:border-white/[.06] dark:bg-white/[.02]";
}

function Options({
	options,
	answerIndex,
	disabled,
	onPick,
}: {
	options: readonly string[];
	answerIndex: number;
	disabled: boolean;
	onPick: (index: number) => void;
}) {
	const [picked, setPicked] = useState<number | null>(null);
	return (
		<div role="group" aria-label="Choices" className="mt-6 grid gap-2.5">
			{options.map((option, index) => (
				<button
					key={`${index}-${option}`}
					type="button"
					disabled={disabled || picked !== null}
					aria-pressed={picked === index}
					onClick={() => {
						setPicked(index);
						onPick(index);
					}}
					className={`${OPTION} ${optionTone(index, answerIndex, picked)}`}
				>
					<span className={`${LETTER} border-current/30`} aria-hidden>
						{String.fromCharCode(65 + index)}
					</span>
					<span className="min-w-0">{option}</span>
				</button>
			))}
		</div>
	);
}

/** Multiple choice: the passage with one word blanked, as on the founders' board. */
function ChoiceExercise({ text, pool, seed, disabled, onAnswer }: Pick<MemoryExerciseProps, "text" | "pool" | "seed" | "disabled" | "onAnswer">) {
	const round = useMemo(() => choiceRound(text, pool, seed), [text, pool, seed]);
	const [answered, setAnswered] = useState(false);
	if (!round) return <p className="text-sm">This verse has no word to choose. Try another way below.</p>;
	return (
		<>
			<p className={VERSE}>
				{round.tokens.map((token, index) => (
					<span key={index}>
						{index > 0 ? " " : ""}
						{index === round.blankIndex ? (
							<>
								{token.prefix}
								<span className="inline-block min-w-[4.5ch] border-b-2 border-amber-700 text-center text-amber-800 dark:border-[#e5b664] dark:text-[#e5b664]">
									{answered ? token.core : <span className="sr-only">blank</span>}
								</span>
								{token.suffix}
							</>
						) : (
							token.text
						)}
					</span>
				))}
			</p>
			<Options
				options={round.options}
				answerIndex={round.answerIndex}
				disabled={disabled}
				onPick={(index) => {
					setAnswered(true);
					onAnswer({
						grade: index === round.answerIndex ? "right" : "wrong",
						detail: index === round.answerIndex ? "You chose the word the verse says." : `The verse says "${round.options[round.answerIndex]}".`,
					});
				}}
			/>
		</>
	);
}

/** Fill in the blank: Learn a verse's masking ladder, with each blank typed. */
function BlankExercise({ text, stage, disabled, answered, onAnswer }: Pick<MemoryExerciseProps, "text" | "stage" | "disabled" | "answered" | "onAnswer">) {
	const tokens = useMemo(() => memoryTokens(text), [text]);
	const hidden = useMemo(() => {
		// Stage 1 hides every fourth word and stage 2 every other one; a verse too
		// short for its stage's pattern moves up the ladder until something is hidden.
		for (let rung = Math.min(Math.max(stage, 1), 2); rung <= 3; rung += 1) {
			const words = verseWords(text, rung as LearnStage);
			const indices = words.flatMap((word, index) => (word.hidden && tokens[index]?.core ? [index] : []));
			if (indices.length > 0) return indices;
		}
		return [];
	}, [text, stage, tokens]);
	const [typed, setTyped] = useState<string[]>(() => hidden.map(() => ""));
	const [checked, setChecked] = useState<boolean[] | null>(null);
	const refs = useRef<(HTMLInputElement | null)[]>([]);

	const check = () => {
		const result = gradeBlanks(hidden.map((index) => tokens[index].core), typed);
		setChecked(result.correct);
		onAnswer({
			grade: gradeRecall(result.mistakes, hidden.length),
			detail: `${hidden.length - result.mistakes} of ${hidden.length} missing words`,
		});
	};

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (!answered && !disabled) check();
			}}
		>
			<p className={`${VERSE} leading-[1.9]`}>
				{tokens.map((token, index) => {
					const slot = hidden.indexOf(index);
					if (slot < 0) return <span key={index}>{index > 0 ? " " : ""}{token.text}</span>;
					const state = checked?.[slot];
					return (
						<span key={index} className="whitespace-nowrap">
							{index > 0 ? " " : ""}
							{token.prefix}
							<input
								ref={(element) => {
									refs.current[slot] = element;
								}}
								aria-label={`Missing word ${slot + 1} of ${hidden.length}`}
								value={typed[slot] ?? ""}
								disabled={disabled || answered}
								onChange={(event) => {
									// Read the value now: an updater that runs later sees the input already restored.
									const next = event.target.value;
									setTyped((old) => old.map((value, at) => (at === slot ? next : value)));
								}}
								onKeyDown={(event) => {
									// Space and the keyboard's "next" key (an Enter on iOS) go to the next blank;
									// only Enter on the last one checks, so the form is never graded half typed.
									if ((event.key === " " || event.key === "Enter") && slot < hidden.length - 1) {
										event.preventDefault();
										refs.current[slot + 1]?.focus();
									}
								}}
								enterKeyHint={slot < hidden.length - 1 ? "next" : "done"}
								{...INPUT_TYPING}
								style={{ width: `${Math.max(token.core.length, 3) + 1.5}ch` }}
								className={`mx-0.5 inline-block h-11 rounded-lg border-b-2 bg-black/[.04] px-1 text-center font-sans text-base font-semibold outline-none focus:border-amber-700 dark:bg-white/[.06] dark:focus:border-[#e5b664] ${
									state === undefined
										? "border-neutral-400 dark:border-neutral-500"
										: state
											? "border-emerald-600 text-emerald-800 dark:border-emerald-300 dark:text-emerald-200"
											: "border-rose-600 text-rose-800 line-through dark:border-rose-300 dark:text-rose-200"
								}`}
							/>
							{state === false ? <span className="ml-1 font-sans text-sm font-bold text-emerald-800 dark:text-emerald-300">{token.core}</span> : null}
							{token.suffix}
						</span>
					);
				})}
			</p>
			{!answered ? (
				<button type="submit" disabled={disabled || typed.every((value) => !value.trim())} className={`${PRIMARY} mt-6`}>
					Check
				</button>
			) : null}
		</form>
	);
}

/**
 * First letters: the founder types the first letter of each word from
 * memory, and the verse fills in as they go. A wrong letter still reveals the
 * word, marked, so the round always reaches the end of the verse.
 */
function LettersExercise({ text, disabled, answered, onAnswer }: Pick<MemoryExerciseProps, "text" | "disabled" | "answered" | "onAnswer">) {
	const tokens = useMemo(() => memoryTokens(text), [text]);
	const targets = useMemo(() => letterTargets(tokens), [tokens]);
	const [results, setResults] = useState<boolean[]>([]);
	// What the field holds. A phone keyboard composing a word (Android's do) resends everything typed so far
	// on every key, so the field keeps it and only the new end is read; emptying it would count letters twice.
	const [entered, setEntered] = useState("");
	const finished = results.length >= targets.length;

	const record = (answers: boolean[]) => {
		const next = [...results, ...answers].slice(0, targets.length);
		setResults(next);
		if (next.length >= targets.length) {
			const mistakes = next.filter((ok) => !ok).length;
			onAnswer({ grade: gradeRecall(mistakes, targets.length), detail: `${targets.length - mistakes} of ${targets.length} first letters` });
		}
	};

	const enter = (raw: string) => {
		if (disabled || answered || finished) return;
		const letters = [...raw].filter((char) => foldWord(char));
		const answers: boolean[] = [];
		for (const char of letters) {
			const position = results.length + answers.length;
			if (position >= targets.length) break;
			answers.push(foldWord(char) === firstLetter(tokens[targets[position]].core));
		}
		if (answers.length > 0) record(answers);
	};

	// "Show word" reveals the next word and counts it as missed.
	const hint = () => {
		if (!finished && !disabled && !answered) record([false]);
	};

	const shown = new Map(targets.map((tokenIndex, position) => [tokenIndex, position]));
	return (
		<>
			<p className={VERSE} aria-live="polite">
				{tokens.map((token, index) => {
					const position = shown.get(index);
					const space = index > 0 ? " " : "";
					if (position === undefined) return <span key={index}>{space}{token.text}</span>;
					if (position >= results.length) {
						return (
							<span key={index}>
								{space}
								<span className={`inline-block border-b-2 text-transparent ${position === results.length ? "border-amber-700 dark:border-[#e5b664]" : "border-neutral-300 dark:border-neutral-600"}`}>
									{token.core.replace(/./gu, "m").slice(0, 6)}
								</span>
							</span>
						);
					}
					return (
						<span key={index} className={results[position] ? "" : "text-rose-700 underline decoration-dotted underline-offset-4 dark:text-rose-300"}>
							{space}
							{token.text}
						</span>
					);
				})}
			</p>
			{!finished ? (
				<div className="mt-6 flex items-center gap-2">
					<label htmlFor="memory-letters" className="sr-only">Type the first letter of the next word</label>
					<input
						id="memory-letters"
						value={entered}
						autoFocus
						disabled={disabled || answered}
						placeholder="Type the first letters"
						onChange={(event) => {
							const next = event.target.value;
							// A deletion or a replaced word is not an answer; the field keeps what was read.
							if (!next.startsWith(entered)) return;
							setEntered(next);
							enter(next.slice(entered.length));
						}}
						{...INPUT_TYPING}
						className="min-h-12 min-w-0 flex-1 rounded-2xl border border-black/15 bg-white/80 px-4 text-base outline-none focus:border-amber-700 dark:border-white/15 dark:bg-white/[.05] dark:focus:border-[#e5b664]"
					/>
					<button type="button" onClick={hint} disabled={disabled || answered} className="min-h-12 shrink-0 rounded-2xl border border-black/15 px-4 text-sm font-bold dark:border-white/15">
						Show word
					</button>
				</div>
			) : null}
			<p className="mt-3 text-sm text-neutral-600 dark:text-[#bbb3a7]" aria-live="polite">
				{results.length} of {targets.length} words · {results.filter((ok) => !ok).length} missed
			</p>
		</>
	);
}

/** Type the whole verse from the reference alone, checked word by word. */
function TypedExercise({ text, disabled, answered, onAnswer }: Pick<MemoryExerciseProps, "text" | "disabled" | "answered" | "onAnswer">) {
	const [draft, setDraft] = useState("");
	const [score, setScore] = useState<TypedScore | null>(null);
	const check = () => {
		const result = scoreTypedVerse(text, draft);
		setScore(result);
		const expected = result.words.filter((word) => word.expected !== null).length;
		const mistakes = result.words.filter((word) => word.result !== "match").length;
		onAnswer({ grade: gradeRecall(mistakes, expected), detail: result.perfect ? "Word for word." : `${expected - result.words.filter((word) => word.result === "missed").length} of ${expected} words in place` });
	};
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (!answered && !disabled && draft.trim()) check();
			}}
		>
			<label htmlFor="memory-typed" className="sr-only">Type the verse</label>
			<textarea
				id="memory-typed"
				value={draft}
				rows={5}
				disabled={disabled || answered}
				placeholder="Type it from memory"
				onChange={(event) => setDraft(event.target.value)}
				{...INPUT_TYPING}
				className="w-full rounded-2xl border border-black/15 bg-white/80 p-4 font-[family-name:var(--font-cormorant)] text-xl leading-relaxed outline-none focus:border-amber-700 dark:border-white/15 dark:bg-white/[.05] dark:focus:border-[#e5b664]"
			/>
			{score ? (
				<p className="mt-4 font-[family-name:var(--font-cormorant)] text-xl leading-relaxed">
					{score.words.map((word, index) => (
						<span key={index}>
							{index > 0 ? " " : ""}
							{word.result === "match" ? word.expected : null}
							{word.result === "missed" ? (
								<span className="text-emerald-800 underline decoration-dotted underline-offset-4 dark:text-emerald-300">
									<span className="sr-only">missing word </span>
									{word.expected}
								</span>
							) : null}
							{word.result === "extra" ? (
								<span className="text-rose-700 line-through dark:text-rose-300">
									<span className="sr-only">not in the verse </span>
									{word.typed}
								</span>
							) : null}
						</span>
					))}
				</p>
			) : null}
			{!answered ? (
				<button type="submit" disabled={disabled || !draft.trim()} className={`${PRIMARY} mt-4`}>
					Check
				</button>
			) : null}
		</form>
	);
}

/** Comprehension: a question answered from the verse, with the verse out of sight. */
function QuestionExercise({
	questions,
	seed,
	reference,
	disabled,
	onAnswer,
	onWriteQuestions,
	writingQuestions,
}: Pick<MemoryExerciseProps, "questions" | "seed" | "reference" | "disabled" | "onAnswer" | "onWriteQuestions" | "writingQuestions">) {
	if (!questions || questions.length === 0) {
		return (
			<div className="rounded-2xl border border-dashed border-black/15 p-5 dark:border-white/15">
				<p className="text-base leading-7">
					Comprehension questions ask what {reference} says, answered in its own words. SureWord writes them with AI when you ask, checks every answer against the verse, and keeps them for next time.
				</p>
				<button type="button" onClick={onWriteQuestions} disabled={disabled || writingQuestions} className={`${PRIMARY} mt-4`}>
					{writingQuestions ? "Writing questions..." : "Write questions"}
				</button>
			</div>
		);
	}
	const question = questions[seed % questions.length];
	return (
		<>
			<p className="font-[family-name:var(--font-cormorant)] text-[clamp(1.5rem,5.6vw,2rem)] font-semibold leading-snug">{question.prompt}</p>
			<Options
				options={question.options}
				answerIndex={question.answerIndex}
				disabled={disabled}
				onPick={(index) =>
					onAnswer({
						grade: index === question.answerIndex ? "right" : "wrong",
						detail: index === question.answerIndex ? `${question.reference} says so.` : `${question.reference} says: ${question.options[question.answerIndex]}.`,
					})
				}
			/>
		</>
	);
}

export function MemoryExercise(props: MemoryExerciseProps) {
	switch (props.type) {
		case "choice":
			return <ChoiceExercise {...props} />;
		case "blank":
			return <BlankExercise {...props} />;
		case "letters":
			return <LettersExercise {...props} />;
		case "typed":
			return <TypedExercise {...props} />;
		case "question":
			return <QuestionExercise {...props} />;
	}
}
