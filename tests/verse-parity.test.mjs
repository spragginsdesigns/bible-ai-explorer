/**
 * Web/Android parity for verse linking (CLAUDE.md parity rule).
 *
 * The same answer text goes through BOTH shipped parsers - web's
 * parseVerseReferences and Android's segmentVerseReferences - and they have to
 * pull out the same references, in the same order, spelled the same way. A
 * reference that turns into a tappable link on the phone and stays grey prose
 * on the web is exactly the drift this file exists to catch.
 *
 * Neither module can be imported directly here. Both reach their book table
 * through a "@/" path alias, and `await import(pathToFileURL(...))` on
 * mobile/src/features/chat/verseLinks.ts fails with
 * ERR_MODULE_NOT_FOUND: Cannot find package '@/features'. Splitting the
 * segmenting logic out of either client into some shared "pure" module is NOT
 * the answer - that just moves the drift somewhere a device build never
 * exercises. So each module is instantiated from its REAL source the way
 * assistant-text-extraction.test.mjs instantiates route handlers, with its own
 * client's resolveReference and its own client's books.json injected. Edit
 * either parser and this test sees the edit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

/** Web: src/utils/verseParser.ts validating through src/lib/bible/books.ts. */
const webRefs = (() => {
	const { resolveReference, LOCALIZED_BOOK_PATTERN } = loadModule(
		"../src/lib/bible/books.ts",
		["resolveReference", "LOCALIZED_BOOK_PATTERN"],
		{
			booksJson: JSON.parse(read("../src/data/books.json")),
			bookNamesJson: JSON.parse(read("../src/data/book-names.json")),
		}
	);
	const { parseVerseReferences } = loadModule(
		"../src/utils/verseParser.ts",
		["parseVerseReferences"],
		{ resolveReference, LOCALIZED_BOOK_PATTERN }
	);
	return (text) =>
		parseVerseReferences(text)
			.filter((segment) => segment.type === "verse-ref")
			.map((segment) => segment.value);
})();

/**
 * Android: mobile/src/features/chat/verseLinks.ts validating through
 * mobile/src/features/bible/books.ts. Deliberately the phone's OWN book table,
 * not the web one - if the two data files or the two resolvers ever drift, that
 * is a parity failure too and this test should be the thing that says so.
 */
const androidRefs = (() => {
	const { resolveReference, LOCALIZED_BOOK_PATTERN } = loadModule(
		"../mobile/src/features/bible/books.ts",
		["resolveReference", "LOCALIZED_BOOK_PATTERN"],
		{
			booksJson: JSON.parse(
				read("../mobile/src/features/bible/data/books.json")
			),
			bookNamesJson: JSON.parse(
				read("../mobile/src/features/bible/data/book-names.json")
			),
		}
	);
	const { segmentVerseReferences } = loadModule(
		"../mobile/src/features/chat/verseLinks.ts",
		["segmentVerseReferences"],
		{ resolveReference, LOCALIZED_BOOK_PATTERN }
	);
	return (text) =>
		segmentVerseReferences(text)
			.filter((segment) => segment.type === "verse-ref")
			.map((segment) => segment.value);
})();

// Built from code points, not pasted: this toolchain flattens literal
// U+2013 / U+2014 to a hyphen, which would make these vectors agree for the
// wrong reason.
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

/**
 * Forty sentences in the shape a model actually writes them: full names,
 * numbered volumes with and without the space, abbreviations with a period,
 * without a period and with no space at all, ranges in three dashes, a
 * translation tag, a trailing colon, lowercase, and five lookalikes that must
 * stay plain prose on both clients.
 */
