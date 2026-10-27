import Link from "next/link";

const OPTIONS = [
	{ id: "regular", href: "/today", label: "SureWord" },
	{ id: "beta", href: "/beta", label: "Beta" },
] as const;

/**
 * The founders' toggle between regular SureWord and SureWord Beta (LC-17639):
 * the same two-way switch in the settings menu, which only founders see, and
 * in the beta's rail and phone header. The version you are in is marked and
 * is not a link; the other one takes you there.
 */
export default function BetaVersionSwitch({ current, compact = false, className = "" }: { current: "regular" | "beta"; compact?: boolean; className?: string }) {
	const option = compact ? "min-h-11 px-3 text-[13px]" : "min-h-11 flex-1 px-3 text-sm";
	return (
		<nav aria-label="SureWord version" className={`flex rounded-full border border-black/10 bg-black/[.04] p-1 dark:border-white/10 dark:bg-white/[.04] ${className}`}>
			{OPTIONS.map(({ id, href, label }) =>
				id === current ? (
					<span key={id} aria-current="true" className={`flex items-center justify-center rounded-full bg-[#24281f] font-bold text-white dark:bg-[#e5b664] dark:text-[#1c2118] ${option}`}>
						{label}
					</span>
				) : (
					<Link key={id} href={href} className={`flex items-center justify-center rounded-full font-bold text-neutral-600 hover:bg-black/5 hover:text-neutral-900 focus-visible:outline-amber-600 dark:text-neutral-300 dark:hover:bg-white/5 dark:hover:text-neutral-100 ${option}`}>
						{label}
					</Link>
				),
			)}
		</nav>
	);
}
