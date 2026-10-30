"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import NoteEditorTopBar, { type NoteSaveStatus } from "./NoteEditorTopBar";
import TiptapEditor, { type NoteSaveData, type TiptapEditorHandle } from "./TiptapEditor";
import NoteAIPanel from "./NoteAIPanel";
import NoteInfoPanel from "./NoteInfoPanel";
import { useNoteAIOperation } from "@/hooks/useNoteAIOperation";
import type { NoteAIOperationController } from "@/lib/notes/note-ai-operation";
import type { UpdateNoteOptions } from "@/hooks/useNotes";
import { registerVoiceDepartureGuard } from "@/lib/voice/web-departure";
import { editorContentFor, toNote, type NoteApiResponse, type Note, type Folder, type Tag } from "@/types/notes";

interface NoteEditorViewProps {
	note: Note;
	notes: Note[];
	folders: Folder[];
	tags: Tag[];
	onBack: () => void;
	onUpdate: (id: string, changes: Partial<Note>, options?: UpdateNoteOptions) => Promise<boolean>;
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
	const operationRef = useRef<NoteAIOperationController | null>(null);
	const canonicalNote = useRef<Note | null>(null);
	const manualWrites = useRef(new Set<Promise<boolean>>());
	const safety = useNoteAIOperation(note.id, {
		prepare: async () => (await editorRef.current?.flush()) === true && (await Promise.all([...manualWrites.current])).every(Boolean),
		lock: locked => editorRef.current?.setReadOnly(locked),
		canonical: async () => {
			const owner = operationRef.current;
			if (!owner?.isCurrent()) return null;
			const response = await fetch(`/api/notes/${note.id}`, { cache: "no-store" });
			if (!response.ok) return null;
			const value = toNote(await response.json() as NoteApiResponse);
			if (!owner.isCurrent() || operationRef.current !== owner || value.id !== note.id) return null;
			canonicalNote.current = value;
			return editorContentFor(value);
		},
		adopt: async content => {
			const owner = operationRef.current, value = canonicalNote.current;
			if (!owner?.isCurrent() || !value || value.id !== note.id || !editorRef.current?.replaceCanonical(content)) return false;
			return onUpdate(note.id, value, { canonicalOnly: true, isCurrent: owner.isCurrent });
		},
	});
	operationRef.current = safety.controller;
	const updateManual = useCallback((changes: Partial<Note>) => {
		const owner = safety.controller;
		if (!owner.canEdit()) return Promise.resolve(false);
		const pending = onUpdate(note.id, changes, { isCurrent: owner.isCurrent });
		manualWrites.current.add(pending);
		void pending.then(() => manualWrites.current.delete(pending), () => manualWrites.current.delete(pending));
		return pending;
	}, [note.id, onUpdate, safety.controller]);
	const saveSeqRef = useRef(0);
	const currentNoteRef = useRef(note.id);
	currentNoteRef.current = note.id;
	const backBusy = useRef(false);
	const canLeave = useCallback(async () => {
		const owner = safety.controller;
		if (!owner.canEdit() && !await owner.recover()) return false;
		return (await editorRef.current?.flush()) === true && owner.isCurrent();
	}, [safety.controller]);

