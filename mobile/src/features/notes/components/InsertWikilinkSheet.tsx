import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { radius, spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { useNotesSnapshot } from "../notesStore";
import { relativeTime } from "../utils";
import { filterNotesForLinking, hasExactTarget, sanitizeWikilinkTarget } from "../wikilinks";
import { BottomSheet } from "./primitives";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Note picker for inserting a `[[wikilink]]`. Reads the cached library rather
 * than the network so the sheet opens instantly, and offers the typed text as a
 * target of its own - a link may point at a note that does not exist yet, and
 * the server resolves it the moment one is created with that title.
 */
export function InsertWikilinkSheet({
	visible,
	currentNoteId,
	onClose,
	onSelect,
}: {
	visible: boolean;
	currentNoteId: string;
	onClose: () => void;
	/** Receives the bare target title; the caller formats and inserts it. */
	onSelect: (title: string) => void;
}) {
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const { notes } = useNotesSnapshot();

	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	useEffect(() => {
		if (!visible) return;
		setQuery("");
		setDebouncedQuery("");
	}, [visible]);

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query]);

	const matches = useMemo(
		() =>
			filterNotesForLinking(notes, debouncedQuery, currentNoteId).sort(
				(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
			),
		[notes, debouncedQuery, currentNoteId]
	);

	const newTarget = sanitizeWikilinkTarget(debouncedQuery);
	const offerNewTarget =
		newTarget.length > 0 && !hasExactTarget(notes, debouncedQuery, currentNoteId);

	return (
		<BottomSheet visible={visible} onClose={onClose} title="Link a note" heightRatio={0.7}>
			<TextInput
				value={query}
				onChangeText={setQuery}
				placeholder="Search notes to link"
				placeholderTextColor={colors.textGhost}
				autoCapitalize="none"
				autoCorrect={false}
				style={styles.search}
			/>

			<ScrollView
				style={styles.list}
				contentContainerStyle={styles.listContent}
				keyboardShouldPersistTaps="handled"
			>
				{offerNewTarget ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Link to ${newTarget}`}
						onPress={() => onSelect(newTarget)}
						style={({ pressed }) => [
							styles.newTarget,
							pressed && { backgroundColor: colors.accentPressed },
						]}
					>
						<Ionicons name="add" size={15} color={colors.accent} />
						<Text style={styles.newTargetLabel} numberOfLines={1}>
							Link to: <Text style={styles.newTargetTitle}>{newTarget}</Text>
						</Text>
					</Pressable>
				) : null}

				{matches.length === 0 ? (
					<Text style={styles.empty}>
						{notes.length <= 1
							? "No other notes yet. Type a title above to link ahead of time."
							: "No notes match that search."}
					</Text>
				) : (
					matches.map((note) => (
						<Pressable
							key={note.id}
							accessibilityRole="button"
							accessibilityLabel={`Link to ${note.title || "Untitled Note"}`}
							onPress={() => onSelect(note.title || "Untitled Note")}
							style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
						>
							<View style={styles.rowBody}>
								<Text style={styles.rowTitle} numberOfLines={1}>
									{note.title || "Untitled Note"}
								</Text>
								<Text style={styles.rowMeta}>{relativeTime(note.updatedAt)}</Text>
							</View>
							<Ionicons name="link-outline" size={15} color={colors.textGhost} />
						</Pressable>
					))
				)}
			</ScrollView>
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		search: {
			backgroundColor: c.surface,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: c.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 10,
			color: c.text,
			fontSize: 14,
		},
		list: { marginTop: spacing.md, flex: 1 },
		listContent: { gap: spacing.sm, paddingBottom: spacing.md },
		newTarget: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.md,
			borderRadius: radius.lg,
			backgroundColor: c.accentSoft,
			borderColor: c.accentBorder,
			borderWidth: 1,
		},
		newTargetLabel: { flex: 1, color: c.textSecondary, fontSize: 13.5 },
		newTargetTitle: { color: c.accent, fontWeight: "600" },
		row: {
			flexDirection: "row",
			alignItems: "center",
			gap: spacing.md,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			backgroundColor: c.surface,
			borderColor: c.border,
			borderWidth: StyleSheet.hairlineWidth,
			borderRadius: radius.lg,
		},
		rowPressed: { backgroundColor: c.surfacePressed },
		rowBody: { flex: 1, minWidth: 0, paddingVertical: spacing.xs },
		rowTitle: { color: c.textSecondary, fontSize: 14, fontWeight: "500" },
		rowMeta: { ...typography.meta, marginTop: 2, color: c.textGhost },
		empty: {
			color: c.textFaint,
			fontSize: 13,
			lineHeight: 20,
			paddingVertical: spacing.xl,
			textAlign: "center",
		},
	});
