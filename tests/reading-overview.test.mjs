import assert from "node:assert/strict";
import test from "node:test";

import {
	REFLECTION_MAX_AGE_MS,
	REFLECTION_MIN_REWRITE_MS,
	foldBookCoverage,
	formatBookCoverage,
	formatRecentDays,
	hasAnyReading,
	naturalNextChapter,
	reflectionBasis,
	reflectionDecision,
	sanitizeReflection,
	storedReflectionAllowed,
	streakFromIntervals,
} from "../src/lib/reading-overview-rules.ts";

const BOOKS = [
	{ order: 59, name: "James", chapters: 5 },
	{ order: 60, name: "1 Peter", chapters: 5 },
	{ order: 66, name: "Revelation", chapters: 22 },
];

test("a streak ending today or yesterday is alive; older is broken", () => {
	const intervals = [
		{ startDate: "2026-09-01", endDate: "2026-09-10" },
		{ startDate: "2026-10-06", endDate: "2026-10-09" },
	];
	assert.deepEqual(streakFromIntervals(intervals, "2026-10-09"), {
		current: 4,
		longest: 10,
		atRisk: false,
		lastActiveDate: "2026-10-09",
	});
	assert.deepEqual(streakFromIntervals(intervals, "2026-10-10"), {
		current: 4,
		longest: 10,
		atRisk: true,
		lastActiveDate: "2026-10-09",
	});
	assert.equal(streakFromIntervals(intervals, "2026-10-11").current, 0);
	assert.equal(streakFromIntervals(intervals, "2026-10-11").longest, 10);
	assert.deepEqual(streakFromIntervals([], "2026-10-09"), { current: 0, longest: 0, atRisk: false, lastActiveDate: null });
});

test("a streak spanning month and DST boundaries counts calendar days", () => {
	assert.equal(streakFromIntervals([{ startDate: "2026-10-30", endDate: "2026-11-02" }], "2026-11-02").current, 4);
});

test("book coverage separates whole chapters from started ones", () => {
	const coverage = foldBookCoverage([
		{ book: 59, chapter: 4, entries: 2, chapterReadings: 0 },
		{ book: 59, chapter: 1, entries: 1, chapterReadings: 1 },
		{ book: 1, chapter: 1, entries: 0, chapterReadings: 0 },
		{ book: 59, chapter: 3, entries: 3, chapterReadings: 2 },
		{ book: 43, chapter: 3, entries: 1, chapterReadings: 1 },
	]);
	assert.deepEqual(coverage, [
		{ book: 43, complete: [3], started: [] },
		{ book: 59, complete: [1, 3], started: [4] },
	]);
	assert.equal(
		formatBookCoverage(coverage, [...BOOKS, { order: 43, name: "John", chapters: 21 }]),
		"James: 2 of 5 chapters complete, 1 started\nJohn: 1 of 21 chapters complete",
	);
});

test("recent days merge repeat chapters and mark parts and physical reading", () => {
	const text = formatRecentDays([
		{ book: 59, bookName: "James", chapter: 4, completed: false, localDate: "2026-10-09", source: "reader" },
		{ book: 59, bookName: "James", chapter: 4, completed: false, localDate: "2026-10-09", source: "reader" },
		{ book: 59, bookName: "James", chapter: 3, completed: true, localDate: "2026-10-08", source: "physical" },
		{ book: 59, bookName: "James", chapter: 2, completed: false, localDate: "2026-10-08", source: "reader" },
	]);
	assert.equal(text, "2026-10-09: James 4 (part)\n2026-10-08: James 3 [physical Bible], James 2 (part)");
	assert.equal(formatRecentDays([]), "(none)");
});

test("the reflection basis moves with any change to reading", () => {
	const totals = { chapterReadings: 3, partialReadings: 2, sessions: 4, lastReadAt: new Date("2026-10-09T14:41:58Z") };
	assert.equal(reflectionBasis(totals, true), "3:2:4:2026-10-09T14:41:58.000Z:m1");
	assert.notEqual(reflectionBasis({ ...totals, partialReadings: 3 }, true), reflectionBasis(totals, true));
	assert.notEqual(reflectionBasis(totals, false), reflectionBasis(totals, true));
	assert.equal(reflectionBasis(null, false), "none:m0");
	assert.equal(hasAnyReading(null), false);
	assert.equal(hasAnyReading({ ...totals, chapterReadings: 0, partialReadings: 0 }), false);
	assert.equal(hasAnyReading(totals), true);
});

