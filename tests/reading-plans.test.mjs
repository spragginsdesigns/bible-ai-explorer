import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	KJV_BOOK_CHAPTERS,
	MAX_READINGS_PER_DAY,
	READING_PLAN_PRESETS,
	buildPresetPlan,
	canonicalKjvBookName,
	describeReadings,
	kjvChapterCount,
	sanitizeReadingPlanDays,
	splitEvenly,
} from "../src/lib/reading-plan-presets.ts";
import {
	MS_PER_DAY,
	computePlanProgress,
	planDayIndex,
	readingKey,
} from "../src/lib/reading-plan-progress.ts";

const booksJson = JSON.parse(
	readFileSync(fileURLToPath(new URL("../src/data/books.json", import.meta.url)), "utf8")
);

test("the chapter table mirrors the Bible bundle the reader itself uses", () => {
	assert.deepEqual(
		KJV_BOOK_CHAPTERS.map((book) => ({ name: book.name, chapters: book.chapters })),
		booksJson.map((book) => ({ name: book.name, chapters: book.chapters }))
	);
	assert.equal(
		KJV_BOOK_CHAPTERS.reduce((total, book) => total + book.chapters, 0),
		1189
	);
});

test("book names are resolved the way the KJV corpus reader resolves them", () => {
	assert.equal(canonicalKjvBookName("psalm"), "Psalms");
	assert.equal(canonicalKjvBookName("II Kings"), "2 Kings");
	assert.equal(canonicalKjvBookName("1st John"), "1 John");
	assert.equal(canonicalKjvBookName("song of songs"), "Song of Solomon");
	assert.equal(canonicalKjvBookName("Book of Mormon"), undefined);
	assert.equal(kjvChapterCount("psalm"), 150);
});

test("splitEvenly spreads the longer days through the plan, not at the front", () => {
	const groups = splitEvenly(Array.from({ length: 10 }, (_unused, index) => index), 4);
	assert.deepEqual(groups.map((group) => group.length), [2, 3, 2, 3]);
	assert.deepEqual(groups.flat(), Array.from({ length: 10 }, (_unused, index) => index));
});

const EXPECTED_PRESETS = [
	{ key: "gospels-30", dayCount: 30, chapters: 28 + 16 + 24 + 21 },
	{ key: "psalms-proverbs-31", dayCount: 31, chapters: 150 + 31 },
	{ key: "new-testament-90", dayCount: 90, chapters: 260 },
	{ key: "whole-bible-year", dayCount: 365, chapters: 1189 },
];

test("every preset is listed and every listed preset builds", () => {
	assert.deepEqual(
		READING_PLAN_PRESETS.map((preset) => preset.key),
		EXPECTED_PRESETS.map((preset) => preset.key)
	);
	for (const preset of READING_PLAN_PRESETS) {
		assert.ok(preset.title.length > 0, `${preset.key} has no title`);
		assert.ok(preset.description.length > 0, `${preset.key} has no description`);
	}
	assert.equal(buildPresetPlan("not-a-plan"), null);
});

for (const expected of EXPECTED_PRESETS) {
	test(`${expected.key} covers exactly what it promises, in valid Scripture`, () => {
		const preset = buildPresetPlan(expected.key);
		assert.ok(preset, `${expected.key} did not build`);
		assert.equal(preset.dayCount, expected.dayCount);
		assert.equal(preset.days.length, expected.dayCount);

		let chapters = 0;
		preset.days.forEach((day, index) => {
			assert.equal(day.day, index + 1, "days must be numbered 1..n with no gaps");
			assert.ok(day.readings.length > 0, `day ${day.day} has nothing to read`);
			assert.ok(
				day.readings.length <= MAX_READINGS_PER_DAY,
				`day ${day.day} asks for ${day.readings.length} chapters`
			);
			assert.ok(day.focus.length > 0, `day ${day.day} has no focus line`);
			for (const reading of day.readings) {
				const count = kjvChapterCount(reading.book);
				assert.ok(count, `${reading.book} is not a book of the KJV`);
				assert.ok(
					reading.chapter >= 1 && reading.chapter <= count,
					`${reading.book} ${reading.chapter} is not a chapter that exists`
				);
				chapters += 1;
			}
		});
		assert.equal(chapters, expected.chapters);
	});
}

