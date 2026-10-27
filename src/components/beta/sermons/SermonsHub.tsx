import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { formatClock } from "@/lib/beta/sermons/sermons-rules";
import type { SermonCardView } from "@/lib/beta/sermons/view-types";
import { DESTINATION_TILE, IconTile, moduleIcon } from "../visuals";
import SermonCapture from "./SermonCapture";
import { CARD, MUTED, PAGE, SERIF, TEXT_LINK, sermonHref } from "./ui";

function SermonCard({ card }: { card: SermonCardView }) {
	const facts = [
		card.preacher,
		formatClock(card.durationSec),
		card.status === "transcribing" ? "Transcription not finished" : `${card.passageCount} ${card.passageCount === 1 ? "passage" : "passages"}`,
		card.hasStudy ? "Study written" : null,
		card.research > 0 ? `${card.research} to research` : null,
	].filter(Boolean);
	return (
		<Link href={sermonHref(card.id)} className={`${CARD} flex min-h-11 items-center gap-4 p-4 transition-colors hover:bg-white/60 dark:hover:bg-white/[.05]`}>
			<div className="min-w-0 flex-1">
				<p className={`${SERIF} text-[23px] font-semibold leading-tight`}>{card.title}</p>
				<p className={`mt-1 text-sm ${MUTED}`}>{facts.join(" · ")}</p>
				{card.passages.length > 0 && <p className="mt-1.5 truncate text-sm font-semibold text-amber-800 dark:text-[#e5b664]">{card.passages.join(", ")}{card.passageCount > card.passages.length ? "…" : ""}</p>}
			</div>
			<ChevronRight size={20} className="shrink-0 opacity-60" aria-hidden />
		</Link>
	);
}

/** Sermon to Study's home (LC-17643): add a sermon, and the sermons already studied. */
export default function SermonsHub({ sermons }: { sermons: SermonCardView[] }) {
	return (
		<main className={`${PAGE} max-w-4xl`}>
			<Link href="/beta/study" className={`-ml-2 rounded-lg px-2 ${TEXT_LINK} text-neutral-600 dark:text-[#bbb3a7]`}>
				<ArrowLeft size={18} aria-hidden /> Study
			</Link>
			<header className="mt-2 flex items-center gap-4">
				<IconTile Icon={moduleIcon("sermons", "study")} tone={DESTINATION_TILE.study} size="lg" />
				<div className="min-w-0">
					<h1 className={`${SERIF} text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]`}>Sermon to Study</h1>
					<p className={`mt-1 text-[15px] leading-6 ${MUTED}`}>Turn a sermon into a study you can keep, with the preacher&apos;s words always kept apart from Scripture.</p>
				</div>
			</header>
			<div className="mt-7">
				<SermonCapture />
			</div>
			<section aria-labelledby="sermons-saved" className="mt-10">
				<h2 id="sermons-saved" className={`${SERIF} text-[30px] font-semibold leading-tight`}>Your sermons</h2>
				{sermons.length === 0 ? (
					<p className={`mt-2 text-[15px] ${MUTED}`}>Nothing yet. A sermon you add appears here, and in your Knowledge Vault.</p>
				) : (
					<div className="mt-4 grid gap-3">
						{sermons.map((card) => (
							<SermonCard key={card.id} card={card} />
						))}
					</div>
				)}
			</section>
			<p className={`mt-8 text-center text-xs ${MUTED}`}>
				Looking for your church&apos;s published sermon studies? They are in <Link href="/sermons" className="font-bold underline">Sermon studies</Link>.
			</p>
		</main>
	);
}
