import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

// Written as escapes on purpose: this machine's shell tooling flattens literal
// U+2013 / U+2014 to a hyphen, which would silently make these vectors pass for
// the wrong reason.
const EN_DASH = "–";
const EM_DASH = "—";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/**
 * Instantiate a REAL module the plain-node test runner cannot import, because
 * it reaches a dependency through the "@/" path alias. Same recipe
 * assistant-text-extraction.test.mjs uses for route handlers: drop the import
 * lines, strip the types, drop the `export` keywords, and hand the
 * dependencies in by name. The code under test is the shipped source, not a
 * copy that can drift.
 */
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

const { resolveReference } = loadModule(
	"../src/lib/bible/books.ts",
	["resolveReference"],
	{ booksJson: JSON.parse(read("../src/data/books.json")) }
);

/**
 * verseParser now validates through that same resolveReference, so it too has
 * to come in through the loader. Nothing here re-implements the parser.
 */
const {
	NUMBERED_ABBREVIATIONS,
	NUMBERED_BOOK_NAMES,
	SINGLE_ABBREVIATIONS,
	SINGLE_BOOK_NAMES,
	isResolvableReference,
	parseVerseReferences,
	stripTranslationTag,
} = loadModule(
	"../src/utils/verseParser.ts",
	[
		"NUMBERED_ABBREVIATIONS",
		"NUMBERED_BOOK_NAMES",
		"SINGLE_ABBREVIATIONS",
		"SINGLE_BOOK_NAMES",
		"isResolvableReference",
		"parseVerseReferences",
		"stripTranslationTag",
	],
	{ resolveReference }
);

/** The references parseVerseReferences pulled out of a string, in order. */
function refs(text) {
	return parseVerseReferences(text)
		.filter((seg) => seg.type === "verse-ref")
		.map((seg) => seg.value);
}

test("cross-chapter ranges are captured whole, never truncated", () => {
	assert.deepEqual(refs("Read John 3:16-4:2 for the full discourse."), [
		"John 3:16-4:2",
	]);
	assert.deepEqual(refs("Genesis 1:1-2:3 is the creation week."), [
		"Genesis 1:1-2:3",
	]);
	// The whole point of the trailing boundary: no "John 3:16-4" plus a
	// dangling ":2" rendered as plain text beside a wrong clickable reference.
	for (const captured of refs("Read John 3:16-4:2 now.")) {
		assert.ok(!captured.endsWith("-4"), `truncated capture: ${captured}`);
	}
});

test("a colon after a reference does not unlink or truncate it", () => {
	// `(?![:\d])` failed both of these: the first went completely unlinked, the
	// second was cut down to "Psalm 23:1" with "-6" left as loose text.
	assert.deepEqual(refs("The promise is found in John 3:14: it is plain."), [
		"John 3:14",
	]);
	assert.deepEqual(refs('Read Psalm 23:1-6: "The LORD is my shepherd"'), [
		"Psalm 23:1-6",
	]);
	assert.deepEqual(refs("Isaiah 53:5 NKJV: he was wounded."), [
		"Isaiah 53:5 NKJV",
	]);
	// A colon that starts another chapter:verse still has to be refused, or the
	// truncated capture comes straight back.
	assert.deepEqual(refs("Read John 3:16-4:2 now."), ["John 3:16-4:2"]);
});

test("range dashes may be hyphen, en dash or em dash", () => {
	assert.deepEqual(refs("Psalm 23:1-6"), ["Psalm 23:1-6"]);
	assert.deepEqual(refs(`Psalm 23:1${EN_DASH}6`), [`Psalm 23:1${EN_DASH}6`]);
	assert.deepEqual(refs(`Deuteronomy 6:4${EM_DASH}5 is the Shema.`), [
		`Deuteronomy 6:4${EM_DASH}5`,
	]);
});

test("abbreviations link with a period, without a period, and with no space", () => {
	assert.deepEqual(refs("Jn 3:16 says it plainly."), ["Jn 3:16"]);
	assert.deepEqual(refs("Jn. 3:16 says it plainly."), ["Jn. 3:16"]);
	assert.deepEqual(
		refs("Gen.1:1 and Rev.22:21 and 2 Pet.1:19 and Rom.8:28"),
		["Gen.1:1", "Rev.22:21", "2 Pet.1:19", "Rom.8:28"]
	);
	assert.deepEqual(refs("Ps 119:105 lights the path."), ["Ps 119:105"]);
});

test("Song of Songs is recognised alongside Song of Solomon", () => {
	assert.deepEqual(refs("Song of Songs 2:1"), ["Song of Songs 2:1"]);
	assert.deepEqual(refs("Song of Solomon 2:1"), ["Song of Solomon 2:1"]);
});

