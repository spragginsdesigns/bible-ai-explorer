"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { BOOKS } from "@/lib/bible/books";
import { passageLabel } from "@/lib/beta/projects/projects-rules";
import { projectHref, projectsApi, readHref } from "./api";
import { ErrorNote, card, eyebrow, field, muted, primaryButton, secondaryButton, serifTitle } from "./ui";

export interface ReaderProps {
	projectId: string;
	projectTitle: string;
	section: { id: string; title: string; done: boolean } | null;
	next: { id: string; title: string } | null;
	chapter: { book: number; bookName: string; chapter: number; chapters: number; verses: string[] } | null;
	/** Passages of this chapter already in the project. */
	gathered: { start: number; end: number; reference: string }[];
	prevHref: string | null;
	nextHref: string | null;
}

function ChapterPicker({ projectId, sectionId, initialBook }: { projectId: string; sectionId: string | null; initialBook: number }) {
	const router = useRouter();
	const [book, setBook] = useState(initialBook);
	const [chapter, setChapter] = useState(1);
	const meta = BOOKS.find((entry) => entry.order === book);
	const open = () => router.push(readHref(projectId, { book, chapter, section: sectionId ?? undefined }));
	return (
		<div className={`${card} p-5`}>
			<h2 className={`${serifTitle} text-[24px]`}>Open a chapter</h2>
			<div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
				<label>
					<span className="sr-only">Book</span>
					<select value={book} onChange={(event) => { setBook(Number(event.target.value)); setChapter(1); }} className={`${field} min-h-12`}>
						{BOOKS.map((entry) => <option key={entry.order} value={entry.order}>{entry.name}</option>)}
					</select>
				</label>
				<label>
					<span className="sr-only">Chapter</span>
					<select value={chapter} onChange={(event) => setChapter(Number(event.target.value))} className={`${field} min-h-12`}>
						{Array.from({ length: meta?.chapters ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
					</select>
				</label>
			</div>
			<button type="button" onClick={open} className={`${primaryButton} mt-3`}>Open {meta?.name} {chapter}</button>
		</div>
	);
}

export default function ProjectReader(props: ReaderProps) {
	const { projectId, projectTitle, section, next, chapter, gathered, prevHref, nextHref } = props;
	const router = useRouter();
	const [anchor, setAnchor] = useState<number | null>(null);
	const [range, setRange] = useState<[number, number] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [done, setDone] = useState(section?.done ?? false);
	const [picking, setPicking] = useState(false);

	const inProject = useMemo(() => {
		const verses = new Set<number>();
		for (const passage of gathered) for (let verse = passage.start; verse <= passage.end; verse++) verses.add(verse);
		return verses;
	}, [gathered]);

	const tap = (verse: number) => {
		setNotice(null);
		if (anchor === null || range === null) {
			setAnchor(verse);
			setRange([verse, verse]);
			return;
		}
		if (range[0] === range[1] && range[0] === verse) {
			setAnchor(null);
			setRange(null);
			return;
		}
		setRange([Math.min(anchor, verse), Math.max(anchor, verse)]);
	};
	const clear = () => {
		setAnchor(null);
		setRange(null);
	};
	const selection = chapter && range ? passageLabel(chapter.bookName, chapter.chapter, range[0], range[1]) : null;

	const add = async (reference: string) => {
		setBusy(true);
		setError(null);
		try {
			const result = await projectsApi.add(projectId, { kind: "passage", reference, origin: section ? "section" : "reader" });
			setNotice(result.duplicate ? `${reference} is already in ${projectTitle}.` : `Added ${reference} to ${projectTitle}.`);
			clear();
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not added. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const markDone = async (value: boolean, thenNext: boolean) => {
		if (!section) return;
		setBusy(true);
		setError(null);
		try {
			await projectsApi.update(projectId, { section: { op: "done", id: section.id, done: value } });
			setDone(value);
			if (thenNext && next) router.push(readHref(projectId, { section: next.id }));
			else if (thenNext) router.push(projectHref(projectId));
			else router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Not saved. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<main className="mx-auto w-full max-w-3xl px-5 pb-[calc(var(--sureword-mobile-tab-clearance)+120px)] pt-4 lg:px-8 lg:pb-32 lg:pt-8">
			<Link href={projectHref(projectId)} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-neutral-600 hover:bg-black/5 dark:text-[#bbb3a7] dark:hover:bg-white/5">
				<ArrowLeft size={18} aria-hidden /> {projectTitle}
			</Link>

			<header className="mt-2">
				{section && <p className={eyebrow}>{section.title !== (chapter ? `${chapter.bookName} ${chapter.chapter}` : "") ? section.title : "Section"}{done ? " · Done" : ""}</p>}
				<div className="mt-1 flex items-center justify-between gap-2">
					<h1 className={`${serifTitle} text-[clamp(2.2rem,8vw,3rem)]`}>{chapter ? `${chapter.bookName} ${chapter.chapter}` : section?.title ?? "Open a chapter"}</h1>
					{chapter && (
						<div className="flex shrink-0 gap-1">
							{prevHref ? <Link href={prevHref} aria-label="Previous chapter" className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 dark:border-white/10"><ChevronLeft size={20} aria-hidden /></Link> : null}
							{nextHref ? <Link href={nextHref} aria-label="Next chapter" className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 dark:border-white/10"><ChevronRight size={20} aria-hidden /></Link> : null}
						</div>
					)}
				</div>
				{chapter && <p className={`mt-1 text-sm ${muted}`}>King James Version. Tap a verse, then another, to choose a passage for {projectTitle}.</p>}
			</header>

			{(!chapter || picking) && <div className="mt-5"><ChapterPicker projectId={projectId} sectionId={section?.id ?? null} initialBook={chapter?.book ?? 44} /></div>}

			{chapter && (
				<>
					<ol className="mt-5 space-y-0.5 font-[family-name:var(--font-cormorant)] text-[21px] leading-[1.55]">
						{chapter.verses.map((text, index) => {
							const verse = index + 1;
							const selected = range !== null && verse >= range[0] && verse <= range[1];
							const kept = inProject.has(verse);
							return (
								<li key={verse}>
									<button
										type="button"
										onClick={() => tap(verse)}
										aria-pressed={selected}
										aria-label={`Verse ${verse}${kept ? ", in this project" : ""}`}
										className={`-mx-2 w-[calc(100%+16px)] rounded-xl px-2 py-1 text-left transition-colors ${selected ? "bg-[#e5b664]/30 dark:bg-[#e5b664]/20" : "hover:bg-black/[.03] dark:hover:bg-white/[.03]"} ${kept && !selected ? "border-l-2 border-amber-700/50 dark:border-amber-300/50" : "border-l-2 border-transparent"}`}
									>
										<sup className="mr-1.5 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse}</sup>
										{text}
									</button>
								</li>
							);
						})}
					</ol>
					{gathered.length > 0 && <p className={`mt-3 text-sm ${muted}`}>Marked in the margin: {gathered.map((passage) => passage.reference).join(", ")}, already in this project.</p>}
					<button type="button" onClick={() => setPicking((value) => !value)} className={`${secondaryButton} mt-4`}>{picking ? "Close" : "Open another chapter"}</button>
				</>
			)}

			{(chapter || section) && (
				<div className="fixed inset-x-0 bottom-[var(--sureword-mobile-tab-clearance)] z-30 border-t border-black/10 bg-[#f6f2e9] px-4 py-3 dark:border-white/10 dark:bg-[#121611] lg:bottom-0 lg:pl-[264px]">
					<div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
						{selection ? (
							<>
								<button type="button" onClick={() => add(selection)} disabled={busy} className={primaryButton}><Plus size={17} aria-hidden /> Add {selection}</button>
								<button type="button" onClick={clear} aria-label="Clear selection" className={secondaryButton}><X size={16} aria-hidden /> Clear</button>
							</>
						) : (
							<>
								{chapter && (
									<button type="button" onClick={() => add(`${chapter.bookName} ${chapter.chapter}`)} disabled={busy} className={secondaryButton}><Plus size={17} aria-hidden /> Add the chapter</button>
								)}
								{section && (
									done ? (
										<div className="flex flex-wrap gap-2">
											<button type="button" onClick={() => markDone(false, false)} disabled={busy} className={secondaryButton}><Check size={16} aria-hidden /> Done</button>
											{next && <Link href={readHref(projectId, { section: next.id })} className={primaryButton}>Next: {next.title} <ArrowRight size={16} aria-hidden /></Link>}
										</div>
									) : (
										<button type="button" onClick={() => markDone(true, true)} disabled={busy} className={primaryButton}>
											<Check size={17} aria-hidden /> {next ? `Done, on to ${next.title}` : "Done"}
										</button>
									)
								)}
							</>
						)}
					</div>
					{(notice || error) && (
						<div className="mx-auto mt-2 max-w-3xl">
							{notice && <p role="status" className="text-sm font-semibold">{notice}</p>}
							<ErrorNote message={error} />
						</div>
					)}
				</div>
			)}
		</main>
	);
}
