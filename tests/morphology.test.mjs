import assert from "node:assert/strict";
import test from "node:test";

// morphology.ts is a pure module with no imports and no "@/" alias, so the
// strip-types runner can load the shipped source directly. No loader shim, and
// nothing here can drift from what the app renders.
import { decodeMorphology } from "../src/lib/bible/morphology.ts";

function decode(code) {
	const decoded = decodeMorphology(code);
	if (decoded === null) throw new Error(`expected ${code} to decode`);
	return decoded;
}

/**
 * The vectors below are codes that actually occur in src/data/originals,
 * sampled across every shape the two schemes produce. Expected strings are
 * spelled out rather than rebuilt from the tables, so a table edit that changes
 * what a reader sees has to be made twice, on purpose.
 */
const HEBREW_SUMMARIES = [
	["HNcmsc", "noun, masculine singular, construct form"],
	["HR/Ncmsc", "preposition + noun, masculine singular, construct form"],
	["HC/Vqw3ms", "conjunction + verb, qal sequential imperfect, third person masculine singular"],
	["HTd/Ncmpa", "definite article + noun, masculine plural, absolute form"],
	[
		"HNcmsc/Sp3ms",
		"noun, masculine singular, construct form + pronominal suffix, third person masculine singular",
	],
	["HAamsa", "adjective, masculine singular, absolute form"],
	["HVqp3ms", "verb, qal perfect, third person masculine singular"],
	["HPp1cs", "personal pronoun, first person common singular"],
	["HD", "adverb"],
	["HTo", "direct object marker"],
	["HTr", "relative particle"],
	["HTn", "negative particle"],
	["HTi", "interrogative particle"],
	["HTm", "demonstrative particle"],
	["HTa", "particle of affirmation"],
	["HNp", "proper noun"],
	["HRd/Ncmsa", "preposition with article + noun, masculine singular, absolute form"],
	["HC/Vhw3ms", "conjunction + verb, hiphil sequential imperfect, third person masculine singular"],
	["HVqrmsa", "verb, qal active participle, masculine singular, absolute form"],
	["HVqc", "verb, qal infinitive construct"],
];

const GREEK_SUMMARIES = [
	["N-NSM", "noun, nominative singular masculine"],
	["V-PAI-3S", "verb, present active indicative, third person singular"],
	["V-2AAI-3S", "verb, second aorist active indicative, third person singular"],
	["T-GSM", "definite article, genitive singular masculine"],
	["P-GSM", "personal pronoun, genitive singular masculine"],
	["P-1GS", "personal pronoun, first person genitive singular"],
	["A-NPM", "adjective, nominative plural masculine"],
	["A-NUI", "numeral, indeclinable"],
	["CONJ", "conjunction"],
	["PREP", "preposition"],
	["ADV", "adverb"],
	["PRT-N", "particle, negative"],
	["COND", "conditional particle"],
	["N-PRI", "proper noun, indeclinable"],
	["V-PAP-NSM", "verb, present active participle, nominative singular masculine"],
	["V-AAN", "verb, aorist active infinitive"],
	["V-2AAP-NSM", "verb, second aorist active participle, nominative singular masculine"],
	["D-NSM", "demonstrative pronoun, nominative singular masculine"],
	["R-NSM", "relative pronoun, nominative singular masculine"],
	["I-NSM", "interrogative pronoun, nominative singular masculine"],
	["F-3ASM", "reflexive pronoun, third person accusative singular masculine"],
	["X-NSM", "indefinite pronoun, nominative singular masculine"],
	["Q-NSM", "correlative or interrogative pronoun, nominative singular masculine"],
	["S-1SNSM", "possessive pronoun, first person singular possessor, nominative singular masculine"],
	["C-GPM", "reciprocal pronoun, genitive plural masculine"],
	["K-NSM", "correlative pronoun, nominative singular masculine"],
	["INJ", "interjection"],
	["HEB", "Hebrew transliteration"],
	["ARAM", "Aramaic transliteration"],
];

test("decodes every Hebrew shape in the bundled text", () => {
	for (const [code, expected] of HEBREW_SUMMARIES) {
		assert.equal(decode(code).summary, expected, code);
	}
});

test("decodes every Robinson shape in the bundled text", () => {
	for (const [code, expected] of GREEK_SUMMARIES) {
		assert.equal(decode(code).summary, expected, code);
	}
});

test("splits a Hebrew word into one part per morpheme", () => {
	const word = decode("HC/Vqw3ms");
	assert.equal(word.parts.length, 2);
	assert.equal(word.parts[0].partOfSpeech, "conjunction");
	assert.deepEqual(word.parts[0].features, []);
	assert.equal(word.parts[1].partOfSpeech, "verb");
	assert.deepEqual(word.parts[1].features, [
		"qal",
		"sequential imperfect",
		"3rd person",
		"masculine",
		"singular",
	]);
});

