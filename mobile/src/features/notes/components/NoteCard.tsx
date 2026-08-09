import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import type { Note, Tag } from "../types";
import { relativeTime, tagsForNote } from "../utils";

export function NoteCard({
	note,
	tags,
	onPress,
	onLongPress,
}: {
	note: Note;
	tags: Tag[];
	onPress: () => void;
	onLongPress: () => void;
}) {
	const noteTags = tagsForNote(note, tags);
	const preview = note.plainText.trim() || "Empty note";

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={note.title || "Untitled Note"}
			onPress={onPress}
			onLongPress={onLongPress}
			delayLongPress={280}
			style={({ pressed }) => [
				styles.card,
				note.isPinned && styles.cardPinned,
				pressed && styles.cardPressed,
			]}
		>
			<View style={styles.titleRow}>
				<Text style={styles.title} numberOfLines={1}>
					{note.title || "Untitled Note"}
				</Text>
				{note.isPinned ? <Text style={styles.pin}>📌</Text> : null}
			</View>

			<Text style={styles.preview} numberOfLines={2}>
				{preview}
			</Text>

			<View style={styles.metaRow}>
				<View style={styles.dots}>
					{noteTags.slice(0, 4).map((tag) => (
						<View key={tag.id} style={[styles.tagDot, { backgroundColor: tag.color }]} />
					))}
					{noteTags.length > 4 ? (
						<Text style={styles.meta}>+{noteTags.length - 4}</Text>
					) : null}
				</View>
				<Text style={styles.meta}>
					{relativeTime(note.updatedAt)}
					{note.wordCount > 0 ? `  ·  ${note.wordCount} words` : ""}
				</Text>
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	card: {
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
		borderRadius: radius.lg,
		padding: spacing.lg,
		gap: 6,
	},
	cardPinned: { borderColor: colors.accentBorder },
	cardPressed: { backgroundColor: colors.surfacePressed },
	titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
	title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
	pin: { fontSize: 12 },
	preview: { color: colors.textFaint, fontSize: 13, lineHeight: 19 },
	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: spacing.sm,
		marginTop: 2,
	},
	dots: { flexDirection: "row", alignItems: "center", gap: 5 },
	tagDot: { width: 7, height: 7, borderRadius: 4 },
	meta: { color: colors.textGhost, fontSize: 11 },
});
