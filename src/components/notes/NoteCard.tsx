"use client";

import React from "react";
import { Pin } from "lucide-react";
import type { Note, Tag } from "@/types/notes";

interface NoteCardProps {
	note: Note;
	tags: Tag[];
	isActive: boolean;
	onClick: () => void;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, tags, isActive, onClick }) => {
	const noteTags = tags.filter((t) => note.tagIds.includes(t.id));
	const snippet = note.plainText.slice(0, 120) || "Empty note";
	const dateStr = new Date(note.updatedAt).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});

	return (
		<button
			onClick={onClick}
			className={`
				w-full text-left p-4 rounded-xl border transition-all duration-150 animate-message-in
				${isActive
					? "glass-card border-amber-400/20 glow-amber-sm"
					: "glass-card border-white/[0.06] hover:bg-white/[0.03] hover:border-white/[0.1]"
				}
			`}
		>
			<div className="flex items-start justify-between gap-2 mb-1">
				<h3 className="text-neutral-200 font-medium text-sm truncate flex-1">
					{note.title || "Untitled Note"}
				</h3>
				{note.isPinned && (
					<Pin className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
				)}
			</div>
			<p className="text-neutral-500 text-xs line-clamp-2 mb-2">{snippet}</p>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 overflow-hidden">
					{noteTags.slice(0, 3).map((tag) => (
						<span
							key={tag.id}
							className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
							style={{
								backgroundColor: `${tag.color}20`,
								color: tag.color,
							}}
						>
							{tag.name}
						</span>
					))}
					{noteTags.length > 3 && (
						<span className="text-neutral-600 text-[10px]">
							+{noteTags.length - 3}
						</span>
					)}
				</div>
				<span className="text-neutral-600 text-[10px] flex-shrink-0">{dateStr}</span>
			</div>
		</button>
	);
};

export default NoteCard;
