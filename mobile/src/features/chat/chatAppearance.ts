import { darkColors, lightColors, type Colors } from "@/theme";

/** Scope the approved palette to chat so the Bible reader keeps its ink. */
export const sanctuaryDark: Colors = {
	...darkColors,
	bg: "#0d100d", bgMid: "#0d100d", bgEnd: "#0d100d", bgElevated: "#141713",
	glass: "#141713", glassLight: "#1b201b",
	surface: "#1b201b", surfaceStrong: "#1d211b", surfacePressed: "#2b3027",
	border: "rgba(229, 182, 100, 0.12)", borderStrong: "rgba(229, 182, 100, 0.20)",
	text: "#f6eedd", textSecondary: "#eee7dc", textMuted: "#bbb3a7", textFaint: "#afa79a", textGhost: "#aaa295",
	accent: "#e5b664", accentDim: "#d5b479", accentSoft: "rgba(229, 182, 100, 0.08)",
	accentBorder: "rgba(229, 182, 100, 0.28)", accentPressed: "rgba(229, 182, 100, 0.14)",
};

export const sanctuaryLight: Colors = {
	...lightColors,
	bg: "#f6f2e9", bgElevated: "#faf8f2", surface: "#eeeade", surfaceStrong: "#fffdf7", surfacePressed: "#e3dece",
	text: "#26322c", textSecondary: "#334239", textMuted: "#5f6658", textFaint: "#626658", textGhost: "#626658",
	accent: "#79561f", accentDim: "#79561f", accentSoft: "rgba(121, 86, 31, 0.07)",
	accentBorder: "rgba(121, 86, 31, 0.22)", accentPressed: "rgba(121, 86, 31, 0.12)",
};

export function chatColors(colors: Colors): Colors {
	return colors.bg === darkColors.bg ? sanctuaryDark : sanctuaryLight;
}
