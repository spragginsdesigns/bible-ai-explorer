/**
 * Answers in Spanish and German (docs/languages/PLAN.md, "Implementation
 * contract"): the chat prompt gains a reply-language block only for those
 * languages, so an English answer's prompt is byte-for-byte what it was.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	chatSystemPrompt,
	languageGuidance,
	verseInsightSystemPrompt,
} from "../src/utils/systemPrompt.ts";

test("English answers get no language block, so their prompt is unchanged", () => {
	assert.equal(languageGuidance("en", "KJV"), null);
	assert.equal(chatSystemPrompt("KJV", {}, "en"), chatSystemPrompt("KJV"));
	assert.doesNotMatch(chatSystemPrompt("BSB"), /REPLY LANGUAGE/);
});

test("a Spanish answer is written in Spanish and quotes only the Reina-Valera text", () => {
	const block = languageGuidance("es", "RV1909");
	assert.ok(block);
	assert.match(block, /REPLY LANGUAGE FOR THIS TURN: Spanish/);
	assert.match(block, /Reina-Valera 1909 \(RV1909\)/);
	assert.match(block, /Never translate a verse yourself/);
	assert.match(block, /Juan 3:16/);
	assert.match(block, /King James Version remains SureWord's doctrinal foundation/);
	assert.ok(chatSystemPrompt("RV1909", {}, "es").includes(block));
});

test("a German answer is written in German and quotes only the Luther text", () => {
	const block = languageGuidance("de", "LUT1912");
	assert.ok(block);
	assert.match(block, /REPLY LANGUAGE FOR THIS TURN: German/);
	assert.match(block, /Lutherbibel 1912 \(LUT1912\)/);
	assert.match(block, /Johannes 3:16/);
});

test("a verse explanation follows the language of the Bible being read", () => {
	assert.doesNotMatch(verseInsightSystemPrompt("KJV"), /Write the explanation in/);
	assert.match(verseInsightSystemPrompt("RV1909"), /Write the explanation in Spanish \(Español\)\./);
	assert.match(verseInsightSystemPrompt("LUT1912"), /Write the explanation in German \(Deutsch\)\./);
});
