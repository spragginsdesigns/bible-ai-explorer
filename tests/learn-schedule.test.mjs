import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

// The real local-day helpers, so the ladder is tested against the same
// definition of a day the reading streak uses.
const { localDayKey, resolveReadingTimezone, shiftDayKey } = loadModule(
	"../src/lib/reading-history.ts",
	["localDayKey", "resolveReadingTimezone", "shiftDayKey"]
);

const {
	LEARN_KNOWN_INTERVAL_DAYS,
	maskVerse,
	reviewCard,
	startOfLocalDay,
	startOfToday,
	startOfTomorrow,
	toLearnStage,
} = loadModule(
	"../src/lib/learn-schedule.ts",
	[
		"LEARN_KNOWN_INTERVAL_DAYS",
		"maskVerse",
		"reviewCard",
		"startOfLocalDay",
		"startOfToday",
		"startOfTomorrow",
		"toLearnStage",
	],
	{ localDayKey, resolveReadingTimezone, shiftDayKey }
);

const LA = "America/Los_Angeles";
const JOHN_3_16 =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

const iso = (date) => date.toISOString();
const card = (stage, intervalDays, knownAt = null) => ({ stage, intervalDays, knownAt });

test("a card climbs stage 0 to 3 in one sitting, then buys days by doubling", () => {
	// 11:00 in Los Angeles on 2026-09-12.
	const now = new Date("2026-09-12T18:00:00Z");
	const todayMidnight = "2026-09-12T07:00:00.000Z";

	let state = card(0, 0);
	const sameDay = [];
	for (let step = 0; step < 3; step += 1) {
		const next = reviewCard(state, "good", now, LA);
		sameDay.push([next.stage, next.intervalDays, iso(next.dueAt)]);
		state = card(next.stage, next.intervalDays, next.knownAt);
	}
	assert.deepEqual(sameDay, [
		[1, 0, todayMidnight],
		[2, 0, todayMidnight],
		[3, 0, todayMidnight],
	]);
	assert.equal(state.knownAt, null);

	// From stage 3 the ladder stops climbing and starts spacing.
	const intervals = [];
	for (let step = 0; step < 6; step += 1) {
		const next = reviewCard(state, "good", now, LA);
		intervals.push([next.stage, next.intervalDays, iso(next.dueAt), next.knownAt === null]);
		state = card(next.stage, next.intervalDays, next.knownAt);
	}
	assert.deepEqual(intervals, [
		[3, 1, "2026-09-13T07:00:00.000Z", true],
		[3, 2, "2026-09-14T07:00:00.000Z", true],
		[3, 4, "2026-09-16T07:00:00.000Z", true],
		[3, 8, "2026-09-20T07:00:00.000Z", true],
		[3, 16, "2026-09-28T07:00:00.000Z", false],
		[3, 32, "2026-10-14T07:00:00.000Z", false],
	]);

	// knownAt lands exactly on the review that reached 16 days, and never moves.
	assert.equal(iso(state.knownAt), iso(now));
	assert.equal(LEARN_KNOWN_INTERVAL_DAYS, 16);
	const later = reviewCard(state, "good", new Date("2026-10-14T18:00:00Z"), LA);
	assert.equal(iso(later.knownAt), iso(now));
});

test("again drops any stage to 1, clears the interval and brings the card back today", () => {
	const now = new Date("2026-09-12T18:00:00Z");
	const todayMidnight = "2026-09-12T07:00:00.000Z";
	for (const [stage, intervalDays] of [
		[0, 0],
		[1, 0],
		[2, 0],
		[3, 32],
	]) {
		const next = reviewCard(card(stage, intervalDays), "again", now, LA);
		assert.deepEqual(
			[next.stage, next.intervalDays, iso(next.dueAt)],
			[1, 0, todayMidnight],
			`again at stage ${stage}`
		);
		assert.equal(next.knownAt, null);
		assert.equal(iso(next.lastReviewedAt), iso(now));
	}
});

test("a verse already known stays known after a failed recall", () => {
	const knownAt = new Date("2026-09-01T12:00:00Z");
	const next = reviewCard(card(3, 32, knownAt), "again", new Date("2026-09-12T18:00:00Z"), LA);
	assert.equal(iso(next.knownAt), iso(knownAt));
	assert.equal(next.intervalDays, 0);
});

