import assert from "node:assert/strict";
import test from "node:test";

import { buildChatStepMetric } from "../src/lib/ai/chat-metrics.ts";

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
