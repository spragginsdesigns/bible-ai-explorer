import { describe, expect, it } from "vitest";
import * as mobilePractice from "./practice";
import * as webPractice from "../../../../src/components/learn/practice";
import type { LearnMode, OrderRound, OrderTap } from "./practice";

/** The ladder fixture, 25 words, shared with the web practice contract tests. */
const JOHN_3_16 =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

const OPENING = "For God so loved the world";

const CARD = Object.freeze({ id: "card-1", revision: 2, stage: 2 });

const sorted = (words: readonly string[]) => [...words].sort();

for (const [client, practice] of [["Android", mobilePractice], ["web", webPractice]] as const) {
	/** Taps the round through in the order the verse is written. */
	const playRound = (round: OrderRound): OrderTap[] => {
		let placed: number[] = [];
		const taps: OrderTap[] = [];
		while (placed.length < round.answer.length) {
			const want = round.answer[placed.length];
			const choice = round.choices.findIndex((word, index) =>
				word === want && !placed.includes(index));
			const tap = practice.tapOrderWord(round, placed, choice);
			taps.push(tap);
			placed = tap.placed;
		}
		return taps;
	};

	describe(`${client} Learn practice modes`, () => {
		it("collapses every word to its first letter, keeping punctuation and hyphens", () => {
			expect(practice.firstLetterWords(JOHN_3_16).map((word) => word.clue).join(" "))
				.toBe("F G s l t w, t h g h o b S, t w b i h s n p, b h e l.");
			expect(practice.firstLetterWords('"Well-beloved, my dearly-loved friend’s hope!"')
				.map((word) => word.clue))
				.toEqual(['"W-b,', "m", "d-l", "f", 'h!"']);
			expect(practice.firstLetterWords(OPENING).map((word) => word.text))
				.toEqual(OPENING.split(" "));
		});

		it("offers exactly the verse's words, shuffled", () => {
			const round = practice.orderRound(OPENING, 7);
			expect(round.answer).toEqual(OPENING.split(" "));
			expect(sorted(round.choices)).toEqual(sorted(round.answer));
			expect(round.partial).toBe(false);
			expect(round.choices).not.toEqual(round.answer);
		});

		it("practices a long verse a part at a time, within the cap", () => {
			const first = practice.orderRound(JOHN_3_16, 0);
			const second = practice.orderRound(JOHN_3_16, 1);
			expect(first.partial).toBe(true);
			expect(first.start).toBe(0);
			expect(first.answer.length).toBeLessThanOrEqual(practice.LEARN_ORDER_WORD_CAP);
			expect(second.answer.length).toBeLessThanOrEqual(practice.LEARN_ORDER_WORD_CAP);
			expect(second.start).toBe(first.answer.length);
			expect([...first.answer, ...second.answer]).toEqual(JOHN_3_16.split(" "));
			expect(sorted(second.choices)).toEqual(sorted(second.answer));

			const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
			for (const seed of [0, 1, 2, 3]) {
				expect(practice.orderRound(long, seed).answer.length)
					.toBeLessThanOrEqual(practice.LEARN_ORDER_WORD_CAP);
			}
		});

		it("accepts the next word and refuses any other, without ending the round", () => {
			const round = practice.orderRound(OPENING, 3);
			const taps = playRound(round);
			expect(taps.every((tap) => tap.correct)).toBe(true);
			expect(taps[taps.length - 1].done).toBe(true);
			expect(taps[taps.length - 1].placed.map((choice) => round.choices[choice]))
				.toEqual(OPENING.split(" "));

			const opened = practice.tapOrderWord(round, [], round.choices.indexOf("For"));
			expect(opened.correct).toBe(true);
			const wrong = practice.tapOrderWord(round, opened.placed, round.choices.indexOf("world"));
			expect(wrong.correct).toBe(false);
			expect(wrong.placed).toEqual(opened.placed);
			expect(wrong.done).toBe(false);
			expect(wrong.expected === null ? "" : round.choices[wrong.expected]).toBe("God");

			const repeat = practice.tapOrderWord(round, opened.placed, opened.placed[0]);
			expect(repeat.correct).toBe(false);
			expect(repeat.placed).toEqual(opened.placed);
		});

		it("scores typed words past capitals, punctuation and hyphens", () => {
			const exact = practice.scoreTypedVerse(JOHN_3_16, JOHN_3_16);
			expect(exact.perfect).toBe(true);
			expect(exact.empty).toBe(false);
			expect(exact.words.every((word) => word.result === "match")).toBe(true);

			for (const typed of [
				JOHN_3_16.toUpperCase(),
				JOHN_3_16.toLowerCase(),
				JOHN_3_16.replace(/[,.]/g, ""),
				`${JOHN_3_16}\n`,
			]) {
				expect(practice.scoreTypedVerse(JOHN_3_16, typed).perfect).toBe(true);
			}

			// A translation's own spelling still has to be typed.
			expect(practice.scoreTypedVerse(JOHN_3_16, JOHN_3_16.replace("believeth", "believes")).perfect)
				.toBe(false);
			expect(practice.scoreTypedVerse("his well-beloved son", "his well beloved son").perfect).toBe(true);
			expect(practice.scoreTypedVerse("", "anything").perfect).toBe(false);
			expect(practice.scoreTypedVerse(JOHN_3_16, "   ").empty).toBe(true);
		});

		it("names the missing and the extra words where they belong", () => {
			const score = practice.scoreTypedVerse(OPENING, "For so loved the whole world indeed");
			expect(score.words.map((word) => `${word.result}:${word.expected ?? word.typed}`)).toEqual([
				"match:For",
				"missed:God",
				"match:so",
				"match:loved",
				"match:the",
				"extra:whole",
				"match:world",
				"extra:indeed",
			]);
			expect(score.perfect).toBe(false);
			expect(score.words.filter((word) => word.result === "match")).toHaveLength(5);

			const missingTail = practice.scoreTypedVerse(OPENING, "For God so");
			expect(missingTail.words.filter((word) => word.result === "missed").map((word) => word.expected))
				.toEqual(["loved", "the", "world"]);
		});

		it("picks the mode from how well the verse is known", () => {
			expect(practice.defaultLearnMode({ ...CARD, stage: 0 })).toBe("blanks");
			expect(practice.defaultLearnMode({ ...CARD, stage: 1 })).toBe("blanks");
			expect(practice.defaultLearnMode({ ...CARD, stage: 3 })).toBe("typed");
			for (const revision of [0, 1, 2, 3]) {
				expect(["letters", "order"]).toContain(practice.defaultLearnMode({ ...CARD, revision }));
			}
			// A verse being recalled comes back the other way after a review.
			expect(practice.defaultLearnMode({ ...CARD, revision: 4 }))
				.not.toBe(practice.defaultLearnMode({ ...CARD, revision: 5 }));
			expect(practice.LEARN_MODES).toEqual(["blanks", "letters", "order", "typed"]);
			expect(practice.LEARN_MODES.every((mode) => practice.LEARN_MODE_LABELS[mode].length > 0)).toBe(true);
			expect(practice.isLearnMode("typed")).toBe(true);
			expect(practice.isLearnMode("quiz")).toBe(false);
		});

		it("changes nothing about the card when the reader switches modes", () => {
			const card = Object.freeze({ id: "card-1", revision: 2, stage: 0 });
			const opened = practice.resolveLearnMode(card, null);
			expect(opened).toEqual({ cardId: "card-1", revision: 2, mode: "blanks", chosen: false });

			const chosen = practice.chooseLearnMode(card, "typed");
			expect(card).toEqual({ id: "card-1", revision: 2, stage: 0 });
			expect(chosen).toEqual({ cardId: "card-1", revision: 2, mode: "typed", chosen: true });
			// The hand-picked mode holds for the card in front of the reader.
			expect(practice.resolveLearnMode(card, chosen).mode).toBe("typed");
			// A review moves the card on, and the next stage brings its own default.
			expect(practice.resolveLearnMode({ ...card, revision: 3, stage: 1 }, chosen).mode).toBe("blanks");
			expect(practice.resolveLearnMode({ ...card, id: "card-2" }, chosen).mode).toBe("blanks");
			expect(practice.resolveLearnMode(card, { ...opened, mode: "typed" }).mode).toBe("blanks");
		});

		it("names the job in one sentence and keeps the ladder's wording for blanks", () => {
			expect(practice.learnModeHint("blanks", 0)).toBe("Read the verse, then continue.");
			expect(practice.learnModeHint("blanks", 3))
				.toBe("Say the verse from its reference. Tap a blank for help.");
			expect(practice.learnModeHint("blanks", 2))
				.toBe("Recall the missing words. Tap a blank for help, then continue.");
			for (const mode of ["letters", "order", "typed"] as LearnMode[]) {
				expect(practice.learnModeHint(mode, 0)).toBe(practice.learnModeHint(mode, 3));
				expect(practice.learnModeHint(mode, 2).length).toBeGreaterThan(0);
			}
		});
	});
}

describe("Learn practice mirrors", () => {
	it("behaves identically on both clients", () => {
		for (const seed of [0, 1, 2, 3, 4]) {
			expect(mobilePractice.orderRound(JOHN_3_16, seed)).toEqual(webPractice.orderRound(JOHN_3_16, seed));
		}
		expect(mobilePractice.firstLetterWords(JOHN_3_16)).toEqual(webPractice.firstLetterWords(JOHN_3_16));
		expect(mobilePractice.scoreTypedVerse(JOHN_3_16, "For God so loved the earth"))
			.toEqual(webPractice.scoreTypedVerse(JOHN_3_16, "For God so loved the earth"));
	});
});