test("the Gospels plan runs Matthew to John in order and reads each chapter once", () => {
	const preset = buildPresetPlan("gospels-30");
	const flat = preset.days.flatMap((day) => day.readings);
	assert.deepEqual(flat[0], { book: "Matthew", chapter: 1 });
	assert.deepEqual(flat[flat.length - 1], { book: "John", chapter: 21 });
	assert.equal(new Set(flat.map((r) => readingKey(r.book, r.chapter))).size, flat.length);
});

test("Psalms & Proverbs pairs the proverb for the date with that day's psalms", () => {
	const preset = buildPresetPlan("psalms-proverbs-31");
	preset.days.forEach((day) => {
		const proverbs = day.readings.filter((reading) => reading.book === "Proverbs");
		assert.deepEqual(proverbs, [{ book: "Proverbs", chapter: day.day }]);
		assert.ok(day.readings.some((reading) => reading.book === "Psalms"));
	});
	assert.equal(describeReadings(preset.days[0].readings), "Psalms 1-4, Proverbs 1");
});

test("describeReadings collapses runs but never spans a book boundary", () => {
	assert.equal(
		describeReadings([
			{ book: "Matthew", chapter: 1 },
			{ book: "Matthew", chapter: 2 },
			{ book: "Matthew", chapter: 3 },
		]),
		"Matthew 1-3"
	);
	assert.equal(
		describeReadings([
			{ book: "Malachi", chapter: 4 },
			{ book: "Matthew", chapter: 1 },
		]),
		"Malachi 4, Matthew 1"
	);
	assert.equal(
		describeReadings([
			{ book: "Psalms", chapter: 1 },
			{ book: "Psalms", chapter: 3 },
		]),
		"Psalms 1, Psalms 3"
	);
	assert.equal(describeReadings([]), "");
});

test("a model's invented Scripture is dropped, and the rest of the plan survives", () => {
	const days = sanitizeReadingPlanDays([
		{ day: 1, readings: [{ book: "psalm", chapter: 23 }], focus: "  Pray it.  " },
		// Every reading is bogus: Psalm 151 does not exist, nor does Hezekiah.
		{ day: 2, readings: [{ book: "Psalms", chapter: 151 }, { book: "Hezekiah", chapter: 1 }], focus: "x" },
		{ day: 3, readings: [{ book: "John", chapter: 3 }, { book: "Psalms", chapter: 999 }], focus: "y" },
	]);

	assert.equal(days.length, 2, "the all-invalid day is dropped whole");
	assert.deepEqual(days[0], {
		day: 1,
		readings: [{ book: "Psalms", chapter: 23 }],
		focus: "Pray it.",
	});
	// The surviving days are renumbered, so day 3 becomes day 2.
	assert.deepEqual(days[1], { day: 2, readings: [{ book: "John", chapter: 3 }], focus: "y" });
});

test("sanitize refuses junk shapes rather than throwing", () => {
	assert.deepEqual(sanitizeReadingPlanDays(null), []);
	assert.deepEqual(sanitizeReadingPlanDays("Matthew"), []);
	assert.deepEqual(sanitizeReadingPlanDays([{ day: 1 }]), []);
	assert.deepEqual(sanitizeReadingPlanDays([{ readings: [{ book: "John", chapter: 3.5 }] }]), []);
	assert.equal(
		sanitizeReadingPlanDays([
			{ readings: Array.from({ length: 20 }, (_unused, i) => ({ book: "Psalms", chapter: i + 1 })) },
		])[0].readings.length,
		MAX_READINGS_PER_DAY
	);
});

const START = Date.UTC(2026, 7, 1, 12, 0, 0);
const at = (dayNumber) => START + (dayNumber - 1) * MS_PER_DAY + 60_000;

