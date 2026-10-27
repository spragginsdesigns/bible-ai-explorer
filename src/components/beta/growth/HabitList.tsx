"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Brain, Check, ChevronDown, HandHeart, Sparkles, Sprout, type LucideIcon } from "lucide-react";
import type { HabitSource, HabitType } from "@/lib/beta/growth/growth-rules";
import { DESTINATION_TILE, IconTile } from "../visuals";
import type { GrowthOverview } from "./growthApi";
import { growthApi, longDay, reminderLabel } from "./growthApi";
import HabitEditor from "./HabitEditor";
import { ProgressRing, card, cardTitle, goldButton, muted, quietButton, textButton } from "./ui";

export const HABIT_ICONS: Record<HabitType, LucideIcon> = {
	reading: BookOpen,
	prayer: HandHeart,
	memory: Brain,
	study: Sparkles,
	custom: Sprout,
};

const SOURCE_LINE: Record<HabitSource, string> = {
	"reading-log": "Counted from your reading log",
	learn: "Counted from Learn a verse",
	"beta-studies": "Counted from your Beta studies",
	"by-hand-or-journal": "Marked by you, or kept by writing a reflection",
	"by-hand": "Marked by you",
};

/** Where to go to keep a habit SureWord counts on its own. */
const SOURCE_LINK: Partial<Record<HabitSource, { href: string; label: string; detail: string }>> = {
	"reading-log": { href: "/bible", label: "Open the Bible", detail: "A day counts when you read in SureWord's Bible, even part of a chapter." },
	learn: { href: "/bible/learn", label: "Learn a verse", detail: "A day counts when you review a verse in Learn a verse." },
	"beta-studies": { href: "/beta/study", label: "Go to Study", detail: "A day counts when you add to or change a study in SureWord Beta." },
};

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export type HabitView = GrowthOverview["habits"][number];

