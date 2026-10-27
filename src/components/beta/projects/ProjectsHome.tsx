"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Check, Plus, Route } from "lucide-react";
import { BOOKS } from "@/lib/bible/books";
import type { ProjectSummary } from "@/lib/beta/projects/projects";
import type { CoverId } from "@/lib/beta/projects/projects-rules";
import { COVERS, COVER_ORDER, CoverArt } from "./covers";
import { projectHref, projectsApi, readHref } from "./api";
import { ErrorNote, Sheet, card, eyebrow, field, ghostButton, goldButton, muted, plural, primaryButton, secondaryButton, serifTitle } from "./ui";

/** Ready-made topic study: Paul's life in Acts, one section per stage, each opening its chapter. */
const LIFE_OF_PAUL = {
	title: "The Life of Paul",
	description: "From Saul the persecutor to the prisoner in Rome, through the book of Acts.",
	sections: [
		["Saul the persecutor", "44.8"],
		["The road to Damascus", "44.9"],
		["The first journey", "44.13"],
		["The council at Jerusalem", "44.15"],
		["The second journey", "44.16"],
		["The third journey", "44.19"],
		["Arrest in Jerusalem", "44.21"],
		["Before Felix, Festus and Agrippa", "44.24"],
		["The voyage to Rome", "44.27"],
	] as const,
};

function progressLabel(project: ProjectSummary): string {
	const unit = project.scope.type === "book" ? "chapter" : "section";
	return project.progress.total ? `${project.progress.done} of ${plural(project.progress.total, unit)}` : "No sections yet";
}

function ProjectCard({ project }: { project: ProjectSummary }) {
	const next = project.progress.next;
	const counts = [
		project.counts.passages && plural(project.counts.passages, "passage"),
		project.counts.sources && plural(project.counts.sources, "source"),
		project.counts.questions && plural(project.counts.questions, "question"),
	].filter(Boolean);
	return (
		<article className={`${card} overflow-hidden`}>
			<Link href={projectHref(project.id)} className="group block focus-visible:outline-amber-600">
				<div className="relative h-40 overflow-hidden">
					<CoverArt cover={project.cover} sizes="(min-width: 1024px) 480px, 100vw" />
					<div className="absolute inset-x-0 bottom-0 p-4">
						<p className="text-xs font-bold uppercase tracking-[.18em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">{project.scope.type === "book" ? `Book study · ${project.scope.bookName}` : "Topic study"}</p>
						<h2 className={`${serifTitle} mt-1 text-[30px] text-white`}>{project.title}</h2>
					</div>
				</div>
			</Link>
			<div className="space-y-3 p-4">
				{project.description && <p className={`line-clamp-2 text-sm leading-6 ${muted}`}>{project.description}</p>}
				<div>
					<div className="flex items-center justify-between text-xs font-bold text-neutral-700 dark:text-[#d9d1c3]">
						<span>{progressLabel(project)}</span>
						<span>{project.progress.percent}%</span>
					</div>
					<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress.percent} aria-label={`${project.title} progress`}>
						<div className="h-full rounded-full bg-[#e5b664]" style={{ width: `${project.progress.percent}%` }} />
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className={`text-sm ${muted}`}>{counts.length ? counts.join(" · ") : "Nothing gathered yet"}</p>
					{next ? (
						<Link href={readHref(project.id, { section: next.id })} className={`${secondaryButton} text-amber-900 dark:text-[#e5b664]`}>
							Continue: {next.title} <ArrowRight size={16} aria-hidden />
						</Link>
					) : project.progress.total ? (
						<span className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-[#e5b664]">
							<Check size={16} aria-hidden /> Study complete
						</span>
					) : null}
				</div>
			</div>
		</article>
	);
}

type Kind = "book" | "topic";

function NewProjectSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset: "paul" | null }) {
	const router = useRouter();
	const [kind, setKind] = useState<Kind>(preset === "paul" ? "topic" : "book");
	const [book, setBook] = useState(45);
	const [title, setTitle] = useState(preset === "paul" ? LIFE_OF_PAUL.title : "");
	const [description, setDescription] = useState(preset === "paul" ? LIFE_OF_PAUL.description : "");
	const [sections, setSections] = useState(preset === "paul" ? LIFE_OF_PAUL.sections.map(([name]) => name).join("\n") : "");
	const [cover, setCover] = useState<CoverId | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const bookName = BOOKS.find((entry) => entry.order === book)?.name ?? "";

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			// The Life of Paul template opens each stage at its chapter in Acts.
			const names = sections
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((name) => ({ title: name, ref: preset === "paul" ? (LIFE_OF_PAUL.sections.find(([stage]) => stage === name)?.[1] ?? null) : null }));
			const { project } = await projectsApi.create({
				title: title.trim() || (kind === "book" ? `The Book of ${bookName}` : ""),
				description: description.trim() || null,
				...(cover ? { cover } : {}),
				scope: kind === "book" ? { type: "book", book } : { type: "topic" },
				...(kind === "topic" ? { sections: names } : {}),
			});
			router.push(projectHref(project.id));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "The project could not be created.");
			setBusy(false);
		}
	};

	return (
		<Sheet open={open} onClose={onClose} title="New study project" wide>
			<form onSubmit={submit} className="space-y-5">
				<fieldset>
					<legend className={eyebrow}>What are you studying?</legend>
					<div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
						{([
							["book", "A book", "Its chapters are the sections", BookOpen],
							["topic", "A topic", "Name your own sections", Route],
						] as const).map(([value, label, hint, Icon]) => (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={kind === value}
								onClick={() => setKind(value)}
								className={`flex min-h-[72px] items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${kind === value ? "border-amber-700/50 bg-amber-500/10 dark:border-amber-300/40" : "border-black/10 hover:bg-black/[.03] dark:border-white/10 dark:hover:bg-white/[.04]"}`}
							>
								<Icon size={20} className="mt-0.5 shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden />
								<span>
									<span className="block font-bold">{label}</span>
									<span className={`block text-xs leading-5 ${muted}`}>{hint}</span>
								</span>
							</button>
						))}
					</div>
				</fieldset>

				{kind === "book" && (
					<label className="block">
						<span className={eyebrow}>Book</span>
						<select value={book} onChange={(event) => setBook(Number(event.target.value))} className={`${field} mt-2 min-h-12`}>
							<optgroup label="Old Testament">
								{BOOKS.filter((entry) => entry.testament === "OT").map((entry) => <option key={entry.order} value={entry.order}>{entry.name}</option>)}
							</optgroup>
							<optgroup label="New Testament">
								{BOOKS.filter((entry) => entry.testament === "NT").map((entry) => <option key={entry.order} value={entry.order}>{entry.name}</option>)}
							</optgroup>
						</select>
					</label>
				)}

				<label className="block">
					<span className={eyebrow}>Name</span>
					<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={kind === "book" ? `The Book of ${bookName}` : "The Life of Paul"} className={`${field} mt-2`} required={kind === "topic"} />
				</label>

				<label className="block">
					<span className={eyebrow}>Description</span>
					<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} placeholder="What do you want to understand?" className={`${field} mt-2 resize-y`} />
				</label>

				{kind === "topic" && (
					<label className="block">
						<span className={eyebrow}>Sections</span>
						<textarea value={sections} onChange={(event) => setSections(event.target.value)} rows={4} placeholder={"One per line, for example:\nThe road to Damascus\nThe first journey"} className={`${field} mt-2 resize-y`} />
						<span className={`mt-1 block text-xs ${muted}`}>Optional. You can add sections, and the passage each one reads, later.</span>
					</label>
				)}

				<fieldset>
					<legend className={eyebrow}>Cover</legend>
					<div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7" role="radiogroup">
						{COVER_ORDER.map((id) => (
							<button key={id} type="button" role="radio" aria-checked={cover === id} aria-label={COVERS[id].label} onClick={() => setCover(id)} className={`relative h-16 overflow-hidden rounded-xl border-2 ${cover === id ? "border-[#e5b664]" : "border-transparent"}`}>
								<CoverArt cover={id} sizes="96px" />
								{cover === id && <Check size={18} className="absolute right-1 top-1 text-white" aria-hidden />}
							</button>
						))}
					</div>
					<span className={`mt-1 block text-xs ${muted}`}>{cover ? COVERS[cover].label : "Leave it and SureWord picks one."}</span>
				</fieldset>

				<ErrorNote message={error} />
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
					<button type="submit" disabled={busy || (kind === "topic" && !title.trim())} className={primaryButton}>{busy ? "Creating…" : "Create project"}</button>
				</div>
			</form>
		</Sheet>
	);
}

