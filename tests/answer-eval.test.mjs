import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
	extractBibleReferences,
	normalizeAnswerText,
	scoreAnswer,
	validateAnswerFixtures,
} from "../src/lib/ai/answer-eval.ts";
import { parseUiMessageStream } from "../scripts/eval-answers.mjs";

const fixtures = JSON.parse(readFileSync(new URL("../scripts/fixtures/answer-evals.json", import.meta.url), "utf8"));

const verse = (reference, text) => ({ reference, text });
const observation = (overrides = {}) => ({
	status: 200,
	text: "Scripture gives us a sure foundation. See Psalm 46:10, KJV.",
	translation: "KJV",
	toolCalls: [{ name: "searchScripture", output: { verses: [verse("Psalm 46:10", "Be still, and know that I am God.")] }, state: "output-available" }],
	...overrides,
});

test("the fixture set is unique and covers the answer evaluation categories", () => {
	assert.deepEqual(validateAnswerFixtures(fixtures), []);
	assert.ok(fixtures.length >= 40 && fixtures.length <= 50, `${fixtures.length} fixtures`);
	for (const category of ["reference", "phrase", "topic", "doctrine", "narrative", "translation", "memory", "errors", "injection", "history"]) {
		assert.ok(fixtures.some((fixture) => fixture.category === category), `missing ${category}`);
	}
});

test("normalization removes display noise but preserves substantive quote words", () => {
	assert.equal(normalizeAnswerText("  “Be still,”\n and know—"), '"be still," and know-');
	assert.deepEqual(extractBibleReferences("See Psalm 46:10, KJV and John 3:16 NKJV."), ["Psalm 46:10, KJV", "John 3:16 NKJV"]);
});

