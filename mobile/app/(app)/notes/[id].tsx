import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	BackHandler,
	KeyboardAvoidingView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/ui";
import { colors, spacing } from "@/theme";
import { useTabBarSpace } from "@/features/chat/layout";
import { NoteAIPanel } from "@/features/notes/components/NoteAIPanel";
import { NoteEditorTopBar } from "@/features/notes/components/NoteEditorTopBar";
import {
	NoteRichEditor,
	type NoteRichEditorHandle,
} from "@/features/notes/components/NoteRichEditor";
import { NoteTagSheet } from "@/features/notes/components/NoteTagSheet";
import type { NoteAppendEvent } from "@/features/notes/useNoteAI";
import { useNoteEditorData } from "@/features/notes/useNoteEditorData";
import { initialHtmlFor } from "@/features/notes/utils";

/** Height of the parent layout's floating glass tab bar, which overlays this screen. */

export default function NoteEditorScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ id: string | string[] }>();
	const noteId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

	const data = useNoteEditorData(noteId);
	const editorRef = useRef<NoteRichEditorHandle>(null);
	const [aiOpen, setAiOpen] = useState(false);
	const [tagsOpen, setTagsOpen] = useState(false);

	const bottomInset = useTabBarSpace();

	const goBack = useCallback(async () => {
		await editorRef.current?.flush();
		if (router.canGoBack()) router.back();
		else router.replace("/notes");
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

	const handleNoteAppended = useCallback(
		async (event: NoteAppendEvent) => {
			if (event.noteId !== noteId) return;
			const html = await data.refetchHtml();
			if (html !== null) editorRef.current?.replaceContent(html);
		},
		[noteId, data]
	);

	const note = data.note;
	const initialHtml = useMemo(() => (note ? initialHtmlFor(note) : ""), [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

const styles = StyleSheet.create({
	fill: { flex: 1 },
	center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
	error: { color: colors.danger, fontSize: 14, textAlign: "center" },
});
