/**
 * The reading-plan shapes exactly as `/api/reading-plans` serves them. Mirrors
 * `src/lib/reading-plans.ts` (PlanWithProgress) and
 * `src/lib/reading-plan-progress.ts` on the server, and
 * `src/components/plan/types.ts` on web.
 */

export interface PlanReading {
	book: string;
	chapter: number;
}

export type PlanDayState = "done" | "today" | "upcoming";

export interface PlanDay {
	day: number;
	readings: PlanReading[];
	focus: string;
	done: boolean;
	/** "marked" = ticked by hand; "read" = every chapter has a reading event. */
	doneSource: "marked" | "read" | null;
	state: PlanDayState;
}

export type PlanStatus = "active" | "completed" | "archived";

export interface ReadingPlan {
	id: string;
	title: string;
	description: string;
	source: "preset" | "ai";
	presetKey: string | null;
	startDate: string;
	status: PlanStatus;
	dayCount: number;
	todayDay: number;
	/** The day to put in front of them: the oldest one still unread. */
	currentDay: number;
	completedCount: number;
	percent: number;
	streak: number;
	days: PlanDay[];
}

export interface ReadingPlanPreset {
	key: string;
	title: string;
	description: string;
	dayCount: number;
}

export interface ReadingPlansView {
	active: ReadingPlan | null;
	presets: ReadingPlanPreset[];
}
