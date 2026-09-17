import assert from "node:assert/strict";
import test from "node:test";
import { repairRows } from "../src/lib/verse-words-rows.ts";
import { cleanGloss } from "../src/lib/bible/original-text.ts";

const word = (text, extra = {}) => ({ text, strongs: "H1", morph: "HNcmsa", grammar: null, ...extra });
const details = [
	word("טוֹב", { translit: "ṭôwb", gloss: "good" }),
	word("מְלֹא", { translit: "mᵉlôʼ", gloss: "fulness" }),
	word("כַף", { translit: "kaph", gloss: "hand" }),
	word("נָחַת", { translit: "nachath", gloss: "quietness, rest" }),
];

test("a valid partition passes through in order with joined originals", () => {
	const rows = repairRows(
		[
			{ wordIndexes: [0], translit: "tov", kjv: "Better", sense: "good" },
			{ wordIndexes: [1, 2], translit: "melo kaph", kjv: "an handful", sense: "fulness of a palm" },
			{ wordIndexes: [3], translit: "nachat", kjv: "with quietness", sense: "rest" },
		],
		details
	);
	assert.deepEqual(
		rows.map((row) => [row.wordIndexes, row.original]),
		[
			[[0], "טוֹב"],
			[[1, 2], "מְלֹא כַף"],
			[[3], "נָחַת"],
		]
	);
	assert.equal(rows[1].kjv, "an handful");
});

test("a skipped word gets its own row from the gloss, in text order", () => {
	const rows = repairRows(
		[
			{ wordIndexes: [0], translit: "tov", kjv: "Better", sense: "good" },
			{ wordIndexes: [3], translit: "nachat", kjv: "with quietness", sense: "rest" },
		],
		details
	);
	assert.deepEqual(
		rows.map((row) => row.wordIndexes),
		[[0], [1], [2], [3]]
	);
	assert.equal(rows[1].translit, "mᵉlôʼ");
	assert.equal(rows[1].sense, "fulness");
	assert.equal(rows[1].kjv, "");
});

test("a doubled or out-of-range index is claimed once and rows are re-sorted", () => {
	const rows = repairRows(
		[
			{ wordIndexes: [3, 3, 9], translit: "nachat", kjv: "with quietness", sense: "rest" },
			{ wordIndexes: [2, 1], translit: "melo kaph", kjv: "an handful", sense: "palm" },
			{ wordIndexes: [0, 1], translit: "tov", kjv: "Better", sense: "good" },
		],
		details
	);
	assert.deepEqual(
		rows.map((row) => row.wordIndexes),
		[[0], [1, 2], [3]]
	);
});

test("a row spanning two places keeps only its first stretch; the rest become single rows", () => {
	const rows = repairRows(
		[
			{ wordIndexes: [0, 2], translit: "tov kaph", kjv: "Better hand", sense: "mixed" },
			{ wordIndexes: [3], translit: "nachat", kjv: "with quietness", sense: "rest" },
		],
		details
	);
	assert.deepEqual(
		rows.map((row) => [row.wordIndexes, row.original]),
		[
			[[0], "טוֹב"],
			[[1], "מְלֹא"],
			[[2], "כַף"],
			[[3], "נָחַת"],
		]
	);
	assert.equal(rows[0].kjv, "Better hand");
	assert.equal(rows[2].sense, "hand");
});

test("cleanGloss drops the [idiom] markers and empty parentheses", () => {
	assert.equal(
		cleanGloss("[idiom] all along, [idiom] all that is (there-) in, fill, ([idiom] that whereof...was) full, fulness, (hand-) full, multitude."),
		"all along, all that is (there-) in, fill, (that whereof...was) full, fulness, (hand-) full, multitude."
	);
	assert.equal(cleanGloss("(feast of) charity(-ably), dear, love"), "(feast of) charity(-ably), dear, love");
});
