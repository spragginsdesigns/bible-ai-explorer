import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { fonts, spacing, type Colors } from "@/theme";
import { AddLearnButton } from "./AddLearnButton";
import { suggestionKey, type LearnSuggestion, type LearnSuggestionsView } from "./suggestions";

export interface SuggestedVersesProps {
	view: LearnSuggestionsView;
	translation: "KJV" | "NKJV";
	/** Stands in for the row that was just added, so the confirmation outlives it. */
	confirmation: string | null;
	onAdded: (suggestion: LearnSuggestion) => void;
	onDismiss: (suggestion: LearnSuggestion) => void;
}

export function SuggestedVerses({ view, translation, confirmation, onAdded, onDismiss }: SuggestedVersesProps) {
	const styles = useThemedStyles(createStyles);
	if (!view.rows.length && !confirmation) return null;
	return <View style={view.lead ? styles.lead : styles.section}>
		<Text style={view.lead ? styles.leadHeading : styles.heading}>{view.heading}</Text>
		{confirmation ? <Text accessibilityLiveRegion="polite" style={styles.confirmation}>{confirmation}</Text> : null}
		{view.rows.map((suggestion) => <View key={suggestionKey(suggestion)} style={styles.row}>
			<Text style={styles.reference}>{suggestion.reference}</Text>
			<Text style={styles.verse}>{suggestion.text}</Text>
			<Text style={styles.reason}>{suggestion.reason}</Text>
			<AddLearnButton
				book={suggestion.book}
				chapter={suggestion.chapter}
				verse={suggestion.verse}
				translation={translation}
				source="suggestion"
				accessibilityLabel={`Learn ${suggestion.reference}`}
				onAdded={() => onAdded(suggestion)}
			/>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Dismiss ${suggestion.reference}`}
				onPress={() => onDismiss(suggestion)}
				style={styles.dismiss}
			>
				<Text style={styles.dismissText}>Not now</Text>
			</Pressable>
		</View>)}
	</View>;
}

const createStyles = (colors: Colors) => StyleSheet.create({
	lead: { flex: 1, justifyContent: "center", paddingVertical: spacing.xl },
	section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg },
	leadHeading: { color: colors.text, fontFamily: fonts.verse, fontSize: 24, lineHeight: 34, textAlign: "center" },
	heading: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.bodyBold },
	confirmation: { color: colors.textMuted, fontSize: 14, marginTop: spacing.sm },
	row: { marginTop: spacing.lg },
	reference: { color: colors.accent, fontSize: 14, fontFamily: fonts.bodyBold },
	verse: { color: colors.text, fontFamily: fonts.verse, fontSize: 20, lineHeight: 30, marginTop: spacing.sm },
	reason: { color: colors.textMuted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
	dismiss: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: spacing.sm },
	dismissText: { color: colors.textMuted, fontSize: 14 },
});
