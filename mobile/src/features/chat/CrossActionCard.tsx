import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { CrossAction } from "@/lib/chatView";
import { fonts, radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/**
 * "Pick Up Your Cross updated" receipt, shown when the assistant replaced
 * today's guided day. Tapping it opens the day it just prepared. Mirrors the
 * card in `src/components/ChatMessage.tsx` on web.
 */
export function CrossActionCard({ action }: { action: CrossAction }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const openCross = useCallback(() => router.push("/cross"), [router]);

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Open today's Pick Up Your Cross"
			onPress={openCross}
			style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.accentPressed }]}
		>
			<Text style={styles.heading}>✝ Pick Up Your Cross updated</Text>
			<View style={styles.referenceRow}>
				<Text style={styles.reference}>{action.reference}</Text>
				{action.previousReference ? (
					<Text style={styles.replaced}>· replaced {action.previousReference}</Text>
				) : null}
			</View>
			<Text numberOfLines={3} style={styles.verse}>
				{action.text}
			</Text>
		</Pressable>
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
		heading: { color: c.accent, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
		referenceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
		reference: { color: c.text, fontSize: 14, fontWeight: "600" },
		replaced: { color: c.textFaint, fontSize: 12.5 },
		verse: {
			color: c.textSecondary,
			fontFamily: fonts.verse,
			fontSize: 14.5,
			lineHeight: 21,
		},
	});
