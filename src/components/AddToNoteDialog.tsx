"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, NotebookPen, Plus, Search, X } from "lucide-react";

interface AddToNoteDialogProps {
	/** Cleaned assistant markdown to save (view-model content, follow-ups stripped). */
	markdown: string;
	/** Active conversation title, used as the title when creating a new note. */
	conversationTitle?: string;
	onClose: () => void;
}

interface NoteSummaryItem {
	id: string;
	title: string;
	preview: string;
	updatedAt: string;
}

interface AppendSuccess {
	key: string;
	created: boolean;
	noteTitle: string;
}

const NEW_NOTE_KEY = "new";

function relativeTime(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (Number.isNaN(seconds) || seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

const AddToNoteDialog: React.FC<AddToNoteDialogProps> = ({
	markdown,
	conversationTitle,
	onClose,
}) => {
	const [notes, setNotes] = useState<NoteSummaryItem[] | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	const [success, setSuccess] = useState<AppendSuccess | null>(null);
	const [errorKey, setErrorKey] = useState<string | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	// Load note summaries for the picker when the dialog opens.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch("/api/notes?summary=1");
				if (!res.ok) throw new Error("Notes request failed");
				const data = (await res.json()) as Array<{
					id: string;
					title: string;
					plainText?: string | null;
					updatedAt: string;
				}>;
				if (cancelled) return;
				if (!Array.isArray(data)) throw new Error("Notes response was invalid");
				setNotes(
					data.map((note) => ({
						id: note.id,
						title: note.title,
						preview: (note.plainText ?? "").slice(0, 120),
						updatedAt: note.updatedAt,
					}))
				);
			} catch {
				if (!cancelled) setLoadError(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// 300ms debounce on the search filter.
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedQuery(query), 300);
		return () => clearTimeout(timer);
	}, [query]);

	const filteredNotes = useMemo(() => {
		if (!notes) return [];
		const q = debouncedQuery.trim().toLowerCase();
		if (!q) return notes;
		return notes.filter(
			(note) =>
				note.title.toLowerCase().includes(q) ||
				note.preview.toLowerCase().includes(q)
		);
	}, [notes, debouncedQuery]);

	const handlePick = async (key: string, noteId?: string) => {
		if (pendingKey) return;
		setPendingKey(key);
		setErrorKey(null);
		try {
			const res = await fetch("/api/notes/append", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					markdown,
					...(noteId
						? { noteId }
						: conversationTitle
							? { title: conversationTitle }
							: {}),
				}),
			});
			const data = (await res.json().catch(() => null)) as {
				noteTitle?: string;
				created?: boolean;
			} | null;
			if (!res.ok) throw new Error("Append request failed");
			setSuccess({
				key,
				created: data?.created === true,
				noteTitle:
					typeof data?.noteTitle === "string" ? data.noteTitle : "note",
			});
		} catch {
			setErrorKey(key);
		} finally {
			setPendingKey(null);
		}
	};

	const successBlock = success && (
		<div className="flex items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-2.5">
			<div className="flex items-center gap-2 min-w-0">
				<Check className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
				<span className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
					{success.created ? "Created" : "Added to"}{" "}
					<span className="font-medium text-amber-700 dark:text-amber-400">
						{success.noteTitle}
					</span>{" "}
					✓
				</span>
			</div>
			<Link
				href="/notes"
				onClick={onClose}
				className="flex-shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
			>
				View in notes →
			</Link>
		</div>
	);

	const errorBlock = (key: string, noteId?: string) => (
		<div className="flex items-center justify-between gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3.5 py-2.5">
			<span className="text-sm text-red-600 dark:text-red-400">
				Couldn&apos;t save. Try again.
			</span>
			<button
				type="button"
				onClick={() => void handlePick(key, noteId)}
				className="flex-shrink-0 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
			>
				Retry
			</button>
		</div>
	);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/80 backdrop-blur-sm"
				onClick={onClose}
			/>

			<div className="relative w-full max-w-md max-h-[80vh] flex flex-col glass-card border border-black/[0.1] dark:border-white/[0.1] rounded-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-4">
				{/* Header */}
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm font-semibold">
						<NotebookPen className="w-4 h-4" />
						Add to notes
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-neutral-400 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
						aria-label="Close"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* New note */}
				{success && success.key === NEW_NOTE_KEY ? (
					successBlock
				) : errorKey === NEW_NOTE_KEY ? (
					errorBlock(NEW_NOTE_KEY)
				) : (
					<button
						type="button"
						onClick={() => void handlePick(NEW_NOTE_KEY)}
						disabled={pendingKey !== null}
						className="w-full flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-3.5 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-400/[0.14] transition-colors disabled:opacity-60"
					>
						{pendingKey === NEW_NOTE_KEY ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Plus className="w-4 h-4" />
						)}
						New note
					</button>
				)}

				{/* Search */}
				<div className="relative mt-3">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600" />
					<input
						ref={searchRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search your notes..."
						className="w-full rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] pl-9 pr-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-400/40 transition-colors"
					/>
				</div>

				{/* Note list */}
				<div className="mt-3 flex-1 min-h-24 overflow-y-auto custom-scrollbar space-y-1">
					{notes === null && !loadError && (
						<div className="flex items-center justify-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400">
							<Loader2 className="w-4 h-4 animate-spin" />
							Loading your notes...
						</div>
					)}
					{loadError && (
						<p className="py-6 text-center text-sm text-red-500 dark:text-red-400">
							Couldn&apos;t load your notes.
						</p>
					)}
					{notes !== null && filteredNotes.length === 0 && (
						<p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
							{notes.length === 0
								? "No notes yet — start a new one above."
								: "No notes match your search."}
						</p>
					)}
					{filteredNotes.map((note) =>
						success && success.key === note.id ? (
							<div key={note.id}>{successBlock}</div>
						) : errorKey === note.id ? (
							<div key={note.id}>{errorBlock(note.id, note.id)}</div>
						) : (
							<button
								key={note.id}
								type="button"
								onClick={() => void handlePick(note.id, note.id)}
								disabled={pendingKey !== null}
								className="w-full flex items-center gap-2.5 rounded-xl border border-transparent px-3.5 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] hover:border-black/[0.08] dark:hover:border-white/[0.08] transition-colors disabled:opacity-60"
							>
								{pendingKey === note.id ? (
									<Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
								) : (
									<NotebookPen className="w-4 h-4 flex-shrink-0 text-neutral-400 dark:text-neutral-600" />
								)}
								<span className="min-w-0 flex-1">
									<span className="block text-sm text-neutral-800 dark:text-neutral-200 truncate">
										{note.title}
									</span>
									{note.preview && (
										<span className="block text-xs text-neutral-500 dark:text-neutral-500 truncate">
											{note.preview}
										</span>
									)}
								</span>
								<span className="flex-shrink-0 text-metadata text-neutral-400 dark:text-neutral-600">
									{relativeTime(note.updatedAt)}
								</span>
							</button>
						)
					)}
				</div>
			</div>
		</div>
	);
};

export default AddToNoteDialog;
