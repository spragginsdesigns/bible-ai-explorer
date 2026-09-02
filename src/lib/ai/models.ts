export type ProviderId = "openai" | "anthropic" | "moonshot" | "openrouter";

export type ReasoningEffort = "low" | "medium" | "high";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	/** Where the user creates an API key, shown in Settings. */
	keyUrl: string;
	/**
	 * Whether this provider honours a JSON *schema* on the utility model - the
	 * `generateText({ output: Output.object({ schema }) })` calls behind the
	 * daily cross, suggested questions, reading plans and memory extraction.
	 *
	 * This is a fact about how `buildModel` configures the provider, not just
	 * about the upstream API. Moonshot speaks the OpenAI wire format, and
	 * `@ai-sdk/openai-compatible` silently downgrades `response_format` to
	 * `{ type: "json_object" }` - dropping the schema entirely - unless the
	 * provider is built with `supportsStructuredOutputs: true`. That downgrade
	 * is what made Kimi return JSON with invented keys and Zod throw
	 * `AI_NoObjectGeneratedError`, so `buildModel` now opts in for structured
	 * calls and this flag says so.
	 */
	supportsStructuredOutput: boolean;
}

export const PROVIDERS: readonly ProviderInfo[] = [
	{
		id: "openai",
		label: "OpenAI",
		keyUrl: "https://platform.openai.com/api-keys",
		supportsStructuredOutput: true,
	},
	{
		id: "anthropic",
		label: "Anthropic",
		keyUrl: "https://console.anthropic.com/settings/keys",
		supportsStructuredOutput: true,
	},
	{
		id: "moonshot",
		label: "Moonshot (Kimi)",
		keyUrl: "https://platform.moonshot.ai/console/api-keys",
		// Kimi K3 documents `response_format: { type: "json_schema" }` with
		// `strict: true` and token-level constrained decoding, and the utility
		// tier always runs on kimi-k3 (see UTILITY_MODELS), so the schema is
		// honoured as long as buildModel opts the provider in.
		supportsStructuredOutput: true,
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		keyUrl: "https://openrouter.ai/settings/keys",
		// Utility work is pinned to GLM 5.3 Flash below. OpenRouter's live
		// catalog advertises `structured_outputs`/`response_format` for that
		// head, and the official adapter forwards the JSON schema unchanged.
		supportsStructuredOutput: true,
	},
];

export interface ModelDefinition {
	/** Namespaced id clients send, e.g. "openai/gpt-5.6-terra". */
	id: string;
	label: string;
	provider: ProviderId;
	/** Model name the provider SDK factory expects. */
	providerModelId: string;
	supportsAttachments: boolean;
	efforts: readonly ReasoningEffort[];
}

// Curated entries: nice labels and vetted capability flags for the models we
// feature. The picker and resolver are NOT limited to this list — any model a
// provider's live /models endpoint reports is usable; these entries just win
// on label/ordering when present, and serve as the fallback catalog when a
// provider's list endpoint is unreachable or the user hasn't unlocked it yet.
export const MODELS: readonly ModelDefinition[] = [
	{
		id: "openai/gpt-5.6-luna",
		label: "GPT-5.6 Luna",
		provider: "openai",
		providerModelId: "gpt-5.6-luna",
		supportsAttachments: true,
		efforts: ["low", "medium", "high"],
	},
	{
		id: "openai/gpt-5.6-sol",
		label: "GPT-5.6 Sol",
		provider: "openai",
		providerModelId: "gpt-5.6-sol",
		supportsAttachments: true,
		efforts: ["low", "medium", "high"],
	},
	{
		id: "openai/gpt-5.6-terra",
		label: "GPT-5.6 Terra",
		provider: "openai",
		providerModelId: "gpt-5.6-terra",
		supportsAttachments: true,
		efforts: ["low", "medium", "high"],
	},
	{
		id: "anthropic/claude-opus-5",
		label: "Claude Opus 5",
		provider: "anthropic",
		providerModelId: "claude-opus-5",
		supportsAttachments: true,
		efforts: ["low", "medium", "high"],
	},
	{
		id: "anthropic/claude-sonnet-5",
		label: "Claude Sonnet 5",
		provider: "anthropic",
		providerModelId: "claude-sonnet-5",
		supportsAttachments: true,
		efforts: ["low", "medium", "high"],
	},
	{
		id: "moonshot/kimi-k3",
		label: "Kimi K3",
		provider: "moonshot",
		providerModelId: "kimi-k3",
		// Kimi has vision but the attachment pipeline also carries PDFs and
		// other documents it does not accept; keep uploads on the providers
		// that handle every type until per-mime gating exists.
		supportsAttachments: false,
		efforts: ["low", "medium", "high"],
	},
	{
		id: "openrouter/z-ai/glm-5.3-flash",
		label: "GLM 5.3 Flash",
		provider: "openrouter",
		providerModelId: "z-ai/glm-5.3-flash",
		// OpenRouter advertises text/image/video input for this head. The
		// official adapter also carries PDFs and text files as file parts.
		supportsAttachments: true,
		// SureWord's shared effort vocabulary stops at high; the model also
		// advertises max, which clients intentionally do not offer yet.
		efforts: ["low", "high"],
	},
];

