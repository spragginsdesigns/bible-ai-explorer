import assert from "node:assert/strict";
import test from "node:test";

import {
	buildDefinition,
	buildProviderOptions,
	deriveCapabilities,
	getModel,
	HOUSE_EFFORT,
	isReasoningEffort,
	isReasoningMode,
	isSpeed,
	isVerbosity,
	MODELS,
	NO_RUN_OPTIONS,
	overlayLiveDefinition,
	REASONING_EFFORTS,
	resolveDefinition,
	resolveEffortPreference,
	toModelPayload,
	UTILITY_MODELS,
	verbosityPromptHints,
} from "../src/lib/ai/models.ts";

/** A run bag with only the fields a case cares about set. */
function run(overrides = {}) {
	return { ...NO_RUN_OPTIONS, ...overrides };
}

test("the effort vocabulary is the full union, ordered lowest to highest", () => {
	assert.deepEqual(REASONING_EFFORTS, [
		"none",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
});

test("type guards accept exactly their own vocabulary", () => {
	for (const value of REASONING_EFFORTS) assert.equal(isReasoningEffort(value), true);
	assert.equal(isReasoningEffort("fast"), false);
	assert.equal(isReasoningEffort(""), false);
	assert.equal(isReasoningEffort(null), false);
	assert.equal(isReasoningEffort(3), false);

	assert.equal(isSpeed("standard"), true);
	assert.equal(isSpeed("fast"), true);
	assert.equal(isSpeed("turbo"), false);
	assert.equal(isSpeed(undefined), false);

	assert.equal(isVerbosity("low"), true);
	assert.equal(isVerbosity("medium"), true);
	assert.equal(isVerbosity("high"), true);
	assert.equal(isVerbosity("xhigh"), false);

	assert.equal(isReasoningMode("standard"), true);
	assert.equal(isReasoningMode("pro"), true);
	assert.equal(isReasoningMode("max"), false);
});

// --- effort derivation --------------------------------------------------

test("OpenAI efforts follow the family: 5.6 takes max, older 5.x stops at xhigh", () => {
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.6-luna").efforts, [
		"none",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.5").efforts, [
		"none",
		"low",
		"medium",
		"high",
		"xhigh",
	]);
	assert.deepEqual(deriveCapabilities("openai", "o4-mini").efforts, ["low", "medium", "high"]);
	// Non-reasoning heads reject the parameter outright.
	assert.deepEqual(deriveCapabilities("openai", "gpt-4o").efforts, []);
	assert.deepEqual(deriveCapabilities("openai", "chatgpt-4o-latest").efforts, []);
});

test("Anthropic efforts exclude Haiku and Sonnet 4.5, and cap the 4.6 line at high", () => {
	assert.deepEqual(deriveCapabilities("anthropic", "claude-haiku-4-5").efforts, []);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-sonnet-4-5").efforts, []);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-sonnet-4-6").efforts, [
		"low",
		"medium",
		"high",
	]);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-opus-4-6").efforts, [
		"low",
		"medium",
		"high",
	]);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-opus-5").efforts, [
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
	assert.equal(deriveCapabilities("anthropic", "claude-opus-5").defaultEffort, "high");
	assert.equal(deriveCapabilities("anthropic", "claude-haiku-4-5").defaultEffort, null);
});

test("Moonshot: Kimi K3 documents low/high/max and defaults to max", () => {
	const k3 = deriveCapabilities("moonshot", "kimi-k3");
	assert.deepEqual(k3.efforts, ["low", "high", "max"]);
	assert.equal(k3.defaultEffort, "max");
	assert.deepEqual(deriveCapabilities("moonshot", "kimi-k2.6").efforts, [
		"low",
		"medium",
		"high",
	]);
});

test("OpenRouter advertises no efforts from an id alone", () => {
	// Its ids span every vendor; only the live catalog knows the real list.
	assert.deepEqual(deriveCapabilities("openrouter", "z-ai/glm-5.3-flash").efforts, []);
	assert.equal(deriveCapabilities("openrouter", "z-ai/glm-5.3-flash").defaultEffort, null);
});

test("gpt-5.4-mini defaults to none; the rest of the 5.x family defaults to medium", () => {
	assert.equal(deriveCapabilities("openai", "gpt-5.4-mini").defaultEffort, "none");
	assert.equal(deriveCapabilities("openai", "gpt-5.6-terra").defaultEffort, "medium");
	assert.equal(deriveCapabilities("openai", "gpt-4o").defaultEffort, null);
});

