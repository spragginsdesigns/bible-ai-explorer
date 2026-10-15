"use client";

import React from "react";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import type { MatchedChapterNote } from "@/lib/bible/chapterNotes";

interface VerseNotesSectionProps {
	reference: string;
	notes: MatchedChapterNote[];
	signedIn: boolean;
	onAddToNote: () => void;
	onNavigate?: () => void;
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

export default function VerseNotesSection({
	reference,
	notes,
	signedIn,
	onAddToNote,
	onNavigate,
}: VerseNotesSectionProps) {
	if (!signedIn) {
		return (
			<div className="py-2">
				<p className="text-support text-neutral-500 dark:text-neutral-400">
					Sign in to view and save study notes on {reference}.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 py-1">
			{notes.length === 0 ? (
				<p className="text-support text-neutral-500 dark:text-neutral-400">
					No study notes mention {reference} yet.
				</p>
			) : (
				<ul className="flex flex-col gap-2.5">
					{notes.map((note) => (
						<li key={note.id}>
							<Link
								href={`/notes?note=${encodeURIComponent(note.id)}`}
								onClick={onNavigate}
								className="group flex flex-col gap-1 rounded-xl border border-black/[0.08] bg-black/[0.03] px-3.5 py-2.5 transition-colors hover:border-amber-500/40 hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-amber-400/30 dark:hover:bg-white/[0.05]"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="flex items-center gap-1.5 truncate text-support font-bold text-amber-600 dark:text-amber-400">
										<NotebookPen className="h-3.5 w-3.5 shrink-0" aria-hidden />
										<span className="truncate">{note.title}</span>
									</span>
									<span className="shrink-0 text-metadata text-neutral-400 dark:text-neutral-500">
										{relativeTime(note.updatedAt)}
									</span>
								</div>
								{note.excerpt ? (
									<p className="line-clamp-2 text-metadata leading-relaxed text-neutral-600 dark:text-neutral-300">
										{note.excerpt}
									</p>
								) : null}
							</Link>
						</li>
					))}
				</ul>
			)}

			<button
				type="button"
				onClick={onAddToNote}
				className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2 text-metadata font-semibold text-amber-700 transition-colors hover:bg-amber-500/[0.14] dark:border-amber-400/25 dark:bg-amber-400/[0.08] dark:text-amber-400 dark:hover:bg-amber-400/[0.14]"
			>
				<Plus className="h-4 w-4 shrink-0" aria-hidden />
				Add {reference} to a note
			</button>
		</div>
	);
}