export const DEFAULT_MODEL_ID = "openai/gpt-5.6-luna";

/**
 * The model every account without its own API key runs on, on SureWord's own
 * OpenAI key. Those users get no model or effort picker at all, so this pair is
 * the whole of their configuration: a house account is not a stored choice, and
 * nothing about it is written back to the user row.
 */
export const HOUSE_MODEL_ID = "openai/gpt-5.6-luna";
export const HOUSE_EFFORT: ReasoningEffort = "medium";

/**
 * Models that can read the whole attachment pipeline (images, PDFs and text
 * files), best first. A message carrying files runs on the first of these the
 * user has credentials for, because sending a file part to a model that cannot
 * take one is a hard 400 from the provider and kills the whole answer.
 */
export const ATTACHMENT_CAPABLE_MODEL_IDS: readonly string[] = [
	DEFAULT_MODEL_ID,
	"anthropic/claude-sonnet-5",
	"anthropic/claude-opus-5",
	"openrouter/z-ai/glm-5.3-flash",
];

/**
 * Cheap sibling used for background work (memory extraction, summaries) so
 * those bills follow the same credentials as the user's chat model. Anthropic's
 * utility model takes no effort option: Haiku 4.5 rejects it.
 */
export const UTILITY_MODELS: Record<ProviderId, { providerModelId: string; effort: ReasoningEffort | null }> = {
	openai: { providerModelId: "gpt-5.6-terra", effort: "low" },
	anthropic: { providerModelId: "claude-haiku-4-5", effort: null },
	moonshot: { providerModelId: "kimi-k3", effort: "low" },
	openrouter: { providerModelId: "z-ai/glm-5.3-flash", effort: "low" },
};

/** Order structured work falls back through, best first. */
export const STRUCTURED_FALLBACK_PROVIDER_IDS: readonly ProviderId[] = [
	"openai",
	"anthropic",
	"moonshot",
	"openrouter",
];

export function providerSupportsStructuredOutput(provider: ProviderId): boolean {
	return PROVIDERS.find((entry) => entry.id === provider)?.supportsStructuredOutput ?? false;
}

export interface StructuredProviderDecision {
	/** The provider the call should actually run on. */
	provider: ProviderId;
	/**
	 * The provider the user had picked, when it cannot honour a schema and a
	 * capable one ran the call instead. Null when no swap happened.
	 */
	fallbackFrom: ProviderId | null;
	/**
	 * True when the call must run on a provider that will ignore the schema -
	 * the user holds credentials for nothing better. The call still goes out;
	 * the caller is expected to warn and to tolerate a parse failure.
	 */
	unsupported: boolean;
}

/**
 * Which provider to run a structured (`Output.object`) utility call on.
 *
 * A schema sent to a provider that ignores it does not fail loudly: the model
 * answers with plausible JSON under keys it invented, and Zod rejects it as
 * `AI_NoObjectGeneratedError` well after the tokens are paid for. So a
 * structured call is moved to a capable provider when one is unlocked.
 *
 * Kept pure - no Prisma, no provider SDKs - so it is unit-testable on its own
 * (`tests/ai-provider-structured.test.mjs`). `resolveModel` supplies the
 * credential facts; this decides what to do with them. `availableProviders` is
 * every provider the user can reach, by their own key or an allowlisted server
 * key.
 */
