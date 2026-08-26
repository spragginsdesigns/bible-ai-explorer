import { describe, expect, it } from "vitest";
import {
	currentPlanDay,
	dayHeadline,
	dayStateLabel,
	describeReadings,
	isTodaysPlanReading,
	planCardSubtitle,
	progressCaption,
	streakLabel,
} from "./planView";
import type { PlanDay, ReadingPlan } from "./types";

function day(number: number, readings: [string, number][], overrides: Partial<PlanDay> = {}): PlanDay {
	return {
		day: number,
		readings: readings.map(([book, chapter]) => ({ book, chapter })),
		focus: "Read it slowly.",
		done: false,
		doneSource: null,
		state: "upcoming",
		...overrides,
	};
}

function plan(overrides: Partial<ReadingPlan> = {}): ReadingPlan {
	return {
		id: "plan_1",
		title: "The Gospels in 30 days",
		description: "Four accounts of one Lord.",
		source: "preset",
		presetKey: "gospels-30",
		startDate: "2026-08-01T12:00:00.000Z",
		status: "active",
		dayCount: 30,
		todayDay: 6,
		currentDay: 6,
		completedCount: 5,
		percent: 17,
		streak: 5,
		days: [
			day(5, [["Matthew", 8]], { done: true, doneSource: "read", state: "done" }),
			day(6, [["Matthew", 9], ["Matthew", 10], ["Matthew", 11]], { state: "today" }),
			day(7, [["Matthew", 12]]),
		],
		...overrides,
	};
}

describe("describeReadings", () => {
	it("collapses a run of consecutive chapters in one book", () => {
		expect(
			describeReadings([
				{ book: "Matthew", chapter: 1 },
				{ book: "Matthew", chapter: 2 },
				{ book: "Matthew", chapter: 3 },
			])
		).toBe("Matthew 1-3");
	});

	it("keeps separate books apart, and does not span a book boundary", () => {
		expect(
			describeReadings([
				{ book: "Malachi", chapter: 4 },
				{ book: "Matthew", chapter: 1 },
			])
		).toBe("Malachi 4, Matthew 1");
	});

	it("does not join chapters that are not consecutive", () => {
		expect(
			describeReadings([
				{ book: "Psalms", chapter: 1 },
				{ book: "Psalms", chapter: 3 },
			])
		).toBe("Psalms 1, Psalms 3");
	});

	it("renders a single chapter without a range", () => {
		expect(describeReadings([{ book: "Jude", chapter: 1 }])).toBe("Jude 1");
	});

	it("is empty for an empty day", () => {
		expect(describeReadings([])).toBe("");
	});
});

describe("plan summaries", () => {
	it("names the day the user is actually on, not the calendar day", () => {
		// Fallen three days behind: the calendar says 9, the plan hands back 6.
		const behind = plan({ todayDay: 9, currentDay: 6 });
		expect(dayHeadline(behind)).toBe("Day 6 of 30");
		expect(currentPlanDay(behind)?.day).toBe(6);
	});

	it("reads progress and streak the way the screen shows them", () => {
		expect(progressCaption(plan())).toBe("5 of 30 days read · 17%");
		expect(streakLabel(5)).toBe("5-day streak");
		expect(streakLabel(0)).toBe("No streak yet");
	});

	it("labels each day state", () => {
		expect(dayStateLabel("done")).toBe("Done");
		expect(dayStateLabel("today")).toBe("Today");
		expect(dayStateLabel("upcoming")).toBe("Upcoming");
	});

	it("invites a plan when there is none, and reports a finished one", () => {
		expect(planCardSubtitle(null)).toBe("Start a plan and read through Scripture");
		expect(planCardSubtitle(plan())).toBe("Day 6 of 30 · Matthew 9-11");
		expect(planCardSubtitle(plan({ status: "completed" }))).toBe("Finished - The Gospels in 30 days");
	});
});

describe("isTodaysPlanReading", () => {
	it("recognises a chapter that is part of today's reading", () => {
		expect(isTodaysPlanReading(plan(), "Matthew", 10)).toBe(true);
	});

	it("rejects a chapter from another day, another book, or no plan", () => {
		expect(isTodaysPlanReading(plan(), "Matthew", 12)).toBe(false);
		expect(isTodaysPlanReading(plan(), "Mark", 10)).toBe(false);
		expect(isTodaysPlanReading(null, "Matthew", 10)).toBe(false);
	});

	it("claims nothing once the plan is no longer running", () => {
		expect(isTodaysPlanReading(plan({ status: "completed" }), "Matthew", 10)).toBe(false);
	});
});
