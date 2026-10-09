import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import BOOKS from "../src/data/books.json" with { type: "json" };
import {
	TALK_IT_OVER_PROMPT,
	dayHeading,
	defaultTestament,
	groupByDay,
	partialPercent,
	percentOfBible,
	readerHref,
	reflectionAge,
	streakNote,
	testamentProgress,
} from "../src/components/bible/readingOverview.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const shared = (source) => source.slice(source.indexOf("export interface ReadingStreak"));

const entry = (overrides) => ({
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

test("web and Android share one copy of the reading log presentation rules", () => {
	const web = read("../src/components/bible/readingOverview.ts");
	const marker = "\n// ---- Web-only helpers";
	assert.ok(web.includes(marker), "web module keeps its web-only marker");
	assert.equal(
		shared(web.slice(0, web.indexOf(marker))).trimEnd(),
		shared(read("../mobile/src/features/reading/readingOverview.ts")).trimEnd(),
	);
});

test("a chapter read twice in a day is one row that pools its partial verses", () => {
	const days = groupByDay(
		[
			entry({ verseRanges: [{ start: 6, end: 10 }] }),
			entry({ verseRanges: [{ start: 1, end: 5 }] }),
			entry({ book: 1, bookName: "Genesis", chapter: 1, completed: true, source: "physical", verseRanges: [] }),
			entry({ localDate: "2026-10-08", verseRanges: [{ start: 3, end: 3 }] }),
		],
		() => "Bible",
	);
	assert.deepEqual(days.map((day) => day.date), ["2026-10-09", "2026-10-08"]);
	const [james, genesis] = days[0].chapters;
	assert.equal(james.readings, 2);
	assert.equal(james.firstVerse, 1);
	assert.equal(james.completed, false);
	assert.equal(james.fraction, 10 / 17);
	assert.equal(genesis.completed, true);
	assert.equal(genesis.fraction, 1);
	assert.equal(genesis.physical, true);
	assert.equal(days[1].chapters[0].fraction, 1 / 17);
});

test("a reading without a verse count still renders as an unmeasured partial", () => {
	const [day] = groupByDay([entry({ chapterVerses: undefined, bookName: undefined })], () => "James");
	assert.equal(day.chapters[0].fraction, 0);
	assert.equal(day.chapters[0].bookName, "James");
	assert.equal(partialPercent(0), 6);
	assert.equal(partialPercent(0.5), 50);
});

test("day headings read like a journal", () => {
	const today = "2026-10-09";
	assert.equal(dayHeading("2026-10-09", today), "Today");
	assert.equal(dayHeading("2026-10-08", today), "Yesterday");
	assert.equal(dayHeading("2026-10-05", today), "Monday");
	assert.equal(dayHeading("2026-09-20", today), "Sunday, Sep 20");
	assert.equal(dayHeading("2025-12-31", today), "Dec 31, 2025");
	assert.equal(dayHeading("unknown", today), "Date not recorded");
});

test("a first chapter never reads as zero percent of the Bible", () => {
	assert.equal(percentOfBible(0, 1189), "0%");
	assert.equal(percentOfBible(1, 1189), "<1%");
	assert.equal(percentOfBible(12, 1189), "1%");
	assert.equal(percentOfBible(600, 1189), "50%");
});

test("the streak tile's line follows the Android rules", () => {
	assert.equal(streakNote({ current: 3, longest: 9, atRisk: true, lastActiveDate: null }), "Read today to keep it");
	assert.equal(streakNote({ current: 0, longest: 0, atRisk: false, lastActiveDate: null }), "Read today to start");
	assert.equal(streakNote({ current: 0, longest: 4, atRisk: false, lastActiveDate: null }), "Best 4");
	assert.equal(streakNote({ current: 5, longest: 5, atRisk: false, lastActiveDate: null }), "Your best yet");
	assert.equal(streakNote({ current: 2, longest: 7, atRisk: false, lastActiveDate: null }), "Best 7");
});

test("the Bible map opens on the testament with more reading", () => {
	assert.equal(defaultTestament(BOOKS, []), "NT");
	assert.equal(defaultTestament(BOOKS, [{ book: 1, complete: [1, 2], started: [3] }, { book: 40, complete: [1], started: [] }]), "OT");
	assert.equal(defaultTestament(BOOKS, [{ book: 19, complete: [23], started: [] }, { book: 43, complete: [3], started: [] }]), "NT");
	const nt = testamentProgress(BOOKS, [{ book: 43, complete: [1, 3], started: [2] }], "NT");
	assert.equal(nt.length, 27);
	assert.equal(nt[0].name, "Matthew");
	const john = nt.find((book) => book.order === 43);
	assert.deepEqual([...john.complete], [1, 3]);
	assert.deepEqual([...john.started], [2]);
	assert.equal(testamentProgress(BOOKS, [], "OT").length, 39);
});

test("reader links match the web reader's query scheme", () => {
	assert.equal(readerHref({ book: 43, chapter: 3 }), "/bible/chapter?book=43&chapter=3");
	assert.equal(
		readerHref({ book: 43, chapter: 3, verse: 16, translation: "KJV" }),
		"/bible/chapter?book=43&chapter=3&verse=16&translation=KJV",
	);
	assert.equal(TALK_IT_OVER_PROMPT, "Help me go deeper in what I have been reading lately.");
});

test("the reflection says when it was written", () => {
	const now = new Date(2026, 9, 9, 18, 0);
	assert.equal(reflectionAge(new Date(2026, 9, 9, 7, 0).toISOString(), now), "Written today from your reading");
	assert.equal(reflectionAge(new Date(2026, 9, 8, 22, 0).toISOString(), now), "Written yesterday from your reading");
	assert.equal(reflectionAge(new Date(2026, 9, 2, 9, 0).toISOString(), now), "Written Oct 2 from your reading");
	assert.equal(reflectionAge("not a date", now), "");
});