export function decideStructuredProvider(options: {
	provider: ProviderId;
	availableProviders: readonly ProviderId[];
	/** False for calls that only need free-form text; no swap is warranted. */
	structured: boolean;
	/**
	 * Capability lookup, overridable so the decision can be exercised against
	 * provider mixes we do not currently ship. Defaults to the real table.
	 */
	supports?: (provider: ProviderId) => boolean;
}): StructuredProviderDecision {
	const supports = options.supports ?? providerSupportsStructuredOutput;

	if (!options.structured || supports(options.provider)) {
		return { provider: options.provider, fallbackFrom: null, unsupported: false };
	}

	const available = new Set(options.availableProviders);
	const capable = STRUCTURED_FALLBACK_PROVIDER_IDS.find(
		(candidate) => available.has(candidate) && supports(candidate)
	);

	if (capable && capable !== options.provider) {
		return { provider: capable, fallbackFrom: options.provider, unsupported: false };
	}

	return { provider: options.provider, fallbackFrom: null, unsupported: true };
}

export function getModel(modelId: string): ModelDefinition | undefined {
	return MODELS.find((model) => model.id === modelId);
}

export function isProviderId(value: unknown): value is ProviderId {
	return typeof value === "string" && PROVIDERS.some((provider) => provider.id === value);
}

/** Provider model names are opaque but must stay sane enough to send upstream. */
const PROVIDER_MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
// OpenRouter returns account-scoped aliases such as `~z-ai/glm-latest` from
// its live catalog. They are callable model ids, not UI-only labels.
const OPENROUTER_MODEL_ID_PATTERN = /^(?:[a-zA-Z0-9]|~[a-zA-Z0-9])[a-zA-Z0-9._:/~-]{0,127}$/;

export function parseModelId(
	modelId: string,
): { provider: ProviderId; providerModelId: string } | null {
	const slash = modelId.indexOf("/");
	if (slash <= 0) return null;
	const provider = modelId.slice(0, slash);
	const providerModelId = modelId.slice(slash + 1);
	if (!isProviderId(provider)) return null;
	const pattern = provider === "openrouter" ? OPENROUTER_MODEL_ID_PATTERN : PROVIDER_MODEL_ID_PATTERN;
	if (!pattern.test(providerModelId)) return null;
	return { provider, providerModelId };
}

/**
 * Whether a model accepts a reasoning-effort option. Sending one to a model
 * that rejects it (OpenAI non-reasoning models, Anthropic Haiku) is a hard
 * API error, so unknown models get a conservative per-provider heuristic.
 */
export function modelSupportsEffort(provider: ProviderId, providerModelId: string): boolean {
	switch (provider) {
		case "openai":
			return /^(gpt-5|o\d)/.test(providerModelId);
		case "anthropic":
			return !/haiku/i.test(providerModelId);
		case "moonshot":
			return true;
		case "openrouter":
			// OpenRouter model ids span many vendors. The live catalog supplies
			// exact effort metadata; never guess for an arbitrary saved slug.
			return false;
	}
}

/** "gpt-5.6-luna" → "GPT-5.6 Luna"; used for models with no curated label. */
export function prettyModelLabel(providerModelId: string): string {
	const tokens = providerModelId.split("-");
	let label = "";
	for (const token of tokens) {
		const cased = token === "gpt" ? "GPT" : token.charAt(0).toUpperCase() + token.slice(1);
		if (!label) label = cased;
		else if (/^\d/.test(token)) label += `-${token}`;
		else label += ` ${cased}`;
	}
	return label;
}

/**
 * Definition for any `provider/model` id: the curated entry when we have one,
 * otherwise one synthesized from provider heuristics. Returns undefined only
 * for ids that don't name a known provider.
 */
export function resolveDefinition(modelId: string): ModelDefinition | undefined {
	const curated = getModel(modelId);
	if (curated) return curated;
	const parsed = parseModelId(modelId);
	if (!parsed) return undefined;
	return {
		id: modelId,
		label: prettyModelLabel(parsed.providerModelId),
		provider: parsed.provider,
		providerModelId: parsed.providerModelId,
		// Moonshot stays opted out of uploads until per-mime gating exists.
		// OpenRouter's live catalog overrides this optimistic fallback with the
		// model's advertised input modalities in every picker response.
		supportsAttachments: parsed.provider !== "moonshot",
		efforts: modelSupportsEffort(parsed.provider, parsed.providerModelId)
			? REASONING_EFFORTS
			: [],
	};
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}
