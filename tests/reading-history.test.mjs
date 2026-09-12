import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_READING_TIMEZONE,
	countDayStreak,
	localDayKey,
	resolveReadingTimezone,
	shiftDayKey,
	summarizeReadingHistory,
} from "../src/lib/reading-history.ts";

const read = (event) => ({ translation: "KJV", ...event });

test("an empty history reports nothing read and no streak", () => {
	assert.deepEqual(summarizeReadingHistory([], { now: new Date("2026-09-12T18:00:00Z") }), {
		lastRead: null,
		chaptersLast7Days: 0,
		chaptersLast30Days: 0,
		activeDaysLast30: 0,
		currentStreakDays: 0,
		topBooks: [],
		recent: [],
	});
});

test("a streak follows the user's calendar, not UTC, across midnight", () => {
	// 06:30Z on the 10th is 23:30 on the 9th in Los Angeles; 07:30Z is 00:30 on
	// the 10th. In UTC both are the 10th, which would make this a one-day streak.
	const events = [
		read({ book: "John", chapter: 3, readAt: "2026-09-10T06:30:00Z" }),
		read({ book: "John", chapter: 4, readAt: "2026-09-10T07:30:00Z" }),
	];
	const now = new Date("2026-09-11T20:00:00Z"); // 13:00 on the 11th in LA, nothing read yet today

	const inLosAngeles = summarizeReadingHistory(events, { now, timeZone: "America/Los_Angeles" });
	assert.equal(inLosAngeles.currentStreakDays, 2);
	assert.equal(inLosAngeles.activeDaysLast30, 2);

	const inUtc = summarizeReadingHistory(events, { now, timeZone: "UTC" });
	assert.equal(inUtc.currentStreakDays, 1);
	assert.equal(inUtc.activeDaysLast30, 1);
});

test("east of UTC, a late-evening read already belongs to the next day", () => {
	// 15:30Z on the 11th is 00:30 on the 12th in Tokyo.
	const events = [
		read({ book: "Ruth", chapter: 1, readAt: "2026-09-11T15:30:00Z" }),
		read({ book: "Ruth", chapter: 2, readAt: "2026-09-10T15:00:00Z" }),
	];
	const now = new Date("2026-09-11T16:00:00Z");
	const history = summarizeReadingHistory(events, { now, timeZone: "Asia/Tokyo" });
	assert.equal(localDayKey(now, "Asia/Tokyo"), "2026-09-12");
	assert.equal(history.currentStreakDays, 2);
	assert.equal(history.chaptersLast7Days, 2);
});

test("a missed day breaks the streak, but today being unread does not", () => {
	const today = "2026-09-12";
	assert.equal(countDayStreak(new Set(["2026-09-11", "2026-09-10"]), today), 2);
	assert.equal(countDayStreak(new Set([today, "2026-09-11", "2026-09-09"]), today), 2);
	assert.equal(countDayStreak(new Set(["2026-09-10"]), today), 0);
	assert.equal(countDayStreak(new Set(), today), 0);
});

test("day arithmetic crosses months, leap days and DST without skipping", () => {
	assert.equal(shiftDayKey("2026-03-01", -1), "2026-02-28");
	assert.equal(shiftDayKey("2028-03-01", -1), "2028-02-29");
	assert.equal(shiftDayKey("2026-01-01", -1), "2025-12-31");
	// 2026-11-01 is the US fall-back day; the key still moves one day.
	assert.equal(shiftDayKey("2026-11-02", -1), "2026-11-01");
	assert.equal(localDayKey(new Date("2026-11-01T08:30:00Z"), "America/Los_Angeles"), "2026-11-01");
});

test("windows count distinct chapters per day, so a re-read the same day counts once", () => {
	const now = new Date("2026-09-12T20:00:00Z"); // 13:00 on the 12th in LA
	const events = [
		read({ book: "Judges", chapter: 7, readAt: "2026-09-12T18:00:00Z" }),
		read({ book: "Judges", chapter: 7, readAt: "2026-09-12T16:00:00Z" }), // same local day
		read({ book: "Judges", chapter: 6, readAt: "2026-09-06T18:00:00Z" }), // 6 days ago: in the week
		read({ book: "Judges", chapter: 6, readAt: "2026-09-05T18:00:00Z" }), // 7 days ago: month only
		read({ book: "Judges", chapter: 5, readAt: "2026-08-14T18:00:00Z" }), // 29 days ago: in the month
		read({ book: "Judges", chapter: 4, readAt: "2026-08-13T18:00:00Z" }), // 30 days ago: outside
	];
	const history = summarizeReadingHistory(events, { now, timeZone: "America/Los_Angeles" });
	assert.equal(history.chaptersLast7Days, 2);
	assert.equal(history.chaptersLast30Days, 4);
	assert.equal(history.activeDaysLast30, 4);
	assert.equal(history.currentStreakDays, 1);
});

test("last read, top books and recent reads come out newest first and capped", () => {
	const now = new Date("2026-09-12T20:00:00Z");
	const events = [];
	for (let index = 0; index < 25; index += 1) {
		events.push(
			read({
				book: index < 12 ? "Psalms" : "Romans",
				chapter: (index % 8) + 1,
				translation: index === 24 ? "NKJV" : "KJV",
				readAt: new Date(Date.UTC(2026, 7, 1, 12) + index * 3600_000).toISOString(),
			})
		);
	}
	for (const [index, book] of ["Genesis", "Exodus", "Ruth", "Esther", "Jonah"].entries()) {
		events.push(read({ book, chapter: 1, readAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString() }));
	}
	const shuffled = [...events].reverse();
	const history = summarizeReadingHistory(shuffled, { now, timeZone: "America/Los_Angeles" });

	assert.deepEqual(history.lastRead, {
		book: "Romans",
		chapter: 1,
		translation: "NKJV",
		readAt: "2026-08-02T12:00:00.000Z",
	});
	assert.equal(history.recent.length, 20);
	assert.deepEqual(history.recent[0], { book: "Romans", chapter: 1, readAt: "2026-08-02T12:00:00.000Z" });
	assert.ok(history.recent.every((entry, index, all) => index === 0 || all[index - 1].readAt >= entry.readAt));
	// Psalms and Romans both touched all 8 chapters; Romans was read last. The
	// one-chapter books tie too, and the most recently read of them wins.
	assert.deepEqual(history.topBooks, [
		{ book: "Romans", chapters: 8 },
		{ book: "Psalms", chapters: 8 },
		{ book: "Jonah", chapters: 1 },
		{ book: "Esther", chapters: 1 },
		{ book: "Ruth", chapters: 1 },
	]);
});

test("an unknown or missing timezone falls back to Los Angeles", () => {
	assert.equal(DEFAULT_READING_TIMEZONE, "America/Los_Angeles");
	assert.equal(resolveReadingTimezone(undefined), "America/Los_Angeles");
	assert.equal(resolveReadingTimezone("Mars/Olympus_Mons"), "America/Los_Angeles");
	assert.equal(resolveReadingTimezone("Europe/London"), "Europe/London");
});

test("GET /api/reading-events authenticates like POST and returns the summary", () => {
	const route = readFileSync(
		fileURLToPath(new URL("../src/app/api/reading-events/route.ts", import.meta.url)),
		"utf8"
	);
	const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
	assert.match(get, /await getAuthUser\(\)/);
	assert.match(get, /loadReadingHistory\(userId\)/);
	assert.match(get, /if \(error instanceof Response\) return error;/);
});
