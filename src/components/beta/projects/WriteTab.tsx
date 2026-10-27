"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, ListTree, NotebookPen, ScrollText, Trash2 } from "lucide-react";
import type { StudyView } from "@/lib/beta/projects/projects";
import Citations from "./Citations";
import { projectsApi } from "./api";
import { ErrorNote, SkeletonLine, card, eyebrow, ghostButton, iconButton, muted, secondaryButton, serifTitle, shortDate } from "./ui";
import type { TabProps } from "./ProjectWorkspace";

function StudyCard({ study, projectId, refresh }: { study: StudyView; projectId: string; refresh: () => Promise<void> }) {
	const [noteId, setNoteId] = useState(study.noteId);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const save = async () => {
		setBusy(true);
		setError(null);
		try {
			const saved = await projectsApi.saveNote(projectId, study.id);
			setNoteId(saved.noteId);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not saved. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const copy = async () => {
		setError(null);
		try {
			await navigator.clipboard.writeText(study.markdown);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setError("Copying is blocked here. Save it as a note instead.");
		}
	};
	const remove = async () => {
		setError(null);
		try {
			await projectsApi.removeItem(projectId, study.id);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not removed. Try again.");
		}
	};
	return (
		<article className={`${card} p-5`} aria-labelledby={`study-${study.id}`}>
			<div className="flex items-start justify-between gap-2">
				<div>
					<p className={eyebrow}>{study.mode === "outline" ? "Outline" : "Written study"} · {shortDate(study.createdAt)}</p>
					<h3 id={`study-${study.id}`} className={`${serifTitle} mt-1 text-[28px]`}>{study.title}</h3>
				</div>
				<button type="button" onClick={remove} aria-label={`Delete ${study.title}`} className={iconButton}><Trash2 size={16} aria-hidden /></button>
			</div>
			{study.study.intro && <p className="mt-2 leading-7">{study.study.intro}</p>}
			<div className="mt-4 space-y-5">
				{study.study.sections.map((section, sectionIndex) => (
					<section key={sectionIndex}>
						<h4 className="text-lg font-bold">{section.heading}</h4>
						<ul className={`mt-1.5 space-y-3 ${study.mode === "outline" ? "list-disc pl-5 marker:text-amber-700 dark:marker:text-[#e5b664]" : ""}`}>
							{section.points.map((point, pointIndex) => (
								<li key={pointIndex}>
									{point.basis === "interpretation" && <span className="mr-1.5 text-xs font-bold uppercase tracking-[.16em] text-neutral-500 dark:text-[#a59f92]">Interpretation</span>}
									<span className="leading-7">{point.text}</span>
									<Citations citations={point.citations} />
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
			<div className="mt-5 flex flex-wrap gap-2">
				{noteId ? (
					<Link href={`/notes?note=${encodeURIComponent(noteId)}`} className={secondaryButton}><Check size={16} aria-hidden /> Saved · Open the note</Link>
				) : (
					<button type="button" onClick={save} disabled={busy} className={secondaryButton}><NotebookPen size={16} aria-hidden /> {busy ? "Saving…" : "Save as a note"}</button>
				)}
				<button type="button" onClick={copy} className={secondaryButton}>
					{copied ? <><Check size={16} aria-hidden /> Copied</> : <><ClipboardCopy size={16} aria-hidden /> Copy as Markdown</>}
				</button>
			</div>
			<div className="mt-3"><ErrorNote message={error} /></div>
		</article>
	);
}

export default function WriteTab({ project, refresh }: TabProps) {
	const [working, setWorking] = useState<"outline" | "study" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showOlder, setShowOlder] = useState(false);
	const [latest, ...older] = project.studies;
	const hasMaterial = project.passages.length + project.sources.length > 0 || project.sections.some((section) => section.ref);

	const assemble = async (mode: "outline" | "study") => {
		setWorking(mode);
		setError(null);
		try {
			await projectsApi.study(project.id, mode);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "It could not be assembled. Try again.");
		} finally {
			setWorking(null);
		}
	};

	return (
		<div className="space-y-4">
			<section className={`${card} p-5`} aria-labelledby="write-title">
				<h2 id="write-title" className={`${serifTitle} text-[26px]`}>Assemble your study</h2>
				<p className={`mt-1 leading-7 ${muted}`}>Build an outline or a written study from what this project gathered, with every point cited and Scripture in the King James text. Keep it as a note, or copy it as Markdown. The last 20 drafts stay here.</p>
				<div className="mt-4 grid gap-2 sm:grid-cols-2">
					<button type="button" onClick={() => assemble("outline")} disabled={Boolean(working) || !hasMaterial} className={`${secondaryButton} min-h-[64px] justify-start rounded-2xl px-4 text-left`}>
						<ListTree size={20} aria-hidden />
						<span><span className="block">Outline</span><span className={`block text-xs font-semibold ${muted}`}>Sections and short cited points</span></span>
					</button>
					<button type="button" onClick={() => assemble("study")} disabled={Boolean(working) || !hasMaterial} className={`${secondaryButton} min-h-[64px] justify-start rounded-2xl px-4 text-left`}>
						<ScrollText size={20} aria-hidden />
						<span><span className="block">Written study</span><span className={`block text-xs font-semibold ${muted}`}>Paragraphs to read and keep</span></span>
					</button>
				</div>
				{!hasMaterial && <p className={`mt-3 text-sm ${muted}`}>Add a passage or a source first.</p>}
				<div className="mt-3"><ErrorNote message={error} /></div>
			</section>

			{working && (
				<section className={`${card} space-y-3 p-5`} aria-busy="true" aria-live="polite">
					<p className="font-bold">{working === "outline" ? "Assembling the outline…" : "Writing the study…"}</p>
					<p className={`text-sm ${muted}`}>This takes up to a minute.</p>
					<SkeletonLine width="w-1/2" />
					<SkeletonLine />
					<SkeletonLine width="w-4/5" />
				</section>
			)}

			{latest && <StudyCard key={latest.id} study={latest} projectId={project.id} refresh={refresh} />}
			{older.length > 0 && (
				<section aria-labelledby="older-studies">
					<button type="button" id="older-studies" onClick={() => setShowOlder((value) => !value)} aria-expanded={showOlder} className={`${ghostButton} -ml-3`}>
						{showOlder ? "Hide" : "Show"} earlier drafts ({older.length})
					</button>
					{showOlder && <div className="mt-2 space-y-3">{older.map((study) => <StudyCard key={study.id} study={study} projectId={project.id} refresh={refresh} />)}</div>}
				</section>
			)}
		</div>
	);
}