// --- speeds -------------------------------------------------------------

test("fast mode is offered only where the provider sells it", () => {
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.6-luna").speeds, ["standard", "fast"]);
	// The OpenAI SDK deletes service_tier for nano and chat variants.
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.4-nano").speeds, ["standard"]);
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.6-chat").speeds, ["standard"]);
	assert.deepEqual(deriveCapabilities("openai", "gpt-4o").speeds, ["standard", "fast"]);

	assert.deepEqual(deriveCapabilities("anthropic", "claude-opus-5").speeds, [
		"standard",
		"fast",
	]);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-opus-4-8").speeds, [
		"standard",
		"fast",
	]);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-sonnet-5").speeds, ["standard"]);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-opus-4-7").speeds, ["standard"]);

	assert.deepEqual(deriveCapabilities("moonshot", "kimi-k3").speeds, ["standard"]);
	// Fast is routing, not a tier, so every OpenRouter head can offer it.
	assert.deepEqual(deriveCapabilities("openrouter", "z-ai/glm-5.3-flash").speeds, [
		"standard",
		"fast",
	]);
});

test("every fast chip ships with its price caveat, and nothing else carries one", () => {
	assert.equal(
		deriveCapabilities("openai", "gpt-5.6-luna").fastModeNote,
		"About 2x the standard price",
	);
	assert.equal(
		deriveCapabilities("anthropic", "claude-opus-5").fastModeNote,
		"About 2x the price; needs fast-mode access on your Anthropic account",
	);
	assert.equal(
		deriveCapabilities("openrouter", "z-ai/glm-5.3-flash").fastModeNote,
		"Routes to the fastest provider; price may differ",
	);
	assert.equal(deriveCapabilities("anthropic", "claude-sonnet-5").fastModeNote, null);
	assert.equal(deriveCapabilities("moonshot", "kimi-k3").fastModeNote, null);
});

// --- verbosity and mode -------------------------------------------------

test("verbosity is native on OpenAI 5.x and a prompt hint everywhere else", () => {
	const luna = deriveCapabilities("openai", "gpt-5.6-luna");
	assert.deepEqual(luna.verbosities, ["low", "medium", "high"]);
	assert.equal(luna.verbosityMechanism, "native");

	const legacy = deriveCapabilities("openai", "gpt-4o");
	assert.deepEqual(legacy.verbosities, []);
	assert.equal(legacy.verbosityMechanism, null);

	for (const [provider, id] of [
		["anthropic", "claude-opus-5"],
		["moonshot", "kimi-k3"],
		["openrouter", "z-ai/glm-5.3-flash"],
	]) {
		const capabilities = deriveCapabilities(provider, id);
		assert.deepEqual(capabilities.verbosities, ["low", "medium", "high"]);
		assert.equal(capabilities.verbosityMechanism, "prompt");
	}
});

test("Pro mode is a GPT-5.6 capability only", () => {
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.6-sol").modes, ["standard", "pro"]);
	assert.deepEqual(deriveCapabilities("openai", "gpt-5.5").modes, ["standard"]);
	assert.deepEqual(deriveCapabilities("anthropic", "claude-opus-5").modes, ["standard"]);
	assert.deepEqual(deriveCapabilities("moonshot", "kimi-k3").modes, ["standard"]);
	assert.deepEqual(deriveCapabilities("openrouter", "z-ai/glm-5.3-flash").modes, ["standard"]);
});

test("prompt hints exist only for a prompt-mechanism model asked for a non-default length", () => {
	const opus = resolveDefinition("anthropic/claude-opus-5");
	const luna = resolveDefinition("openai/gpt-5.6-luna");

	assert.deepEqual(verbosityPromptHints(opus, "low"), [
		"Answer length: keep this response brief. Give the essentials only, a few short paragraphs at most, with no padding.",
	]);
	assert.deepEqual(verbosityPromptHints(opus, "high"), [
		"Answer length: give a thorough, fully developed response. Explore the context, cross-references and application in depth.",
	]);
	// Medium is the provider's own default, so it says nothing.
	assert.deepEqual(verbosityPromptHints(opus, "medium"), []);
	assert.deepEqual(verbosityPromptHints(opus, null), []);
	// OpenAI takes a real parameter, so it never gets a prompt sentence.
	assert.deepEqual(verbosityPromptHints(luna, "low"), []);
});

