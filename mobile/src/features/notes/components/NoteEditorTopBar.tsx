import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import { spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { GlyphButton } from "./primitives";

/** Editor chrome: back, inline title, pin, tags, note info and the AI panel toggle. */
export function NoteEditorTopBar({
	title,
	isPinned,
	isSaving,
	saveError,
	tagCount,
	aiOpen,
	onBack,
	onRename,
	onTogglePin,
	onOpenTags,
	onOpenInfo,
	onToggleAI,
}: {
	title: string;
	isPinned: boolean;
	isSaving: boolean;
	/** Set when the last save/mutation failed; shown in place of "Saving…". */
	saveError: string | null;
	tagCount: number;
	aiOpen: boolean;
	onBack: () => void;
	onRename: (title: string) => void;
	onTogglePin: () => void;
	onOpenTags: () => void;
	onOpenInfo: () => void;
	onToggleAI: () => void;
}) {
	const [draft, setDraft] = useState(title);
	// A single-line TextInput scrolls to the caret, so a title longer than the
	// bar showed its tail with the beginning cut off and no ellipsis. Resting
	// state is therefore a Text, which truncates at the end; tapping it swaps in
	// the real input, focused, so renaming is unchanged.
	const [editing, setEditing] = useState(false);
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	// Keep in sync when the server rewrites the title (e.g. AI-created notes).
	useEffect(() => setDraft(title), [title]);

	const commit = () => {
		setEditing(false);
		if (draft.trim() !== title) onRename(draft);
	};

	return (
		<View style={styles.bar}>
			<GlyphButton icon="arrow-back" accessibilityLabel="Back to notes" onPress={onBack} size={36} />

			<View style={styles.titleWrap}>
				{editing ? (
					<TextInput
						autoFocus
						value={draft}
						onChangeText={setDraft}
						onBlur={commit}
						onSubmitEditing={commit}
						placeholder="Untitled Note"
						placeholderTextColor={colors.textGhost}
						returnKeyType="done"
						style={styles.title}
						numberOfLines={1}
					/>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Rename note, ${draft || "Untitled Note"}`}
						onPress={() => setEditing(true)}
					>
						<Text
							numberOfLines={1}
							style={[styles.title, styles.titleText, !draft && { color: colors.textGhost }]}
						>
							{draft || "Untitled Note"}
						</Text>
					</Pressable>
				)}
				{isSaving ? <Text style={styles.saving}>Saving…</Text> : null}
				{!isSaving && saveError ? (
					<Text style={styles.saveError}>Couldn't save — will retry on next edit</Text>
				) : null}
			</View>

			<GlyphButton
				icon={isPinned ? "pin" : "pin-outline"}
				accessibilityLabel={isPinned ? "Unpin note" : "Pin note"}
				onPress={onTogglePin}
				active={isPinned}
				size={36}
			/>
			<GlyphButton
				icon={tagCount > 0 ? "pricetags" : "pricetags-outline"}
				accessibilityLabel={`Manage tags, ${tagCount} applied`}
				onPress={onOpenTags}
				active={tagCount > 0}
				size={36}
			/>
			<GlyphButton
				icon="information-circle-outline"
				accessibilityLabel="Note info, properties and links"
				onPress={onOpenInfo}
				size={36}
			/>
			<GlyphButton
				icon={aiOpen ? "sparkles" : "sparkles-outline"}
				accessibilityLabel="AI assistant"
				onPress={onToggleAI}
				active={aiOpen}
				size={36}
			/>
		</View>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		bar: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.border,
			backgroundColor: c.bg,
		},
		titleWrap: { flex: 1, paddingHorizontal: 2 },
		title: {
			color: c.text,
			fontSize: 17,
			lineHeight: 24,
			fontWeight: "600",
			paddingVertical: 4,
		},
		// Matches the input's resting height so swapping between the two does
		// not nudge the bar, and truncates at the end instead of the start.
		titleText: { minHeight: 32 },
		saving: { ...typography.meta, color: c.textGhost, marginTop: -2 },
		saveError: { ...typography.meta, color: c.danger, marginTop: -2 },
	});
