"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import NoteEditorTopBar, { type NoteSaveStatus } from "./NoteEditorTopBar";
import TiptapEditor, { type TiptapEditorHandle } from "./TiptapEditor";
import NoteAIPanel from "./NoteAIPanel";
import NoteInfoPanel from "./NoteInfoPanel";
import type { NoteAppendEvent } from "@/hooks/useNoteAI";
import type { Note, Folder, Tag } from "@/types/notes";

interface NoteEditorViewProps {
	note: Note;
	notes: Note[];
	folders: Folder[];
	tags: Tag[];
	onBack: () => void;
	onUpdate: (id: string, changes: Partial<Note>) => Promise<boolean>;
	onDelete: (id: string) => void;
	onTogglePin: (id: string) => void;
	onToggleTag: (noteId: string, tagId: string) => void;
	onCreateTag: (name: string, color: string) => void;
	onDeleteTag: (id: string) => void;
	onOpenNote: (id: string) => void;
	onCreateLinkedNote: (title: string) => Promise<void>;
}

const NoteEditorView: React.FC<NoteEditorViewProps> = ({
	note,
	notes,
	folders,
	tags,
	onBack,
	onUpdate,
	onDelete,
	onTogglePin,
	onToggleTag,
	onCreateTag,
	onDeleteTag,
	onOpenNote,
	onCreateLinkedNote,
}) => {
	const [aiPanelOpen, setAiPanelOpen] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>("idle");
	const editorRef = useRef<TiptapEditorHandle>(null);
	const saveSeqRef = useRef(0);

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 1023px)");
		setIsMobile(mq.matches);
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	// A fresh note starts without save history; "Saved" only lingers briefly.
	useEffect(() => {
		saveSeqRef.current += 1;
		setSaveStatus("idle");
	}, [note.id]);

	useEffect(() => {
		if (saveStatus !== "saved") return;
		const timer = setTimeout(() => setSaveStatus("idle"), 3000);
		return () => clearTimeout(timer);
	}, [saveStatus]);

	const handleSave = useCallback(
		async (data: {
			content: string;
			htmlContent: string;
			plainText: string;
			wordCount: number;
		}) => {
			// Overlapping saves resolve out of order; only the newest save may
			// stamp the final status.
			const seq = ++saveSeqRef.current;
			setSaveStatus("saving");
			const ok = await onUpdate(note.id, data);
			if (seq === saveSeqRef.current) setSaveStatus(ok ? "saved" : "error");
		},
		[note.id, onUpdate]
	);

	const handleSavePending = useCallback(() => setSaveStatus("saving"), []);

	// When the AI appends to the open note, insert into the live editor; the
	// editor's save round-trip then reconciles state and Tiptap JSON.
	const handleNoteAppended = useCallback(
		(event: NoteAppendEvent) => {
			if (event.noteId !== note.id) return;
			editorRef.current?.appendHtml(event.appendedHtml);
		},
		[note.id]
	);

	const handleInfoUpdate = useCallback(
		(changes: Partial<Note>) => onUpdate(note.id, changes),
		[note.id, onUpdate]
	);

	const handleCopyMarkdown = useCallback(async (title: string) => {
		if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
		const markdown = editorRef.current?.getMarkdown(title);
		if (markdown === undefined) throw new Error("Editor unavailable");
		await navigator.clipboard.writeText(markdown);
	}, []);

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
				onCopyMarkdown={handleCopyMarkdown}
				saveStatus={saveStatus}
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
						linkTargets={notes}
						onOpenNote={onOpenNote}
						onSave={handleSave}
						onSavePending={handleSavePending}
					/>
					<NoteInfoPanel
						note={note}
						onUpdate={handleInfoUpdate}
						onOpenNote={onOpenNote}
						onCreateLinkedNote={onCreateLinkedNote}
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
