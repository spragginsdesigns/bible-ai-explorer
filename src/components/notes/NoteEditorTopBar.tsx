"use client";

import React, { useState, useRef, useEffect } from "react";
import { ArrowLeft, Trash2, Pin, PinOff, FolderOpen, Tag as TagIcon, Brain } from "lucide-react";
import TagManager from "./TagManager";
import type { Note, Folder, Tag } from "@/types/notes";

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
	aiPanelOpen,
	onToggleAIPanel,
}) => {
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [titleValue, setTitleValue] = useState(note.title);
	const [showFolderMenu, setShowFolderMenu] = useState(false);
	const [showTagMenu, setShowTagMenu] = useState(false);
	const titleRef = useRef<HTMLInputElement>(null);
	const folderMenuRef = useRef<HTMLDivElement>(null);
	const tagMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setTitleValue(note.title);
	}, [note.title]);

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

	return (
		<div className="flex flex-col border-b border-white/[0.06] glass flex-shrink-0">
			{/* Top row */}
			<div className="h-12 flex items-center justify-between px-3 gap-2">
				<button
					onClick={onBack}
					className="text-neutral-500 hover:text-neutral-200 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1"
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

				<div className="flex items-center gap-0">
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
					<button
						onClick={onDelete}
						title="Delete note"
						className="text-neutral-500 hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
					>
						<Trash2 className="w-4 h-4" />
					</button>
				</div>
			</div>

			{/* Meta row: folder + tags */}
			<div className="flex items-center gap-2 px-4 pb-2.5 overflow-x-auto scrollbar-hide">
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
						className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
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
