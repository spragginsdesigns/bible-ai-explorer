import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import {
	matchChapterNotes,
	notesForSelection,
	versesWithNotes,
} from "../src/lib/bible/chapterNotes.ts";

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

const webMarkup = loadModule("../src/lib/bible/verseMarkup.ts", ["bibleVersePlainText"]);
const { formatVerseNoteMarkdown } = loadModule(
	"../src/lib/bible/verseActions.ts",
	["formatVerseNoteMarkdown"],
	{ bibleVersePlainText: webMarkup.bibleVersePlainText }
);

test("web and Android chapterNotes modules stay byte-for-byte identical", () => {
	assert.equal(
		read("../src/lib/bible/chapterNotes.ts"),
		read("../mobile/src/features/bible/chapterNotes.ts"),
		"src/lib/bible/chapterNotes.ts and mobile/src/features/bible/chapterNotes.ts must match"
	);
});

test("matchChapterNotes links single verses, abbreviations, ranges, and chapter-level titles", () => {
	const notes = [
		{
			id: "n-1",
			title: "John 3:16",
			plainText: 'John 3:16 — "For God so loved the world" (KJV)\nGod\'s love is sacrificial.',
			updatedAt: "2026-10-14T10:00:00.000Z",
		},
		{
			id: "n-2",
			title: "New Birth Study",
			plainText: "Compare Jn. 3:3-5 with Titus 3:5 on regeneration.",
			updatedAt: "2026-10-14T12:00:00.000Z",
		},
		{
			id: "n-3",
			title: "John 3 Overview",
			plainText: "Nicodemus comes by night.",
			updatedAt: "2026-10-14T08:00:00.000Z",
		},
		{
			id: "n-4",
			title: "1 John 3:16",
			plainText: "1 John 3:16 — Hereby perceive we the love of God.",
			updatedAt: "2026-10-14T14:00:00.000Z",
		},
	];

	const matches = matchChapterNotes(notes, {
		bookName: "John",
		bookAbbr: "John",
		chapter: 3,
		verseCount: 36,
	});

	// 1 John 3:16 must NOT match Gospel of John chapter 3
	assert.deepEqual(
		matches.map((m) => m.id),
		["n-2", "n-1", "n-3"]
	);

	const n2 = matches.find((m) => m.id === "n-2");
	assert.deepEqual(n2.verses, [3, 4, 5]);
	assert.equal(n2.chapterLevel, false);

	const n1 = matches.find((m) => m.id === "n-1");
	assert.deepEqual(n1.verses, [16]);

	const n3 = matches.find((m) => m.id === "n-3");
	assert.deepEqual(n3.verses, []);
	assert.equal(n3.chapterLevel, true);

	assert.deepEqual([...versesWithNotes(matches)].sort((a, b) => a - b), [3, 4, 5, 16]);

	// Selection on verse 16 returns n-1 (verse match) then n-3 (chapter match)
	assert.deepEqual(
		notesForSelection(matches, { start: 16, end: 16 }).map((m) => m.id),
		["n-1", "n-3"]
	);
});

test("matchChapterNotes matches numbered books without false positives", () => {
	const notes = [
		{
			id: "epistle",
			title: "Assurance",
			plainText: "See 1Jn 3:16 and 1 John 3:18.",
			updatedAt: "2026-10-14T12:00:00.000Z",
		},
		{
			id: "gospel",
			title: "Gospel",
			plainText: "John 3:16",
			updatedAt: "2026-10-14T11:00:00.000Z",
		},
	];

	const matches = matchChapterNotes(notes, {
		bookName: "1 John",
		bookAbbr: "1 John",
		chapter: 3,
		verseCount: 24,
	});

	assert.equal(matches.length, 1);
	assert.equal(matches[0].id, "epistle");
	assert.deepEqual(matches[0].verses, [16, 18]);
});

test("formatVerseNoteMarkdown formats clean Scripture blockquote and strips markup", () => {
	const md = formatVerseNoteMarkdown(
		{ reference: "Job 1:8", text: "a <i>blameless and</i> upright man" },
		"NKJV"
	);
	assert.equal(
		md,
		[
			"> **Job 1:8**",
			">",
			"> a blameless and upright man",
			">",
			"> (NKJV)",
		].join("\n")
	);
});

test("Android and web parseLastRead both accept KJV, NKJV, and BSB", () => {
	const webBookPicker = read("../src/components/bible/BibleBookPicker.tsx");
	const androidBookPicker = read("../mobile/app/(app)/bible/index.tsx");
	assert.match(webBookPicker, /candidate\.translation !== "BSB"/);
	assert.match(androidBookPicker, /candidate\.translation !== "BSB"/);
});
