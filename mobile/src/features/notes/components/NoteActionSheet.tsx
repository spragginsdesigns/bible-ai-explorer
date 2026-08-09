import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";
import type { Folder, Note } from "../types";
import { BottomSheet, SheetRow } from "./primitives";

type Mode = "actions" | "folders" | "confirmDelete";

/** Long-press menu for a note card: pin, move to folder, delete. */
export function NoteActionSheet({
	note,
	folders,
	onClose,
	onTogglePin,
	onMoveToFolder,
	onDelete,
}: {
	note: Note | null;
	folders: Folder[];
	onClose: () => void;
	onTogglePin: (id: string) => void;
	onMoveToFolder: (id: string, folderId: string | null) => void;
	onDelete: (id: string) => void;
}) {
	const [mode, setMode] = useState<Mode>("actions");

	const close = () => {
		setMode("actions");
		onClose();
	};

	if (!note) return null;

	return (
		<BottomSheet visible onClose={close} title={note.title || "Untitled Note"}>
			{mode === "actions" ? (
				<View>
					<SheetRow
						glyph="📌"
						label={note.isPinned ? "Unpin note" : "Pin note"}
						onPress={() => {
							onTogglePin(note.id);
							close();
						}}
					/>
					<SheetRow glyph="🗂" label="Move to folder" onPress={() => setMode("folders")} />
					<SheetRow
						glyph="🗑"
						label="Delete note"
						danger
						onPress={() => setMode("confirmDelete")}
					/>
				</View>
			) : null}

			{mode === "folders" ? (
				<ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
					<SheetRow
						glyph="←"
						label="No folder"
						selected={note.folderId === null}
						onPress={() => {
							onMoveToFolder(note.id, null);
							close();
						}}
					/>
					{folders.map((folder) => (
						<SheetRow
							key={folder.id}
							glyph="🗂"
							label={folder.name}
							selected={note.folderId === folder.id}
							onPress={() => {
								onMoveToFolder(note.id, folder.id);
								close();
							}}
						/>
					))}
					{folders.length === 0 ? (
						<Text style={styles.empty}>No folders yet. Create one from the filter bar.</Text>
					) : null}
				</ScrollView>
			) : null}

			{mode === "confirmDelete" ? (
				<View>
					<Text style={styles.confirm}>
						Delete “{note.title || "Untitled Note"}”? This cannot be undone.
					</Text>
					<SheetRow
						glyph="🗑"
						label="Yes, delete it"
						danger
						onPress={() => {
							onDelete(note.id);
							close();
						}}
					/>
					<SheetRow glyph="←" label="Keep note" onPress={() => setMode("actions")} />
				</View>
			) : null}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	scroll: { maxHeight: 320 },
	empty: {
		color: colors.textGhost,
		fontSize: 13,
		paddingVertical: spacing.md,
		paddingHorizontal: spacing.sm,
	},
	confirm: {
		color: colors.textMuted,
		fontSize: 14,
		lineHeight: 21,
		paddingHorizontal: spacing.sm,
		paddingBottom: spacing.md,
	},
});
