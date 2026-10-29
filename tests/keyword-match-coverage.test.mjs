import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Prisma } from "@prisma/client";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const assetRoot = existsSync(path.join(sourceRoot, "src/data/books.json")) ? sourceRoot : path.resolve(sourceRoot, "../../..");
const json = relative => JSON.parse(readFileSync(path.join(assetRoot, relative), "utf8"));
const booksData = json("src/data/books.json");
const compiled = new Map();
function load(relative, mocks = {}) {
	const filename = path.join(existsSync(path.join(sourceRoot, relative)) ? sourceRoot : assetRoot, relative);
	if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText);
	const loadedModule = { exports: {} };
	const localRequire = createRequire(filename);
	new Function("require", "module", "exports", compiled.get(filename))(id => {
		if (id in mocks) return mocks[id];
		if (id.startsWith("@/")) return {};
		return localRequire(id);
	}, loadedModule, loadedModule.exports);
	return loadedModule.exports;
}
const bookApi = load("src/lib/bible/books.ts", {
	"@/data/books.json": booksData, "@/data/book-names.json": json("src/data/book-names.json"),
});
const kjvApi = load("src/utils/kjvBible.ts");
const chapterCache = new Map();
async function getChapter(translation, order, chapter) {
	const key = translation + ":" + order;
	if (!chapterCache.has(key)) {
		const file = translation === "KJV" ? "src/data/kjv/" + booksData.find(book => book.order === order).file
			: "src/data/" + translation.toLowerCase() + "/" + String(order).padStart(2, "0") + ".json";
		chapterCache.set(key, json(file));
	}
	const rows = chapterCache.get(key)[chapter - 1];
	if (!rows) throw new Error("Unavailable chapter");
	return translation === "BSB" ? rows.map(row => row.text) : rows;
}
const translations = { getChapter, getVerseText: async (translation, order, chapter, verse) => (await getChapter(translation, order, chapter))[verse - 1] };
const fixtureCoordinates = [[42, 6, 32], [43, 3, 16], [19, 46, 10], [20, 17, 17], [1, 28, 19], [19, 24, 1], [19, 29, 8], [19, 29, 10], [19, 110, 1], [1, 14, 17], [11, 1, 53]];
const fixture = await Promise.all(fixtureCoordinates.map(async ([book, chapter, verse]) => ({
	book, chapter, verse, rank: 1, text: await translations.getVerseText("KJV", book, chapter, verse),
})));
const tokens = text => text.normalize("NFC").toLowerCase().replace(/([a-z0-9])-(?=[a-z0-9])/g, "$1").replace(/[^\p{L}\p{N}\p{M} ]+/gu, " ").split(/\s+/).filter(Boolean);
function clauseMatches(clause, text) {
	const words = tokens(text);
	// PostgreSQL's simple parser splits apostrophized input into adjacent words;
	// a :* modifier applies to every resulting word, including its suffix.
	const terms = [...clause.matchAll(/'((?:''|[^'])+)'(:\*)?/g)].flatMap(match =>
		tokens(match[1].replace(/''/g, "'")).map(word => ({ word, prefix: Boolean(match[2]) })));
	if (clause.includes("<->") || terms.length > 1) return words.some((_, offset) => terms.every((term, index) =>
		term.prefix ? words[offset + index]?.startsWith(term.word) : words[offset + index] === term.word));
	return terms.every(term => words.some(word => term.prefix ? word.startsWith(term.word) : word === term.word));
}
function harness({ vector = true, keywordFailure = false, translation = "KJV" } = {}) {
	const keywordCalls = [];
	const vectorCalls = [];
	const fulltext = load("src/lib/bible/verse-fulltext.ts", {
		"@prisma/client": { Prisma },
		"@/utils/kjvBible": kjvApi,
		"@/lib/search-query": { searchQuery: async sql => {
			if (keywordFailure) throw new Error("Index unavailable");
			const query = sql.values[0];
			const limit = sql.values.at(-1);
			const book = sql.values.length === 3 ? sql.values[1] : undefined;
			keywordCalls.push({ query, limit, book });
			return fixture.filter(row => (book === undefined || row.book === book) &&
				query.split(" | ").some(group => group.split(" & ").every(clause => clauseMatches(clause, row.text)))).slice(0, limit);
		} },
	});
	const searchWords = load("src/lib/bible/search-words.ts");
	const semantic = load("src/lib/scripture-search.ts", {
		"@prisma/client": { Prisma }, "@/lib/bible/translations": translations,
		"@/utils/kjvBible": kjvApi, "@/lib/bible/verse-fulltext": fulltext,
		"@/lib/bible/search-words": searchWords,
		"@/lib/ai/embeddings": { queryEmbedding: async () => vector ? [0.25] : null, EMBEDDING_MODEL_ID: "fixture", EMBEDDING_DIMENSIONS: 3072 },
		"@/lib/search-query": { searchQuery: async sql => {
			vectorCalls.push(sql);
			return [
				{ book: 43, chapter: 3, verse: 16, distance: 0.4, vectorCount: 1 },
				{ book: 42, chapter: 6, verse: 32, distance: 0.8, vectorCount: 1 },
			];
		} },
	});
	const passage = load("src/lib/bible/passage-context.ts", { "@/lib/bible/books": bookApi, "@/lib/bible/translations": translations });
	const builders = Object.fromEntries(["serve", "reading", "memory", "onboarding", "study"].map(name => [
		"@/lib/" + name + "-tools", { ["build" + name[0].toUpperCase() + name.slice(1) + "Tools"]: () => ({}) },
	]));
	const ai = load("src/lib/ai-tools.ts", {
		...builders, ai: { tool: value => value },
		"@/lib/agent-actions": { buildActionTools: () => ({}) },
		"@/lib/bible/verse-fulltext": fulltext, "@/lib/scripture-search": semantic,
		"@/lib/bible/books": bookApi, "@/utils/kjvBible": kjvApi, "@/lib/bible/passage-context": passage,
		"@/lib/bible/translations": translations,
		"@/lib/bible/atlas": { ATLAS_ERAS: [] }, "@/lib/highlights": { HIGHLIGHT_COLORS: [] },
		"@/lib/reading-plan-presets": { READING_PLAN_PRESETS: [] },
	});
	return { fulltext, semantic, tools: ai.buildSureWordTools({ userId: "keyword-fixture", translation }), keywordCalls, vectorCalls };
}

