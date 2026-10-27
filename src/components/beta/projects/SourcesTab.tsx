"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, ClipboardPaste, FileText, Highlighter, NotebookPen, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import type { SourceView } from "@/lib/beta/projects/projects";
import { projectsApi } from "./api";
import { ErrorNote, Sheet, SkeletonLine, card, field, ghostButton, iconButton, muted, plural, primaryButton, secondaryButton, serifTitle } from "./ui";
import type { TabProps } from "./ProjectWorkspace";

type SheetKind = "notes" | "highlights" | "paste" | "upload" | null;

const TYPE_ICON = { note: NotebookPen, highlight: Highlighter, pasted: ClipboardPaste, upload: FileText } as const;

function describe(source: SourceView): string {
	switch (source.type) {
		case "note":
			return source.missing ? "Note · deleted from Notes" : `Your note · read live from Notes · ${plural(source.chars, "character")}`;
		case "highlight":
			return source.missing ? "Highlight · no longer highlighted" : `Your highlight${source.highlight?.translation && source.highlight.translation !== "KJV" ? ` (marked in ${source.highlight.translation}, shown in KJV)` : ""}`;
		case "pasted":
			return `Pasted text · ${plural(source.chars, "character")}${source.truncated ? " · cut to fit" : ""}`;
		case "upload":
			return `${source.fileName?.toLowerCase().endsWith(".pdf") ? "PDF" : "Text file"}${source.pages ? ` · ${plural(source.pages, "page")}` : ""} · ${plural(source.chars, "character")}${source.truncated ? " · cut to fit" : ""}`;
	}
}

