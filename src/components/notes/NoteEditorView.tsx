"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import NoteEditorTopBar from "./NoteEditorTopBar";
import TiptapEditor, { type TiptapEditorHandle } from "./TiptapEditor";
import NoteAIPanel from "./NoteAIPanel";
import type { NoteAppendEvent } from "@/hooks/useNoteAI";
import type { Note, Folder, Tag } from "@/types/notes";

interface NoteEditorViewProps {
	note: Note;
	folders: Folder[];
	tags: Tag[];
	onBack: () => void;
	onUpdate: (id: string, changes: Partial<Note>) => void;
	onDelete: (id: string) => void;
	onTogglePin: (id: string) => void;
	onToggleTag: (noteId: string, tagId: string) => void;
	onCreateTag: (name: string, color: string) => void;
	onDeleteTag: (id: string) => void;
}

const NoteEditorView: React.FC<NoteEditorViewProps> = ({
	note,
	folders,
	tags,
	onBack,
	onUpdate,
	onDelete,
	onTogglePin,
	onToggleTag,
	onCreateTag,
	onDeleteTag,
}) => {
	const [aiPanelOpen, setAiPanelOpen] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const editorRef = useRef<TiptapEditorHandle>(null);

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 1023px)");
		setIsMobile(mq.matches);
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	const handleSave = useCallback(
		(data: {
			content: string;
			htmlContent: string;
			plainText: string;
			wordCount: number;
		}) => {
			onUpdate(note.id, data);
		},
		[note.id, onUpdate]
	);

	// When the AI appends to the open note, insert into the live editor; the
	// editor's save round-trip then reconciles state and Tiptap JSON.
	const handleNoteAppended = useCallback(
		(event: NoteAppendEvent) => {
			if (event.noteId !== note.id) return;
			editorRef.current?.appendHtml(event.appendedHtml);
		},
		[note.id]
	);

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<NoteEditorTopBar
				note={note}
				folders={folders}
				tags={tags}
				onBack={onBack}
				onUpdateTitle={(title) => onUpdate(note.id, { title })}
				onDelete={() => onDelete(note.id)}
				onTogglePin={() => onTogglePin(note.id)}
				onChangeFolder={(folderId) => onUpdate(note.id, { folderId })}
				onToggleTag={(tagId) => onToggleTag(note.id, tagId)}
				onCreateTag={onCreateTag}
				onDeleteTag={onDeleteTag}
				aiPanelOpen={aiPanelOpen}
				onToggleAIPanel={() => setAiPanelOpen(!aiPanelOpen)}
			/>
			<div className="flex-1 flex min-h-0 relative">
				{/* Editor - always full width on mobile, 3/5 on desktop when AI open */}
				<div className={`flex flex-col min-h-0 ${aiPanelOpen && !isMobile ? "w-3/5" : "flex-1"}`}>
					<TiptapEditor
						ref={editorRef}
						content={note.content}
						noteId={note.id}
						onSave={handleSave}
					/>
				</div>

				{/* AI Panel - fullscreen overlay on mobile, side panel on desktop */}
				{aiPanelOpen && (
					isMobile ? (
						<div className="absolute inset-0 z-40 bg-neutral-950/95 backdrop-blur-sm">
							<NoteAIPanel
								noteId={note.id}
								onClose={() => setAiPanelOpen(false)}
								onNoteAppended={handleNoteAppended}
							/>
						</div>
					) : (
						<div className="w-2/5 min-w-[280px] max-w-[400px]">
							<NoteAIPanel
								noteId={note.id}
								onClose={() => setAiPanelOpen(false)}
								onNoteAppended={handleNoteAppended}
							/>
						</div>
					)
				)}
			</div>
		</div>
	);
};

export default NoteEditorView;
