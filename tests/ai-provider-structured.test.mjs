import assert from "node:assert/strict";
import test from "node:test";

import {
	decideStructuredProvider,
	PROVIDERS,
	providerSupportsStructuredOutput,
	STRUCTURED_FALLBACK_PROVIDER_IDS,
	UTILITY_MODELS,
} from "../src/lib/ai/models.ts";

const ALL = ["openai", "anthropic", "moonshot", "openrouter"];

test("every registered provider declares whether it honours a JSON schema", () => {
	assert.deepEqual(
		PROVIDERS.map((provider) => provider.id).sort(),
		[...ALL].sort()
	);
	for (const provider of PROVIDERS) {
		assert.equal(
			typeof provider.supportsStructuredOutput,
			"boolean",
			`${provider.id} must declare supportsStructuredOutput`
		);
	}
});

test("the fallback order covers every provider, so no provider is unreachable", () => {
	assert.deepEqual([...STRUCTURED_FALLBACK_PROVIDER_IDS].sort(), [...ALL].sort());
});

test("structured work runs on a utility model, which is why one flag per provider is enough", () => {
	// The capability is per-provider only because the utility tier pins one
	// model per provider. Moonshot's must stay a head that documents
	// json_schema; a user picking some older Moonshot model in chat never
	// changes which model the structured call runs on.
	for (const provider of ALL) {
		assert.ok(UTILITY_MODELS[provider]?.providerModelId, `${provider} needs a utility model`);
	}
	assert.equal(UTILITY_MODELS.moonshot.providerModelId, "kimi-k3");
	assert.equal(UTILITY_MODELS.openrouter.providerModelId, "z-ai/glm-5.3-flash");
});

test("Moonshot counts as capable, because buildModel opts it into json_schema", () => {
	// The bug this guards: @ai-sdk/openai-compatible drops the schema and sends
	// `{ type: "json_object" }` unless supportsStructuredOutputs is set. With
	// the opt-in, Kimi K3 honours the schema - so a Moonshot-only user must NOT
	// be told their structured call is unsupported (they have nowhere to fall
	// back to, and that was exactly the broken daily-cross case).
	assert.equal(providerSupportsStructuredOutput("moonshot"), true);

	const decision = decideStructuredProvider({
		provider: "moonshot",
		availableProviders: ["moonshot"],
		structured: true,
	});
	assert.deepEqual(decision, {
		provider: "moonshot",
		fallbackFrom: null,
		unsupported: false,
	});
});

test("OpenRouter counts as capable because its pinned utility head advertises strict schemas", () => {
	assert.equal(providerSupportsStructuredOutput("openrouter"), true);
	assert.deepEqual(
		decideStructuredProvider({
			provider: "openrouter",
			availableProviders: ["openrouter"],
			structured: true,
		}),
		{ provider: "openrouter", fallbackFrom: null, unsupported: false },
	);
});

test("a capable provider runs its own structured call, with no swap", () => {
	for (const provider of ALL) {
		const decision = decideStructuredProvider({
			provider,
			availableProviders: ALL,
			structured: true,
		});
		assert.deepEqual(
			decision,
			{ provider, fallbackFrom: null, unsupported: false },
			`${provider} should keep its own structured call`
		);
	}
});

test("a non-structured call is never moved, even off an incapable provider", () => {
	const decision = decideStructuredProvider({
		provider: "moonshot",
		availableProviders: ALL,
		structured: false,
	});
	assert.deepEqual(decision, {
		provider: "moonshot",
		fallbackFrom: null,
		unsupported: false,
	});
});

// The swap only fires for a provider whose flag is false. None ships that way
// today, so these drive the decision through an injected capability table to
// prove the path a future provider (or a revoked opt-in) would take.
function decideWith(table, options) {
	return decideStructuredProvider({ ...options, supports: (provider) => table[provider] });
}

const MOONSHOT_INCAPABLE = {
	openai: true,
	anthropic: true,
	moonshot: false,
	openrouter: true,
};

test("an incapable provider hands the call to the best capable one it can reach", () => {
	assert.deepEqual(
		decideWith(MOONSHOT_INCAPABLE, {
			provider: "moonshot",
			availableProviders: ["moonshot", "anthropic", "openai"],
			structured: true,
		}),
		{ provider: "openai", fallbackFrom: "moonshot", unsupported: false },
		"openai is first in the preference order"
	);

	assert.deepEqual(
		decideWith(MOONSHOT_INCAPABLE, {
			provider: "moonshot",
			availableProviders: ["moonshot", "anthropic"],
			structured: true,
		}),
		{ provider: "anthropic", fallbackFrom: "moonshot", unsupported: false },
		"anthropic is used when openai is not unlocked"
	);
});

test("with no capable credentials the call stays put and is flagged unsupported", () => {
	assert.deepEqual(
		decideWith(MOONSHOT_INCAPABLE, {
			provider: "moonshot",
			availableProviders: ["moonshot"],
			structured: true,
		}),
		{ provider: "moonshot", fallbackFrom: null, unsupported: true },
		"a Moonshot-only user has nowhere to go; the caller must warn, not crash"
	);

	assert.deepEqual(
		decideWith(MOONSHOT_INCAPABLE, {
			provider: "moonshot",
			availableProviders: [],
			structured: true,
		}),
		{ provider: "moonshot", fallbackFrom: null, unsupported: true },
		"no credentials at all is still a decision, not a throw"
	);
});

test("the capability table is consulted, not a hardcoded provider list", () => {
	assert.deepEqual(
		decideWith(
			{ openai: false, anthropic: true, moonshot: true },
			{ provider: "openai", availableProviders: ["openai", "moonshot"], structured: true }
		),
		{ provider: "moonshot", fallbackFrom: "openai", unsupported: false },
		"even openai gets moved if it is the one that cannot honour a schema"
	);
});
