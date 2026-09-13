import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { readStoredHighlightLabels } from "../src/lib/preferences-contract.ts";

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

// The real book table, so a reason names the book the product names.
const BOOKS = JSON.parse(read("../src/data/books.json"));
const bookByOrder = (order) => BOOKS.find((book) => book.order === order) ?? null;

const {
	createVerseWeights,
	describeWhen,
	fallbackReason,
	rankSuggestions,
	suggestionReason,
	toolVerseReferences,
	verseKey,
	HIGH_WEIGHT,
} = loadModule(
	"../src/lib/learn-suggestions.ts",
	[
		"createVerseWeights",
		"describeWhen",
		"fallbackReason",
		"rankSuggestions",
		"suggestionReason",
		"toolVerseReferences",
		"verseKey",
		"HIGH_WEIGHT",
	],
	{ bookByOrder }
);

const LA = "America/Los_Angeles";
const NOW = new Date("2026-09-12T18:00:00Z"); // Saturday 11am in Los Angeles

const ROMANS = 45;
const JOHN = 43;
const PSALMS = 19;

/** A small hand-made index, so the ranking is tested without the real corpus. */
const weights = createVerseWeights({
	minCount: 12,
	verses: {
		[verseKey(ROMANS, 8, 28)]: 62,
		[verseKey(ROMANS, 8, 31)]: 86,
		[verseKey(ROMANS, 8, 1)]: 28,
		[verseKey(JOHN, 3, 16)]: 59,
		[verseKey(JOHN, 3, 3)]: 31,
		[verseKey(JOHN, 14, 6)]: 45,
		[verseKey(PSALMS, 103, 2)]: 20,
	},
});

const signal = (source, book, chapter, verse, at, extra = {}) => ({
	source,
	book,
	chapter,
	...(verse === null ? {} : { verse }),
	at: new Date(at),
	...extra,
});

const rank = (signals, options = {}) =>
	rankSuggestions({
		signals,
		weights,
		excluded: new Set(),
		now: NOW,
		timezone: LA,
		...options,
	});

test("a highlight outranks reading, and reading outranks chat", () => {
	const ranked = rank([
		signal("chat", ROMANS, 8, 28, "2026-09-12T17:00:00Z"),
		signal("reading", JOHN, 3, null, "2026-09-10T17:00:00Z"),
		signal("highlight", PSALMS, 103, 2, "2026-09-01T17:00:00Z", { colorName: "Blue" }),
	]);

	assert.deepEqual(
		ranked.map((suggestion) => suggestion.source),
		["highlight", "reading", "chat"]
	);
	// The oldest signal wins because it is the strongest kind, not the newest.
	assert.equal(ranked[0].verse, 2);
});

test("weight breaks a tie between two signals of the same kind and day", () => {
	const ranked = rank([
		signal("highlight", ROMANS, 8, 28, "2026-09-12T05:00:00Z"),
		signal("highlight", JOHN, 3, 16, "2026-09-12T06:00:00Z"),
	]);

	assert.deepEqual(
		ranked.map((suggestion) => `${suggestion.book}:${suggestion.chapter}:${suggestion.verse}`),
		[verseKey(ROMANS, 8, 28), verseKey(JOHN, 3, 16)]
	);
	assert.equal(ranked[0].weight, 62);
});

test("a verse below the index threshold is never suggested on nearness alone", () => {
	const ranked = rank([signal("highlight", JOHN, 11, 35, "2026-09-12T05:00:00Z")]);
	assert.deepEqual(ranked, []);
});

test("one verse per chapter, and the heaviest verse of a read chapter is the one offered", () => {
	const ranked = rank([
		signal("reading", ROMANS, 8, null, "2026-09-12T05:00:00Z"),
		signal("chat", ROMANS, 8, 1, "2026-09-12T06:00:00Z"),
		signal("chat", JOHN, 3, 16, "2026-09-11T06:00:00Z"),
	]);

	assert.equal(ranked.length, 2);
	assert.equal(ranked[0].chapter, 8);
	assert.equal(ranked[0].verse, 31, "Romans 8:31 is the heaviest verse of the chapter he read");
	assert.equal(ranked[1].book, JOHN);
});