for (const allowPartial of [undefined, false]) {
	test("default and explicit strict queries never silently fall back: " + String(allowPartial), async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query: "banana love", allowPartial });
		assert.deepEqual(output.verses, []);
		assert.equal(output.matchMode, "none");
		assert.equal(output.relaxed, false);
		assert.equal(output.averageSimilarity, 0);
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'banana':* & 'love':*"]);
		assert.match(output.formatted, /No KJV verses matched all search clauses/);
		assert.equal(output.coverage, undefined, "passage coverage has a separate shape");
	});
}

test("explicit partial recall labels missing terms and never invents perfect strength", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "banana love", allowPartial: true });
	assert.ok(output.verses.length > 0);
	assert.ok(output.verses.every(verse => verse.similarity === 0));
	assert.equal(output.averageSimilarity, 0);
	assert.equal(output.matchMode, "any");
	assert.equal(output.relaxed, true);
	assert.equal(output.keywordCoverage.requestedClauseCount, 2);
	assert.equal(output.keywordCoverage.indexedTranslation, "KJV");
	assert.equal(output.keywordCoverage.totalMatches, null);
	assert.match(output.formatted, /only some terms/);
	assert.match(output.formatted, /not an exhaustive corpus count/);
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'banana':* & 'love':*", "'banana':* | 'love':*"]);
});

test("an exact all-term match never relaxes even when retry is enabled", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "love world", allowPartial: true });
	assert.deepEqual(output.verses.map(verse => verse.reference), ["John 3:16"]);
	assert.equal(output.matchMode, "all");
	assert.equal(output.relaxed, false);
	assert.equal(output.averageSimilarity, 1);
	assert.equal(h.keywordCalls.length, 1);
});

for (const query of ['"banana love"', '"be still" banana love', '"be still" "banana love"']) {
	test("quoted phrase clauses remain mandatory: " + query, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query, allowPartial: true });
		assert.deepEqual(output.verses, []);
		assert.equal(output.relaxed, false);
		assert.equal(h.keywordCalls.length, 1);
	});
}

for (const [query, expected] of [['"be still and know"', "Psalms 46:10"], ["loveth", "Proverbs 17:17"], ["Beth-el", "Genesis 28:19"]]) {
	test("legitimate lexical recall is preserved: " + query, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query });
		assert.ok(output.verses.some(verse => verse.reference === expected));
		assert.equal(output.matchMode, "all");
		assert.equal(output.relaxed, false);
	});
}

