"use client";

import React, { useEffect, useRef, useState } from "react";
import { Brain, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import {
	addMemory,
	clearMemories,
	deleteMemory,
	fetchMemories,
	generateMemorySummary,
	groupMemoriesByCategory,
	type MemoryRecord,
	type MemorySummary,
} from "@/lib/memories";

interface MemoryManagerProps {
	open: boolean;
	onClose: () => void;
	onMemoryCountChange?: (count: number) => void;
}

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

/** How long a two-tap confirm stays armed before resetting. */
const CONFIRM_TIMEOUT_MS = 3000;

/**
 * Settings → MEMORY manage dialog: AI summary of what SureWord remembers,
 * manual add, and grouped saved-memories list with delete / clear-all.
 * Rendered only while `open` is true.
 */
const MemoryManager: React.FC<MemoryManagerProps> = ({ open, onClose, onMemoryCountChange }) => {
	const [memories, setMemories] = useState<MemoryRecord[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [summary, setSummary] = useState<MemorySummary | null | undefined>(undefined);
	const [summaryGeneratedAt, setSummaryGeneratedAt] = useState<string | null>(null);
	const [summaryLoading, setSummaryLoading] = useState(false);
	const [summaryError, setSummaryError] = useState<string | null>(null);

	const [draft, setDraft] = useState("");
	const [adding, setAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);

	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [confirmClearAll, setConfirmClearAll] = useState(false);
	const [clearingAll, setClearingAll] = useState(false);
	const [listError, setListError] = useState<string | null>(null);

	const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Load the memories list when the dialog opens.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoadError(null);
		(async () => {
			try {
				const data = await fetchMemories();
				if (!cancelled) {
					setMemories(data.memories);
					onMemoryCountChange?.(data.memories.length);
					setLoadError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setLoadError(err instanceof Error ? err.message : "Couldn't load memories.");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open, onMemoryCountChange]);

	// Close on Escape.
	useEffect(() => {
		if (!open) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [open, onClose]);

	// Lock body scroll while open.
	useEffect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [open]);

	// Clear any pending confirm timer on unmount.
	useEffect(() => {
		return () => {
			if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
		};
	}, []);

	if (!open) return null;

	const armConfirm = (apply: () => void) => {
		if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
		apply();
		confirmTimerRef.current = setTimeout(() => {
			setConfirmDeleteId(null);
			setConfirmClearAll(false);
		}, CONFIRM_TIMEOUT_MS);
	};

	const refresh = async () => {
		setLoadError(null);
		try {
			const data = await fetchMemories();
			setMemories(data.memories);
			onMemoryCountChange?.(data.memories.length);
		} catch (err) {
			setLoadError(err instanceof Error ? err.message : "Couldn't load memories.");
		}
	};

	const handleGenerateSummary = async () => {
		if (summaryLoading) return;
		setSummaryLoading(true);
		setSummaryError(null);
		try {
			const data = await generateMemorySummary();
			setSummary(data.summary);
			setSummaryGeneratedAt(data.summary ? data.generatedAt : null);
		} catch (err) {
			setSummaryError(err instanceof Error ? err.message : "Couldn't generate the summary.");
		} finally {
			setSummaryLoading(false);
		}
	};

	const handleAdd = async () => {
		const content = draft.trim();
		if (!content || adding) return;
		setAdding(true);
		setAddError(null);
		try {
			const memory = await addMemory(content);
			const nextMemories = [memory, ...(memories ?? [])];
			setDraft("");
			setMemories(nextMemories);
			onMemoryCountChange?.(nextMemories.length);
			setSummary(undefined);
			setSummaryGeneratedAt(null);
		} catch (err) {
			setAddError(err instanceof Error ? err.message : "Couldn't save that memory.");
		} finally {
			setAdding(false);
		}
	};

	const handleDelete = async (id: string) => {
		if (confirmDeleteId !== id) {
			armConfirm(() => setConfirmDeleteId(id));
			return;
		}
		if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
		setConfirmDeleteId(null);
		setPendingDeleteId(id);
		setListError(null);
		try {
			await deleteMemory(id);
			const nextMemories = (memories ?? []).filter((memory) => memory.id !== id);
			setMemories(nextMemories);
			onMemoryCountChange?.(nextMemories.length);
			setSummary(undefined);
			setSummaryGeneratedAt(null);
		} catch (err) {
			setListError(err instanceof Error ? err.message : "Couldn't delete that memory.");
		} finally {
			setPendingDeleteId(null);
		}
	};

	const handleClearAll = async () => {
		if (!confirmClearAll) {
			armConfirm(() => setConfirmClearAll(true));
			return;
		}
		if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
		setConfirmClearAll(false);
		setClearingAll(true);
		setListError(null);
		try {
			await clearMemories();
			setMemories([]);
			onMemoryCountChange?.(0);
			setSummary(undefined);
			setSummaryGeneratedAt(null);
			setSummaryError(null);
		} catch (err) {
			setListError(err instanceof Error ? err.message : "Couldn't clear memories.");
		} finally {
			setClearingAll(false);
		}
	};

	const groups = memories ? groupMemoriesByCategory(memories) : [];
	const hasMemories = (memories?.length ?? 0) > 0;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/80 backdrop-blur-sm"
				onClick={onClose}
			/>

			<div
				className="relative w-full max-w-md max-h-[85vh] flex flex-col glass-card border border-black/[0.1] dark:border-white/[0.1] rounded-xl shadow-xl shadow-black/15 dark:shadow-black/60 p-4"
				role="dialog"
				aria-modal="true"
				aria-labelledby="memory-manager-title"
			>
				{/* Header */}
				<div className="flex items-center justify-between mb-3">
					<div
						id="memory-manager-title"
						className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm font-semibold"
					>
						<Brain className="w-4 h-4" />
						Memory
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

				<div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1">
					{/* Summary block — manual trigger, each generation is an LLM call. */}
					<div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] p-3.5">
						{summary === undefined && !summaryLoading && (
							<div className="flex flex-col gap-2.5">
								<p className="text-xs leading-[17px] text-neutral-400 dark:text-neutral-500">
									See an AI-written summary of everything SureWord remembers about you.
								</p>
								<button
									type="button"
									onClick={() => void handleGenerateSummary()}
									className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[13px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
								>
									<Sparkles className="w-4 h-4" />
									Generate summary
								</button>
							</div>
						)}
						{summaryLoading && (
							<button
								type="button"
								disabled
								className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[13px] font-bold text-amber-600 dark:text-amber-400 opacity-70"
							>
								<Loader2 className="w-4 h-4 animate-spin" />
								Writing your summary…
							</button>
						)}
						{summary === null && !summaryLoading && (
							<p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
								Nothing remembered yet — SureWord learns about you as you chat.
							</p>
						)}
						{summary && !summaryLoading && (
							<div className="flex flex-col gap-3">
								<p className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
									{summary.overview}
								</p>
								{summary.sections.map((section, i) => (
									<div key={i}>
										<p className="text-[13px] font-bold text-amber-600 dark:text-amber-400">
											{section.title}
										</p>
										<p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
											{section.content}
										</p>
									</div>
								))}
								<div className="flex items-center justify-between gap-2 pt-1">
									<span className="text-[11px] text-neutral-400 dark:text-neutral-600">
										Updated {summaryGeneratedAt ? relativeTime(summaryGeneratedAt) : "just now"}
									</span>
									<button
										type="button"
										onClick={() => void handleGenerateSummary()}
										className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
									>
										<RefreshCw className="w-3.5 h-3.5" />
										Regenerate
									</button>
								</div>
							</div>
						)}
						{summaryError && (
							<p className="mt-2 text-xs text-red-600 dark:text-red-400">{summaryError}</p>
						)}
					</div>

					{/* Add row */}
					<div className="mt-3 flex items-center gap-2">
						<input
							type="text"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							maxLength={500}
							onKeyDown={(e) => {
								if (e.key === "Enter") void handleAdd();
							}}
							placeholder="Add a memory…"
							className="min-w-0 flex-1 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3.5 py-2.5 text-sm text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-400/40 transition-colors"
						/>
						<button
							type="button"
							onClick={() => void handleAdd()}
							disabled={!draft.trim() || adding}
							className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-3 text-[13px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors disabled:opacity-50"
							aria-label="Add memory"
						>
							{adding ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<Plus className="w-4 h-4" />
							)}
							Add
						</button>
					</div>
					{addError && (
						<p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{addError}</p>
					)}

					{/* Saved memories */}
					<div className="mt-4">
						<p className="text-[11px] font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500">
							SAVED MEMORIES{memories ? ` (${memories.length})` : ""}
						</p>
						{memories === null && !loadError && (
							<div className="flex items-center justify-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400">
								<Loader2 className="w-4 h-4 animate-spin" />
								Loading your memories…
							</div>
						)}
						{loadError && (
							<div className="flex flex-col items-center gap-2 py-6 text-center">
								<p className="text-sm text-red-500 dark:text-red-400">{loadError}</p>
								<button
									type="button"
									onClick={() => void refresh()}
									className="text-xs font-bold text-amber-600 dark:text-amber-400"
								>
									Retry
								</button>
							</div>
						)}
						{memories !== null && !hasMemories && !loadError && (
							<p className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
								No memories saved yet.
							</p>
						)}
						{groups.map((group) => (
							<div key={group.category} className="mt-3">
								<p className="text-[11px] font-bold tracking-[0.15em] text-amber-600/80 dark:text-amber-400/70 px-1">
									{group.label.toUpperCase()}
								</p>
								<div className="mt-1 flex flex-col">
									{group.memories.map((memory) => (
										<div
											key={memory.id}
											className="flex items-start gap-2 rounded-xl px-3 py-2.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
										>
											<p className="min-w-0 flex-1 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
												{memory.content}
											</p>
											<button
												type="button"
												onClick={() => void handleDelete(memory.id)}
												disabled={pendingDeleteId === memory.id}
												className={`flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1 rounded-lg px-2 transition-colors ${
													confirmDeleteId === memory.id
														? "text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 dark:bg-red-400/10"
														: "text-neutral-400 dark:text-neutral-600 hover:text-red-600 dark:hover:text-red-400"
												}`}
												aria-label={`Delete memory: ${memory.content.slice(0, 40)}`}
											>
												{pendingDeleteId === memory.id ? (
													<Loader2 className="w-4 h-4 animate-spin" />
												) : confirmDeleteId === memory.id ? (
													"Confirm?"
												) : (
													<Trash2 className="w-4 h-4" />
												)}
											</button>
										</div>
									))}
								</div>
							</div>
						))}
						{listError && (
							<p className="mt-2 text-xs text-red-600 dark:text-red-400">{listError}</p>
						)}
					</div>
				</div>

				{/* Footer */}
				{hasMemories && (
					<button
						type="button"
						onClick={() => void handleClearAll()}
						disabled={clearingAll}
						className="mt-3 flex min-h-[44px] flex-shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/25 dark:border-red-400/20 bg-red-500/10 dark:bg-red-400/10 text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-400/20 transition-colors disabled:opacity-60"
					>
						{clearingAll ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Trash2 className="w-4 h-4" />
						)}
						{confirmClearAll ? "Confirm? This deletes every memory" : "Clear all memories"}
					</button>
				)}
			</div>
		</div>
	);
};

export default MemoryManager;
