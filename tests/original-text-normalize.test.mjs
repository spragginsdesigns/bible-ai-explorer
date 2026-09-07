import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	greekPlain,
	hebrewPlain,
	versePlain,
	verseStrongs,
} from "../scripts/lib/original-text-normalize.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Every Hebrew and Greek literal below is written as escapes on purpose.
// Pointed Hebrew is a base letter plus a stack of invisible combining marks,
// and a literal here would be unreadable in review and silently corruptible
// by any editor that normalizes the file.

// Genesis 1:1 word 1 as bundled: bet + dagesh + sheva + resh + tsere + alef +
// shin + shin-dot + hiriq + tipeha + yod + tav.
const BERESHIT =
	"\u05D1\u05BC\u05B0\u05E8\u05B5\u05D0\u05E9\u05C1\u05B4\u0596\u05D9\u05EA";
const BERESHIT_PLAIN = "\u05D1\u05E8\u05D0\u05E9\u05D9\u05EA";

test("a pointed Hebrew word reduces to its consonants", () => {
	// The reader searching for this word types six letters, not the twelve
	// code points the WLC stores. Without this the tsvector never matches.
	assert.equal(hebrewPlain(BERESHIT), BERESHIT_PLAIN);
	assert.equal(hebrewPlain(BERESHIT_PLAIN), BERESHIT_PLAIN);
});

test("Hebrew final forms survive normalization", () => {
	// ha-arets, Genesis 1:1 word 7, ends in final tsadi (U+05E5). Folding it
	// onto the medial form would be a different consonant string.
	const haArets = "\u05D4\u05B8\u05D0\u05B8\u05BD\u05E8\u05B6\u05E5";
	assert.equal(hebrewPlain(haArets), "\u05D4\u05D0\u05E8\u05E5");
});

test("a maqaf splits one graphical unit into two search tokens", () => {
	// kol-ha-arets. The maqaf (U+05BE) is a joiner, not a letter, and lives
	// inside the mark range that gets stripped, so it has to be turned into a
	// space first or the two words fuse into one unsearchable token.
	const kolHaArets =
		"\u05DB\u05B8\u05BC\u05DC\u05BE\u05D4\u05B8\u05D0\u05B8\u05E8\u05B6\u05E5";
	assert.equal(hebrewPlain(kolHaArets), "\u05DB\u05DC \u05D4\u05D0\u05E8\u05E5");
});

test("a morpheme separator is dropped, not spaced", () => {
	// Some OSHB exports write the prefixed preposition as "be/reshit". The
	// prefix belongs to the same word, so the slash disappears rather than
	// breaking one token into two.
	assert.equal(hebrewPlain("\u05D1\u05BC\u05B0/" + BERESHIT_PLAIN.slice(1)), BERESHIT_PLAIN);
});

test("accented Greek reduces to bare lowercase letters", () => {
	// Iesous with capital iota, psili and perispomeni. The TR in this repo is
	// already bare lowercase, but a lemma pasted from a lexicon is not.
	assert.equal(
		greekPlain("\u1F38\u03B7\u03C3\u03BF\u1FE6\u03C2"),
		"\u03B9\u03B7\u03C3\u03BF\u03C5\u03C2"
	);
	assert.equal(
		greekPlain("\u03B2\u03AF\u03B2\u03BB\u03BF\u03C2"),
		"\u03B2\u03B9\u03B2\u03BB\u03BF\u03C2"
	);
});

test("Greek punctuation is dropped", () => {
	// Ano teleia (U+00B7) and the full stop are sentence furniture, not part
	// of the word.
	assert.equal(
		greekPlain("\u03B2\u03B9\u03B2\u03BB\u03BF\u03C2\u00B7"),
		"\u03B2\u03B9\u03B2\u03BB\u03BF\u03C2"
	);
});

test("normalizing a non-string or empty word yields an empty string", () => {
	for (const value of ["", null, undefined, 7, {}]) {
		assert.equal(hebrewPlain(value), "");
		assert.equal(greekPlain(value), "");
	}
});

test("versePlain joins the words of a verse with single spaces", () => {
	const words = [
		[BERESHIT, "H7225", "HR/Ncfsa"],
		["\u05D1\u05BC\u05B8\u05E8\u05B8\u05A3\u05D0", "H1254", "HVqp3ms"],
	];
	assert.equal(versePlain("Hebrew", words), BERESHIT_PLAIN + " \u05D1\u05E8\u05D0");
	assert.equal(
		versePlain("Greek", [["\u03B2\u03B9\u03B2\u03BB\u03BF\u03C2", "G976", "N-NSF"]]),
		"\u03B2\u03B9\u03B2\u03BB\u03BF\u03C2"
	);
	assert.equal(versePlain("Hebrew", []), "");
	assert.equal(versePlain("Hebrew", null), "");
});

test("verseStrongs keeps distinct ids in verse order", () => {
	const words = [
		["a", "H1", "x"],
		["b", "H2", "x"],
		["c", "H1", "x"],
		// A word with no Strong's id, which the bundled data does contain.
		["d", "", "x"],
		["e", "H3", "x"],
	];
	assert.deepEqual(verseStrongs(words), ["H1", "H2", "H3"]);
	assert.deepEqual(verseStrongs([]), []);
	assert.deepEqual(verseStrongs(null), []);
});

test("every bundled verse produces a non-empty plain form and real Strong's ids", () => {
	// The seed writes `plain` into a GENERATED tsvector column. A verse that
	// normalizes to "" would be an unsearchable row, and a malformed Strong's
	// id would break the GIN lookup the Strong's tool depends on.
	const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));
	const shape = /^[HG]\d{1,4}$/;
	let verses = 0;
	for (const book of books) {
		const chapters = JSON.parse(
			fs.readFileSync(path.join(root, "src/data/originals", book.file), "utf8")
		);
		const language = book.order <= 39 ? "Hebrew" : "Greek";
		const letters = language === "Hebrew" ? /^[\u05D0-\u05EA ]+$/ : /^[\u03B1-\u03C9 ]+$/;
		for (let c = 0; c < chapters.length; c++) {
			for (let v = 0; v < chapters[c].length; v++) {
				const words = chapters[c][v];
				if (!words || words.length === 0) continue;
				verses++;
				const plain = versePlain(language, words);
				assert.ok(plain, `${book.name} ${c + 1}:${v + 1} normalized to nothing`);
				assert.match(plain, letters, `${book.name} ${c + 1}:${v + 1} kept a non-letter`);
				for (const id of verseStrongs(words)) {
					assert.match(id, shape, `${book.name} ${c + 1}:${v + 1} has a bad Strong's id`);
				}
			}
		}
	}
	assert.equal(verses, 31170);
});