test("the 2026-08 regression sweep still resolves exactly as before", () => {
	const unchanged = [
		"John 3:16",
		"1 John 3:16",
		"3 John 1:4",
		"Psalm 23:1-6",
		"Gen. 1:1-3",
		"1 Cor. 2:14",
		"Judges 6:12",
		"Jude 1:3",
		"Philemon 1:6",
		"Philippians 4:13",
		"2 Peter 1:19",
		"Revelation 21:1-4 KJV",
	];
	for (const input of unchanged) {
		assert.deepEqual(refs(input), [input], `changed: ${input}`);
	}
});

test("a bare chapter:verse with no book stays unlinked", () => {
	assert.deepEqual(refs("the meeting is at 3:16 John said"), []);
	assert.deepEqual(refs("ratio 2:1 in the mix"), []);
	assert.deepEqual(refs("Genesis1:1 has no space"), []);
});

test("translation tags stay in the captured display text", () => {
	assert.deepEqual(refs("Isaiah 53:5 NKJV shows the atonement."), [
		"Isaiah 53:5 NKJV",
	]);
	assert.deepEqual(refs("Romans 8:28 ESV is often quoted."), [
		"Romans 8:28 ESV",
	]);
});

test("stripTranslationTag removes every supported tag and nothing else", () => {
	for (const tag of ["KJV", "NKJV", "NIV", "ESV", "NASB", "NLT"]) {
		assert.equal(stripTranslationTag(`Isaiah 53:5 ${tag}`), "Isaiah 53:5");
		assert.equal(
			stripTranslationTag(`Isaiah 53:5 ${tag.toLowerCase()}`),
			"Isaiah 53:5"
		);
	}
	// NKJV must not lose only its trailing "KJV" - that produced the
	// "Isaiah 53:5 N" lookup that 404'd against bible-api.com.
	assert.equal(stripTranslationTag("Isaiah 53:5 NKJV"), "Isaiah 53:5");
	assert.equal(stripTranslationTag("John 3:16"), "John 3:16");
	assert.equal(stripTranslationTag("  John 3:16  "), "John 3:16");
	assert.equal(stripTranslationTag("Song of Songs 2:1"), "Song of Songs 2:1");
});

/* ------------------------------------------ detection is not acceptance --- */

test("an unresolvable reference is left as plain text, like Android", () => {
	// John has 21 chapters. The regex matches "John 25:1" happily; the
	// validator is what stops it becoming a popover with nothing behind it.
	assert.deepEqual(refs("Look up John 25:1 sometime."), []);
	assert.deepEqual(parseVerseReferences("Look up John 25:1 sometime."), [
		{ type: "text", value: "Look up John 25:1 sometime." },
	]);
	// The same sentence with a real reference still links.
	assert.deepEqual(refs("Look up John 3:16 sometime."), ["John 3:16"]);

	for (const dead of [
		"Genesis 51:1",
		"Obadiah 2:1",
		"Jude 2:3",
		"Philemon 2:1",
		"Revelation 23:1",
		"3 John 2:4",
	]) {
		assert.deepEqual(refs(`See ${dead} today.`), [], `${dead} was linked`);
		assert.equal(isResolvableReference(dead), false, dead);
	}
});

test("a rejected candidate does not swallow the prose around it", () => {
	assert.deepEqual(
		parseVerseReferences("Before John 25:1 and after John 3:16 ends it."),
		[
			{ type: "text", value: "Before John 25:1 and after " },
			{ type: "verse-ref", value: "John 3:16" },
			{ type: "text", value: " ends it." },
		]
	);
});

/* -------------------------------------------------- Android parity list --- */

test("the abbreviations Android accepts are accepted here too", () => {
	assert.deepEqual(refs("Ex 20:3 forbids other gods."), ["Ex 20:3"]);
	assert.deepEqual(refs("Ex. 20:3 forbids other gods."), ["Ex. 20:3"]);
	assert.deepEqual(refs("Obad 1:15 is the day of the LORD."), ["Obad 1:15"]);
	assert.deepEqual(refs("Song 2:1 calls him the rose of Sharon."), [
		"Song 2:1",
	]);
	// "Obad" must win over "Ob", or the capture is truncated to "Ob" and the
	// stray "ad" is left beside the link.
	assert.deepEqual(refs("Obad. 1:1"), ["Obad. 1:1"]);
});

test("matching is case-insensitive, as it is on Android", () => {
	assert.deepEqual(refs("as john 3:16 says"), ["john 3:16"]);
	assert.deepEqual(refs("as JOHN 3:16 says"), ["JOHN 3:16"]);
	assert.deepEqual(refs("see 1 cor. 2:14 there"), ["1 cor. 2:14"]);
	assert.deepEqual(refs("see gen.1:1 there"), ["gen.1:1"]);
	// Lowercase does not lower the bar: an unresolvable one is still plain text.
	assert.deepEqual(refs("see john 25:1 there"), []);
});

/* ------------------------------------------------ link/resolve agreement --- */