// --- providerOptions ----------------------------------------------------

test("OpenAI maps every option, and always turns the reasoning summary off", () => {
	const luna = resolveDefinition("openai/gpt-5.6-luna");
	assert.deepEqual(
		buildProviderOptions(
			"openai",
			run({ effort: "max", speed: "fast", verbosity: "high", mode: "pro" }),
			true,
			luna,
		),
		{
			openai: {
				reasoningEffort: "max",
				textVerbosity: "high",
				serviceTier: "fast",
				reasoningMode: "pro",
				reasoningSummary: null,
				passThroughUnsupportedFiles: true,
			},
		},
	);

	// An empty run still turns the summary off: the SDK would otherwise default
	// it to "detailed" as soon as any effort is set.
	assert.deepEqual(buildProviderOptions("openai", run(), false, luna), {
		openai: { reasoningSummary: null },
	});
});

test("Anthropic sends effort and speed, and never a verbosity parameter", () => {
	const opus = resolveDefinition("anthropic/claude-opus-5");
	assert.deepEqual(
		buildProviderOptions(
			"anthropic",
			run({ effort: "xhigh", speed: "fast", verbosity: "low", mode: "pro" }),
			true,
			opus,
		),
		{ anthropic: { effort: "xhigh", speed: "fast" } },
	);

	const sonnet = resolveDefinition("anthropic/claude-sonnet-5");
	assert.deepEqual(
		buildProviderOptions("anthropic", run({ effort: "high", speed: "fast" }), false, sonnet),
		// Sonnet 5 does not sell fast mode; the chip is never rendered and the
		// option is never sent.
		{ anthropic: { effort: "high" } },
	);
});

test("Moonshot sends reasoningEffort and no verbosity, since its mechanism is prompt", () => {
	const k3 = resolveDefinition("moonshot/kimi-k3");
	assert.deepEqual(
		buildProviderOptions(
			"moonshot",
			run({ effort: "max", speed: "fast", verbosity: "high", mode: "pro" }),
			false,
			k3,
		),
		{ moonshot: { reasoningEffort: "max" } },
	);
});

test("OpenRouter nests reasoning and expresses fast as throughput routing", () => {
	const glm = resolveDefinition("openrouter/z-ai/glm-5.3-flash");
	assert.deepEqual(
		buildProviderOptions("openrouter", run({ effort: "max", speed: "fast" }), false, glm),
		{ openrouter: { reasoning: { effort: "max" }, provider: { sort: "throughput" } } },
	);

	// Verbosity is native only when the live catalog says the head takes the
	// parameter; the curated entry's mechanism is prompt.
	assert.deepEqual(
		buildProviderOptions("openrouter", run({ verbosity: "low" }), false, glm),
		{ openrouter: {} },
	);
	const native = { ...glm, verbosityMechanism: "native" };
	assert.deepEqual(buildProviderOptions("openrouter", run({ verbosity: "low" }), false, native), {
		openrouter: { verbosity: "low" },
	});
});

test("an option the definition does not allow is never emitted", () => {
	const haiku = resolveDefinition("anthropic/claude-haiku-4-5");
	// Haiku lists no efforts at all; sending one is a hard 400.
	assert.deepEqual(
		buildProviderOptions("anthropic", run({ effort: "high", speed: "fast" }), false, haiku),
		{ anthropic: {} },
	);

	const nano = resolveDefinition("openai/gpt-5.4-nano");
	assert.deepEqual(buildProviderOptions("openai", run({ speed: "fast", mode: "pro" }), false, nano), {
		openai: { reasoningSummary: null },
	});

	const gpt55 = resolveDefinition("openai/gpt-5.5");
	// max is a 5.6 value; 5.5 stops at xhigh.
	assert.deepEqual(buildProviderOptions("openai", run({ effort: "max" }), false, gpt55), {
		openai: { reasoningSummary: null },
	});

	const legacy = resolveDefinition("openai/gpt-4o");
	assert.deepEqual(
		buildProviderOptions("openai", run({ effort: "high", verbosity: "high" }), false, legacy),
		{ openai: { reasoningSummary: null } },
	);
});

