/**
 * App-wide text size on the web (Settings > Appearance, and the first card of
 * Walk with me). Mirrors `TEXT_SCALES` in `src/lib/preferences-contract.ts`
 * and `TEXT_SCALE_FACTORS` in `src/lib/onboarding-rules.ts`, the same way
 * `mobile/src/features/settings/textScale.ts` does;
 * `tests/text-scale.test.mjs` checks the copies agree.
 *
 * The web applies a size by scaling the root font size (`--sw-text-scale` on
 * <html>, read by `html { font-size }` in globals.css). Every Tailwind size is
 * in rem, so that one variable resizes the whole app on top of whatever the
 * browser's own font size already is.
 *
 * Import-free so the logic tests can load it directly.
 */
export const TEXT_SCALES = ["standard", "large", "largest"] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
export const DEFAULT_TEXT_SCALE: TextScale = "standard";

/** Applied on top of the browser's font size, never instead of it. */
export const TEXT_SCALE_FACTORS: Readonly<Record<TextScale, number>> = {
	standard: 1,
	large: 1.15,
	largest: 1.3,
};

export const TEXT_SCALE_LABELS: Readonly<Record<TextScale, string>> = {
	standard: "Standard",
	large: "Large",
	largest: "Largest",
};

/** The localStorage key holding this browser's copy of the account's size. */
export const TEXT_SCALE_PREF_KEY = "sureword-text-scale";

/** The CSS custom property on <html> that globals.css multiplies by. */
export const TEXT_SCALE_CSS_VAR = "--sw-text-scale";

export function isTextScale(value: unknown): value is TextScale {
	return typeof value === "string" && (TEXT_SCALES as readonly string[]).includes(value);
}

export function normalizeTextScale(value: unknown): TextScale {
	return isTextScale(value) ? value : DEFAULT_TEXT_SCALE;
}

/** The scale a text size chip ("Large") stands for, or null for anything else. */
export function textScaleForLabel(label: string): TextScale | null {
	const match = TEXT_SCALES.find((scale) => TEXT_SCALE_LABELS[scale] === label);
	return match ?? null;
}

/** Point <html> at a size. A no-op outside the browser. */
export function applyTextScaleToDocument(scale: TextScale): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (scale === DEFAULT_TEXT_SCALE) root.style.removeProperty(TEXT_SCALE_CSS_VAR);
	else root.style.setProperty(TEXT_SCALE_CSS_VAR, String(TEXT_SCALE_FACTORS[scale]));
	root.dataset.textScale = scale;
}

/**
 * Runs inline in <head> before the first paint, so a reader who chose Largest
 * never sees the page draw at the standard size and then jump. Built from the
 * same constants as everything else, so it cannot drift from them.
 */
export const TEXT_SCALE_BOOT_SCRIPT = `try{var s=localStorage.getItem(${JSON.stringify(TEXT_SCALE_PREF_KEY)});var f=${JSON.stringify(TEXT_SCALE_FACTORS)}[s];if(f&&f!==1){document.documentElement.style.setProperty(${JSON.stringify(TEXT_SCALE_CSS_VAR)},String(f));document.documentElement.dataset.textScale=s}}catch(e){}`;