	// Only voice navigation uses this guard; existing note/back flows retain
	// their own save behavior. Do not leave on a failed or stale editor flush.
	useEffect(() => registerVoiceDepartureGuard(async () => {
		if (!editorRef.current || currentNoteRef.current !== note.id) return false;
		if (!safety.controller.canEdit() && !await safety.controller.recover()) return false;
		try {
			const ok = await editorRef.current.flush();
			if (!ok && currentNoteRef.current === note.id) setSaveStatus("error");
			return ok && currentNoteRef.current === note.id;
		} catch {
			if (currentNoteRef.current === note.id) setSaveStatus("error");
			return false;
		}
	}), [note.id, safety.controller]);

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
		async (data: NoteSaveData, ownerId: string, options?: UpdateNoteOptions) => {
			// A save flushed while switching notes belongs to the previous note
			// and must not stamp the status of the one now on screen.
			const owner = safety.controller;
			if (!owner.canSave() || ownerId !== note.id) return false;
			const isCurrent = ownerId === currentNoteRef.current;
			// Overlapping saves resolve out of order; only the newest save may
			// stamp the final status.
			const seq = isCurrent ? ++saveSeqRef.current : -1;
			if (isCurrent) setSaveStatus("saving");
			const ok = await onUpdate(ownerId, data, { ...options, isCurrent: owner.isCurrent });
			if (seq === saveSeqRef.current && ownerId === currentNoteRef.current) {
				setSaveStatus(ok ? "saved" : "error");
			}
			return ok;
		},
		[onUpdate, note.id, safety.controller]
	);

	const handleSavePending = useCallback(() => setSaveStatus("saving"), []);

	// Back waits for the pending save, as Android's editor does: a failed save
	// keeps the note open with its error showing instead of dropping the edits.
	const handleBack = useCallback(async () => {
		if (backBusy.current) return;
		backBusy.current = true;
		try {
			if (!safety.controller.canEdit() && !await safety.controller.recover()) return;
			const flushed = await editorRef.current?.flush();
			if (flushed === false) {
				setSaveStatus("error");
				return;
			}
			if (!safety.controller.isCurrent()) return;
			onBack();
		} finally {
			backBusy.current = false;
		}
	}, [onBack, safety.controller]);

	// Save first so the assistant reads the current text, not the last autosave.
	const handleToggleAIPanel = useCallback(async () => {
		if (aiPanelOpen) {
			if (await safety.controller.recover()) setAiPanelOpen(false);
			return;
		}
		if ((!safety.controller.canEdit() && !await safety.controller.recover()) || (await editorRef.current?.flush()) === false) {
			setSaveStatus("error");
			return;
		}
		if (!safety.controller.isCurrent()) return;
		setAiPanelOpen(true);
	}, [aiPanelOpen, safety.controller]);

	const closeAI = useCallback(async () => {
		if (!await safety.controller.recover() || !safety.controller.isCurrent()) return false;
		setAiPanelOpen(false); return true;
	}, [safety.controller]);
	const openNote = useCallback(async (id: string) => {
		const owner = safety.controller;
		if ((!owner.canEdit() && !await owner.recover()) || (await editorRef.current?.flush()) !== true || !owner.isCurrent()) return;
		onOpenNote(id);
	}, [onOpenNote, safety.controller]);

	const handleInfoUpdate = useCallback(
		(changes: Partial<Note>) => updateManual(changes),
		[updateManual]
	);

	const readMarkdown = useCallback((title: string): string => {
		const markdown = editorRef.current?.getMarkdown(title);
		if (markdown === undefined) throw new Error("Editor unavailable");
		return markdown;
	}, []);

	const handleCopyMarkdown = useCallback(async (title: string) => {
		if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
		await navigator.clipboard.writeText(readMarkdown(title));
	}, [readMarkdown]);

	// Android's "Share as Markdown": the system share sheet where there is
	// one, the clipboard everywhere else.
	const handleShareMarkdown = useCallback(
		async (title: string): Promise<"shared" | "copied" | "cancelled"> => {
			const markdown = readMarkdown(title);
			if (typeof navigator.share === "function") {
				try {
					await navigator.share({ title, text: markdown });
					return "shared";
				} catch (error) {
					// Dismissing the sheet is a choice, not a failure.
					if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
				}
			}
			if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
			await navigator.clipboard.writeText(markdown);
			return "copied";
		},
		[readMarkdown]
	);

	const folderName = folders.find((f) => f.id === note.folderId)?.name ?? null;

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<NoteEditorTopBar
				note={note}
				folders={folders}
				tags={tags}
				onBack={() => void handleBack()}
				readOnly={safety.locked}
				onUpdateTitle={(title) => void updateManual({ title })}
				onDelete={() => { if (safety.controller.canEdit()) onDelete(note.id); }}
				onTogglePin={() => { if (safety.controller.canEdit()) onTogglePin(note.id); }}
				onChangeFolder={(folderId) => void updateManual({ folderId })}
				onToggleTag={(tagId) => { if (safety.controller.canEdit()) onToggleTag(note.id, tagId); }}
				onCreateTag={onCreateTag}
				onDeleteTag={onDeleteTag}
				onCopyMarkdown={handleCopyMarkdown}
				onShareMarkdown={handleShareMarkdown}
				saveStatus={saveStatus}
				aiPanelOpen={aiPanelOpen}
				onToggleAIPanel={() => void handleToggleAIPanel()}
			/>
			{safety.locked ? <div role="status" className="px-4 py-2 text-sm">
				<p>{safety.error ?? "Editing is paused while SureWord checks the saved note."}</p>
				<button type="button" onClick={() => void safety.controller.recover()}>Check saved note</button>
			</div> : null}
			<div className="flex-1 flex min-h-0 relative">
				{/* Editor - always full width on mobile, 3/5 on desktop when AI open */}
				<div className={`flex flex-col min-h-0 ${aiPanelOpen && !isMobile ? "w-3/5" : "flex-1"}`}>
					<TiptapEditor
						ref={editorRef}
						key={safety.identity}
						draftOwner={{ accountId: safety.accountId, noteId: note.id }}
						readOnly={safety.locked}
						canSave={safety.controller.canSave}
						content={editorContentFor(note)}
						noteId={note.id}
						linkTargets={notes}
						onOpenNote={id => void openNote(id)}
						onSave={handleSave}
						onSavePending={handleSavePending}
					/>
					<NoteInfoPanel
						note={note}
						folderName={folderName}
						onUpdate={handleInfoUpdate}
						onOpenNote={id => void openNote(id)}
						onCreateLinkedNote={onCreateLinkedNote}
					/>
				</div>

				{/* AI Panel - fullscreen overlay on mobile, side panel on desktop */}
				{aiPanelOpen && (
					isMobile ? (
						<div className="absolute inset-0 z-40 bg-neutral-950/95 backdrop-blur-sm">
							<NoteAIPanel
								noteId={note.id}
								onClose={closeAI}
								operation={safety.controller}
								beforeNavigate={canLeave}
							/>
						</div>
					) : (
						<div className="w-2/5 min-w-[280px] max-w-[400px]">
							<NoteAIPanel
								noteId={note.id}
								onClose={closeAI}
								operation={safety.controller}
								beforeNavigate={canLeave}
							/>
						</div>
					)
				)}
			</div>
		</div>
	);
};

export default NoteEditorView;
