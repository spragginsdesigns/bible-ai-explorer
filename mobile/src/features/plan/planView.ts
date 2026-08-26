/**
 * Pure presentation rules for reading plans - what a day is called, how a
 * day's chapters read as one line, and whether a "Pick Up Your Cross" study
 * step is really today's plan reading.
 *
 * Kept out of the screens so the fiddly parts (collapsing chapter runs, the
 * plan/cross match) are tested directly. Mirrors
 * `src/components/plan/planView.ts` on web, which mirrors `describeReadings`
 * in `src/lib/reading-plan-presets.ts` on the server.
 */
import type { PlanDay, PlanDayState, PlanReading, ReadingPlan } from "./types";

/**
 * A day's chapters as one short line: "Matthew 1-3", "Psalms 1-5, Proverbs 1".
 * Consecutive chapters of the same book collapse into a range.
 */
export function describeReadings(readings: readonly PlanReading[]): string {
	const parts: string[] = [];
	let index = 0;
	while (index < readings.length) {
		const start = readings[index];
		let end = start;
		let next = index + 1;
		while (
			next < readings.length &&
			readings[next].book === end.book &&
			readings[next].chapter === end.chapter + 1
		) {
			end = readings[next];
			next += 1;
		}
		parts.push(
			end.chapter === start.chapter
				? `${start.book} ${start.chapter}`
				: `${start.book} ${start.chapter}-${end.chapter}`
		);
		index = next;
	}
	return parts.join(", ");
}

/** The day the plan wants them on now, or null for a finished plan. */
export function currentPlanDay(plan: ReadingPlan | null): PlanDay | null {
	if (!plan) return null;
	return plan.days.find((day) => day.day === plan.currentDay) ?? null;
}

/** "Day 6 of 30" */
export function dayHeadline(plan: ReadingPlan): string {
	return `Day ${plan.currentDay} of ${plan.dayCount}`;
}

/** "6 of 30 days read · 20%" */
export function progressCaption(plan: ReadingPlan): string {
	return `${plan.completedCount} of ${plan.dayCount} days read · ${plan.percent}%`;
}

/** "5-day streak", or an honest nudge when there is none yet. */
export function streakLabel(streak: number): string {
	if (streak <= 0) return "No streak yet";
	return `${streak}-day streak`;
}

const DAY_STATE_LABELS: Record<PlanDayState, string> = {
	done: "Done",
	today: "Today",
	upcoming: "Upcoming",
};

export function dayStateLabel(state: PlanDayState): string {
	return DAY_STATE_LABELS[state];
}

/**
 * The one-line summary for the Bible tab's plan card: where they are, or an
 * invitation when they have no plan.
 */
export function planCardSubtitle(plan: ReadingPlan | null): string {
	if (!plan) return "Start a plan and read through Scripture";
	if (plan.status === "completed") return `Finished - ${plan.title}`;
	const day = currentPlanDay(plan);
	if (!day) return plan.title;
	return `${dayHeadline(plan)} · ${describeReadings(day.readings)}`;
}

/**
 * Is this chapter part of today's plan reading? Drives the small "From your
 * plan" tag on the Pick Up Your Cross study path - the daily cross is told to
 * build its path out of the plan, and this is how the user sees that it did.
 */
export function isTodaysPlanReading(
	plan: ReadingPlan | null,
	book: string,
	chapter: number
): boolean {
	if (!plan || plan.status !== "active") return false;
	const day = currentPlanDay(plan);
	if (!day) return false;
	return day.readings.some((reading) => reading.book === book && reading.chapter === chapter);
}
