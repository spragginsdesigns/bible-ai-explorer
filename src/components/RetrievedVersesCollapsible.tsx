"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BookOpen, ChevronRight, Copy, Share2, NotebookPen, ExternalLink, X } from "lucide-react";
import type { RetrievedVerse } from "./useChat";
import {
	chapterHrefForReference,
	copyVerse,
	resolveReference,
	saveVerseToNote,
	shareVerse,
} from "@/lib/chat/verseActions";
import {
	groupRetrievedVerses,
	passagePlainText,
	passagesSummary,
	type GroupedVerses,
	type VersePassage,
} from "@/lib/chat/versePassages";
import { parseVerseReferences, stripTranslationTag } from "@/utils/verseParser";
import { useModalFocus } from "./useModalFocus";

interface RetrievedVersesCollapsibleProps {
	verses: RetrievedVerse[];
	/** Mean cosine score of the scored search hits; absent when there are none. */
	averageSimilarity?: number;
	/** The answer text, so passages can follow the order it cites them. */
	content: string;
}

/** Chips shown inline before the rest collapse into "+N more". */
const INLINE_CHIP_LIMIT = 4;

const resolve = (reference: string) => resolveReference(stripTranslationTag(reference));

/**
 * Search confidence, ported from the Android app. Only search hits carry a
 * real score: a getPassage lookup is exact, so it gets no badge or percentage.
 */
function matchStrength(similarity: number): { label: string; className: string } {
	if (similarity > 0.75) {
		return {
			label: "Strong match",
			className:
				"text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25",
		};
	}
	if (similarity > 0.6) {
		return {
			label: "Moderate match",
			className:
				"text-amber-700/70 dark:text-amber-400/70 bg-amber-500/5 border-amber-500/15",
		};
	}
	return {
		label: "Broad match",
		className:
			"text-neutral-500 dark:text-neutral-400 bg-black/[0.04] dark:bg-white/[0.04] border-black/10 dark:border-white/10",
	};
}

type ActionStatus = "idle" | "busy" | "done" | "error";

function ActionChip({
	label,
	icon: Icon,
	onClick,
	href,
	accent = false,
	disabled = false,
}: {
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	onClick?: () => void;
	href?: string;
	accent?: boolean;
	disabled?: boolean;
}) {
	const className = `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-metadata font-semibold transition-colors ${
		accent
			? "border-amber-500/25 bg-amber-500/[0.07] text-amber-700 dark:text-amber-400 hover:bg-amber-500/[0.12]"
			: "border-black/[0.1] bg-black/[0.02] text-neutral-600 hover:bg-black/[0.05] dark:border-white/[0.1] dark:bg-white/[0.02] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
	} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`;
	const content = (
		<>
			<Icon className="h-3 w-3" />
			{label}
		</>
	);
	if (href && !disabled) {
		return (
			<Link href={href} className={className} onClick={onClick}>
				{content}
			</Link>
		);
	}
	return (
		<button type="button" onClick={onClick} disabled={disabled} className={className}>
			{content}
		</button>
	);
}

function translationOf(passage: VersePassage): "KJV" | "NKJV" | "BSB" | undefined {
	const t = passage.translation;
	return t === "KJV" || t === "NKJV" || t === "BSB" ? t : undefined;
}