test("book filters, cap-plus-one truncation and bounded unknown totals are honest", async () => {
	const h = harness();
	const page = await h.tools.findVerses.execute({ query: "love", limit: 1 });
	assert.equal(page.verses.length, 1);
	assert.equal(page.keywordCoverage.returnedCount, 1);
	assert.equal(page.keywordCoverage.limit, 1);
	assert.equal(page.truncated, true);
	assert.equal(h.keywordCalls[0].limit, 2);
	assert.match(page.formatted, /More matches exist/);
	const filtered = await h.tools.findVerses.execute({ query: "love", book: "John" });
	assert.deepEqual(filtered.verses.map(verse => verse.reference), ["John 3:16"]);
	assert.equal(filtered.truncated, false);
	assert.equal(h.keywordCalls.at(-1).book, 43);
});

test("empty queries make no SQL call and array compatibility stays strict", async () => {
	const h = harness();
	const empty = await h.fulltext.findVersesFullTextDetailed("!!!", 5, { allowPartial: true });
	assert.deepEqual(empty.hits, []);
	assert.equal(empty.coverage.requestedClauseCount, 0);
	assert.equal(h.keywordCalls.length, 0);
	assert.deepEqual(await h.fulltext.findVersesFullText("banana love", 5), []);
	assert.equal(h.keywordCalls.length, 1);
});

test("no-hit partial retry says it found no candidates without fabricating coverage", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "banana nonexistentxyz", allowPartial: true });
	assert.equal(output.matchMode, "none");
	assert.equal(output.relaxed, true);
	assert.deepEqual(output.verses, []);
	assert.match(output.formatted, /partial-word retry found no candidates/);
});

test("named reference lookup keeps its original passage coverage and bypasses keyword queries", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "John 3:16-18", allowPartial: true });
	assert.deepEqual(output.verses.map(verse => verse.reference), ["John 3:16", "John 3:17", "John 3:18"]);
	assert.equal(output.coverage.requestedVerseCount, 3);
	assert.equal(output.coverage.returnedVerseCount, 3);
	assert.equal(output.keywordCoverage, undefined);
	assert.equal(output.averageSimilarity, 1);
	assert.equal(h.keywordCalls.length, 0);
});

test("other translation quotations never imply membership of KJV search words", async () => {
	const h = harness({ translation: "BSB" });
	const output = await h.tools.findVerses.execute({ query: "loveth" });
	assert.equal(output.verses[0].translation, "BSB");
	assert.match(output.verses[0].text, /friend loves/);
	assert.doesNotMatch(output.verses[0].text, /loveth/i);
	assert.match(output.formatted, /Word matching used KJV; displayed quotations use BSB/);
	assert.match(output.formatted, /Do not claim those words occur in BSB/);
});

test("hybrid retrieval explicitly preserves partial recall and keeps actual cosine scores", async () => {
	const h = harness();
	const output = await h.semantic.searchScripture("banana love", 5);
	assert.equal(output.keywordCoverage.relaxed, true);
	assert.equal(output.keywordCoverage.matchMode, "any");
	assert.equal(output.degraded, undefined);
	assert.deepEqual(output.verses.map(verse => verse.similarity), [0.8, 0.6]);
	assert.ok(Math.abs(output.averageSimilarity - 0.7) < 1e-12);
	assert.equal(h.vectorCalls.length, 1);
	assert.equal(h.keywordCalls.length, 2);
});

test("degraded hybrid retrieval retains zero strength and reports the actual bounded page", async () => {
	const h = harness({ vector: false });
	const output = await h.semantic.searchScripture("banana love", 1);
	assert.equal(output.degraded, true);
	assert.equal(output.keywordCoverage.relaxed, true);
	assert.equal(output.keywordCoverage.returnedCount, 1);
	assert.equal(output.keywordCoverage.limit, 1);
	assert.equal(output.keywordCoverage.truncated, true);
	assert.equal(output.verses.length, 1);
	assert.equal(output.verses[0].similarity, 0);
	assert.equal(output.averageSimilarity, 0);
	assert.equal(h.vectorCalls.length, 0);
});

test("keyword outage does not become an empty-search assertion or prevent vector evidence", async () => {
	const h = harness({ keywordFailure: true });
	const output = await h.semantic.searchScripture("banana love", 5);
	assert.equal(output.keywordCoverage, undefined);
	assert.equal(output.degraded, undefined);
	assert.equal(output.verses.length, 2);
	assert.deepEqual(output.verses.map(verse => verse.similarity), [0.8, 0.6]);
});

