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
import { fonts, radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/** Full-screen mesh background with safe-area padding, following the active theme. */
export function Screen({
	children,
	edges = ["top"],
	style,
}: {
	children: React.ReactNode;
	edges?: ("top" | "bottom" | "left" | "right")[];
	style?: StyleProp<ViewStyle>;
}) {
	const { meshGradient } = useTheme();
	return (
		<LinearGradient colors={[...meshGradient]} style={styles.fill}>
			<SafeAreaView edges={edges} style={[styles.fill, style]}>
				{children}
			</SafeAreaView>
		</LinearGradient>
	);
}

/** Frosted glass card matching the web's .glass + subtle borders. */
export function GlassCard({
	children,
	style,
	strong = false,
}: {
	children: React.ReactNode;
	style?: StyleProp<ViewStyle>;
	strong?: boolean;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
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

/** The SureWord wordmark in Pirata One. */
export function BrandTitle({ size = 34, style }: { size?: number; style?: StyleProp<TextStyle> }) {
	const { colors } = useTheme();
	return (
		<Text style={[{ fontFamily: fonts.brand, fontSize: size, color: colors.text }, style]}>
			SureWord
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
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
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
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
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
});

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
		},
		accentButton: {
			minHeight: 48,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.xl,
		},
		accentButtonLabel: {
			color: c.accent,
			fontSize: 15,
			fontWeight: "600",
		},
		ghostButton: {
			minHeight: 48,
			borderRadius: radius.lg,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			alignItems: "center",
			justifyContent: "center",
			paddingHorizontal: spacing.xl,
		},
		ghostButtonLabel: {
			color: c.textSecondary,
			fontSize: 15,
			fontWeight: "500",
		},
	});
