"use client";

import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
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
import type { Note } from "@/types/notes";

interface TiptapEditorProps {
	content: string; // Tiptap JSON string or plain text
	noteId: string;
	/** Link targets offered by the insert-wikilink toolbar button. */
	linkTargets?: Note[];
	/** Open another note when a resolved in-body [[wikilink]] is clicked. */
	onOpenNote?: (noteId: string) => void;
	onSave: (data: {
		content: string;
		htmlContent: string;
		plainText: string;
		wordCount: number;
	}) => void;
}

export interface TiptapEditorHandle {
	/** Append HTML (e.g. AI-authored content) to the end of the document. */
	appendHtml: (html: string) => void;
}

const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor(
	{ content, noteId, linkTargets, onOpenNote, onSave },
	ref
) {
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const lastNoteIdRef = useRef(noteId);

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

	const doSave = useCallback(
		(editor: ReturnType<typeof useEditor>) => {
			if (!editor) return;
			const json = JSON.stringify(editor.getJSON());
			const html = editor.getHTML();
			const text = editor.getText();
			const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
			onSave({ content: json, htmlContent: html, plainText: text, wordCount });
		},
		[onSave]
	);

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: { levels: [1, 2, 3] },
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
				class: "prose-editor text-chat outline-none min-h-[200px] md:min-h-[300px] px-3 py-3 md:px-4 break-words",
			},
		},
		onUpdate: ({ editor: ed }) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => doSave(ed), 1500);
		},
		onBlur: ({ editor: ed }) => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			doSave(ed);
		},
	});

	// Set content when note changes
	useEffect(() => {
		if (!editor || noteId === lastNoteIdRef.current) return;
		lastNoteIdRef.current = noteId;

		if (!content) {
			editor.commands.clearContent();
			return;
		}

		try {
			const parsed = JSON.parse(content);
			editor.commands.setContent(parsed);
		} catch {
			// If not valid JSON, set as plain text
			editor.commands.setContent(content);
		}
	}, [editor, noteId, content]);

	// Initial content load
	useEffect(() => {
		if (!editor || !content) return;

		// Only set on first mount
		const editorIsEmpty =
			editor.getText().trim() === "" && editor.getHTML() === "<p></p>";
		if (!editorIsEmpty) return;

		try {
			const parsed = JSON.parse(content);
			editor.commands.setContent(parsed);
		} catch {
			editor.commands.setContent(content);
		}
	}, [editor, content]);

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	useImperativeHandle(
		ref,
		() => ({
			appendHtml: (html: string) => {
				if (!editor) return;
				editor.commands.insertContentAt(editor.state.doc.content.size, html);
				if (debounceRef.current) clearTimeout(debounceRef.current);
				doSave(editor);
			},
		}),
		[editor, doSave]
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
