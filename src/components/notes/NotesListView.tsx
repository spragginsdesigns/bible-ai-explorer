"use client";

import React, { useState } from "react";
import { ArrowDownUp, Check, Loader2 } from "lucide-react";
import NoteCard from "./NoteCard";
import { NewTagForm } from "./TagManager";
import type { Folder, Note, Tag } from "@/types/notes";
import type { SortOption } from "@/hooks/useNotes";

interface NotesListViewProps {
	notes: Note[];
	/** Every note in the library, before search and filters. */
	totalNotes: number;
	tags: Tag[];
	folders: Folder[];
	activeNoteId: string | null;
	activeFolderId: string | null;
	activeTagId: string | null;
	sortBy: SortOption;
	isLoading: boolean;
	loadError: string | null;
	onRetry: () => void;
	onSelectNote: (id: string) => void;
	onSortChange: (sort: SortOption) => void;
	onTogglePin: (id: string) => void;
	onMoveToFolder: (id: string, folderId: string | null) => void;
	onDeleteNote: (id: string) => void;
	onSelectFolder: (id: string | null) => void;
	onSelectTag: (id: string | null) => void;
	onCreateFolder: (name: string) => Promise<unknown>;
	onCreateTag: (name: string, color: string) => Promise<unknown>;
}

const SORT_LABELS: Record<SortOption, string> = {
	updatedAt: "Last Modified",
	createdAt: "Created",
	title: "Title",
};

const SORT_ORDER: SortOption[] = ["updatedAt", "createdAt", "title"];

const chipClass = (active: boolean) =>
	`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
		active
			? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
			: "border-black/[0.08] dark:border-white/[0.08] text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
	}`;

