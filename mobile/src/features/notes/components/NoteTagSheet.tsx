import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { PRESET_TAG_COLORS, type Tag } from "../types";
import { BottomSheet } from "./primitives";

/** Tag picker for the open note: toggle existing tags or create a new one. */
export function NoteTagSheet({
	visible,
	tags,
	noteTagIds,
	onClose,
	onToggleTag,
	onCreateTag,
}: {
	visible: boolean;
	tags: Tag[];
	noteTagIds: string[];
	onClose: () => void;
	onToggleTag: (tagId: string) => void;
	onCreateTag: (name: string, color: string) => void;
}) {
	const [isCreating, setIsCreating] = useState(false);
	const [name, setName] = useState("");
	const [color, setColor] = useState<string>(PRESET_TAG_COLORS[0]);

	const resetCreate = () => {
		setIsCreating(false);
		setName("");
		setColor(PRESET_TAG_COLORS[0]);
	};

	const create = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		onCreateTag(trimmed, color);
		resetCreate();
	};

	return (
		<BottomSheet
			visible={visible}
			onClose={() => {
				resetCreate();
				onClose();
			}}
			title="Tags"
		>
			<ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
				{tags.map((tag) => {
					const selected = noteTagIds.includes(tag.id);
					return (
						<Pressable
							key={tag.id}
							accessibilityRole="button"
							accessibilityState={{ selected }}
							onPress={() => onToggleTag(tag.id)}
							style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
						>
							<View
								style={[
									styles.dot,
									{
										borderColor: tag.color,
										backgroundColor: selected ? tag.color : "transparent",
									},
								]}
							/>
							<Text style={[styles.rowLabel, selected && { color: colors.text }]}>
								{tag.name}
							</Text>
							{selected ? <Text style={styles.check}>✓</Text> : null}
						</Pressable>
					);
				})}
				{tags.length === 0 && !isCreating ? (
					<Text style={styles.empty}>No tags yet.</Text>
				) : null}
			</ScrollView>

			{isCreating ? (
				<View style={styles.createBox}>
					<TextInput
						value={name}
						onChangeText={setName}
						onSubmitEditing={create}
						autoFocus
						returnKeyType="done"
						placeholder="Tag name"
						placeholderTextColor={colors.textGhost}
						style={styles.input}
					/>
					<View style={styles.swatches}>
						{PRESET_TAG_COLORS.map((preset) => (
							<Pressable
								key={preset}
								accessibilityRole="button"
								accessibilityLabel={`Colour ${preset}`}
								accessibilityState={{ selected: color === preset }}
								onPress={() => setColor(preset)}
								style={[
									styles.swatch,
									{ backgroundColor: preset },
									color === preset && styles.swatchActive,
								]}
							/>
						))}
					</View>
					<View style={styles.createActions}>
						<Pressable accessibilityRole="button" onPress={create} disabled={!name.trim()}>
							<Text style={[styles.createLabel, !name.trim() && { opacity: 0.4 }]}>Create</Text>
						</Pressable>
						<Pressable accessibilityRole="button" onPress={resetCreate}>
							<Text style={styles.cancelLabel}>Cancel</Text>
						</Pressable>
					</View>
				</View>
			) : (
				<Pressable
					accessibilityRole="button"
					onPress={() => setIsCreating(true)}
					style={({ pressed }) => [styles.newTag, pressed && styles.rowPressed]}
				>
					<Text style={styles.newTagLabel}>＋  New tag</Text>
				</Pressable>
			)}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	list: { maxHeight: 260 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: spacing.md,
		paddingVertical: 12,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
	},
	rowPressed: { backgroundColor: colors.surfacePressed },
	dot: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5 },
	rowLabel: { flex: 1, color: colors.textSecondary, fontSize: 14.5 },
	check: { color: colors.accent, fontSize: 14 },
	empty: { color: colors.textGhost, fontSize: 13, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },

	newTag: {
		paddingVertical: 12,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.border,
	},
	newTagLabel: { color: colors.textFaint, fontSize: 13.5 },

	createBox: {
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.border,
		paddingTop: spacing.md,
		gap: spacing.md,
	},
	input: {
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
		borderRadius: radius.md,
		paddingHorizontal: spacing.md,
		paddingVertical: 10,
		color: colors.text,
		fontSize: 14.5,
	},
	swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
	swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
	swatchActive: { borderColor: colors.text },
	createActions: { flexDirection: "row", alignItems: "center", gap: spacing.xl, paddingBottom: spacing.sm },
	createLabel: { color: colors.accent, fontSize: 14, fontWeight: "600" },
	cancelLabel: { color: colors.textFaint, fontSize: 14 },
});
