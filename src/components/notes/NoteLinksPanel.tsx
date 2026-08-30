"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	CornerDownRight,
	Link2,
	Plus,
	RefreshCw,
} from "lucide-react";
import { fetchNoteLinks } from "@/hooks/useNotes";
import type { NoteLinks } from "@/types/notes";

interface NoteLinksPanelProps {
	noteId: string;
	/** Changes when the note is saved, so the panel refetches after edits. */
	refreshToken?: string;
	onOpenNote: (id: string) => void;
	onCreateLinkedNote: (title: string) => Promise<void>;
}

const NoteLinksPanel: React.FC<NoteLinksPanelProps> = ({
	noteId,
	refreshToken,
	onOpenNote,
	onCreateLinkedNote,
}) => {
	const [expanded, setExpanded] = useState(true);
	const [links, setLinks] = useState<NoteLinks | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState(false);
	const [creating, setCreating] = useState<string | null>(null);

	const load = useCallback(async () => {
		setIsLoading(true);
		setError(false);
		try {
			setLinks(await fetchNoteLinks(noteId));
		} catch {
			setLinks(null);
			setError(true);
		} finally {
			setIsLoading(false);
		}
	}, [noteId]);

	useEffect(() => {
		void load();
		// refreshToken tracks note.updatedAt: an autosave lands a beat before the
		// server finishes syncing links, so refetching on it keeps the panel live.
	}, [load, refreshToken]);

	const handleCreate = async (title: string) => {
		setCreating(title);
		try {
			await onCreateLinkedNote(title);
		} finally {
			setCreating(null);
		}
	};

	const outgoing = links?.outgoing ?? [];
	const backlinks = links?.backlinks ?? [];
	const total = outgoing.length + backlinks.length;

	return (
		<section>
			<div className="flex items-center px-4 py-2">
				<button
					onClick={() => setExpanded(!expanded)}
					className="flex-1 flex items-center gap-1.5 text-left text-neutral-500 hover:text-neutral-300 transition-colors"
				>
					{expanded ? (
						<ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
					) : (
						<ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
					)}
					<span className="text-xs font-medium">Links</span>
					{links && <span className="text-[10px] text-neutral-600">{total}</span>}
				</button>
				<button
					onClick={() => void load()}
					title="Refresh links"
					disabled={isLoading}
					className="text-neutral-600 hover:text-neutral-300 transition-colors disabled:opacity-40"
				>
					<RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
				</button>
			</div>

			{expanded && (
				<div className="px-4 pb-3 space-y-3">
					{isLoading && !links && (
						<p className="text-[11px] text-neutral-600">Loading links...</p>
					)}

					{error && (
						<div className="flex items-center gap-2">
							<p className="text-[11px] text-red-400/80">Could not load links.</p>
							<button
								onClick={() => void load()}
								className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
							>
								Retry
							</button>
						</div>
					)}

					{links && (
						<>
							<div>
								<h4 className="flex items-center gap-1.5 text-[11px] text-neutral-500 mb-1.5">
									<Link2 className="w-3 h-3" />
									Outgoing
									<span className="text-neutral-600">{outgoing.length}</span>
								</h4>
								{outgoing.length === 0 ? (
									<p className="text-[11px] text-neutral-600">
										No links yet. Use the link button in the toolbar to reference
										another note.
									</p>
								) : (
									<ul className="space-y-0.5">
										{outgoing.map((link) => {
											const targetId = link.noteId;
											return targetId ? (
												<li key={`${link.targetTitle}-${targetId}`}>
													<button
														onClick={() => onOpenNote(targetId)}
														className="w-full text-left px-2 py-1 rounded-lg text-xs text-amber-400/90 hover:text-amber-300 hover:bg-white/[0.03] transition-colors truncate"
													>
														{link.title ?? link.targetTitle}
													</button>
												</li>
											) : (
												<li
													key={`unresolved-${link.targetTitle}`}
													className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/[0.03] transition-colors"
												>
													<span className="flex-1 text-xs text-neutral-600 truncate">
														{link.targetTitle}
													</span>
													<button
														onClick={() => void handleCreate(link.targetTitle)}
														disabled={creating === link.targetTitle}
														className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-amber-400 transition-colors disabled:opacity-50"
													>
														<Plus className="w-3 h-3" />
														{creating === link.targetTitle ? "Creating..." : "Create"}
													</button>
												</li>
											);
										})}
									</ul>
								)}
							</div>

							<div>
								<h4 className="flex items-center gap-1.5 text-[11px] text-neutral-500 mb-1.5">
									<CornerDownRight className="w-3 h-3" />
									Linked mentions
									<span className="text-neutral-600">{backlinks.length}</span>
								</h4>
								{backlinks.length === 0 ? (
									<p className="text-[11px] text-neutral-600">
										No other note links here yet.
									</p>
								) : (
									<ul className="space-y-1">
										{backlinks.map((link) => (
											<li key={link.noteId}>
												<button
													onClick={() => onOpenNote(link.noteId)}
													className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
												>
													<span className="block text-xs text-neutral-300 truncate">
														{link.title || "Untitled Note"}
													</span>
													{link.snippet && (
														<span className="block text-[11px] text-neutral-600 line-clamp-2">
															{link.snippet}
														</span>
													)}
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						</>
					)}
				</div>
			)}
		</section>
	);
};

export default NoteLinksPanel;
