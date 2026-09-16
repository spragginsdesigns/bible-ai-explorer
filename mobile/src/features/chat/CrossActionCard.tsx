import React from "react";
import { StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import type { CrossAction } from "@/lib/chatView";
import { fonts, radius, spacing, typography } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/**
 * The verse preview under the receipts line when the assistant replaced today's
 * guided day. Content only: the "Today's cross: …" fragment on the receipts line
 * carries the navigation and the heading, so a tappable card here would say and
 * do the same thing twice.
 */
export function CrossActionCard({ action }: { action: CrossAction }) {
	const styles = useThemedStyles(createStyles);

	return (
		<View style={styles.card}>
			<View style={styles.referenceRow}>
				<Text style={styles.reference}>{action.reference}</Text>
				{action.previousReference ? (
					<Text style={styles.replaced}>· replaced {action.previousReference}</Text>
				) : null}
			</View>
			<Text numberOfLines={3} style={styles.verse}>
				{action.text}
			</Text>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			gap: 4,
			marginTop: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
		},
		referenceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
		reference: { color: c.text, fontSize: 14, fontWeight: "600" },
		replaced: { ...typography.meta, color: c.textFaint },
		verse: {
			color: c.textSecondary,
			fontFamily: fonts.verse,
			...typography.longForm,
		},
	});
