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

// Only models the resolver can actually serve belong here; entries for
// providers without wired credentials would surface in pickers as options
// that fail at request time.
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

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}