function PassageActions({ passage, onNavigate }: { passage: VersePassage; onNavigate: () => void }) {
	const [copyStatus, setCopyStatus] = useState<ActionStatus>("idle");
	const [saveStatus, setSaveStatus] = useState<ActionStatus>("idle");
	const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
	const source = useMemo(
		() => ({ reference: passage.reference, text: passagePlainText(passage), translation: translationOf(passage) }),
		[passage]
	);

	const flash = useCallback((set: (s: ActionStatus) => void, next: ActionStatus) => {
		set(next);
		if (next === "done" || next === "error") {
			setTimeout(() => set("idle"), 2000);
		}
	}, []);

	const onCopy = useCallback(async () => {
		try {
			await copyVerse(source);
			flash(setCopyStatus, "done");
		} catch {
			flash(setCopyStatus, "error");
		}
	}, [source, flash]);

	const onShare = useCallback(() => {
		shareVerse(source).catch(() => {});
	}, [source]);

	const onSave = useCallback(async () => {
		if (saveStatus === "busy") return;
		setSaveStatus("busy");
		try {
			const noteId = await saveVerseToNote(source);
			setSavedNoteId(noteId);
			flash(setSaveStatus, "done");
		} catch {
			flash(setSaveStatus, "error");
		}
	}, [source, saveStatus, flash]);

	// Unresolvable references (unexpected formats) get no Read chip rather than
	// linking to a broken route.
	const readHref = chapterHrefForReference(passage.firstReference, passage.translation);

	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			<ActionChip label={copyStatus === "done" ? "Copied ✓" : "Copy"} icon={Copy} onClick={onCopy} />
			<ActionChip label="Share" icon={Share2} onClick={onShare} />
			<ActionChip
				label={
					saveStatus === "busy"
						? "Saving…"
						: saveStatus === "done"
							? "Saved ✓"
							: saveStatus === "error"
								? "Failed"
								: "Save to note"
				}
				icon={NotebookPen}
				accent
				disabled={saveStatus === "busy"}
				onClick={onSave}
			/>
			{readHref && <ActionChip label="Read in context" icon={BookOpen} href={readHref} onClick={onNavigate} />}
			{savedNoteId && (
				<Link
					href={`/notes?note=${encodeURIComponent(savedNoteId)}`}
					onClick={onNavigate}
					className="inline-flex items-center gap-1 text-xs text-amber-700 transition-colors hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
				>
					<ExternalLink className="h-3 w-3" />
					View in notes
				</Link>
			)}
		</div>
	);
}

function PassageBlock({
	passage,
	focused,
	onNavigate,
}: {
	passage: VersePassage;
	focused: boolean;
	onNavigate: () => void;
}) {
	const multi = passage.verses.length > 1;
	return (
		<div
			id={`passage-${passage.key}`}
			className={`rounded-xl border p-3 ${
				focused
					? "border-amber-500/30 bg-amber-500/[0.06]"
					: "border-black/[0.08] dark:border-white/[0.08]"
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<p className="text-control font-semibold text-amber-700 dark:text-amber-400">{passage.reference}</p>
				<span className="text-metadata tabular-nums text-neutral-400 dark:text-neutral-500">
					{passage.similarity !== null ? `${Math.round(passage.similarity * 100)}%` : (passage.translation ?? "")}
				</span>
			</div>
			<p className="mt-1 text-chat text-neutral-700 dark:text-neutral-300 font-[family-name:var(--font-cormorant)]">
				{passage.verses.map((entry, index) => (
					<React.Fragment key={`${entry.verse}-${index}`}>
						{multi && (
							<sup className="mr-0.5 text-[0.65em] font-sans font-bold text-amber-700/70 dark:text-amber-400/70">
								{entry.verse}
							</sup>
						)}
						{entry.text ?? ""}
						{index < passage.verses.length - 1 ? " " : ""}
					</React.Fragment>
				))}
			</p>
			<PassageActions passage={passage} onNavigate={onNavigate} />
		</div>
	);
}

function VersesDialog({
	grouped,
	averageSimilarity,
	focusKey,
	onClose,
}: {
	grouped: GroupedVerses;
	averageSimilarity?: number;
	focusKey: string;
	onClose: () => void;
}) {
	const titleId = useId();
	// Mounted only while open, so the modal lifecycle runs for the whole mount.
	const panelRef = useModalFocus<HTMLDivElement>({ open: true, onClose });

	useEffect(() => {
		if (!focusKey) return;
		document.getElementById(`passage-${focusKey}`)?.scrollIntoView({ block: "start" });
	}, [focusKey]);

	const badge = averageSimilarity !== undefined && grouped.searchHits.length > 0 ? matchStrength(averageSimilarity) : null;

	// Portaled: the message row animates with a transform, which would turn
	// this fixed overlay into one positioned inside the bubble.
	return createPortal(
		<div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
			<div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-t-2xl sm:rounded-2xl glass-card border border-black/[0.1] dark:border-white/[0.1] shadow-xl shadow-black/15 dark:shadow-black/60 outline-none"
			>
				<div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
					<div id={titleId} className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
						<BookOpen className="h-4 w-4" />
						Scripture in this answer
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-neutral-400 transition-colors hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4">
					{grouped.passages.map((passage) => (
						<PassageBlock key={passage.key} passage={passage} focused={passage.key === focusKey} onNavigate={onClose} />
					))}
					{grouped.searchHits.length > 0 && (
						<div className="flex items-center gap-2 pt-1">
							<span className="text-metadata font-bold uppercase tracking-wide text-neutral-500">Found by search</span>
							{badge && (
								<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-metadata ${badge.className}`}>
									{badge.label}
								</span>
							)}
						</div>
					)}
					{grouped.searchHits.map((passage) => (
						<PassageBlock key={passage.key} passage={passage} focused={passage.key === focusKey} onNavigate={onClose} />
					))}
				</div>
			</div>
		</div>,
		document.body
	);
}

