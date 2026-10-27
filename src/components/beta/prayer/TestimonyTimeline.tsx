"use client";

import type { TimelineMonth } from "@/lib/beta/prayer/prayer-rules";
import { card, cardTitle, eyebrow, muted } from "../growth/ui";
import { dayLabel } from "./prayerApi";

const LABEL = { asked: "Began praying", update: "Update", answered: "God answered", closed: "Laid down" } as const;

/**
 * The testimony timeline: what was prayed, what happened and the reflection,
 * oldest first and grouped by month. It tells the story in the founder's own
 * words and never counts, scores or judges.
 */
export default function TestimonyTimeline({ months, onOpen }: { months: readonly TimelineMonth[]; onOpen: (memoryId: string) => void }) {
	return (
		<section className={`${card} min-w-0 px-5 py-5`} aria-labelledby="testimony-title">
			<p className={eyebrow}>Your testimony</p>
			<h2 id="testimony-title" className={`${cardTitle} mt-1`}>Timeline</h2>
			{months.length === 0 ? (
				<p className={`mt-4 leading-7 ${muted}`}>As you pray, add updates and record what God did, your story gathers here, month by month.</p>
			) : (
				<ol className="mt-4 space-y-6">
					{months.map((month) => (
						<li key={month.month}>
							<h3 className="font-[family-name:var(--font-cormorant)] text-[22px] font-semibold leading-tight">{month.label}</h3>
							<ol className="mt-2 space-y-3 border-l-2 border-black/[.08] pl-4 dark:border-white/[.1]">
								{month.events.map((event, index) => {
									const label = event.kind === "outcome" ? LABEL[event.outcomeKind ?? "answered"] : LABEL[event.kind];
									return (
										<li key={`${event.memoryId}-${event.kind}-${event.at}-${index}`} className="relative">
											<span aria-hidden className={`absolute -left-[23px] top-2 h-3 w-3 rounded-full ${event.kind === "outcome" ? "bg-[#e5b664]" : "border-2 border-black/25 bg-[#f6f2e9] dark:border-white/30 dark:bg-[#0d100d]"}`} />
											<p className={`text-xs font-bold uppercase tracking-[.14em] ${muted}`}>
												{label} · {dayLabel(event.day)}
											</p>
											<button type="button" onClick={() => onOpen(event.memoryId)} className={`mt-0.5 block min-h-11 w-full text-left leading-7 [overflow-wrap:anywhere] hover:underline ${event.kind === "asked" ? "font-semibold" : `text-sm ${muted}`}`}>
												{event.request}
											</button>
											{event.kind === "asked" && event.passages.length > 0 && <p className={`text-sm ${muted}`}>Standing on {event.passages.join(", ")}</p>}
											{event.text && <p className="whitespace-pre-line leading-7 [overflow-wrap:anywhere]">{event.text}</p>}
											{event.reflection && (
												<p className={`mt-1.5 whitespace-pre-line border-l-2 border-[#e5b664] pl-3 italic leading-7 [overflow-wrap:anywhere] ${muted}`}>{event.reflection}</p>
											)}
										</li>
									);
								})}
							</ol>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