test("a verse already in the queue is excluded, and the next one takes its place", () => {
	const signals = [
		signal("reading", ROMANS, 8, null, "2026-09-12T05:00:00Z"),
		signal("highlight", JOHN, 3, 16, "2026-09-12T05:00:00Z"),
	];
	const excluded = new Set([verseKey(JOHN, 3, 16), verseKey(ROMANS, 8, 31)]);

	const ranked = rankSuggestions({ signals, weights, excluded, now: NOW, timezone: LA });

	assert.deepEqual(
		ranked.map((suggestion) => verseKey(suggestion.book, suggestion.chapter, suggestion.verse)),
		[verseKey(ROMANS, 8, 28)]
	);
});

test("at most five suggestions come back", () => {
	const signals = [
		signal("highlight", ROMANS, 8, 28, "2026-09-12T05:00:00Z"),
		signal("highlight", ROMANS, 8, 31, "2026-09-12T05:00:00Z"),
		signal("highlight", JOHN, 3, 16, "2026-09-12T05:00:00Z"),
		signal("highlight", JOHN, 3, 3, "2026-09-12T05:00:00Z"),
		signal("highlight", PSALMS, 103, 2, "2026-09-12T05:00:00Z"),
	];
	// Five signals, but only three chapters between them.
	assert.equal(rank(signals).length, 3);
	assert.ok(rank(signals).length <= 5);
});

test("with no personal signal the fallback names the last chapter read and says why", () => {
	const ranked = rank([], { lastChapterRead: { book: ROMANS, chapter: 8 } });

	assert.equal(ranked.length, 3, "the fixture chapter holds three weighted verses");
	assert.equal(ranked[0].verse, 31);
	assert.equal(ranked[0].source, "reading");
	assert.equal(
		ranked[0].reason,
		"You have no recent marks or reading to go on, so this is one of the verses the rest of " +
			"Scripture leans on most in Romans 8, the last chapter you read, and Scripture points back to it 86 times."
	);
});

test("with no personal signal and nothing ever read, nothing is invented", () => {
	assert.deepEqual(rank([]), []);
});

test("the fallback still skips a verse already in the queue", () => {
	const ranked = rankSuggestions({
		signals: [],
		weights,
		excluded: new Set([verseKey(ROMANS, 8, 31)]),
		lastChapterRead: { book: ROMANS, chapter: 8 },
		now: NOW,
		timezone: LA,
	});
	assert.deepEqual(
		ranked.map((suggestion) => suggestion.verse),
		[28, 1]
	);
});

test("every source writes a reason a person would recognise", () => {
	const at = "2026-09-08T17:00:00Z"; // Tuesday in Los Angeles
	const cases = [
		[
			signal("highlight", ROMANS, 8, 28, at, { colorName: "Blue" }),
			20,
			"You marked this in blue on Tuesday.",
		],
		[
			signal("highlight", ROMANS, 8, 28, at, { colorName: "Blue", colorLabel: "Promises" }),
			20,
			"You marked this in blue for Promises on Tuesday.",
		],
		[signal("highlight", ROMANS, 8, 28, at, { colorName: null }), 20, "You highlighted this on Tuesday."],
		[
			signal("reading", ROMANS, 8, null, at),
			62,
			"You read Romans 8 on Tuesday, and Scripture points back to it 62 times.",
		],
		[
			signal("chat", ROMANS, 8, 28, at, { title: "Why did Jesus turn water into wine?" }),
			20,
			'This came up in your chat "Why did Jesus turn water into wine?" on Tuesday.',
		],
		[signal("chat", ROMANS, 8, 28, at), 20, "This came up in a chat you had on Tuesday."],
		[signal("cross", ROMANS, 8, 28, at), 20, "This was your cross on Tuesday."],
		[
			signal("note", ROMANS, 8, 28, at, { title: "John 1:1 Study" }),
			20,
			'You quoted it in your note "John 1:1 Study" on Tuesday.',
		],
		[signal("note", ROMANS, 8, 28, at), 20, "You quoted it in one of your notes on Tuesday."],
	];

	for (const [input, weight, expected] of cases) {
		assert.equal(suggestionReason(input, weight, NOW, LA), expected);
	}
});

