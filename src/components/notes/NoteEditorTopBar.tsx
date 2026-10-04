"use client";

import React, { useState, useRef, useEffect } from "react";
import { ArrowLeft, Trash2, Pin, PinOff, FolderOpen, Tag as TagIcon, Brain, Copy, Share2 } from "lucide-react";
import TagManager from "./TagManager";
import type { Note, Folder, Tag } from "@/types/notes";

/** Autosave lifecycle surfaced in the top bar, mirroring Android's 'Saving…'. */
export type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

const SAVE_STATUS_LABEL: Record<Exclude<NoteSaveStatus, "idle">, string> = {
	saving: "Saving…",
	saved: "Saved",
	error: "Couldn't save — edits will retry on the next change",
};

const menuItemClass =
	"w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]";

interface NoteEditorTopBarProps {
	note: Note;
	folders: Folder[];
	tags: Tag[];
	onBack: () => void;
	onUpdateTitle: (title: string) => void;
	onDelete: () => void;
	onTogglePin: () => void;
	onChangeFolder: (folderId: string | null) => void;
	onToggleTag: (tagId: string) => void;
	onCreateTag: (name: string, color: string) => void;
	onDeleteTag: (id: string) => void;
	onCopyMarkdown?: (title: string) => Promise<void>;
	/** Opens the native share sheet; resolves "copied" when it fell back to the clipboard. */
	onShareMarkdown?: (title: string) => Promise<"shared" | "copied" | "cancelled">;
	saveStatus?: NoteSaveStatus;
	aiPanelOpen?: boolean;
	onToggleAIPanel?: () => void;
}

