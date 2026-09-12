import { test } from "node:test";
import assert from "node:assert/strict";
import {
	applyReviewAcknowledgement,
	maskVerse,
	parseReviewAcknowledgement,
	parseToday,
	verseWords,
} from "../src/components/learn/learn.ts";

/** The N4 ladder fixture shared with the Android Learn contract tests. */
const JOHN_3_16 =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

const card = {
	id: "a",
	revision: 0,
	book: 43,
	chapter: 3,
	verse: 16,
	translation: "KJV",
	reference: "John 3:16",
	text: JOHN_3_16,
	stage: 0,
	intervalDays: 0,
	dueAt: "2026-09-12T07:00:00.000Z",
	knownAt: null,
};

const receivedAt = new Date("2026-09-12T18:00:00.000Z");
const timezone = "America/Los_Angeles";

function operation(before, result, operationId) {
	return {
		result,
		operationId,
		expectedRevision: before.revision,
		reviewedAt: receivedAt.toISOString(),
		timezone,
	};
}

function acknowledgement(before, payload, currentCard, replayed = false) {
	return parseReviewAcknowledgement({
		operationId: payload.operationId,
		appliedRevision: before.revision + 1,
		replayed,
		currentCard,
	}, payload.operationId);
}

function apply(today, before, result, currentCard, operationId, replayed = false) {
	const payload = operation(before, result, operationId);
	return applyReviewAcknowledgement(
		today,
		before,
		payload,
		acknowledgement(before, payload, currentCard, replayed),
		receivedAt,
		timezone,
	);
}

test("stage 0 keeps the whole verse", () => {
	assert.equal(maskVerse(JOHN_3_16, 0), JOHN_3_16);
});

test("stage 1 hides every fourth word", () => {
	assert.equal(
		maskVerse(JOHN_3_16, 1),
		"For God so ____ the world, that ____ gave his only ____ Son, that whosoever ____ in him should ____ perish, but have ____ life.",
	);
});

test("stage 2 hides half the words", () => {
	assert.equal(
		maskVerse(JOHN_3_16, 2),
		"For ____ so ____ the ____, that ____ gave ____ only ____ Son, ____ whosoever ____ in ____ should ____ perish, ____ have ____ life.",
	);
});

test("stage 3 hides every word", () => {
	assert.ok(verseWords(JOHN_3_16, 3).every((word) => word.hidden));
});

test("punctuation survives and whitespace trims", () => {
	assert.equal(maskVerse("  “For God so loved,”  ", 3), "“____ ____ ____ ____,”");
});

test("same-day stages stay on screen and again resets to stage one", () => {
	const today = { cards: [card], knownCount: 0, queueCount: 1 };
	const stageOne = { ...card, revision: 1, stage: 1 };
	assert.equal(
		apply(today, card, "good", stageOne, "11111111-1111-4111-8111-111111111111").cards[0].stage,
		1,
	);

	const recall = { ...card, revision: 3, stage: 3 };
	const reset = { ...card, revision: 4, stage: 1 };
	assert.equal(
		apply(
			{ cards: [recall], knownCount: 0, queueCount: 1 },
			recall,
			"again",
			reset,
			"22222222-2222-4222-8222-222222222222",
		).cards.length,
		1,
	);
});

test("a completed recall leaves today and counts known once", () => {
	const before = { ...card, revision: 3, stage: 3 };
	const updated = {
		...before,
		revision: 4,
		intervalDays: 16,
		dueAt: "2026-09-28T07:00:00.000Z",
		knownAt: "2026-09-12T18:00:00.000Z",
	};
	assert.deepEqual(
		apply(
			{ cards: [before], knownCount: 0, queueCount: 1 },
			before,
			"good",
			updated,
			"33333333-3333-4333-8333-333333333333",
		),
		{ cards: [], knownCount: 1, queueCount: 1 },
	);

	const knownBefore = { ...updated, dueAt: card.dueAt };
	const knownAfter = { ...knownBefore, revision: 5, dueAt: "2026-10-14T07:00:00.000Z" };
	assert.equal(
		apply(
			{ cards: [knownBefore], knownCount: 1, queueCount: 1 },
			knownBefore,
			"good",
			knownAfter,
			"44444444-4444-4444-8444-444444444444",
		).knownCount,
		1,
	);
});

test("a replay uses its latest schedule and removes a card due after today", () => {
	const before = { ...card, revision: 3, stage: 3 };
	const newer = {
		...before,
		revision: 6,
		intervalDays: 8,
		dueAt: "2026-09-20T07:00:00.000Z",
	};
	assert.deepEqual(
		apply(
			{ cards: [before], knownCount: 0, queueCount: 1 },
			before,
			"good",
			newer,
			"55555555-5555-4555-8555-555555555555",
			true,
		).cards,
		[],
	);
});

test("malformed and mismatched modern responses are rejected", () => {
	assert.throws(() => parseToday({ cards: [card, card], knownCount: 0, queueCount: 2 }));
	assert.throws(() =>
		parseToday({ cards: [{ ...card, translation: "unknown" }], knownCount: 0, queueCount: 1 }),
	);

	const payload = operation(card, "good", "66666666-6666-4666-8666-666666666666");
	assert.throws(() => parseReviewAcknowledgement({
		operationId: "77777777-7777-4777-8777-777777777777",
		appliedRevision: 1,
		replayed: false,
		currentCard: { ...card, revision: 1, stage: 1 },
	}, payload.operationId));
	assert.throws(() => applyReviewAcknowledgement(
		{ cards: [card], knownCount: 0, queueCount: 1 },
		card,
		payload,
		{
			operationId: payload.operationId,
			appliedRevision: 1,
			replayed: false,
			currentCard: { ...card, id: "b", revision: 1, stage: 1 },
		},
		receivedAt,
		timezone,
	));
});
