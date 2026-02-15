"use client";

import React, { useState } from "react";
import {
	FolderPlus,
	FileText,
	FolderOpen,
	Inbox,
	X,
	Check,
	Trash2,
} from "lucide-react";
import type { Folder, Tag } from "@/types/notes";

interface NotesSidebarProps {
	open: boolean;
	onClose: () => void;
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
}

const NotesSidebar: React.FC<NotesSidebarProps> = ({
	open,
	onClose,
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
		<>
			{/* Mobile backdrop */}
			{open && (
				<div
					className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
					onClick={onClose}
				/>
			)}

			<aside
				className={`
					fixed lg:relative z-50 top-0 left-0 h-full w-[85vw] max-w-72
					glass border-r border-white/[0.06]
					flex flex-col
					transition-transform duration-200 ease-in-out
					${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:hidden"}
				`}
			>
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
					<span className="text-amber-400 font-bold text-lg font-[family-name:var(--font-pirata)] drop-shadow-[0_0_8px_rgba(200,160,40,0.3)]">
						VerseMind
					</span>
					<button
						onClick={onClose}
						className="lg:hidden text-neutral-500 hover:text-neutral-300 transition-colors"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* New note button */}
				<div className="p-3">
					<button
						onClick={() => {
							onCreateNote();
							onClose();
						}}
						className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl gradient-border bg-white/[0.03] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 transition-colors text-sm"
					>
						<FileText className="w-4 h-4 text-amber-400" />
						New Note
					</button>
				</div>

				{/* Folder list */}
				<div className="flex-1 overflow-y-auto custom-scrollbar px-2">
					{/* All Notes */}
					<button
						onClick={() => {
							onSelectFolder(null);
							onClose();
						}}
						className={`
							w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm mb-0.5 transition-all duration-150
							${activeFolderId === null && !activeTagId
								? "bg-white/[0.06] text-neutral-200 border border-white/[0.1] glow-white-sm"
								: "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300 border border-transparent"
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
										className="flex-1 bg-transparent text-neutral-200 text-sm outline-none border-b border-amber-400/40 px-1"
									/>
									<button
										onClick={() => handleRenameFolder(folder.id)}
										className="text-amber-400 hover:text-amber-300 p-1"
									>
										<Check className="w-3.5 h-3.5" />
									</button>
								</div>
							) : (
								<button
									onClick={() => {
										onSelectFolder(folder.id);
										onClose();
									}}
									onDoubleClick={() => startEditingFolder(folder)}
									className={`
										w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm mb-0.5 transition-all duration-150
										${activeFolderId === folder.id
											? "bg-white/[0.06] text-neutral-200 border border-white/[0.1] glow-white-sm"
											: "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300 border border-transparent"
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
										className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-opacity"
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
								className="flex-1 bg-transparent text-neutral-200 text-sm outline-none border-b border-amber-400/40 px-1 placeholder:text-neutral-600"
							/>
							<button
								onClick={handleCreateFolder}
								className="text-amber-400 hover:text-amber-300 p-1"
							>
								<Check className="w-3.5 h-3.5" />
							</button>
						</div>
					) : (
						<button
							onClick={() => setIsCreatingFolder(true)}
							className="w-full flex items-center gap-2 px-3 py-2 text-neutral-600 hover:text-neutral-400 transition-colors text-xs mt-1"
						>
							<FolderPlus className="w-3.5 h-3.5" />
							New Folder
						</button>
					)}

					{/* Tags section */}
					{tags.length > 0 && (
						<div className="mt-4 pt-3 border-t border-white/[0.06]">
							<p className="text-neutral-600 text-[10px] uppercase tracking-wider px-3 mb-2">
								Tags
							</p>
							<div className="flex flex-wrap gap-1.5 px-2">
								{tags.map((tag) => (
									<button
										key={tag.id}
										onClick={() => {
											onSelectTag(activeTagId === tag.id ? null : tag.id);
											onClose();
										}}
										className={`
											inline-flex items-center px-2 py-1 rounded-full text-[11px] font-medium transition-all
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
			</aside>
		</>
	);
};

export default NotesSidebar;
