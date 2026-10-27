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

/** A bounded step, shared by controls and endpoint tests. */
export function stepTextScale(value: unknown, direction: -1 | 1): TextScale {
	const index = TEXT_SCALES.indexOf(normalizeTextScale(value));
	return TEXT_SCALES[Math.max(0, Math.min(TEXT_SCALES.length - 1, index + direction))];
}

/** Nested text with no explicit size inherits its already-scaled native parent. */
export function scaleTextDimensions<T extends object>(style: T, factor: number): T {
	const dimensions = style as { fontSize?: number; lineHeight?: number };
	return {
		...style,
		...(typeof dimensions.fontSize === "number" ? { fontSize: dimensions.fontSize * factor } : {}),
		...(typeof dimensions.lineHeight === "number" ? { lineHeight: dimensions.lineHeight * factor } : {}),
	};
}

/** The scale a text size chip ("Large") stands for, or null for anything else. */
export function textScaleForLabel(label: string): TextScale | null {
	const match = TEXT_SCALES.find((scale) => TEXT_SCALE_LABELS[scale] === label);
	return match ?? null;
}
