import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BrandTitle } from "@/components/ui";
import { radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { commonQuestions } from "./commonQuestions";

export function WelcomeState({
	onSelectQuestion,
	bottomInset,
}: {
	onSelectQuestion: (question: string) => void;
	bottomInset: number;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	return (
		<ScrollView
			style={styles.fill}
			contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
			showsVerticalScrollIndicator={false}
			keyboardShouldPersistTaps="handled"
		>
			<View style={styles.halo}>
				<Text style={styles.haloGlyph}>✦</Text>
			</View>
			<BrandTitle size={52} style={styles.brand} />
			<Text style={styles.tagline}>
				Ask anything about the Bible. Every answer is rooted in the King James Scriptures.
			</Text>

			<View style={styles.chips}>
				{commonQuestions.map((question) => (
					<Pressable
						key={question}
						accessibilityRole="button"
						onPress={() => onSelectQuestion(question)}
						style={({ pressed }) => [
							styles.chip,
							pressed && { backgroundColor: colors.surfacePressed, borderColor: colors.accentBorder },
						]}
					>
						<Text style={styles.chipLabel}>{question}</Text>
						<Text style={styles.chipGlyph}>↗</Text>
					</Pressable>
				))}
			</View>
		</ScrollView>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		content: {
			flexGrow: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingHorizontal: spacing.xl,
			paddingTop: spacing.xxl,
		},
		halo: {
			width: 72,
			height: 72,
			borderRadius: radius.full,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			marginBottom: spacing.lg,
		},
		haloGlyph: { color: c.accent, fontSize: 30 },
		brand: { color: c.accent },
		tagline: {
			marginTop: spacing.sm,
			color: c.textMuted,
			fontSize: 14,
			lineHeight: 21,
			textAlign: "center",
			maxWidth: 320,
		},
		chips: { alignSelf: "stretch", marginTop: spacing.xxl, gap: spacing.sm },
		chip: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
		},
		chipLabel: { flex: 1, color: c.textSecondary, fontSize: 14, lineHeight: 20 },
		chipGlyph: { color: c.textGhost, fontSize: 13 },
	});
