import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "@/components/AppText";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Pin from "lucide-react-native/icons/pin";
import Sparkles from "lucide-react-native/icons/sparkles";
import { spacing, typography } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import { GlyphButton, LUCIDE_STROKE } from "./primitives";

/**
 * Editor chrome, deliberately sparse: back, the inline-rename title with its
 * save status underneath, the AI panel toggle and the note menu. Everything
 * else about the note (pin, tags, info, copy/share, move, delete) lives in
 * that menu, so the bar stays calm no matter how many actions a note has.
 */
export function NoteEditorTopBar({
	title,
	isPinned,
	isSaving,
	saveError,
	aiOpen,
	onBack,
	onRename,
	onToggleAI,
	onOpenMenu,
}: {
	title: string;
	isPinned: boolean;
	isSaving: boolean;
	/** Set when the last save/mutation failed; shown in place of "Saving…". */
	saveError: string | null;
	aiOpen: boolean;
	onBack: () => void;
	onRename: (title: string) => void;
	onToggleAI: () => void;
	onOpenMenu: () => void;
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
			<GlyphButton Icon={ArrowLeft} accessibilityLabel="Back to notes" onPress={onBack} size={36} />

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
						accessibilityLabel={`Rename note, ${draft || "Untitled Note"}${isPinned ? ", pinned" : ""}`}
						onPress={() => setEditing(true)}
						style={styles.titleRow}
					>
						{/* Pinning moved into the menu, so the state needs to stay
						    readable at a glance without costing a button. */}
						{isPinned ? (
							<Pin size={13} strokeWidth={LUCIDE_STROKE} color={colors.accent} />
						) : null}
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
				Icon={Sparkles}
				accessibilityLabel="AI assistant"
				onPress={onToggleAI}
				active={aiOpen}
				size={36}
			/>
			<GlyphButton Icon={Ellipsis} accessibilityLabel="Note menu" onPress={onOpenMenu} size={36} />
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
		titleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
		title: {
			color: c.text,
			fontSize: 17,
			lineHeight: 24,
			fontWeight: "600",
			paddingVertical: 4,
		},
		// Matches the input's resting height so swapping between the two does
		// not nudge the bar, and truncates at the end instead of the start.
		titleText: { minHeight: 32, flexShrink: 1 },
		saving: { ...typography.meta, color: c.textGhost, marginTop: -2 },
		saveError: { ...typography.meta, color: c.danger, marginTop: -2 },
	});