/**
 * The answer's Scripture, summarised inline as one chip per passage; the full
 * text and per-passage actions open in a dialog, so a long answer no longer
 * grows by a screen per verse (see src/lib/chat/versePassages.ts).
 */
const RetrievedVersesCollapsible: React.FC<RetrievedVersesCollapsibleProps> = ({
	verses,
	averageSimilarity,
	content,
}) => {
	const [focusKey, setFocusKey] = useState<string | null>(null);
	const grouped = useMemo(
		() =>
			groupRetrievedVerses(verses, {
				resolve,
				citedReferences: parseVerseReferences(content)
					.filter((segment) => segment.type === "verse-ref")
					.map((segment) => segment.value),
			}),
		[verses, content]
	);
	const all = [...grouped.passages, ...grouped.searchHits];
	const shown = all.slice(0, INLINE_CHIP_LIMIT);
	const hidden = all.length - shown.length;
	const close = useCallback(() => setFocusKey(null), []);

	return (
		<div className="mt-3">
			<button
				type="button"
				aria-haspopup="dialog"
				onClick={() => setFocusKey("")}
				className="flex items-center gap-1.5 text-metadata text-neutral-500 transition-colors hover:text-neutral-700 dark:hover:text-neutral-300"
			>
				<BookOpen className="h-3.5 w-3.5" />
				{passagesSummary(grouped)}
				<ChevronRight className="h-3.5 w-3.5" />
			</button>
			<div className="mt-1.5 flex flex-wrap gap-1.5">
				{shown.map((passage) => (
					<button
						key={passage.key}
						type="button"
						aria-haspopup="dialog"
						onClick={() => setFocusKey(passage.key)}
						className="max-w-full truncate rounded-full border border-black/[0.1] px-2.5 py-1 text-metadata font-semibold text-amber-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.1] dark:text-amber-400 dark:hover:bg-white/[0.06]"
					>
						{passage.reference}
					</button>
				))}
				{hidden > 0 && (
					<button
						type="button"
						aria-haspopup="dialog"
						onClick={() => setFocusKey("")}
						className="rounded-full border border-black/[0.1] px-2.5 py-1 text-metadata font-semibold text-neutral-500 transition-colors hover:bg-black/[0.04] dark:border-white/[0.1] dark:hover:bg-white/[0.06]"
					>
						+{hidden} more
					</button>
				)}
			</div>
			{focusKey !== null && (
				<VersesDialog grouped={grouped} averageSimilarity={averageSimilarity} focusKey={focusKey} onClose={close} />
			)}
		</div>
	);
};

export default RetrievedVersesCollapsible;
