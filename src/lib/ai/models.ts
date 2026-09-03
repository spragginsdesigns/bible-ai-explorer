import type { JSONValue } from "ai";

export type ProviderId = "openai" | "anthropic" | "moonshot" | "openrouter";

/**
 * Every reasoning level any provider we speak to accepts. It is a union of
 * vocabularies, not a level any single model takes: `ModelDefinition.efforts`
 * says which of these a given head actually lists, and nothing outside that
 * list is ever sent (an unsupported effort is a hard 400 on OpenAI and
 * Anthropic alike).
 */
export type ReasoningEffort =
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

/** Ordered lowest to highest. Clients render efforts in this order. */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** Whether the request buys priority capacity, at a premium price. */
export type Speed = "standard" | "fast";

export const SPEEDS: readonly Speed[] = ["standard", "fast"];

/** How long the answer should be, independent of how hard the model thought. */
export type Verbosity = "low" | "medium" | "high";

export const VERBOSITIES: readonly Verbosity[] = ["low", "medium", "high"];

/** Multi-pass reasoning: one answer, more work behind it. */
export type ReasoningMode = "standard" | "pro";

export const REASONING_MODES: readonly ReasoningMode[] = ["standard", "pro"];

/**
 * How a model takes a length instruction: a real request parameter (`native`)
 * or a sentence appended to the system prompt (`prompt`), which is all
 * Anthropic and Moonshot offer. Server-internal - the wire contract sends the
 * values a client may offer, never the mechanism behind them.
 */
export type VerbosityMechanism = "native" | "prompt";

/** Where a model sits in its family, for the picker's second line. */
export type ModelTier = "flagship" | "balanced" | "fast";

/** USD per 1,000,000 tokens. */
export interface ModelPricing {
	input: number;
	output: number;
}

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
	/** Reasoning levels this head lists, lowest first. Empty means send none. */
	efforts: readonly ReasoningEffort[];
	/** Always holds "standard"; "fast" only where the provider sells it. */
	speeds: readonly Speed[];
	/** Empty when answer length cannot be steered at all. */
	verbosities: readonly Verbosity[];
	/** Server-internal. Null exactly when `verbosities` is empty. */
	verbosityMechanism: VerbosityMechanism | null;
	modes: readonly ReasoningMode[];
	/** What the provider runs when no effort is sent, where it is documented. */
	defaultEffort: ReasoningEffort | null;
	/** One curated line for the picker. Null for anything uncurated. */
	tagline: string | null;
	tier: ModelTier | null;
	/** Context window in tokens. */
	contextWindow: number | null;
	pricing: ModelPricing | null;
	/** Caveat shown beside the Fast chip. Null when fast is not offered. */
	fastModeNote: string | null;
}

/** The part of a definition derived from the provider's own rules. */
export type ModelCapabilities = Pick<
	ModelDefinition,
	"efforts" | "speeds" | "verbosities" | "verbosityMechanism" | "modes" | "defaultEffort" | "fastModeNote"
>;

const STANDARD_ONLY: readonly Speed[] = ["standard"];
const STANDARD_AND_FAST: readonly Speed[] = ["standard", "fast"];
const STANDARD_MODE_ONLY: readonly ReasoningMode[] = ["standard"];
const STANDARD_AND_PRO: readonly ReasoningMode[] = ["standard", "pro"];
const NO_EFFORTS: readonly ReasoningEffort[] = [];
const NO_VERBOSITIES: readonly Verbosity[] = [];

// Every fast mode is a price rise, so the chip never ships without its caveat.
const OPENAI_FAST_NOTE = "About 2x the standard price";
const ANTHROPIC_FAST_NOTE =
	"About 2x the price; needs fast-mode access on your Anthropic account";
const OPENROUTER_FAST_NOTE = "Routes to the fastest provider; price may differ";