test("a stored reflection is reused until reading changes, then rewritten no more than every few hours", () => {
	const now = new Date("2026-10-09T18:00:00Z");
	const at = (ms) => new Date(now.getTime() - ms);
	assert.equal(reflectionDecision(null, "a", now), "generate");
	assert.equal(reflectionDecision({ basis: "a", createdAt: at(REFLECTION_MAX_AGE_MS - 1) }, "a", now), "reuse");
	assert.equal(reflectionDecision({ basis: "a", createdAt: at(REFLECTION_MAX_AGE_MS) }, "a", now), "generate");
	assert.equal(reflectionDecision({ basis: "a", createdAt: at(REFLECTION_MIN_REWRITE_MS - 1) }, "b", now), "reuse");
	assert.equal(reflectionDecision({ basis: "a", createdAt: at(REFLECTION_MIN_REWRITE_MS) }, "b", now), "generate");
});

const resolvers = {
	bookNumber: (name) => BOOKS.find((book) => book.name.toLowerCase() === name.toLowerCase())?.order,
	bookMeta: (order) => BOOKS.find((book) => book.order === order) ?? null,
	verseText: async (book, chapter, verse) =>
		book === 59 && chapter === 4 && verse === 8 ? "Draw nigh to God, and he will draw nigh to you." : undefined,
	clean: (text) => text.replaceAll(String.fromCharCode(0x2014), ", "),
};

test("the reflection takes Scripture from the KJV, never from the model", async () => {
	const result = await sanitizeReflection(
		{
			title: "A week in James",
			reflection: `You have stayed in James${String.fromCharCode(0x2014)}the tongue and trials.`,
			verse: { book: "james", chapter: 4, verse: 8 },
			verseNote: "Your questions this week were about prayer.",
			next: { book: "James", chapter: 5, reason: "It finishes the letter." },
		},
		resolvers,
	);
	assert.deepEqual(result, {
		title: "A week in James",
		reflection: "You have stayed in James, the tongue and trials.",
		verse: {
			book: 59,
			bookName: "James",
			chapter: 4,
			verse: 8,
			text: "Draw nigh to God, and he will draw nigh to you.",
			note: "Your questions this week were about prayer.",
		},
		next: { book: 59, bookName: "James", chapter: 5, reason: "It finishes the letter." },
	});
});

test("an unknown verse or impossible chapter is dropped, and an empty reflection is refused", async () => {
	const result = await sanitizeReflection(
		{
			title: "",
			reflection: "Keep going.",
			verse: { book: "James", chapter: 9, verse: 1 },
			verseNote: null,
			next: { book: "1 Enoch", chapter: 1, reason: "Because." },
		},
		resolvers,
	);
	assert.deepEqual(result, { title: "Your walk", reflection: "Keep going.", verse: null, next: null });
	assert.equal(
		await sanitizeReflection({ title: "x", reflection: "  ", verse: null, verseNote: null, next: null }, resolvers),
		null,
	);
	const tooFar = await sanitizeReflection(
		{ title: "x", reflection: "y", verse: null, verseNote: null, next: { book: "James", chapter: 6, reason: "z" } },
		resolvers,
	);
	assert.equal(tooFar.next, null);
});

test("the natural next chapter rereads a partial chapter and crosses into the next book", () => {
	assert.deepEqual(naturalNextChapter({ book: 59, chapter: 4, completed: false }, BOOKS), { book: 59, chapter: 4 });
	assert.deepEqual(naturalNextChapter({ book: 59, chapter: 4, completed: true }, BOOKS), { book: 59, chapter: 5 });
	assert.deepEqual(naturalNextChapter({ book: 59, chapter: 5, completed: true }, BOOKS), { book: 60, chapter: 1 });
	assert.equal(naturalNextChapter({ book: 66, chapter: 22, completed: true }, BOOKS), null);
	assert.equal(naturalNextChapter(null, BOOKS), null);
});

test("turning memory off retires a reflection that was written from memories", () => {
	assert.equal(storedReflectionAllowed("3:2:4:never:m1", true), true);
	assert.equal(storedReflectionAllowed("3:2:4:never:m1", false), false);
	assert.equal(storedReflectionAllowed("3:2:4:never:m0", false), true);
});
