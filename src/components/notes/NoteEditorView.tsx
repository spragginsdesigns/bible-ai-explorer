"use client";

import React, { useState, useCallback } from "react";
import NoteEditorTopBar from "./NoteEditorTopBar";
import TiptapEditor from "./TiptapEditor";
import NoteAIPanel from "./NoteAIPanel";
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
			<div className="flex-1 flex min-h-0">
				<div className={`flex flex-col min-h-0 ${aiPanelOpen ? "w-3/5" : "flex-1"}`}>
					<TiptapEditor
						content={note.content}
						noteId={note.id}
						onSave={handleSave}
					/>
				</div>
				{aiPanelOpen && (
					<div className="w-2/5 min-w-[280px] max-w-[400px]">
						<NoteAIPanel
							noteId={note.id}
							noteTitle={note.title}
							noteContent={note.plainText}
							onClose={() => setAiPanelOpen(false)}
						/>
					</div>
				)}
			</div>
		</div>
	);
};

export default NoteEditorView;
