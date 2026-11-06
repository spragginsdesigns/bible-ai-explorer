import { test } from "node:test";
import assert from "node:assert/strict";
import { citedReferences } from "../src/lib/share-cards/cited-references.ts";

test("keeps only the verse the answer quotes, not every retrieval hit", () => {
	const answer = "The waters roar at His word.\n\n**Psalm 93:4 (KJV)**\n> 4 The LORD on high is mightier than the noise of many waters.";
	const references = ["Habakkuk 3:10", "Psalms 65:6", "Psalms 29:3", "Psalms 93:4", "Psalms 46:3", "Genesis 1:6", "Joshua 3:13"];
	assert.deepEqual(citedReferences(answer, references), ["Psalms 93:4"]);
});

test("does not match inside a longer book name or verse number", () => {
	assert.deepEqual(citedReferences("See 1 John 3:1 and John 3:16.", ["John 3:1"]), []);
	assert.deepEqual(citedReferences("See John 3:16.", ["John 3:16"]), ["John 3:16"]);
	assert.deepEqual(citedReferences("Read John 3:1, then 3:2.", ["John 3:1"]), ["John 3:1"]);
});

test("matches regardless of case, spacing, and Psalm/Psalms", () => {
	assert.deepEqual(citedReferences("as PSALMS 23:1 says", ["Psalm 23:1"]), ["Psalm 23:1"]);
	assert.deepEqual(citedReferences("1  Corinthians 13:4", ["1 Corinthians 13:4"]), ["1 Corinthians 13:4"]);
});

test("shows nothing rather than an uncited verse", () => {
	assert.deepEqual(citedReferences("An answer with no reference.", ["Genesis 1:1"]), []);
	assert.deepEqual(citedReferences("", []), []);
});

test("keeps the stored order", () => {
	assert.deepEqual(citedReferences("Romans 8:28 and Genesis 50:20", ["Genesis 50:20", "Romans 8:28"]), ["Genesis 50:20", "Romans 8:28"]);
});
