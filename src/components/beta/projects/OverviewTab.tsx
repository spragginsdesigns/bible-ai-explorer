"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, Check, Link2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { projectsApi, readHref } from "./api";
import { ErrorNote, SkeletonLine, card, chip, field, ghostButton, iconButton, muted, plural, primaryButton, secondaryButton, serifTitle, shortDate } from "./ui";
import type { TabProps } from "./ProjectWorkspace";

function Sections({ project, refresh }: Pick<TabProps, "project" | "refresh">) {
	const [title, setTitle] = useState("");
	const [reference, setReference] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const book = project.scope.type === "book";

	const change = async (section: Record<string, unknown>) => {
		setBusy(true);
		setError(null);
		try {
			await projectsApi.update(project.id, { section });
			await refresh();
			return true;
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not saved. Try again.");
			return false;
		} finally {
			setBusy(false);
		}
	};
	const add = async (event: FormEvent) => {
		event.preventDefault();
		if (await change({ op: "add", title, ref: reference.trim() || null })) {
			setTitle("");
			setReference("");
		}
	};

	return (
		<section aria-labelledby="sections-title" className={`${card} p-5`}>
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="sections-title" className={`${serifTitle} text-[26px]`}>{book ? "Chapters" : "Sections"}</h2>
				<p className={`text-sm ${muted}`}>{project.progress.total ? `${project.progress.done} of ${project.progress.total} done` : ""}</p>
			</div>
			{book ? (
				<ol className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2">
					{project.sections.map((section) => (
						<li key={section.id}>
							<Link
								href={readHref(project.id, { section: section.id })}
								aria-label={`${section.title}${section.done ? ", done" : ""}`}
								className={`flex h-12 items-center justify-center rounded-2xl border text-sm font-bold transition-colors ${
									section.done ? "border-transparent bg-[#e5b664]/85 text-[#1c2118]" : section.id === project.progress.next?.id ? "border-amber-700/60 text-amber-900 dark:border-amber-300/60 dark:text-amber-200" : "border-black/10 hover:bg-black/[.04] dark:border-white/10 dark:hover:bg-white/[.05]"
								}`}
							>
								{section.done ? <Check size={17} aria-hidden /> : section.ref?.split(".")[1]}
							</Link>
						</li>
					))}
				</ol>
			) : (
				<>
					{project.sections.length === 0 && <p className={`mt-2 leading-7 ${muted}`}>Name the stages of this study, and the chapter each one reads, so Continue study can walk you through them.</p>}
					<ol className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.06]">
						{project.sections.map((section, index) => (
							<li key={section.id} className="flex items-center gap-2 py-1.5">
								<button
									type="button"
									disabled={busy}
									onClick={() => change({ op: "done", id: section.id, done: !section.done })}
									aria-label={section.done ? `Mark ${section.title} not done` : `Mark ${section.title} done`}
									aria-pressed={section.done}
									className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${section.done ? "border-transparent bg-[#e5b664] text-[#1c2118]" : "border-black/15 text-transparent dark:border-white/15"}`}
								>
									<Check size={17} aria-hidden />
								</button>
								<Link href={readHref(project.id, { section: section.id })} className="min-h-11 min-w-0 flex-1 content-center rounded-lg px-1 hover:bg-black/[.03] dark:hover:bg-white/[.03]">
									<span className={`block font-bold ${section.done ? "text-neutral-500 line-through decoration-1 dark:text-neutral-400" : ""}`}>{index + 1}. {section.title}</span>
								</Link>
								<button type="button" disabled={busy} onClick={() => change({ op: "remove", id: section.id })} aria-label={`Remove ${section.title}`} className={iconButton}>
									<X size={17} aria-hidden />
								</button>
							</li>
						))}
					</ol>
					<form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
						<label className="sr-only" htmlFor="section-title">New section</label>
						<input id="section-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="New section, like The first journey" className={field} />
						<label className="sr-only" htmlFor="section-ref">Chapter it reads</label>
						<input id="section-ref" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={40} placeholder="Chapter, like Acts 13" className={field} />
						<button type="submit" disabled={busy || !title.trim()} className={secondaryButton}><Plus size={17} aria-hidden /> Add</button>
					</form>
				</>
			)}
			<div className="mt-3"><ErrorNote message={error} /></div>
		</section>
	);
}

export default function OverviewTab({ project, refresh, goTo }: TabProps) {
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [added, setAdded] = useState<Set<string>>(new Set());
	const overview = project.overview;
	const hasMaterial = project.passages.length + project.sources.length > 0 || project.sections.some((section) => section.ref);
	const questionTexts = new Set(project.questions.map((question) => question.text.toLowerCase()));
	const passageRefs = new Set(project.passages.map((passage) => passage.reference));

	const generate = async () => {
		setGenerating(true);
		setError(null);
		try {
			await projectsApi.overview(project.id);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The Overview could not be written. Try again.");
		} finally {
			setGenerating(false);
		}
	};
	const addQuestion = async (text: string, theme: string | null) => {
		setError(null);
		try {
			await projectsApi.add(project.id, { kind: "question", text, origin: "overview", topics: theme ? [theme] : [] });
			setAdded((current) => new Set(current).add(text));
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		}
	};
	const addPassage = async (reference: string) => {
		setError(null);
		try {
			await projectsApi.add(project.id, { kind: "passage", reference, origin: "overview" });
			setAdded((current) => new Set(current).add(reference));
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		}
	};

	return (
		<div className="space-y-4">
			<Sections project={project} refresh={refresh} />

			{generating ? (
				<section className={`${card} space-y-3 p-5`} aria-busy="true" aria-live="polite">
					<p className="font-bold">Reading your passages and sources…</p>
					<p className={`text-sm ${muted}`}>The Overview takes up to a minute. It is written only from this project.</p>
					<SkeletonLine width="w-2/3" />
					<SkeletonLine />
					<SkeletonLine width="w-5/6" />
				</section>
			) : !overview ? (
				<section className={`${card} p-5`} aria-labelledby="overview-empty">
					<h2 id="overview-empty" className={`${serifTitle} text-[26px]`}>Overview</h2>
					<p className={`mt-2 leading-7 ${muted}`}>
						{hasMaterial
							? "Key themes with the verses that carry them, passages elsewhere in Scripture that connect to this study, and questions to take back into the text. Written from this project's passages and sources when you ask for it."
							: "Add a passage or a source first. The Overview is written only from what this project holds."}
					</p>
					<button type="button" onClick={generate} disabled={!hasMaterial} className={`${primaryButton} mt-4`}>
						<Sparkles size={17} aria-hidden /> Write the Overview
					</button>
				</section>
			) : (
				<>
					<section className={`${card} p-5`} aria-labelledby="themes-title">
						<h2 id="themes-title" className={`${serifTitle} text-[26px]`}>Key themes</h2>
						<ul className="mt-2 divide-y divide-black/[.06] dark:divide-white/[.06]">
							{overview.themes.map((theme) => (
								<li key={theme.name} className="py-3">
									<h3 className="font-bold">{theme.name}</h3>
									<p className={`mt-1 leading-6 ${muted}`}>{theme.summary}</p>
									<div className="mt-2 flex flex-wrap gap-1.5">
										{theme.refs.map((ref) => (
											<Link key={ref.reference} href={ref.href} className={chip}>{ref.reference}</Link>
										))}
									</div>
								</li>
							))}
						</ul>
					</section>

					{overview.connected.length > 0 && (
						<section className={`${card} p-5`} aria-labelledby="connected-title">
							<h2 id="connected-title" className={`${serifTitle} text-[26px]`}>Connected passages</h2>
							<p className={`mt-1 text-sm ${muted}`}>From SureWord&rsquo;s cross-references, beyond this project.</p>
							<ul className="mt-2 divide-y divide-black/[.06] dark:divide-white/[.06]">
								{overview.connected.map((entry) => {
									const inProject = passageRefs.has(entry.reference) || added.has(entry.reference);
									return (
										<li key={entry.reference} className="py-3">
											<div className="flex items-start justify-between gap-3">
												<Link href={entry.href} className="inline-flex min-h-11 items-center font-bold hover:underline">{entry.reference}</Link>
												<button type="button" onClick={() => addPassage(entry.reference)} disabled={inProject} className={`${ghostButton} -mr-2 -mt-1`}>
													{inProject ? <><Check size={16} aria-hidden /> In project</> : <><Plus size={16} aria-hidden /> Add</>}
												</button>
											</div>
											<p className="mt-1 font-[family-name:var(--font-cormorant)] text-[19px] leading-[1.4]">{entry.text}</p>
											<p className="mt-1 text-xs font-bold uppercase tracking-[.14em] text-neutral-500 dark:text-[#a59f92]">KJV{entry.from ? ` · reached from ${entry.from}` : ""}</p>
											<p className={`mt-1.5 leading-6 ${muted}`}><Link2 size={14} className="mr-1 inline" aria-hidden />{entry.why}</p>
										</li>
									);
								})}
							</ul>
						</section>
					)}

					<section className={`${card} p-5`} aria-labelledby="questions-title">
						<h2 id="questions-title" className={`${serifTitle} text-[26px]`}>Study questions</h2>
						<ol className="mt-2 space-y-1">
							{overview.questions.map((question, index) => {
								const have = questionTexts.has(question.text.toLowerCase()) || added.has(question.text);
								return (
									<li key={question.text} className="flex items-start gap-3 py-1.5">
										<span className="mt-0.5 w-5 shrink-0 font-[family-name:var(--font-cormorant)] text-lg font-bold text-amber-800 dark:text-[#e5b664]">{index + 1}.</span>
										<span className="min-w-0 flex-1 leading-6">{question.text}</span>
										<button type="button" onClick={() => addQuestion(question.text, question.theme)} disabled={have} aria-label={have ? "In your questions" : `Add to my questions: ${question.text}`} className={iconButton}>
											{have ? <Check size={17} aria-hidden /> : <Plus size={17} aria-hidden />}
										</button>
									</li>
								);
							})}
						</ol>
						<button type="button" onClick={() => goTo("questions")} className={`${ghostButton} -ml-3 mt-1`}>
							<BookOpen size={16} aria-hidden /> Your questions ({project.questions.length})
						</button>
					</section>

					<div className="flex flex-wrap items-center justify-between gap-3 px-1">
						<p className={`text-sm ${muted}`}>
							Written from {plural(overview.basis.passages, "passage")} and {plural(overview.basis.sources, "source")}, {shortDate(overview.generatedAt)}.
						</p>
						<button type="button" onClick={generate} className={secondaryButton}>
							<RefreshCw size={16} aria-hidden /> Rewrite the Overview
						</button>
					</div>
				</>
			)}
			<ErrorNote message={error} />
			<p className="px-1 text-xs leading-5 text-neutral-600 dark:text-[#b3ad9e]">Themes and connections are SureWord&rsquo;s reading of your material, not Scripture. Every verse shown is the King James text.</p>
		</div>
	);
}
