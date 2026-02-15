"use client";

import React from "react";
import { ArrowDownUp } from "lucide-react";
import NoteCard from "./NoteCard";
import type { Note, Tag } from "@/types/notes";
import type { SortOption } from "@/hooks/useNotes";

interface NotesListViewProps {
	notes: Note[];
	tags: Tag[];
	activeNoteId: string | null;
	sortBy: SortOption;
	onSelectNote: (id: string) => void;
	onSortChange: (sort: SortOption) => void;
}

const SORT_LABELS: Record<SortOption, string> = {
	updatedAt: "Last Modified",
	createdAt: "Created",
	title: "Title",
};

const SORT_ORDER: SortOption[] = ["updatedAt", "createdAt", "title"];

const NotesListView: React.FC<NotesListViewProps> = ({
	notes,
	tags,
	activeNoteId,
	sortBy,
	onSelectNote,
	onSortChange,
}) => {
	const cycleSortOption = () => {
		const idx = SORT_ORDER.indexOf(sortBy);
		onSortChange(SORT_ORDER[(idx + 1) % SORT_ORDER.length]);
	};

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="flex items-center justify-between px-4 py-3">
				<span className="text-neutral-400 text-xs">
					{notes.length} note{notes.length !== 1 ? "s" : ""}
				</span>
				<button
					onClick={cycleSortOption}
					className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-300 transition-colors text-xs"
				>
					<ArrowDownUp className="w-3.5 h-3.5" />
					{SORT_LABELS[sortBy]}
				</button>
			</div>

			<div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3">
				{notes.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<p className="text-neutral-500 text-sm">No notes yet</p>
						<p className="text-neutral-600 text-xs mt-1">
							Create a note to start studying
						</p>
					</div>
				) : (
					<div className="grid gap-2">
						{notes.map((note) => (
							<NoteCard
								key={note.id}
								note={note}
								tags={tags}
								isActive={note.id === activeNoteId}
								onClick={() => onSelectNote(note.id)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
};

export default NotesListView;
