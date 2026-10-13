import assert from "node:assert/strict";
import test from "node:test";

import { verseTextHash, verseInsightCacheHash, VERSE_INSIGHT_PROMPT_VERSION } from "../src/lib/verse-insight-key.ts";

test("the verse hash ignores whitespace differences between clients", () => {
	const a = verseTextHash("There was in the days of Herod, the king of Judaea,");
	const b = verseTextHash("  There was in the\n days of Herod,   the king of Judaea, ");
	assert.equal(a, b);
	assert.match(a, /^[0-9a-f]{32}$/);
});

test("altered verse text under the same reference never shares a key", () => {
	const real = verseTextHash("For God so loved the world, that he gave his only begotten Son");
	const forged = verseTextHash("For God so loved the world, that he gave his only Son");
	assert.notEqual(real, forged);
});

test("the prompt version is a positive integer callers can bump", () => {
	assert.ok(Number.isInteger(VERSE_INSIGHT_PROMPT_VERSION) && VERSE_INSIGHT_PROMPT_VERSION >= 1);
});

test("the shared insight key separates actual model and effort while ignoring soft wraps",()=>{
	const key=verseInsightCacheHash("openai/model-a","low","For God so loved\n the world");
	assert.equal(key,verseInsightCacheHash("openai/model-a","low","For God so loved the world"));
	assert.notEqual(key,verseInsightCacheHash("openai/model-b","low","For God so loved the world"));
	assert.notEqual(key,verseInsightCacheHash("openai/model-a","medium","For God so loved the world"));
});
