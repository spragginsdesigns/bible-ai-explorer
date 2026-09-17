import assert from "node:assert/strict";
import test from "node:test";

import { createDashStripper, stripDashes } from "../src/lib/ai/plain-dashes.ts";

// Built from code points so the dashes survive the editing tooling on the
// development machine, which flattens a literal U+2014 (and a \u escape of
// it) to a hyphen.
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

/** The same text fed one code point at a time, which is the worst chunking. */
function streamed(text) {
	const stripper = createDashStripper();
	let out = "";
	for (const c of text) out += stripper.push(c);
	return out + stripper.flush();
}

const CASES = [
	["unspaced prose dash becomes a comma", `Yes, Austin${EM}that is fair.`, "Yes, Austin, that is fair."],
	["spaced prose dash loses both spaces", `on Jesus Christ ${EM} not on 1 Enoch.`, "on Jesus Christ, not on 1 Enoch."],
	["space only after the dash", `care${EM} not condemnation`, "care, not condemnation"],
	["a parenthetical pair becomes two commas", `the Bible${EM}especially James${EM}and more`, "the Bible, especially James, and more"],
	["bold term before the dash", `a **Question**${EM}a verse to ask about`, "a **Question**, a verse to ask about"],
	["dash before a line break keeps the comma only", `He spoke${EM}\nand it was so`, "He spoke,\nand it was so"],
	["attribution line in a blockquote drops the dash", `> "Be still"\n> ${EM} Psalm 46:10, KJV`, `> "Be still"\n> Psalm 46:10, KJV`],
	["attribution line without a blockquote", `${EM} Psalm 46:10, KJV`, "Psalm 46:10, KJV"],
	["attribution dash with no space after it", `> ${EM}Psalm 46:10`, "> Psalm 46:10"],
	["indented attribution keeps its indentation", `  ${EM} Psalm 23:1`, "  Psalm 23:1"],
	["en dash verse range becomes a hyphen", `John 3:16${EN}17 says`, "John 3:16-17 says"],
	["em dash between digits becomes a hyphen", `Psalms 1${EM}3`, "Psalms 1-3"],
	["en dash in prose becomes a comma too", `grace ${EN} not works`, "grace, not works"],
	["text without dashes is untouched", "> quote\n\n- a bullet\n1. a step", "> quote\n\n- a bullet\n1. a step"],
	["trailing space survives the flush", "word ", "word "],
	["dash after clause punctuation adds no double space", `Wait.${EM} Then go`, "Wait., Then go"],
];

for (const [name, input, expected] of CASES) {
	test(`plain dashes: ${name}`, () => {
		assert.equal(stripDashes(input), expected);
	});
	test(`plain dashes: ${name} (streamed one code point at a time)`, () => {
		assert.equal(streamed(input), expected);
	});
}

test("plain dashes: chunk boundaries on either side of the dash agree with the whole string", () => {
	const text = `The Word ${EM} living and powerful ${EM} divides.\n> ${EM} Hebrews 4:12, KJV`;
	const whole = stripDashes(text);
	for (let cut = 1; cut < text.length; cut++) {
		const stripper = createDashStripper();
		const out = stripper.push(text.slice(0, cut)) + stripper.push(text.slice(cut)) + stripper.flush();
		assert.equal(out, whole, `cut at ${cut}`);
	}
	assert.equal(whole, "The Word, living and powerful, divides.\n> Hebrews 4:12, KJV");
});

test("plain dashes: no dash of either kind survives", () => {
	const text = `A${EM}b ${EN} c\n${EM} d\n> ${EM} e 1${EN}2`;
	const out = stripDashes(text);
	assert.equal(out.includes(EM), false);
	assert.equal(out.includes(EN), false);
});
