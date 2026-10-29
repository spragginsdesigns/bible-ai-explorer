import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { alignFromKjv, originalFragmentMatchesSource } from "../scripts/lib/original-versification.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
// Execute the shipping tool definitions, with external services excluded. The
// parser, context builder and book metadata are real; text is bundled Scripture.
function loadModule(path, names, injected = {}) {
	const source = read(path).replace(/await import\("@\/data\/originals\/([^"]+)"\)/g, 'await loadJsonModule("$1")').replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	return new Function(...Object.keys(injected), `${stripTypeScriptTypes(source)}\nreturn { ${names.join(",")} };`)(...Object.values(injected));
}
const books = loadModule("src/lib/bible/books.ts", ["resolveReference", "bookByOrder"], {
	booksJson: json("src/data/books.json"), bookNamesJson: json("src/data/book-names.json"),
});
const kjv = loadModule("src/utils/kjvBible.ts", ["getKjvBookNumber", "getKjvBookName"]);
const getChapter = async (translation, order, chapter) => {
	assert.equal(translation, "KJV");
	const filename = json("src/data/books.json").find(book => book.order === order).file;
	const verses = json(`src/data/kjv/${filename}`)[chapter - 1];
	if (!verses) throw new Error("Missing chapter");
	return verses;
};
const getVerseText = async (translation, order, chapter, verse) => (await getChapter(translation, order, chapter))[verse - 1];
const passage = loadModule("src/lib/bible/passage-context.ts", ["canonicalPassage"], { ...books, getChapter });
const getCrossReferencesFor = async (order, chapter, verse) => {
	const filename = json("src/data/books.json").find(book => book.order === order).file;
	return (json(`src/data/crossrefs/${filename}`)[`${chapter}:${verse}`] ?? []).map(([order, chapter, verse, endChapter, endVerse]) => ({ order, chapter, verse, endChapter, endVerse }));
};
const originals = loadModule("src/lib/bible/originals.ts", ["getOriginalVerse", "getOriginalVerseForKjv"], {
	loadJsonModule: async name => ({ default: json(`src/data/originals/${name}`) }),
	getKjvBook: async order => json(`src/data/kjv/${json("src/data/books.json").find(book => book.order === order).file}`),
	alignFromKjv,
	originalFragmentMatchesSource,
});
function makeTools({ crossReferences = getCrossReferencesFor, loadChapter = getChapter } = {}) {
	const state = { fullTextCalls: [] };
	const { buildSureWordTools } = loadModule("src/lib/ai-tools.ts", ["buildSureWordTools"], {
		...books, ...kjv, ...passage, ...originals, tool, z,
		getChapter: loadChapter, getVerseText, getCrossReferencesFor: crossReferences,
		formatVersesForModel: verses => verses.map(verse => `${verse.reference}: ${verse.text}`).join("\n"),
		findVersesFullText: async (...args) => { state.fullTextCalls.push(args); return []; },
		READING_PLAN_PRESETS: [], ATLAS_ERAS: [], HIGHLIGHT_COLORS: [],
		MIN_PLAN_DAYS: 1, MAX_PLAN_DAYS: 100, MAX_HIGHLIGHT_VERSES: 30,
		MAX_ORGANIZE_NAME_LENGTH: 100, MAX_ORGANIZE_TAGS: 10, NOTE_HOUSE_STYLE: "",
		...Object.fromEntries(["buildMemoryTools", "buildOnboardingTools", "buildServeTools", "buildStudyTools", "buildActionTools", "buildReadingTools"].map(name => [name, () => ({})])),
	});
	return { tools: buildSureWordTools({ userId: "scripture-coverage-test", translation: "KJV" }), state };
}
const execute = (tool, input) => tool.execute(input, { toolCallId: "coverage", messages: [] });

for (const query of ["John 3:16-18", "Jn 3:16\u201318", "John 3:16\u201418", "Juan 3:16-18"]) {
	test(`findVerses reads the complete range: ${query}`, async () => {
		const { tools, state } = makeTools();
		const result = await execute(tools.findVerses, { query });
		assert.deepEqual(result.verses.map(row => row.reference), ["John 3:16", "John 3:17", "John 3:18"]);
		assert.equal(result.verses[2].text, (await getChapter("KJV", 43, 3))[17]);
		assert.deepEqual(result.coverage, { requestedReference: "John 3:16-18", returnedReference: "John 3:16-18", requestedVerseCount: 3, returnedVerseCount: 3, truncated: false });
		assert.equal(result.averageSimilarity, 1);
		assert.equal(result.truncated, false);
		assert.equal(state.fullTextCalls.length, 0);
	});
}

