import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BETA_CLASSIC_LINKS, BETA_DESTINATIONS, betaModulesByProgress, betaModulesFor, type BetaDestinationId } from "@/lib/beta/modules";
import BetaModuleCard from "./BetaModuleCard";
import { DESTINATION_TILE, IconTile, SECTION_ICONS } from "./visuals";

/** One beta destination: its modules, then what already ships in SureWord. */
export default function BetaDestinationScreen({ destination }: { destination: BetaDestinationId }) {
	const info = BETA_DESTINATIONS.find((item) => item.id === destination);
	const modules = betaModulesByProgress(betaModulesFor(destination));
	const classic = BETA_CLASSIC_LINKS[destination];
	return (
		<main className="mx-auto w-full max-w-4xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-6 lg:px-8 lg:pb-16 lg:pt-10">
			<header className="flex items-center gap-4">
				<IconTile Icon={SECTION_ICONS[destination]} tone={DESTINATION_TILE[destination]} size="lg" />
				<div>
					<p className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">SureWord Beta</p>
					<h1 className="font-[family-name:var(--font-cormorant)] text-[40px] font-semibold leading-none">{info?.label}</h1>
					<p className="mt-1 text-sm text-neutral-600 dark:text-[#bbb3a7]">{info?.blurb}</p>
				</div>
			</header>

			<section aria-labelledby="beta-destination-modules" className="mt-8">
				<h2 id="beta-destination-modules" className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">Being built</h2>
				<div className="mt-3 flex flex-col gap-3">
					{modules.map((entry) => (
						<BetaModuleCard key={entry.slug} entry={entry} />
					))}
				</div>
			</section>

			<section aria-labelledby="beta-destination-classic" className="mt-9">
				<h2 id="beta-destination-classic" className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">Already in SureWord</h2>
				<ul className="mt-2 divide-y divide-black/[.07] dark:divide-white/[.07]">
					{classic.map((link) => (
						<li key={link.href}>
							<Link href={link.href} className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-1 font-bold text-amber-900 hover:bg-amber-500/5 dark:text-[#e5b664]">
								{link.label}
								<ChevronRight size={18} aria-hidden />
							</Link>
						</li>
					))}
				</ul>
			</section>
		</main>
	);
}