test("combined retrieval outage cannot fabricate matches or known keyword coverage", async () => {
	const h = harness({ vector: false, keywordFailure: true });
	const output = await h.semantic.searchScripture("banana love", 5);
	assert.equal(output.degraded, true);
	assert.equal(output.keywordCoverage, undefined);
	assert.deepEqual(output.verses, []);
	assert.equal(output.averageSimilarity, 0);
});

for (const vector of [true, false]) {
	test("semantic tool formatted output discloses partial keyword recall; vector=" + vector, async () => {
		const h = harness({ vector });
		const output = await h.tools.searchScripture.execute({ query: "banana love" });
		assert.match(output.formatted, /Keyword candidate search:/);
		assert.match(output.formatted, /only some terms/);
		assert.equal(output.keywordCoverage.relaxed, true);
		assert.equal(output.verses.some(verse => verse.similarity === 1), false);
	});
}

for (const query of ['“be still” banana love', '„be still“ banana love', '‟be still” banana love', '＂be still＂ banana love', '"be still” banana love', '«be still» banana love', '»be still« banana love']) {
	test("typographic double quotes preserve the mandatory phrase: " + query, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query, allowPartial: true });
		assert.deepEqual(output.verses, []);
		assert.equal(output.relaxed, false);
		assert.equal(output.keywordCoverage.queryError, undefined);
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'be' <-> 'still' & 'banana':* & 'love':*"]);
	});
}

for (const query of ['"be still banana love', 'be still" banana love', '“be still banana love', 'be still” banana love', '"be still" "banana love', '"" banana love', '"!!!" banana love', '«be still banana love', 'be still» banana love']) {
	test("malformed or empty quoted clauses never become bare recall: " + query, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query, allowPartial: true });
		assert.deepEqual(output.verses, []);
		assert.equal(output.relaxed, false);
		assert.equal(output.matchMode, "none");
		assert.ok(output.keywordCoverage.queryError);
		assert.equal(h.fulltext.buildVerseTsQuery(query), null);
		assert.equal(h.keywordCalls.length, 0);
		assert.match(output.formatted, /search was not run/);
		assert.match(output.formatted, /No conclusion about matching verses/);
		assert.doesNotMatch(output.formatted, /No KJV verse.*matched/);
	});
}

test("a valid typographic double-quoted phrase still retrieves its canonical verse", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: '“be still and know”', allowPartial: true });
	assert.deepEqual(output.verses.map(verse => verse.reference), ["Psalms 46:10"]);
	assert.equal(output.matchMode, "all");
	assert.equal(output.relaxed, false);
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'be' <-> 'still' <-> 'and' <-> 'know'"]);
});

test("book-filtered absence is scoped even when the same words exist elsewhere", async () => {
	const h = harness();
	const scoped = await h.tools.findVerses.execute({ query: "love world", book: "Genesis" });
	assert.deepEqual(scoped.verses, []);
	assert.equal(scoped.keywordCoverage.book, 1);
	assert.equal(scoped.keywordCoverage.bookName, "Genesis");
	assert.match(scoped.formatted, /No KJV verses in Genesis matched all search clauses/);
	assert.match(scoped.formatted, /Only Genesis was searched; no claim is made about other books/);
	assert.equal(h.keywordCalls[0].book, 1);
	const global = await h.tools.findVerses.execute({ query: "love world" });
	assert.deepEqual(global.verses.map(verse => verse.reference), ["John 3:16"]);
	assert.equal(global.keywordCoverage.book, null);
	assert.equal(global.keywordCoverage.bookName, null);
	assert.doesNotMatch(global.formatted, /Only .* was searched/);
});

test("book scope survives successful, partial, failed retry and invalid-query outcomes", async () => {
	for (const [query, expectedMode, relaxed] of [["love", "all", false], ["banana love", "any", true], ["banana nonexistentxyz", "none", true], ['"banana love', "none", false]]) {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query, book: "Jn", allowPartial: true });
		assert.equal(output.keywordCoverage.book, 43);
		assert.equal(output.keywordCoverage.bookName, "John");
		assert.equal(output.matchMode, expectedMode);
		assert.equal(output.relaxed, relaxed);
		assert.ok(h.keywordCalls.every(call => call.book === 43));
		assert.match(output.formatted, /in John/);
		if (!output.keywordCoverage.queryError) assert.match(output.formatted, /Only John was searched/);
	}
});

for (const query of ['«be still and know»', '»be still and know«']) {
	test("guillemet phrase retrieves the canonical verse: " + query, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query, allowPartial: true });
		assert.deepEqual(output.verses.map(verse => verse.reference), ["Psalms 46:10"]);
		assert.equal(output.matchMode, "all");
		assert.equal(output.relaxed, false);
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'be' <-> 'still' <-> 'and' <-> 'know'"]);
	});
}

