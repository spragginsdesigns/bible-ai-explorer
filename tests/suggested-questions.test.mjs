import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	buildSuggestedQuestionItems,
	parseReferenceLabel,
	parseSuggestedQuestions,
	parseSuggestedQuestionsResponse,
	questionReference,
} from "../src/utils/questionPresentation.ts";

const EN_DASH = "\u2013";

test("a reference is normalized to one display form", () => {
	assert.equal(parseReferenceLabel("james 3:5-6"), `James 3:5${EN_DASH}6`);
	assert.equal(parseReferenceLabel("1samuel 3"), "1 Samuel 3");
	assert.equal(parseReferenceLabel("song of solomon 2:1"), "Song of Solomon 2:1");
	assert.equal(parseReferenceLabel("Genesis 1-2"), `Genesis 1${EN_DASH}2`);
});

test("a label that is not a whole reference is rejected", () => {
	assert.equal(parseReferenceLabel("APPLY"), null);
	assert.equal(parseReferenceLabel("What Genesis 1 teaches"), null);
	assert.equal(parseReferenceLabel("Hezekiah 4:2"), null);
});

test("the question's own reference is only a fallback for a missing label", () => {
	const items = buildSuggestedQuestionItems([
		{ question: "What does James 3 say about the tongue?", label: "MEMORY" },
		{ question: "What does Acts 9:17-19 show about Ananias?", label: null },
		"What can I learn from Genesis 32?",
		{ question: "How should I pray at work?" },
	]);

	assert.deepEqual(
		items.map((item) => item.label),
		["MEMORY", `ACTS 9:17${EN_DASH}19`, "GENESIS 32", null]
	);
	assert.equal(questionReference("How should I explain being born again?"), null);
});

test("both the labelled shape and an older deploy's bare strings parse", () => {
	assert.deepEqual(
		parseSuggestedQuestions([
			{ question: "What does James 3 say about the tongue?", label: "James 3:5" },
			"What can I learn from Genesis 32?",
			{ question: "", label: "APPLY" },
			null,
		]),
		[
			{ question: "What does James 3 say about the tongue?", label: "James 3:5" },
			{ question: "What can I learn from Genesis 32?", label: null },
		]
	);
	assert.deepEqual(parseSuggestedQuestions("nope"), []);
});

// The wire shape carries both keys: `questions` is what Android 1.26 and the
// shipped macOS DMG read (and they drop anything that is not a string), so it
// must stay a plain array; `items` is where the labels live.
test("the response's labelled items win, with the plain array as the fallback", () => {
	assert.deepEqual(
		parseSuggestedQuestionsResponse({
			questions: ["What does James 3 say about the tongue?"],
			items: [{ question: "What does James 3 say about the tongue?", label: "James 3:5" }],
			personalized: true,
		}),
		[{ question: "What does James 3 say about the tongue?", label: "James 3:5" }]
	);

	assert.deepEqual(
		parseSuggestedQuestionsResponse({
			questions: ["What can I learn from Genesis 32?"],
			personalized: true,
		}),
		[{ question: "What can I learn from Genesis 32?", label: null }]
	);

	assert.deepEqual(parseSuggestedQuestionsResponse({ questions: [], items: [] }), []);
	assert.deepEqual(parseSuggestedQuestionsResponse(null), []);
});

// mobile/ is outside the pnpm workspace, so its copy of this module is a real
// duplicate. Only the opening comment (which names the other copy) may differ -
// a label rendered differently on the two clients is exactly the drift this
// feature cannot afford.
test("the web and mobile copies of questionPresentation stay in step", () => {
	const body = (path) => readFileSync(new URL(path, import.meta.url), "utf8").split("*/\n")[1];
	assert.equal(
		body("../src/utils/questionPresentation.ts"),
		body("../mobile/src/features/chat/questionPresentation.ts")
	);
});
