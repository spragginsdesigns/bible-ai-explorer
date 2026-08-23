/**
 * Verse-highlight presets and helpers for the Bible reader (YouVersion-style
 * colored washes). The preset list and order are shared across platforms —
 * keep in sync with the mobile/macOS copies.
 */

export interface HighlightColor {
	name: string;
	hex: string; // "#RRGGBB"
}

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
	{ name: "Yellow", hex: "#F5D76E" },
	{ name: "Orange", hex: "#F5A623" },
	{ name: "Red", hex: "#E84C3D" },
	{ name: "Pink", hex: "#E87EA1" },
	{ name: "Purple", hex: "#9B59B6" },
	{ name: "Blue", hex: "#4A90D9" },
	{ name: "Teal", hex: "#1ABC9C" },
	{ name: "Green", hex: "#27AE60" },
];

/**
 * Translucent background wash for a highlighted verse, so the text stays
 * readable over it in light and dark mode. Returns the input unchanged when
 * it is not a "#RRGGBB" hex (callers only store validated colors).
 */
export function highlightWash(hex: string): string {
	const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!match) return hex;
	const r = Number.parseInt(match[1], 16);
	const g = Number.parseInt(match[2], 16);
	const b = Number.parseInt(match[3], 16);
	return `rgba(${r}, ${g}, ${b}, 0.25)`;
}

export interface ChapterHighlight {
	verse: number;
	color: string;
}

export interface HighlightInput {
	translation: string;
	book: number; // canonical order, 1-66
	chapter: number;
	verse: number;
	color: string;
}

/** The caller's highlights for one chapter, from GET /api/highlights. */
export async function fetchChapterHighlights(
	translation: string,
	book: number,
	chapter: number
): Promise<ChapterHighlight[]> {
	const params = new URLSearchParams({
		translation,
		book: String(book),
		chapter: String(chapter),
	});
	const res = await fetch(`/api/highlights?${params.toString()}`);
	if (!res.ok) throw new Error("Failed to load highlights");
	const data: { highlights?: ChapterHighlight[] } = await res.json();
	return data.highlights ?? [];
}

/** Create or replace a verse highlight (upsert server-side). */
export async function putHighlight(input: HighlightInput): Promise<void> {
	const res = await fetch("/api/highlights", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw new Error("Failed to save highlight");
}

/** Remove a verse highlight. Idempotent server-side. */
export async function deleteHighlight(
	input: Omit<HighlightInput, "color">
): Promise<void> {
	const res = await fetch("/api/highlights", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw new Error("Failed to remove highlight");
}
