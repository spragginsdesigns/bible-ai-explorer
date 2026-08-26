"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BOOKS } from "@/lib/bible/books";
import { useReadingPlan } from "./useReadingPlan";
import {
	currentPlanDay,
	dayHeadline,
	dayStateLabel,
	describeReadings,
	progressCaption,
	streakLabel,
} from "./planView";
import type { PlanReading } from "./types";

/** The lengths a written plan is offered at, and the step the ± buttons take. */
const GOAL_DAY_CHOICES = [14, 30, 60, 90] as const;
const GOAL_DAY_STEP = 7;
const MIN_GOAL_DAYS = 7;
const MAX_GOAL_DAYS = 365;
const MAX_GOAL_LENGTH = 300;

function chapterHref(reading: PlanReading): string | null {
	const book = BOOKS.find((candidate) => candidate.name === reading.book);
	return book ? `/bible/chapter?book=${book.order}&chapter=${reading.chapter}` : null;
}

/**
 * Reading plans: one plan at a time, with progress that fills itself in from
 * the chapters the user actually reads in the Bible reader.
 *
 * With no plan this is a chooser (four presets, or a goal to have one written
 * for). With a plan it is the day they are on, the chapters as links into the
 * reader, and the whole plan underneath it. Mirrors
 * mobile/app/(app)/bible/plan.tsx.
 */
