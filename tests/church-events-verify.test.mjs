/* The pipeline's half of the honesty rule: an announced event is kept only if
 * it was really said, and a time is "certain" only when the recording itself
 * backs it up, whatever the model claims. */
import assert from "node:assert/strict";
import test from "node:test";

import { verifyEvents } from "../scripts/sermon/lib.mjs";

const SUNDAY = "2026-10-18";
const cues = [
	{ startMs: 0, endMs: 9_000, text: "Good morning church, a few announcements before we go." },
	{ startMs: 10_000, endMs: 19_000, text: "The trustees will meet this Tuesday at 6:30 in the fellowship hall." },
	{ startMs: 20_000, endMs: 29_000, text: "Ladies, your fellowship lunch is next Saturday, so bring a dish to share." },
	{ startMs: 30_000, endMs: 39_000, text: "Choir rehearsal is tomorrow evening at seven, everyone welcome." },
];

function raw(overrides = {}) {
	return {
		title: "Trustees meeting",
		details: null,
		audience: "trustees",
		location: "Fellowship hall",
		date: "2026-10-20",
		dateWords: "this Tuesday",
		startTime: "18:30",
		endTime: null,
		certainty: "certain",
		unsureWhy: null,
		sourceQuote: "The trustees will meet this Tuesday at 6:30 in the fellowship hall.",
		quoteAtMs: 10_000,
		...overrides,
	};
}

const verify = (event) => verifyEvents(cues, [event], SUNDAY);

test("a verbatim announcement with its time spoken is certain", () => {
	const { events, dropped } = verify(raw());
	assert.deepEqual(dropped, []);
	assert.equal(events[0].certain, true);
	assert.equal(events[0].sourceMs, 10_000);
});

test("a spelled-out hour counts as spoken", () => {
	const { events } = verify(
		raw({
			title: "Choir rehearsal",
			date: "2026-10-19",
			dateWords: "tomorrow evening",
			startTime: "19:00",
			sourceQuote: "Choir rehearsal is tomorrow evening at seven, everyone welcome.",
			quoteAtMs: 30_000,
		})
	);
	assert.equal(events[0].certain, true);
});

test("a time the recording never said is not certain", () => {
	const { events } = verify(
		raw({
			title: "Ladies fellowship lunch",
			date: "2026-10-24",
			dateWords: "next Saturday",
			startTime: "11:00",
			sourceQuote: "Ladies, your fellowship lunch is next Saturday, so bring a dish to share.",
			quoteAtMs: 20_000,
		})
	);
	assert.equal(events[0].certain, false);
	assert.match(events[0].unsureWhy, /not heard/);
});

test("a stray number nearby is not a spoken time", () => {
	const stray = [
		{ startMs: 0, endMs: 9_000, text: "Turn with me to Luke 2, and one more thing." },
		{ startMs: 10_000, endMs: 19_000, text: "Our youth will gather after church in the fellowship hall." },
	];
	const { events } = verifyEvents(
		stray,
		[
			raw({
				title: "Youth gathering",
				date: SUNDAY,
				dateWords: "after church",
				startTime: "13:00",
				sourceQuote: "Our youth will gather after church in the fellowship hall.",
			}),
		],
		SUNDAY
	);
	assert.equal(events[0].certain, false);
	assert.match(events[0].unsureWhy, /not heard/);
});

test("a paraphrased quote is replaced by the real sentence and is never certain", () => {
	const { events } = verify(raw({ sourceQuote: "Trustees meet this Tuesday at 6:30 in the hall." }));
	assert.equal(events[0].sourceQuote, "The trustees will meet this Tuesday at 6:30 in the fellowship hall.");
	assert.equal(events[0].certain, false);
	assert.match(events[0].unsureWhy, /not quoted exactly/);
});

test("an announcement that is not in the recording is dropped", () => {
	const { events, dropped } = verify(raw({ sourceQuote: "Revival services all week at Oroville.", quoteAtMs: 90_000 }));
	assert.equal(events.length, 0);
	assert.match(dropped[0].why, /not found/);
});

test("tomorrow and named weekdays are checked against the service date", () => {
	const tomorrow = verify(
		raw({
			title: "Choir rehearsal",
			date: "2026-10-20",
			dateWords: "tomorrow evening",
			startTime: "19:00",
			sourceQuote: "Choir rehearsal is tomorrow evening at seven, everyone welcome.",
			quoteAtMs: 30_000,
		})
	);
	assert.equal(tomorrow.events[0].certain, false);
	assert.match(tomorrow.events[0].unsureWhy, /is not 2026-10-20/);
	const weekday = verify(raw({ date: "2026-10-21" }));
	assert.equal(weekday.events[0].certain, false);
	assert.match(weekday.events[0].unsureWhy, /does not fall on/);
});

test("end times compare as clock times, not strings", () => {
	const quote = "The trustees will meet this Tuesday at 6:30 in the fellowship hall.";
	const morning = verifyEvents(
		[{ startMs: 10_000, endMs: 19_000, text: "Prayer breakfast this Tuesday from 9:30 to 10:00 in the hall." }],
		[raw({ startTime: "9:30", endTime: "10:00", sourceQuote: "Prayer breakfast this Tuesday from 9:30 to 10:00 in the hall." })],
		SUNDAY
	);
	assert.equal(morning.events[0].endTime, "10:00");
	const backwards = verify(raw({ endTime: "17:00", sourceQuote: quote }));
	assert.equal(backwards.events[0].endTime, null);
});
