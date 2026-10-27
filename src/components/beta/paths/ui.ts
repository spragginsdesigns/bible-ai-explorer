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

/** Where Learning Paths' pages live. SureWord Academy (LC-17660) serves its courses from /beta/learn/academy. */
export const PATHS_BASE = "/beta/learn/paths";

/** "Lesson 4", "the Romans checkpoint" and so on in URLs. */
export function lessonHref(pathId: string, lessonId: string, base = PATHS_BASE): string {
	return `${base}/${pathId}/${lessonId}`;
}

export function reviewHref(pathId: string, base = PATHS_BASE): string {
	return `${base}/${pathId}/review`;
}

export function checkpointHref(pathId: string, unitId: string, base = PATHS_BASE): string {
	return `${base}/${pathId}/checkpoint?unit=${encodeURIComponent(unitId)}`;
}

/** A course's final review (LC-17660). */
export function finalHref(pathId: string, base = PATHS_BASE): string {
	return `${base}/${pathId}/final`;
}

export function pathHref(pathId: string, base = PATHS_BASE): string {
	return `${base}/${pathId}`;
}

/** Where "Continue" goes: the session under way, else the next lesson, else the path. */
export function continueHref(card: { id: string; resume: { kind: string; target: string } | null; next: { id: string } | null }, base = PATHS_BASE): string {
	if (card.resume?.kind === "lesson") return lessonHref(card.id, card.resume.target, base);
	if (card.resume?.kind === "checkpoint") return checkpointHref(card.id, card.resume.target, base);
	if (card.resume?.kind === "review") return reviewHref(card.id, base);
	if (card.resume?.kind === "final") return finalHref(card.id, base);
	if (card.next) return lessonHref(card.id, card.next.id, base);
	return pathHref(card.id, base);
}
