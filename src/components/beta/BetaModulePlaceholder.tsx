import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { BETA_DESTINATIONS, findBetaModule, type BetaDestinationId } from "@/lib/beta/modules";
import { DESTINATION_TILE, IconTile, StatusChip, moduleIcon } from "./visuals";

/**
 * What a module's page shows until that module ships its own route
 * (`src/app/beta/<destination>/<slug>/page.tsx`, which outranks the dynamic
 * `[slug]` route this renders from). Unknown slugs are a 404.
 */
export default function BetaModulePlaceholder({ destination, slug }: { destination: BetaDestinationId; slug: string }) {
	const entry = findBetaModule(destination, slug);
	if (!entry) notFound();
	const home = BETA_DESTINATIONS.find((item) => item.id === destination);
	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href={home?.href ?? "/beta"} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> {home?.label}
			</Link>

			<header className="mt-3 flex items-start gap-4">
				<IconTile Icon={moduleIcon(entry.slug, entry.destination)} tone={DESTINATION_TILE[entry.destination]} size="lg" />
				<div className="min-w-0">
					<h1 className="font-[family-name:var(--font-cormorant)] text-[clamp(2.2rem,8vw,2.9rem)] font-semibold leading-[1.02]">{entry.title}</h1>
					<p className="mt-1.5 text-base text-neutral-700 dark:text-[#d9d1c3]">{entry.tagline}</p>
					<div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-neutral-600 dark:text-[#b3ad9e]">
						<StatusChip status={entry.status} />
						<span>Inspired by {entry.inspiredBy}</span>
					</div>
				</div>
			</header>

			<p className="mt-6 text-[17px] leading-7">{entry.summary}</p>

			<section aria-labelledby="beta-module-capabilities" className="mt-7 rounded-[22px] border border-black/[.09] bg-white/35 p-5 dark:border-white/[.09] dark:bg-white/[.025]">
				<h2 id="beta-module-capabilities" className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">What you will be able to do</h2>
				<ul className="mt-3 space-y-3">
					{entry.capabilities.map((item) => (
						<li key={item} className="flex gap-3 leading-6">
							<Check size={18} className="mt-1 shrink-0 text-amber-700 dark:text-[#e5b664]" aria-hidden />
							<span>{item}</span>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="beta-module-built-on" className="mt-5">
				<h2 id="beta-module-built-on" className="text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]">Built on what SureWord already has</h2>
				<ul className="mt-3 flex flex-wrap gap-2">
					{entry.builtOn.map((item) => (
						<li key={item} className="rounded-full border border-black/10 px-3 py-1 text-sm dark:border-white/10">{item}</li>
					))}
				</ul>
			</section>

			<p className="mt-8 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">
				{entry.status === "planned"
					? "This one is still in the workshop. This page becomes the real thing as soon as it ships."
					: "This one is being built now. This page becomes the real thing as soon as it ships."}
			</p>
		</main>
	);
}
