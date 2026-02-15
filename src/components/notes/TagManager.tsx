"use client";

import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Tag } from "@/types/notes";

const PRESET_COLORS = [
	"#f59e0b", // amber
	"#ef4444", // red
	"#22c55e", // green
	"#3b82f6", // blue
	"#a855f7", // purple
	"#ec4899", // pink
	"#06b6d4", // cyan
	"#f97316", // orange
];

interface TagManagerProps {
	tags: Tag[];
	noteTagIds: string[];
	onToggleTag: (tagId: string) => void;
	onCreateTag: (name: string, color: string) => void;
	onDeleteTag: (id: string) => void;
	onClose: () => void;
}

const TagManager: React.FC<TagManagerProps> = ({
	tags,
	noteTagIds,
	onToggleTag,
	onCreateTag,
	onDeleteTag,
	onClose,
}) => {
	const [isCreating, setIsCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);

	const handleCreate = () => {
		const name = newName.trim();
		if (!name) return;
		onCreateTag(name, selectedColor);
		setNewName("");
		setIsCreating(false);
	};

	return (
		<div className="glass-card border border-white/[0.08] rounded-xl shadow-xl p-3 min-w-[200px] animate-message-in">
			<div className="flex items-center justify-between mb-2">
				<span className="text-neutral-300 text-xs font-medium">Tags</span>
				<button
					onClick={onClose}
					className="text-neutral-600 hover:text-neutral-400 transition-colors"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Existing tags */}
			<div className="space-y-0.5 mb-2 max-h-[200px] overflow-y-auto custom-scrollbar">
				{tags.map((tag) => (
					<div
						key={tag.id}
						className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors group"
					>
						<button
							onClick={() => onToggleTag(tag.id)}
							className="flex items-center gap-2 flex-1 text-left"
						>
							<span
								className="w-3 h-3 rounded-full flex-shrink-0 border"
								style={{
									backgroundColor: noteTagIds.includes(tag.id) ? tag.color : "transparent",
									borderColor: tag.color,
								}}
							/>
							<span className="text-neutral-300 text-xs">{tag.name}</span>
						</button>
						<button
							onClick={() => onDeleteTag(tag.id)}
							className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-opacity"
						>
							<X className="w-3 h-3" />
						</button>
					</div>
				))}
			</div>

			{/* Create new tag */}
			{isCreating ? (
				<div className="border-t border-white/[0.06] pt-2 space-y-2">
					<input
						autoFocus
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleCreate();
							if (e.key === "Escape") setIsCreating(false);
						}}
						placeholder="Tag name"
						className="w-full bg-transparent text-neutral-200 text-xs outline-none border-b border-white/[0.1] pb-1 placeholder:text-neutral-600"
					/>
					<div className="flex items-center gap-1.5">
						{PRESET_COLORS.map((color) => (
							<button
								key={color}
								onClick={() => setSelectedColor(color)}
								className={`w-5 h-5 rounded-full transition-transform ${
									selectedColor === color ? "scale-125 ring-2 ring-offset-1 ring-offset-transparent ring-white/20" : ""
								}`}
								style={{ backgroundColor: color }}
							/>
						))}
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={handleCreate}
							className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
						>
							Create
						</button>
						<button
							onClick={() => setIsCreating(false)}
							className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<button
					onClick={() => setIsCreating(true)}
					className="w-full flex items-center gap-1.5 text-neutral-600 hover:text-neutral-400 transition-colors text-xs pt-1 border-t border-white/[0.06]"
				>
					<Plus className="w-3 h-3" />
					New Tag
				</button>
			)}
		</div>
	);
};

export default TagManager;
