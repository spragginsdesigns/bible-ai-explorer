/**
 * Verse selection rules for the reader's verse sheet (web/Android parity).
 *
 * Tapping more verses while the sheet is open grows a contiguous range. The
 * rules live in a pure module that exists twice, once per client tree, and
 * the two copies must stay byte-for-byte identical apart from the one
 * doc-comment line that names the other copy; this test pins that and the
 * behaviour the sheets rely on.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	MAX_SELECTED_VERSES,
	selectionColor,
	selectionReference,
	selectionShareText,
	selectionText,
	toggleVerse,
} from "../src/lib/bible/verseSelection.ts";

const read = (relative) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("the web and Android selection modules are the same code", () => {
	const strip = (source) =>
		source
			.split("\n")
			.filter((line) => !line.includes("copy lives in"))
			.join("\n");
	assert.equal(
		strip(read("../src/lib/bible/verseSelection.ts")),
		strip(read("../mobile/src/features/bible/verseSelection.ts"))
	);
});

test("tapping grows, re-anchors, clears and caps the range", () => {
	assert.deepEqual(toggleVerse(null, 4), { start: 4, end: 4 });
	assert.equal(toggleVerse({ start: 4, end: 4 }, 4), null);
	assert.deepEqual(toggleVerse({ start: 4, end: 4 }, 7), { start: 4, end: 7 });
	assert.deepEqual(toggleVerse({ start: 4, end: 7 }, 5), { start: 5, end: 5 });
	const full = { start: 1, end: MAX_SELECTED_VERSES };
	assert.equal(toggleVerse(full, MAX_SELECTED_VERSES + 1), full);
});

test("references, text and share payloads carry the range", () => {
	assert.equal(selectionReference("Genesis", 1, { start: 1, end: 3 }), "Genesis 1:1-3");
	assert.equal(selectionReference("Genesis", 1, { start: 2, end: 2 }), "Genesis 1:2");
	assert.equal(selectionText(["a", "b", "c"], { start: 1, end: 2 }), "1 a 2 b");
	assert.equal(selectionText(["a", "b", "c"], { start: 3, end: 3 }), "c");
	assert.equal(
		selectionShareText("Genesis 1:1-2", "1 a 2 b", "KJV"),
		'Genesis 1:1-2 — "1 a 2 b" (KJV)'
	);
});

test("a shared highlight color needs every verse to carry it", () => {
	const highlights = new Map([
		[1, "#F5D76E"],
		[2, "#F5D76E"],
	]);
	assert.equal(selectionColor(highlights, { start: 1, end: 2 }), "#F5D76E");
	assert.equal(selectionColor(highlights, { start: 1, end: 3 }), undefined);
});
