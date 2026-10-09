import { describe, expect, it } from "vitest";
import {
	dayHeading,
	groupByDay,
	percentOfBible,
	reflectionAge,
	streakNote,
	testamentProgress,
	type LogEntry,
} from "./readingOverview";

const entry = (overrides: Partial<LogEntry>): LogEntry => ({
	eventId: Math.random().toString(36),
	book: 59,
	bookName: "James",
	chapter: 4,
	translation: "KJV",
	source: "reader",
	completed: false,
	verseRanges: [{ start: 1, end: 5 }],
	occurredAt: "2026-10-09T14:41:58.000Z",
	localDate: "2026-10-09",
	precision: "exact",
	chapterVerses: 17,
	...overrides,
});

describe("groupByDay", () => {
	it("merges a chapter's sessions within a day and pools partial verses", () => {
		const days = groupByDay(
			[
				entry({ verseRanges: [{ start: 9, end: 11 }, { start: 13, end: 17 }] }),
				entry({ verseRanges: [{ start: 1, end: 9 }] }),
				entry({ chapter: 3, completed: true, verseRanges: [{ start: 1, end: 18 }], chapterVerses: 18 }),
				entry({ chapter: 2, localDate: "2026-10-08", source: "physical", verseRanges: [{ start: 1, end: 26 }], completed: true }),
			],
			() => "?",
		);
		expect(days.map((day) => day.date)).toEqual(["2026-10-09", "2026-10-08"]);
		const [james4, james3] = days[0].chapters;
		expect(james4).toMatchObject({ chapter: 4, readings: 2, completed: false, firstVerse: 1 });
		// Verses 1-11 and 13-17: 16 of 17.
		expect(james4.fraction).toBeCloseTo(16 / 17);
		expect(james3).toMatchObject({ chapter: 3, completed: true, fraction: 1 });
		expect(days[1].chapters[0]).toMatchObject({ physical: true, completed: true });
	});

	it("falls back to the occurrence date, then to an unknown day", () => {
		const days = groupByDay(
			[
				entry({ localDate: null, occurredAt: "2026-10-09T12:00:00.000Z", bookName: undefined }),
				entry({ localDate: null, occurredAt: null, chapterVerses: undefined }),
			],
			() => "James",
		);
		expect(days).toHaveLength(2);
		expect(days[0].chapters[0].bookName).toBe("James");
		expect(days[1].date).toBe("unknown");
		expect(days[1].chapters[0].fraction).toBe(0);
	});
});

describe("dayHeading", () => {
	it("names recent days plainly", () => {
		expect(dayHeading("2026-10-09", "2026-10-09")).toBe("Today");
		expect(dayHeading("2026-10-08", "2026-10-09")).toBe("Yesterday");
		expect(dayHeading("2026-10-07", "2026-10-09")).toBe("Wednesday");
		expect(dayHeading("2026-09-29", "2026-10-09")).toBe("Tuesday, Sep 29");
		expect(dayHeading("2025-12-31", "2026-01-02")).toBe("Dec 31, 2025");
		expect(dayHeading("unknown", "2026-10-09")).toBe("Date not recorded");
	});
});

describe("testamentProgress", () => {
	it("lists every book in a testament with its read chapters", () => {
		const books = [
			{ order: 1, name: "Genesis", abbr: "Gen", chapters: 50, testament: "OT" as const },
			{ order: 59, name: "James", abbr: "Jas", chapters: 5, testament: "NT" as const },
			{ order: 60, name: "1 Peter", abbr: "1Pe", chapters: 5, testament: "NT" as const },
		];
		const nt = testamentProgress(books, [{ book: 59, complete: [1, 2, 3], started: [4] }], "NT");
		expect(nt.map((book) => book.name)).toEqual(["James", "1 Peter"]);
		expect([...nt[0].complete]).toEqual([1, 2, 3]);
		expect(nt[0].started.has(4)).toBe(true);
		expect(nt[1].complete.size).toBe(0);
	});
});

describe("percentOfBible", () => {
	it("never shows a started Bible as zero", () => {
		expect(percentOfBible(0, 1189)).toBe("0%");
		expect(percentOfBible(5, 1189)).toBe("<1%");
		expect(percentOfBible(35, 1189)).toBe("2%");
		expect(percentOfBible(1189, 1189)).toBe("100%");
	});
});

describe("reflectionAge", () => {
	it("says when the reflection was written", () => {
		const now = new Date(2026, 9, 9, 18, 0);
		expect(reflectionAge(new Date(2026, 9, 9, 8, 0).toISOString(), now)).toBe("Written today from your reading");
		expect(reflectionAge(new Date(2026, 9, 8, 8, 0).toISOString(), now)).toBe("Written yesterday from your reading");
		expect(reflectionAge(new Date(2026, 9, 3, 8, 0).toISOString(), now)).toBe("Written Oct 3 from your reading");
		expect(reflectionAge("nope", now)).toBe("");
	});
});

describe("day order and sources", () => {
	it("sorts days newest first even when entries arrive out of calendar order", () => {
		const days = groupByDay(
			[
				entry({ localDate: "2026-10-08" }),
				entry({ localDate: "2026-10-09", chapter: 5 }),
				entry({ localDate: null, occurredAt: null, chapter: 1 }),
				entry({ localDate: "2026-10-07", source: "legacy", chapter: 2 }),
			],
			() => "James",
		);
		expect(days.map((day) => day.date)).toEqual(["2026-10-09", "2026-10-08", "2026-10-07", "unknown"]);
		expect(days[2].chapters[0].legacy).toBe(true);
		expect(days[0].chapters[0].legacy).toBe(false);
	});
});

describe("streakNote", () => {
	it("follows the streak tile rules", () => {
		const s = (current: number, longest: number, atRisk = false) => ({ current, longest, atRisk, lastActiveDate: null });
		expect(streakNote(s(3, 3, true))).toBe("Read today to keep it");
		expect(streakNote(s(0, 0))).toBe("Read today to start");
		expect(streakNote(s(0, 9))).toBe("Best 9");
		expect(streakNote(s(4, 4))).toBe("Your best yet");
		expect(streakNote(s(2, 10))).toBe("Best 10");
	});
});
