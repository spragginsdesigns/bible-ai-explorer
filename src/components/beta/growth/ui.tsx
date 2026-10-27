/**
 * Small pieces the Habits & Reflection cards share: the card surface, the
 * section label, the buttons and the habit ring. SureWord's surfaces, gold as
 * the one accent (kept days and the primary action), never red for a day
 * that was not kept (docs/beta/README.md, Look and feel).
 */

import { ringFraction } from "@/lib/beta/growth/growth-rules";

export const card = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const eyebrow = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
export const cardTitle = "font-[family-name:var(--font-cormorant)] text-[26px] font-semibold leading-tight";
export const muted = "text-neutral-600 dark:text-[#bbb3a7]";
export const goldButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#e5b664] px-5 text-sm font-bold text-[#1c2118] transition-opacity hover:opacity-90 disabled:opacity-40";
export const quietButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/10 px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/15 dark:text-[#f1eadc] dark:hover:bg-white/[.05]";
export const textButton =
	"inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-bold text-amber-800 hover:underline disabled:opacity-40 dark:text-[#e5b664]";
export const field =
	"w-full rounded-xl border border-black/15 bg-white/60 px-3.5 py-2.5 text-base outline-none placeholder:text-neutral-500 focus:border-amber-700/50 dark:border-white/15 dark:bg-white/[.04] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/50";

/**
 * The board's "4 of 5 days" ring. Keeping a habit more than planned is a full
 * ring, nothing more: there is no score to beat.
 */
export function ProgressRing({ count, target, label }: { count: number; target: number; label: string }) {
	const radius = 17;
	const circumference = 2 * Math.PI * radius;
	const fraction = ringFraction(count, target);
	return (
		<span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center" role="img" aria-label={label}>
			<svg viewBox="0 0 44 44" className="absolute inset-0 h-11 w-11 -rotate-90" aria-hidden>
				<circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" className="stroke-black/[.08] dark:stroke-white/[.1]" />
				{fraction > 0 && (
					<circle
						cx="22"
						cy="22"
						r={radius}
						fill="none"
						strokeWidth="4"
						strokeLinecap="round"
						stroke="#e5b664"
						strokeDasharray={`${fraction * circumference} ${circumference}`}
					/>
				)}
			</svg>
			<span className="text-xs font-bold tabular-nums" aria-hidden>{count}</span>
		</span>
	);
}

export function ErrorNote({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
	return (
		<p role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-amber-700/25 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-950 dark:border-amber-300/25 dark:text-amber-100">
			<span>{message}</span>
			{onDismiss && (
				<button type="button" onClick={onDismiss} className="-my-2 min-h-11 shrink-0 px-1 font-bold underline">
					OK
				</button>
			)}
		</p>
	);
}