const SWEEP = [
	"For God so loved the world, John 3:16.",
	"See 1 Corinthians 2:14 on the natural man.",
	"Read Psalm 23:1-6 slowly.",
	"Gen. 1:1-3 opens the account.",
	"Gen.1:1 is the first verse.",
	"Rom.8:28 comforts the believer.",
	"2 Pet.1:19 speaks of the day star.",
	"1Cor 2:14 puts it plainly.",
	"1Thess 1:1 opens the letter.",
	"Look at Jn 3:16 again.",
	"Jn. 3:16 says it plainly.",
	"Ps 119:105 lights the path.",
	"Song of Songs 2:1 calls him the rose.",
	"Song 2:1 in the short form.",
	"Ex 20:3 forbids other gods.",
	"Obad 1:15 is the day of the LORD.",
	"Read John 3:16-4:2 for the whole discourse.",
	"The promise is found in John 3:14: it is plain.",
	'Read Psalm 23:1-6: "The LORD is my shepherd"',
	"Isaiah 53:5 NKJV shows the atonement.",
	"Revelation 21:1-4 KJV closes the canon.",
	`Deuteronomy 6:4${EM_DASH}5 is the Shema.`,
	`Psalm 23:1${EN_DASH}6 is the psalm of the shepherd.`,
	"1 John 5:1-4 and 2 John 1:6 and 3 John 1:4.",
	"Jude 1:3 contends for the faith.",
	"Philemon 1:6 and Philippians 4:13 together.",
	"2 Timothy 4:7 finishes the course.",
	"Matt 5:8 blesses the pure in heart.",
	"Heb 11:1 defines faith.",
	"Eccles 3:1 has a season for everything.",
	"Mk 1:1 and Lk 1:1 open the Gospels.",
	"1 Sam 17:45 faces Goliath.",
	"as john 3:16 says",
	"see gen.1:1 there",
	// The five that must NOT link, on either client.
	"the meeting is at 3:16 John said",
	"version 3:16 of the app",
	"Genesis1:1 has no space",
	"Look up John 25:1 sometime.",
	"See Sam 1:1 today.",
	"See 1Isaiah 5:3 there.",
];

/**
 * The one input the two clients are KNOWN to read differently, and why.
 *
 * Web's regex keeps numbered books in their own branch, so it never even starts
 * a match at the stray numeral: it matches at "Genesis" and links the real
 * reference inside the string. Android puts an optional numeral in front of
 * every book name, so it matches "2 Genesis 1:1" whole, the validator rejects
 * it (there is no second book of Genesis), and - like web - a rejected
 * candidate is skipped WHOLE rather than rescanned for something shorter
 * inside it. Both behaviours are defensible; nobody writes "2 Genesis".
 *
 * This list is a ceiling, not a to-do: the assertion below fails if it grows,
 * and fails just as loudly if an entry silently stops diverging and is left
 * here stale.
 */
const KNOWN_DIVERGENCES = [
	{
		input: "2 Genesis 1:1",
		web: ["Genesis 1:1"],
		android: [],
	},
];

/**
 * Spanish and German answers cite books by their own names (systemPrompt.ts,
 * languageGuidance). Accented letters are written as escapes so the vectors
 * survive tooling that flattens non-ASCII. Each entry: sentence, the
 * references both clients must link.
 */
const LOCALIZED_SWEEP = [
	["Porque de tal manera amó Dios al mundo, Juan 3:16.", ["Juan 3:16"]],
	["Lee 1 Juan 5:7 y 2 Corintios 5:17.", ["1 Juan 5:7", "2 Corintios 5:17"]],
	["Éxodo 20:3 y Isaías 53:5 RV1909.", ["Éxodo 20:3", "Isaías 53:5 RV1909"]],
	["Sin acento: Isaias 53:5 y Filemon 1:6.", ["Isaias 53:5", "Filemon 1:6"]],
	["Hechos de los Apóstoles 2:38 y Salmo 23:1-6.", ["Hechos de los Apóstoles 2:38", "Salmo 23:1-6"]],
	["Santiago 1:5 y Apocalipsis 22:21.", ["Santiago 1:5", "Apocalipsis 22:21"]],
	["Also hat Gott die Welt geliebt, Johannes 3:16.", ["Johannes 3:16"]],
	["Siehe 1. Mose 1:1 und 2. Mose 20:3.", ["1. Mose 1:1", "2. Mose 20:3"]],
	["Römer 8:28 und Hebräer 11:1 LUT1912.", ["Römer 8:28", "Hebräer 11:1 LUT1912"]],
	["Matthäus 5:8, Offenbarung 21:1 und Psalm 23:1.", ["Matthäus 5:8", "Offenbarung 21:1", "Psalm 23:1"]],
	// Must stay prose: no such chapter, and a name glued to the chapter.
	["Juan 25:1 no existe.", []],
	["Johannes3:16 ohne Leerzeichen.", []],
];