function NotesPicker({ projectId, have, onAdded }: { projectId: string; have: Set<string>; onAdded: () => Promise<void> }) {
	const [query, setQuery] = useState("");
	const [notes, setNotes] = useState<{ id: string; title: string; preview: string }[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [added, setAdded] = useState<Set<string>>(new Set());
	useEffect(() => {
		let live = true;
		const timer = setTimeout(() => {
			projectsApi
				.notes(query)
				.then((result) => live && setNotes(result.notes))
				.catch((caught) => live && setError(caught instanceof Error ? caught.message : "Notes could not be loaded."));
		}, query ? 250 : 0);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [query]);
	// One add at a time: two at once would race for the same source label.
	const [pending, setPending] = useState<string | null>(null);
	const add = async (noteId: string) => {
		if (pending) return;
		setPending(noteId);
		setError(null);
		try {
			await projectsApi.add(projectId, { kind: "note", noteId });
			setAdded((current) => new Set(current).add(noteId));
			await onAdded();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		} finally {
			setPending(null);
		}
	};
	return (
		<div className="space-y-3">
			<p className={`text-sm ${muted}`}>A note joins the project as a link to the note itself, so later edits in Notes are what the assistant reads.</p>
			<label className="relative block">
				<span className="sr-only">Search your notes</span>
				<Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden />
				<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes" className={`${field} pl-11`} />
			</label>
			<ErrorNote message={error} />
			{notes === null ? (
				<div className="space-y-2 py-2"><SkeletonLine width="w-1/2" /><SkeletonLine /></div>
			) : notes.length === 0 ? (
				<p className={`py-3 ${muted}`}>{query ? "No notes match." : "You have no notes yet."}</p>
			) : (
				<ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
					{notes.map((note) => {
						const inProject = have.has(note.id) || added.has(note.id);
						return (
							<li key={note.id} className="flex items-start gap-3 py-2.5">
								<span className="min-w-0 flex-1">
									<span className="block font-bold">{note.title}</span>
									<span className={`line-clamp-2 text-sm ${muted}`}>{note.preview || "Empty note"}</span>
								</span>
								<button type="button" onClick={() => add(note.id)} disabled={inProject || pending !== null} className={ghostButton}>
									{inProject ? <><Check size={16} aria-hidden /> Added</> : pending === note.id ? "Adding…" : <><Plus size={16} aria-hidden /> Add</>}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function HighlightsPicker({ projectId, book, have, onAdded }: { projectId: string; book: number | null; have: Set<string>; onAdded: () => Promise<void> }) {
	const [highlights, setHighlights] = useState<Awaited<ReturnType<typeof projectsApi.highlights>>["highlights"] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [added, setAdded] = useState<Set<string>>(new Set());
	useEffect(() => {
		let live = true;
		projectsApi
			.highlights(book)
			.then((result) => live && setHighlights(result.highlights))
			.catch((caught) => live && setError(caught instanceof Error ? caught.message : "Highlights could not be loaded."));
		return () => {
			live = false;
		};
	}, [book]);
	const keyOf = (h: { translation: string; book: number; chapter: number; verse: number }) => `${h.translation}:${h.book}.${h.chapter}.${h.verse}`;
	const [pending, setPending] = useState<string | null>(null);
	const add = async (h: NonNullable<typeof highlights>[number]) => {
		if (pending) return;
		setPending(keyOf(h));
		setError(null);
		try {
			await projectsApi.add(projectId, { kind: "highlight", book: h.book, chapter: h.chapter, verse: h.verse, translation: h.translation });
			setAdded((current) => new Set(current).add(keyOf(h)));
			await onAdded();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		} finally {
			setPending(null);
		}
	};
	return (
		<div className="space-y-3">
			<p className={`text-sm ${muted}`}>Highlights join as links to the verse you marked{book ? ", this book's first" : ""}. The verse is shown in the King James text.</p>
			<ErrorNote message={error} />
			{highlights === null ? (
				<div className="space-y-2 py-2"><SkeletonLine width="w-1/3" /><SkeletonLine /></div>
			) : highlights.length === 0 ? (
				<p className={`py-3 ${muted}`}>You have not highlighted any verses yet. Highlight verses in the Bible reader and they appear here.</p>
			) : (
				<ul className="divide-y divide-black/[.06] dark:divide-white/[.06]">
					{highlights.map((h) => {
						const inProject = have.has(keyOf(h)) || added.has(keyOf(h));
						return (
							<li key={keyOf(h)} className="flex items-start gap-3 py-2.5">
								<span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: h.color }} />
								<span className="min-w-0 flex-1">
									<span className="block font-bold">{h.reference}{h.colorName ? <span className={`ml-2 text-xs font-semibold ${muted}`}>{h.colorName}</span> : null}</span>
									<span className="line-clamp-2 font-[family-name:var(--font-cormorant)] text-[17px] leading-snug">{h.text}</span>
								</span>
								<button type="button" onClick={() => add(h)} disabled={inProject || pending !== null} className={ghostButton}>
									{inProject ? <><Check size={16} aria-hidden /> Added</> : pending === keyOf(h) ? "Adding…" : <><Plus size={16} aria-hidden /> Add</>}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function PasteForm({ projectId, onDone }: { projectId: string; onDone: () => Promise<void> }) {
	const [title, setTitle] = useState("");
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await projectsApi.add(projectId, { kind: "pasted", title, text });
			await onDone();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
			setBusy(false);
		}
	};
	return (
		<form onSubmit={submit} className="space-y-3">
			<label className="block">
				<span className="text-sm font-bold">Name</span>
				<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="Matthew Henry on Romans 5" className={`${field} mt-1.5`} />
			</label>
			<label className="block">
				<span className="text-sm font-bold">Text</span>
				<textarea value={text} onChange={(event) => setText(event.target.value)} required rows={9} placeholder="Paste a commentary, an article, sermon notes…" className={`${field} mt-1.5 resize-y`} />
				<span className={`mt-1 block text-xs ${muted}`}>{text.length ? `${text.length.toLocaleString()} characters` : "Up to 200,000 characters."}</span>
			</label>
			<ErrorNote message={error} />
			<div className="flex justify-end"><button type="submit" disabled={busy || !title.trim() || text.trim().length < 20} className={primaryButton}>{busy ? "Adding…" : "Add source"}</button></div>
		</form>
	);
}

function UploadForm({ projectId, onDone }: { projectId: string; onDone: () => Promise<void> }) {
	const input = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!file) return;
		if (file.size > 4 * 1024 * 1024) {
			setError("Upload a file up to 4 MB.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await projectsApi.upload(projectId, file);
			await onDone();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not uploaded. Try again.");
			setBusy(false);
		}
	};
	return (
		<form onSubmit={submit} className="space-y-3">
			<p className={`text-sm ${muted}`}>A PDF, or a .txt or .md file, up to 4 MB. SureWord reads its text on the server and keeps the text, not the file.</p>
			<input ref={input} type="file" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }} className="sr-only" id="source-file" />
			<label htmlFor="source-file" className={`${secondaryButton} w-full cursor-pointer`}>
				<Upload size={17} aria-hidden /> {file ? file.name : "Choose a file"}
			</label>
			{file && <p className={`text-sm ${muted}`}>{(file.size / 1024).toFixed(0)} KB</p>}
			<ErrorNote message={error} />
			<div className="flex justify-end"><button type="submit" disabled={busy || !file} className={primaryButton}>{busy ? "Reading the file…" : "Add source"}</button></div>
		</form>
	);
}

function SourceRow({ source, projectId, refresh }: { source: SourceView; projectId: string; refresh: () => Promise<void> }) {
	const Icon = TYPE_ICON[source.type];
	const [renaming, setRenaming] = useState(false);
	const [title, setTitle] = useState(source.title);
	const [error, setError] = useState<string | null>(null);
	const remove = async () => {
		setError(null);
		try {
			await projectsApi.removeItem(projectId, source.id);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not removed. Try again.");
		}
	};
	const rename = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		try {
			await projectsApi.updateItem(projectId, source.id, { title });
			setRenaming(false);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not renamed. Try again.");
		}
	};
	const open = source.type === "note" && source.noteId && !source.missing ? `/notes?note=${encodeURIComponent(source.noteId)}` : source.highlight?.href ?? null;
	return (
		<li className={`${card} p-4 ${source.missing ? "opacity-75" : ""}`}>
			<div className="flex items-start gap-3">
				<span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-sky-500/[.13] text-sky-800 dark:bg-sky-300/[.12] dark:text-sky-200" aria-hidden><Icon size={19} /></span>
				<div className="min-w-0 flex-1">
					{renaming ? (
						<form onSubmit={rename} className="flex gap-2">
							<label className="sr-only" htmlFor={`rename-${source.id}`}>Source name</label>
							<input id={`rename-${source.id}`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={`${field} py-2`} autoFocus />
							<button type="submit" className={secondaryButton}>Save</button>
						</form>
					) : (
						<h3 className="font-bold leading-snug">
							<span className="mr-2 rounded-md bg-black/[.06] px-1.5 py-0.5 text-xs dark:bg-white/[.08]">{source.label}</span>
							{source.title}
						</h3>
					)}
					<p className={`mt-0.5 text-xs font-semibold ${muted}`}>{describe(source)}</p>
					{source.preview && <p className={`mt-1.5 line-clamp-2 text-sm leading-6 ${source.type === "highlight" ? "font-[family-name:var(--font-cormorant)] text-[17px]" : muted}`}>{source.preview}</p>}
					{source.missing && <p className="mt-1.5 text-sm">It is no longer in your {source.type === "note" ? "notes" : "highlights"}. Remove it from the project.</p>}
				</div>
				<div className="flex shrink-0 flex-col items-end">
					{(source.type === "pasted" || source.type === "upload") && !renaming && (
						<button type="button" onClick={() => setRenaming(true)} aria-label={`Rename ${source.title}`} className={iconButton}><Pencil size={16} aria-hidden /></button>
					)}
					<button type="button" onClick={remove} aria-label={`Remove ${source.title}`} className={iconButton}><Trash2 size={16} aria-hidden /></button>
				</div>
			</div>
			{open && <Link href={open} className={`${ghostButton} -ml-3 mt-1`}>{source.type === "note" ? "Open the note" : "Read in context"}</Link>}
			<ErrorNote message={error} />
		</li>
	);
}

export default function SourcesTab({ project, refresh }: TabProps) {
	const [sheet, setSheet] = useState<SheetKind>(null);
	const noteIds = new Set(project.sources.flatMap((source) => (source.noteId ? [source.noteId] : [])));
	const highlightKeys = new Set(project.sources.flatMap((source) => (source.highlight ? [`${source.highlight.translation}:${source.highlight.book}.${source.highlight.chapter}.${source.highlight.verse}`] : [])));
	const book = project.scope.type === "book" ? project.scope.book : null;
	const close = () => setSheet(null);
	const done = async () => {
		await refresh();
		close();
	};
	const actions = [
		["notes", "Your notes", NotebookPen],
		["highlights", "Your highlights", Highlighter],
		["paste", "Paste text", ClipboardPaste],
		["upload", "Upload a file", Upload],
	] as const;
	return (
		<div className="space-y-4">
			<section className={`${card} p-5`} aria-labelledby="add-source">
				<h2 id="add-source" className={`${serifTitle} text-[26px]`}>Add a source</h2>
				<p className={`mt-1 text-sm ${muted}`}>Commentaries, articles and your own notes, kept apart from Scripture and cited by name.</p>
				<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
					{actions.map(([kind, label, Icon]) => (
						<button key={kind} type="button" onClick={() => setSheet(kind)} className={`${secondaryButton} min-h-12 justify-start rounded-2xl px-3`}>
							<Icon size={17} aria-hidden /> {label}
						</button>
					))}
				</div>
			</section>

			{project.sources.length === 0 ? (
				<p className={`px-1 leading-7 ${muted}`}>No sources yet. Add your notes on this study, verses you highlighted, a commentary you trust, or a PDF.</p>
			) : (
				<ul className="space-y-3">{project.sources.map((source) => <SourceRow key={source.id} source={source} projectId={project.id} refresh={refresh} />)}</ul>
			)}

			<Sheet open={sheet === "notes"} onClose={close} title="Add your notes">
				{sheet === "notes" && <NotesPicker projectId={project.id} have={noteIds} onAdded={refresh} />}
			</Sheet>
			<Sheet open={sheet === "highlights"} onClose={close} title="Add your highlights">
				{sheet === "highlights" && <HighlightsPicker projectId={project.id} book={book} have={highlightKeys} onAdded={refresh} />}
			</Sheet>
			<Sheet open={sheet === "paste"} onClose={close} title="Paste a source" wide>
				{sheet === "paste" && <PasteForm projectId={project.id} onDone={done} />}
			</Sheet>
			<Sheet open={sheet === "upload"} onClose={close} title="Upload a source">
				{sheet === "upload" && <UploadForm projectId={project.id} onDone={done} />}
			</Sheet>
		</div>
	);
}