test("the day rolls over on the user's midnight, not UTC's", () => {
	// 23:30 on 2026-09-12 in Los Angeles, already 2026-09-13 in UTC.
	const beforeMidnight = new Date("2026-09-13T06:30:00Z");
	const afterMidnight = new Date("2026-09-13T07:30:00Z");

	const before = reviewCard(card(3, 8), "good", beforeMidnight, LA);
	const after = reviewCard(card(3, 8), "good", afterMidnight, LA);
	assert.equal(iso(before.dueAt), "2026-09-28T07:00:00.000Z");
	assert.equal(iso(after.dueAt), "2026-09-29T07:00:00.000Z");

	// The same instants in a zone east of UTC land on their own days.
	const tokyo = reviewCard(card(3, 8), "good", beforeMidnight, "Asia/Tokyo");
	assert.equal(iso(tokyo.dueAt), "2026-09-28T15:00:00.000Z"); // 2026-09-29 00:00 JST

	// An unusable timezone falls back rather than throwing.
	const fallback = reviewCard(card(3, 8), "good", beforeMidnight, "Mars/Olympus");
	assert.equal(iso(fallback.dueAt), iso(before.dueAt));
});

test("a due date spanning the end of daylight saving keeps local midnight", () => {
	// Clocks in Los Angeles go back at 02:00 on 2026-11-01.
	assert.equal(iso(startOfLocalDay("2026-10-31", LA)), "2026-10-31T07:00:00.000Z");
	assert.equal(iso(startOfLocalDay("2026-11-01", LA)), "2026-11-01T07:00:00.000Z");
	assert.equal(iso(startOfLocalDay("2026-11-02", LA)), "2026-11-02T08:00:00.000Z");

	const now = new Date("2026-10-30T18:00:00Z");
	assert.equal(iso(startOfToday(now, LA)), "2026-10-30T07:00:00.000Z");
	assert.equal(iso(startOfTomorrow(now, LA)), "2026-10-31T07:00:00.000Z");
	// Four days on from 2026-10-30 is 2026-11-03, one hour further from UTC.
	assert.equal(iso(reviewCard(card(3, 2), "good", now, LA).dueAt), "2026-11-03T08:00:00.000Z");
});

test("a stage outside the ladder is clamped instead of trusted", () => {
	assert.equal(toLearnStage(-4), 0);
	assert.equal(toLearnStage(9), 3);
	assert.equal(toLearnStage(Number.NaN), 0);
	// A row written by a newer client cannot make the ladder climb past 3.
	const next = reviewCard(card(9, 0), "good", new Date("2026-09-12T18:00:00Z"), LA);
	assert.equal(next.stage, 3);
	assert.equal(next.intervalDays, 1);
});

const bodies = (masked) => masked.words.filter((word) => word.hidden).map((word) => word.index);

test("masking thins the verse a rung at a time", () => {
	const stage0 = maskVerse(JOHN_3_16, 0);
	assert.equal(stage0.words.length, 25);
	assert.deepEqual(bodies(stage0), []);
	assert.equal(stage0.words.map((word) => word.word).join(" "), JOHN_3_16);

	assert.deepEqual(bodies(maskVerse(JOHN_3_16, 1)), [3, 7, 11, 15, 19, 23]);
	assert.deepEqual(
		bodies(maskVerse(JOHN_3_16, 2)),
		[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]
	);
	assert.deepEqual(
		bodies(maskVerse(JOHN_3_16, 3)),
		Array.from({ length: 25 }, (_, index) => index)
	);
});

test("punctuation stays beside the blank", () => {
	// "world," is the sixth word, hidden from stage 2 on.
	const hiddenWorld = maskVerse(JOHN_3_16, 2).words[5];
	assert.deepEqual(hiddenWorld, {
		index: 5,
		word: "world,",
		prefix: "",
		body: "world",
		suffix: ",",
		hidden: true,
	});
	// The contract's own example, with the colon the KJV uses elsewhere.
	const colon = maskVerse("God so loved the world:", 3).words[4];
	assert.deepEqual(
		[colon.prefix, colon.body, colon.suffix, colon.hidden],
		["", "world", ":", true]
	);
	// Leading punctuation is visible too, and a token is always its three parts.
	for (const word of maskVerse("(For God so loved the world:)", 3).words) {
		assert.equal(word.prefix + word.body + word.suffix, word.word);
	}
	const bracket = maskVerse("(For God so loved the world:)", 3).words[0];
	assert.deepEqual([bracket.prefix, bracket.body, bracket.suffix], ["(", "For", ""]);
	// A punctuation-only token has nothing to hide.
	const dash = maskVerse("God -- loved", 3).words[1];
	assert.deepEqual([dash.body, dash.hidden], ["", false]);
});

test("masking survives odd whitespace and an empty verse", () => {
	assert.deepEqual(maskVerse("   ", 3).words, []);
	assert.deepEqual(
		maskVerse("  For  God\nso loved ", 3).words.map((word) => word.word),
		["For", "God", "so", "loved"]
	);
});
