"use client";

import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
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
	{ content, noteId, linkTargets, onOpenNote, onSave, onSavePending },
	ref
) {
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
				const text = editor.getText();
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

			const send = () =>
				Promise.resolve(onSaveRef.current(data, owner, options)).then(
					(result) => result !== false,
					() => false
				);
			const run = (options?.immediate ? send() : chainRef.current.then(send)).then((ok) => {
				pendingSavesRef.current -= 1;
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
			dirtyRef.current = true;
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

	// First load into a new editor instance.
	useEffect(() => {
		if (!editor || loadedEditorRef.current === editor) return;
		loadedEditorRef.current = editor;
		contentNoteIdRef.current = noteId;
		dirtyRef.current = false;
		lastAppliedRef.current = content;
		applyContent(editor, content);
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
		if (content === lastAppliedRef.current) return;
		if (dirtyRef.current || pendingSavesRef.current > 0) return;
		lastAppliedRef.current = content;
		applyContent(editor, content);
	}, [editor, noteId, content]);

	// Leaving the tab or closing the page must not drop the last keystrokes.
	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "hidden") void save({ keepalive: true });
		};
		const onPageHide = () => {
			void save({ keepalive: true, immediate: true });
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", onPageHide);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", onPageHide);
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
			appendHtml: (html: string) => {
				if (!editor) return;
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
			<EditorToolbar editor={editor} notes={linkTargets} currentNoteId={noteId} />
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
