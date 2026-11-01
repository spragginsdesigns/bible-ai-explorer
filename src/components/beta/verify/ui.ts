/**
 * Scripture Check's class strings (LC-17649), on SureWord Beta's own surfaces
 * (docs/beta/README.md, Look and feel): parchment and ink, gold as the one
 * accent, Cormorant headings, 22px cards, 44px touch targets. Scripture and
 * the teaching's words each have one look, so the two never blur.
 */
import type { Mark, Verdict } from "@/lib/beta/verify/verify-rules";

export const FOCUS =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f2e9] dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-[#0d100d]";
export const CARD = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const EYEBROW = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
export const SERIF = "font-[family-name:var(--font-cormorant)]";
export const MUTED = "text-neutral-600 dark:text-[#bbb3a7]";
export const GOLD_BUTTON = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#e5b664] px-6 text-[16px] font-bold text-[#1c2118] transition-colors hover:bg-[#ecc57e] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#e5b664] ${FOCUS}`;
export const QUIET_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-black/[.12] px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-black/[.04] disabled:opacity-45 dark:border-white/[.14] dark:text-neutral-100 dark:hover:bg-white/[.05] ${FOCUS}`;
export const TEXT_LINK = `inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664] ${FOCUS}`;

/** Scripture: the bundled text's words, serif, on a gold rule. */
export const SCRIPTURE = "border-l-2 border-[#e5b664] pl-4";
export const SCRIPTURE_TEXT = `${SERIF} text-[19px] leading-8 text-neutral-900 dark:text-[#f1eadc]`;
/** The teaching's words: sans, on a dashed neutral rule. */
export const TEACHING = "border-l-2 border-dashed border-neutral-400 pl-4 dark:border-neutral-500";
export const TEACHING_TEXT = "text-[15px] leading-7 text-neutral-800 dark:text-[#d6cfc2]";

export const VERDICT_CHIP: Record<Verdict, string> = {
	exact: "bg-emerald-600/10 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
	minor: "bg-sky-600/10 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
	translation: "bg-neutral-500/10 text-neutral-800 dark:bg-white/10 dark:text-neutral-200",
	misquote: "bg-rose-600/10 text-rose-900 dark:bg-rose-400/15 dark:text-rose-200",
	"wrong-reference": "bg-orange-600/10 text-orange-900 dark:bg-orange-400/15 dark:text-orange-200",
	"not-found": "bg-rose-700/15 text-rose-950 dark:bg-rose-500/20 dark:text-rose-100",
};

/** How each word is marked. Colour is never the only signal: changed words carry a screen-reader note and an underline. */
export const MARK_CLASS: Record<Mark, string> = {
	same: "",
	minor: "underline decoration-sky-600 decoration-dotted decoration-2 underline-offset-4 dark:decoration-sky-300",
	changed: "rounded bg-rose-500/15 px-0.5 underline decoration-rose-600 decoration-2 underline-offset-4 dark:bg-rose-400/20 dark:decoration-rose-300",
	added: "rounded bg-rose-500/15 px-0.5 underline decoration-rose-600 decoration-wavy underline-offset-4 dark:bg-rose-400/20 dark:decoration-rose-300",
	missing: "rounded bg-amber-400/30 px-0.5 font-semibold dark:bg-amber-300/20",
	omitted: "text-neutral-500 dark:text-neutral-400",
	outside: "text-neutral-500 dark:text-neutral-400",
};

export const MARK_NOTE: Partial<Record<Mark, string>> = {
	minor: "minor difference",
	changed: "different word",
	added: "not in this verse",
	missing: "left out",
	omitted: "left out where the quotation marks it",
};

export function readerHref(book: number, chapter: number, verse?: number | null): string {
	return `/bible/chapter?book=${book}&chapter=${chapter}&verse=${verse ?? 1}&translation=KJV`;
}