test("both clients link Spanish and German references the same way", () => {
	for (const [input, expected] of LOCALIZED_SWEEP) {
		assert.deepEqual(webRefs(input), expected, `web on ${JSON.stringify(input)}`);
		assert.deepEqual(androidRefs(input), expected, `Android on ${JSON.stringify(input)}`);
	}
});

test("both clients link the same references across a 40-sentence sweep", () => {
	assert.equal(SWEEP.length, 40, "the sweep must stay 40 sentences wide");

	for (const input of SWEEP) {
		assert.deepEqual(
			androidRefs(input),
			webRefs(input),
			`clients disagree on ${JSON.stringify(input)}: ` +
				`web ${JSON.stringify(webRefs(input))} vs ` +
				`Android ${JSON.stringify(androidRefs(input))}`
		);
	}
});

test("the sweep really links things, so agreement is not agreement on nothing", () => {
	const linked = SWEEP.filter((input) => webRefs(input).length > 0);
	assert.ok(
		linked.length >= 30,
		`only ${linked.length} of ${SWEEP.length} sentences linked anything`
	);

	// A spot-check of the exact spellings, so "same set" cannot mean "same
	// truncated set" on both sides at once.
	const all = SWEEP.flatMap(webRefs);
	for (const expected of [
		"John 3:16",
		"1 Corinthians 2:14",
		"Gen.1:1",
		"2 Pet.1:19",
		"1Cor 2:14",
		"1Thess 1:1",
		"Song 2:1",
		"Ex 20:3",
		"Obad 1:15",
		"John 3:16-4:2",
		"Isaiah 53:5 NKJV",
		`Deuteronomy 6:4${EM_DASH}5`,
		"john 3:16",
	]) {
		assert.ok(all.includes(expected), `${expected} was not linked by web`);
		assert.ok(
			SWEEP.flatMap(androidRefs).includes(expected),
			`${expected} was not linked by Android`
		);
	}

	// The lookalikes stay prose on both clients.
	for (const quiet of [
		"the meeting is at 3:16 John said",
		"version 3:16 of the app",
		"Genesis1:1 has no space",
		"Look up John 25:1 sometime.",
		"See Sam 1:1 today.",
		"See 1Isaiah 5:3 there.",
	]) {
		assert.deepEqual(webRefs(quiet), [], `web linked ${JSON.stringify(quiet)}`);
		assert.deepEqual(
			androidRefs(quiet),
			[],
			`Android linked ${JSON.stringify(quiet)}`
		);
	}
});

test("the known-divergence list is exactly one entry and still accurate", () => {
	assert.equal(
		KNOWN_DIVERGENCES.length,
		1,
		"a new web/Android divergence was accepted - close it or justify it here"
	);
	for (const { input, web, android } of KNOWN_DIVERGENCES) {
		assert.deepEqual(webRefs(input), web, `web changed on ${input}`);
		assert.deepEqual(androidRefs(input), android, `Android changed on ${input}`);
		assert.notDeepEqual(
			webRefs(input),
			androidRefs(input),
			`${input} no longer diverges - delete it from KNOWN_DIVERGENCES`
		);
	}
});

test("no sweep sentence is quietly sitting on the divergence list", () => {
	const listed = new Set(KNOWN_DIVERGENCES.map((entry) => entry.input));
	for (const input of SWEEP) {
		assert.ok(
			!listed.has(input),
			`${JSON.stringify(input)} is in both the sweep and the allowlist`
		);
	}
});
