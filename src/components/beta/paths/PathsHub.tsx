import Link from "next/link";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import type { PathCardView } from "@/lib/beta/paths/view-types";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import CurriculumBuilder from "./CurriculumBuilder";
import PathArt from "./PathArt";
import PathCard from "./PathCard";
import ProgressBar from "./ProgressBar";
import { CARD, EYEBROW, GOLD_BUTTON, MUTED, PAGE, SERIF, TEXT_LINK, continueHref, reviewHref } from "./ui";

/** The path the founder was last on that still has something to do. */
function continueCard(cards: PathCardView[]): PathCardView | null {
	const open = cards.filter((card) => card.started && (card.resume || card.next || card.reviewCount > 0));
	return open.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0] ?? null;
}

function ContinueCard({ card }: { card: PathCardView }) {
	const line = card.resume
		? `${card.resume.title}, question ${card.resume.at} of ${card.resume.of}`
		: card.next
			? `Lesson ${card.next.number}: ${card.next.title}`
			: "Every lesson done. Review what you missed.";
	return (
		<section aria-labelledby="paths-continue" className="overflow-hidden rounded-[26px] border border-amber-900/10 bg-white/30 dark:border-amber-200/10 dark:bg-white/[.02]">
			<div className="grid sm:grid-cols-[220px_1fr]">
				<div className="relative h-32 sm:h-full">
					<PathArt pathId={card.id} className="absolute inset-0 h-full w-full" />
				</div>
				<div className="p-5">
					<h2 id="paths-continue" className={EYEBROW}>{card.resume ? "Pick up where you left off" : "Continue"}</h2>
					<p className={`${SERIF} mt-1 text-[28px] font-semibold leading-tight`}>{card.title}</p>
					<p className={`mt-1 text-[15px] ${MUTED}`}>{line}</p>
					<div className="mt-3 flex items-center gap-3">
						<ProgressBar percent={card.percent} label={`${card.title} progress`} className="flex-1" />
						<span className="text-sm font-bold tabular-nums">{card.done} of {card.lessonCount}</span>
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-3">
						<Link href={card.resume || card.next ? continueHref(card) : reviewHref(card.id)} className={GOLD_BUTTON}>
							{card.resume ? "Resume" : card.next ? "Continue" : "Review"} <ArrowRight size={18} aria-hidden />
						</Link>
						{card.reviewCount > 0 && (card.resume || card.next) && (
							<Link href={reviewHref(card.id)} className={TEXT_LINK}>
								<RotateCcw size={16} aria-hidden /> {card.reviewCount} to review
							</Link>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

/** /beta/learn/paths: continue, the written paths, and the founder's own curricula. */
export default function PathsHub({ written, personal }: { written: PathCardView[]; personal: PathCardView[] }) {
	const resume = continueCard([...written, ...personal]);
	return (
		<main className={`${PAGE} max-w-5xl`}>
			<Link href="/beta/learn" className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> Learn
			</Link>
			<header className="mt-2 flex items-center gap-4">
				<IconTile Icon={moduleIcon("paths", "learn")} tone={DESTINATION_TILE.learn} size="lg" />
				<div className="min-w-0">
					<h1 className={`${SERIF} text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]`}>Learning Paths</h1>
					<p className={`mt-1 text-[15px] leading-6 ${MUTED}`}>Guided journeys through Scripture, one short lesson at a time. Every answer is a verse.</p>
				</div>
			</header>

			{resume && (
				<div className="mt-7">
					<ContinueCard card={resume} />
				</div>
			)}

			<section aria-labelledby="paths-written" className="mt-9">
				<h2 id="paths-written" className={`${SERIF} text-[30px] font-semibold leading-tight`}>Paths</h2>
				<p className={`mt-1 text-sm ${MUTED}`}>Written and checked verse by verse against the King James Bible.</p>
				<div className="mt-4 grid gap-4 sm:grid-cols-2">
					{written.map((card) => (
						<PathCard key={card.id} card={card} />
					))}
				</div>
			</section>

			<section aria-labelledby="paths-personal" className={`${CARD} mt-10 p-5 sm:p-6`}>
				<h2 id="paths-personal" className={`${SERIF} text-[30px] font-semibold leading-tight`}>Your own curriculum</h2>
				<p className={`mt-1 max-w-2xl text-[15px] leading-6 ${MUTED}`}>
					Name anything you want to understand and SureWord builds a path through Scripture for it, laying the foundations first. Each lesson is written the first time you open it, and every answer is checked against the verse.
				</p>
				<CurriculumBuilder />
				{personal.length > 0 && (
					<div className="mt-6 grid gap-4 sm:grid-cols-2">
						{personal.map((card) => (
							<PathCard key={card.id} card={card} />
						))}
					</div>
				)}
			</section>
			<p className={`mt-8 text-center text-xs ${MUTED}`}>No hearts, no streaks to lose. Questions you miss simply come back until they stick.</p>
		</main>
	);
}
