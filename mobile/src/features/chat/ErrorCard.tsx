import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";

export function ErrorCard({
	message,
	retryLabel = "Retry",
	onRetry,
}: {
	message: string;
	retryLabel?: string;
	onRetry: () => void;
}) {
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

const styles = StyleSheet.create({
	card: {
		marginBottom: spacing.xl,
		padding: spacing.lg,
		backgroundColor: colors.dangerSoft,
		borderColor: colors.dangerBorder,
		borderWidth: 1,
		borderRadius: radius.lg,
		gap: spacing.md,
	},
	message: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
	button: {
		alignSelf: "flex-start",
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.sm,
		borderRadius: radius.full,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.dangerBorder,
		backgroundColor: colors.surface,
	},
	buttonLabel: { color: colors.danger, fontSize: 13, fontWeight: "600" },
});
