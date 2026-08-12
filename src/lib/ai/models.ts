export type ProviderId = "openai" | "anthropic" | "moonshot";

export type ReasoningEffort = "low" | "medium" | "high";

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
];

export const DEFAULT_MODEL_ID = "openai/gpt-5.6-terra";

export function getModel(modelId: string): ModelDefinition | undefined {
	return MODELS.find((model) => model.id === modelId);
}
