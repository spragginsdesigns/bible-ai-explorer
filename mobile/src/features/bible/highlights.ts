/**
 * Verse highlight colors. The preset palette is shared across platforms
 * (web, mobile, macOS) — keep the hex values and their order in sync.
 */

export interface HighlightPreset {
	name: string;
	color: string;
}

export const HIGHLIGHT_PRESETS: readonly HighlightPreset[] = [
	{ name: "Yellow", color: "#F5D76E" },
	{ name: "Orange", color: "#F5A623" },
	{ name: "Red", color: "#E84C3D" },
	{ name: "Pink", color: "#E87EA1" },
	{ name: "Purple", color: "#9B59B6" },
	{ name: "Blue", color: "#4A90D9" },
	{ name: "Teal", color: "#1ABC9C" },
	{ name: "Green", color: "#27AE60" },
];

/** Normalize any hex the picker hands back to an uppercase #RRGGBB. */
export function normalizeHighlightHex(hex: string): string | null {
	const match = /^#?([0-9a-f]{6})/i.exec(hex.trim());
	return match ? `#${match[1].toUpperCase()}` : null;
}

/** Translucent wash painted under a highlighted verse row. */
export function highlightWash(hex: string): string {
	const normalized = normalizeHighlightHex(hex) ?? "#F5D76E";
	const r = Number.parseInt(normalized.slice(1, 3), 16);
	const g = Number.parseInt(normalized.slice(3, 5), 16);
	const b = Number.parseInt(normalized.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, 0.25)`;
}
