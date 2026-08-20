import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
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
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

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
				{note.isPinned ? <Ionicons name="pin" size={13} color={colors.accent} /> : null}
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

const createStyles = (c: Colors) =>
	StyleSheet.create({
		card: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.lg,
			padding: spacing.lg,
			gap: 6,
		},
		cardPinned: { borderColor: c.accentBorder },
		cardPressed: { backgroundColor: c.surfacePressed },
		titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
		title: { flex: 1, color: c.text, fontSize: 15, fontWeight: "600" },
		preview: { color: c.textFaint, fontSize: 13, lineHeight: 19 },
		metaRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.sm,
			marginTop: 2,
		},
		dots: { flexDirection: "row", alignItems: "center", gap: 5 },
		tagDot: { width: 7, height: 7, borderRadius: 4 },
		meta: { color: c.textGhost, fontSize: 11 },
	});