export default function ReadingPlanScreen() {
	const router = useRouter();
	const { plan, presets, loading, busy, error, reload, startPreset, startGoal, setDayDone, archive } =
		useReadingPlan();

	const [goal, setGoal] = useState("");
	const [goalDays, setGoalDays] = useState(30);
	const [confirmingArchive, setConfirmingArchive] = useState(false);

	const today = currentPlanDay(plan);

	const adjustDays = (delta: number) =>
		setGoalDays((previous) => Math.min(Math.max(previous + delta, MIN_GOAL_DAYS), MAX_GOAL_DAYS));

	const submitGoal = () => {
		const described = goal.trim();
		if (!described) return;
		setGoal("");
		void startGoal(described, goalDays);
	};

	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<div className="mx-auto w-full max-w-2xl lg:max-w-3xl px-5 pb-28 lg:pb-16">
				<div className="flex items-center gap-4 py-3 lg:py-6">
					<button
						type="button"
						onClick={() => router.back()}
						className="text-[15px] font-semibold text-amber-600 dark:text-amber-400"
					>
						‹ Back
					</button>
					<h1 className="flex-1 truncate text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
						Reading plan
					</h1>
					{plan ? (
						<button
							type="button"
							aria-label="Plan options"
							onClick={() => setConfirmingArchive((previous) => !previous)}
							className="w-11 text-right text-xl font-bold text-neutral-500 dark:text-neutral-400"
						>
							⋯
						</button>
					) : (
						<span className="w-11" aria-hidden />
					)}
				</div>

				{error && (
					<div className="glass-card gradient-border mb-3 flex flex-col items-center gap-4 rounded-2xl p-6">
						<p className="text-center text-sm leading-5 text-neutral-600 dark:text-neutral-300">
							{error}
						</p>
						<button
							type="button"
							onClick={reload}
							className="rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 px-6 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
						>
							Try again
						</button>
					</div>
				)}

				{loading && (
					<p className="py-8 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
						Loading your plan…
					</p>
				)}

				{plan && confirmingArchive && (
					<div className="glass-card mb-3 flex flex-col gap-3 rounded-2xl p-4">
						<p className="text-[13.5px] leading-5 text-neutral-600 dark:text-neutral-300">
							Put &ldquo;{plan.title}&rdquo; away? Your progress is kept, and you can start another
							plan.
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									setConfirmingArchive(false);
									void archive();
								}}
								className="min-h-11 flex-1 rounded-lg border border-red-500/40 dark:border-red-400/30 text-[14px] font-bold text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
							>
								Archive plan
							</button>
							<button
								type="button"
								onClick={() => setConfirmingArchive(false)}
								className="min-h-11 flex-1 rounded-lg border border-black/[0.08] dark:border-white/[0.08] text-[14px] font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
							>
								Keep it
							</button>
						</div>
					</div>
				)}

				{plan && (
					<div className="flex flex-col gap-3">
						<div className="glass-card gradient-border flex flex-col gap-2 rounded-2xl p-5">
							<h2 className="font-[family-name:var(--font-pirata)] text-2xl text-neutral-900 dark:text-neutral-100">
								{plan.title}
							</h2>
							<p className="text-[13.5px] leading-[19px] text-neutral-500 dark:text-neutral-400">
								{plan.description}
							</p>
							<div
								role="progressbar"
								aria-valuenow={plan.percent}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label={`${plan.percent}% of ${plan.title} read`}
								className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
							>
								<div
									className="h-2 rounded-full bg-amber-500 dark:bg-amber-400"
									style={{ width: `${Math.min(plan.percent, 100)}%` }}
								/>
							</div>
							<div className="flex items-baseline gap-2">
								<span className="text-[22px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
									{plan.percent}%
								</span>
								<span className="flex-1 text-[12.5px] text-neutral-400 dark:text-neutral-500">
									{progressCaption(plan)}
								</span>
							</div>
							<p className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400">
								🔥 {streakLabel(plan.streak)}
							</p>
						</div>

						{plan.status === "completed" ? (
							<div className="rounded-2xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 p-5">
								<p className="text-base font-bold text-amber-600 dark:text-amber-400">
									You finished it.
								</p>
								<p className="mt-1 text-[13.5px] leading-5 text-neutral-600 dark:text-neutral-300">
									Every day of {plan.title} is read. Archive it from ⋯ above to start another.
								</p>
							</div>
						) : (
							today && (
								<div className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 p-5">
									<p className="text-xs font-bold uppercase tracking-[0.09em] text-amber-600 dark:text-amber-400">
										{dayHeadline(plan)}
									</p>
									<div className="flex flex-wrap gap-2">
										{today.readings.map((reading) => {
											const href = chapterHref(reading);
											const label = `${reading.book} ${reading.chapter} ›`;
											return href ? (
												<Link
													key={`${reading.book}-${reading.chapter}`}
													href={href}
													className="rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-white/60 dark:bg-white/[0.04] px-4 py-2 text-sm font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors"
												>
													{label}
												</Link>
											) : (
												<span
													key={`${reading.book}-${reading.chapter}`}
													className="rounded-full border border-black/[0.08] dark:border-white/[0.08] px-4 py-2 text-sm font-bold text-neutral-500 dark:text-neutral-400"
												>
													{label}
												</span>
											);
										})}
									</div>
									{today.focus && (
										<p className="text-sm leading-[21px] text-neutral-700 dark:text-neutral-300">
											{today.focus}
										</p>
									)}
									<button
										type="button"
										role="checkbox"
										aria-checked={today.done}
										disabled={busy}
										onClick={() => void setDayDone(today.day, !today.done)}
										className={`min-h-11 rounded-lg border text-[14px] font-semibold transition-colors disabled:opacity-50 ${
											today.done
												? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
												: "border-black/[0.08] dark:border-white/[0.08] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
										}`}
									>
										{today.done ? "✓ Read" : "Mark this day read"}
									</button>
									{!today.done && (
										<p className="text-[11.5px] leading-4 text-neutral-400/80 dark:text-neutral-600">
											Reading these chapters in SureWord marks the day on its own.
										</p>
									)}
								</div>
							)
						)}
					</div>
				)}

				{!plan && !loading && (
					<div className="flex flex-col gap-3">
						<p className="text-sm leading-[21px] text-neutral-500 dark:text-neutral-400">
							Pick a plan and read straight through. Chapters you read in SureWord tick themselves
							off - there is nothing to remember.
						</p>

						{presets.map((preset) => (
							<button
								key={preset.key}
								type="button"
								disabled={busy}
								onClick={() => void startPreset(preset.key)}
								className="flex flex-col gap-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03] px-5 py-4 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.06] hover:border-amber-500/30 dark:hover:border-amber-400/20 transition-colors disabled:opacity-50"
							>
								<span className="flex items-center gap-2">
									<span className="flex-1 text-[15px] font-bold text-neutral-900 dark:text-neutral-100">
										{preset.title}
									</span>
									<span className="text-[12.5px] tabular-nums text-amber-600 dark:text-amber-400">
										{preset.dayCount} days
									</span>
								</span>
								<span className="text-[13px] leading-[19px] text-neutral-500 dark:text-neutral-400">
									{preset.description}
								</span>
							</button>
						))}

						<p className="mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400 dark:text-neutral-500">
							Build my own
						</p>
						<div className="glass-card flex flex-col gap-3 rounded-2xl p-5">
							<textarea
								value={goal}
								onChange={(event) => setGoal(event.target.value)}
								maxLength={MAX_GOAL_LENGTH}
								rows={3}
								placeholder="What should it walk you through? e.g. everything Jesus said about prayer"
								aria-label="What the plan should walk you through"
								className="rounded-lg border border-black/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-black/30 px-3 py-2 text-[14px] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:border-amber-500/50 focus:outline-none"
							/>
							<div className="flex items-center gap-3">
								<button
									type="button"
									aria-label="Fewer days"
									onClick={() => adjustDays(-GOAL_DAY_STEP)}
									className="h-11 w-11 rounded-lg border border-black/[0.08] dark:border-white/[0.08] text-xl font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
								>
									−
								</button>
								<span className="flex-1 text-center text-[15px] font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
									{goalDays} days
								</span>
								<button
									type="button"
									aria-label="More days"
									onClick={() => adjustDays(GOAL_DAY_STEP)}
									className="h-11 w-11 rounded-lg border border-black/[0.08] dark:border-white/[0.08] text-xl font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
								>
									+
								</button>
							</div>
							<div className="flex gap-2">
								{GOAL_DAY_CHOICES.map((choice) => (
									<button
										key={choice}
										type="button"
										onClick={() => setGoalDays(choice)}
										className={`min-h-9 flex-1 rounded-full border text-[13px] tabular-nums transition-colors ${
											goalDays === choice
												? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 font-bold text-amber-600 dark:text-amber-400"
												: "border-black/[0.08] dark:border-white/[0.08] text-neutral-500 dark:text-neutral-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
										}`}
									>
										{choice}
									</button>
								))}
							</div>
							<button
								type="button"
								disabled={busy || !goal.trim()}
								onClick={submitGoal}
								className="flex min-h-12 items-center justify-center rounded-xl border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-[15px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors disabled:opacity-50"
							>
								{busy ? "Writing your plan…" : "✦ Build my plan"}
							</button>
						</div>
					</div>
				)}

				{plan && (
					<>
						<p className="mt-6 mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400 dark:text-neutral-500">
							The whole plan
						</p>
						<ul className="flex flex-col gap-2">
							{plan.days.map((day) => (
								<li
									key={day.day}
									className={`flex items-center gap-4 rounded-xl border px-5 py-3 ${
										day.state === "today"
											? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10"
											: "border-black/[0.08] dark:border-white/[0.06] bg-black/[0.03] dark:bg-white/[0.03]"
									} ${day.done ? "opacity-70" : ""}`}
								>
									<span className="w-8 text-[13px] font-bold tabular-nums text-neutral-400 dark:text-neutral-500">
										{day.day}
									</span>
									<span className="flex-1">
										<span className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
											{describeReadings(day.readings)}
										</span>
										<span className="block text-[11.5px] text-neutral-400/80 dark:text-neutral-600">
											{dayStateLabel(day.state)}
											{day.doneSource === "read" ? " · read in SureWord" : ""}
										</span>
									</span>
									<button
										type="button"
										role="checkbox"
										aria-checked={day.done}
										aria-label={`Mark day ${day.day} ${day.done ? "unread" : "read"}`}
										disabled={busy}
										onClick={() => void setDayDone(day.day, !day.done)}
										className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold transition-colors disabled:opacity-50 ${
											day.done
												? "border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400"
												: "border-black/[0.08] dark:border-white/[0.08] text-neutral-400/80 dark:text-neutral-600 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
										}`}
									>
										✓
									</button>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
		</div>
	);
}
