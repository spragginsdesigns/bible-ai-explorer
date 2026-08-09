import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AccentButton } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import { PRESET_TAG_COLORS } from "../types";
import { BottomSheet } from "./primitives";

/**
 * Shared create sheet for folders (name only) and tags (name + swatch).
 * `onSubmit` receives the trimmed name and, for tags, the chosen colour.
 */
export function CreateItemSheet({
	visible,
	kind,
	onClose,
	onSubmit,
}: {
	visible: boolean;
	kind: "folder" | "tag";
	onClose: () => void;
	onSubmit: (name: string, color: string) => void;
}) {
	const [name, setName] = useState("");
	const [color, setColor] = useState<string>(PRESET_TAG_COLORS[0]);

	useEffect(() => {
		if (visible) {
			setName("");
			setColor(PRESET_TAG_COLORS[0]);
		}
	}, [visible]);

	const submit = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		onSubmit(trimmed, color);
		onClose();
	};

	return (
		<BottomSheet
			visible={visible}
			onClose={onClose}
			title={kind === "folder" ? "New folder" : "New tag"}
		>
			<TextInput
				value={name}
				onChangeText={setName}
				onSubmitEditing={submit}
				autoFocus
				returnKeyType="done"
				placeholder={kind === "folder" ? "Folder name" : "Tag name"}
				placeholderTextColor={colors.textGhost}
				style={styles.input}
			/>

			{kind === "tag" ? (
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
			) : null}

			<AccentButton
				label={kind === "folder" ? "Create folder" : "Create tag"}
				onPress={submit}
				disabled={!name.trim()}
				style={styles.submit}
			/>
			<Text style={styles.hint}>
				{kind === "folder"
					? "Folders group your studies; filter by them from the notes list."
					: "Tags show as coloured dots on each note card."}
			</Text>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	input: {
		backgroundColor: colors.surface,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
		borderRadius: radius.md,
		paddingHorizontal: spacing.md,
		paddingVertical: 12,
		color: colors.text,
		fontSize: 15,
	},
	swatches: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: spacing.md,
		marginTop: spacing.lg,
	},
	swatch: {
		width: 30,
		height: 30,
		borderRadius: 15,
		borderWidth: 2,
		borderColor: "transparent",
	},
	swatchActive: { borderColor: colors.text },
	submit: { marginTop: spacing.xl },
	hint: {
		color: colors.textGhost,
		fontSize: 12,
		textAlign: "center",
		marginTop: spacing.md,
		lineHeight: 17,
	},
});
