"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@/lib/beta/growth/growth-rules";
import type { GrowthOverview } from "./growthApi";
import { longDay, weekLabel } from "./growthApi";
import { card, cardTitle, muted, textButton } from "./ui";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * "Build a habit of time with God": the board's M to S row for one week. A
 * kept day is gold; any other day is a quiet outline, never red, never
 * crossed out, never counted against anyone.
 */
export default function WeekCard({
	overview,
	loading,
	onWeek,
}: {
	overview: GrowthOverview;
	loading: boolean;
	onWeek: (weekStart: string) => void;
}) {
	const { week, weekStart, currentWeekStart, earliestWeekStart, today } = overview;
	const isCurrent = weekStart === currentWeekStart;
	const end = week.days[6].day;
	const step = (offset: number) => onWeek(addDays(weekStart, offset));

	return (
		<section aria-labelledby="growth-week-title" className={`${card} px-4 py-5 sm:px-5`} aria-busy={loading}>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h2 id="growth-week-title" className={cardTitle}>
						{isCurrent ? "This week with God" : "A week with God"}
					</h2>
					<p className={`mt-0.5 text-sm ${muted}`}>{weekLabel(weekStart, end)}</p>
				</div>
				<div className="-mr-1 flex shrink-0 items-center">
					<button
						type="button"
						onClick={() => step(-7)}
						disabled={loading || weekStart <= earliestWeekStart}
						aria-label="Previous week"
						className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 disabled:opacity-30 dark:text-neutral-200 dark:hover:bg-white/5"
					>
						<ChevronLeft size={20} aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => step(7)}
						disabled={loading || isCurrent}
						aria-label="Next week"
						className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 disabled:opacity-30 dark:text-neutral-200 dark:hover:bg-white/5"
					>
						<ChevronRight size={20} aria-hidden />
					</button>
				</div>
			</div>

			<ol className="mt-4 grid grid-cols-7 gap-1 sm:gap-2" aria-label={`Days with God, ${weekLabel(weekStart, end)}`}>
				{week.days.map(({ day, kept }, index) => {
					const future = day > today;
					const isToday = day === today;
					const state = kept ? "kept" : future ? "still to come" : isToday ? "today" : "not marked";
					return (
						<li key={day} className="flex flex-col items-center gap-1.5">
							<span className={`text-xs font-bold ${muted}`} aria-hidden>{LETTERS[index]}</span>
							<span
								role="img"
								aria-label={`${longDay(day)}: ${state}`}
								className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold tabular-nums sm:h-10 sm:w-10 ${
									kept
										? "bg-[#e5b664] text-[#1c2118]"
										: isToday
											? "border-2 border-amber-700/50 text-neutral-800 dark:border-[#e5b664]/70 dark:text-[#f1eadc]"
											: future
												? "border border-black/[.07] text-neutral-400 dark:border-white/[.07] dark:text-neutral-600"
												: "border border-black/15 text-neutral-500 dark:border-white/15 dark:text-neutral-400"
								}`}
							>
								{kept ? <Check size={18} strokeWidth={2.6} aria-hidden /> : Number(day.slice(8))}
							</span>
						</li>
					);
				})}
			</ol>

			<div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 border-t border-black/[.06] pt-3 dark:border-white/[.06]">
				<p className={`text-sm ${muted}`}>{week.line}</p>
				{!isCurrent && (
					<button type="button" onClick={() => onWeek(currentWeekStart)} disabled={loading} className={textButton}>
						Back to this week
					</button>
				)}
			</div>
		</section>
	);
}
