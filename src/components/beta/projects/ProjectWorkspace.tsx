"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { ProjectView } from "@/lib/beta/projects/projects";
import type { CoverId } from "@/lib/beta/projects/projects-rules";
import { COVERS, COVER_ORDER, CoverArt } from "./covers";
import { projectsApi, readHref } from "./api";
import { ErrorNote, Sheet, eyebrow, field, iconButton, muted, plural, primaryButton, secondaryButton, serifTitle } from "./ui";
import OverviewTab from "./OverviewTab";
import PassagesTab from "./PassagesTab";
import SourcesTab from "./SourcesTab";
import QuestionsTab from "./QuestionsTab";
import AskTab from "./AskTab";
import WriteTab from "./WriteTab";

export const TABS = [
	{ id: "overview", label: "Overview" },
	{ id: "passages", label: "Passages" },
	{ id: "sources", label: "Sources" },
	{ id: "questions", label: "Questions" },
	{ id: "ask", label: "Ask" },
	{ id: "write", label: "Write" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export interface TabProps {
	project: ProjectView;
	refresh: () => Promise<void>;
	goTo: (tab: TabId, prefill?: string) => void;
}

function isTab(value: string): value is TabId {
	return TABS.some((tab) => tab.id === value);
}

function EditSheet({ project, open, onClose, onSaved }: { project: ProjectView; open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
	const [title, setTitle] = useState(project.title);
	const [description, setDescription] = useState(project.description ?? "");
	const [cover, setCover] = useState<CoverId>(project.cover);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await projectsApi.update(project.id, { title, description, cover });
			await onSaved();
			onClose();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not saved. Try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<Sheet open={open} onClose={onClose} title="Edit project" wide>
			<form onSubmit={submit} className="space-y-5">
				<label className="block">
					<span className={eyebrow}>Name</span>
					<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required className={`${field} mt-2`} />
				</label>
				<label className="block">
					<span className={eyebrow}>Description</span>
					<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} className={`${field} mt-2 resize-y`} />
				</label>
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
				</fieldset>
				<ErrorNote message={error} />
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
					<button type="submit" disabled={busy || !title.trim()} className={primaryButton}>{busy ? "Saving…" : "Save"}</button>
				</div>
			</form>
		</Sheet>
	);
}

function DeleteSheet({ project, open, onClose }: { project: ProjectView; open: boolean; onClose: () => void }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const gathered = project.passages.length + project.sources.length + project.questions.length;
	const remove = async () => {
		setBusy(true);
		setError(null);
		try {
			await projectsApi.remove(project.id);
			router.push("/beta/study/projects");
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not deleted. Try again.");
			setBusy(false);
		}
	};
	return (
		<Sheet open={open} onClose={onClose} title="Delete this project?">
			<p className="leading-7">
				{project.title} and everything gathered in it{gathered ? ` (${plural(gathered, "item")})` : ""}, its Overview, answers and assembled studies will be deleted. Your notes and highlights stay where they are, and any study you saved as a note stays in Notes.
			</p>
			<p className={`mt-3 text-sm ${muted}`}>To keep it out of the way instead, archive it.</p>
			<div className="mt-4"><ErrorNote message={error} /></div>
			<div className="mt-5 flex justify-end gap-2">
				<button type="button" onClick={onClose} className={secondaryButton}>Keep it</button>
				<button type="button" onClick={remove} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-700 px-5 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-40">
					<Trash2 size={16} aria-hidden /> {busy ? "Deleting…" : "Delete project"}
				</button>
			</div>
		</Sheet>
	);
}

export default function ProjectWorkspace({ initial }: { initial: ProjectView }) {
	const { userId } = useAuth();
	// A different account must never see the previous one's project, even briefly.
	return <Workspace key={userId ?? "guest"} initial={initial} />;
}

function Workspace({ initial }: { initial: ProjectView }) {
	const [project, setProject] = useState(initial);
	const [tab, setTab] = useState<TabId>("overview");
	const [prefill, setPrefill] = useState<{ tab: TabId; text: string; key: number } | null>(null);
	const [menu, setMenu] = useState(false);
	const [sheet, setSheet] = useState<"edit" | "delete" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
	const menuRef = useRef<HTMLDivElement>(null);

	// The actions menu closes on Escape or a tap anywhere outside it.
	useEffect(() => {
		if (!menu) return;
		const close = (event: PointerEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenu(false);
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", close);
		};
	}, [menu]);

	useEffect(() => {
		const hash = window.location.hash.slice(1);
		if (isTab(hash)) setTab(hash);
	}, []);

	const selectTab = useCallback((next: TabId) => {
		setTab(next);
		window.history.replaceState(null, "", `#${next}`);
		tabRefs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, []);

	const refresh = useCallback(async () => {
		try {
			const { project: fresh } = await projectsApi.get(project.id);
			setProject(fresh);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not refresh this project.");
		}
	}, [project.id]);

	const goTo = useCallback(
		(next: TabId, text?: string) => {
			if (text !== undefined) setPrefill((current) => ({ tab: next, text, key: (current?.key ?? 0) + 1 }));
			selectTab(next);
			document.getElementById("project-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
		},
		[selectTab],
	);

	const archive = async () => {
		setMenu(false);
		setError(null);
		try {
			await projectsApi.update(project.id, { archived: !project.archived });
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not saved. Try again.");
		}
	};

	const next = project.progress.next;
	const unit = project.scope.type === "book" ? "chapter" : "section";
	const tabProps: TabProps = { project, refresh, goTo };
	const prefillFor = (id: TabId) => (prefill?.tab === id ? prefill : null);

	return (
		<main className="mx-auto w-full max-w-4xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+24px)] pt-4 lg:px-8 lg:pb-16 lg:pt-8">
			<div className="flex items-center justify-between">
				<Link href="/beta/study/projects" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
					<ArrowLeft size={18} aria-hidden /> Study Projects
				</Link>
				<div ref={menuRef} className="relative">
					<button type="button" onClick={() => setMenu((value) => !value)} aria-expanded={menu} aria-haspopup="menu" aria-label="Project actions" className={iconButton}>
						<MoreHorizontal size={22} aria-hidden />
					</button>
					{menu && (
						<div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-2xl border border-black/10 bg-[#fbf8f1] py-1 shadow-lg dark:border-white/10 dark:bg-[#1a1e18]">
							<button role="menuitem" type="button" onClick={() => { setMenu(false); setSheet("edit"); }} className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.05]">
								<Pencil size={17} aria-hidden /> Rename or edit
							</button>
							<button role="menuitem" type="button" onClick={archive} className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold hover:bg-black/[.04] dark:hover:bg-white/[.05]">
								{project.archived ? <ArchiveRestore size={17} aria-hidden /> : <Archive size={17} aria-hidden />} {project.archived ? "Restore from archive" : "Archive"}
							</button>
							<button role="menuitem" type="button" onClick={() => { setMenu(false); setSheet("delete"); }} className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-semibold text-red-700 hover:bg-red-500/[.06] dark:text-red-300">
								<Trash2 size={17} aria-hidden /> Delete
							</button>
						</div>
					)}
				</div>
			</div>

			<section aria-labelledby="project-title" className="relative mt-2 overflow-hidden rounded-[28px] border border-amber-900/10 dark:border-amber-200/10">
				<div className="relative min-h-[260px] sm:min-h-[300px]">
					<CoverArt cover={project.cover} sizes="(min-width: 1024px) 860px, 100vw" priority />
					<div className="relative flex min-h-[260px] flex-col justify-end p-5 sm:min-h-[300px] sm:p-7">
						<p className="text-xs font-bold uppercase tracking-[.2em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">
							{project.archived ? "Archived · " : ""}
							{project.scope.type === "book" ? `Book study · ${project.scope.bookName}` : "Topic study"}
						</p>
						<h1 id="project-title" className={`${serifTitle} mt-2 text-[clamp(2.3rem,9vw,3.4rem)] leading-[1.02] text-white [text-shadow:0_1px_12px_rgba(0,0,0,.45)]`}>{project.title}</h1>
						{project.progress.total > 0 && (
							<div className="mt-4 max-w-md">
								<div className="flex justify-between text-sm font-semibold text-white/90">
									<span>{project.progress.done} of {plural(project.progress.total, unit)}</span>
									<span>{project.progress.percent}%</span>
								</div>
								<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress.percent}>
									<div className="h-full rounded-full bg-[#e5b664]" style={{ width: `${project.progress.percent}%` }} />
								</div>
							</div>
						)}
						<div className="mt-5 flex flex-wrap gap-2">
							{next ? (
								<Link href={readHref(project.id, { section: next.id })} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1c2118] hover:opacity-90">
									Continue study: {next.title} <ArrowRight size={18} aria-hidden />
								</Link>
							) : project.progress.total > 0 ? (
								<span className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white/15 px-5 text-base font-bold text-white">
									<Check size={18} aria-hidden /> Every {unit} is done
								</span>
							) : (
								<button type="button" onClick={() => selectTab("overview")} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#e5b664] px-6 text-base font-bold text-[#1c2118] hover:opacity-90">
									Add your first section
								</button>
							)}
						</div>
					</div>
				</div>
			</section>

			{project.description && <p className={`mt-4 whitespace-pre-line text-[17px] leading-7 ${muted}`}>{project.description}</p>}
			<div className="mt-3"><ErrorNote message={error} /></div>

			<div id="project-tabs" className="sticky top-0 z-10 -mx-5 mt-5 scroll-mt-2 border-b border-black/[.06] bg-[#f6f2e9] px-5 py-2 dark:border-white/[.06] dark:bg-[#0d100d] lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:dark:bg-transparent">
				<div role="tablist" aria-label="Project" className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{TABS.map((entry) => {
						const count =
							entry.id === "passages" ? project.passages.length : entry.id === "sources" ? project.sources.length : entry.id === "questions" ? project.questions.filter((q) => q.status === "open").length : 0;
						return (
							<button
								key={entry.id}
								ref={(node) => {
									tabRefs.current[entry.id] = node;
								}}
								type="button"
								role="tab"
								id={`tab-${entry.id}`}
								aria-selected={tab === entry.id}
								aria-controls={`panel-${entry.id}`}
								onClick={() => {
									// A tab chosen by hand starts empty; only "Ask about it" fills the question in.
									setPrefill(null);
									selectTab(entry.id);
								}}
								className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors ${
									tab === entry.id ? "bg-[#24281f] text-white dark:bg-[#f1eadc] dark:text-[#1c2118]" : "text-neutral-700 hover:bg-black/[.05] dark:text-[#d9d1c3] dark:hover:bg-white/[.06]"
								}`}
							>
								{entry.label}
								{count > 0 && <span className={`rounded-full px-1.5 text-xs ${tab === entry.id ? "bg-white/20 dark:bg-black/15" : "bg-black/[.07] dark:bg-white/[.1]"}`}>{count}</span>}
							</button>
						);
					})}
				</div>
			</div>

			{/* Every panel stays mounted, so an answer or an Overview still being written keeps its place when you look at another tab. */}
			{TABS.map((entry) => (
				<div key={entry.id} role="tabpanel" id={`panel-${entry.id}`} aria-labelledby={`tab-${entry.id}`} hidden={tab !== entry.id} className="mt-4">
					{entry.id === "overview" && <OverviewTab {...tabProps} />}
					{entry.id === "passages" && <PassagesTab {...tabProps} />}
					{entry.id === "sources" && <SourcesTab {...tabProps} />}
					{entry.id === "questions" && <QuestionsTab {...tabProps} />}
					{entry.id === "ask" && <AskTab {...tabProps} prefill={prefillFor("ask")} />}
					{entry.id === "write" && <WriteTab {...tabProps} />}
				</div>
			))}

			<EditSheet key={`edit-${sheet === "edit"}`} project={project} open={sheet === "edit"} onClose={() => setSheet(null)} onSaved={refresh} />
			<DeleteSheet project={project} open={sheet === "delete"} onClose={() => setSheet(null)} />
		</main>
	);
}