export default function ProjectsHome({ initial }: { initial: ProjectSummary[] }) {
	const [sheet, setSheet] = useState<{ open: boolean; preset: "paul" | null; key: number }>({ open: false, preset: null, key: 0 });
	const [showArchived, setShowArchived] = useState(false);
	const active = initial.filter((project) => !project.archived);
	const archived = initial.filter((project) => project.archived);
	const openSheet = (preset: "paul" | null) => setSheet((current) => ({ open: true, preset, key: current.key + 1 }));

	return (
		<main className="mx-auto w-full max-w-5xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-10">
			<Link href="/beta/study" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> Study
			</Link>
			<header className="mt-2 flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className={`${serifTitle} text-[clamp(2.3rem,8vw,3rem)]`}>Study Projects</h1>
					<p className={`mt-1 max-w-xl text-base leading-7 ${muted}`}>One workspace for one study: its passages, your notes and sources, the questions you are working through, and an assistant that answers only from them.</p>
				</div>
				<button type="button" onClick={() => openSheet(null)} className={primaryButton}>
					<Plus size={18} aria-hidden /> New project
				</button>
			</header>

			{active.length === 0 ? (
				<section className={`${card} mt-7 px-5 py-6 sm:px-7`} aria-labelledby="projects-empty">
					<h2 id="projects-empty" className={`${serifTitle} text-[28px]`}>Begin a study</h2>
					<p className={`mt-2 max-w-2xl leading-7 ${muted}`}>
						Choose a book and read it chapter by chapter, or name a topic and the passages that carry it. Gather passages from the reader, your notes and highlights, and any commentary you trust, then ask questions answered only from what you gathered, with the verse behind every claim.
					</p>
					<div className="mt-5 flex flex-wrap gap-2">
						<button type="button" onClick={() => openSheet(null)} className={goldButton}>
							<BookOpen size={18} aria-hidden /> Study a book
						</button>
						<button type="button" onClick={() => openSheet("paul")} className={secondaryButton}>
							<Route size={18} aria-hidden /> The Life of Paul
						</button>
					</div>
				</section>
			) : (
				<div className="mt-7 grid gap-4 md:grid-cols-2">
					{active.map((project) => <ProjectCard key={project.id} project={project} />)}
				</div>
			)}

			{archived.length > 0 && (
				<section className="mt-9" aria-labelledby="projects-archived">
					<button type="button" id="projects-archived" onClick={() => setShowArchived((value) => !value)} aria-expanded={showArchived} className={ghostButton}>
						{showArchived ? "Hide" : "Show"} archived ({archived.length})
					</button>
					{showArchived && <div className="mt-3 grid gap-4 opacity-90 md:grid-cols-2">{archived.map((project) => <ProjectCard key={project.id} project={project} />)}</div>}
				</section>
			)}

			<NewProjectSheet key={sheet.key} open={sheet.open} preset={sheet.preset} onClose={() => setSheet((current) => ({ ...current, open: false }))} />
		</main>
	);
}