function openAiCapabilities(providerModelId: string): ModelCapabilities {
	const gpt5 = /^gpt-5/.test(providerModelId);
	const gpt56 = /^gpt-5\.6/.test(providerModelId);
	const efforts: readonly ReasoningEffort[] = gpt56
		? ["none", "low", "medium", "high", "xhigh", "max"]
		: gpt5
			? ["none", "low", "medium", "high", "xhigh"]
			: /^o\d/.test(providerModelId)
				? ["low", "medium", "high"]
				: NO_EFFORTS;
	// `@ai-sdk/openai` validates service_tier itself and deletes `fast` for the
	// nano and chat variants, so offering it there would be a dead chip.
	const fast =
		(gpt5 && !providerModelId.includes("nano") && !providerModelId.includes("chat")) ||
		/^gpt-4/.test(providerModelId);
	return {
		efforts,
		speeds: fast ? STANDARD_AND_FAST : STANDARD_ONLY,
		verbosities: gpt5 ? VERBOSITIES : NO_VERBOSITIES,
		verbosityMechanism: gpt5 ? "native" : null,
		modes: gpt56 ? STANDARD_AND_PRO : STANDARD_MODE_ONLY,
		// gpt-5.4-mini's model page documents `none` as its default; the rest of
		// the 5.x family documents medium.
		defaultEffort: /^gpt-5\.4-mini/.test(providerModelId)
			? "none"
			: gpt5
				? "medium"
				: null,
		fastModeNote: fast ? OPENAI_FAST_NOTE : null,
	};
}

function anthropicCapabilities(providerModelId: string): ModelCapabilities {
	// Haiku 4.5 and Sonnet 4.5 are absent from Anthropic's effort-supporting
	// model list and the SDK has no guard, so sending one is a hard 400.
	const efforts: readonly ReasoningEffort[] = /haiku/i.test(providerModelId)
		? NO_EFFORTS
		: /sonnet-4-5/.test(providerModelId)
			? NO_EFFORTS
			: /-4-6/.test(providerModelId)
				? ["low", "medium", "high"]
				: ["low", "medium", "high", "xhigh", "max"];
	const fast =
		providerModelId.startsWith("claude-opus-5") ||
		providerModelId.startsWith("claude-opus-4-8");
	return {
		efforts,
		speeds: fast ? STANDARD_AND_FAST : STANDARD_ONLY,
		// Anthropic ships no length parameter at all; its own docs say to ask for
		// the length you want in the prompt.
		verbosities: VERBOSITIES,
		verbosityMechanism: "prompt",
		modes: STANDARD_MODE_ONLY,
		defaultEffort: efforts.length > 0 ? "high" : null,
		fastModeNote: fast ? ANTHROPIC_FAST_NOTE : null,
	};
}

function moonshotCapabilities(providerModelId: string): ModelCapabilities {
	const k3 = providerModelId.includes("kimi-k3");
	return {
		// Kimi K3 documents low/high/max only, and defaults to max.
		efforts: k3 ? ["low", "high", "max"] : ["low", "medium", "high"],
		speeds: STANDARD_ONLY,
		verbosities: VERBOSITIES,
		verbosityMechanism: "prompt",
		modes: STANDARD_MODE_ONLY,
		defaultEffort: k3 ? "max" : null,
		fastModeNote: null,
	};
}

function openRouterCapabilities(): ModelCapabilities {
	return {
		// OpenRouter ids span every vendor. Only its live catalog knows which
		// levels a head takes, so a bare id advertises none and the catalog
		// overlays the real list (see modelCatalog.toDefinition).
		efforts: NO_EFFORTS,
		// Fast is a routing preference here, not a model capability: every model
		// can be sorted by throughput.
		speeds: STANDARD_AND_FAST,
		verbosities: VERBOSITIES,
		verbosityMechanism: "prompt",
		modes: STANDARD_MODE_ONLY,
		defaultEffort: null,
		fastModeNote: OPENROUTER_FAST_NOTE,
	};
}

/**
 * What a model accepts, from its provider and id alone. Verified 2026-09-02
 * against the installed SDK types and each vendor's model pages; the citations
 * live in the picker research notes.
 */
export function deriveCapabilities(
	provider: ProviderId,
	providerModelId: string,
): ModelCapabilities {
	switch (provider) {
		case "openai":
			return openAiCapabilities(providerModelId);
		case "anthropic":
			return anthropicCapabilities(providerModelId);
		case "moonshot":
			return moonshotCapabilities(providerModelId);
		case "openrouter":
			return openRouterCapabilities();
	}
}

/** Curated facts no endpoint reports: price, window, and a human line. */
interface CuratedMeta {
	tagline?: string;
	tier?: ModelTier;
	contextWindow?: number;
	pricing?: ModelPricing;
	/** Narrower than derivation, where the vendor documents a shorter list. */
	efforts?: readonly ReasoningEffort[];
}

/**
 * Keyed by namespaced id so it applies to live catalog rows too, not just the
 * MODELS entries below: OpenAI's and Anthropic's list endpoints report neither
 * price nor context window, so this is the only place those come from.
 */
