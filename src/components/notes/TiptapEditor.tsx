"use client";

import { htmlToPlainText } from "@/lib/note-plain-text.mjs";
import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from "react";
import { clearEditorDraft, readEditorDraft, retainEditorDraft, type EditorDraft, type EditorDraftOwner } from "@/lib/notes/editor-draft";
import { adoptCanonicalDocument } from "@/lib/notes/canonical-document";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import UnderlineExtension from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import EditorToolbar from "./EditorToolbar";
import { WikilinkDecoration } from "./extensions/WikilinkDecoration";
import { noteHtmlToMarkdown } from "./noteMarkdownExport";
import type { Note } from "@/types/notes";
import type { UpdateNoteOptions } from "@/hooks/useNotes";

const AUTOSAVE_DELAY_MS = 1500;

export interface NoteSaveData {
	content: string;
	htmlContent: string;
	plainText: string;
	wordCount: number;
}

interface TiptapEditorProps {
	draftOwner?: EditorDraftOwner;
	readOnly?: boolean;
	canSave?: () => boolean;
	content: string; // Tiptap JSON string, HTML (Android saves), or plain text
	noteId: string;
	/** Link targets offered by the insert-wikilink toolbar button. */
	linkTargets?: Note[];
	/** Open another note when a resolved in-body [[wikilink]] is clicked. */
	onOpenNote?: (noteId: string) => void;
	/**
	 * Persist the editor body. `noteId` is the note the body belongs to, which
	 * can differ from the current prop when a save is flushed during a switch.
	 * Resolve false when the save failed so the editor keeps the edits dirty.
	 */
	onSave: (
		data: NoteSaveData,
		noteId: string,
		options?: UpdateNoteOptions
	) => Promise<boolean> | boolean | void;
	/** Fired when edits are queued or flushed, so the top bar can show "Saving…". */
	onSavePending?: () => void;
}

export interface TiptapEditorHandle {
	setReadOnly: (locked: boolean) => void;
	replaceCanonical: (content: string) => boolean;
	/** Append HTML (e.g. AI-authored content) to the end of the document. */
	appendHtml: (html: string) => void;
	/** Read the current editor state for export, bypassing the save debounce. */
	getMarkdown: (title: string) => string;
	/** Save pending edits now; resolves false when the save failed. */
	flush: () => Promise<boolean>;
}

