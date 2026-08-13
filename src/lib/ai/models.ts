export type ProviderId = "openai" | "anthropic" | "moonshot";

export type ReasoningEffort = "low" | "medium" | "high";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	/** Where the user creates an API key, shown in Settings. */
	keyUrl: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
	{ id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys" },
	{ id: "anthropic", label: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys" },
	{ id: "moonshot", label: "Moonshot (Kimi)", keyUrl: "https://platform.moonshot.ai/console/api-keys" },
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
];

export const DEFAULT_MODEL_ID = "openai/gpt-5.6-terra";

/**
 * Cheap sibling used for background work (memory extraction, summaries) so
 * those bills follow the same credentials as the user's chat model. Anthropic's
 * utility model takes no effort option: Haiku 4.5 rejects it.
 */
export const UTILITY_MODELS: Record<ProviderId, { providerModelId: string; effort: ReasoningEffort | null }> = {
	openai: { providerModelId: "gpt-5.6-terra", effort: "low" },
	anthropic: { providerModelId: "claude-haiku-4-5", effort: null },
	moonshot: { providerModelId: "kimi-k3", effort: "low" },
};

export function getModel(modelId: string): ModelDefinition | undefined {
	return MODELS.find((model) => model.id === modelId);
}

export function isProviderId(value: unknown): value is ProviderId {
	return typeof value === "string" && PROVIDERS.some((provider) => provider.id === value);
}

/** Provider model names are opaque but must stay sane enough to send upstream. */
const PROVIDER_MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;

export function parseModelId(
	modelId: string,
): { provider: ProviderId; providerModelId: string } | null {
	const slash = modelId.indexOf("/");
	if (slash <= 0) return null;
	const provider = modelId.slice(0, slash);
	const providerModelId = modelId.slice(slash + 1);
	if (!isProviderId(provider) || !PROVIDER_MODEL_ID_PATTERN.test(providerModelId)) return null;
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
		supportsAttachments: parsed.provider !== "moonshot",
		efforts: modelSupportsEffort(parsed.provider, parsed.providerModelId)
			? REASONING_EFFORTS
			: [],
	};
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}
