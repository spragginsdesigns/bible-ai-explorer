"use client";

import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pin, PinOff, FolderOpen, Trash2 } from "lucide-react";
import type { Folder, Note, Tag } from "@/types/notes";

interface NoteCardProps {
	note: Note;
	tags: Tag[];
	folders: Folder[];
	isActive: boolean;
	onClick: () => void;
	onTogglePin: () => void;
	onMoveToFolder: (folderId: string | null) => void;
	onDelete: () => void;
}

type MenuMode = "actions" | "folders" | "confirmDelete";

const menuItemClass =
	"w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03]";

const NoteCard: React.FC<NoteCardProps> = ({
	note,
	tags,
	folders,
	isActive,
	onClick,
	onTogglePin,
	onMoveToFolder,
	onDelete,
}) => {
	const noteTags = tags.filter((t) => note.tagIds.includes(t.id));
	const snippet = note.plainText.slice(0, 120) || "Empty note";
	const dateStr = new Date(note.updatedAt).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});

	const [menuOpen, setMenuOpen] = useState(false);
	const [menuMode, setMenuMode] = useState<MenuMode>("actions");
	const menuRef = useRef<HTMLDivElement>(null);

	// Close the menu on outside click
	useEffect(() => {
		if (!menuOpen) return;
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
				setMenuMode("actions");
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [menuOpen]);

	const closeMenu = () => {
		setMenuOpen(false);
		setMenuMode("actions");
	};

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick();
				}
			}}
			className={`
				relative w-full h-full min-w-0 flex flex-col text-left p-4 rounded-xl border transition-all duration-150 animate-message-in cursor-pointer
				${isActive
					? "glass-card border-amber-500/30 dark:border-amber-400/20 glow-amber-sm"
					: "glass-card border-black/[0.06] dark:border-white/[0.06] hover:border-amber-500/25 dark:hover:border-amber-400/20 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
				}
			`}
		>
			<div className="flex items-start justify-between gap-2 mb-1 min-w-0">
				<h3 className="text-neutral-800 dark:text-neutral-200 font-medium text-sm truncate flex-1 min-w-0">
					{note.title || "Untitled Note"}
				</h3>
				{note.isPinned && (
					<Pin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
				)}
				{/* List-level actions, ported from Android's long-press sheet */}
				<div className="relative flex-shrink-0" ref={menuRef}>
					<button
						type="button"
						aria-label="Note actions"
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen((open) => !open);
							setMenuMode("actions");
						}}
						className="text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors -mt-0.5 -mr-1 p-1 rounded-lg"
					>
						<MoreHorizontal className="w-4 h-4" />
					</button>
					{menuOpen && (
						<div
							role="menu"
							className="absolute top-full right-0 mt-1 z-50 min-w-[160px] max-h-72 overflow-y-auto custom-scrollbar glass-card border border-white/[0.08] rounded-xl py-1 shadow-xl"
						>
							{menuMode === "actions" && (
								<>
									<button
										type="button"
										className={menuItemClass}
										onClick={(e) => {
											e.stopPropagation();
											onTogglePin();
											closeMenu();
										}}
									>
										{note.isPinned ? (
											<PinOff className="w-3.5 h-3.5" />
										) : (
											<Pin className="w-3.5 h-3.5" />
										)}
										{note.isPinned ? "Unpin note" : "Pin note"}
									</button>
									<button
										type="button"
										className={menuItemClass}
										onClick={(e) => {
											e.stopPropagation();
											setMenuMode("folders");
										}}
									>
										<FolderOpen className="w-3.5 h-3.5" />
										Move to folder
									</button>
									<button
										type="button"
										className={`${menuItemClass} text-red-400/90 hover:text-red-400`}
										onClick={(e) => {
											e.stopPropagation();
											setMenuMode("confirmDelete");
										}}
									>
										<Trash2 className="w-3.5 h-3.5" />
										Delete note
									</button>
								</>
							)}
							{menuMode === "folders" && (
								<>
									<button
										type="button"
										className={`${menuItemClass} ${!note.folderId ? "text-amber-400" : ""}`}
										onClick={(e) => {
											e.stopPropagation();
											onMoveToFolder(null);
											closeMenu();
										}}
									>
										Unfiled
									</button>
									{folders.map((f) => (
										<button
											type="button"
											key={f.id}
											className={`${menuItemClass} ${note.folderId === f.id ? "text-amber-400" : ""}`}
											onClick={(e) => {
												e.stopPropagation();
												onMoveToFolder(f.id);
												closeMenu();
											}}
										>
											{f.name}
										</button>
									))}
									{folders.length === 0 && (
										<p className="px-3 py-1.5 text-metadata text-neutral-600">
											No folders yet
										</p>
									)}
								</>
							)}
							{menuMode === "confirmDelete" && (
								<>
									<p className="px-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
										Delete “{note.title || "Untitled Note"}”? This cannot be undone.
									</p>
									<button
										type="button"
										className={`${menuItemClass} text-red-400 hover:text-red-300`}
										onClick={(e) => {
											e.stopPropagation();
											onDelete();
											closeMenu();
										}}
									>
										<Trash2 className="w-3.5 h-3.5" />
										Yes, delete it
									</button>
									<button
										type="button"
										className={menuItemClass}
										onClick={(e) => {
											e.stopPropagation();
											setMenuMode("actions");
										}}
									>
										Keep note
									</button>
								</>
							)}
						</div>
					)}
				</div>
			</div>
			{/* break-words: line-clamp uses -webkit-box, which does not cap the
			    element's max-content width, so a long unbroken string still
			    stretched the card. */}
			<p className="text-neutral-500 text-xs line-clamp-2 mb-2 flex-1 min-w-0 break-words">
				{snippet}
			</p>
			<div className="flex items-center justify-between gap-2 min-w-0">
				<div className="flex items-center gap-1.5 overflow-hidden min-w-0">
					{noteTags.slice(0, 3).map((tag) => (
						<span
							key={tag.id}
							className="inline-flex items-center px-1.5 py-0.5 rounded-full text-metadata font-medium max-w-full truncate"
							style={{
								backgroundColor: `${tag.color}20`,
								color: tag.color,
							}}
						>
							{tag.name}
						</span>
					))}
					{noteTags.length > 3 && (
						<span className="text-neutral-600 text-metadata">
							+{noteTags.length - 3}
						</span>
					)}
				</div>
				<span className="text-neutral-600 text-metadata flex-shrink-0">{dateStr}</span>
			</div>
		</div>
	);
};

export default NoteCard;
