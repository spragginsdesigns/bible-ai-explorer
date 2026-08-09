import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";

export function FollowUpChips({
	questions,
	onSelect,
}: {
	questions: string[];
	onSelect: (question: string) => void;
}) {
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

const styles = StyleSheet.create({
	wrap: { marginTop: spacing.lg, gap: spacing.sm },
	caption: {
		color: colors.textGhost,
		fontSize: 11,
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
		borderColor: colors.accentBorder,
		backgroundColor: colors.accentSoft,
	},
	chipLabel: { color: colors.accent, fontSize: 13, lineHeight: 19 },
});