test("a correct exact quote requires both answer text and successful tool evidence", () => {
	const fixture = {
		id: "quote",
		category: "reference",
		prompt: "Quote Psalm 46:10.",
		expectation: {
			translation: "KJV",
			retrievalToolAlternatives: [["getPassage"], ["findVerses"]],
			requiredReferences: ["Psalm 46:10"],
			requiredQuotes: [{
				reference: "Psalm 46:10",
				text: "Be still, and know that I am God.",
				translation: "KJV",
			}],
		},
	};
	const result = scoreAnswer(fixture, observation({
		text: '“Be still, and know that I am God.”\n— Psalm 46:10, KJV',
		toolCalls: [{ name: "getPassage", output: { verses: [verse("Psalm 46:10", "Be still, and know that I am God.")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, true);
});

test("a wrong answer quote fails even when the source tool returned the right verse", () => {
	const fixture = {
		id: "wrong-quote",
		category: "reference",
		prompt: "Quote Psalm 46:10.",
		expectation: {
			translation: "KJV",
			retrievalToolAlternatives: [["getPassage"]],
			requiredReferences: ["Psalm 46:10"],
			requiredQuotes: [{ reference: "Psalm 46:10", text: "Be still, and know that I am God.", translation: "KJV" }],
		},
	};
	const result = scoreAnswer(fixture, observation({
		text: '“God is our refuge and strength.” — Psalm 46:10, KJV',
		toolCalls: [{ name: "getPassage", output: { verses: [verse("Psalm 46:10", "Be still, and know that I am God.")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.quotes, false);
});

test("missing or malformed tool output cannot satisfy a quotation", () => {
	const fixture = {
		id: "malformed-tool",
		category: "reference",
		prompt: "Quote Psalm 46:10.",
		expectation: {
			translation: "KJV",
			retrievalToolAlternatives: [["getPassage"]],
			requiredReferences: ["Psalm 46:10"],
			requiredQuotes: [{ reference: "Psalm 46:10", text: "Be still, and know that I am God.", translation: "KJV" }],
		},
	};
	const result = scoreAnswer(fixture, observation({
		text: '“Be still, and know that I am God.” — Psalm 46:10, KJV',
		toolCalls: [{ name: "getPassage", output: { formatted: "Psalm 46:10 KJV" }, state: "output-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.quotes, false);
});

test("getPassage and findVerses are interchangeable successful retrieval paths", () => {
	const fixture = {
		id: "alternative",
		category: "phrase",
		prompt: "Find be still and know.",
		expectation: {
			retrievalToolAlternatives: [["getPassage"], ["findVerses"], ["searchScripture"]],
			requiredReferences: ["Psalm 46:10"],
		},
	};
	const result = scoreAnswer(fixture, observation({
		toolCalls: [{ name: "findVerses", output: { verses: [verse("Psalm 46:10", "Be still, and know that I am God.")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, true);
});

test("a tool call without an output is not evidence and does not pass tool requirements", () => {
	const fixture = {
		id: "missing-tool-result",
		category: "topic",
		prompt: "What does Scripture say about grace?",
		expectation: { retrievalToolAlternatives: [["searchScripture"]], requiredReferences: ["Ephesians 2:8-9"] },
	};
	const result = scoreAnswer(fixture, observation({
		text: "Grace matters. See Ephesians 2:8-9, KJV.",
		toolCalls: [{ name: "searchScripture", state: "input-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.toolUse, false);
	assert.equal(result.checks.toolSuccess, false);
});

test("explicit unsuccessful tool payloads cannot be treated as evidence", () => {
	const fixture = {
		id: "failed-tool-payload",
		category: "reference",
		prompt: "Quote Psalm 46:10.",
		expectation: { retrievalToolAlternatives: [["getPassage"]], requiredReferences: ["Psalm 46:10"] },
	};
	const result = scoreAnswer(fixture, observation({
		text: "Psalm 46:10, KJV.",
		toolCalls: [{ name: "getPassage", output: { success: false, error: "not found" }, state: "output-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.toolSuccess, false);
	assert.match(result.failures.join(" | "), /did not succeed/);
});

test("all citations backed by tools catches fabricated references", () => {
	const fixture = {
		id: "fabricated",
		category: "doctrine",
		prompt: "Explain grace.",
		expectation: {
			retrievalToolAlternatives: [["searchScripture"]],
			allCitationsBackedByTools: true,
		},
	};
	const result = scoreAnswer(fixture, observation({
		text: "Grace is given freely. See Ephesians 2:8-9 and Romans 8:28, KJV.",
		toolCalls: [{ name: "searchScripture", output: { verses: [verse("Ephesians 2:8-9", "For by grace ye are saved through faith; and that not of yourselves: it is the gift of God: Not of works, lest any man should boast.")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.noFabricatedReferences, false);
});

test("wrong translation is a mechanical failure", () => {
	const fixture = {
		id: "translation",
		category: "translation",
		prompt: "Explain John 3:16 in NKJV.",
		translation: "NKJV",
		expectation: { translation: "NKJV", retrievalToolAlternatives: [["getPassage"]], requiredReferences: ["John 3:16"] },
	};
	const result = scoreAnswer(fixture, observation({ text: "John 3:16, KJV says this.", translation: "KJV", toolCalls: [{ name: "getPassage", output: { verses: [verse("John 3:16", "For God so loved the world")] }, state: "output-available" }] }));
	assert.equal(result.pass, false);
	assert.equal(result.checks.translation, false);
});

test("a perverse translation marker in tool output fails even when the request metadata says otherwise", () => {
	const fixture = {
		id: "source-translation",
		category: "translation",
		prompt: "Explain John 3:16 in NKJV.",
		translation: "NKJV",
		expectation: { translation: "NKJV", retrievalToolAlternatives: [["getPassage"]], requiredReferences: ["John 3:16"] },
	};
	const result = scoreAnswer(fixture, observation({
		translation: "NKJV",
		text: "John 3:16, NKJV.",
		toolCalls: [{ name: "getPassage", output: { translation: "KJV", formatted: "John 3:16 KJV: \"wrong source\"", verses: [verse("John 3:16", "wrong source")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.translation, false);
});

test("an extra misquoted blockquote fails even when a correct source is also present", () => {
	const fixture = {
		id: "extra-quote",
		category: "reference",
		prompt: "Explain Psalm 46:10.",
		expectation: { retrievalToolAlternatives: [["getPassage"]], allCitationsBackedByTools: true },
	};
	const result = scoreAnswer(fixture, observation({
		text: "> God helps those who help themselves.\n> — Psalm 46:10, KJV",
		toolCalls: [{ name: "getPassage", output: { verses: [verse("Psalm 46:10", "Be still, and know that I am God.")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, false);
	assert.equal(result.checks.quotes, false);
});

test("citation coverage accepts a source range that contains a cited verse", () => {
	const fixture = {
		id: "range",
		category: "reference",
		prompt: "Read the passage.",
		expectation: { retrievalToolAlternatives: [["getPassage"]], requiredReferences: ["John 3:16"], allCitationsBackedByTools: true },
	};
	const result = scoreAnswer(fixture, observation({
		text: "John 3:16 is central.",
		toolCalls: [{ name: "getPassage", output: { verses: [verse("John 3:16-17", "For God so loved the world.")] }, state: "output-available" }],
	}));
	assert.equal(result.pass, true);
});

test("memory off forbids memory tools, while recall requires a successful list", () => {
	const off = {
		id: "memory-off",
		category: "memory",
		prompt: "Answer from Scripture.",
		expectation: { memory: { mode: "off" } },
	};
	assert.equal(scoreAnswer(off, observation({ toolCalls: [{ name: "listMemories", output: { memories: [] }, state: "output-available" }] })).pass, false);

	const recall = {
		id: "memory-recall",
		category: "memory",
		prompt: "What do you remember?",
		expectation: { memory: { mode: "recall", requiredTools: ["listMemories"], requiredText: ["Tuesday"] } },
	};
	const result = scoreAnswer(recall, observation({ text: "You study on Tuesday.", toolCalls: [{ name: "listMemories", output: { memories: [{ content: "Studies on Tuesday" }] }, state: "output-available" }] }));
	assert.equal(result.pass, true);
});

test("expected route errors are scored separately from successful answers", () => {
	const fixture = { id: "bad-request", category: "errors", prompt: "", requestMessages: [], expectation: { expectedErrorStatus: 400, expectedErrorContains: "messages" } };
	assert.equal(scoreAnswer(fixture, { status: 400, text: "", routeError: "Invalid input: messages must be a non-empty array.", translation: "KJV", toolCalls: [] }).pass, true);
	assert.equal(scoreAnswer(fixture, { status: 200, text: "I can help.", translation: "KJV", toolCalls: [] }).pass, false);
});

test("scores retain route timing, usage, and tool-count metrics", () => {
	const result = scoreAnswer({ id: "metrics", category: "topic", prompt: "Explain grace.", expectation: {} }, observation({ durationMs: 321, usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 }, toolCalls: [{ name: "searchScripture", output: { verses: [] }, state: "output-available" }] }));
	assert.deepEqual(result.metrics, { durationMs: 321, inputTokens: 12, outputTokens: 34, totalTokens: 46, toolCalls: 1, successfulToolCalls: 1 });
});

test("SSE parser counts one step per id and rejects a truncated stream", () => {
	const complete = parseUiMessageStream([
		'data: {"type":"start-step","stepId":"s1"}',
		'data: {"type":"text-delta","delta":"Answer"}',
		'data: {"type":"finish-step","stepId":"s1"}',
		'data: {"type":"finish"}',
		"data: [DONE]",
		"",
	].join("\n"));
	assert.equal(complete.complete, true);
	assert.equal(complete.steps, 1);
	assert.equal(complete.text, "Answer");

	const truncated = parseUiMessageStream('data: {"type":"text-delta","delta":"partial"}\n');
	assert.equal(truncated.complete, false);
});

test("SSE parser preserves structured error text", () => {
	const parsed = parseUiMessageStream('data: {"type":"error","errorText":"provider rejected the request"}\n');
	assert.equal(parsed.routeError, "provider rejected the request");
});
