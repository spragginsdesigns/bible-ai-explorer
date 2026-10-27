"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, MessageCircleQuestion, Puzzle, Star } from "lucide-react";
import type { AgeBand, KidsAdventureView } from "@/lib/beta/kids/kids-rules";
import { adventureIcon } from "./adventure-icons";
import KidsQuiz from "./KidsQuiz";
import KidsStory from "./KidsStory";
import KidsVerseGame from "./KidsVerseGame";
import { usePassageAudio } from "./usePassageAudio";

type Step = "story" | "questions" | "verse";

const STEPS: { id: Step; label: string; Icon: typeof BookOpen }[] = [
	{ id: "story", label: "Story", Icon: BookOpen },
	{ id: "questions", label: "Questions", Icon: MessageCircleQuestion },
	{ id: "verse", label: "Verse", Icon: Puzzle },
];

/**
 * One Bible adventure in Kids mode: the story (read aloud, retold for the
 * child's age, the KJV beside it), its questions, and its verse to learn,
 * reached from the three big buttons at the bottom.
 */
export default function KidsAdventure({
	adventure,
	band,
	star,
	learned,
	onStar,
	onLearned,
	onDone,
}: {
	adventure: KidsAdventureView;
	band: AgeBand;
	star: boolean;
	learned: boolean;
	onStar: () => void;
	onLearned: () => void;
	onDone: () => void;
}) {
	const [step, setStep] = useState<Step>("story");
	const root = useRef<HTMLDivElement>(null);
	const audio = usePassageAudio(adventure.book, adventure.segments);
	const Icon = adventureIcon(adventure.id);
	const { stop } = audio;

	// The narration belongs to the story; questions and the verse game are quiet.
	useEffect(() => {
		if (step !== "story") stop();
	}, [step, stop]);

	// Each step opens at its top; Kids mode's scroller is this screen's parent.
	useEffect(() => {
		root.current?.parentElement?.scrollTo({ top: 0 });
	}, [step]);

	return (
		<div ref={root} className="flex flex-1 flex-col">
			<div className="mx-auto w-full max-w-5xl flex-1 px-5 pb-8 pt-2 lg:px-8">
				<header className="flex items-center gap-4">
					<span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-violet-500/[.12] text-violet-800 dark:bg-violet-300/[.12] dark:text-violet-200" aria-hidden>
						<Icon size={30} strokeWidth={1.7} />
					</span>
					<div className="min-w-0">
						<h2 className="font-[family-name:var(--font-cormorant)] text-[clamp(2rem,8vw,2.8rem)] font-semibold leading-[1.02]">{adventure.title}</h2>
						<p className="mt-1 text-[15px] font-semibold text-neutral-600 dark:text-[#b3ad9e]">{adventure.reference}</p>
					</div>
				</header>

				<div className="mt-6">
					{step === "story" ? <KidsStory adventure={adventure} audio={audio} /> : null}
					{step === "questions" ? <KidsQuiz adventure={adventure} earned={star} onFinished={onStar} onNext={() => setStep("verse")} /> : null}
					{step === "verse" ? <KidsVerseGame adventure={adventure} band={band} learned={learned} onLearned={onLearned} onDone={onDone} /> : null}
				</div>
			</div>

			<nav aria-label="Adventure steps" className="sticky bottom-0 border-t border-black/[.08] bg-[#f6f2e9] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 dark:border-white/[.08] dark:bg-[#0d100d]">
				<div className="mx-auto grid max-w-xl grid-cols-3 gap-2.5">
					{STEPS.map(({ id, label, Icon: StepIcon }) => {
						const active = id === step;
						const mark = id === "questions" ? star : id === "verse" ? learned : false;
						return (
							<button
								key={id}
								type="button"
								onClick={() => setStep(id)}
								aria-current={active ? "step" : undefined}
								className={`relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-[18px] border-2 text-base font-bold transition-colors ${
									active ? "border-[#e5b664] bg-[#e5b664] text-[#1c2118]" : "border-black/[.12] bg-[#fcfaf6] dark:border-white/[.14] dark:bg-[#171a17]"
								}`}
							>
								<StepIcon size={22} strokeWidth={1.9} aria-hidden />
								{label}
								{mark ? (
									<span className="absolute right-2 top-2 text-amber-700 dark:text-[#e5b664]" aria-label={id === "questions" ? "Star earned" : "Verse learned"}>
										{id === "questions" ? <Star size={16} fill="currentColor" aria-hidden /> : <Check size={16} strokeWidth={3} aria-hidden />}
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			</nav>
		</div>
	);
}