test("chapter requests report actual chapter length and partial coverage", async () => {
	const { tools } = makeTools();
	const large = await execute(tools.findVerses, { query: "Psalm 119" });
	assert.equal(large.verses.length, 30);
	assert.deepEqual(large.coverage, { requestedReference: "Psalms 119", returnedReference: "Psalms 119:1-30", requestedVerseCount: 176, returnedVerseCount: 30, truncated: true });
	assert.equal(large.truncated, true);
	assert.match(large.formatted, /partial coverage/);
	const small = await execute(tools.findVerses, { query: "Psalm 23" });
	assert.equal(small.verses.length, 6);
	assert.equal(small.coverage.requestedVerseCount, 6);
	assert.equal(small.truncated, false);
});

for (const [end, truncated] of [[30, false], [31, true]]) {
	test(`both passage tools distinguish ${end}-verse request at the cap`, async () => {
		const { tools } = makeTools();
		const find = await execute(tools.findVerses, { query: `Psalm 119:1-${end}` });
		const get = await execute(tools.getPassage, { book: "Ps", chapter: 119, verseStart: 1, verseEnd: end });
		assert.deepEqual(find.coverage, get.coverage);
		for (const result of [find, get]) {
			assert.equal(result.truncated, truncated);
			assert.equal(result.coverage.requestedVerseCount, end);
			assert.equal(result.coverage.returnedVerseCount, 30);
			assert.equal(result.coverage.returnedReference, "Psalms 119:1-30");
		}
		assert.equal(get.reference, "Psalms 119:1-30");
		assert.ok(get.contextVerses.length > 0);
	});
}

test("single verse and numbered-book aliases retain existing fields", async () => {
	const { tools } = makeTools();
	const result = await execute(tools.findVerses, { query: "1 Jn 1:9" });
	assert.equal(result.coverage.returnedReference, "1 John 1:9");
	assert.equal(result.verses.length, 1);
	assert.equal(result.verses[0].translation, "KJV");
	assert.equal(result.coverage.requestedVerseCount, 1);
	assert.equal(result.truncated, false);
});

for (const query of ["John 3:18-16", "John 3:16-4:2", "John 3:16-", "John 3:16,18", "John 3-4", "John 3:0", "John 0:1", "John 22:1", "John 3:36-40", "John 3:37"]) {
	test(`reference lookups reject instead of silently narrowing: ${query}`, async () => {
		const { tools, state } = makeTools();
		await assert.rejects(execute(tools.findVerses, { query }));
		assert.equal(state.fullTextCalls.length, 0);
	});
}

test("getPassage rejects invalid boundaries and conflicting findVerses book filters", async () => {
	const { tools } = makeTools();
	for (const coordinates of [{ chapter: 3, verseStart: 18, verseEnd: 16 }, { chapter: 3, verseStart: 36, verseEnd: 37 }, { chapter: 22, verseStart: 1 }]) {
		await assert.rejects(execute(tools.getPassage, { book: "John", ...coordinates }));
	}
	await assert.rejects(execute(tools.findVerses, { query: "John 3:16", book: "Romans" }), /different books/);
});

test("keyword searches still execute through fulltext with the requested limit and book", async () => {
	const { tools, state } = makeTools();
	const result = await execute(tools.findVerses, { query: "be still and know", book: "Ps", limit: 3 });
	assert.deepEqual(state.fullTextCalls, [["be still and know", 3, { book: 19 }]]);
	assert.deepEqual(result.verses, []);
	assert.equal(result.coverage, undefined);
});

test("real cross-reference excerpts label actual text and disclose list coverage", async () => {
	const { tools } = makeTools();
	const result = await execute(tools.getCrossReferences, { book: "Jn", chapter: 1, verse: 5 });
	const ref = result.crossReferences.find(row => row.reference === "John 12:36-40");
	assert.ok(ref);
	assert.equal(ref.quotedReference, "John 12:36-40");
	assert.equal(ref.text, (await getChapter("KJV", 43, 12)).slice(35, 40).join(" "));
	assert.deepEqual(ref.coverage, { requestedReference: "John 12:36-40", returnedReference: "John 12:36-40", requestedVerseCount: 5, returnedVerseCount: 5, truncated: false });
	assert.match(result.formatted, /John 12:36-40 KJV:/);
	assert.equal(result.returnedCount, 8);
	assert.ok(result.total >= result.returnedCount);
	assert.equal(result.truncated, result.total > 8);
});

