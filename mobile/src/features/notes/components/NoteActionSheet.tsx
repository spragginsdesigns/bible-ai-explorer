import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { spacing } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
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
	const styles = useThemedStyles(createStyles);

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
						icon={note.isPinned ? "pin" : "pin-outline"}
						label={note.isPinned ? "Unpin note" : "Pin note"}
						onPress={() => {
							onTogglePin(note.id);
							close();
						}}
					/>
					<SheetRow icon="folder-outline" label="Move to folder" onPress={() => setMode("folders")} />
					<SheetRow
						icon="trash-outline"
						label="Delete note"
						danger
						onPress={() => setMode("confirmDelete")}
					/>
				</View>
			) : null}

			{mode === "folders" ? (
				<ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
					<SheetRow
						icon="remove-circle-outline"
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
							icon="folder-outline"
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
						icon="trash-outline"
						label="Yes, delete it"
						danger
						onPress={() => {
							onDelete(note.id);
							close();
						}}
					/>
					<SheetRow icon="arrow-back" label="Keep note" onPress={() => setMode("actions")} />
				</View>
			) : null}
		</BottomSheet>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		scroll: { maxHeight: 320 },
		empty: {
			color: c.textGhost,
			fontSize: 13,
			paddingVertical: spacing.md,
			paddingHorizontal: spacing.sm,
		},
		confirm: {
			color: c.textMuted,
			fontSize: 14,
			lineHeight: 21,
			paddingHorizontal: spacing.sm,
			paddingBottom: spacing.md,
		},
	});