/** "Psalms?" is a regex fragment; the strings it stands for are what a model writes. */
function literalForms(namePattern) {
	return namePattern.endsWith("s?")
		? [namePattern.slice(0, -2), `${namePattern.slice(0, -2)}s`]
		: [namePattern];
}

/** Every shape of one book token the detection regex accepts. */
function linkedForms(book, { numbered, abbreviation }) {
	const separators = abbreviation ? [" ", ". ", "."] : [" "];
	const prefixes = numbered ? ["1 ", "1"] : [""];
	const forms = [];
	for (const name of literalForms(book)) {
		for (const prefix of prefixes) {
			for (const separator of separators) {
				forms.push(`${prefix}${name}${separator}1:1`);
			}
		}
	}
	return forms;
}

/**
 * The reviewer's rule: never link what cannot resolve. A linked reference opens
 * a popover that fetches the verse and offers "Read in the Bible", so a form
 * the detection regex accepts but resolveReference rejects is a dead link. This
 * walks the parser's own exported lists, so adding a book or an abbreviation
 * without an alias to match fails here instead of in production.
 */
test("every form the parser links resolves to a real book", () => {
	const groups = [
		[SINGLE_BOOK_NAMES, { numbered: false, abbreviation: false }],
		[NUMBERED_BOOK_NAMES, { numbered: true, abbreviation: false }],
		[SINGLE_ABBREVIATIONS, { numbered: false, abbreviation: true }],
		[NUMBERED_ABBREVIATIONS, { numbered: true, abbreviation: true }],
	];

	let checked = 0;
	for (const [books, shape] of groups) {
		for (const book of books) {
			for (const form of linkedForms(book, shape)) {
				assert.deepEqual(
					refs(`As it says in ${form} plainly.`),
					[form],
					`the parser did not link ${JSON.stringify(form)}`
				);
				assert.ok(
					resolveReference(form),
					`the parser links ${JSON.stringify(form)} but it resolves to nothing`
				);
				checked += 1;
			}
		}
	}
	assert.ok(checked > 200, `only ${checked} forms exercised`);
});

test("a reference the reader could not open is never linked", () => {
	// A numbered book with no numeral names nothing: "Sam" could be either
	// 1 or 2 Samuel, so it must not become a clickable dead end.
	for (const stem of NUMBERED_ABBREVIATIONS) {
		if (stem === "Jn") continue; // bare "Jn" is the Gospel of John
		assert.deepEqual(refs(`See ${stem} 1:1 today.`), [], `${stem} linked bare`);
		assert.equal(resolveReference(`${stem} 1:1`), null, stem);
	}
	for (const name of NUMBERED_BOOK_NAMES) {
		if (name === "John") continue;
		assert.deepEqual(refs(`See ${name} 1:1 today.`), [], `${name} linked bare`);
	}
	// A numeral in front of a single-volume book is not a book either; only the
	// real reference inside the string may be linked.
	assert.deepEqual(refs("2 Genesis 1:1"), ["Genesis 1:1"]);
});

test("resolution accepts the display forms the parser produces", () => {
	const cases = [
		["John 3:16-4:2", { order: 43, chapter: 3, verse: 16 }],
		["Gen.1:1", { order: 1, chapter: 1, verse: 1 }],
		["Jn 3:16", { order: 43, chapter: 3, verse: 16 }],
		["1 Jn 5:1", { order: 62, chapter: 5, verse: 1 }],
		["Eccles 1:2", { order: 21, chapter: 1, verse: 2 }],
		["Tit 1:1", { order: 56, chapter: 1, verse: 1 }],
		["Ob 1:1", { order: 31, chapter: 1, verse: 1 }],
		["Obad 1:1", { order: 31, chapter: 1, verse: 1 }],
		["Ex 20:3", { order: 2, chapter: 20, verse: 3 }],
		["Song 2:1", { order: 22, chapter: 2, verse: 1 }],
		["Mk 1:1", { order: 41, chapter: 1, verse: 1 }],
		["Lk 1:1", { order: 42, chapter: 1, verse: 1 }],
		["Exod 1:1", { order: 2, chapter: 1, verse: 1 }],
		[`Psalm 23:1${EN_DASH}6`, { order: 19, chapter: 23, verse: 1 }],
		[`Deuteronomy 6:4${EM_DASH}5`, { order: 5, chapter: 6, verse: 4 }],
	];
	for (const [input, expected] of cases) {
		assert.deepEqual(resolveReference(input), expected, input);
	}
	// The tag is display-only; it is stripped before resolution.
	assert.deepEqual(resolveReference(stripTranslationTag("Isaiah 53:5 NKJV")), {
		order: 23,
		chapter: 53,
		verse: 5,
	});
	// Still refuses what it always refused.
	assert.equal(resolveReference("John 99:16"), null);
	assert.equal(resolveReference("Book of Mormon 1:1"), null);
});
