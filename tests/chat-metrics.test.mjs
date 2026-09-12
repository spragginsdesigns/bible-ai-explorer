import assert from "node:assert/strict";
import test from "node:test";

import {
	buildChatOutcomeMetric,
	buildChatStepMetric,
	conversationAgeBucket,
	errorClassName,
} from "../src/lib/ai/chat-metrics.ts";

const context = {
	surface: "ask-question",
	provider: "openai",
	modelId: "gpt-5.6-luna",
	translation: "KJV",
	toolCount: 23,
	memoryCount: 4,
	historyMessages: 6,
	historyTruncated: true,
	maxHistoryMessages: 24,
	stepLimit: 8,
	stableSystemChars: 27521,
	volatileSystemChars: 412,
};

test("step metrics retain only numeric and context-shape fields", () => {
	const metric = buildChatStepMetric(context, {
		stepNumber: 1,
		finishReason: "tool-calls",
		usage: {
			inputTokens: 1200,
			outputTokens: 180,
			totalTokens: 1380,
			inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 0 },
		},
		performance: {
			timeToFirstOutputMs: 420,
			outputTokensPerSecond: 32,
			stepTimeMs: 2100,
			responseTimeMs: 1800,
		},
		toolCalls: [{ toolName: "searchScripture", input: "private text" }],
	});

	assert.equal(metric.cacheReadTokens, 900);
	assert.equal(metric.cacheWriteTokens, 0);
	assert.equal(metric.timeToFirstOutputMs, 420);
	assert.equal(metric.toolCalls, 1);
	assert.equal(metric.stepLimitReached, false);
	assert.equal("input" in metric, false);
	assert.equal("userId" in metric, false);
	assert.equal("prompt" in metric, false);
});

test("step limit reached is derived from zero-based SDK step numbers", () => {
	const metric = buildChatStepMetric(context, {
		stepNumber: 7,
		finishReason: "tool-calls",
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {} },
		performance: {},
		toolCalls: [{ toolName: "searchScripture" }],
	});

	assert.equal(metric.stepLimitReached, true);
});

test("missing or non-finite provider metrics become null", () => {
	const metric = buildChatStepMetric(context, {
		stepNumber: 0,
		finishReason: "stop",
		usage: {
			inputTokens: undefined,
			outputTokens: Number.NaN,
			totalTokens: undefined,
			inputTokenDetails: { cacheReadTokens: undefined, cacheWriteTokens: undefined },
		},
		performance: {
			timeToFirstOutputMs: undefined,
			outputTokensPerSecond: Number.POSITIVE_INFINITY,
			stepTimeMs: undefined,
			responseTimeMs: undefined,
		},
	});

	assert.equal(metric.outputTokens, null);
	assert.equal(metric.outputTokensPerSecond, null);
	assert.equal(metric.cacheReadTokens, null);
});

const outcomeEvent = {
	surface: "ask-question",
	provider: "openai",
	modelId: "gpt-5.6-luna",
	conversationCreatedAt: new Date("2026-09-12T10:00:00Z"),
	stepCount: 2,
	finishReason: "stop",
	error: null,
	exit: "persisted",
	answerHasText: true,
};
const outcomeNow = new Date("2026-09-12T10:00:30Z");
const OUTCOME_KEYS = [
	"answerHasText",
	"conversationAge",
	"errorClass",
	"exit",
	"finishReason",
	"metric",
	"modelId",
	"outcome",
	"provider",
	"stepCount",
	"surface",
].sort();

test("outcome metric is answered only when the assistant row persisted", () => {
	assert.equal(buildChatOutcomeMetric(outcomeEvent, outcomeNow).outcome, "answered");
	for (const exit of ["aborted", "empty_response", "conversation_missing", "persist_error"]) {
		const metric = buildChatOutcomeMetric({ ...outcomeEvent, exit }, outcomeNow);
		assert.equal(metric.outcome, "unanswered", exit);
		assert.equal(metric.exit, exit);
	}
});

test("outcome metric carries a fixed shape with no user id, content, or error message", () => {
	const secret = "user_3Hk7fPXucIYEZzeWsSpvpUwgoJx asked about Psalm 23";
	const error = new Error(secret);
	error.name = "AI_APICallError";
	const event = {
		...outcomeEvent,
		exit: "empty_response",
		error,
		// Extra keys a caller might spread in by mistake must not leak through.
		userId: "user_3Hk7fPXucIYEZzeWsSpvpUwgoJx",
		conversationId: "conv_123",
		content: secret,
		responseMessage: { parts: [{ type: "text", text: secret }] },
	};
	const metric = buildChatOutcomeMetric(event, outcomeNow);

	assert.deepEqual(Object.keys(metric).sort(), OUTCOME_KEYS);
	assert.equal(metric.errorClass, "AI_APICallError");
	const serialized = JSON.stringify(metric);
	assert.equal(serialized.includes("user_"), false);
	assert.equal(serialized.includes("conv_123"), false);
	assert.equal(serialized.includes("Psalm"), false);
	assert.equal(serialized.includes("2026-09-12"), false);
});

test("error class keeps identifier names and collapses anything else", () => {
	assert.equal(errorClassName(null), null);
	assert.equal(errorClassName(undefined), null);
	assert.equal(errorClassName("boom"), "NonError");
	assert.equal(errorClassName({ message: "private" }), "NonError");
	assert.equal(errorClassName(new TypeError("private")), "TypeError");
	class PrismaClientKnownRequestError extends Error {}
	assert.equal(errorClassName(new PrismaClientKnownRequestError("private")), "PrismaClientKnownRequestError");
	const spoofed = new Error("private");
	spoofed.name = "question: what does Psalm 23 mean?";
	assert.equal(errorClassName(spoofed), "Error");
});

test("conversation age is bucketed, never a timestamp", () => {
	const created = new Date("2026-09-12T00:00:00Z");
	const at = (ms) => new Date(created.getTime() + ms);
	assert.equal(conversationAgeBucket(null), "unknown");
	assert.equal(conversationAgeBucket(new Date("invalid")), "unknown");
	assert.equal(conversationAgeBucket(created, at(-5_000)), "under_1m");
	assert.equal(conversationAgeBucket(created, at(59_999)), "under_1m");
	assert.equal(conversationAgeBucket(created, at(60_000)), "under_1h");
	assert.equal(conversationAgeBucket(created, at(3_600_000)), "under_1d");
	assert.equal(conversationAgeBucket(created, at(86_400_000)), "under_7d");
	assert.equal(conversationAgeBucket(created, at(7 * 86_400_000)), "7d_plus");
});

test("outcome metric normalizes missing finish reason and odd step counts", () => {
	const metric = buildChatOutcomeMetric(
		{ ...outcomeEvent, provider: null, modelId: null, finishReason: undefined, stepCount: Number.NaN },
		outcomeNow,
	);
	assert.equal(metric.finishReason, null);
	assert.equal(metric.stepCount, 0);
	assert.equal(metric.provider, null);
	assert.equal(metric.conversationAge, "under_1m");
});
