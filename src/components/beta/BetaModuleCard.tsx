import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { betaModuleHref, type BetaModule } from "@/lib/beta/modules";
import { DESTINATION_TILE, IconTile, StatusChip, moduleIcon } from "./visuals";

/** One module as a tappable row: icon tile, title, tagline, status. */
export default function BetaModuleCard({ entry, compact = false }: { entry: BetaModule; compact?: boolean }) {
	return (
		<Link
			href={betaModuleHref(entry)}
			className={`group flex w-full items-center gap-4 rounded-[22px] border border-black/[.09] bg-white/35 px-4 text-left transition-colors hover:border-amber-700/30 hover:bg-white/70 focus-visible:outline-amber-600 dark:border-white/[.09] dark:bg-white/[.025] dark:hover:border-amber-300/30 dark:hover:bg-white/[.05] ${compact ? "min-h-16 py-3" : "min-h-24 py-4"}`}
		>
			<IconTile Icon={moduleIcon(entry.slug, entry.destination)} tone={DESTINATION_TILE[entry.destination]} />
			<span className="min-w-0 flex-1">
				<span className="block font-bold leading-snug">{entry.title}</span>
				{!compact && <span className="mt-1 block text-sm leading-5 text-neutral-600 dark:text-[#bbb3a7]">{entry.tagline}</span>}
				{/* Under the text on a phone, so the title and tagline keep the width. */}
				<span className="mt-2 block sm:hidden"><StatusChip status={entry.status} /></span>
			</span>
			<span className="hidden sm:inline-flex"><StatusChip status={entry.status} /></span>
			<ChevronRight size={20} className="shrink-0 text-neutral-500 transition-transform group-hover:translate-x-1" aria-hidden />
		</Link>
	);
}
