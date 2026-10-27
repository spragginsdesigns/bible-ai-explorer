/**
 * Sermon to Study's class strings (LC-17643), on SureWord Beta's own surfaces
 * (docs/beta/README.md, Look and feel): parchment and ink, gold as the one
 * accent, Cormorant headings, 22px cards, 44px touch targets. Scripture and
 * the sermon's words each have one look, used everywhere, so they never blur.
 */

export const FOCUS =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f2e9] dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-[#0d100d]";
export const CARD = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";
export const EYEBROW = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
export const SERIF = "font-[family-name:var(--font-cormorant)]";
export const MUTED = "text-neutral-600 dark:text-[#bbb3a7]";
export const PAGE = "mx-auto w-full px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10";
export const GOLD_BUTTON = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#e5b664] px-6 text-[16px] font-bold text-[#1c2118] transition-colors hover:bg-[#ecc57e] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#e5b664] ${FOCUS}`;
export const QUIET_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-black/[.12] px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-black/[.04] disabled:opacity-45 dark:border-white/[.14] dark:text-neutral-100 dark:hover:bg-white/[.05] ${FOCUS}`;
export const TEXT_LINK = `inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664] ${FOCUS}`;
export const INPUT = `min-h-12 w-full rounded-2xl border border-black/[.12] bg-white/60 px-4 text-[16px] text-neutral-900 placeholder:text-neutral-500 dark:border-white/[.14] dark:bg-white/[.04] dark:text-neutral-100 ${FOCUS}`;

/** Scripture: the KJV's words, serif, on a gold rule. */
export const SCRIPTURE = "border-l-2 border-[#e5b664] pl-4";
export const SCRIPTURE_TEXT = `${SERIF} text-[19px] leading-7 text-neutral-900 dark:text-[#f1eadc]`;
/** The sermon's words: sans, quoted, on a dashed neutral rule. */
export const SERMON_WORDS = "border-l-2 border-dashed border-neutral-400 pl-4 dark:border-neutral-500";
export const SERMON_TEXT = "text-[15px] italic leading-6 text-neutral-700 dark:text-[#d6cfc2]";

export function readerHref(book: number, chapter: number, verse?: number | null): string {
	return `/bible/chapter?book=${book}&chapter=${chapter}&verse=${verse ?? 1}&translation=KJV`;
}

export function sermonHref(id: string): string {
	return `/beta/study/sermons/${id}`;
}
