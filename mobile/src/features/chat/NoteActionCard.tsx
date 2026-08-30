import React, { useCallback } from "react";
import { Pressable, StyleSheet } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useRouter } from "expo-router";
import type { NoteAction } from "@/lib/chatView";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";

/** "Added to note …" receipt shown when the assistant wrote into a note. */
export function NoteActionCard({ action }: { action: NoteAction }) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const router = useRouter();
	const openNotes = useCallback(
		() => router.push(action.noteId ? `/notes/${action.noteId}` : "/notes"),
		[router, action.noteId]
	);

	return (
		<Pressable
			accessibilityRole="button"
			onPress={openNotes}
			style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.accentPressed }]}
		>
			<Text style={styles.glyph}>✎</Text>
			<Text style={styles.label} numberOfLines={2}>
				{action.created ? "Created note " : "Added to note "}
				<Text style={styles.title}>{action.noteTitle}</Text>
			</Text>
		</Pressable>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			marginTop: spacing.md,
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.md,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
			borderRadius: radius.lg,
		},
		glyph: { color: c.accent, fontSize: 15 },
		label: { ...typography.meta, flex: 1, color: c.textSecondary },
		title: { color: c.accent, fontWeight: "600" },
	});
