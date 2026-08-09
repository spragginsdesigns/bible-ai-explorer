import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import type { NoteAction } from "@/lib/chatView";
import { colors, radius, spacing } from "@/theme";

/** "Added to note …" receipt shown when the assistant wrote into a note. */
export function NoteActionCard({ action }: { action: NoteAction }) {
	const router = useRouter();
	const openNotes = useCallback(() => router.push("/notes"), [router]);

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

const styles = StyleSheet.create({
	card: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.md,
		marginTop: spacing.md,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
		backgroundColor: colors.accentSoft,
		borderColor: colors.accentBorder,
		borderWidth: 1,
		borderRadius: radius.lg,
	},
	glyph: { color: colors.accent, fontSize: 15 },
	label: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
	title: { color: colors.accent, fontWeight: "600" },
});
