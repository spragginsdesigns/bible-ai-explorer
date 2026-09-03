"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, PanelBottom } from "lucide-react";
import NotePropertiesSection from "./NoteProperties";
import NoteLinksPanel from "./NoteLinksPanel";
import type { Note } from "@/types/notes";

interface NoteInfoPanelProps {
	note: Note;
	onUpdate: (changes: Partial<Note>) => void;
	onOpenNote: (id: string) => void;
	onCreateLinkedNote: (title: string) => Promise<void>;
}

/**
 * Obsidian-style drawer under the editor holding note properties and the
 * outgoing/backlink graph. Collapsed by default so the writing surface is
 * unchanged until asked for.
 */
const NoteInfoPanel: React.FC<NoteInfoPanelProps> = ({
	note,
	onUpdate,
	onOpenNote,
	onCreateLinkedNote,
}) => {
	const [open, setOpen] = useState(false);

	return (
		<div className="flex-shrink-0 border-t border-white/[0.06] glass-light">
			{/* Same centred column as the editor body, toolbar and header. */}
			<button
				onClick={() => setOpen(!open)}
				className="mx-auto w-full max-w-3xl flex items-center gap-2 px-3 md:px-4 py-2 text-neutral-500 hover:text-neutral-300 transition-colors"
			>
				<PanelBottom className="w-3.5 h-3.5 flex-shrink-0" />
				<span className="text-xs font-medium flex-1 text-left">
					Properties &amp; links
				</span>
				{open ? (
					<ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
				) : (
					<ChevronUp className="w-3.5 h-3.5 flex-shrink-0" />
				)}
			</button>

			{open && (
				<div className="mx-auto w-full max-w-3xl max-h-[45vh] overflow-y-auto custom-scrollbar border-t border-white/[0.06]">
					<NotePropertiesSection note={note} onUpdate={onUpdate} />
					<NoteLinksPanel
						noteId={note.id}
						refreshToken={note.updatedAt}
						onOpenNote={onOpenNote}
						onCreateLinkedNote={onCreateLinkedNote}
					/>
				</div>
			)}
		</div>
	);
};

export default NoteInfoPanel;