const NoteEditorTopBar: React.FC<NoteEditorTopBarProps> = ({
	note,
	folders,
	tags,
	onBack,
	onUpdateTitle,
	onDelete,
	onTogglePin,
	onChangeFolder,
	onToggleTag,
	onCreateTag,
	onDeleteTag,
	onCopyMarkdown,
	onShareMarkdown,
	saveStatus = "idle",
	aiPanelOpen,
	onToggleAIPanel,
}) => {
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [titleValue, setTitleValue] = useState(note.title);
	const [showFolderMenu, setShowFolderMenu] = useState(false);
	const [showTagMenu, setShowTagMenu] = useState(false);
	const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error" | "shareError">("idle");
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const deleteMenuRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
 const currentNote = useRef(note.id);
 currentNote.current = note.id;
 const copyBusy = useRef(false);
	const folderMenuRef = useRef<HTMLDivElement>(null);
	const tagMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setTitleValue(note.title);
		setCopyStatus("idle");
	}, [note.title, note.id]);

	useEffect(() => {
		setConfirmingDelete(false);
	}, [note.id]);

	useEffect(() => {
		if (isEditingTitle && titleRef.current) {
			titleRef.current.focus();
			titleRef.current.select();
		}
	}, [isEditingTitle]);

	// Close menus on outside click
	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
				setShowFolderMenu(false);
			}
			if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
				setShowTagMenu(false);
			}
			if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
				setConfirmingDelete(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	const commitTitle = () => {
		setIsEditingTitle(false);
		const trimmed = titleValue.trim() || "Untitled Note";
		if (trimmed !== note.title) onUpdateTitle(trimmed);
	};

	const currentFolder = folders.find((f) => f.id === note.folderId);
	const noteTags = tags.filter((t) => note.tagIds.includes(t.id));
	const copyMarkdown = async () => {
		if (!onCopyMarkdown || copyBusy.current) return;
        copyBusy.current = true;
        const owner = note.id;
		setCopyStatus("idle");
		try {
			await onCopyMarkdown(titleValue.trim() || "Untitled Note");
			if (currentNote.current === owner) setCopyStatus("success");
		} catch {
			if (currentNote.current === owner) setCopyStatus("error");
        } finally {
            copyBusy.current = false;
		}
	};

	const shareMarkdown = async () => {
		if (!onShareMarkdown || copyBusy.current) return;
		copyBusy.current = true;
		const owner = note.id;
		setCopyStatus("idle");
		try {
			const result = await onShareMarkdown(titleValue.trim() || "Untitled Note");
			if (currentNote.current === owner && result === "copied") setCopyStatus("success");
		} catch {
			if (currentNote.current === owner) setCopyStatus("shareError");
		} finally {
			copyBusy.current = false;
		}
	};

	return (
		// Both rows sit in the same centred max-w-3xl column as the editor body
		// and toolbar, so the note header has one left edge instead of three.
		<div className="flex flex-col border-b border-white/[0.06] glass flex-shrink-0">
			{/* Top row */}
			<div className="mx-auto w-full max-w-3xl h-12 flex items-center justify-between px-3 md:px-4 gap-2">
				<button
					onClick={onBack}
					aria-label="Back to notes"
					className="text-neutral-500 hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
				>
					<ArrowLeft className="w-5 h-5" />
				</button>

				{isEditingTitle ? (
					<input
						ref={titleRef}
						value={titleValue}
						onChange={(e) => setTitleValue(e.target.value)}
						onBlur={commitTitle}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitTitle();
							if (e.key === "Escape") {
								setTitleValue(note.title);
								setIsEditingTitle(false);
							}
						}}
						className="flex-1 bg-transparent text-neutral-200 text-sm font-medium outline-none border-b border-amber-400/40 py-1"
					/>
				) : (
					<button
						onClick={() => setIsEditingTitle(true)}
						className="flex-1 text-left text-neutral-200 text-sm font-medium truncate hover:text-amber-400 transition-colors py-1"
					>
						{note.title || "Untitled Note"}
					</button>
				)}

				{/* Visible at every width: Android always shows "Saving…" under
				    the title, and phones are where an unsaved edit is likeliest. */}
				{saveStatus !== "idle" && (
					<span
						role="status"
						aria-live="polite"
						title={SAVE_STATUS_LABEL[saveStatus]}
						className={`flex-shrink min-w-0 max-w-[40%] sm:max-w-none truncate text-metadata ${
							saveStatus === "error"
								? "text-red-400"
								: "text-neutral-500 dark:text-neutral-500"
						}`}
					>
						{SAVE_STATUS_LABEL[saveStatus]}
					</span>
				)}

				<div className="flex items-center gap-0">
					{onCopyMarkdown && (
						<button
							onClick={copyMarkdown}
							title="Copy note as Markdown"
							aria-label="Copy note as Markdown"
							className="text-neutral-500 hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
						>
							<Copy className="w-4 h-4" />
						</button>
					)}
					{onShareMarkdown && (
						<button
							onClick={shareMarkdown}
							title="Share as Markdown"
							aria-label="Share as Markdown"
							className="text-neutral-500 hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
						>
							<Share2 className="w-4 h-4" />
						</button>
					)}
					{onToggleAIPanel && (
						<button
							onClick={onToggleAIPanel}
							title="AI Chat"
							className={`transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center ${
								aiPanelOpen
									? "text-amber-400"
									: "text-neutral-500 hover:text-amber-400"
							}`}
						>
							<Brain className="w-4 h-4" />
						</button>
					)}
					<button
						onClick={onTogglePin}
						title={note.isPinned ? "Unpin" : "Pin"}
						className="text-neutral-500 hover:text-amber-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
					>
						{note.isPinned ? (
							<PinOff className="w-4 h-4" />
						) : (
							<Pin className="w-4 h-4" />
						)}
					</button>
					{/* Same confirm step as the list card and Android's action sheet. */}
					<div className="relative" ref={deleteMenuRef}>
						<button
							onClick={() => setConfirmingDelete((open) => !open)}
							title="Delete note"
							aria-label="Delete note"
							aria-haspopup="menu"
							aria-expanded={confirmingDelete}
							className="text-neutral-500 hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
						>
							<Trash2 className="w-4 h-4" />
						</button>
						{confirmingDelete && (
							<div
								role="menu"
								className="absolute top-full right-0 mt-1 z-50 w-[220px] glass-card border border-white/[0.08] rounded-xl py-1 shadow-xl"
							>
								<p className="px-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 break-words">
									Delete “{note.title || "Untitled Note"}”? This cannot be undone.
								</p>
								<button
									type="button"
									role="menuitem"
									className={`${menuItemClass} text-red-400 hover:text-red-300`}
									onClick={() => {
										setConfirmingDelete(false);
										onDelete();
									}}
								>
									<Trash2 className="w-3.5 h-3.5" />
									Yes, delete it
								</button>
								<button
									type="button"
									role="menuitem"
									className={menuItemClass}
									onClick={() => setConfirmingDelete(false)}
								>
									Keep note
								</button>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Meta row: folder + tags */}
			<div className="mx-auto w-full max-w-3xl flex items-center gap-2 px-3 md:px-4 pb-2.5 overflow-x-auto scrollbar-hide">
				{copyStatus !== "idle" && (
					<span role="status" aria-live="polite" className={copyStatus === "success" ? "text-xs text-emerald-400" : "text-xs text-red-400"}>
						{copyStatus === "success"
						? "Markdown copied"
						: copyStatus === "shareError"
							? "Share failed. Please try again."
							: "Copy failed. Check clipboard permissions."}
					</span>
				)}
				{/* Folder selector */}
				<div className="relative" ref={folderMenuRef}>
					<button
						onClick={() => setShowFolderMenu(!showFolderMenu)}
						className="flex items-center gap-1 text-neutral-500 hover:text-neutral-300 transition-colors text-xs px-2 py-1 rounded-lg border border-white/[0.06] hover:border-white/[0.1]"
					>
						<FolderOpen className="w-3 h-3" />
						{currentFolder?.name ?? "Unfiled"}
					</button>
					{showFolderMenu && (
						<div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] glass-card border border-white/[0.08] rounded-xl py-1 shadow-xl">
							<button
								onClick={() => {
									onChangeFolder(null);
									setShowFolderMenu(false);
								}}
								className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
									!note.folderId
										? "text-amber-400"
										: "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]"
								}`}
							>
								Unfiled
							</button>
							{folders.map((f) => (
								<button
									key={f.id}
									onClick={() => {
										onChangeFolder(f.id);
										setShowFolderMenu(false);
									}}
									className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
										note.folderId === f.id
											? "text-amber-400"
											: "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]"
									}`}
								>
									{f.name}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Tag chips */}
				{noteTags.map((tag) => (
					<span
						key={tag.id}
						className="inline-flex items-center px-2 py-0.5 rounded-full text-metadata font-medium"
						style={{
							backgroundColor: `${tag.color}20`,
							color: tag.color,
						}}
					>
						{tag.name}
					</span>
				))}

				{/* Add tag */}
				<div className="relative" ref={tagMenuRef}>
					<button
						onClick={() => setShowTagMenu(!showTagMenu)}
						className="flex items-center gap-1 text-neutral-600 hover:text-neutral-400 transition-colors text-xs px-1.5 py-0.5 rounded-lg"
					>
						<TagIcon className="w-3 h-3" />
						<span>+</span>
					</button>
					{showTagMenu && (
						<div className="absolute top-full left-0 mt-1 z-50">
							<TagManager
								tags={tags}
								noteTagIds={note.tagIds}
								onToggleTag={onToggleTag}
								onCreateTag={onCreateTag}
								onDeleteTag={onDeleteTag}
								onClose={() => setShowTagMenu(false)}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default NoteEditorTopBar;