test("today's cross reads in the present tense", () => {
	const today = signal("cross", ROMANS, 8, 28, "2026-09-12T15:00:00Z");
	assert.equal(suggestionReason(today, 20, NOW, LA), "This is your cross today.");
});

test("the weight clause appears only when the verse is genuinely heavy", () => {
	const at = "2026-09-08T17:00:00Z";
	const light = suggestionReason(signal("cross", ROMANS, 8, 28, at), HIGH_WEIGHT - 1, NOW, LA);
	const heavy = suggestionReason(signal("cross", ROMANS, 8, 28, at), HIGH_WEIGHT, NOW, LA);

	assert.ok(!light.includes("points back"));
	assert.equal(heavy, `This was your cross on Tuesday, and Scripture points back to it ${HIGH_WEIGHT} times.`);
	assert.ok(!fallbackReason(ROMANS, 8, 10).includes("points back"));
});

test("when is said the way a person says it", () => {
	const when = (iso) => describeWhen(new Date(iso), NOW, LA);
	assert.equal(when("2026-09-12T15:00:00Z"), "today");
	assert.equal(when("2026-09-13T05:00:00Z"), "today", "10pm tonight is still today in Los Angeles");
	assert.equal(when("2026-09-11T17:00:00Z"), "yesterday");
	assert.equal(when("2026-09-08T17:00:00Z"), "on Tuesday");
	assert.equal(when("2026-09-03T17:00:00Z"), "on 3 September");
	assert.equal(when("2025-12-25T17:00:00Z"), "on 25 December 2025");
});

test("tool verse citations are read out of message metadata, and nothing else is", () => {
	const metadata = {
		parts: [
			{ type: "text", text: "Romans 8:28 is not a citation part" },
			{
				type: "tool-getPassage",
				state: "output-available",
				output: {
					reference: "John 3:3-5",
					verses: [
						{ reference: "John 3:3", text: "..." },
						{ reference: "John 3:4", text: "..." },
						{ reference: "John 3:5", text: "..." },
					],
				},
			},
		],
	};

	assert.deepEqual(toolVerseReferences(metadata), ["John 3:3", "John 3:4", "John 3:5"]);
	assert.deepEqual(toolVerseReferences({ parts: [{ type: "tool-x", output: { verses: "nope" } }] }), []);
	assert.deepEqual(toolVerseReferences(null), []);
	assert.deepEqual(toolVerseReferences({ followUps: ["a"] }), []);
});

test("one tool result cannot flood the ranking with a whole chapter", () => {
	const verses = Array.from({ length: 40 }, (_, index) => ({ reference: `Psalm 119:${index + 1}` }));
	const references = toolVerseReferences({ parts: [{ type: "tool-getPassage", output: { verses } }] });
	assert.equal(references.length, 12);
});

test("the bundled index holds the verses Scripture leans on and drops the rest", () => {
	const file = JSON.parse(read("../src/data/learn/verse-significance.json"));
	const index = createVerseWeights(file);

	assert.equal(file.minCount, 12);
	// Verses the contract names as load-bearing.
	assert.ok(index.of(ROMANS, 8, 28) >= 50, "Romans 8:28 is heavy");
	assert.ok(index.of(JOHN, 3, 16) >= 50, "John 3:16 is heavy");
	assert.ok(index.of(23, 53, 5) >= 20, "Isaiah 53:5 is heavy");

	// A verse nothing points back to is simply absent.
	assert.equal(index.of(13, 26, 18), 0, "1 Chronicles 26:18 is not load-bearing");
	assert.equal(index.of(4, 7, 47), 0, "Numbers 7:47 is not load-bearing");

	// Nothing below the threshold survived the build.
	for (const count of Object.values(file.verses)) assert.ok(count >= file.minCount);

	// The chapter view is sorted heaviest first.
	const romans8 = index.chapter(ROMANS, 8);
	assert.ok(romans8.length > 0);
	for (let i = 1; i < romans8.length; i++) assert.ok(romans8[i - 1].weight >= romans8[i].weight);
});

