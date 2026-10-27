import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PathCardView } from "@/lib/beta/paths/view-types";
import PathArt from "./PathArt";
import ProgressBar from "./ProgressBar";
import { CARD, FOCUS, MUTED, SERIF, pathHref } from "./ui";

/** One path on the hub: its banner, size and audience, and how far the founder has come. */
export default function PathCard({ card }: { card: PathCardView }) {
	return (
		<Link
			href={pathHref(card.id)}
			className={`${CARD} group flex flex-col overflow-hidden transition-colors hover:border-amber-700/30 dark:hover:border-amber-300/30 ${FOCUS}`}
		>
			<div className="relative h-28 sm:h-32">
				<PathArt pathId={card.id} className="absolute inset-0 h-full w-full" />
				<div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
				<h3 className={`${SERIF} absolute inset-x-0 bottom-0 px-4 pb-3 text-[25px] font-semibold leading-[1.1] text-white`}>{card.title}</h3>
			</div>
			<div className="flex flex-1 flex-col px-4 pb-4 pt-3">
				<p className={`text-sm font-bold ${MUTED}`}>
					{card.lessonCount} lessons · {card.personal ? "Personal curriculum" : card.audience}
				</p>
				<p className="mt-1 flex-1 text-[15px] leading-6">{card.tagline}</p>
				{card.started ? (
					<div className="mt-3 flex items-center gap-3">
						<ProgressBar percent={card.percent} label={`${card.title} progress`} className="flex-1" />
						<span className="text-sm font-bold tabular-nums">{card.percent}%</span>
					</div>
				) : (
					<span className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-[#e5b664]">
						Start the path <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
					</span>
				)}
			</div>
		</Link>
	);
}