for (const query of ["lord's", "lord’s"]) {
	test("apostrophized input preserves literal source-word fidelity: " + query, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query, allowPartial: true });
		assert.deepEqual(output.verses.map(verse => verse.reference), ["Psalms 24:1"]);
		assert.equal(output.matchMode, "all");
		assert.equal(output.relaxed, false);
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'lord''s'"]);
		assert.match(output.formatted, /internal apostrophes use exact adjacent indexed words/);
	});
}

test("apostrophized king does not prefix-match King Solomon", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "king’s" });
	assert.deepEqual(output.verses.map(verse => verse.reference), ["Genesis 14:17"]);
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'king''s'"]);
});

test("apostrophized phrase retains surrounding word bounds", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: '"the lord’s"', allowPartial: true });
	assert.deepEqual(output.verses.map(verse => verse.reference), ["Psalms 24:1"]);
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'the' <-> 'lord''s'"]);
	assert.equal(output.relaxed, false);
});

test("partial apostrophe recall keeps its exact word sequence and labels missing terms", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "banana lord's", allowPartial: true });
	assert.deepEqual(output.verses.map(verse => verse.reference), ["Psalms 24:1"]);
	assert.equal(output.matchMode, "any");
	assert.equal(output.relaxed, true);
	assert.equal(output.averageSimilarity, 0);
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'banana':* & 'lord''s'", "'banana':* | 'lord''s'"]);
});

test("ordinary bare stems retain prefix recall after the apostrophe exception", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "lov" });
	assert.ok(output.verses.some(verse => verse.reference === "Proverbs 17:17"));
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'lov':*"]);
});

for (const term of ["ἀγάπη", "愛", "lové", "love\u0301"]) {
	for (const allowPartial of [false, true]) {
		test("Unicode clauses stay present in strict and partial queries: " + term + "; partial=" + allowPartial, async () => {
			const h = harness();
			const output = await h.tools.findVerses.execute({ query: term + " world", allowPartial });
			const clause = "'" + term.normalize("NFC") + "':*";
			assert.equal(h.keywordCalls[0].query, clause + " & 'world':*");
			assert.equal(output.relaxed, allowPartial);
			if (allowPartial) {
				assert.equal(h.keywordCalls[1].query, clause + " | 'world':*");
				assert.equal(output.matchMode, "any");
				assert.equal(output.averageSimilarity, 0);
				assert.deepEqual(output.verses.map(verse => verse.reference), ["John 3:16", "Psalms 24:1"]);
			} else {
				assert.deepEqual(output.verses, []);
				assert.equal(output.matchMode, "none");
			}
		});
	}
	test("Unicode phrase words cannot be discarded: " + term, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query: '"' + term + ' world"', allowPartial: true });
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'" + term.normalize("NFC") + "' <-> 'world'"]);
		assert.deepEqual(output.verses, []);
		assert.equal(output.relaxed, false);
	});
}

test("emoji and punctuation remain ignorable without dropping Unicode words", async () => {
	const h = harness();
	const output = await h.tools.findVerses.execute({ query: "🫶 love!" });
	assert.equal(output.matchMode, "all");
	assert.deepEqual(h.keywordCalls.map(call => call.query), ["'love':*"]);
});

for (const marks of ["🙏\uFE0F", "\u0301"]) {
	test("standalone marks do not become mandatory search clauses: " + marks, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query: marks + " love" });
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'love':*"]);
		assert.equal(output.matchMode, "all");
		assert.equal(output.keywordCoverage.requestedClauseCount, 1);
	});
	test("mark-only quoted phrases reject without searching: " + marks, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query: '"' + marks + '" love', allowPartial: true });
		assert.equal(h.keywordCalls.length, 0);
		assert.deepEqual(output.verses, []);
		assert.equal(output.keywordCoverage.queryError, "empty_quoted_phrase");
		assert.equal(output.relaxed, false);
	});
}

for (const term of ["कर्म", "שָׁלוֹם"]) {
	test("combining marks inside real Unicode words remain mandatory: " + term, async () => {
		const h = harness();
		const output = await h.tools.findVerses.execute({ query: term + " love" });
		assert.deepEqual(h.keywordCalls.map(call => call.query), ["'" + term.normalize("NFC") + "':* & 'love':*"]);
		assert.deepEqual(output.verses, []);
		assert.equal(output.keywordCoverage.requestedClauseCount, 2);
	});
}
