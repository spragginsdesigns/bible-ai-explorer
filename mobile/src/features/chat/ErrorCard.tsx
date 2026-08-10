import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

export function ErrorCard({
	message,
	retryLabel = "Retry",
	onRetry,
}: {
	message: string;
	retryLabel?: string;
	onRetry: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.card}>
			<Text style={styles.message}>{message}</Text>
			<Pressable
				accessibilityRole="button"
				onPress={onRetry}
				style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.surfacePressed }]}
			>
				<Text style={styles.buttonLabel}>{retryLabel}</Text>
			</Pressable>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			marginBottom: spacing.xl,
			padding: spacing.lg,
			backgroundColor: c.dangerSoft,
			borderColor: c.dangerBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
			gap: spacing.md,
		},
		message: { color: c.textSecondary, fontSize: 13, lineHeight: 20 },
		button: {
			alignSelf: "flex-start",
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.sm,
			borderRadius: radius.full,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.dangerBorder,
			backgroundColor: c.surface,
		},
		buttonLabel: { color: c.danger, fontSize: 13, fontWeight: "600" },
	});
