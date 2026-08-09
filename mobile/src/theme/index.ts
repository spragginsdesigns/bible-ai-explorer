/**
 * VerseMind mobile design system — dark monochrome glassmorphism, ported from
 * the web app (globals.css + Tailwind neutral/amber usage). No Material UI:
 * every surface is built from these tokens.
 */
export const colors = {
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
} as const;

export const fonts = {
	/** Pirata One — VerseMind brand title only */
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
export const meshGradient = [colors.bg, colors.bgMid, colors.bgEnd] as const;
