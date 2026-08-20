/**
 * SureWord mobile design system — monochrome glassmorphism, ported from
 * the web app (globals.css + Tailwind neutral/amber usage). No Material UI:
 * every surface is built from these tokens.
 *
 * Two palettes live here: dark (the original SureWord look) and light.
 * Components should never read these directly — use `useTheme()` /
 * `useThemedStyles()` from `@/features/settings/settingsStore`, which pick
 * the active palette from the user's appearance setting.
 */
export const darkColors = {
	// Backgrounds (web: linear-gradient #000 → #050505 → #080808)
	bg: "#000000",
	bgMid: "#050505",
	bgEnd: "#080808",
	bgElevated: "#0e0e0e",

	// Glass surfaces (web: rgba(8,8,8,0.7) + blur, borders white/[0.06-0.08])
	glass: "rgba(8, 8, 8, 0.7)",
	glassLight: "rgba(14, 14, 14, 0.55)",
	surface: "rgba(255, 255, 255, 0.04)",
	surfaceStrong: "rgba(255, 255, 255, 0.06)",
	surfacePressed: "rgba(255, 255, 255, 0.10)",
	border: "rgba(255, 255, 255, 0.06)",
	borderStrong: "rgba(255, 255, 255, 0.08)",

	// Text (web: neutral-200/300/400/500/600)
	text: "#e5e5e5",
	textSecondary: "#d4d4d4",
	textMuted: "#a3a3a3",
	textFaint: "#737373",
	textGhost: "#525252",

	// Accent (web: amber-400 family)
	accent: "#fbbf24",
	accentSoft: "rgba(251, 191, 36, 0.10)",
	accentBorder: "rgba(251, 191, 36, 0.20)",
	accentPressed: "rgba(251, 191, 36, 0.15)",
	accentDim: "rgba(251, 191, 36, 0.70)",

	// Semantic
	danger: "#f87171",
	dangerSoft: "rgba(248, 113, 113, 0.10)",
	dangerBorder: "rgba(248, 113, 113, 0.20)",

	// Bible reader parchment surface (assets/parchment-dark.webp): ink tones
	// tuned for the deep-umber paper, like gold lettering on old leather.
	parchmentInk: "#e6d7ae",
	parchmentNumber: "rgba(251, 191, 36, 0.80)",
	parchmentHighlight: "rgba(251, 191, 36, 0.16)",
} as const;

/** Light palette — same roles as dark, mirrored from the web's light mode. */
export const lightColors: Colors = {
	// Backgrounds (web light: near-white neutrals)
	bg: "#fafafa",
	bgMid: "#f5f5f5",
	bgEnd: "#ececec",
	bgElevated: "#ffffff",

	// Glass surfaces
	glass: "rgba(255, 255, 255, 0.75)",
	glassLight: "rgba(255, 255, 255, 0.6)",
	surface: "rgba(0, 0, 0, 0.04)",
	surfaceStrong: "rgba(0, 0, 0, 0.06)",
	surfacePressed: "rgba(0, 0, 0, 0.10)",
	border: "rgba(0, 0, 0, 0.08)",
	borderStrong: "rgba(0, 0, 0, 0.12)",

	// Text (web: neutral-900/800/600/500/400)
	text: "#171717",
	textSecondary: "#262626",
	textMuted: "#525252",
	textFaint: "#737373",
	textGhost: "#a3a3a3",

	// Accent (web light mode uses amber-600 for contrast)
	accent: "#d97706",
	accentSoft: "rgba(217, 119, 6, 0.10)",
	accentBorder: "rgba(217, 119, 6, 0.25)",
	accentPressed: "rgba(217, 119, 6, 0.16)",
	accentDim: "rgba(217, 119, 6, 0.75)",

	// Semantic
	danger: "#dc2626",
	dangerSoft: "rgba(220, 38, 38, 0.08)",
	dangerBorder: "rgba(220, 38, 38, 0.20)",

	// Bible reader parchment surface (assets/parchment-light.webp): dark sepia
	// ink on the golden scroll paper.
	parchmentInk: "#38270e",
	parchmentNumber: "#7c4a11",
	parchmentHighlight: "rgba(120, 72, 10, 0.16)",
} as const;

export type Colors = { [K in keyof typeof darkColors]: string };
export type ResolvedTheme = "dark" | "light";

export const palettes: Record<ResolvedTheme, Colors> = {
	dark: darkColors,
	light: lightColors,
};

export const fonts = {
	/** Pirata One — SureWord brand title only */
	brand: "PirataOne_400Regular",
	/** Cormorant Garamond — quoted Scripture */
	verse: "CormorantGaramond_500Medium",
	verseItalic: "CormorantGaramond_500Medium_Italic",
	/** System sans for everything else */
	sans: "System",
} as const;

export const radius = {
	sm: 8,
	md: 12,
	lg: 16, // web rounded-2xl
	xl: 20,
	full: 999,
} as const;

export const spacing = {
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
	xxl: 32,
} as const;

/** Radial-ish mesh imitation: vertical gradient stops for expo-linear-gradient. */
export const meshGradients: Record<ResolvedTheme, readonly [string, string, string]> = {
	dark: [darkColors.bg, darkColors.bgMid, darkColors.bgEnd],
	light: [lightColors.bg, lightColors.bgMid, lightColors.bgEnd],
} as const;
