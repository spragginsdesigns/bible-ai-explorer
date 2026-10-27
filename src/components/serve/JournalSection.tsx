"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { MAX_ENTRY_LENGTH } from "@/lib/serve-rules";
import { addJournalEntry, deleteJournalEntry, fetchJournal, type ServeEntryView } from "./serveClient";

export interface JournalSectionHandle {
	/** Scroll to the journal and focus it, optionally writing under a way's verse. */
	focus: (verseRef?: string | null) => void;
}

interface JournalCopy {
	title: string;
	prompt: string;
	verse: { reference: string; text: string };
}

type ListState = { status: "loading" } | { status: "ready"; entries: ServeEntryView[] } | { status: "error" };

function entryDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? ""
		: date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/**
 * "What I did": the reader's private notes. Deliberately shows no totals,
 * tallies or streaks; the list is just their own words, newest first.
 */
const JournalSection = forwardRef<JournalSectionHandle, { journal: JournalCopy }>(function JournalSection(
	{ journal },
	ref
) {
	const sectionRef = useRef<HTMLElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [text, setText] = useState("");
	const [verseRef, setVerseRef] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [list, setList] = useState<ListState>({ status: "loading" });
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	useImperativeHandle(ref, () => ({
		focus: (nextVerse) => {
			if (nextVerse) setVerseRef(nextVerse);
			sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
			textareaRef.current?.focus({ preventScroll: true });
		},
	}));

	const load = useCallback((signal?: AbortSignal) => {
		setList({ status: "loading" });
		fetchJournal(signal)
			.then((entries) => {
				if (!signal?.aborted) setList({ status: "ready", entries });
			})
			.catch(() => {
				if (!signal?.aborted) setList({ status: "error" });
			});
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		load(controller.signal);
		return () => controller.abort();
	}, [load]);

	const save = () => {
		const trimmed = text.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		setError(null);
		addJournalEntry(trimmed, verseRef)
			.then((entry) => {
				setText("");
				setVerseRef(null);
				setList((current) =>
					current.status === "ready" ? { status: "ready", entries: [entry, ...current.entries] } : { status: "ready", entries: [entry] }
				);
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : "That didn't save. Try again."))
			.finally(() => setSaving(false));
	};

	const remove = (id: string) => {
		setDeletingId(id);
		setError(null);
		deleteJournalEntry(id)
			.then(() => {
				setConfirmingId(null);
				setList((current) =>
					current.status === "ready" ? { status: "ready", entries: current.entries.filter((entry) => entry.id !== id) } : current
				);
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : "That didn't delete. Try again."))
			.finally(() => setDeletingId(null));
	};

	return (
		<section
			ref={sectionRef}
			id="journal"
			aria-labelledby="serve-journal-title"
			className="scroll-mt-20 rounded-[24px] border border-black/10 bg-white/25 p-5 dark:border-white/10 dark:bg-white/[.015]"
		>
			<h2 id="serve-journal-title" className="text-lg font-bold">
				{journal.title}
			</h2>
			<p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">{journal.prompt}</p>
			{journal.verse.text ? (
				<blockquote className="mt-3 border-l-2 border-amber-600/50 pl-3 dark:border-[#e5b664]/50">
					<p className="font-[family-name:var(--font-cormorant)] text-xl leading-7">&ldquo;{journal.verse.text}&rdquo;</p>
					<footer className="mt-1 text-xs font-bold uppercase tracking-[.15em] text-neutral-600 dark:text-[#b3ad9e]">
						{journal.verse.reference} · KJV
					</footer>
				</blockquote>
			) : null}

			<form
				className="mt-4 flex flex-col gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<label htmlFor="serve-journal-text" className="sr-only">
					What happened
				</label>
				<textarea
					id="serve-journal-text"
					ref={textareaRef}
					value={text}
					onChange={(event) => setText(event.target.value)}
					maxLength={MAX_ENTRY_LENGTH}
					rows={3}
					placeholder="Write it down for yourself..."
					className="w-full resize-y rounded-2xl border border-black/10 bg-white/60 px-4 py-3 text-base outline-none placeholder:text-neutral-500 focus:border-amber-600/50 dark:border-white/10 dark:bg-black/30 dark:focus:border-[#e5b664]/50"
				/>
				<div className="flex flex-wrap items-center gap-2">
					{verseRef ? (
						<span className="inline-flex min-h-9 items-center gap-1 rounded-full border border-black/10 pl-3 pr-1 text-sm dark:border-white/10">
							{verseRef}
							<button
								type="button"
								onClick={() => setVerseRef(null)}
								aria-label={`Write without ${verseRef}`}
								className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
							>
								<X size={14} aria-hidden />
							</button>
						</span>
					) : null}
					<button
						type="submit"
						disabled={!text.trim() || saving}
						className="ml-auto flex min-h-11 items-center gap-2 rounded-full bg-[#e5b664] px-5 text-sm font-bold text-[#1c2118] transition-colors hover:bg-[#f0c77f] disabled:opacity-40"
					>
						{saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
						Save
					</button>
				</div>
				{error ? (
					<p role="alert" className="text-sm text-red-700 dark:text-red-300">
						{error}
					</p>
				) : null}
			</form>

			<div className="mt-5">
				{list.status === "loading" ? (
					<p role="status" className="flex items-center gap-2 text-sm text-neutral-500">
						<Loader2 size={16} className="animate-spin" aria-hidden />
						Opening your journal...
					</p>
				) : list.status === "error" ? (
					<div role="alert" className="text-sm text-neutral-600 dark:text-neutral-400">
						Your journal couldn&apos;t load.{" "}
						<button type="button" onClick={() => load()} className="min-h-11 font-bold text-amber-800 dark:text-[#e5b664]">
							Try again
						</button>
					</div>
				) : list.entries.length > 0 ? (
					<ul aria-label={journal.title} className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
						{list.entries.map((entry) => (
							<li key={entry.id} className="py-3">
								<div className="flex items-start gap-3">
									<div className="min-w-0 flex-1">
										<p className="text-xs font-bold uppercase tracking-[.12em] text-neutral-500 dark:text-[#b3ad9e]">
											{entryDate(entry.createdAt)}
											{entry.verseRef ? ` · ${entry.verseRef}` : ""}
										</p>
										<p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">{entry.text}</p>
									</div>
									{confirmingId === entry.id ? null : (
										<button
											type="button"
											onClick={() => setConfirmingId(entry.id)}
											aria-label="Delete this entry"
											className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5"
										>
											<Trash2 size={17} aria-hidden />
										</button>
									)}
								</div>
								{confirmingId === entry.id ? (
									<div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-black/10 p-3 dark:border-white/10">
										<p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">Delete this entry? It can&apos;t be brought back.</p>
										<button
											type="button"
											disabled={deletingId === entry.id}
											onClick={() => remove(entry.id)}
											className="min-h-10 rounded-lg border border-red-600/30 px-3 text-sm font-bold text-red-700 hover:bg-red-600/10 disabled:opacity-50 dark:text-red-300"
										>
											{deletingId === entry.id ? "Deleting..." : "Delete"}
										</button>
										<button
											type="button"
											onClick={() => setConfirmingId(null)}
											className="min-h-10 rounded-lg border border-black/10 px-3 text-sm font-semibold dark:border-white/10"
										>
											Cancel
										</button>
									</div>
								) : null}
							</li>
						))}
					</ul>
				) : null}
			</div>
		</section>
	);
});

export default JournalSection;
