import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

// original-search.ts imports the Prisma client for its one database function;
// strip the imports and evaluate the module for its pure half, the same way
// tests/verse-fulltext.test.mjs does.
const source = readFileSync(
	fileURLToPath(new URL("../src/lib/bible/original-search.ts", import.meta.url)),
	"utf8"
)
	// Both the one-line and the braced multi-line import forms.
	.replace(/^import\s[\s\S]*?from\s*"[^"]*";[^\r\n]*(?:\r?\n|$)/gm, "")
	.replace(/^export\s+/gm, "");

const {
	normalizeTranslit,
	normalizeStrongsNumber,
	detectScript,
	hebrewPlainQuery,
	greekPlainQuery,
	buildOriginalTsQuery,
	buildStrongsIndex,
	resolveStrongsInIndex,
} = new Function(
	`${stripTypeScriptTypes(source)}
	return {
		normalizeTranslit,
		normalizeStrongsNumber,
		detectScript,
		hebrewPlainQuery,
		greekPlainQuery,
		buildOriginalTsQuery,
		buildStrongsIndex,
		resolveStrongsInIndex,
	};`
)();

// Every non-ASCII string below is written as escapes so that no editor, shell
// or tool that re-writes this file can silently flatten a Hebrew point or a
// Greek breathing into ASCII and turn a real assertion into a tautology.
const CHESED = "chêçêd"; // H2617 as Strong's spells it
const AGAPE = "agápē"; // G26
const ELOHIM = "ʼĕlôhîym"; // H430
const YEHOVAH = "Yᵉhôvâh"; // H3068
const SHALOM = "shâlôwm"; // H7965
const LOGOS = "lógos"; // G3056

const HEB_CHESED_POINTED = "חֵסֶד"; // chet-tsere samekh-segol dalet
const HEB_CHESED_PLAIN = "חסד";
const HEB_SHALOM = "שָׁלוֹם";
const HEB_SHALOM_PLAIN = "שלום";
const GRK_AGAPE = "ἀγάπη"; // agape with rough breathing + acute
const GRK_AGAPE_PLAIN = "αγαπη";
const GRK_LOGOS = "λόγος";
const GRK_LOGOS_PLAIN = "λογος";

/* ---------------------------------------------------------------- translit */

// The whole point of the fold: the dictionary's spelling and the spellings a
// reader actually types must land on the same skeleton.
test("Strong's transliterations and reader spellings fold together", () => {
	const table = [
		[CHESED, "hesed"],
		["chesed", "hesed"],
		["Chesed", "hesed"],
		["hesed", "hesed"],
		[AGAPE, "agape"],
		["agape", "agape"],
		["Agape", "agape"],
		[ELOHIM, "elohim"],
		["elohim", "elohim"],
		[SHALOM, "shalom"],
		["shalom", "shalom"],
		[LOGOS, "logos"],
		["logos", "logos"],
	];
	for (const [input, expected] of table) {
		assert.equal(normalizeTranslit(input), expected, `${JSON.stringify(input)} -> ${expected}`);
	}
});

test("the divine name reaches H3068 from every spelling a reader uses", () => {
	assert.equal(normalizeTranslit(YEHOVAH), "yehovah");
	assert.equal(normalizeTranslit("yehovah"), "yehovah");
	assert.equal(normalizeTranslit("Yahweh"), "yehovah");
	assert.equal(normalizeTranslit("Jehovah"), "yehovah");
	assert.equal(normalizeTranslit("YHWH"), "yehovah");
});

// Samekh is written with a cedilla and sounds like /s/; dropping the cedilla
// alone would leave "checed" and never meet "chesed".
test("the cedilla samekh folds to s, not to c", () => {
	assert.equal(normalizeTranslit("ç"), "s");
	assert.equal(normalizeTranslit("ç"), "s");
	assert.ok(!normalizeTranslit(CHESED).includes("c"));
});

test("mater lectionis digraphs collapse to the vowel they spell", () => {
	assert.equal(normalizeTranslit("hiy"), "hi");
	assert.equal(normalizeTranslit("how"), "ho");
	assert.equal(normalizeTranslit("huw"), "hu");
});

