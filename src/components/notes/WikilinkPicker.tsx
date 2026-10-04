"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, Plus, Search } from "lucide-react";
import type { Note } from "@/types/notes";
import { relativeTime } from "./noteTime";
import {
	filterNotesForLinking,
	hasExactTarget,
	sanitizeWikilinkTarget,
	sortByRecentlyUpdated,
} from "./wikilinks";

const MAX_RESULTS = 8;

interface WikilinkPickerProps {
	notes: Note[];
	currentNoteId?: string;
	onSelect: (title: string) => void;
}

/**
 * Toolbar button that inserts a `[[Note Title]]` reference. The popover is
 * fixed-positioned because the toolbar scrolls horizontally and would clip it.
 */
const WikilinkPicker: React.FC<WikilinkPickerProps> = ({
	notes,
	currentNoteId,
	onSelect,
}) => {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
	}, []);

	useEffect(() => {
		if (!open) return;
		const handleClick = (e: MouseEvent) => {
			const target = e.target as Node;
			if (panelRef.current?.contains(target)) return;
			if (buttonRef.current?.contains(target)) return;
			close();
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [open, close]);

	// Same rules as Android's InsertWikilinkSheet: title or alias match,
	// newest first, and never the note being edited.
	const excludeId = currentNoteId ?? "";
	const candidates = useMemo(
		() =>
			sortByRecentlyUpdated(filterNotesForLinking(notes, query, excludeId)).slice(
				0,
				MAX_RESULTS
			),
		[notes, excludeId, query]
	);

	// The "Link to:" row only offers a target that does not exist yet.
	const newTarget = sanitizeWikilinkTarget(query);
	const showCreateRow = newTarget.length > 0 && !hasExactTarget(notes, query, excludeId);
	const hasOtherNotes = notes.some((n) => n.id !== excludeId);

	const choose = (title: string) => {
		onSelect(title);
		close();
	};

	const toggle = () => {
		if (open) {
			close();
			return;
		}
		const rect = buttonRef.current?.getBoundingClientRect();
		if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
		setOpen(true);
	};

	return (
		<>
			<button
				ref={buttonRef}
				onClick={toggle}
				title="Insert note link"
				className={`
					min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md transition-colors flex-shrink-0
					${open
						? "text-amber-400 bg-white/[0.06]"
						: "text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03]"
					}
				`}
			>
				<Braces className="w-4 h-4" />
			</button>

			{open && anchor && (
				<div
					ref={panelRef}
					style={{
						top: anchor.top,
						left: Math.max(8, Math.min(anchor.left, window.innerWidth - 288)),
					}}
					className="fixed z-50 w-[280px] glass-card border border-white/[0.08] rounded-xl shadow-xl p-2 animate-message-in"
				>
					<div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
						<Search className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
						<input
							autoFocus
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key !== "Enter") return;
								e.preventDefault();
								if (candidates.length > 0) choose(candidates[0].title || "Untitled Note");
								else if (showCreateRow) choose(newTarget);
							}}
							placeholder="Link to a note..."
							className="flex-1 min-w-0 bg-transparent text-neutral-200 text-xs outline-none placeholder:text-neutral-600"
						/>
					</div>

					<div className="mt-1.5 max-h-[220px] overflow-y-auto custom-scrollbar">
						{candidates.map((n) => (
							<button
								key={n.id}
								onClick={() => choose(n.title || "Untitled Note")}
								className="w-full flex items-baseline gap-2 text-left px-2 py-1.5 rounded-lg text-xs text-neutral-300 hover:text-neutral-100 hover:bg-white/[0.04] transition-colors"
							>
								<span className="flex-1 min-w-0 truncate">{n.title || "Untitled Note"}</span>
								<span className="flex-shrink-0 text-metadata text-neutral-600">
									{relativeTime(n.updatedAt)}
								</span>
							</button>
						))}

						{candidates.length === 0 && (
							<p className="px-2 py-2 text-metadata text-neutral-600">
								{hasOtherNotes
									? "No notes match that search."
									: "No other notes yet. Type a title above to link ahead of time."}
							</p>
						)}

						{showCreateRow && (
							<button
								onClick={() => choose(newTarget)}
								className="w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded-lg text-xs text-amber-400 hover:text-amber-300 hover:bg-white/[0.04] transition-colors"
							>
								<Plus className="w-3 h-3 flex-shrink-0" />
								<span className="truncate">Link to: {newTarget}</span>
							</button>
						)}
					</div>
				</div>
			)}
		</>
	);
};

export default WikilinkPicker;
