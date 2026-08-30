import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	BackHandler,
	KeyboardAvoidingView,
	StyleSheet,
	View,
} from "react-native";
import { AppText as Text } from "@/components/AppText";
import { typography } from "@/theme";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { spacing, type Colors } from "@/theme";
import { useTheme, useThemedStyles } from "@/features/settings/settingsStore";
import { useTabBarSpace } from "@/features/chat/layout";
import { InsertWikilinkSheet } from "@/features/notes/components/InsertWikilinkSheet";
import { NoteAIPanel } from "@/features/notes/components/NoteAIPanel";
import { NoteEditorTopBar } from "@/features/notes/components/NoteEditorTopBar";
import { NoteInfoSheet } from "@/features/notes/components/NoteInfoSheet";
import {
	NoteRichEditor,
	type NoteRichEditorHandle,
} from "@/features/notes/components/NoteRichEditor";
import { NoteTagSheet } from "@/features/notes/components/NoteTagSheet";
import type { NoteAppendEvent } from "@/features/notes/useNoteAI";
import { useNoteEditorData } from "@/features/notes/useNoteEditorData";
import { initialHtmlFor } from "@/features/notes/utils";
import { formatWikilink } from "@/features/notes/wikilinks";

/** Height of the parent layout's floating glass tab bar, which overlays this screen. */

export default function NoteEditorScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const styles = useThemedStyles(createStyles);
	const params = useLocalSearchParams<{ id: string | string[] }>();
	const noteId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

	const data = useNoteEditorData(noteId);
	const editorRef = useRef<NoteRichEditorHandle>(null);
	const [aiOpen, setAiOpen] = useState(false);
	const [tagsOpen, setTagsOpen] = useState(false);
	const [infoOpen, setInfoOpen] = useState(false);
	const [wikilinkOpen, setWikilinkOpen] = useState(false);

	const bottomInset = useTabBarSpace();

	const goBack = useCallback(async () => {
		await editorRef.current?.flush();
		// Always land on the notes hub: pops to it when it's in the stack,
		// replaces otherwise (plain back() could fall out to another tab).
		router.dismissTo("/notes");
	}, [router]);

	useEffect(() => {
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			void goBack();
			return true;
		});
		return () => subscription.remove();
	}, [goBack]);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") void editorRef.current?.flush();
		});
		return () => subscription.remove();
	}, []);

	const openAI = useCallback(async () => {
		// Save first so the assistant reads the current text, not the last autosave.
		await editorRef.current?.flush();
		setAiOpen(true);
	}, []);

	// Links are parsed server-side from the saved text, so an unflushed
	// [[wikilink]] would be missing from the sheet that is meant to show it.
	const openInfo = useCallback(async () => {
		await editorRef.current?.flush();
		setInfoOpen(true);
	}, []);

	const insertWikilink = useCallback((title: string) => {
		setWikilinkOpen(false);
		editorRef.current?.insertText(formatWikilink(title));
	}, []);

	const handleNoteAppended = useCallback(
		async (event: NoteAppendEvent) => {
			if (event.noteId !== noteId) return;
			const html = await data.refetchHtml();
			if (html !== null) editorRef.current?.replaceContent(html);
		},
		[noteId, data]
	);

	const note = data.note;
	// Keyed on id + body availability: a cached summary row (no body yet) must
	// not pin initialHtml to "" once the real body arrives.
	const initialHtml = useMemo(
		() => (note?.hasBody ? initialHtmlFor(note) : ""),
		[note?.id, note?.hasBody] // eslint-disable-line react-hooks/exhaustive-deps
	);

	return (
		<Screen>
			<KeyboardAvoidingView
				style={styles.fill}
				behavior="padding"
			>
				<NoteEditorTopBar
					title={note?.title ?? ""}
					isPinned={note?.isPinned ?? false}
					isSaving={data.isSaving}
					saveError={note ? data.error : null}
					tagCount={note?.tagIds.length ?? 0}
					aiOpen={aiOpen}
					onBack={() => void goBack()}
					onRename={(title) => void data.renameNote(title)}
					onTogglePin={() => void data.togglePin()}
					onOpenTags={() => setTagsOpen(true)}
					onOpenInfo={() => void openInfo()}
					onToggleAI={() => void openAI()}
				/>

				{data.isLoading ? (
					<View style={styles.center}>
						<ActivityIndicator color={colors.accent} />
					</View>
				) : note ? (
					<NoteRichEditor
						ref={editorRef}
						initialHtml={initialHtml}
						onSave={data.save}
						bottomInset={bottomInset}
						onRequestWikilink={() => setWikilinkOpen(true)}
					/>
				) : (
					<View style={styles.center}>
						<Text style={styles.error}>{data.error ?? "This note could not be opened."}</Text>
					</View>
				)}
			</KeyboardAvoidingView>

			<NoteTagSheet
				visible={tagsOpen}
				tags={data.tags}
				noteTagIds={note?.tagIds ?? []}
				onClose={() => setTagsOpen(false)}
				onToggleTag={(tagId) => void data.toggleTag(tagId)}
				onCreateTag={(name, color) => void data.createTag(name, color)}
			/>

			<InsertWikilinkSheet
				visible={wikilinkOpen}
				currentNoteId={noteId}
				onClose={() => setWikilinkOpen(false)}
				onSelect={insertWikilink}
			/>

			{note ? (
				<NoteInfoSheet
					visible={infoOpen}
					note={note}
					folderName={data.folders.find((folder) => folder.id === note.folderId)?.name ?? null}
					onClose={() => setInfoOpen(false)}
					onSaveAliases={(aliases) => void data.setAliases(aliases)}
					onSaveProperties={(properties) => void data.setProperties(properties)}
					onCreateLinkedNote={data.createLinkedNote}
				/>
			) : null}

			{note ? (
				<NoteAIPanel
					noteId={note.id}
					visible={aiOpen}
					onClose={() => setAiOpen(false)}
					onNoteAppended={(event) => void handleNoteAppended(event)}
				/>
			) : null}
		</Screen>
	);
}

const createStyles = (c: Colors) =>
	StyleSheet.create({
		fill: { flex: 1 },
		center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
		error: { color: c.danger, ...typography.support, textAlign: "center" },
	});