const CURATED_META: Record<string, CuratedMeta> = {
	"openai/gpt-5.6-luna": {
		tagline: "Fastest and lowest cost",
		tier: "fast",
		contextWindow: 1_050_000,
		pricing: { input: 0.2, output: 1.2 },
	},
	"openai/gpt-5.6-terra": {
		tagline: "Balanced everyday study",
		tier: "balanced",
		contextWindow: 1_050_000,
		pricing: { input: 2, output: 12 },
	},
	"openai/gpt-5.6-sol": {
		tagline: "Deepest reasoning",
		tier: "flagship",
		contextWindow: 1_050_000,
		pricing: { input: 4, output: 20 },
	},
	"openai/gpt-5.5": {
		contextWindow: 1_050_000,
		pricing: { input: 5, output: 30 },
	},
	"openai/gpt-5.4-mini": {
		contextWindow: 400_000,
		pricing: { input: 0.75, output: 4.5 },
	},
	"openai/gpt-5.4-nano": {
		contextWindow: 400_000,
		pricing: { input: 0.2, output: 1.25 },
	},
	"anthropic/claude-opus-5": {
		tagline: "Most capable Claude",
		tier: "flagship",
		contextWindow: 1_000_000,
		pricing: { input: 5, output: 25 },
	},
	"anthropic/claude-sonnet-5": {
		tagline: "Fast, thoughtful Claude",
		tier: "balanced",
		contextWindow: 1_000_000,
		pricing: { input: 3, output: 15 },
	},
	"moonshot/kimi-k3": {
		tagline: "Open-weight reasoning",
		tier: "balanced",
		contextWindow: 1_048_576,
		pricing: { input: 3, output: 15 },
	},
	"openrouter/z-ai/glm-5.3-flash": {
		tagline: "Cheap and quick",
		tier: "fast",
		// OpenRouter's catalog reports these three for this head; the live row
		// overwrites them when the picker can reach it.
		efforts: ["low", "high", "max"],
	},
};

/**
 * A complete definition for one model: identity from the caller, capabilities
 * from the provider rules, curated facts where we have them. The single place
 * a `ModelDefinition` is constructed, so no code path can invent a model that
 * advertises an option the provider would reject.
 */
export function buildDefinition(options: {
	provider: ProviderId;
	providerModelId: string;
	label?: string;
	supportsAttachments?: boolean;
}): ModelDefinition {
	const id = `${options.provider}/${options.providerModelId}`;
	const meta = CURATED_META[id] ?? {};
	const capabilities = deriveCapabilities(options.provider, options.providerModelId);
	const efforts = meta.efforts ?? capabilities.efforts;
	return {
		id,
		label: options.label ?? prettyModelLabel(options.providerModelId),
		provider: options.provider,
		providerModelId: options.providerModelId,
		// Moonshot stays opted out of uploads until per-mime gating exists.
		supportsAttachments: options.supportsAttachments ?? options.provider !== "moonshot",
		...capabilities,
		efforts,
		defaultEffort:
			capabilities.defaultEffort && efforts.includes(capabilities.defaultEffort)
				? capabilities.defaultEffort
				: null,
		tagline: meta.tagline ?? null,
		tier: meta.tier ?? null,
		contextWindow: meta.contextWindow ?? null,
		pricing: meta.pricing ?? null,
	};
}

