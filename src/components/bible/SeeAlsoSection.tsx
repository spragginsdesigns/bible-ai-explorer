"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { resolveReference } from "@/lib/bible/books";

/**
 * C1 "See also": the curated cross-references for the verse in the sheet,
 * from GET /api/bible/crossrefs (public, edge-cached). Collapsed to one row;
 * expanding shows the top five with their text in the reader's translation.
 * Hides itself entirely when the verse has no edges or the route is not yet
 * deployed. Mounted inside the verse sheet in ChapterReader.tsx.
 */

interface CrossReferenceRow {
	reference: string;
	text?: string;
}

interface SeeAlsoSectionProps {
	/** "Romans 8:28" — the sheet's verse. */
	reference: string;
	translation: string;
}

/** Link target for a row; ranges ("John 3:16-18") open at their start. */
function chapterHref(reference: string, translation: string): string | null {
	const start = reference.split("-")[0];
	const target = resolveReference(start);
	if (!target) return null;
	return `/bible/chapter?book=${target.order}&chapter=${target.chapter}&translation=${encodeURIComponent(translation)}`;
}

const SeeAlsoSection: React.FC<SeeAlsoSectionProps> = ({ reference, translation }) => {
	const [rows, setRows] = useState<CrossReferenceRow[] | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		setRows(null);
		setOpen(false);
		let cancelled = false;
		const params = new URLSearchParams({ reference, translation });
		fetch(`/api/bible/crossrefs?${params.toString()}`)
			.then((res) => (res.ok ? res.json() : null))
			.then((data: { crossReferences?: CrossReferenceRow[] } | null) => {
				if (cancelled) return;
				const list = data?.crossReferences ?? [];
				setRows(list.length > 0 ? list : null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [reference, translation]);

	if (!rows) return null;

	return (
		<div className="mb-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2.5">
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 text-left"
			>
				<span className="w-3 text-xs text-neutral-400 dark:text-neutral-600">
					{open ? "▾" : "▸"}
				</span>
				<span className="flex-1 text-metadata font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
					See also
				</span>
				<span className="text-xs tabular-nums text-neutral-400/70 dark:text-neutral-600">
					{rows.length}
				</span>
			</button>
			{open && (
				<div className="flex flex-col gap-2.5 pt-2.5">
					{rows.map((row) => {
						const href = chapterHref(row.reference, translation);
						const label = (
							<span className="text-[13.5px] font-semibold text-amber-600 dark:text-amber-400">
								{row.reference}
							</span>
						);
						return (
							<div key={row.reference}>
								{href ? <Link href={href}>{label}</Link> : label}
								{row.text && (
									<p className="line-clamp-3 pt-0.5 font-[family-name:var(--font-cormorant)] text-[15px] leading-[21px] text-neutral-700 dark:text-neutral-300">
										{row.text}
									</p>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

export default SeeAlsoSection;