function applyContent(editor: Editor, content: string) {
	// Loading a note is not an edit: emitting an update here would schedule a
	// save of unchanged text and bump the note's updatedAt on every open.
	if (!content) {
		editor.commands.clearContent(false);
		return;
	}
	try {
		editor.commands.setContent(JSON.parse(content), { emitUpdate: false });
	} catch {
		// Android stores HTML; older notes may hold plain text.
		editor.commands.setContent(content, { emitUpdate: false });
	}
}

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor(
	{ draftOwner, readOnly = false, canSave, content, noteId, linkTargets, onOpenNote, onSave, onSavePending },
	ref
) {
	const accountRef = useRef(draftOwner?.accountId);
	const pendingDraft = useRef<EditorDraft | null>(null);
	const [recovery, setRecovery] = useState<EditorDraft | null>(null);
	const [draftError, setDraftErrorState] = useState<string | null>(null);
	const draftErrorRef = useRef<string | null>(null);
	const setDraftError = (message: string | null) => { draftErrorRef.current = message; setDraftErrorState(message); };
	const lastDraft = useRef<{ draft: EditorDraft; persisted: boolean } | null>(null);
	const draftStorage = () => { try { return window.localStorage; } catch { return null; } };
	const bodyFor = (value: Editor): NoteSaveData => {
		const text = htmlToPlainText(value.getHTML());
		return { content: JSON.stringify(value.getJSON()), htmlContent: value.getHTML(), plainText: text, wordCount: text.trim() ? text.trim().split(/\s+/).length : 0 };
	};
	const lockedRef = useRef(readOnly);
	const canSaveRef = useRef(canSave); canSaveRef.current = canSave;
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** The note whose body is in the editor right now. */
	const contentNoteIdRef = useRef(noteId);
	/** The content string last loaded into, or saved from, the editor. */
	const lastAppliedRef = useRef<string | null>(null);
	const loadedEditorRef = useRef<Editor | null>(null);
	const dirtyRef = useRef(false);
	const pendingSavesRef = useRef(0);
	const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
	const editorRef = useRef<Editor | null>(null);

	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;
	const onSavePendingRef = useRef(onSavePending);
	onSavePendingRef.current = onSavePending;

	// The extension list is built once per editor, so the wikilink callbacks
	// read these refs to always see the current note list and open handler.
	const linkTargetsRef = useRef(linkTargets);
	linkTargetsRef.current = linkTargets;
	const onOpenNoteRef = useRef(onOpenNote);
	onOpenNoteRef.current = onOpenNote;

	// Mirrors the server's resolution rule in src/lib/note-links.ts:
	// case-insensitive over title + aliases, most recently updated note wins.
	const resolveTarget = useCallback((target: string): string | null => {
		const key = target.trim().toLowerCase();
		if (!key) return null;
		let winner: { id: string; updatedAt: string } | null = null;
		for (const note of linkTargetsRef.current ?? []) {
			const names = [note.title, ...note.aliases];
			if (!names.some((name) => name.trim().toLowerCase() === key)) continue;
			if (!winner || note.updatedAt > winner.updatedAt) {
				winner = { id: note.id, updatedAt: note.updatedAt };
			}
		}
		return winner?.id ?? null;
	}, []);

	/**
	 * Save the editor body if it has unsaved edits. The body is captured
	 * synchronously (so a note switch right after cannot leak the next note's
	 * text into this save), and saves run one at a time so an older PATCH can
	 * never land after a newer one. `immediate` skips the queue for pagehide,
	 * where a queued request may never get to run.
	 */
	const save = useCallback(
		(options?: UpdateNoteOptions & { immediate?: boolean }): Promise<boolean> => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			if (pendingDraft.current || draftErrorRef.current) return Promise.resolve(false);
			const retainedEditor = editorRef.current;
			if (retainedEditor && dirtyRef.current && accountRef.current) lastDraft.current = retainEditorDraft(draftStorage(), { accountId: accountRef.current, noteId: contentNoteIdRef.current }, bodyFor(retainedEditor));
			if (canSaveRef.current?.() === false) return Promise.resolve(false);
			const editor = editorRef.current;
			if (!editor || !dirtyRef.current) {
				// Nothing new to send: wait out any save still in flight, then
				// report whether this note is left with unsaved edits (a failed
				// save re-marks it dirty). A failure that belonged to a note we
				// already switched away from does not block this one.
				if (pendingSavesRef.current === 0) return Promise.resolve(!dirtyRef.current);
				return chainRef.current.then(() => !dirtyRef.current);
			}

			let data: NoteSaveData;
			try {
				const text = htmlToPlainText(editor.getHTML());
				data = {
					content: JSON.stringify(editor.getJSON()),
					htmlContent: editor.getHTML(),
					plainText: text,
					wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
				};
			} catch {
				return Promise.resolve(false);
			}
			const owner = contentNoteIdRef.current;
			dirtyRef.current = false;
			lastAppliedRef.current = data.content;
			pendingSavesRef.current += 1;
			onSavePendingRef.current?.();

			const savedDraft = lastDraft.current?.draft;
			const handler = onSaveRef.current;
			const send = () =>
				Promise.resolve(canSaveRef.current?.() === false ? false : handler(data, owner, options)).then(
					(result) => result !== false,
					() => false
				);
			const run = (options?.immediate ? send() : chainRef.current.then(send)).then((ok) => {
				pendingSavesRef.current -= 1;
				if (ok && savedDraft) clearEditorDraft(draftStorage(), savedDraft.owner, savedDraft.id);
				// Keep the edits dirty so the next flush, unmount or page hide retries them.
				if (!ok && contentNoteIdRef.current === owner) dirtyRef.current = true;
				return ok;
			});
			chainRef.current = run;
			return run;
		},
		[]
	);

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				// All six levels: Android's editor writes H4-H6, and a narrower
				// schema would flatten them to paragraphs on the next web save.
				heading: { levels: [1, 2, 3, 4, 5, 6] },
			}),
			Placeholder.configure({
				placeholder: "Start writing your Bible study notes...",
			}),
			Highlight,
			TaskList,
			TaskItem.configure({ nested: true }),
			Link.configure({
				openOnClick: true,
				HTMLAttributes: { class: "text-amber-400 underline hover:text-amber-300" },
			}),
			UnderlineExtension,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			WikilinkDecoration.configure({
				resolveTarget,
				onOpenNote: (id: string) => onOpenNoteRef.current?.(id),
			}),
		],
		editorProps: {
			attributes: {
				// globals.css styles h1-h3; h4-h6 are styled here so Android's
				// deeper headings stay visibly distinct.
				class: "prose-editor text-chat outline-none min-h-[200px] md:min-h-[300px] px-3 py-3 md:px-4 break-words [&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-2 [&_h5]:text-[0.9375rem] [&_h5]:font-semibold [&_h5]:mt-3 [&_h5]:mb-1.5 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:uppercase [&_h6]:tracking-wide [&_h6]:mt-3 [&_h6]:mb-1.5 [&_h6]:text-neutral-500 dark:[&_h6]:text-neutral-400",
			},
		},
		onUpdate: () => {
			if (lockedRef.current || pendingDraft.current || draftErrorRef.current) return;
			dirtyRef.current = true;
			const active = editorRef.current;
			if (active && accountRef.current) lastDraft.current = retainEditorDraft(draftStorage(), { accountId: accountRef.current, noteId: contentNoteIdRef.current }, bodyFor(active));
			onSavePendingRef.current?.();
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				void save();
			}, AUTOSAVE_DELAY_MS);
		},
		onBlur: () => {
			void save();
		},
	});
	editorRef.current = editor;
	useEffect(() => { lockedRef.current = readOnly; editor?.setEditable(!readOnly && !pendingDraft.current && !draftErrorRef.current, false); }, [editor, readOnly, draftError]);

	// First load into a new editor instance.
	useEffect(() => {
		if (!editor || loadedEditorRef.current === editor) return;
		loadedEditorRef.current = editor;
		contentNoteIdRef.current = noteId;
		dirtyRef.current = false;
		lastAppliedRef.current = content;
		applyContent(editor, content);
		if (accountRef.current) {
			try {
				const draft = readEditorDraft(draftStorage(), { accountId: accountRef.current, noteId });
				if (draft) {
					const expected = editor.schema.nodeFromJSON(JSON.parse(draft.body.content));
					if (editor.state.doc.eq(expected)) clearEditorDraft(draftStorage(), draft.owner, draft.id);
					else {
						pendingDraft.current = draft; setRecovery(draft); dirtyRef.current = true;
						applyContent(editor, draft.body.content); editor.setEditable(false, false);
					}
				}
			} catch { setDraftError("The retained local draft could not be opened. Editing is paused to protect it."); editor.setEditable(false, false); }
		}
		// Only a new editor instance re-seeds; later prop changes go through the
		// effects below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor]);

	// Switching notes (sidebar, back/forward, or a wikilink click while the
	// editor keeps focus): flush the outgoing note's edits under its own id
	// before its body is replaced.
	useEffect(() => {
		if (!editor || loadedEditorRef.current !== editor) return;
		if (noteId === contentNoteIdRef.current) return;
		void save();
		contentNoteIdRef.current = noteId;
		dirtyRef.current = false;
		lastAppliedRef.current = content;
		applyContent(editor, content);
		// Keyed on the note only; same-note content changes are reconciled below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, noteId, save]);

	// The same note changed underneath us (a background refetch picked up an
	// edit from Android, or the cached copy was replaced by the server's).
	// Adopt it only while there is nothing local it could overwrite.
	useEffect(() => {
		if (!editor || loadedEditorRef.current !== editor) return;
		if (noteId !== contentNoteIdRef.current) return;
		if (lockedRef.current || pendingDraft.current || content === lastAppliedRef.current) return;
		if (dirtyRef.current || pendingSavesRef.current > 0) return;
		lastAppliedRef.current = content;
		applyContent(editor, content);
	}, [editor, noteId, content]);

	// Leaving the tab or closing the page must not drop the last keystrokes.
	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "hidden") void save({ keepalive: true });
		};
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if ((dirtyRef.current || pendingDraft.current) && !lastDraft.current?.persisted) { event.preventDefault(); event.returnValue = ""; }
		};
		const onPageHide = () => {
			void save({ keepalive: true, immediate: true });
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", onPageHide);
		window.addEventListener("beforeunload", beforeUnload);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", onPageHide);
			window.removeEventListener("beforeunload", beforeUnload);
		};
	}, [save]);

	// Unmount (Back, route change, note deleted elsewhere): save what is pending.
	useEffect(
		() => () => {
			void save();
		},
		[save]
	);

	useImperativeHandle(
		ref,
		() => ({
			setReadOnly: locked => {
				lockedRef.current = locked; editor?.setEditable(!locked && !pendingDraft.current && !draftErrorRef.current, false);
				if (locked && timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
			},
			replaceCanonical: canonical => {
				if (!editor || editor.isDestroyed || draftErrorRef.current) return false;
				try {
					let expected;
					try { expected = editor.schema.nodeFromJSON(JSON.parse(canonical)); }
					catch { expected = ProseMirrorDOMParser.fromSchema(editor.schema).parse(new window.DOMParser().parseFromString(canonical, "text/html").body); }
					if (!adoptCanonicalDocument(expected, () => applyContent(editor, canonical), () => editor.state.doc)) return false;
					dirtyRef.current = false; lastAppliedRef.current = canonical;
					return true;
				} catch { return false; }
			},
			appendHtml: (html: string) => {
				if (!editor || lockedRef.current) return;
				editor.commands.insertContentAt(editor.state.doc.content.size, html);
				dirtyRef.current = true;
				void save();
			},
			getMarkdown: (title: string) =>
				editor
					? noteHtmlToMarkdown(title, editor.getHTML())
					: (() => {
						throw new Error("Editor unavailable");
					})(),
			flush: () => save(),
		}),
		[editor, save]
	);

	return (
		<div className="flex flex-col flex-1 min-h-0">
			{recovery ? <div role="status" className="border-b border-amber-600/30 px-4 py-3 text-sm">
				<p>Your unsaved local edits were retained. Review them before choosing which version to keep.</p>
				<details><summary>Retained local text</summary><pre className="whitespace-pre-wrap">{recovery.body.plainText}</pre></details>
				<button type="button" disabled={readOnly} className="mr-4 min-h-11" onClick={() => {
					if (lockedRef.current || !editor) return;
					applyContent(editor, recovery.body.content);
					pendingDraft.current = null; setRecovery(null); setDraftError(null); editor.setEditable(true, false); dirtyRef.current = true;
					void save();
				}}>Restore local edits</button>
				<button type="button" className="min-h-11" onClick={() => {
					if (!editor || !clearEditorDraft(draftStorage(), recovery.owner, recovery.id)) { setDraftError("The local recovery record could not be cleared."); return; }
					pendingDraft.current = null; setRecovery(null); setDraftError(null); dirtyRef.current = false;
					applyContent(editor, lastAppliedRef.current ?? content); editor.setEditable(!readOnly, false);
				}}>Keep saved note</button>
				{readOnly ? <p>Finish checking the assistant&apos;s saved changes before restoring local edits. You can still copy the retained text.</p> : null}
			</div> : null}
			{draftError ? <p role="alert" className="px-4 py-2 text-sm">{draftError}</p> : null}
			{!readOnly && !recovery && !draftError ? <EditorToolbar editor={editor} notes={linkTargets} currentNoteId={noteId} /> : null}
			<div className="flex-1 overflow-y-auto custom-scrollbar">
				{/* Comfortable writing measure on desktop; full width on phones */}
				<div className="mx-auto w-full max-w-3xl">
					<EditorContent editor={editor} />
				</div>
			</div>
		</div>
	);
});

export default TiptapEditor;