test("every model in the registry can honour the options it advertises", () => {
	for (const model of MODELS) {
		const emitted = buildProviderOptions(
			model.provider,
			run({
				effort: model.efforts[model.efforts.length - 1] ?? null,
				speed: model.speeds.includes("fast") ? "fast" : "standard",
				verbosity: model.verbosities.includes("high") ? "high" : null,
				mode: model.modes.includes("pro") ? "pro" : "standard",
			}),
			false,
			model,
		)[model.provider];

		assert.ok(emitted, `${model.id} must produce a ${model.provider} option bag`);
		// A model that lists no efforts must never receive one, whatever is asked.
		if (model.efforts.length === 0) {
			assert.equal(emitted.reasoningEffort, undefined);
			assert.equal(emitted.effort, undefined);
			assert.equal(emitted.reasoning, undefined);
		}
		if (!model.speeds.includes("fast")) {
			assert.equal(emitted.serviceTier, undefined);
			assert.equal(emitted.speed, undefined);
			assert.equal(emitted.provider, undefined);
		}
		if (!model.modes.includes("pro")) assert.equal(emitted.reasoningMode, undefined);
		if (model.verbosityMechanism !== "native") {
			assert.equal(emitted.textVerbosity, undefined);
			assert.equal(emitted.verbosity, undefined);
		}
	}
});

// --- definitions and the wire payload -----------------------------------

test("curated metadata rides on the definition, including uncurated live rows", () => {
	const luna = getModel("openai/gpt-5.6-luna");
	assert.equal(luna.tagline, "Fastest and lowest cost");
	assert.equal(luna.tier, "fast");
	assert.equal(luna.contextWindow, 1_050_000);
	assert.deepEqual(luna.pricing, { input: 0.2, output: 1.2 });

	// gpt-5.5 is not in MODELS, so this only works because the curated table is
	// keyed by id and applied wherever a definition is built.
	const gpt55 = resolveDefinition("openai/gpt-5.5");
	assert.deepEqual(gpt55.pricing, { input: 5, output: 30 });
	assert.equal(gpt55.contextWindow, 1_050_000);
	assert.equal(gpt55.tagline, null);
	assert.equal(gpt55.tier, null);

	// Anything uncurated derives its capabilities and carries no curated facts.
	const unknown = resolveDefinition("openai/gpt-5.7-unknown");
	assert.equal(unknown.tagline, null);
	assert.equal(unknown.tier, null);
	assert.equal(unknown.pricing, null);
	assert.equal(unknown.contextWindow, null);
	assert.deepEqual(unknown.speeds, ["standard", "fast"]);
});

test("a curated effort override narrows the derived list and clamps the default", () => {
	const glm = getModel("openrouter/z-ai/glm-5.3-flash");
	assert.deepEqual(glm.efforts, ["low", "high", "max"]);
	// Derivation offered no default and the override supplies none either.
	assert.equal(glm.defaultEffort, null);
});

test("the wire payload carries the new fields and hides the verbosity mechanism", () => {
	const payload = toModelPayload(getModel("openai/gpt-5.6-luna"));
	assert.deepEqual(payload, {
		id: "openai/gpt-5.6-luna",
		label: "GPT-5.6 Luna",
		provider: "openai",
		supportsAttachments: true,
		efforts: ["none", "low", "medium", "high", "xhigh", "max"],
		available: true,
		speeds: ["standard", "fast"],
		verbosities: ["low", "medium", "high"],
		modes: ["standard", "pro"],
		defaultEffort: "medium",
		tagline: "Fastest and lowest cost",
		tier: "fast",
		contextWindow: 1_050_000,
		pricing: { input: 0.2, output: 1.2 },
		fastModeNote: "About 2x the standard price",
	});
	assert.equal("verbosityMechanism" in payload, false);
	assert.equal(toModelPayload(getModel("moonshot/kimi-k3"), false).available, false);
});

// --- invariants the rest of the app leans on ----------------------------

test("the house model still accepts the house effort after the widening", () => {
	const house = getModel("openai/gpt-5.6-luna");
	assert.ok(house.efforts.includes(HOUSE_EFFORT));
});

test("every utility effort is one its own model actually lists", () => {
	// resolveModel sends these without a per-request clamp, so a mismatch here
	// would be a hard provider error on every background call.
	for (const [provider, utility] of Object.entries(UTILITY_MODELS)) {
		if (!utility.effort) continue;
		const definition = buildDefinition({
			provider,
			providerModelId: utility.providerModelId,
		});
		assert.ok(
			definition.efforts.includes(utility.effort),
			`${provider} utility effort ${utility.effort} is not listed by ${utility.providerModelId}`,
		);
	}
});