test("the plan's day is whole 24-hour buckets from the start, clamped into the plan", () => {
	assert.equal(planDayIndex(START, START, 30), 1);
	assert.equal(planDayIndex(START, at(1), 30), 1);
	assert.equal(planDayIndex(START, at(6), 30), 6);
	// Before the start, and long past the end, both land inside the plan.
	assert.equal(planDayIndex(START, START - MS_PER_DAY, 30), 1);
	assert.equal(planDayIndex(START, at(400), 30), 30);
});

/** A five-day plan: one chapter a day, Matthew 1 through 5. */
const FIVE_DAYS = Array.from({ length: 5 }, (_unused, index) => ({
	day: index + 1,
	readings: [{ book: "Matthew", chapter: index + 1 }],
	focus: "Read it.",
}));

test("a day is done because the chapters were actually read, with no ticking", () => {
	const progress = computePlanProgress({
		days: FIVE_DAYS,
		startDate: START,
		now: at(3),
		markedDays: [],
		readChapters: [readingKey("Matthew", 1), readingKey("Matthew", 2)],
	});

	assert.equal(progress.completedCount, 2);
	assert.equal(progress.percent, 40);
	assert.equal(progress.todayDay, 3);
	assert.equal(progress.currentDay, 3);
	assert.equal(progress.streak, 2, "today is not done yet, which does not break the streak");
	assert.deepEqual(progress.days.map((day) => day.state), [
		"done",
		"done",
		"today",
		"upcoming",
		"upcoming",
	]);
	assert.deepEqual(progress.days.map((day) => day.doneSource), ["read", "read", null, null, null]);
});

test("a day only counts once EVERY chapter of it has been read", () => {
	const progress = computePlanProgress({
		days: [{ day: 1, readings: [{ book: "Matthew", chapter: 1 }, { book: "Matthew", chapter: 2 }], focus: "" }],
		startDate: START,
		now: at(1),
		markedDays: [],
		readChapters: [readingKey("Matthew", 1)],
	});
	assert.equal(progress.completedCount, 0);
	assert.equal(progress.days[0].done, false);
});

test("marking a day by hand covers reading done outside the app", () => {
	const progress = computePlanProgress({
		days: FIVE_DAYS,
		startDate: START,
		now: at(2),
		markedDays: [1],
		readChapters: [],
	});
	assert.equal(progress.days[0].done, true);
	assert.equal(progress.days[0].doneSource, "marked");
	assert.equal(progress.streak, 1);
});

test("falling behind hands back the day that was missed, not the calendar day", () => {
	const progress = computePlanProgress({
		days: FIVE_DAYS,
		startDate: START,
		now: at(4),
		markedDays: [1],
		readChapters: [readingKey("Matthew", 3)],
	});

	assert.equal(progress.todayDay, 4);
	assert.equal(progress.currentDay, 2, "day 2 was skipped, so day 2 is what they are shown");
	assert.equal(progress.streak, 1, "day 3 is the only run reaching yesterday; the skipped day 2 ends it");
	assert.deepEqual(progress.days.map((day) => day.state), [
		"done",
		"today",
		"done",
		"upcoming",
		"upcoming",
	]);
});

test("caught up entirely, the current day is simply today", () => {
	const progress = computePlanProgress({
		days: FIVE_DAYS,
		startDate: START,
		now: at(3),
		markedDays: [1, 2, 3],
		readChapters: [],
	});
	assert.equal(progress.currentDay, 3);
	assert.equal(progress.streak, 3);
	assert.equal(progress.percent, 60);
});

test("a finished plan reports every day done and 100 per cent", () => {
	const progress = computePlanProgress({
		days: FIVE_DAYS,
		startDate: START,
		now: at(5),
		markedDays: [1, 2, 3, 4, 5],
		readChapters: [],
	});
	assert.equal(progress.completedCount, 5);
	assert.equal(progress.percent, 100);
	assert.equal(progress.streak, 5);
	assert.ok(progress.days.every((day) => day.state === "done"));
});

test("an empty plan is reported as empty rather than dividing by zero", () => {
	const progress = computePlanProgress({
		days: [],
		startDate: START,
		now: at(3),
		markedDays: [],
		readChapters: [],
	});
	assert.equal(progress.dayCount, 0);
	assert.equal(progress.percent, 0);
	assert.equal(progress.streak, 0);
});