test("apostrophes, superscripts and punctuation are dropped, not transliterated", () => {
	assert.equal(normalizeTranslit("ʼʻ'`"), "");
	assert.equal(normalizeTranslit("ben ʼadam"), "benadam");
	// Digits go too, so a Strong's number typed into the word field cannot
	// masquerade as a transliteration.
	assert.equal(normalizeTranslit("H2617"), "h");
});

/* ------------------------------------------------------------- Strong's id */

test("Strong's numbers normalize to the dictionary's key form", () => {
	assert.equal(normalizeStrongsNumber("H0430"), "H430");
	assert.equal(normalizeStrongsNumber(" g26 "), "G26");
	assert.equal(normalizeStrongsNumber("2617"), null);
	assert.equal(normalizeStrongsNumber("H"), null);
	assert.equal(normalizeStrongsNumber("H26a"), null);
});

/* ----------------------------------------------------------------- scripts */

test("the alphabet the user typed in decides how the word is resolved", () => {
	assert.equal(detectScript(HEB_CHESED_POINTED), "hebrew");
	assert.equal(detectScript(HEB_CHESED_PLAIN), "hebrew");
	assert.equal(detectScript(GRK_AGAPE), "greek");
	assert.equal(detectScript(GRK_LOGOS_PLAIN), "greek");
	assert.equal(detectScript("hesed"), "latin");
	assert.equal(detectScript("H2617"), "latin");
	assert.equal(detectScript(""), "latin");
});

/* ------------------------------------------------------------ plain queries */

test("Hebrew points and accents are stripped to the consonantal skeleton", () => {
	assert.equal(hebrewPlainQuery(HEB_CHESED_POINTED), HEB_CHESED_PLAIN);
	assert.equal(hebrewPlainQuery(HEB_SHALOM), HEB_SHALOM_PLAIN);
	// Already-plain text is left exactly as it is, so the query is idempotent.
	assert.equal(hebrewPlainQuery(HEB_CHESED_PLAIN), HEB_CHESED_PLAIN);
});

// Maqaf joins two words into one written unit; the seed splits on it, so a
// query that keeps it would look for a word the index never stored.
test("maqaf becomes a space so a joined pair is two searchable words", () => {
	assert.equal(
		hebrewPlainQuery(`${HEB_CHESED_PLAIN}־${HEB_SHALOM_PLAIN}`),
		`${HEB_CHESED_PLAIN} ${HEB_SHALOM_PLAIN}`
	);
});

test("Greek breathings, accents and case are stripped", () => {
	assert.equal(greekPlainQuery(GRK_AGAPE), GRK_AGAPE_PLAIN);
	assert.equal(greekPlainQuery(GRK_LOGOS), GRK_LOGOS_PLAIN);
	assert.equal(greekPlainQuery("ΑΓΑΠΗ"), GRK_AGAPE_PLAIN);
});

/* ---------------------------------------------------------------- tsquery */

test("plain words become prefix lexemes joined by AND", () => {
	assert.equal(buildOriginalTsQuery(GRK_AGAPE_PLAIN), `'${GRK_AGAPE_PLAIN}':*`);
	assert.equal(
		buildOriginalTsQuery(`${HEB_CHESED_PLAIN} ${HEB_SHALOM_PLAIN}`),
		`'${HEB_CHESED_PLAIN}':* & '${HEB_SHALOM_PLAIN}':*`
	);
	assert.equal(buildOriginalTsQuery([HEB_CHESED_PLAIN]), `'${HEB_CHESED_PLAIN}':*`);
});

test("nothing searchable yields null rather than an empty tsquery", () => {
	assert.equal(buildOriginalTsQuery(""), null);
	assert.equal(buildOriginalTsQuery("   "), null);
	assert.equal(buildOriginalTsQuery([]), null);
	assert.equal(buildOriginalTsQuery(["", "  "]), null);
});

test("a quote in the input is doubled, never left to end the lexeme early", () => {
	assert.equal(buildOriginalTsQuery("lord's"), "'lord''s':*");
});

/* ------------------------------------------------------ dictionary resolve */

