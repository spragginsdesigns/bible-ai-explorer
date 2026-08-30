import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

export function FollowUpChips({
	questions,
	onSelect,
}: {
	questions: string[];
	onSelect: (question: string) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.wrap}>
			<Text style={styles.caption}>If you&apos;d like to keep exploring</Text>
			{questions.map((question) => (
				<Pressable
					key={question}
					accessibilityRole="button"
					onPress={() => onSelect(question)}
					style={({ pressed }) => [styles.chip, pressed && { backgroundColor: colors.accentPressed }]}
				>
					<Text style={styles.chipLabel}>{question}</Text>
				</Pressable>
			))}
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		wrap: { marginTop: spacing.lg, gap: spacing.sm },
		caption: {
			...typography.support,
			color: c.textGhost,
			fontWeight: "600",
			letterSpacing: 0.6,
			textTransform: "uppercase",
		},
		chip: {
			alignSelf: "flex-start",
			maxWidth: "100%",
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.sm,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		chipLabel: { color: c.accent, fontSize: 13, lineHeight: 19 },
	});