test("cross-reference quote and list caps are exact, cross-chapter edges remain explicitly unquoted", async () => {
	const edges = [
		{ order: 19, chapter: 119, verse: 1, endChapter: 119, endVerse: 30 },
		{ order: 19, chapter: 119, verse: 1, endChapter: 119, endVerse: 31 },
		{ order: 43, chapter: 3, verse: 36, endChapter: 4, endVerse: 2 },
	];
	const { tools } = makeTools({ crossReferences: async () => edges });
	const result = await execute(tools.getCrossReferences, { book: "John", chapter: 3, verse: 16 });
	assert.equal(result.crossReferences[0].coverage.truncated, false);
	assert.equal(result.crossReferences[0].coverage.returnedVerseCount, 30);
	assert.equal(result.crossReferences[1].coverage.truncated, true);
	assert.equal(result.crossReferences[1].text, undefined);
	assert.equal(result.crossReferences[1].quotedReference, null);
	assert.equal(result.crossReferences[1].coverage.returnedVerseCount, 0);
	assert.match(result.crossReferences[1].notice, /exceeds 30/);
	assert.equal(result.crossReferences[2].text, undefined);
	assert.equal(result.crossReferences[2].quotedReference, null);
	assert.equal(result.crossReferences[2].coverage.returnedVerseCount, 0);
	assert.equal(result.truncated, false);
	for (const count of [8, 9]) {
		const { tools } = makeTools({ crossReferences: async () => Array.from({ length: count }, () => edges[0]) });
		const result = await execute(tools.getCrossReferences, { book: "John", chapter: 3, verse: 16 });
		assert.equal(result.returnedCount, 8);
		assert.equal(result.total, count);
		assert.equal(result.truncated, count === 9);
	}
});

test("cross-reference source coordinates must exist", async () => {
	const { tools } = makeTools();
	await assert.rejects(execute(tools.getCrossReferences, { book: "John", chapter: 3, verse: 37 }));
	await assert.rejects(execute(tools.getCrossReferences, { book: "John", chapter: 22, verse: 1 }));
});

test("missing quotation text fails explicitly instead of returning a shortened passage", async () => {
	const { tools } = makeTools({ loadChapter: async (...args) => {
		const verses = [...await getChapter(...args)];
		verses[16] = "";
		return verses;
	} });
	await assert.rejects(execute(tools.findVerses, { query: "John 3:16-18" }), /unavailable/);
});

for (const [book, order, chapter, verse] of [["Psalms", 19, 3, 1], ["Joel", 29, 2, 28], ["Isaiah", 23, 64, 1], ["John", 43, 3, 16]]) {
	test(`getOriginalText preserves the KJV-to-source mapping: ${book} ${chapter}:${verse}`, async () => {
		const { tools } = makeTools();
		const result = await execute(tools.getOriginalText, { book, chapter, verse });
		const mapped = await originals.getOriginalVerseForKjv(order, chapter, verse);
		assert.equal(result.reference, `${book} ${chapter}:${verse}`);
		assert.deepEqual(result.words, mapped.words);
		assert.deepEqual(result.requestedReference, { book: order, chapter, verse, versification: "KJV" });
		assert.deepEqual(result.sourceReferences, mapped.sourceReferences);
		assert.equal(result.sourceVersification, order <= 39 ? "WLC" : "TR");
		assert.match(result.formatted, /KJV reference aligned to/);
		if (order === 19) {
			assert.notDeepEqual(result.words, (await originals.getOriginalVerse(order, chapter, verse)).words);
			assert.deepEqual(result.sourceReferences, [{ book: 19, chapter: 3, verse: 2 }]);
		}
	});
}

test("cross-reference tools never return an incomplete quotation when a requested verse is missing", async () => {
	const { tools } = makeTools({
		crossReferences: async () => [{ order: 43, chapter: 12, verse: 36, endChapter: 12, endVerse: 40 }],
		loadChapter: async (...args) => {
			const verses = [...await getChapter(...args)];
			if (args[1] === 43 && args[2] === 12) verses[39] = "";
			return verses;
		},
	});
	const result = await execute(tools.getCrossReferences, { book: "John", chapter: 1, verse: 5 });
	const ref = result.crossReferences[0];
	assert.equal(ref.reference, "John 12:36-40");
	assert.equal(ref.text, undefined);
	assert.equal(ref.quotedReference, null);
	assert.equal(ref.coverage.returnedVerseCount, 0);
	assert.equal(ref.coverage.requestedVerseCount, 5);
	assert.equal(ref.coverage.truncated, true);
	assert.match(result.formatted, /reference only/);
});