const MINI = {
	hebrew: {
		H2617: {
			lemma: HEB_CHESED_POINTED,
			translit: CHESED,
			def: "kindness; by implication (towards God) piety",
			kjv: "favour, good deed(-liness, -ness), kindly, (loving-) kindness, merciful (kindness), mercy, pity",
		},
		H7965: {
			lemma: HEB_SHALOM,
			translit: SHALOM,
			def: "safe, i.e. (figuratively) well, happy, friendly; also welfare, health, prosperity, peace",
			kjv: "peace(-able, -ably), prosperity, welfare, health, rest, safe(-ty)",
		},
	},
	greek: {
		G26: {
			lemma: GRK_AGAPE,
			translit: AGAPE,
			def: "love, i.e. affection or benevolence; specially (plural) a love-feast",
			kjv: "(feast of) charity(-ably), dear, love",
		},
		G3056: {
			lemma: GRK_LOGOS,
			translit: LOGOS,
			def: "something said (including the thought); the Divine Expression",
			kjv: "account, cause, doctrine, reason, saying, speech, word",
		},
	},
};

const index = buildStrongsIndex(MINI);
const ids = (word, language) =>
	resolveStrongsInIndex(index, word, language).map((candidate) => candidate.strongs);

test("a transliteration resolves to its Strong's number", () => {
	assert.deepEqual(ids("hesed"), ["H2617"]);
	assert.deepEqual(ids("chesed"), ["H2617"]);
	assert.deepEqual(ids(CHESED), ["H2617"]);
	assert.deepEqual(ids("shalom"), ["H7965"]);
	assert.deepEqual(ids("agape"), ["G26"]);
	assert.deepEqual(ids("logos"), ["G3056"]);
});

// "(loving-) kindness" is how Strong's writes lovingkindness; only the
// letters-only squash of that segment finds it.
test("an English rendering finds the entry through the KJV gloss list", () => {
	const resolved = resolveStrongsInIndex(index, "lovingkindness");
	assert.deepEqual(
		resolved.map((candidate) => candidate.strongs),
		["H2617"]
	);
	assert.equal(resolved[0].matchKind, "gloss");
	assert.equal(resolved[0].translit, CHESED);
	assert.equal(resolved[0].lemma, HEB_CHESED_POINTED);
});

test("an exact transliteration outranks a gloss hit for the same word", () => {
	// "peace" is H7965's gloss; "shalom" is its transliteration.
	assert.equal(resolveStrongsInIndex(index, "shalom")[0].matchKind, "translit");
	assert.equal(resolveStrongsInIndex(index, "peace")[0].matchKind, "gloss");
	assert.deepEqual(ids("peace"), ["H7965"]);
});

test("a word pasted in its own alphabet resolves through the lemma", () => {
	assert.deepEqual(ids(HEB_CHESED_POINTED), ["H2617"]);
	assert.deepEqual(ids(HEB_CHESED_PLAIN), ["H2617"]);
	assert.deepEqual(ids(GRK_AGAPE), ["G26"]);
});

test("a shared English word returns every entry it could mean", () => {
	// Both H2617's def and G26's gloss carry "love".
	assert.deepEqual(ids("love").sort(), ["G26"]);
	assert.deepEqual(ids("kindness").sort(), ["H2617"]);
});

test("the language filter keeps a word study inside one testament", () => {
	assert.deepEqual(ids("word", "Greek"), ["G3056"]);
	assert.deepEqual(ids("word", "Hebrew"), []);
	assert.deepEqual(ids("hesed", "Greek"), []);
	assert.deepEqual(ids("hesed", "Hebrew"), ["H2617"]);
});

test("a spelling nothing matches resolves to nothing rather than guessing", () => {
	assert.deepEqual(ids("qqqqzz"), []);
	assert.deepEqual(ids(""), []);
});

test("a prefix of a transliteration still reaches the entry", () => {
	const resolved = resolveStrongsInIndex(index, "shal");
	assert.deepEqual(
		resolved.map((candidate) => candidate.strongs),
		["H7965"]
	);
	assert.equal(resolved[0].matchKind, "translit-prefix");
});
