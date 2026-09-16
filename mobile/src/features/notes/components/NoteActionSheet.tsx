import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/components/AppText";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import FolderMinus from "lucide-react-native/icons/folder-minus";
import FolderOpen from "lucide-react-native/icons/folder-open";
import Info from "lucide-react-native/icons/info";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import Share2 from "lucide-react-native/icons/share-2";
import Tags from "lucide-react-native/icons/tags";
import Trash from "lucide-react-native/icons/trash";
import { spacing, typography } from "@/theme";
import { useThemedStyles } from "@/features/settings/settingsStore";
import type { Colors } from "@/theme";
import type { Folder, Note } from "../types";
import { BottomSheet, SheetRow } from "./primitives";

type Mode = "actions" | "folders" | "confirmDelete";
/** Which async row is running; only one can be in flight at a time. */
type Pending = "copy" | "share" | null;

/** How long the "Copied" confirmation stays up before the sheet dismisses. */
const COPIED_DWELL_MS = 700;

/**
 * The one menu for a note, shared by the editor's "More" button and the
 * library card's long press. Rows appear only when the caller supplies their
 * handler, so the card menu stays short while the editor gets the full set.
 */
export function NoteActionSheet({
	note,
	folders,
	onClose,
	onTogglePin,
	onMoveToFolder,
	onDelete,
	tagCount = 0,
	onOpenTags,
	onOpenInfo,
	onCopyMarkdown,
	onShareMarkdown,
}: {
	note: Note | null;
	folders: Folder[];
	onClose: () => void;
	onTogglePin: (id: string) => void;
	onMoveToFolder: (id: string, folderId: string | null) => void;
	onDelete: (id: string) => void;
	tagCount?: number;
	onOpenTags?: () => void;
	onOpenInfo?: () => void;
	onCopyMarkdown?: () => Promise<void>;
	onShareMarkdown?: () => Promise<void>;
}) {
	const [mode, setMode] = useState<Mode>("actions");
	const [pending, setPending] = useState<Pending>(null);
	const [copied, setCopied] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const styles = useThemedStyles(createStyles);

	// A slow clipboard/share must never write state into a sheet that has since
	// been closed, unmounted, or re-pointed at a different note.
	const mounted = useRef(true);
	const noteId = note?.id ?? null;
	const activeNote = useRef(noteId);
	activeNote.current = noteId;
	const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (dismissTimer.current) clearTimeout(dismissTimer.current);
		};
	}, []);

	// Opening the menu on another note starts clean.
	useEffect(() => {
		setMode("actions");
		setPending(null);
		setCopied(false);
		setActionError(null);
	}, [noteId]);

	const close = useCallback(() => {
		if (dismissTimer.current) clearTimeout(dismissTimer.current);
		setMode("actions");
		setPending(null);
		setCopied(false);
		setActionError(null);
		onClose();
	}, [onClose]);

	/** Shared runner for the two clipboard/share rows. */
	const run = useCallback(
		async (kind: Exclude<Pending, null>, action: () => Promise<void>) => {
			// Inert during the "Copied" dwell too, so a second tap cannot start a
			// duplicate run and strand the pending dismissal timer.
			if (pending || copied) return;
			const owner = activeNote.current;
			setPending(kind);
			setActionError(null);
			try {
				await action();
				if (!mounted.current || activeNote.current !== owner) return;
				setPending(null);
				if (kind === "share") {
					close();
					return;
				}
				// Let the confirmation land before the sheet slides away.
				setCopied(true);
				dismissTimer.current = setTimeout(() => {
					if (mounted.current && activeNote.current === owner) close();
				}, COPIED_DWELL_MS);
			} catch (error) {
				if (!mounted.current || activeNote.current !== owner) return;
				setPending(null);
				setActionError(
					error instanceof Error ? error.message : "That did not work. Please try again."
				);
			}
		},
		[pending, copied, close]
	);

	if (!note) return null;

	return (
		<BottomSheet visible onClose={close} title={note.title || "Untitled Note"}>
			{mode === "actions" ? (
				<View>
					<SheetRow
						Icon={note.isPinned ? PinOff : Pin}
						label={note.isPinned ? "Unpin note" : "Pin note"}
						onPress={() => {
							onTogglePin(note.id);
							close();
						}}
					/>

					{onOpenTags ? (
						<SheetRow
							Icon={Tags}
							label="Tags"
							meta={tagCount > 0 ? String(tagCount) : undefined}
							onPress={() => {
								onOpenTags();
								close();
							}}
						/>
					) : null}

					{onOpenInfo ? (
						<SheetRow
							Icon={Info}
							label="Note info"
							onPress={() => {
								onOpenInfo();
								close();
							}}
						/>
					) : null}

					{onCopyMarkdown ? (
						<SheetRow
							Icon={copied ? Check : Copy}
							label={copied ? "Copied" : pending === "copy" ? "Copying…" : "Copy as Markdown"}
							accent={copied}
							busy={pending === "copy"}
							onPress={() => void run("copy", onCopyMarkdown)}
						/>
					) : null}

					{onShareMarkdown ? (
						<SheetRow
							Icon={Share2}
							label={pending === "share" ? "Sharing…" : "Share as Markdown"}
							busy={pending === "share"}
							onPress={() => void run("share", onShareMarkdown)}
						/>
					) : null}

					{actionError ? (
						<Text accessibilityLiveRegion="polite" style={styles.actionError}>
							{actionError}
						</Text>
					) : null}

					<SheetRow Icon={FolderOpen} label="Move to folder" onPress={() => setMode("folders")} />
					<SheetRow
						Icon={Trash}
						label="Delete note"
						danger
						onPress={() => setMode("confirmDelete")}
					/>
				</View>
			) : null}

			{mode === "folders" ? (
				<ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
					<SheetRow
						Icon={FolderMinus}
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
							Icon={FolderOpen}
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
						Icon={Trash}
						label="Yes, delete it"
						danger
						onPress={() => {
							onDelete(note.id);
							close();
						}}
					/>
					<SheetRow Icon={ArrowLeft} label="Keep note" onPress={() => setMode("actions")} />
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
		actionError: {
			...typography.meta,
			color: c.danger,
			paddingHorizontal: spacing.sm,
			paddingBottom: spacing.sm,
		},
	});
