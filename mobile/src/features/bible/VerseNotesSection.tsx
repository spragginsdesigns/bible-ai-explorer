import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import { useThemedStyles } from "@/features/settings/settingsStore";
import { relativeTime } from "@/features/notes/utils";
import { fonts, radius, spacing, typography, type Colors } from "@/theme";
import type { MatchedChapterNote } from "./chapterNotes";

interface VerseNotesSectionProps {
	reference: string;
	notes: MatchedChapterNote[];
	onOpenNote: (noteId: string) => void;
	onAddToNote: () => void;
}

export function VerseNotesSection({
	reference,
	notes,
	onOpenNote,
	onAddToNote,
}: VerseNotesSectionProps) {
	const styles = useThemedStyles(createStyles);

	return (
		<View style={styles.container}>
			{notes.length === 0 ? (
				<Text style={styles.empty}>No study notes mention {reference} yet.</Text>
			) : (
				<View style={styles.list}>
					{notes.map((note) => (
						<Pressable
							key={note.id}
							accessibilityRole="button"
							accessibilityLabel={`Open note ${note.title}`}
							onPress={() => onOpenNote(note.id)}
							style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
						>
							<View style={styles.cardHeader}>
								<Text style={styles.title} numberOfLines={1}>
									✎ {note.title}
								</Text>
								<Text style={styles.time}>{relativeTime(note.updatedAt)}</Text>
							</View>
							{note.excerpt ? (
								<Text style={styles.excerpt} numberOfLines={2}>
									{note.excerpt}
								</Text>
							) : null}
						</Pressable>
					))}
				</View>
			)}

			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Add ${reference} to a note`}
				onPress={onAddToNote}
				style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
			>
				<Text style={styles.addButtonText}>＋ Add {reference} to a note</Text>
			</Pressable>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		container: {
			gap: spacing.md,
			paddingVertical: spacing.xs,
		},
		empty: {
			color: c.textMuted,
			...typography.support,
		},
		list: {
			gap: spacing.sm,
		},
		card: {
			backgroundColor: c.surface,
			borderColor: c.borderStrong,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			gap: 4,
		},
		cardPressed: {
			backgroundColor: c.surfacePressed,
		},
		cardHeader: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: spacing.sm,
		},
		title: {
			flex: 1,
			color: c.accent,
			fontFamily: fonts.bodyBold,
			...typography.support,
		},
		time: {
			color: c.textFaint,
			...typography.micro,
		},
		excerpt: {
			color: c.textSecondary,
			...typography.meta,
		},
		addButton: {
			minHeight: 42,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
		},
		addButtonPressed: {
			backgroundColor: c.accentPressed,
		},
		addButtonText: {
			color: c.accent,
			fontFamily: fonts.bodyBold,
			...typography.meta,
		},
	});