export default function HabitList({
	overview,
	busy,
	onSetDay,
	onChanged,
}: {
	overview: GrowthOverview;
	busy: boolean;
	onSetDay: (habit: HabitView, day: string, done: boolean) => void;
	onChanged: () => Promise<void>;
}) {
	const [open, setOpen] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const { habits, today, weekStart, currentWeekStart, earliestWeekStart } = overview;
	const isCurrent = weekStart === currentWeekStart;
	const days = overview.week.days.map((entry) => entry.day);

	return (
		<section aria-labelledby="growth-habits-title" className={`${card} px-4 py-5 sm:px-5`}>
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="growth-habits-title" className={cardTitle}>Your habits</h2>
				{habits.length > 0 && <p className={`text-sm ${muted}`}>{isCurrent ? "This week" : "That week"}</p>}
			</div>

			{habits.length > 0 && (
				<ul className="mt-3 divide-y divide-black/[.06] dark:divide-white/[.06]">
					{habits.map((habit) => {
						const expanded = open === habit.id;
						const link = SOURCE_LINK[habit.source];
						const countLine = `${habit.count} of ${habit.target} ${habit.target === 1 ? "day" : "days"}`;
						return (
							<li key={habit.id} className="py-3">
								<div className="flex items-center gap-3">
									<button
										type="button"
										onClick={() => setOpen(expanded ? null : habit.id)}
										aria-expanded={expanded}
										aria-controls={`habit-days-${habit.id}`}
										className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
									>
										<IconTile Icon={HABIT_ICONS[habit.type]} tone={DESTINATION_TILE.learn} />
										<span className="min-w-0 flex-1">
											<span className="flex items-center gap-1.5 font-bold leading-snug">
												<span className="truncate">{habit.name}</span>
												<ChevronDown size={16} className={`shrink-0 text-neutral-500 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
											</span>
											<span className={`block text-sm leading-5 ${muted}`}>
												{countLine}
												{habit.reminder ? ` · ${reminderLabel(habit.reminder)}` : ""}
											</span>
										</span>
									</button>
									<ProgressRing count={habit.count} target={habit.target} label={`${habit.name}: ${countLine} ${isCurrent ? "this week" : "that week"}`} />
								</div>
								{habit.manual && isCurrent && (
									<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-14">
										<button
											type="button"
											onClick={() => onSetDay(habit, today, !habit.markedToday)}
											disabled={busy}
											aria-pressed={habit.markedToday}
											className={habit.markedToday ? `${goldButton} px-4` : `${quietButton} px-4`}
										>
											{habit.markedToday && <Check size={16} strokeWidth={2.6} aria-hidden />}
											{habit.markedToday ? "Kept today" : "Mark today"}
										</button>
										{habit.keptToday && !habit.markedToday && <span className={`text-sm ${muted}`}>Kept today by your reflection</span>}
									</div>
								)}

								{expanded && (
									<div id={`habit-days-${habit.id}`} className="mt-3 sm:pl-14">
										<p className={`text-sm ${muted}`}>{SOURCE_LINE[habit.source]}.</p>
										<ol className="-mx-1.5 mt-2.5 grid max-w-[340px] grid-cols-7 sm:mx-0">
											{days.map((day, index) => {
												const kept = habit.week[index];
												const marked = habit.marked[index];
												const future = day > today;
												if (!habit.manual) {
													return (
														<li key={day} className="flex flex-col items-center gap-1">
															<span className={`text-xs font-bold ${muted}`} aria-hidden>{LETTERS[index]}</span>
															<span
																role="img"
																aria-label={`${longDay(day)}: ${kept ? "counted" : future ? "still to come" : "nothing counted"}`}
																className={`h-3 w-3 rounded-full ${kept ? "bg-[#e5b664]" : "border border-black/20 dark:border-white/20"}`}
															/>
														</li>
													);
												}
												const locked = future || day < earliestWeekStart;
												return (
													<li key={day} className="flex flex-col items-center gap-1">
														<span className={`text-xs font-bold ${muted}`} aria-hidden>{LETTERS[index]}</span>
														<button
															type="button"
															disabled={busy || locked}
															onClick={() => onSetDay(habit, day, !marked)}
															aria-pressed={marked}
															aria-label={`${longDay(day)}: ${marked ? "kept, tap to clear" : kept ? "kept by a reflection, tap to mark it too" : future ? "still to come" : "tap to mark kept"}`}
															className={`flex h-11 w-11 items-center justify-center rounded-full ${
																kept
																	? "bg-[#e5b664] text-[#1c2118]"
																	: "border border-black/15 text-neutral-500 hover:bg-black/[.04] disabled:opacity-35 dark:border-white/15 dark:text-neutral-400 dark:hover:bg-white/[.05]"
															}`}
														>
															{kept ? <Check size={17} strokeWidth={2.6} aria-hidden /> : <span className="text-xs tabular-nums">{Number(day.slice(8))}</span>}
														</button>
													</li>
												);
											})}
										</ol>
										{link && (
											<>
												<p className={`mt-2.5 text-sm ${muted}`}>{link.detail}</p>
												<Link href={link.href} className={`${textButton} -ml-2`}>
													{link.label}
												</Link>
											</>
										)}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{habits.length === 0 && !editing && <StarterPanel busy={busy} onChanged={onChanged} onChoose={() => setEditing(true)} />}

			{editing ? (
				<HabitEditor habits={habits} onChanged={onChanged} onClose={() => setEditing(false)} />
			) : (
				habits.length > 0 && (
					<button type="button" onClick={() => setEditing(true)} className={`${textButton} mt-1`}>
						Add or change habits
					</button>
				)
			)}
		</section>
	);
}

/** A first visit: offer the board's three, or let them choose their own. */
function StarterPanel({ busy, onChanged, onChoose }: { busy: boolean; onChanged: () => Promise<void>; onChoose: () => void }) {
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const start = async () => {
		setSaving(true);
		setError(null);
		try {
			await growthApi.addStarterHabits();
			await onChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="mt-3">
			<p className="leading-7">
				Choose the habits you want to keep with God this week. SureWord counts the ones it can see, like your Bible reading and the verses you
				review, so you never have to log them twice. The rest you mark yourself.
			</p>
			<p className={`mt-2 text-sm ${muted}`}>There are no streaks and no scores here. A day you miss is just a day.</p>
			{error && <p role="alert" className="mt-3 text-sm font-bold text-amber-900 dark:text-amber-200">{error}</p>}
			<div className="mt-4 flex flex-wrap gap-2">
				<button type="button" onClick={start} disabled={busy || saving} className={goldButton}>
					{saving ? "Adding…" : "Start with reading, prayer and memory"}
				</button>
				<button type="button" onClick={onChoose} disabled={saving} className={quietButton}>
					Choose my own
				</button>
			</div>
		</div>
	);
}
