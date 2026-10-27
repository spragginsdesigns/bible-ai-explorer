"use client";

import { ChevronRight } from "lucide-react";
import { addDays } from "@/lib/beta/growth/growth-rules";
import type { GrowthOverview } from "./growthApi";
import { weekLabel } from "./growthApi";
import { card, cardTitle, muted } from "./ui";

/**
 * A gentle look back at the weeks before this one: only the weeks something
 * was kept, in days, never the ones it was not. No totals, no averages, no
 * comparison between weeks. Any week can still be opened with the arrows.
 */
export default function HistoryCard({
	overview,
	onWeek,
	className = "",
}: {
	overview: GrowthOverview;
	onWeek: (weekStart: string) => void;
	className?: string;
}) {
	const weeks = overview.history.filter((week) => week.keptCount > 0);
	return (
		<section aria-label="Earlier weeks" className={`${card} px-4 py-5 sm:px-5 ${className}`}>
			<h2 className={cardTitle}>Earlier weeks</h2>
			{!weeks.length && <p className={`mt-2 leading-6 ${muted}`}>The weeks you keep with God will gather here.</p>}
			<ul className="mt-2 divide-y divide-black/[.06] dark:divide-white/[.06]">
				{weeks.map((week) => {
					const kept = week.habits.filter((habit) => habit.count > 0);
					const selected = week.weekStart === overview.weekStart;
					return (
						<li key={week.weekStart}>
							<button
								type="button"
								onClick={() => onWeek(week.weekStart)}
								aria-current={selected ? "true" : undefined}
								className="flex min-h-14 w-full items-center gap-3 rounded-xl py-2.5 text-left hover:bg-black/[.03] dark:hover:bg-white/[.03]"
							>
								<span className="min-w-0 flex-1">
									<span className="block font-bold">
										{weekLabel(week.weekStart, addDays(week.weekStart, 6))}
										{selected && <span className={`ml-2 text-xs font-bold uppercase tracking-[.14em] ${muted}`}>Showing</span>}
									</span>
									<span className={`block text-sm leading-5 ${muted}`}>
										{[`${week.keptCount} ${week.keptCount === 1 ? "day" : "days"} with God`, ...kept.map((habit) => `${habit.name} ${habit.count}`)].join(" · ")}
									</span>
								</span>
								<ChevronRight size={18} className="shrink-0 text-neutral-500" aria-hidden />
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