// Curated entries: nice labels and vetted capability flags for the models we
// feature. The picker and resolver are NOT limited to this list — any model a
// provider's live /models endpoint reports is usable; these entries just win
// on label/ordering when present, and serve as the fallback catalog when a
// provider's list endpoint is unreachable or the user hasn't unlocked it yet.
export const MODELS: readonly ModelDefinition[] = [
	buildDefinition({ provider: "openai", providerModelId: "gpt-5.6-luna", label: "GPT-5.6 Luna" }),
	buildDefinition({ provider: "openai", providerModelId: "gpt-5.6-sol", label: "GPT-5.6 Sol" }),
	buildDefinition({ provider: "openai", providerModelId: "gpt-5.6-terra", label: "GPT-5.6 Terra" }),
	buildDefinition({
		provider: "anthropic",
		providerModelId: "claude-opus-5",
		label: "Claude Opus 5",
	}),
	buildDefinition({
		provider: "anthropic",
		providerModelId: "claude-sonnet-5",
		label: "Claude Sonnet 5",
	}),
	buildDefinition({
		provider: "moonshot",
		providerModelId: "kimi-k3",
		label: "Kimi K3",
		// Kimi has vision but the attachment pipeline also carries PDFs and
		// other documents it does not accept; keep uploads on the providers
		// that handle every type until per-mime gating exists.
		supportsAttachments: false,
	}),
	buildDefinition({
		provider: "openrouter",
		providerModelId: "z-ai/glm-5.3-flash",
		label: "GLM 5.3 Flash",
		// OpenRouter advertises text/image/video input for this head. The
		// official adapter also carries PDFs and text files as file parts.
		supportsAttachments: true,
	}),
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
	return deriveCapabilities(provider, providerModelId).efforts.length > 0;
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
	// OpenRouter's live catalog overrides the derived attachment guess with the
	// model's advertised input modalities in every picker response.
	return buildDefinition({
		provider: parsed.provider,
		providerModelId: parsed.providerModelId,
	});
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function isSpeed(value: unknown): value is Speed {
	return typeof value === "string" && (SPEEDS as readonly string[]).includes(value);
}

export function isVerbosity(value: unknown): value is Verbosity {
	return typeof value === "string" && (VERBOSITIES as readonly string[]).includes(value);
}

export function isReasoningMode(value: unknown): value is ReasoningMode {
	return typeof value === "string" && (REASONING_MODES as readonly string[]).includes(value);
}

/**
 * One model as `GET /api/ai/models` sends it. Every client mirrors this shape
 * and must treat the fields added in the run-options release as optional, so
 * an older server keeps working: speeds defaults to ["standard"], verbosities
 * to [], modes to ["standard"], everything else to null.
 *
 * `verbosityMechanism` is deliberately absent. Whether length is a parameter
 * or a prompt sentence is the server's business; a client only needs to know
 * which values it may offer.
 */
export interface ModelPayload {
	id: string;
	label: string;
	provider: ProviderId;
	supportsAttachments: boolean;
	efforts: readonly ReasoningEffort[];
	available: boolean;
	speeds: readonly Speed[];
	verbosities: readonly Verbosity[];
	modes: readonly ReasoningMode[];
	defaultEffort: ReasoningEffort | null;
	tagline: string | null;
	tier: ModelTier | null;
	contextWindow: number | null;
	pricing: ModelPricing | null;
	fastModeNote: string | null;
}

/**
 * One turn's run options, after validation and before clamping. Every field is
 * nullable: null means "the user expressed nothing", which is not the same as
 * the default value, because a stored default may still fill it in.
 */
export interface RunOptions {
	effort: ReasoningEffort | null;
	speed: Speed | null;
	verbosity: Verbosity | null;
	mode: ReasoningMode | null;
}

/**
 * The definition to actually run a call on, given one resolved from an id and
 * the live catalog for its provider.
 *
 * This exists for OpenRouter. Its per-model reasoning levels, verbosity
 * parameter, price and context window live only in its `/models` response, so
 * a definition built from an id alone advertises no efforts and a prompt
 * verbosity mechanism. Without this, a chip the picker rendered from live data
 * would be clamped away at request time and the choice would silently do
 * nothing.
 *
 * Identity stays with the caller's definition; only the capability facts are
 * refreshed. A model the live list does not carry (a stale stored id, or a
 * catalog fetch that fell back to the curated snapshot) keeps what it had.
 *
 * It lives here rather than beside the catalog so `node:test` can cover it
 * without a network: modelCatalog.ts is not directly importable there.
 */
export function overlayLiveDefinition(
	base: ModelDefinition,
	catalog: readonly ModelDefinition[],
): ModelDefinition {
	const live = catalog.find((entry) => entry.id === base.id);
	if (!live) return base;
	return {
		...live,
		id: base.id,
		provider: base.provider,
		providerModelId: base.providerModelId,
	};
}

/**
 * Which effort a turn prefers, before it is clamped to the model's own list.
 *
 * `explicitAuto` is the whole point of this helper. A request body carrying
 * `effort: null` is the user tapping **Auto**, which must not be overruled by
 * the value Auto just replaced; a body with no `effort` key at all (Apple omits
 * nil) still means "no opinion", so the stored default stands. Without the
 * distinction, choosing Auto after High silently kept running High.
 *
 * The caller's fallback still applies either way: Auto means "let the app
 * decide", not "send no effort".
 */
export function resolveEffortPreference(options: {
	requested: ReasoningEffort | null;
	explicitAuto: boolean;
	stored: ReasoningEffort | null;
	fallback: ReasoningEffort;
}): ReasoningEffort {
	if (options.requested) return options.requested;
	const stored = options.explicitAuto ? null : options.stored;
	return stored ?? options.fallback;
}

/** Nothing asked for. Every non-chat call site runs on this. */
export const NO_RUN_OPTIONS: RunOptions = {
	effort: null,
	speed: null,
	verbosity: null,
	mode: null,
};

/**
 * What to append to the system prompt on models with no length parameter.
 * Medium is every provider's own default, so it says nothing.
 */
const VERBOSITY_PROMPT_HINTS: Record<Verbosity, string | null> = {
	low: "Answer length: keep this response brief. Give the essentials only, a few short paragraphs at most, with no padding.",
	medium: null,
	high: "Answer length: give a thorough, fully developed response. Explore the context, cross-references and application in depth.",
};

/** Prompt sentences that carry a length choice a provider cannot take as a parameter. */
export function verbosityPromptHints(
	definition: ModelDefinition,
	verbosity: Verbosity | null,
): string[] {
	if (!verbosity) return [];
	if (definition.verbosityMechanism !== "prompt") return [];
	if (!definition.verbosities.includes(verbosity)) return [];
	const hint = VERBOSITY_PROMPT_HINTS[verbosity];
	return hint ? [hint] : [];
}

/**
 * The `providerOptions` bag for one call.
 *
 * Every option is gated on the definition first: an effort a model does not
 * list, a fast tier it does not sell, a verbosity parameter it does not take
 * are all hard provider errors or silent no-ops, so none of them is ever
 * emitted. `definition` must describe the model actually being built, which is
 * not always the model the user picked (utility work runs on a cheap sibling).
 */
export function buildProviderOptions(
	provider: ProviderId,
	run: RunOptions,
	attachments: boolean,
	definition: ModelDefinition,
): Record<string, Record<string, JSONValue>> {
	const effort = run.effort && definition.efforts.includes(run.effort) ? run.effort : null;
	const fast = run.speed === "fast" && definition.speeds.includes("fast");
	const pro = run.mode === "pro" && definition.modes.includes("pro");
	const nativeVerbosity =
		run.verbosity &&
		definition.verbosityMechanism === "native" &&
		definition.verbosities.includes(run.verbosity)
			? run.verbosity
			: null;

	switch (provider) {
		case "openai": {
			const options: Record<string, JSONValue> = {};
			if (effort) options.reasoningEffort = effort;
			if (nativeVerbosity) options.textVerbosity = nativeVerbosity;
			if (fast) options.serviceTier = "fast";
			if (pro) options.reasoningMode = "pro";
			// The SDK defaults reasoningSummary to "detailed" whenever an effort is
			// set, and no SureWord client renders reasoning parts, so every summary
			// we do not ask for is output tokens paid for nothing. Explicit null is
			// the only way to turn it off.
			options.reasoningSummary = null;
			if (attachments) options.passThroughUnsupportedFiles = true;
			return { openai: options };
		}
		case "anthropic": {
			const options: Record<string, JSONValue> = {};
			if (effort) options.effort = effort;
			if (fast) options.speed = "fast";
			// Anthropic has no verbosity parameter; length travels as a prompt hint.
			return { anthropic: options };
		}
		case "moonshot": {
			const options: Record<string, JSONValue> = {};
			if (effort) options.reasoningEffort = effort;
			if (nativeVerbosity) options.textVerbosity = nativeVerbosity;
			return { moonshot: options };
		}
		case "openrouter": {
			const options: Record<string, JSONValue> = {};
			if (effort) options.reasoning = { effort };
			if (nativeVerbosity) options.verbosity = nativeVerbosity;
			// Fast here is a routing preference, not a premium tier: OpenRouter
			// picks the highest-throughput endpoint for the same model.
			if (fast) options.provider = { sort: "throughput" };
			return { openrouter: options };
		}
	}
}

/** Definition to wire entry. Pure, so the picker payload has a unit test. */
export function toModelPayload(definition: ModelDefinition, available = true): ModelPayload {
	return {
		id: definition.id,
		label: definition.label,
		provider: definition.provider,
		supportsAttachments: definition.supportsAttachments,
		efforts: definition.efforts,
		available,
		speeds: definition.speeds,
		verbosities: definition.verbosities,
		modes: definition.modes,
		defaultEffort: definition.defaultEffort,
		tagline: definition.tagline,
		tier: definition.tier,
		contextWindow: definition.contextWindow,
		pricing: definition.pricing,
		fastModeNote: definition.fastModeNote,
	};
}
