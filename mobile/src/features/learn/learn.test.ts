import { describe, expect, it } from "vitest";
import * as mobileLearn from "./learn";
import * as webLearn from "../../../../src/components/learn/learn";

const verse = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
const card: mobileLearn.LearnCard = {
	id: "a",
	revision: 0,
	book: 43,
	chapter: 3,
	verse: 16,
	translation: "KJV",
	reference: "John 3:16",
	text: verse,
	stage: 0,
	intervalDays: 0,
	dueAt: "2026-09-12T07:00:00.000Z",
	knownAt: null,
};

for (const [client, learn] of [["Android", mobileLearn], ["web", webLearn]] as const) {
	describe(`${client} Learn contract`, () => {
		it("keeps KJV text at the read stage", () => expect(learn.maskVerse(verse, 0)).toBe(verse));
		it("hides every fourth word", () => expect(learn.maskVerse(verse, 1)).toBe(
			"For God so ____ the world, that ____ gave his only ____ Son, that whosoever ____ in him should ____ perish, but have ____ life.",
		));
		it("hides half the words", () => expect(learn.maskVerse(verse, 2)).toBe(
			"For ____ so ____ the ____, that ____ gave ____ only ____ Son, ____ whosoever ____ in ____ should ____ perish, ____ have ____ life.",
		));
		it("hides all words for reference recall", () =>
			expect(learn.verseWords(verse, 3).every((word) => word.hidden)).toBe(true));
		it("preserves punctuation and trims surrounding whitespace", () =>
			expect(learn.maskVerse("  “For God so loved,”  ", 3)).toBe("“____ ____ ____ ____,”"));
		it("accepts an unavailable requested translation without substituting text", () => {
			const unavailable = learn.parseCard({
				...card,
				translation: "NKJV",
				text: "",
				textUnavailable: true,
			});
			expect(unavailable.translation).toBe("NKJV");
			expect(unavailable.text).toBe("");
		});
		it("applies a replayed receipt and rejects a mismatched receipt", () => {
			const payload = {
				result: "good" as const,
				operationId: "11111111-1111-4111-8111-111111111111",
				expectedRevision: 0,
				reviewedAt: "2026-09-12T18:00:00.000Z",
				timezone: "America/Los_Angeles",
			};
			const acknowledgement = learn.parseReviewAcknowledgement({
				operationId: payload.operationId,
				appliedRevision: 1,
				replayed: true,
				currentCard: { ...card, revision: 1, stage: 1 },
			}, payload.operationId);
			const next = learn.applyReviewAcknowledgement(
				{ cards: [card], knownCount: 0, queueCount: 1 },
				card,
				payload,
				acknowledgement,
			);
			expect(next.cards[0]).toMatchObject({ revision: 1, stage: 1 });
			expect(() => learn.parseReviewAcknowledgement({
				...acknowledgement,
				operationId: "22222222-2222-4222-8222-222222222222",
			}, payload.operationId)).toThrow(/receipt/);
		});
		it("uses the device day boundary for a replay receipt's current schedule", () => {
			const before = { ...card, stage: 3 as const };
			const payload = {
				result: "good" as const,
				operationId: "33333333-3333-4333-8333-333333333333",
				expectedRevision: 0,
				reviewedAt: "2026-09-12T18:00:00.000Z",
				timezone: "America/Los_Angeles",
			};
			const baseToday = { cards: [before], knownCount: 0, queueCount: 1 };
			const receipt = {
				operationId: payload.operationId,
				appliedRevision: 1,
				replayed: true,
				currentCard: { ...before, revision: 2, stage: 3 as const },
			};
			const sameDay = learn.applyReviewAcknowledgement(
				baseToday,
				before,
				payload,
				{ ...receipt, currentCard: { ...receipt.currentCard, dueAt: "2026-09-12T23:00:00.000Z" } },
				new Date("2026-09-12T18:00:00.000Z"),
				"America/Los_Angeles",
			);
			const nextDay = learn.applyReviewAcknowledgement(
				baseToday,
				before,
				payload,
				{ ...receipt, currentCard: { ...receipt.currentCard, dueAt: "2026-09-13T07:00:00.000Z" } },
				new Date("2026-09-12T18:00:00.000Z"),
				"America/Los_Angeles",
			);
			expect(sameDay.cards).toHaveLength(1);
			expect(nextDay.cards).toEqual([]);
		});
		it("rejects malformed and duplicate cards", () => {
			expect(() => learn.parseToday({ cards: [card, card], knownCount: 0, queueCount: 2 })).toThrow();
			expect(() => learn.parseToday({
				cards: [{ ...card, translation: "unknown" }],
				knownCount: 0,
				queueCount: 1,
			})).toThrow();
		});
	});
}