test("carries a pronominal suffix as its own trailing part", () => {
	const word = decode("HNcmsc/Sp3ms");
	assert.equal(word.parts.length, 2);
	assert.equal(word.parts[1].partOfSpeech, "pronominal suffix");
	assert.deepEqual(word.parts[1].features, ["3rd person", "masculine", "singular"]);
	assert.equal(word.parts[1].summary, "pronominal suffix, third person masculine singular");
});

test("picks the head morpheme rather than a prefix or a suffix", () => {
	assert.equal(decode("HNcmsc").head.partOfSpeech, "noun");
	assert.equal(decode("HR/Ncmsc").head.partOfSpeech, "noun");
	assert.equal(decode("HTd/Ncmpa").head.partOfSpeech, "noun");
	assert.equal(decode("HC/Vqw3ms").head.partOfSpeech, "verb");
	assert.equal(decode("HNcmsc/Sp3ms").head.partOfSpeech, "noun");
	assert.equal(decode("HC/R/Td/Ncmsa").head.partOfSpeech, "noun");
	// Aramaic writes the determined state as a trailing article, which must not
	// steal the head from the noun it follows.
	assert.equal(decode("ANcmsd/Td").head.partOfSpeech, "noun");
	// A word that is nothing but prefixes still has to name one of them.
	assert.equal(decode("HC/R").head.partOfSpeech, "preposition");
	// As does a preposition carrying only a suffix.
	assert.equal(decode("HR/Sp3ms").head.partOfSpeech, "preposition");
	// Greek is one morpheme, so the head is the word.
	assert.equal(decode("V-2AAP-NSM").head.partOfSpeech, "verb");
});

test("reads Aramaic verbs off the Aramaic stem table", () => {
	// The same letter names different stems per language: q is qal in Hebrew
	// and peal in Aramaic, h is hiphil in Hebrew and haphel in Aramaic.
	assert.equal(decode("AVqp3ms").summary, "verb, peal perfect, third person masculine singular");
	assert.equal(decode("HVqp3ms").summary, "verb, qal perfect, third person masculine singular");
	assert.equal(decode("AVhp3ms").summary, "verb, haphel perfect, third person masculine singular");
	assert.equal(decode("HVhp3ms").summary, "verb, hiphil perfect, third person masculine singular");
	assert.equal(decode("ANcmsd").summary, "noun, masculine singular, determined form");
});

test("keeps Greek modifiers after the inflection", () => {
	assert.equal(
		decode("V-2RAI-3S-ATT").summary,
		"verb, second perfect active indicative, third person singular, Attic form"
	);
	assert.equal(decode("A-NUI-ABB").summary, "numeral, indeclinable, abbreviated");
	assert.equal(decode("A-ASM-C").summary, "adjective, accusative singular masculine, comparative");
	assert.equal(decode("ADV-S").summary, "adverb, superlative");
	assert.equal(decode("D-NPM-K").summary, "demonstrative pronoun, nominative plural masculine, crasis");
	assert.equal(decode("N-LI").summary, "letter, indeclinable");
	assert.equal(decode("V-RPP-VSM").summary, "verb, perfect passive participle, vocative singular masculine");
});

test("skips an unspecified or unknown slot instead of failing the word", () => {
	// OSHB writes x wherever a slot is genuinely unspecified.
	assert.equal(decode("HNxxxa").summary, "noun, absolute form");
	assert.equal(decode("HPdxbp").summary, "demonstrative pronoun, masculine or feminine plural");
	// A letter that is in no table at all drops out the same way.
	assert.equal(decode("HNc?sc").summary, "noun, singular, construct form");
	assert.equal(decode("N-ZZZ").summary, "noun");
	// A morpheme that decodes keeps the word alive when a sibling does not.
	const word = decode("HZ/Ncmsa");
	assert.equal(word.parts.length, 1);
	assert.equal(word.head.partOfSpeech, "noun");
});

test("tells the Greek transliteration codes apart from a Hebrew language letter", () => {
	// HEB and ARAM open on H and A, the OSHB language letters, so the Greek
	// table has to be consulted first or they parse as Hebrew nonsense.
	assert.equal(decode("HEB").head.partOfSpeech, "Hebrew transliteration");
	assert.equal(decode("ARAM").head.partOfSpeech, "Aramaic transliteration");
	assert.equal(decode("ARAM").parts.length, 1);
});

test("returns null for an empty or unrecognisable code", () => {
	assert.equal(decodeMorphology(""), null);
	assert.equal(decodeMorphology("   "), null);
	assert.equal(decodeMorphology("garbage"), null);
	assert.equal(decodeMorphology("12345"), null);
	assert.equal(decodeMorphology("???"), null);
	assert.equal(decodeMorphology("ZZZ-QQQ"), null);
	// A language letter with nothing decodable after it is not a word.
	assert.equal(decodeMorphology("H"), null);
	assert.equal(decodeMorphology("HUH"), null);
});
