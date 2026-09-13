"use client";

import { useMemo, useState } from "react";
import { verseWords, type LearnStage } from "./learn";
import {
	LEARN_MODES,
	LEARN_MODE_LABELS,
	firstLetterWords,
	learnModeHint,
	orderRound,
	scoreTypedVerse,
	tapOrderWord,
	type LearnMode,
	type TypedScore,
} from "./practice";

export interface VersePracticeProps {
	mode: LearnMode;
	text: string;
	stage: LearnStage;
	/** The card's revision, so the shuffle and the part of a long verse move with the card. */
	seed: number;
	disabled: boolean;
	onModeChange: (mode: LearnMode) => void;
	/** Type it out is the one mode that gates Continue, and only a word-for-word verse passes. */
	onTypedScore: (perfect: boolean) => void;
}

const VERSE = "text-center font-serif text-[clamp(1.6rem,6vw,2.6rem)] leading-relaxed";
const WORD = "min-h-11 rounded px-1 text-amber-700 underline decoration-dotted underline-offset-8 focus-visible:outline focus-visible:outline-2 dark:text-amber-400";
const NOTE = "mt-6 text-center text-sm text-neutral-600 dark:text-neutral-400";

/**
 * One verse, one job, in whichever mode the card opened in. Every mode works
 * from the text already on screen, so practice never waits on the network.
 * The parent re-keys this component per card, review and mode, which is what
 * clears a round rather than an effect.
 */
export function VersePractice({ mode, text, stage, seed, disabled, onModeChange, onTypedScore }: VersePracticeProps) {
	const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
	const [placed, setPlaced] = useState<number[]>([]);
	const [expected, setExpected] = useState<number | null>(null);
	const [draft, setDraft] = useState("");
	const [score, setScore] = useState<TypedScore | null>(null);
	const blanks = useMemo(() => verseWords(text, stage), [text, stage]);
	const letters = useMemo(() => firstLetterWords(text), [text]);
	const round = useMemo(() => orderRound(text, seed), [text, seed]);

	const reveal = (index: number) => setRevealed((old) => new Set(old).add(index));

	const tap = (choice: number) => {
		const result = tapOrderWord(round, placed, choice);
		setPlaced(result.placed);
		setExpected(result.expected);
	};

	const check = () => {
		const result = scoreTypedVerse(text, draft);
		setScore(result);
		onTypedScore(result.perfect);
	};

	const edit = (value: string) => {
		setDraft(value);
		if (score) {
			setScore(null);
			onTypedScore(false);
		}
	};

	const taken = new Set(placed);
	const done = placed.length === round.answer.length;

	return <>
		{mode === "blanks" ? <p className={VERSE}>
			{blanks.map((word, index) => <span key={index}>
				{index > 0 ? " " : ""}
				{word.hidden && !revealed.has(index)
					? <button
						type="button"
						disabled={disabled}
						aria-label={`Reveal word ${index + 1}`}
						onClick={() => reveal(index)}
						className={WORD}
					>{word.blank}</button>
					: word.text}
			</span>)}
		</p> : null}

		{mode === "letters" ? <p className={VERSE}>
			{letters.map((word, index) => <span key={index}>
				{index > 0 ? " " : ""}
				{revealed.has(index)
					? word.text
					: <button
						type="button"
						disabled={disabled}
						aria-label={`See word ${index + 1}`}
						onClick={() => reveal(index)}
						className={WORD}
					>{word.clue}</button>}
			</span>)}
		</p> : null}

		{mode === "order" ? <>
			<p className={`${VERSE} min-h-[3rem]`} aria-live="polite">
				{placed.map((choice) => round.choices[choice]).join(" ")}
			</p>
			{round.partial ? <p className={NOTE}>This verse is long, so practice comes a part at a time.</p> : null}
			{done ? <p role="status" className={NOTE}>That is the verse.</p> : <div className="mt-6 flex flex-wrap justify-center gap-2">
				{round.choices.map((word, index) => taken.has(index) ? null : <button
					key={index}
					type="button"
					disabled={disabled}
					aria-label={`Place ${word}`}
					onClick={() => tap(index)}
					className={`min-h-11 rounded-xl border px-3 py-2 font-serif text-lg ${index === expected
						? "border-amber-500 text-amber-700 dark:text-amber-400"
						: "border-neutral-300 dark:border-white/20"} disabled:opacity-50`}
				>{word}</button>)}
			</div>}
			{expected !== null && !done ? <p role="status" className={NOTE}>That word comes later. The next one is marked.</p> : null}
		</> : null}

		{mode === "typed" ? <>
			<textarea
				value={draft}
				disabled={disabled}
				rows={5}
				aria-label="Type the verse"
				onChange={(event) => edit(event.target.value)}
				className="w-full rounded-xl border border-neutral-300 bg-transparent p-3 font-serif text-lg leading-relaxed dark:border-white/20"
			/>
			<button
				type="button"
				disabled={disabled || !draft.trim()}
				onClick={check}
				className="mt-3 min-h-11 rounded-xl border border-neutral-300 px-4 py-3 text-sm dark:border-white/20 disabled:opacity-50"
			>Check the verse</button>
			{score ? <>
				<p className="mt-6 text-center font-serif text-xl leading-relaxed">
					{score.words.map((word, index) => <span key={index}>
						{index > 0 ? " " : ""}
						{word.result === "match" ? word.expected : null}
						{word.result === "missed" ? <span className="text-amber-700 underline decoration-dotted underline-offset-4 dark:text-amber-400">
							<span className="sr-only">missing word </span>{word.expected}
						</span> : null}
						{word.result === "extra" ? <span className="text-neutral-500 line-through dark:text-neutral-500">
							<span className="sr-only">not in the verse </span>{word.typed}
						</span> : null}
					</span>)}
				</p>
				<p role="status" className={NOTE}>
					{score.perfect ? "Word for word." : "The marked words are the ones to mend."}
				</p>
			</> : null}
		</> : null}

		<p className="mt-8 text-center text-sm text-neutral-600 dark:text-neutral-400">{learnModeHint(mode, stage)}</p>

		<div role="group" aria-label="Practice mode" className="mt-6 flex flex-wrap justify-center gap-2">
			{LEARN_MODES.map((item) => <button
				key={item}
				type="button"
				aria-pressed={item === mode}
				onClick={() => onModeChange(item)}
				className={`min-h-11 rounded-full border px-3 py-2 text-sm ${item === mode
					? "border-amber-500 text-amber-700 dark:text-amber-400"
					: "border-neutral-300 text-neutral-600 dark:border-white/20 dark:text-neutral-400"}`}
			>{LEARN_MODE_LABELS[item]}</button>)}
		</div>
	</>;
}
