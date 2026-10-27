"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, History, MessageCircleQuestion, Plus, Trash2 } from "lucide-react";
import { useContinueReading } from "@/components/daily/useContinueReading";
import { projectsApi, readHref } from "./api";
import { ErrorNote, card, field, ghostButton, iconButton, muted, primaryButton, secondaryButton, serifTitle } from "./ui";
import type { TabProps } from "./ProjectWorkspace";

const PREVIEW_VERSES = 3;

export default function PassagesTab({ project, refresh, goTo }: TabProps) {
	const lastRead = useContinueReading();
	const [reference, setReference] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const readerTarget = project.progress.next ?? project.sections[0] ?? null;

	const add = async (value: string, origin: string) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await projectsApi.add(project.id, { kind: "passage", reference: value, origin });
			if (result.duplicate) setNotice(`${value} is already in this project.`);
			await refresh();
			return true;
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
			return false;
		} finally {
			setBusy(false);
		}
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (reference.trim() && (await add(reference.trim(), "typed"))) setReference("");
	};
	const remove = async (id: string) => {
		setError(null);
		try {
			await projectsApi.removeItem(project.id, id);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not removed. Try again.");
		}
	};

	return (
		<div className="space-y-4">
			<section className={`${card} p-5`} aria-labelledby="add-passage">
				<h2 id="add-passage" className={`${serifTitle} text-[26px]`}>Add a passage</h2>
				<form onSubmit={submit} className="mt-3 flex gap-2">
					<label className="sr-only" htmlFor="passage-reference">Reference</label>
					<input id="passage-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Romans 5:1-11" maxLength={60} autoComplete="off" enterKeyHint="done" className={field} />
					<button type="submit" disabled={busy || !reference.trim()} className={`${primaryButton} shrink-0`}><Plus size={17} aria-hidden /> Add</button>
				</form>
				<div className="mt-3 flex flex-wrap gap-2">
					{readerTarget && (
						<Link href={readHref(project.id, { section: readerTarget.id })} className={secondaryButton}>
							<BookOpen size={16} aria-hidden /> Choose verses in {readerTarget.ref ? readerTarget.title : "the reader"}
						</Link>
					)}
					{!readerTarget && (
						<Link href={readHref(project.id, { book: 43, chapter: 1 })} className={secondaryButton}>
							<BookOpen size={16} aria-hidden /> Open the reader
						</Link>
					)}
					{lastRead && (
						<button type="button" disabled={busy} onClick={() => add(lastRead.label, "last-read")} className={secondaryButton}>
							<History size={16} aria-hidden /> Add {lastRead.label}, your last reading
						</button>
					)}
				</div>
				<p className={`mt-3 text-sm ${muted}`}>Passages are kept as references and always shown in the King James text. One chapter at a time, or verses within it.</p>
				{notice && <p className={`mt-2 text-sm font-semibold ${muted}`} role="status">{notice}</p>}
				<div className="mt-3"><ErrorNote message={error} /></div>
			</section>

			{project.passages.length === 0 ? (
				<p className={`px-1 leading-7 ${muted}`}>No passages yet. Type a reference above, or open a chapter and tap the verses you want to keep.</p>
			) : (
				<ul className="space-y-3">
					{project.passages.map((passage) => {
						const open = expanded.has(passage.id);
						const verses = open ? passage.verses : passage.verses.slice(0, PREVIEW_VERSES);
						return (
							<li key={passage.id} className={`${card} p-5`}>
								<div className="flex items-start justify-between gap-2">
									<div>
										<h3 className={`${serifTitle} text-[24px]`}>{passage.reference}</h3>
										<p className="text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">KJV · {passage.verses.length} {passage.verses.length === 1 ? "verse" : "verses"}</p>
									</div>
									<button type="button" onClick={() => remove(passage.id)} aria-label={`Remove ${passage.reference}`} className={iconButton}><Trash2 size={17} aria-hidden /></button>
								</div>
								<div className="mt-3 space-y-1.5 font-[family-name:var(--font-cormorant)] text-[19px] leading-[1.45]">
									{verses.map((verse) => (
										<p key={verse.verse}>
											<sup className="mr-1 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse.verse}</sup>
											{verse.text}
										</p>
									))}
								</div>
								<div className="mt-2 flex flex-wrap gap-1">
									{passage.verses.length > PREVIEW_VERSES && (
										<button type="button" onClick={() => setExpanded((current) => { const nextSet = new Set(current); if (open) nextSet.delete(passage.id); else nextSet.add(passage.id); return nextSet; })} aria-expanded={open} className={`${ghostButton} -ml-3`}>
											{open ? "Show less" : `Show all ${passage.verses.length} verses`}
										</button>
									)}
									<button type="button" onClick={() => goTo("ask", `What does ${passage.reference} teach?`)} className={`${ghostButton} -ml-3`}>
										<MessageCircleQuestion size={16} aria-hidden /> Ask about it
									</button>
									<Link href={passage.href} className={`${ghostButton} -ml-3`}>Read in context</Link>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
