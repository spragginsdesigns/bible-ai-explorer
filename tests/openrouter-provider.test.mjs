import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	buildProviderOptions,
	getModel,
	isProviderId,
	parseModelId,
	UTILITY_MODELS,
} from "../src/lib/ai/models.ts";

test("OpenRouter is registered with a vendor-namespaced curated model", () => {
	assert.equal(isProviderId("openrouter"), true);
	assert.deepEqual(parseModelId("openrouter/z-ai/glm-5.3-flash"), {
		provider: "openrouter",
		providerModelId: "z-ai/glm-5.3-flash",
	});
	assert.deepEqual(parseModelId("openrouter/~z-ai/glm-latest"), {
		provider: "openrouter",
		providerModelId: "~z-ai/glm-latest",
	});
	assert.equal(parseModelId("openai/~gpt-latest"), null);
	assert.equal(parseModelId("openrouter/~"), null);
	assert.deepEqual(UTILITY_MODELS.openrouter, {
		providerModelId: "z-ai/glm-5.3-flash",
		effort: "low",
	});
	// The curated snapshot mirrors what OpenRouter's catalog reports for this
	// head; a live row overwrites it in every picker response.
	assert.deepEqual(getModel("openrouter/z-ai/glm-5.3-flash")?.efforts, ["low", "high", "max"]);
});

test("OpenRouter live metadata filters non-chat rows and drives vision and effort", async () => {
	const catalog = await readFile("src/lib/ai/modelCatalog.ts", "utf8");
	assert.match(catalog, /https:\/\/openrouter\.ai\/api\/v1\/models/);
	assert.match(catalog, /architecture\.input_modalities/);
	assert.match(catalog, /architecture\.output_modalities/);
	assert.match(catalog, /reasoning\.supported_efforts/);
	assert.match(catalog, /entry\.supported_parameters/);
	assert.match(catalog, /provider === "openrouter" \? openRouterMeta\(entry\) : \{\}/);
	assert.match(catalog, /row\.chatOutput !== false && row\.supportsTools !== false/);
	assert.match(catalog, /supportsAttachments: row\.imageInput \?\? provider !== "moonshot"/);
	assert.match(catalog, /row\.efforts && row\.efforts\.length > 0/);
});

test("OpenRouter keys use the authenticated /key probe and the official adapter", async () => {
	const [route, provider] = await Promise.all([
		readFile("src/app/api/providers/route.ts", "utf8"),
		readFile("src/lib/ai/provider.ts", "utf8"),
	]);

	assert.match(route, /openrouter:[\s\S]*https:\/\/openrouter\.ai\/api\/v1\/key/);
	assert.match(provider, /createOpenRouter\(\{/);
	assert.match(provider, /appName: "SureWord"/);
	assert.match(provider, /appUrl: "https:\/\/sureword\.app"/);
});

test("OpenRouter reasoning travels nested under its own key, not as a flat effort", () => {
	// The adapter spreads providerOptions.openrouter verbatim into the request
	// body, so a flat `effort` would be sent and silently ignored upstream.
	const glm = getModel("openrouter/z-ai/glm-5.3-flash");
	assert.deepEqual(
		buildProviderOptions(
			"openrouter",
			{ effort: "max", speed: null, verbosity: null, mode: null },
			false,
			glm,
		),
		{ openrouter: { reasoning: { effort: "max" } } },
	);
});
