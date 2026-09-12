import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { HIGHLIGHT_COLORS } from "../src/lib/highlights.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/**
 * Evaluate the shipped module with its "@/" dependencies handed in by name
 * (same recipe as verse-parser.test.mjs), so the code under test is the real
 * source rather than a copy.
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

const booksJson = JSON.parse(read("../src/data/books.json"));
const { resolveReference } = loadModule("../src/lib/bible/books.ts", ["resolveReference"], { booksJson });

// Real verse counts from the bundled KJV, so a clamp or a missing verse is
// checked against the Bible the reader shows.
async function getChapter(translation, order, chapter) {
	assert.equal(translation, "KJV", "verse counts always come from the bundled KJV");
	const book = booksJson.find((entry) => entry.order === order);
	const chapters = JSON.parse(read(`../src/data/kjv/${book.file}`));
	const verses = chapters[chapter - 1];
	if (!verses) throw new Error("no such chapter");
	return verses;
}

function makePrisma({ failTransaction = false } = {}) {
	const state = { upserts: [], transactions: 0 };
	const prisma = {
		verseHighlight: {
			upsert: (args) => {
				state.upserts.push(args);
				return Promise.resolve(args.create);
			},
		},
		$transaction: async (operations) => {
			state.transactions += 1;
			if (failTransaction) throw new Error("transaction failed");
			return Promise.all(operations);
		},
	};
	return { prisma, state };
}

function load(prisma) {
	return loadModule(
		"../src/lib/highlights.server.ts",
		["highlightReference", "parseVerseRange", "expandVerseRange", "resolveHighlightColor", "MAX_HIGHLIGHT_VERSES"],
		{
			prisma,
			HIGHLIGHT_COLORS,
			getChapter,
			resolveReference,
			getKjvBookName: (order) => booksJson.find((entry) => entry.order === order)?.name,
		}
	);
}

test("one verse is marked yellow by default in the user's translation", async () => {
	const { prisma, state } = makePrisma();
	const { highlightReference } = load(prisma);
	const result = await highlightReference({ userId: "alice", reference: "Romans 8:28", translation: "NKJV" });
	assert.deepEqual(result, {
		success: true,
		reference: "Romans 8:28",
		book: "Romans",
		bookNumber: 45,
		chapter: 8,
		verse: 28,
		endChapter: 8,
		endVerse: 28,
		verseCount: 1,
		capped: false,
		color: "#F5D76E",
		colorName: "Yellow",
		translation: "NKJV",
	});
	assert.equal(state.transactions, 1);
	assert.deepEqual(state.upserts[0].where, {
		userId_translation_book_chapter_verse: { userId: "alice", translation: "NKJV", book: 45, chapter: 8, verse: 28 },
	});
	assert.deepEqual(state.upserts[0].update, { color: "#F5D76E" });
});

test("a range marks each verse, and a named colour resolves to its preset", async () => {
	const { prisma, state } = makePrisma();
	const { highlightReference } = load(prisma);
	const result = await highlightReference({
		userId: "alice",
		reference: "Psalm 23:1-3",
		color: "green",
		translation: "KJV",
	});
	assert.equal(result.reference, "Psalms 23:1-3");
	assert.equal(result.verseCount, 3);
	assert.equal(result.color, "#27AE60");
	assert.equal(result.colorName, "Green");
	assert.deepEqual(state.upserts.map((call) => call.create.verse), [1, 2, 3]);
});

test("a range longer than ten verses is capped at ten", async () => {
	const { prisma, state } = makePrisma();
	const { highlightReference, MAX_HIGHLIGHT_VERSES } = load(prisma);
	assert.equal(MAX_HIGHLIGHT_VERSES, 10);
	const result = await highlightReference({ userId: "alice", reference: "Romans 8:1-39", translation: "KJV" });
	assert.equal(result.capped, true);
	assert.equal(result.verseCount, 10);
	assert.equal(result.reference, "Romans 8:1-10");
	assert.equal(state.upserts.length, 10);
});

test("a range crossing a chapter walks into the next chapter", async () => {
	const { prisma, state } = makePrisma();
	const { highlightReference } = load(prisma);
	// John 3 has 36 verses.
	const result = await highlightReference({ userId: "alice", reference: "John 3:35-4:2", translation: "KJV" });
	assert.equal(result.reference, "John 3:35-4:2");
	assert.deepEqual(
		state.upserts.map((call) => `${call.create.chapter}:${call.create.verse}`),
		["3:35", "3:36", "4:1", "4:2"]
	);
});

test("an end past the last verse is clamped to the chapter", async () => {
	const { prisma } = makePrisma();
	const { highlightReference } = load(prisma);
	const result = await highlightReference({ userId: "alice", reference: "Romans 8:38-45", translation: "KJV" });
	assert.equal(result.reference, "Romans 8:38-39");
	assert.equal(result.verseCount, 2);
});

test("references that are not a verse fail with a message and write nothing", async () => {
	const { prisma, state } = makePrisma();
	const { highlightReference } = load(prisma);
	const attempt = (reference, color) =>
		highlightReference({ userId: "alice", reference, color, translation: "KJV" });

	await assert.rejects(attempt("Hezekiah 3:16"), /not a Bible reference/);
	await assert.rejects(attempt("Romans 8"), /names a whole chapter/);
	await assert.rejects(attempt("Romans 8:30-28"), /runs backwards/);
	await assert.rejects(attempt("Romans 8:40"), /only 39 verses/);
	await assert.rejects(attempt("Romans 17:1"), /not a Bible reference/);
	await assert.rejects(attempt("Romans 8:28", "chartreuse"), /not a highlight colour/);
	assert.equal(state.upserts.length, 0);
	assert.equal(state.transactions, 0);
});

test("colour resolution accepts preset names in any case and raw hex", () => {
	const { resolveHighlightColor } = load(makePrisma().prisma);
	assert.deepEqual(resolveHighlightColor(undefined), { hex: "#F5D76E", name: "Yellow" });
	assert.deepEqual(resolveHighlightColor("  "), { hex: "#F5D76E", name: "Yellow" });
	assert.deepEqual(resolveHighlightColor("BLUE"), { hex: "#4A90D9", name: "Blue" });
	assert.deepEqual(resolveHighlightColor("#e84c3d"), { hex: "#E84C3D", name: "Red" });
	assert.deepEqual(resolveHighlightColor("#123456"), { hex: "#123456", name: null });
});

test("a failed transaction surfaces instead of reporting success", async () => {
	const { prisma } = makePrisma({ failTransaction: true });
	const { highlightReference } = load(prisma);
	await assert.rejects(
		highlightReference({ userId: "alice", reference: "Romans 8:28", translation: "KJV" }),
		/transaction failed/
	);
});

test("the PUT route and the tool share one upsert", () => {
	const route = read("../src/app/api/highlights/route.ts");
	assert.match(route, /upsertUserHighlight\(userId, \{ translation, book, chapter, verse, color \}\)/);
	assert.doesNotMatch(route, /verseHighlight\.upsert/);
});