const NotesListView: React.FC<NotesListViewProps> = ({
	notes,
	totalNotes,
	tags,
	folders,
	activeNoteId,
	activeFolderId,
	activeTagId,
	sortBy,
	isLoading,
	loadError,
	onRetry,
	onSelectNote,
	onSortChange,
	onTogglePin,
	onMoveToFolder,
	onDeleteNote,
	onSelectFolder,
	onSelectTag,
	onCreateFolder,
	onCreateTag,
}) => {
	const [creating, setCreating] = useState<"folder" | "tag" | null>(null);
	const [folderName, setFolderName] = useState("");
	const [createError, setCreateError] = useState<string | null>(null);

	const cycleSortOption = () => {
		const idx = SORT_ORDER.indexOf(sortBy);
		onSortChange(SORT_ORDER[(idx + 1) % SORT_ORDER.length]);
	};

	const closeCreate = () => {
		setCreating(null);
		setFolderName("");
		setCreateError(null);
	};

	const submitFolder = async () => {
		const name = folderName.trim();
		if (!name) return;
		try {
			await onCreateFolder(name);
			closeCreate();
		} catch {
			setCreateError("The folder could not be created.");
		}
	};

	const submitTag = async (name: string, color: string) => {
		try {
			await onCreateTag(name, color);
			closeCreate();
		} catch {
			setCreateError("The tag could not be created.");
		}
	};

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Phone filter chips, as on Android's notes hub; desktop filters
			    from the sidebar instead. */}
			<div className="lg:hidden flex flex-col gap-2 pt-3">
				<div className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-4">
					<button
						type="button"
						aria-pressed={activeFolderId === null}
						onClick={() => onSelectFolder(null)}
						className={chipClass(activeFolderId === null)}
					>
						All
					</button>
					{folders.map((folder) => (
						<button
							key={folder.id}
							type="button"
							aria-pressed={activeFolderId === folder.id}
							onClick={() => onSelectFolder(activeFolderId === folder.id ? null : folder.id)}
							className={chipClass(activeFolderId === folder.id)}
						>
							{folder.name}
						</button>
					))}
					<button
						type="button"
						onClick={() => setCreating(creating === "folder" ? null : "folder")}
						className={chipClass(false)}
					>
						+ Folder
					</button>
				</div>
				<div className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-4">
					{tags.map((tag) => (
						<button
							key={tag.id}
							type="button"
							aria-pressed={activeTagId === tag.id}
							onClick={() => onSelectTag(activeTagId === tag.id ? null : tag.id)}
							className={chipClass(activeTagId === tag.id)}
						>
							<span
								aria-hidden
								className="w-2 h-2 rounded-full flex-shrink-0"
								style={{ backgroundColor: tag.color }}
							/>
							{tag.name}
						</button>
					))}
					<button
						type="button"
						onClick={() => setCreating(creating === "tag" ? null : "tag")}
						className={chipClass(false)}
					>
						+ Tag
					</button>
				</div>
			</div>

			{creating && (
				<div className="mx-auto w-full max-w-5xl px-4 lg:px-8 pt-3">
					<div className="glass-card rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3 max-w-sm">
						<p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
							{creating === "folder" ? "New folder" : "New tag"}
						</p>
						{creating === "folder" ? (
							<div className="flex items-center gap-2">
								<input
									autoFocus
									value={folderName}
									onChange={(e) => setFolderName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") void submitFolder();
										if (e.key === "Escape") closeCreate();
									}}
									placeholder="Folder name"
									aria-label="Folder name"
									className="flex-1 min-w-0 bg-transparent text-neutral-800 dark:text-neutral-200 text-xs outline-none border-b border-black/[0.1] dark:border-white/[0.1] pb-1 placeholder:text-neutral-400 dark:placeholder:text-neutral-600"
								/>
								<button
									type="button"
									onClick={() => void submitFolder()}
									disabled={!folderName.trim()}
									aria-label="Create folder"
									className="text-amber-600 dark:text-amber-400 p-1 disabled:opacity-40"
								>
									<Check className="w-3.5 h-3.5" />
								</button>
							</div>
						) : (
							<NewTagForm onCreate={(name, color) => void submitTag(name, color)} onCancel={closeCreate} />
						)}
						{createError && (
							<p role="alert" className="mt-2 text-metadata text-red-500 dark:text-red-400">
								{createError}
							</p>
						)}
					</div>
				</div>
			)}

			<div className="mx-auto w-full max-w-5xl flex items-center justify-between px-4 lg:px-8 py-3">
				<span className="text-neutral-500 dark:text-neutral-400 text-xs">
					{notes.length} note{notes.length !== 1 ? "s" : ""}
				</span>
				<button
					onClick={cycleSortOption}
					aria-label="Change sort order"
					className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors text-xs"
				>
					<ArrowDownUp className="w-3.5 h-3.5" />
					{SORT_LABELS[sortBy]}
				</button>
			</div>

			{loadError && !isLoading && (
				<div
					role="alert"
					className="mx-auto w-full max-w-5xl flex items-center gap-3 px-4 lg:px-8 pb-2"
				>
					<p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
					<button
						type="button"
						onClick={onRetry}
						className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 transition-colors"
					>
						Retry
					</button>
				</div>
			)}

			<div className="flex-1 overflow-y-auto custom-scrollbar px-3 lg:px-8 pb-6">
				<div className="mx-auto w-full max-w-5xl">
					{isLoading ? (
						<div role="status" aria-label="Loading your notes" className="flex justify-center py-16">
							<Loader2 className="w-5 h-5 animate-spin text-amber-600 dark:text-amber-400" />
						</div>
					) : notes.length === 0 ? (
						loadError && totalNotes === 0 ? null : (
							<div className="flex flex-col items-center justify-center py-16 text-center">
								<p className="text-neutral-500 text-sm">
									{totalNotes === 0 ? "No notes yet" : "Nothing matches"}
								</p>
								<p className="text-neutral-400 dark:text-neutral-600 text-xs mt-1">
									{totalNotes === 0
										? "Tap + to start your first Bible study note."
										: "Try a different search or clear your filters."}
								</p>
							</div>
						)
					) : (
						// grid-cols-1 is load-bearing: without it the implicit single
						// column sizes to max-content, and one unbreakable tag or
						// preview string pushed every card past the phone viewport.
						<div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-stretch">
							{notes.map((note) => (
								<NoteCard
									key={note.id}
									note={note}
									tags={tags}
									folders={folders}
									isActive={note.id === activeNoteId}
									onClick={() => onSelectNote(note.id)}
									onTogglePin={() => onTogglePin(note.id)}
									onMoveToFolder={(folderId) => onMoveToFolder(note.id, folderId)}
									onDelete={() => onDeleteNote(note.id)}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default NotesListView;
