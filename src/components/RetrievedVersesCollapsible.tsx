"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import {
	ChevronDown,
	ChevronRight,
	BookOpen,
	Copy,
	Share2,
	NotebookPen,
	ExternalLink,
} from "lucide-react";
import type { RetrievedVerse } from "./useChat";
import {
	chapterHrefForReference,
	copyVerse,
	saveVerseToNote,
	shareVerse,
} from "@/lib/chat/verseActions";

interface RetrievedVersesCollapsibleProps {
	verses: RetrievedVerse[];
	averageSimilarity: number;
}

/**
 * Retrieval confidence, ported from the Android app's RetrievedVersesCard:
 * amber for a strong hit, dimmed amber for a moderate one, grey for a broad
 * topical sweep.
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
			<Link href={href} className={className}>
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

function VerseActions({ verse }: { verse: RetrievedVerse }) {
	const [copyStatus, setCopyStatus] = useState<ActionStatus>("idle");
	const [saveStatus, setSaveStatus] = useState<ActionStatus>("idle");
	const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

	const flash = useCallback((set: (s: ActionStatus) => void, next: ActionStatus) => {
		set(next);
		if (next === "done" || next === "error") {
			setTimeout(() => set("idle"), 2000);
		}
	}, []);

	const onCopy = useCallback(async () => {
		try {
			await copyVerse(verse);
			flash(setCopyStatus, "done");
		} catch {
			flash(setCopyStatus, "error");
		}
	}, [verse, flash]);

	const onShare = useCallback(() => {
		shareVerse(verse).catch(() => {});
	}, [verse]);

	const onSave = useCallback(async () => {
		if (saveStatus === "busy") return;
		setSaveStatus("busy");
		try {
			const noteId = await saveVerseToNote(verse);
			setSavedNoteId(noteId);
			flash(setSaveStatus, "done");
		} catch {
			flash(setSaveStatus, "error");
		}
	}, [verse, saveStatus, flash]);

	// Unresolvable references (unexpected formats) get no Read chip rather than
	// linking to a broken route.
	const readHref = chapterHrefForReference(verse.reference);

	return (
		<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
			<ActionChip
				label={copyStatus === "done" ? "Copied ✓" : "Copy"}
				icon={Copy}
				onClick={onCopy}
			/>
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
			{readHref && <ActionChip label="Read" icon={BookOpen} href={readHref} />}
			{savedNoteId && (
				<Link
					href="/notes"
					className="inline-flex items-center gap-1 text-xs text-amber-700 transition-colors hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
				>
					<ExternalLink className="h-3 w-3" />
					View in notes
				</Link>
			)}
		</div>
	);
}

const RetrievedVersesCollapsible: React.FC<RetrievedVersesCollapsibleProps> = ({
	verses,
	averageSimilarity,
}) => {
	const [open, setOpen] = useState(false);
	const badge = matchStrength(averageSimilarity);

	return (
		<div className="mt-3">
			<div className="flex items-center gap-2 flex-wrap">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="flex items-center gap-1.5 text-metadata text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
				>
					{open ? (
						<ChevronDown className="w-3.5 h-3.5" />
					) : (
						<ChevronRight className="w-3.5 h-3.5" />
					)}
					<BookOpen className="w-3.5 h-3.5" />
					Retrieved Verses ({verses.length})
				</button>
				<span
					className={`inline-flex items-center gap-1 text-metadata px-2 py-0.5 rounded-full border ${badge.className}`}
				>
					{badge.label}
				</span>
			</div>
			{open && (
				<div className="mt-2 space-y-2 pl-1 border-l border-black/[0.08] dark:border-white/[0.08] ml-1">
					{verses.map((verse, i) => {
						const pct = Math.round(verse.similarity * 100);
						const verseBadge = matchStrength(verse.similarity);
						return (
							<div key={`${verse.reference}-${i}`} className="pl-3 py-1.5">
								<div className="flex items-start gap-2">
									<BookOpen className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 mt-0.5 flex-shrink-0" />
									<div className="flex-1 min-w-0">
										<div className="flex items-center justify-between gap-2">
											<p className="text-control text-amber-700 dark:text-amber-400 font-semibold">
												{verse.reference}
											</p>
											<span
													className={`text-metadata px-1.5 py-0.5 rounded border ${verseBadge.className}`}
											>
												{pct}%
											</span>
										</div>
										{verse.text && (
												<p className="mt-1 text-chat text-neutral-600 dark:text-neutral-400 font-[family-name:var(--font-cormorant)]">
												{verse.text}
											</p>
										)}
										<VerseActions verse={verse} />
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

export default RetrievedVersesCollapsible;
