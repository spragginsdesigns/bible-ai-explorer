import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { spacing } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { GlyphButton } from "./primitives";

/** Editor chrome: back, inline title, pin, tags and the AI panel toggle. */
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
	onToggleAI: () => void;
}) {
	const [draft, setDraft] = useState(title);
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);

	// Keep in sync when the server rewrites the title (e.g. AI-created notes).
	useEffect(() => setDraft(title), [title]);

	return (
		<View style={styles.bar}>
			<GlyphButton icon="arrow-back" accessibilityLabel="Back to notes" onPress={onBack} size={36} />

			<View style={styles.titleWrap}>
				<TextInput
					value={draft}
					onChangeText={setDraft}
					onBlur={() => {
						if (draft.trim() !== title) onRename(draft);
					}}
					onSubmitEditing={() => {
						if (draft.trim() !== title) onRename(draft);
					}}
					placeholder="Untitled Note"
					placeholderTextColor={colors.textGhost}
					returnKeyType="done"
					style={styles.title}
					numberOfLines={1}
				/>
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
			fontWeight: "600",
			paddingVertical: 4,
		},
		saving: { color: c.textGhost, fontSize: 10.5, marginTop: -2 },
		saveError: { color: c.danger, fontSize: 10.5, marginTop: -2 },
	});
