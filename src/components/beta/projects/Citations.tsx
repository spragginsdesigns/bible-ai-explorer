"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, FileText } from "lucide-react";
import { quotedRange, type ResolvedCitation } from "@/lib/beta/projects/projects-rules";
import { touchBand } from "./ui";

function key(citation: ResolvedCitation): string {
	return citation.type === "verse" ? `v:${citation.reference}` : `s:${citation.sourceId}:${citation.quote.slice(0, 40)}`;
}

/**
 * The citations behind one claim, as chips; a chip opens the verse in the
 * King James text SureWord carries (never the model's wording) or the exact
 * words of the source it quotes.
 */
export default function Citations({ citations }: { citations: readonly ResolvedCitation[] }) {
	const [open, setOpen] = useState<string | null>(null);
	if (citations.length === 0) return null;
	const shown = citations.find((citation) => key(citation) === open) ?? null;
	return (
		<div className="mt-1.5">
			<div className="flex flex-wrap gap-x-1.5 gap-y-2">
				{citations.map((citation) => {
					const id = key(citation);
					const active = open === id;
					return (
						<button
							key={id}
							type="button"
							aria-expanded={active}
							onClick={() => setOpen(active ? null : id)}
							className={`${touchBand} inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold transition-colors ${
								active ? "border-amber-700/50 bg-amber-500/15 text-amber-950 dark:border-amber-300/40 dark:text-amber-100" : "border-black/10 text-neutral-700 hover:bg-black/[.04] dark:border-white/10 dark:text-[#d9d1c3] dark:hover:bg-white/[.05]"
							}`}
						>
							{citation.type === "verse" ? <BookOpen size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
							{citation.type === "verse" ? citation.reference : `${citation.label} · ${citation.title.length > 28 ? `${citation.title.slice(0, 27)}…` : citation.title}`}
						</button>
					);
				})}
			</div>
			{shown && (
				<div className="mt-2 rounded-2xl border border-black/[.07] bg-white/60 px-4 py-3 dark:border-white/[.07] dark:bg-white/[.03]">
					{shown.type === "verse" ? (
						<>
							<div className="space-y-1.5 font-[family-name:var(--font-cormorant)] text-[19px] leading-[1.45]">
								{shown.verses.map((verse) => (
									<p key={verse.reference}>
										<sup className="mr-1 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verse.reference.split(":").pop()}</sup>
										{verse.text}
									</p>
								))}
							</div>
							<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-[#b3ad9e]">
								<span>{quotedRange(shown.verses) === shown.reference ? shown.reference : `${quotedRange(shown.verses)} of ${shown.reference}`} · KJV</span>
								<Link href={shown.href} className="inline-flex min-h-11 items-center normal-case tracking-normal text-amber-800 hover:underline dark:text-[#e5b664]">Read in context</Link>
							</div>
						</>
					) : (
						<>
							<blockquote className="border-l-2 border-amber-700/40 pl-3 text-[15px] leading-6 dark:border-amber-300/40">{shown.quote}</blockquote>
							<p className="mt-2 text-xs font-bold uppercase tracking-[.14em] text-neutral-600 dark:text-[#b3ad9e]">{shown.label} · {shown.title}</p>
						</>
					)}
				</div>
			)}
		</div>
	);
}
