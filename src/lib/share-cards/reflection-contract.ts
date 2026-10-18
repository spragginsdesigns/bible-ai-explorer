/** Public reflection choices. Mirrored in mobile; no private study data belongs here. */
export const MAX_REFLECTION_LENGTH = 200;
export const REFLECTION_FONTS = [
	{ id: "italic", label: "Italic" },
	{ id: "book", label: "Book" },
	{ id: "simple", label: "Simple" },
] as const;
export const REFLECTION_PLACEMENTS = [
	{ id: "below", label: "Below verse" },
	{ id: "above", label: "Above verse" },
] as const;
export type ReflectionFont = (typeof REFLECTION_FONTS)[number]["id"];
export type ReflectionPlacement = (typeof REFLECTION_PLACEMENTS)[number]["id"];
export interface ReflectionPresentation { font: ReflectionFont; placement: ReflectionPlacement }
export const DEFAULT_REFLECTION_PRESENTATION: ReflectionPresentation = { font: "italic", placement: "below" };

/** Old rows and old clients keep the original typography and placement. */
export function reflectionPresentation(value: unknown): ReflectionPresentation {
	const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
	return {
		font: REFLECTION_FONTS.some(item => item.id === row.font) ? row.font as ReflectionFont : "italic",
		placement: row.placement === "above" ? "above" : "below",
	};
}

export function validReflectionPresentation(value: unknown): value is ReflectionPresentation {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return REFLECTION_FONTS.some(item => item.id === row.font) && REFLECTION_PLACEMENTS.some(item => item.id === row.placement);
}
