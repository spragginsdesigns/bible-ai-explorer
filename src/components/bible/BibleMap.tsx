"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { BOOKS } from "@/lib/bible/books";
import {
	defaultTestament,
	readerHref,
	testamentProgress,
	type BookCoverage,
	type BookProgress,
} from "./readingOverview";

/**
 * The whole Bible at a glance: every book of a testament with how many of its
 * chapters have been read whole, and a chapter grid for the selected book.
 * Gold squares are chapters read in one sitting; outlined ones were started.
 * Mirrors mobile/src/features/reading/BibleMap.tsx.
 */
export default function BibleMap({ coverage }: { coverage: BookCoverage[] }) {
	const preferred = useMemo(() => defaultTestament(BOOKS, coverage), [coverage]);
	const [testament, setTestament] = useState<"OT" | "NT" | null>(null);
	const shown = testament ?? preferred;
	const books = useMemo(() => testamentProgress(BOOKS, coverage, shown), [coverage, shown]);
	const [selected, setSelected] = useState<number | null>(null);
	const open = books.find((book) => book.order === selected) ?? null;

	return (
		<section aria-labelledby="bible-map-heading" className="glass-card flex flex-col gap-4 rounded-2xl p-4 lg:p-5">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 id="bible-map-heading" className="text-section-title font-bold text-neutral-900 dark:text-neutral-100">
					Your Bible
				</h2>
				<div
					role="tablist"
					aria-label="Testament"
					className="flex rounded-full border border-black/[0.08] bg-black/[0.03] p-[3px] dark:border-white/[0.08] dark:bg-white/[0.03]"
				>
					{(["OT", "NT"] as const).map((key) => (
						<button
							key={key}
							type="button"
							role="tab"
							aria-selected={shown === key}
							onClick={() => {
								setTestament(key);
								setSelected(null);
							}}
							className={`flex-1 whitespace-nowrap rounded-full px-4 py-2 text-metadata font-semibold transition-colors ${
								shown === key
									? "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400"
									: "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
							}`}
						>
							{key === "OT" ? "Old Testament" : "New Testament"}
						</button>
					))}
				</div>
			</div>
			{!open ? (
				<p className="text-metadata text-neutral-400 dark:text-neutral-500">
					Select a book to see its chapters.
				</p>
			) : null}
			{/* The chapter panel follows its tile at full width; dense flow backfills
			    the rest of that row, so the panel opens under the selected book's row
			    at every column count instead of below the whole testament. */}
			<div className="grid grid-flow-row-dense grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
				{books.map((book) => (
					<Fragment key={book.order}>
						<BookTile
							book={book}
							selected={book.order === selected}
							onSelect={() => setSelected(book.order === selected ? null : book.order)}
						/>
						{open?.order === book.order ? (
							<div className="col-span-full flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-white/50 p-3 dark:border-white/[0.08] dark:bg-white/[0.03] lg:p-4">
								<p className="text-control font-semibold text-neutral-900 dark:text-neutral-100">
									{open.name} · {open.complete.size} of {open.chapters}{" "}
									{open.chapters === 1 ? "chapter" : "chapters"} read
								</p>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
									{Array.from({ length: open.chapters }, (_, i) => i + 1).map((chapter) => {
										const done = open.complete.has(chapter);
										const started = !done && open.started.has(chapter);
										return (
											<Link
												key={chapter}
												href={readerHref({ book: open.order, chapter, verse: 1 })}
												aria-label={`${open.name} ${chapter}, ${done ? "read" : started ? "started" : "not read yet"}`}
												className={`flex aspect-square items-center justify-center rounded-md border text-metadata font-semibold tabular-nums transition-colors ${
													done
														? "border-amber-500 bg-amber-500 text-neutral-950 hover:bg-amber-400 dark:border-amber-400 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
														: started
															? "border-[1.5px] border-amber-500 bg-amber-500/10 text-neutral-700 hover:bg-amber-500/20 dark:border-amber-400 dark:bg-amber-400/10 dark:text-neutral-300 dark:hover:bg-amber-400/20"
															: "border-black/[0.08] bg-black/[0.03] text-neutral-500 hover:bg-black/[0.06] dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-neutral-400 dark:hover:bg-white/[0.08]"
												}`}
											>
												{chapter}
											</Link>
										);
									})}
								</div>
							</div>
						) : null}
					</Fragment>
				))}
			</div>
		</section>
	);
}

function BookTile({
	book,
	selected,
	onSelect,
}: {
	book: BookProgress;
	selected: boolean;
	onSelect: () => void;
}) {
	const touched = book.complete.size + book.started.size > 0;
	const share = book.complete.size / book.chapters;
	return (
		<button
			type="button"
			aria-expanded={selected}
			aria-label={`${book.name}, ${book.complete.size} of ${book.chapters} chapters read`}
			onClick={onSelect}
			className={`flex min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06] ${
				selected
					? "border-amber-500 bg-amber-500/10 dark:border-amber-400 dark:bg-amber-400/10"
					: `border-black/[0.08] bg-black/[0.02] dark:border-white/[0.08] dark:bg-white/[0.03] ${touched ? "" : "opacity-55"}`
			}`}
		>
			<span
				className={`truncate text-metadata font-semibold ${
					touched ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
				}`}
			>
				{book.name}
			</span>
			<span className="text-metadata tabular-nums text-neutral-400 dark:text-neutral-500">
				{book.complete.size}/{book.chapters}
			</span>
			<span className="mt-0.5 block h-[3px] overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.08]">
				<span
					className="block h-[3px] bg-amber-500 dark:bg-amber-400"
					style={{ width: `${Math.round(share * 100)}%` }}
				/>
			</span>
		</button>
	);
}