test("an explicit Auto beats the stored effort; an absent field does not", () => {
	// Choosing Auto after High used to keep running High, because null fell back
	// to the stored default. Auto is a choice and must win.
	assert.equal(
		resolveEffortPreference({
			requested: null,
			explicitAuto: true,
			stored: "high",
			fallback: "medium",
		}),
		"medium",
	);
	// A body with no `effort` key at all still means "no opinion".
	assert.equal(
		resolveEffortPreference({
			requested: null,
			explicitAuto: false,
			stored: "high",
			fallback: "medium",
		}),
		"high",
	);
	// An explicit level always wins, whatever else is set.
	assert.equal(
		resolveEffortPreference({
			requested: "max",
			explicitAuto: true,
			stored: "high",
			fallback: "medium",
		}),
		"max",
	);
	// Auto means "let the app decide", not "send no effort": the caller's
	// fallback still applies, so the opening question keeps its high default.
	assert.equal(
		resolveEffortPreference({
			requested: null,
			explicitAuto: true,
			stored: null,
			fallback: "high",
		}),
		"high",
	);
});

test("the live catalog refreshes an OpenRouter definition at request time", () => {
	// The picker renders OpenRouter's chips from its live catalog. Resolution
	// from an id alone knows none of it, so without this overlay every chosen
	// effort would be clamped to null and the chip would do nothing.
	const derived = resolveDefinition("openrouter/z-ai/glm-5.3-flash");
	assert.deepEqual(derived.efforts, ["low", "high", "max"]);
	assert.equal(derived.verbosityMechanism, "prompt");
	assert.equal(derived.pricing, null);

	const live = {
		...derived,
		efforts: ["low", "medium", "high"],
		defaultEffort: "medium",
		verbosityMechanism: "native",
		contextWindow: 1_048_576,
		pricing: { input: 0.075, output: 0.25 },
	};

	const merged = overlayLiveDefinition(derived, [live]);
	assert.deepEqual(merged.efforts, ["low", "medium", "high"]);
	assert.equal(merged.defaultEffort, "medium");
	assert.equal(merged.verbosityMechanism, "native");
	assert.equal(merged.contextWindow, 1_048_576);
	assert.deepEqual(merged.pricing, { input: 0.075, output: 0.25 });
	// Identity is never taken from the catalog.
	assert.equal(merged.id, derived.id);
	assert.equal(merged.provider, "openrouter");
	assert.equal(merged.providerModelId, "z-ai/glm-5.3-flash");

	// The refreshed definition is what makes the option reach the provider.
	assert.deepEqual(
		buildProviderOptions(
			"openrouter",
			run({ effort: "medium", verbosity: "low" }),
			false,
			merged,
		),
		{ openrouter: { reasoning: { effort: "medium" }, verbosity: "low" } },
	);
	// The same request on the underived definition sends neither.
	assert.deepEqual(
		buildProviderOptions(
			"openrouter",
			run({ effort: "medium", verbosity: "low" }),
			false,
			derived,
		),
		{ openrouter: {} },
	);
});

test("a definition the live catalog does not carry is left exactly as it was", () => {
	// A stale stored id, or a catalog fetch that fell back to the curated
	// snapshot, must not lose the capabilities it already had.
	const derived = resolveDefinition("openrouter/z-ai/glm-5.3-flash");
	assert.deepEqual(overlayLiveDefinition(derived, []), derived);
	assert.deepEqual(
		overlayLiveDefinition(derived, [resolveDefinition("openrouter/some/other-model")]),
		derived,
	);
});

test("standard is always an offered speed, and medium always an offered verbosity", () => {
	for (const id of [
		"openai/gpt-5.6-luna",
		"openai/gpt-4o",
		"anthropic/claude-haiku-4-5",
		"moonshot/kimi-k3",
		"openrouter/z-ai/glm-5.3-flash",
	]) {
		const definition = resolveDefinition(id);
		assert.ok(definition.speeds.includes("standard"), `${id} must offer standard speed`);
		assert.ok(definition.modes.includes("standard"), `${id} must offer standard mode`);
		if (definition.verbosities.length > 0) {
			assert.ok(definition.verbosities.includes("medium"), `${id} must offer medium length`);
		}
	}
});
