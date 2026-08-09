import React from "react";
import {
	Pressable,
	StyleSheet,
	Text,
	View,
	type PressableProps,
	type StyleProp,
	type TextStyle,
	type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fonts, meshGradient, radius, spacing } from "@/theme";

/** Full-screen dark mesh background with safe-area padding. */
export function Screen({
	children,
	edges = ["top"],
	style,
}: {
	children: React.ReactNode;
	edges?: ("top" | "bottom" | "left" | "right")[];
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<LinearGradient colors={[...meshGradient]} style={styles.fill}>
			<SafeAreaView edges={edges} style={[styles.fill, style]}>
				{children}
			</SafeAreaView>
		</LinearGradient>
	);
}

/** Frosted glass card matching the web's .glass + white/[0.06] borders. */
export function GlassCard({
	children,
	style,
	strong = false,
}: {
	children: React.ReactNode;
	style?: StyleProp<ViewStyle>;
	strong?: boolean;
}) {
	return (
		<View
			style={[
				styles.card,
				strong && { backgroundColor: colors.surfaceStrong, borderColor: colors.borderStrong },
				style,
			]}
		>
			{children}
		</View>
	);
}

/** The VerseMind wordmark in Pirata One. */
export function BrandTitle({ size = 34, style }: { size?: number; style?: StyleProp<TextStyle> }) {
	return (
		<Text style={[{ fontFamily: fonts.brand, fontSize: size, color: colors.text }, style]}>
			VerseMind
		</Text>
	);
}

/** Amber primary action button. */
export function AccentButton({
	label,
	style,
	disabled,
	...props
}: PressableProps & { label: string; style?: StyleProp<ViewStyle> }) {
	return (
		<Pressable
			accessibilityRole="button"
			disabled={disabled}
			style={({ pressed }) => [
				styles.accentButton,
				pressed && { backgroundColor: colors.accentPressed },
				disabled && { opacity: 0.4 },
				style,
			]}
			{...props}
		>
			<Text style={styles.accentButtonLabel}>{label}</Text>
		</Pressable>
	);
}

/** Ghost secondary button. */
export function GhostButton({
	label,
	style,
	disabled,
	...props
}: PressableProps & { label: string; style?: StyleProp<ViewStyle> }) {
	return (
		<Pressable
			accessibilityRole="button"
			disabled={disabled}
			style={({ pressed }) => [
				styles.ghostButton,
				pressed && { backgroundColor: colors.surfacePressed },
				disabled && { opacity: 0.4 },
				style,
			]}
			{...props}
		>
			<Text style={styles.ghostButtonLabel}>{label}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	fill: { flex: 1 },
	card: {
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radius.lg,
	},
	accentButton: {
		minHeight: 48,
		borderRadius: radius.lg,
		backgroundColor: colors.accentSoft,
		borderColor: colors.accentBorder,
		borderWidth: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: spacing.xl,
	},
	accentButtonLabel: {
		color: colors.accent,
		fontSize: 15,
		fontWeight: "600",
	},
	ghostButton: {
		minHeight: 48,
		borderRadius: radius.lg,
		backgroundColor: colors.surface,
		borderColor: colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: spacing.xl,
	},
	ghostButtonLabel: {
		color: colors.textSecondary,
		fontSize: 15,
		fontWeight: "500",
	},
});
