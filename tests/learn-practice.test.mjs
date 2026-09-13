import { test } from "node:test";
import assert from "node:assert/strict";
import * as web from "../src/components/learn/practice.ts";
import * as android from "../mobile/src/features/learn/practice.ts";

/** The ladder fixture, 25 words, shared with the Android practice contract tests. */
const JOHN_3_16 =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

const OPENING = "For God so loved the world";

const CARD = Object.freeze({ id: "card-1", revision: 2, stage: 2 });

/** Every case runs against the web module and its Android mirror. */
const CLIENTS = [["web", web], ["Android", android]];

function sorted(words) {
	return [...words].sort();
}

/** Taps the round through in the order the verse is written. */
function playRound(practice, round) {
	let placed = [];
	const taps = [];
	while (placed.length < round.answer.length) {
		const want = round.answer[placed.length];
		const choice = round.choices.findIndex((word, index) =>
			word === want && !placed.includes(index));
		const tap = practice.tapOrderWord(round, placed, choice);
		taps.push(tap);
		placed = tap.placed;
	}
	return taps;
}

for (const [client, practice] of CLIENTS) {
	test(`${client}: first letters keep capitals, punctuation and hyphens`, () => {
		assert.equal(
			practice.firstLetterWords(JOHN_3_16).map((word) => word.clue).join(" "),
			"F G s l t w, t h g h o b S, t w b i h s n p, b h e l.",
		);
		assert.deepEqual(
			practice.firstLetterWords('"Well-beloved, my dearly-loved friend’s hope!"')
				.map((word) => word.clue),
			['"W-b,', "m", "d-l", "f", 'h!"'],
		);
		// The word itself is still there to reveal.
		assert.deepEqual(
			practice.firstLetterWords(OPENING).map((word) => word.text),
			OPENING.split(" "),
		);
	});

	test(`${client}: the offered words are exactly the verse's words`, () => {
		const round = practice.orderRound(OPENING, 7);
		assert.deepEqual(round.answer, OPENING.split(" "));
		assert.deepEqual(sorted(round.choices), sorted(round.answer));
		assert.equal(round.partial, false);
		assert.notDeepEqual(round.choices, round.answer);
	});

	test(`${client}: a long verse is practiced a part at a time, within the cap`, () => {
		const first = practice.orderRound(JOHN_3_16, 0);
		const second = practice.orderRound(JOHN_3_16, 1);
		assert.equal(first.partial, true);
		assert.equal(first.start, 0);
		assert.ok(first.answer.length <= practice.LEARN_ORDER_WORD_CAP);
		assert.ok(second.answer.length <= practice.LEARN_ORDER_WORD_CAP);
		assert.equal(second.start, first.answer.length);
		// Between them the parts are the verse, in order, once each.
		assert.deepEqual([...first.answer, ...second.answer], JOHN_3_16.split(" "));
		assert.deepEqual(sorted(second.choices), sorted(second.answer));

		const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
		for (const seed of [0, 1, 2, 3]) {
			assert.ok(practice.orderRound(long, seed).answer.length <= practice.LEARN_ORDER_WORD_CAP);
		}
	});

	test(`${client}: the next word is accepted and any other word is refused`, () => {
		const round = practice.orderRound(OPENING, 3);
		const taps = playRound(practice, round);
		assert.ok(taps.every((tap) => tap.correct));
		assert.equal(taps.at(-1).done, true);
		assert.deepEqual(
			taps.at(-1).placed.map((choice) => round.choices[choice]),
			OPENING.split(" "),
		);

		const opened = practice.tapOrderWord(round, [], round.choices.indexOf("For"));
		assert.equal(opened.correct, true);
		const wrong = practice.tapOrderWord(round, opened.placed, round.choices.indexOf("world"));
		assert.equal(wrong.correct, false);
		// A wrong tap shows the right word and leaves the round exactly where it was.
		assert.deepEqual(wrong.placed, opened.placed);
		assert.equal(wrong.done, false);
		assert.equal(round.choices[wrong.expected], "God");
		// The word already placed is not offered again.
		const repeat = practice.tapOrderWord(round, opened.placed, opened.placed[0]);
		assert.equal(repeat.correct, false);
		assert.deepEqual(repeat.placed, opened.placed);
	});

	test(`${client}: typed scoring ignores capitals, punctuation and hyphens`, () => {
		const exact = practice.scoreTypedVerse(JOHN_3_16, JOHN_3_16);
		assert.equal(exact.perfect, true);
		assert.equal(exact.empty, false);
		assert.ok(exact.words.every((word) => word.result === "match"));

		for (const typed of [
			JOHN_3_16.toUpperCase(),
			JOHN_3_16.toLowerCase(),
			JOHN_3_16.replace(/[,.]/g, ""),
			`${JOHN_3_16}\n`,
		]) {
			assert.equal(practice.scoreTypedVerse(JOHN_3_16, typed).perfect, true);
		}

		// A translation's own spelling still has to be typed.
		assert.equal(practice.scoreTypedVerse(JOHN_3_16, JOHN_3_16.replace("believeth", "believes")).perfect, false);
		assert.equal(practice.scoreTypedVerse("his well-beloved son", "his well beloved son").perfect, true);
		assert.equal(practice.scoreTypedVerse("", "anything").perfect, false);
		assert.equal(practice.scoreTypedVerse(JOHN_3_16, "   ").empty, true);
	});

	test(`${client}: typed scoring names the missing and the extra words`, () => {
		const score = practice.scoreTypedVerse(OPENING, "For so loved the whole world indeed");
		assert.deepEqual(
			score.words.map((word) => `${word.result}:${word.expected ?? word.typed}`),
			[
				"match:For",
				"missed:God",
				"match:so",
				"match:loved",
				"match:the",
				"extra:whole",
				"match:world",
				"extra:indeed",
			],
		);
		assert.equal(score.perfect, false);
		// One missing word does not mark every word after it wrong.
		assert.equal(score.words.filter((word) => word.result === "match").length, 5);

		const missingTail = practice.scoreTypedVerse(OPENING, "For God so");
		assert.deepEqual(
			missingTail.words.filter((word) => word.result === "missed").map((word) => word.expected),
			["loved", "the", "world"],
		);
	});

	test(`${client}: how well a verse is known picks the mode`, () => {
		assert.equal(practice.defaultLearnMode({ ...CARD, stage: 0 }), "blanks");
		assert.equal(practice.defaultLearnMode({ ...CARD, stage: 1 }), "blanks");
		assert.equal(practice.defaultLearnMode({ ...CARD, stage: 3 }), "typed");
		for (const revision of [0, 1, 2, 3]) {
			assert.ok(["letters", "order"].includes(practice.defaultLearnMode({ ...CARD, revision })));
		}
		// A verse being recalled comes back the other way after a review.
		assert.notEqual(
			practice.defaultLearnMode({ ...CARD, revision: 4 }),
			practice.defaultLearnMode({ ...CARD, revision: 5 }),
		);
		assert.deepEqual(practice.LEARN_MODES, ["blanks", "letters", "order", "typed"]);
		assert.ok(practice.LEARN_MODES.every((mode) => practice.LEARN_MODE_LABELS[mode].length > 0));
		assert.ok(practice.isLearnMode("typed"));
		assert.equal(practice.isLearnMode("quiz"), false);
	});

	test(`${client}: choosing a mode by hand changes nothing about the card`, () => {
		const card = Object.freeze({ id: "card-1", revision: 2, stage: 0 });
		const opened = practice.resolveLearnMode(card, null);
		assert.deepEqual(opened, { cardId: "card-1", revision: 2, mode: "blanks", chosen: false });

		const chosen = practice.chooseLearnMode(card, "typed");
		assert.deepEqual(card, { id: "card-1", revision: 2, stage: 0 });
		assert.equal(chosen.mode, "typed");
		assert.equal(chosen.chosen, true);
		assert.equal(chosen.cardId, card.id);
		assert.equal(chosen.revision, card.revision);
		// The hand-picked mode holds for the card in front of the reader.
		assert.equal(practice.resolveLearnMode(card, chosen).mode, "typed");
		// A review moves the card on, and the next stage brings its own default.
		assert.equal(practice.resolveLearnMode({ ...card, revision: 3, stage: 1 }, chosen).mode, "blanks");
		// So does a different verse.
		assert.equal(practice.resolveLearnMode({ ...card, id: "card-2" }, chosen).mode, "blanks");
		// An opened mode that was never chosen never outlives its default.
		assert.equal(practice.resolveLearnMode(card, { ...opened, mode: "typed" }).mode, "blanks");
	});

	test(`${client}: the hint names the job and blanks keeps the ladder's wording`, () => {
		assert.equal(practice.learnModeHint("blanks", 0), "Read the verse, then continue.");
		assert.equal(practice.learnModeHint("blanks", 3), "Say the verse from its reference. Tap a blank for help.");
		assert.equal(practice.learnModeHint("blanks", 2), "Recall the missing words. Tap a blank for help, then continue.");
		for (const mode of ["letters", "order", "typed"]) {
			assert.equal(practice.learnModeHint(mode, 0), practice.learnModeHint(mode, 3));
			assert.ok(practice.learnModeHint(mode, 2).length > 0);
		}
	});
}

test("the web module and the Android module behave identically", () => {
	for (const seed of [0, 1, 2, 3, 4]) {
		assert.deepEqual(web.orderRound(JOHN_3_16, seed), android.orderRound(JOHN_3_16, seed));
	}
	assert.deepEqual(web.firstLetterWords(JOHN_3_16), android.firstLetterWords(JOHN_3_16));
	assert.deepEqual(
		web.scoreTypedVerse(JOHN_3_16, "For God so loved the earth"),
		android.scoreTypedVerse(JOHN_3_16, "For God so loved the earth"),
	);
});
