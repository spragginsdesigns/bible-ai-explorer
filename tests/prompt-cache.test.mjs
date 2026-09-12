import assert from "node:assert/strict";
import test from "node:test";

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { buildPromptCachePlan, splitStableSystemPrefix } from "../src/lib/ai/prompt-cache.ts";
import { appKnowledge, noteAISystemPrompt, systemPrompt } from "../src/utils/systemPrompt.ts";

const baseOptions = {
	stableSystem: "stable instructions",
	volatileSystem: "\n\nuser context",
	providerOptions: {},
	cacheKey: "sureword:test:v1",
};

test("OpenAI GPT-5.6 uses an explicit breakpoint after the stable system block", () => {
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "openai",
		modelId: "gpt-5.6-luna",
	});

	assert.equal(plan.mode, "explicit");
	assert.equal(Array.isArray(plan.system), true);
	assert.equal(plan.system.length, 2);
	assert.deepEqual(plan.system[0].providerOptions, {
		openai: { promptCacheBreakpoint: { mode: "explicit" } },
	});
	assert.equal(plan.system[1].content, "\n\nuser context");
	// Explicit request mode would drop OpenAI's implicit end-of-prompt
	// breakpoint, so history and tool steps must keep automatic caching.
	assert.equal(plan.providerOptions.openai.promptCacheOptions, undefined);
	assert.equal(plan.providerOptions.openai.promptCacheKey, "sureword:test:v1");
});

test("Anthropic marks the stable system message and leaves volatile context after it", () => {
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "anthropic",
		modelId: "claude-sonnet-5",
	});

	assert.equal(plan.mode, "explicit");
	assert.equal(Array.isArray(plan.system), true);
	assert.deepEqual(plan.system[0].providerOptions, {
		anthropic: { cacheControl: { type: "ephemeral" } },
	});
	assert.equal(plan.system[0].content, "stable instructions");
	assert.equal(plan.system[1].content, "\n\nuser context");
});

test("providers without an explicit boundary keep the original concatenated system text", () => {
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "moonshot",
		modelId: "kimi-k3",
	});

	assert.equal(plan.mode, "none");
	assert.equal(plan.system, "stable instructions\n\nuser context");
});

test("OpenAI models before GPT-5.6 stay on the compatible path", () => {
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "openai",
		modelId: "gpt-5.5",
	});

	assert.equal(plan.mode, "automatic");
	assert.equal(typeof plan.system, "string");
});

test("GPT-6 models use the same explicit cache boundary contract", () => {
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "openai",
		modelId: "gpt-6-astra",
	});

	assert.equal(plan.mode, "explicit");
	assert.deepEqual(plan.system[0].providerOptions.openai.promptCacheBreakpoint, {
		mode: "explicit",
	});
});

test("splitting a stable prefix preserves the full prompt text", () => {
	const full = "stable instructions\n\nnote title and content";
	const split = splitStableSystemPrefix(full, "stable instructions");

	assert.equal(split.stableSystem + split.volatileSystem, full);
});

test("an empty stable prefix falls back without emitting an empty provider message", () => {
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "anthropic",
		modelId: "claude-sonnet-5",
		stableSystem: "",
	});

	assert.equal(typeof plan.system, "string");
	assert.equal(plan.system, "\n\nuser context");
});

test("note AI prompt text is unchanged on the compatible provider path", () => {
	const fullSystem = noteAISystemPrompt("A note", "A private note body", "Links: one related note");
	const { stableSystem, volatileSystem } = splitStableSystemPrefix(
		fullSystem,
		`${systemPrompt}\n\n${appKnowledge}`,
	);
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "moonshot",
		modelId: "kimi-k3",
		stableSystem,
		volatileSystem,
	});

	assert.equal(plan.system, fullSystem);
});

test("installed OpenAI Responses adapter serializes the breakpoint inside input content", async () => {
	let body;
	const openai = createOpenAI({
		apiKey: "test-key",
		fetch: async (_input, init) => {
			body = JSON.parse(init.body);
			return new Response(JSON.stringify({
				id: "resp_test",
				created_at: 0,
				model: "gpt-6-astra",
				output: [{
					type: "message",
					role: "assistant",
					id: "msg_test",
					content: [{ type: "output_text", text: "ok", annotations: [] }],
				}],
				usage: {
					input_tokens: 10,
					input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
					output_tokens: 1,
					output_tokens_details: { reasoning_tokens: 0 },
				},
			}), { status: 200, headers: { "content-type": "application/json" } });
		},
	});
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "openai",
		modelId: "gpt-6-astra",
		providerOptions: { openai: { reasoningEffort: "low" } },
	});

	await generateText({ model: openai("gpt-6-astra"), system: plan.system, prompt: "question", providerOptions: plan.providerOptions });
	assert.deepEqual(body.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
	assert.equal(body.input[0].content[0].text, "stable instructions");
	// The system breakpoint is explicit, but the request keeps OpenAI's default
	// mode so the implicit end-of-prompt breakpoint still caches history.
	assert.equal(body.prompt_cache_options, undefined);
	assert.equal(body.reasoning.effort, "low");
});

test("installed Anthropic adapter serializes cache_control on the stable system block", async () => {
	let body;
	const anthropic = createAnthropic({
		apiKey: "test-key",
		fetch: async (_input, init) => {
			body = JSON.parse(init.body);
			return new Response(JSON.stringify({
				id: "msg_test",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-5",
				content: [{ type: "text", text: "ok" }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 10, output_tokens: 1 },
			}), { status: 200, headers: { "content-type": "application/json" } });
		},
	});
	const plan = buildPromptCachePlan({
		...baseOptions,
		provider: "anthropic",
		modelId: "claude-sonnet-5",
		providerOptions: { anthropic: { effort: "low" } },
	});

	await generateText({ model: anthropic("claude-sonnet-5"), system: plan.system, prompt: "question", providerOptions: plan.providerOptions });
	assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
	assert.equal(body.system[0].text, "stable instructions");
	assert.equal(body.system[1].text, "\n\nuser context");
	assert.equal(body.output_config.effort, "low");
});
