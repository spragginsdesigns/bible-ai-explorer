"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BETA_DESTINATIONS, betaSectionForPath } from "@/lib/beta/modules";
import BetaVersionSwitch from "./BetaVersionSwitch";
import { SECTION_ICONS } from "./visuals";
import tabStyles from "../MobileBottomNav.module.css";

/** The small gold mark that says which SureWord you are in. */
function BetaPill() {
	return (
		<span className="rounded-full border border-amber-700/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold tracking-wide text-amber-900 dark:border-amber-300/30 dark:text-amber-200">
			Beta
		</span>
	);
}

/**
 * The founders-only beta's frame (docs/beta/README.md): a left rail on
 * desktop, a header and the same tab bar as the main app on mobile, with
 * Home, Bible, Study, Library and Learn. Only rendered after
 * `requireBetaPage()` has passed in the layout.
 */
export default function BetaShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const active = betaSectionForPath(pathname);
	return (
		<div className="min-h-[100dvh] bg-[#f6f2e9] text-[#24281f] dark:bg-[#0d100d] dark:text-[#f1eadc]">
			<aside className="liquid-glass-panel fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col lg:flex">
				<div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
					<Image src="/favicon-96x96.png" alt="" width={32} height={32} unoptimized className="shrink-0" />
					<Link href="/beta" className="font-[family-name:var(--font-pirata)] text-[23px] leading-none text-amber-700 dark:text-amber-300">
						SureWord
					</Link>
					<BetaPill />
				</div>
				<nav aria-label="Beta" className="flex flex-col gap-1 px-3">
					{BETA_DESTINATIONS.map(({ id, href, label, blurb }) => {
						const Icon = SECTION_ICONS[id];
						const isActive = active === id;
						return (
							<Link
								key={id}
								href={href}
								aria-current={isActive ? "page" : undefined}
								className={`flex items-center gap-3 rounded-[14px] border px-3 py-2.5 transition-colors ${
									isActive
										? "sidebar-glass-control text-amber-700 dark:text-amber-300"
										: "border-transparent text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.04] dark:hover:text-neutral-100"
								}`}
							>
								<Icon size={19} strokeWidth={1.8} aria-hidden />
								<span className="min-w-0">
									<span className="block text-control font-bold leading-tight">{label}</span>
									<span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{blurb}</span>
								</span>
							</Link>
						);
					})}
				</nav>
				<div className="mt-auto border-t border-black/[0.06] px-3 py-4 dark:border-white/[0.06]">
					<p className="px-3 pb-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">A private preview for the SureWord founders.</p>
					<BetaVersionSwitch current="beta" className="w-full" />
				</div>
			</aside>

			<div className="lg:pl-[248px]">
				<header className="relative z-30 mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-3 lg:hidden">
					<Link href="/beta" className="flex min-h-12 items-center gap-2.5" aria-label="SureWord Beta home">
						<span className="font-[family-name:var(--font-pirata)] text-[30px] leading-none text-neutral-900 dark:text-[#f1eadc]">SureWord</span>
					</Link>
					{/* The switch says which SureWord this is, so the phone header drops the Beta pill. */}
					<BetaVersionSwitch current="beta" compact />
				</header>
				{children}
			</div>

			<nav aria-label="Beta" className={tabStyles.nav}>
				<div className={tabStyles.tabs}>
					{BETA_DESTINATIONS.map(({ id, href, label }) => {
						const Icon = SECTION_ICONS[id];
						const isActive = active === id;
						return (
							<Link key={id} href={href} aria-current={isActive ? "page" : undefined} className={isActive ? tabStyles.active : undefined}>
								<Icon size={24} strokeWidth={1.7} aria-hidden />
								<span>{label}</span>
							</Link>
						);
					})}
				</div>
			</nav>
		</div>
	);
}
