"use client";

import { useState } from "react";
import { Check, Star } from "lucide-react";
import type { KidsAdventureView } from "@/lib/beta/kids/kids-rules";
import { verseLabel } from "./KidsStory";

const CHOICE = "flex min-h-16 w-full items-center rounded-[18px] border-2 px-5 py-3 text-left text-lg font-semibold leading-6 transition-colors";

/**
 * The adventure's questions, one at a time (docs/beta/kids.md). The answer is
 * always in the verse, so after every choice the child sees the verse that
 * says it. A wrong choice is crossed out and the child tries again; once every
 * question is answered the adventure's star is earned.
 */
export default function KidsQuiz({
	adventure,
	earned,
	onFinished,
	onNext,
}: {
	adventure: KidsAdventureView;
	earned: boolean;
	onFinished: () => void;
	onNext: () => void;
}) {
	const [index, setIndex] = useState(0);
	const [wrong, setWrong] = useState<ReadonlySet<number>>(new Set());
	const [right, setRight] = useState(false);
	const [done, setDone] = useState(false);
	// Whether the star was already earned when these questions opened: finishing adds it.
	const [earnedBefore] = useState(earned);
	const question = adventure.questions[index];
	const proof = question
		? question.verses.map((key) => adventure.verses.find((verse) => verse.key === key)).filter((verse) => verse !== undefined)
		: [];

	const choose = (option: number) => {
		if (right || wrong.has(option)) return;
		if (option === question.answerIndex) setRight(true);
		else setWrong((old) => new Set(old).add(option));
	};

	const next = () => {
		if (index + 1 < adventure.questions.length) {
			setIndex(index + 1);
			setWrong(new Set());
			setRight(false);
			return;
		}
		setDone(true);
		onFinished();
	};

	if (done) {
		return (
			<div className="flex flex-col items-center py-8 text-center" role="status">
				<span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118]" aria-hidden>
					<Star size={48} strokeWidth={1.6} fill="currentColor" />
				</span>
				<h3 className="mt-5 font-[family-name:var(--font-cormorant)] text-[38px] font-semibold leading-none">
					{earnedBefore ? "You did it again!" : "You earned a star!"}
				</h3>
				<p className="mt-3 max-w-xs text-lg leading-7 text-neutral-700 dark:text-[#d9d1c3]">You answered every question from the Bible.</p>
				<button type="button" onClick={onNext} className="mt-7 min-h-14 rounded-full bg-[#e5b664] px-8 text-lg font-bold text-[#1c2118]">
					Learn the verse
				</button>
			</div>
		);
	}

	return (
		<div>
			<p className="text-sm font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">
				Question {index + 1} of {adventure.questions.length}
			</p>
			<h3 className="mt-2 text-[24px] font-semibold leading-8">{question.prompt}</h3>
			<div className="mt-5 flex flex-col gap-3" role="group" aria-label="Choices">
				{question.options.map((option, optionIndex) => {
					const isRight = right && optionIndex === question.answerIndex;
					const isWrong = wrong.has(optionIndex);
					return (
						<button
							key={option}
							type="button"
							onClick={() => choose(optionIndex)}
							aria-disabled={right || isWrong}
							className={`${CHOICE} ${
								isRight
									? "border-[#e5b664] bg-[#e5b664]/30"
									: isWrong
										? "border-black/[.08] text-neutral-500 line-through dark:border-white/[.08] dark:text-neutral-500"
										: "border-black/[.12] bg-white/70 active:bg-[#e5b664]/20 dark:border-white/[.14] dark:bg-white/[.05]"
							}`}
						>
							<span className="flex-1">{option}</span>
							{isRight ? <Check size={26} className="shrink-0 text-amber-800 dark:text-[#e5b664]" aria-label="Right" /> : null}
						</button>
					);
				})}
			</div>

			{right || wrong.size > 0 ? (
				<div className="mt-6 rounded-[22px] border border-black/[.09] bg-white/60 p-5 dark:border-white/[.09] dark:bg-white/[.04]" role="status">
					<p className="text-base font-bold">{right ? "Yes! The Bible says:" : "Not quite. Let’s look at the verse:"}</p>
					{proof.map((verse) => (
						<p key={verse.key} className="mt-2 font-[family-name:var(--font-cormorant)] text-[22px] leading-8">
							<sup className="mr-1 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verseLabel(adventure, verse)}</sup>
							{verse.text}
						</p>
					))}
					{right ? (
						<button type="button" onClick={next} className="mt-5 min-h-14 w-full rounded-full bg-[#e5b664] text-lg font-bold text-[#1c2118]">
							{index + 1 < adventure.questions.length ? "Next question" : "Finish"}
						</button>
					) : (
						<p className="mt-3 text-base text-neutral-700 dark:text-[#d9d1c3]">Try another answer.</p>
					)}
				</div>
			) : null}
		</div>
	);
}
