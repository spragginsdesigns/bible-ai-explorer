/*
 * Opt-in paid smoke for the exact adapter path SureWord ships:
 *
 *   RUN_OPENROUTER_SMOKE=1 OPENROUTER_API_KEY=... \
 *     node --experimental-strip-types --test tests/openrouter-provider-smoke.test.mjs
 *
 * It proves strict structured output and multi-step tool calling on the pinned
 * OpenRouter utility model. The regular logic suite stays hermetic.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const enabled =
	process.env.RUN_OPENROUTER_SMOKE === "1" && Boolean(process.env.OPENROUTER_API_KEY);

test("OpenRouter adapter handles structured output and SureWord-style tools", {
	skip: !enabled,
	timeout: 180_000,
}, async () => {
	const [{ createOpenRouter }, { generateText, isStepCount, Output, tool }, { z }] =
		await Promise.all([
			import("@openrouter/ai-sdk-provider"),
			import("ai"),
			import("zod"),
		]);
	const model = createOpenRouter({
		apiKey: process.env.OPENROUTER_API_KEY,
		appName: "SureWord",
		appUrl: "https://sureword.app",
	})("z-ai/glm-5.3-flash");
	const providerOptions = { openrouter: { reasoning: { effort: "low" } } };

	const structured = await generateText({
		model,
		providerOptions,
		output: Output.object({
			schema: z.object({
				reference: z.string(),
				summary: z.string(),
			}),
		}),
		prompt:
			'Return John 1:1 as the reference and a one-sentence Christian summary. Use exactly the required schema.',
	});
	assert.equal(structured.output.reference, "John 1:1");
	assert.ok(structured.output.summary.length > 10);

	const withTool = await generateText({
		model,
		providerOptions,
		stopWhen: isStepCount(3),
		tools: {
			get_scripture: tool({
				description: "Read one exact KJV verse.",
				inputSchema: z.object({ reference: z.literal("John 1:1") }),
				execute: async () =>
					"In the beginning was the Word, and the Word was with God, and the Word was God.",
			}),
		},
		prompt:
			"Call get_scripture for John 1:1, then explain in one sentence what the verse says about the Word.",
	});
	assert.ok(withTool.steps.some((step) => step.toolCalls.length > 0));
	assert.ok(withTool.text.length > 10);

	const attachment = await generateText({
		model,
		providerOptions,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Describe the main visible symbol in this SureWord app icon in one sentence.",
					},
					{
						type: "file",
						data: await readFile("public/icon-192.png"),
						mediaType: "image/png",
					},
				],
			},
		],
	});
	assert.ok(attachment.text.length > 10);
	console.log(
		JSON.stringify({
			structuredReference: structured.output.reference,
			toolCalls: withTool.steps.reduce((sum, step) => sum + step.toolCalls.length, 0),
			answerCharacters: withTool.text.length,
			attachmentCharacters: attachment.text.length,
		}),
	);
});
