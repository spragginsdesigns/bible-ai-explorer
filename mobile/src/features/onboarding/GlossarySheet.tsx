import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText as Text } from "@/components/AppText";
import { BottomSheet } from "@/features/notes/components/primitives";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import { GLOSSARY, type GlossaryTerm } from "./onboardingRules";

/**
 * A tapped word on a welcome card ("saved"), explained plainly from the KJV.
 * Instant and free: the words are fixed in `GLOSSARY`, not generated. "Talk
 * with SureWord about this" sends the entry's question as their answer, when
 * the card can still take one. Mirrors src/components/walk/GlossaryDialog.tsx.
 */
export function GlossarySheet({
	term,
	onClose,
	onAsk,
}: {
	term: GlossaryTerm | null;
	onClose: () => void;
	onAsk?: (question: string) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const entry = term ? GLOSSARY[term] : null;
	return (
		<BottomSheet visible={entry !== null} onClose={onClose} title={entry?.title} scroll>
			{entry ? (
				<View style={styles.body}>
					{entry.sections.map((section) => (
						<View key={section.text} style={styles.section}>
							<Text style={styles.text}>{section.text}</Text>
							{section.verses.map((verse) => (
								<View key={verse.reference} style={styles.verse}>
									<Text style={styles.verseText}>{verse.text}</Text>
									<Text style={styles.reference}>{`${verse.reference} (KJV)`}</Text>
								</View>
							))}
						</View>
					))}
					{onAsk ? (
						<Pressable
							accessibilityRole="button"
							onPress={() => onAsk(entry.ask)}
							style={({ pressed }) => [styles.askButton, pressed && styles.pressed]}
						>
							<Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
							<Text style={styles.askLabel}>Talk with SureWord about this</Text>
						</Pressable>
					) : null}
				</View>
			) : null}
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		body: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.lg },
		section: { gap: spacing.sm },
		text: { color: c.text, ...typography.body },
		verse: {
			borderRadius: radius.md,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.borderStrong,
			backgroundColor: c.surface,
			padding: spacing.md,
			gap: 6,
		},
		verseText: { color: c.text, fontFamily: fonts.verse, fontSize: 20, lineHeight: 28 },
		reference: { color: c.accent, ...typography.support, fontFamily: fonts.bodyBold },
		askButton: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: spacing.sm,
			minHeight: 52,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: c.accentBorder,
			backgroundColor: c.accentSoft,
		},
		pressed: { backgroundColor: c.surfacePressed },
		askLabel: { color: c.accent, ...typography.control, fontFamily: fonts.bodyBold },
	});
