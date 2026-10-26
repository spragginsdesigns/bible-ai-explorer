/**
 * App-wide text size (Settings > Appearance, and the first card of Walk with
 * me). Mirrors `TEXT_SCALES` in `src/lib/preferences-contract.ts` and
 * `TEXT_SCALE_FACTORS` in `src/lib/onboarding-rules.ts`;
 * `tests/onboarding-rules.test.mjs` checks the copies agree.
 *
 * Import-free so the logic tests can load it directly.
 */
export const TEXT_SCALES = ["standard", "large", "largest"] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
export const DEFAULT_TEXT_SCALE: TextScale = "standard";

/** Applied on top of the system font scale, never instead of it. */
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
