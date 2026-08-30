"use client";

import React, { useState } from "react";
import {
	FolderPlus,
	FileText,
	FolderOpen,
	Inbox,
	Check,
	Trash2,
} from "lucide-react";
import type { Folder, Tag } from "@/types/notes";

interface NotesSidebarProps {
	folders: Folder[];
	tags: Tag[];
	activeFolderId: string | null;
	activeTagId: string | null;
	onSelectFolder: (id: string | null) => void;
	onSelectTag: (id: string | null) => void;
	onCreateFolder: (name: string) => void;
	onRenameFolder: (id: string, name: string) => void;
	onDeleteFolder: (id: string) => void;
	onCreateNote: () => void;
	/** Called after any navigation-like action so the mobile drawer can close. */
	onNavigate?: () => void;
}

/**
 * Notes folders + tags section rendered inside AppSidebar: new-note button,
 * folder list with inline create/rename, and tag filters. The sidebar chrome
 * (brand, nav, account footer, mobile drawer behavior) lives in AppSidebar.
 */
const NotesSidebar: React.FC<NotesSidebarProps> = ({
	folders,
	tags,
	activeFolderId,
	activeTagId,
	onSelectFolder,
	onSelectTag,
	onCreateFolder,
	onRenameFolder,
	onDeleteFolder,
	onCreateNote,
	onNavigate,
}) => {
	const [isCreatingFolder, setIsCreatingFolder] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
	const [editFolderName, setEditFolderName] = useState("");

	const handleCreateFolder = () => {
		const name = newFolderName.trim();
		if (name) {
			onCreateFolder(name);
			setNewFolderName("");
			setIsCreatingFolder(false);
		}
	};

	const handleRenameFolder = (id: string) => {
		const name = editFolderName.trim();
		if (name) {
			onRenameFolder(id, name);
			setEditingFolderId(null);
		}
	};

	const startEditingFolder = (folder: Folder) => {
		setEditingFolderId(folder.id);
		setEditFolderName(folder.name);
	};

	return (
		<div className="flex flex-col pb-3">
			{/* New note button */}
			<button
				onClick={() => {
					onCreateNote();
					onNavigate?.();
				}}
				className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl gradient-border bg-black/[0.02] dark:bg-white/[0.03] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors text-sm"
			>
				<FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />
				New Note
			</button>

			<p className="px-3 pt-4 pb-1.5 text-metadata font-bold uppercase tracking-[0.12em] text-neutral-400 dark:text-neutral-600">
				Folders
			</p>

			{/* All Notes */}
			<button
				onClick={() => {
					onSelectFolder(null);
					onNavigate?.();
				}}
				className={`
					w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm mb-0.5 transition-all duration-150
					${activeFolderId === null && !activeTagId
						? "bg-black/[0.05] dark:bg-white/[0.06] text-neutral-800 dark:text-neutral-200 border border-black/[0.1] dark:border-white/[0.1] glow-white-sm"
						: "text-neutral-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:text-neutral-700 dark:hover:text-neutral-300 border border-transparent"
					}
				`}
			>
				<Inbox className="w-4 h-4" />
				All Notes
			</button>

			{/* Folders */}
			{folders.map((folder) => (
				<div key={folder.id} className="group relative">
					{editingFolderId === folder.id ? (
						<div className="flex items-center gap-1 px-2 py-1.5">
							<input
								autoFocus
								value={editFolderName}
								onChange={(e) => setEditFolderName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleRenameFolder(folder.id);
									if (e.key === "Escape") setEditingFolderId(null);
								}}
								className="flex-1 bg-transparent text-neutral-800 dark:text-neutral-200 text-sm outline-none border-b border-amber-400/40 px-1"
							/>
							<button
								onClick={() => handleRenameFolder(folder.id)}
								className="text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 p-1"
							>
								<Check className="w-3.5 h-3.5" />
							</button>
						</div>
					) : (
						<button
							onClick={() => {
								onSelectFolder(folder.id);
								onNavigate?.();
							}}
							onDoubleClick={() => startEditingFolder(folder)}
							className={`
								w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm mb-0.5 transition-all duration-150
								${activeFolderId === folder.id
									? "bg-black/[0.05] dark:bg-white/[0.06] text-neutral-800 dark:text-neutral-200 border border-black/[0.1] dark:border-white/[0.1] glow-white-sm"
									: "text-neutral-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:text-neutral-700 dark:hover:text-neutral-300 border border-transparent"
								}
							`}
						>
							<FolderOpen className="w-4 h-4" />
							<span className="flex-1 truncate text-left">{folder.name}</span>
							<button
								onClick={(e) => {
									e.stopPropagation();
									onDeleteFolder(folder.id);
								}}
								className="opacity-0 group-hover:opacity-100 text-neutral-400 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
							>
								<Trash2 className="w-3.5 h-3.5" />
							</button>
						</button>
					)}
				</div>
			))}

			{/* New folder */}
			{isCreatingFolder ? (
				<div className="flex items-center gap-1 px-2 py-1.5">
					<input
						autoFocus
						value={newFolderName}
						onChange={(e) => setNewFolderName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleCreateFolder();
							if (e.key === "Escape") setIsCreatingFolder(false);
						}}
						placeholder="Folder name"
						className="flex-1 bg-transparent text-neutral-800 dark:text-neutral-200 text-sm outline-none border-b border-amber-400/40 px-1 placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
					/>
					<button
						onClick={handleCreateFolder}
						className="text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 p-1"
					>
						<Check className="w-3.5 h-3.5" />
					</button>
				</div>
			) : (
				<button
					onClick={() => setIsCreatingFolder(true)}
					className="w-full flex items-center gap-2 px-3 py-2 text-neutral-400 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-400 transition-colors text-xs mt-1"
				>
					<FolderPlus className="w-3.5 h-3.5" />
					New Folder
				</button>
			)}

			{/* Tags section */}
			{tags.length > 0 && (
				<div className="mt-4 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
					<p className="text-neutral-400 dark:text-neutral-600 text-metadata font-bold uppercase tracking-[0.12em] px-3 mb-2">
						Tags
					</p>
					<div className="flex flex-wrap gap-1.5 px-2">
						{tags.map((tag) => (
							<button
								key={tag.id}
								onClick={() => {
									onSelectTag(activeTagId === tag.id ? null : tag.id);
									onNavigate?.();
								}}
								className={`
									inline-flex items-center px-2 py-1 rounded-full text-metadata font-medium transition-all
									${activeTagId === tag.id
										? "ring-1 ring-offset-1 ring-offset-transparent"
										: "opacity-70 hover:opacity-100"
									}
								`}
								style={{
									backgroundColor: `${tag.color}20`,
									color: tag.color,
									...(activeTagId === tag.id ? { ringColor: tag.color } : {}),
								}}
							>
								{tag.name}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
};

export default NotesSidebar;
