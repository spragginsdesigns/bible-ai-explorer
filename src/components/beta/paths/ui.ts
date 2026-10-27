/**
 * Learning Paths' shared class strings (LC-17648), on SureWord Beta's own
 * surfaces (docs/beta/README.md, Look and feel): parchment and ink, gold as
 * the one accent, Cormorant headings, 22px cards, 44px touch targets.
 */

export const FOCUS =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f2e9] dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-[#0d100d]";

export const CARD = "rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]";

export const EYEBROW = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";

export const SERIF = "font-[family-name:var(--font-cormorant)]";

export const GOLD_BUTTON = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#e5b664] px-6 text-[16px] font-bold text-[#1c2118] transition-colors hover:bg-[#ecc57e] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#e5b664] ${FOCUS}`;

export const QUIET_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-black/[.12] px-4 text-sm font-bold text-neutral-800 transition-colors hover:bg-black/[.04] disabled:opacity-45 dark:border-white/[.14] dark:text-neutral-100 dark:hover:bg-white/[.05] ${FOCUS}`;

export const TEXT_LINK = `inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 hover:underline dark:text-[#e5b664] ${FOCUS}`;

export const MUTED = "text-neutral-600 dark:text-[#bbb3a7]";

export const PAGE = "mx-auto w-full px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10";

/** The thin gold progress bar under a path's title. */
export const BAR_TRACK = "h-2 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]";
export const BAR_FILL = "h-full rounded-full bg-[#e5b664]";

export const CONCEPT_LABEL: Record<"new" | "learning" | "growing" | "mastered", string> = {
	new: "Not started",
	learning: "Learning",
	growing: "Growing",
	mastered: "Mastered",
};

/** "Lesson 4", "the Romans checkpoint" and so on in URLs. */
export function lessonHref(pathId: string, lessonId: string): string {
	return `/beta/learn/paths/${pathId}/${lessonId}`;
}

export function reviewHref(pathId: string): string {
	return `/beta/learn/paths/${pathId}/review`;
}

export function checkpointHref(pathId: string, unitId: string): string {
	return `/beta/learn/paths/${pathId}/checkpoint?unit=${encodeURIComponent(unitId)}`;
}

export function pathHref(pathId: string): string {
	return `/beta/learn/paths/${pathId}`;
}

/** Where "Continue" goes: the session under way, else the next lesson, else the path. */
export function continueHref(card: { id: string; resume: { kind: string; target: string } | null; next: { id: string } | null }): string {
	if (card.resume?.kind === "lesson") return lessonHref(card.id, card.resume.target);
	if (card.resume?.kind === "checkpoint") return checkpointHref(card.id, card.resume.target);
	if (card.resume?.kind === "review") return reviewHref(card.id);
	if (card.next) return lessonHref(card.id, card.next.id);
	return pathHref(card.id);
}
