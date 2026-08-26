/**
 * Progress for a reading plan, computed from what the user actually read.
 *
 * The point of the whole feature lives here: a day is done because every
 * chapter of it shows up in the user's `ReadingEvent` history, not because
 * they remembered to tick a box. Marking a day by hand is the escape hatch for
 * reading outside the app, never the main path.
 *
 * Pure on purpose - no prisma, no dates beyond arithmetic - so
 * `tests/reading-plans.test.mjs` can drive every edge (a day read out of
 * order, a plan started in the past, a broken streak) directly. The type-only
 * import is erased at load, which keeps this file loadable by a plain
 * `node --experimental-strip-types` test.
 */
import type { ReadingPlanDay, ReadingPlanReading } from "@/lib/reading-plan-presets";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How a day of the plan is standing right now. */
export type ReadingPlanDayState = "done" | "today" | "upcoming";

export interface ReadingPlanDayProgress extends ReadingPlanDay {
	done: boolean;
	/** "marked" = ticked by hand; "read" = every chapter has a reading event. */
	doneSource: "marked" | "read" | null;
	state: ReadingPlanDayState;
}

export interface ReadingPlanProgress {
	dayCount: number;
	completedCount: number;
	/** 0-100, rounded. */
	percent: number;
	/** Consecutive done days ending at today (today itself not yet due). */
	streak: number;
	/** Which day of the plan the calendar says it is, clamped into the plan. */
	todayDay: number;
	/** The day to put in front of them: the first unfinished day up to today. */
	currentDay: number;
	days: ReadingPlanDayProgress[];
}

/** The key a chapter is remembered under, both in plans and reading events. */
export function readingKey(book: string, chapter: number): string {
	return `${book}|${chapter}`;
}

function toMillis(value: Date | number | string): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") return new Date(value).getTime();
	return value.getTime();
}

/**
 * Which day of the plan it is for someone who started at `startDate`.
 *
 * Whole 24-hour buckets from the moment they started, not local midnights -
 * the same trade `DAILY_CROSS_REUSE_MS` makes in `daily-cross.ts`, and for the
 * same reason: the server does not know the user's timezone, and a plan that
 * silently skips or repeats a day at a timezone boundary is worse than one
 * whose day rolls over at the hour they signed up.
 */
export function planDayIndex(
	startDate: Date | number | string,
	now: Date | number | string,
	dayCount: number
): number {
	const elapsed = toMillis(now) - toMillis(startDate);
	const index = Math.floor(elapsed / MS_PER_DAY) + 1;
	if (!Number.isFinite(index)) return 1;
	return Math.min(Math.max(index, 1), Math.max(dayCount, 1));
}

export interface PlanProgressInput {
	days: ReadingPlanDay[];
	startDate: Date | number | string;
	now: Date | number | string;
	/** Day numbers ticked by hand (`ReadingPlanCompletion` rows). */
	markedDays: Iterable<number>;
	/** `readingKey(book, chapter)` for every chapter read since the plan began. */
	readChapters: Iterable<string>;
}

/** True when every chapter of the day is in the read set. */
function everyChapterRead(readings: readonly ReadingPlanReading[], read: Set<string>): boolean {
	return readings.length > 0 && readings.every((reading) => read.has(readingKey(reading.book, reading.chapter)));
}

/**
 * Fold a plan, its explicit completions and the user's reading history into
 * one progress view.
 */
export function computePlanProgress(input: PlanProgressInput): ReadingPlanProgress {
	const marked = new Set(input.markedDays);
	const read = new Set(input.readChapters);
	const dayCount = input.days.length;
	const todayDay = planDayIndex(input.startDate, input.now, dayCount);

	const resolved = input.days.map((day) => {
		const isMarked = marked.has(day.day);
		const isRead = !isMarked && everyChapterRead(day.readings, read);
		return {
			...day,
			done: isMarked || isRead,
			doneSource: isMarked ? ("marked" as const) : isRead ? ("read" as const) : null,
		};
	});

	// The reading to show is the oldest one they have not finished, so someone
	// who fell behind is handed the day they missed rather than a day that
	// silently skipped past them. Caught up entirely, it is simply today.
	const firstUnfinished = resolved.find((day) => !day.done && day.day <= todayDay);
	const currentDay = firstUnfinished?.day ?? todayDay;

	const doneByDay = new Map(resolved.map((day) => [day.day, day.done]));
	// A streak counts back from today, and today not being done yet does not
	// break it - the day is not over.
	let streak = 0;
	for (let day = doneByDay.get(todayDay) ? todayDay : todayDay - 1; day >= 1; day--) {
		if (!doneByDay.get(day)) break;
		streak += 1;
	}

	const completedCount = resolved.filter((day) => day.done).length;

	return {
		dayCount,
		completedCount,
		percent: dayCount === 0 ? 0 : Math.round((completedCount / dayCount) * 100),
		streak,
		todayDay,
		currentDay,
		days: resolved.map((day) => ({
			...day,
			state: day.done ? "done" : day.day === currentDay ? "today" : "upcoming",
		})),
	};
}
