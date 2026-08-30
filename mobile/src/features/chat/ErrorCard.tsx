import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

export function ErrorCard({
	title,
	message,
	code,
	retryLabel = "Retry",
	onRetry,
}: {
	title?: string;
	message: string;
	/** Failure code, shown muted so a screenshot identifies the error. */
	code?: string;
	retryLabel?: string;
	/** Omit for failures retrying cannot fix (bad input, expired session). */
	onRetry?: () => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.card}>
			{title ? <Text style={styles.title}>{title}</Text> : null}
			<Text style={styles.message}>{message}</Text>
			{code ? <Text style={styles.ref}>ref: {code}</Text> : null}
			{onRetry ? (
				<Pressable
					accessibilityRole="button"
					onPress={onRetry}
					style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.surfacePressed }]}
				>
					<Text style={styles.buttonLabel}>{retryLabel}</Text>
				</Pressable>
			) : null}
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
		title: { color: c.text, fontSize: 14, fontWeight: "700" },
		message: { color: c.textSecondary, fontSize: 13, lineHeight: 20 },
		ref: { ...typography.micro, color: c.textMuted },
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
