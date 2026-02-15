"use client";

import React, { useEffect, useRef, useCallback } from "react";
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

interface TiptapEditorProps {
	content: string; // Tiptap JSON string or plain text
	noteId: string;
	onSave: (data: {
		content: string;
		htmlContent: string;
		plainText: string;
		wordCount: number;
	}) => void;
}

const TiptapEditor: React.FC<TiptapEditorProps> = ({ content, noteId, onSave }) => {
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const lastNoteIdRef = useRef(noteId);

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
		],
		editorProps: {
			attributes: {
				class: "prose-editor outline-none min-h-[300px] px-4 py-3",
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

	return (
		<div className="flex flex-col flex-1 min-h-0">
			<EditorToolbar editor={editor} />
			<div className="flex-1 overflow-y-auto custom-scrollbar">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
};

export default TiptapEditor;
