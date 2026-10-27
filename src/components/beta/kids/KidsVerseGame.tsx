"use client";

import { useMemo, useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { verseWords } from "@/components/learn/learn";
import { orderRound, tapOrderWord } from "@/components/learn/practice";
import { memoryPlan, type AgeBand, type KidsAdventureView } from "@/lib/beta/kids/kids-rules";
import { seedHash } from "@/lib/quiz-rules";

const VERSE = "font-[family-name:var(--font-cormorant)] text-[clamp(1.9rem,8vw,2.6rem)] font-semibold leading-[1.35]";
const BLANK = "min-h-11 rounded-lg px-1 text-amber-800 underline decoration-dotted decoration-2 underline-offset-[10px] dark:text-[#e5b664]";

const RUNG_HINT = [
	"Read the verse together, out loud.",
	"Say the verse. Tap a blank to see the word.",
	"Some words are hiding. Say it, and tap a blank if you need help.",
	"Say the whole verse. Tap a blank if you need help.",
];

/**
 * The verse to learn, as a children's game on Learn a verse's own ladder
 * (src/components/learn): read it, then say it with more and more of it
 * hidden (Learn's masking stages), then tap its words in order (Learn's "Tap
 * the next word"). How far the ladder goes depends on the age band. Nothing
 * is typed and nothing the child does is stored, except that the verse was
 * learned.
 */
export default function KidsVerseGame({
	adventure,
	band,
	learned,
	onLearned,
	onDone,
}: {
	adventure: KidsAdventureView;
	band: AgeBand;
	learned: boolean;
	onLearned: () => void;
	onDone: () => void;
}) {
	const { text, reference } = adventure.memory;
	const plan = useMemo(() => memoryPlan(band, text.trim().split(/\s+/).length), [band, text]);
	const rungs = plan.stages.length + (plan.order ? 1 : 0);
	const [rung, setRung] = useState(0);
	const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
	const [placed, setPlaced] = useState<number[]>([]);
	const [expected, setExpected] = useState<number | null>(null);
	const [finished, setFinished] = useState(false);
	// Whether the verse was already learned when the game opened: finishing marks it.
	const [learnedBefore] = useState(learned);
	const round = useMemo(() => orderRound(text, seedHash(adventure.id)), [text, adventure.id]);
	const stage = plan.stages[rung];
	const words = useMemo(() => (stage === undefined ? [] : verseWords(text, stage)), [text, stage]);

	const advance = () => {
		setRevealed(new Set());
		if (rung + 1 < rungs) {
			setRung(rung + 1);
			return;
		}
		setFinished(true);
		onLearned();
	};

	const tap = (choice: number) => {
		const result = tapOrderWord(round, placed, choice);
		setPlaced(result.placed);
		setExpected(result.expected);
		if (result.done) {
			setFinished(true);
			onLearned();
		}
	};

	if (finished) {
		return (
			<div className="flex flex-col items-center py-8 text-center" role="status">
				<span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118]" aria-hidden>
					<Check size={52} strokeWidth={2.2} />
				</span>
				<h3 className="mt-5 font-[family-name:var(--font-cormorant)] text-[38px] font-semibold leading-none">{learnedBefore ? "You know it!" : "You learned it!"}</h3>
				<p className={`mt-5 max-w-md ${VERSE} text-[28px]`}>{text}</p>
				<p className="mt-2 text-base font-bold text-amber-900 dark:text-[#e5b664]">{reference}</p>
				<button type="button" onClick={onDone} className="mt-7 min-h-14 rounded-full bg-[#e5b664] px-8 text-lg font-bold text-[#1c2118]">
					More adventures
				</button>
			</div>
		);
	}

	const ordering = stage === undefined;
	const taken = new Set(placed);

	return (
		<div className="flex flex-col items-center text-center">
			<p className="text-sm font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">
				Verse to learn · step {rung + 1} of {rungs}
			</p>
			<p className="mt-1 inline-flex items-center gap-1.5 text-base font-bold text-amber-900 dark:text-[#e5b664]">
				<BookOpen size={18} aria-hidden /> {reference}
			</p>

			{ordering ? (
				<>
					<p className={`mt-6 min-h-[3.5rem] ${VERSE}`} aria-live="polite">{placed.map((choice) => round.choices[choice]).join(" ")}</p>
					<div className="mt-6 flex flex-wrap justify-center gap-2.5" role="group" aria-label="Words of the verse">
						{round.choices.map((word, index) =>
							taken.has(index) ? null : (
								<button
									key={index}
									type="button"
									onClick={() => tap(index)}
									aria-label={`Place ${word}`}
									className={`min-h-14 rounded-[16px] border-2 px-4 font-[family-name:var(--font-cormorant)] text-2xl font-semibold ${
										index === expected ? "border-[#e5b664] bg-[#e5b664]/25" : "border-black/[.12] bg-white/70 dark:border-white/[.14] dark:bg-white/[.05]"
									}`}
								>
									{word}
								</button>
							),
						)}
					</div>
					<p className="mt-6 text-lg leading-7 text-neutral-700 dark:text-[#d9d1c3]" role="status">
						{expected !== null ? "That word comes later. The next one is marked in gold." : "Tap the words in order."}
					</p>
				</>
			) : (
				<>
					<p className={`mt-6 max-w-2xl ${VERSE}`}>
						{words.map((word, index) => (
							<span key={index}>
								{index > 0 ? " " : ""}
								{word.hidden && !revealed.has(index) ? (
									<button type="button" aria-label={`Show word ${index + 1}`} onClick={() => setRevealed((old) => new Set(old).add(index))} className={BLANK}>
										{word.blank}
									</button>
								) : (
									word.text
								)}
							</span>
						))}
					</p>
					<p className="mt-6 text-lg leading-7 text-neutral-700 dark:text-[#d9d1c3]">{RUNG_HINT[stage]}</p>
					<button type="button" onClick={advance} className="mt-6 min-h-14 rounded-full bg-[#e5b664] px-10 text-lg font-bold text-[#1c2118]">
						{rung + 1 < rungs ? "Next" : "I know it!"}
					</button>
				</>
			)}
		</div>
	);
}