test("a read chapter offers nothing unless one of its verses is genuinely load-bearing", () => {
	// Psalm 103:2 sits in the index at 20, well under the reading bar, so
	// "you read this chapter" alone never puts it on a card.
	assert.deepEqual(rank([signal("reading", PSALMS, 103, null, "2026-09-12T05:00:00Z")]), []);

	// The same chapter still qualifies the moment the user marks the verse.
	const marked = rank([signal("highlight", PSALMS, 103, 2, "2026-09-12T05:00:00Z", { colorName: "Blue" })]);
	assert.equal(marked.length, 1);
	assert.equal(marked[0].verse, 2);
});

test("one kind of signal does not take the whole screen while others are waiting", () => {
	const day = "2026-09-12T05:00:00Z";
	const ranked = rank([
		signal("highlight", ROMANS, 8, 28, day),
		signal("highlight", ROMANS, 8, 31, day),
		signal("highlight", JOHN, 3, 16, day),
		signal("highlight", PSALMS, 103, 2, day),
		signal("chat", JOHN, 14, 6, day),
	]);

	// Four highlights outrank the one chat citation, and the cap still gives it
	// the third slot; the fourth highlight only lands after, on the fill pass.
	assert.deepEqual(
		ranked.map((suggestion) => suggestion.source),
		["highlight", "highlight", "chat", "highlight"]
	);
});

test("the cap never leaves the screen half empty when nothing else is waiting", () => {
	const day = "2026-09-12T05:00:00Z";
	const ranked = rank([
		signal("highlight", ROMANS, 8, 28, day),
		signal("highlight", JOHN, 3, 16, day),
		signal("highlight", PSALMS, 103, 2, day),
	]);

	assert.equal(ranked.length, 3, "all three survive once the cap has had its pass");
	assert.deepEqual(new Set(ranked.map((suggestion) => suggestion.source)), new Set(["highlight"]));
});

/* --------------------------------------------------------------- the route */

test("GET /api/learn/suggestions hands suggestVerses the account's translation and colour names", async () => {
	const calls = [];
	const { GET } = loadModule("../src/app/api/learn/suggestions/route.ts", ["GET"], {
		NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
		getAuthUser: async () => "user_1",
		DEFAULT_TRANSLATION: "KJV",
		TRANSLATION_IDS: ["KJV", "NKJV"],
		readStoredHighlightLabels,
		suggestVerses: async (...args) => {
			calls.push(args);
			return [];
		},
		prisma: {
			user: {
				findUnique: async () => ({
					translation: "NKJV",
					highlightLabels: { blue: "Promises" },
				}),
			},
		},
	});

	const response = await GET();
	assert.equal(response.status, 200);
	assert.deepEqual(response.body, { suggestions: [] });
	assert.deepEqual(calls, [["user_1", "NKJV", { blue: "Promises" }]]);
});

test("GET /api/learn/suggestions degrades a stored labels value that is not a map to no labels", async () => {
	const calls = [];
	const { GET } = loadModule("../src/app/api/learn/suggestions/route.ts", ["GET"], {
		NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
		getAuthUser: async () => "user_1",
		DEFAULT_TRANSLATION: "KJV",
		TRANSLATION_IDS: ["KJV", "NKJV"],
		readStoredHighlightLabels,
		suggestVerses: async (...args) => {
			calls.push(args);
			return [];
		},
		prisma: {
			user: {
				findUnique: async () => ({ translation: "KJV", highlightLabels: "Promises" }),
			},
		},
	});

	const response = await GET();
	assert.equal(response.status, 200);
	assert.deepEqual(calls, [["user_1", "KJV", {}]]);
});
