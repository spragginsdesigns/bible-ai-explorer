import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReview, maskVerse, parseToday, verseWords } from "../src/components/learn/learn.ts";

/**
 * The N4 ladder fixture every client shares (docs/FEATURES.md). Mirrors
 * mobile/src/features/learn/learn.test.ts and must assert the same things.
 */
const JOHN_3_16 =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

const card = {
	id: "a",
	book: 43,
	chapter: 3,
	verse: 16,
	translation: "KJV",
	reference: "John 3:16",
	text: JOHN_3_16,
	stage: 0,
	intervalDays: 0,
	dueAt: "2026-09-12T00:00:00Z",
	knownAt: null,
};

test("stage 0 keeps the whole verse", () => {
	assert.equal(maskVerse(JOHN_3_16, 0), JOHN_3_16);
});

test("stage 1 hides every fourth word", () => {
	assert.equal(
		maskVerse(JOHN_3_16, 1),
		"For God so ____ the world, that ____ gave his only ____ Son, that whosoever ____ in him should ____ perish, but have ____ life."
	);
});

test("stage 2 hides half the words", () => {
	assert.equal(
		maskVerse(JOHN_3_16, 2),
		"For ____ so ____ the ____, that ____ gave ____ only ____ Son, ____ whosoever ____ in ____ should ____ perish, ____ have ____ life."
	);
});

test("stage 3 hides every word", () => {
	assert.ok(verseWords(JOHN_3_16, 3).every((word) => word.hidden));
});

test("punctuation survives and whitespace trims", () => {
	assert.equal(maskVerse("  “For God so loved,”  ", 3), "“____ ____ ____ ____,”");
});

test("same-day stages stay on screen; again resets to stage one", () => {
	const today = { cards: [card], knownCount: 0, queueCount: 1 };
	assert.equal(applyReview(today, card, { ...card, stage: 1 }, "good").cards[0].stage, 1);
	assert.equal(
		applyReview(today, { ...card, stage: 3 }, { ...card, stage: 1 }, "again").cards.length,
		1
	);
});

test("a completed recall leaves today and counts known once", () => {
	const before = { ...card, stage: 3 };
	const updated = { ...before, intervalDays: 16, knownAt: "2026-09-12T01:00:00Z" };
	assert.deepEqual(
		applyReview({ cards: [before], knownCount: 0, queueCount: 1 }, before, updated, "good"),
		{ cards: [], knownCount: 1, queueCount: 1 }
	);
	assert.equal(
		applyReview({ cards: [updated], knownCount: 1, queueCount: 1 }, updated, updated, "good")
			.knownCount,
		1
	);
});

test("malformed or mismatched responses are rejected", () => {
	assert.throws(() => parseToday({ cards: [card, card], knownCount: 0, queueCount: 2 }));
	assert.throws(() =>
		parseToday({ cards: [{ ...card, translation: "unknown" }], knownCount: 0, queueCount: 1 })
	);
	assert.throws(() =>
		applyReview({ cards: [card], knownCount: 0, queueCount: 1 }, card, { ...card, id: "b" }, "good")
	);
});
