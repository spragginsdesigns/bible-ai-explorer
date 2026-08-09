import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RetrievedVerse } from "@/lib/chatView";
import { colors, fonts, spacing } from "@/theme";
import { Collapsible } from "./Collapsible";

/**
 * Retrieval confidence, ported from the web's RetrievedVersesCollapsible. The
 * palette stays inside the monochrome + amber system: amber for a strong hit,
 * dimmed amber for a moderate one, grey for a broad topical sweep.
 */
function matchStrength(average: number): { label: string; color: string } {
	if (average > 0.75) return { label: "Strong match", color: colors.accent };
	if (average > 0.6) return { label: "Moderate match", color: colors.accentDim };
	return { label: "Broad match", color: colors.textFaint };
}

export function RetrievedVersesCard({
	verses,
	averageSimilarity,
}: {
	verses: RetrievedVerse[];
	averageSimilarity: number;
}) {
	return (
		<Collapsible
			glyph="📖"
			title={`Retrieved Verses (${verses.length})`}
			badge={matchStrength(averageSimilarity)}
		>
			{verses.map((verse, index) => (
				<View key={`${verse.reference}-${index}`} style={styles.row}>
					<View style={styles.referenceRow}>
						<Text style={styles.reference}>{verse.reference}</Text>
						<Text style={styles.percent}>{Math.round(verse.similarity * 100)}%</Text>
					</View>
					{verse.text && <Text style={styles.verse}>{verse.text}</Text>}
				</View>
			))}
		</Collapsible>
	);
}

const styles = StyleSheet.create({
	row: { paddingVertical: spacing.md },
	referenceRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: spacing.sm,
	},
	reference: { flexShrink: 1, color: colors.accent, fontSize: 13, fontWeight: "600" },
	percent: { color: colors.textGhost, fontSize: 11, fontVariant: ["tabular-nums"] },
	verse: {
		marginTop: spacing.xs,
		color: colors.textSecondary,
		fontFamily: fonts.verse,
		fontSize: 17,
		lineHeight: 25,
	},
});
