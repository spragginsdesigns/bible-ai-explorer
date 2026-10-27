"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { BOOKS, bookByOrder } from "@/lib/bible/books";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { parsePassageInput } from "@/lib/beta/tutor/passage";
import { checkPassageRange, formatPassageReference } from "@/lib/beta/tutor/tutor-rules";

/** Passages worth a first close reading; the three the module was proven on come first. */
export const TUTOR_SUGGESTIONS = ["Romans 5:1-11", "John 3:1-21", "James 2:14-26", "Psalm 23", "Ephesians 2:1-10", "Genesis 22:1-14"];

interface ChapterText {
	book: number;
	chapter: number;
	verses: string[];
}

export interface PickedPassage {
	reference: string;
	valid: boolean;
}

/**
 * Choosing a passage for a close reading: type it, tap a suggestion, or
 * browse to a chapter and tap its first and last verse. The chapter shown is
 * the bundled KJV from the public chapter API the reader uses.
 */
export default function TutorPicker({
	initial,
	onChange,
	disabled,
}: {
	initial: string;
	onChange: (picked: PickedPassage) => void;
	disabled?: boolean;
}) {
	const [text, setText] = useState(initial);
	const [chapterText, setChapterText] = useState<ChapterText | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const parsed = useMemo(() => parsePassageInput(text), [text]);
	const located = "error" in parsed ? null : parsed;
	const [browse, setBrowse] = useState<{ book: number; chapter: number }>(() => (located ? { book: located.book, chapter: located.chapter } : { book: 45, chapter: 5 }));
	const request = useRef(0);

	// Follow a typed passage to its chapter.
	useEffect(() => {
		if (located && (located.book !== browse.book || located.chapter !== browse.chapter)) setBrowse({ book: located.book, chapter: located.chapter });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [located?.book, located?.chapter]);

	useEffect(() => {
		const id = ++request.current;
		setLoading(true);
		setLoadError(null);
		const timer = window.setTimeout(async () => {
			try {
				const response = await fetch(`/api/bible/chapter?translation=KJV&book=${browse.book}&chapter=${browse.chapter}`);
				if (!response.ok) throw new Error("chapter");
				const data = (await response.json()) as { verses: { text: string }[] };
				if (id !== request.current) return;
				setChapterText({ book: browse.book, chapter: browse.chapter, verses: data.verses.map((verse) => bibleVersePlainText(verse.text)) });
			} catch {
				if (id === request.current) setLoadError("This chapter could not be loaded. Check your connection.");
			} finally {
				if (id === request.current) setLoading(false);
			}
		}, 200);
		return () => window.clearTimeout(timer);
	}, [browse.book, browse.chapter]);

	const shown = chapterText && chapterText.book === browse.book && chapterText.chapter === browse.chapter ? chapterText : null;
	const sameChapter = located && shown && located.book === shown.book && located.chapter === shown.chapter;
	const range = sameChapter ? checkPassageRange(located.start, located.end, shown.verses.length) : null;
	const selection = range?.ok ? range.value : null;
	const error = "error" in parsed ? (text.trim() ? parsed.error : null) : range && !range.ok ? range.error : null;
	const reference = located && selection ? formatPassageReference(located.bookName, located.chapter, selection.start, selection.end) : null;

	useEffect(() => {
		onChange({ reference: reference ?? text.trim(), valid: Boolean(reference) });
	}, [reference, text, onChange]);

	const meta = bookByOrder(browse.book);

	function choose(value: string) {
		setText(value);
	}

	/** First tap picks one verse; a second tap extends the passage to it. */
	function tapVerse(verse: number) {
		if (!meta) return;
		if (selection && sameChapter && selection.start === selection.end && verse !== selection.start) {
			const start = Math.min(selection.start, verse);
			const end = Math.max(selection.start, verse);
			choose(formatPassageReference(meta.name, browse.chapter, start, end));
			return;
		}
		choose(formatPassageReference(meta.name, browse.chapter, verse, verse));
	}

	function browseTo(book: number, chapter: number) {
		const target = bookByOrder(book);
		if (!target) return;
		const safeChapter = Math.min(Math.max(chapter, 1), target.chapters);
		setBrowse({ book, chapter: safeChapter });
		choose(`${target.name} ${safeChapter}`);
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<label htmlFor="tutor-passage" className="text-sm font-bold">
					Passage
				</label>
				<input
					id="tutor-passage"
					value={text}
					onChange={(event) => setText(event.target.value)}
					disabled={disabled}
					autoComplete="off"
					spellCheck={false}
					maxLength={80}
					placeholder="Romans 5:1-11"
					aria-invalid={Boolean(error)}
					aria-describedby="tutor-passage-help"
					className="mt-1.5 min-h-12 w-full rounded-2xl border border-black/10 bg-white/80 px-4 text-[17px] outline-none placeholder:text-neutral-500 focus:border-amber-700/50 disabled:opacity-60 dark:border-white/10 dark:bg-white/[.04] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/50"
				/>
				<p id="tutor-passage-help" className={`mt-1.5 min-h-5 text-sm ${error ? "text-rose-700 dark:text-rose-300" : "text-neutral-600 dark:text-[#bbb3a7]"}`} aria-live="polite">
					{error ?? (reference ? `${reference} · ${selection ? selection.end - selection.start + 1 : 0} ${selection && selection.end === selection.start ? "verse" : "verses"} · KJV` : "Type a passage, tap one below, or browse a chapter.")}
				</p>
			</div>

			<div className="flex flex-wrap gap-2" role="group" aria-label="Suggested passages">
				{TUTOR_SUGGESTIONS.map((suggestion) => (
					<button
						key={suggestion}
						type="button"
						disabled={disabled}
						onClick={() => choose(suggestion)}
						aria-pressed={text.trim() === suggestion}
						className={`min-h-11 rounded-full border px-3.5 text-sm font-bold transition-colors disabled:opacity-60 ${
							text.trim() === suggestion
								? "border-transparent bg-[#24281f] text-white dark:bg-[#e5b664] dark:text-[#1c2118]"
								: "border-black/10 hover:bg-black/[.04] dark:border-white/10 dark:hover:bg-white/[.05]"
						}`}
					>
						{suggestion}
					</button>
				))}
			</div>

			<div className="rounded-[22px] border border-black/[.09] bg-white/35 dark:border-white/[.09] dark:bg-white/[.025]">
				<div className="flex flex-wrap items-center gap-2 border-b border-black/[.07] p-3 dark:border-white/[.07]">
					<BookOpen size={18} className="ml-1 text-amber-800 dark:text-[#e5b664]" aria-hidden />
					<label htmlFor="tutor-book" className="sr-only">
						Book
					</label>
					<select
						id="tutor-book"
						value={browse.book}
						disabled={disabled}
						onChange={(event) => browseTo(Number(event.target.value), 1)}
						className="min-h-11 min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-2 text-base dark:border-white/10 dark:bg-[#151915]"
					>
						<optgroup label="Old Testament">
							{BOOKS.filter((book) => book.testament === "OT").map((book) => (
								<option key={book.order} value={book.order}>
									{book.name}
								</option>
							))}
						</optgroup>
						<optgroup label="New Testament">
							{BOOKS.filter((book) => book.testament === "NT").map((book) => (
								<option key={book.order} value={book.order}>
									{book.name}
								</option>
							))}
						</optgroup>
					</select>
					<label htmlFor="tutor-chapter" className="sr-only">
						Chapter
					</label>
					<select
						id="tutor-chapter"
						value={browse.chapter}
						disabled={disabled}
						onChange={(event) => browseTo(browse.book, Number(event.target.value))}
						className="min-h-11 w-24 rounded-xl border border-black/10 bg-white/80 px-2 text-base dark:border-white/10 dark:bg-[#151915]"
					>
						{Array.from({ length: meta?.chapters ?? 1 }, (_, index) => (
							<option key={index + 1} value={index + 1}>
								{index + 1}
							</option>
						))}
					</select>
				</div>
				<p className="px-4 pt-3 text-xs font-bold uppercase tracking-[.16em] text-neutral-600 dark:text-[#b3ad9e]">
					{meta?.name} {browse.chapter} · tap the first and last verse
				</p>
				<div className="max-h-[340px] overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
					{loading && !shown ? (
						<p className="flex items-center gap-2 px-2 py-6 text-sm text-neutral-600 dark:text-[#bbb3a7]">
							<Loader2 size={16} className="animate-spin" aria-hidden /> Opening the chapter
						</p>
					) : loadError && !shown ? (
						<p className="px-2 py-6 text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
					) : (
						<ol className="flex flex-col">
							{shown?.verses.map((verse, index) => {
								const number = index + 1;
								const selected = Boolean(selection && number >= selection.start && number <= selection.end);
								// One continuous band for a range: only its ends are rounded.
								const shape = !selected || !selection ? "rounded-xl" : `${number === selection.start ? "rounded-t-xl" : ""} ${number === selection.end ? "rounded-b-xl" : ""}`;
								return (
									<li key={number}>
										<button
											type="button"
											disabled={disabled}
											onClick={() => tapVerse(number)}
											aria-pressed={selected}
											className={`flex min-h-11 w-full gap-2.5 ${shape} px-2.5 py-2 text-left font-[family-name:var(--font-cormorant)] text-[18px] leading-snug transition-colors ${
												selected ? "bg-amber-500/[.16] dark:bg-amber-300/[.12]" : "hover:bg-black/[.035] dark:hover:bg-white/[.04]"
											}`}
										>
											<span className={`mt-0.5 w-6 shrink-0 text-right font-sans text-xs font-bold ${selected ? "text-amber-800 dark:text-[#e5b664]" : "text-neutral-500 dark:text-neutral-400"}`}>{number}</span>
											<span>{verse}</span>
										</button>
									</li>
								);
							})}
						</ol>
					)}
				</div>
			</div>
		</div>
	);
}
