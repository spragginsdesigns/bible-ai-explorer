import { openai } from "@ai-sdk/openai";
import type { JSONValue, LanguageModel } from "ai";
import { DEFAULT_MODEL_ID, getModel, type ReasoningEffort } from "./models";

export interface ResolvedModel {
	model: LanguageModel;
	providerOptions: Record<string, Record<string, JSONValue>>;
}

/**
 * Single place every AI call site gets its model from. Model choice and
 * credentials are resolved here so adding a provider (or per-user keys)
 * never touches the routes.
 */
export function resolveModel(options: {
	modelId?: string;
	effort: ReasoningEffort;
	/** Chat sends user files; unsupported mime types must pass through to the model rather than fail validation. */
	attachments?: boolean;
}): ResolvedModel {
	const definition = getModel(options.modelId ?? DEFAULT_MODEL_ID) ?? getModel(DEFAULT_MODEL_ID);
	if (!definition) throw new Error("No default AI model is registered.");

	switch (definition.provider) {
		case "openai": {
			const openaiOptions: Record<string, JSONValue> = {
				reasoningEffort: options.effort,
			};
			if (options.attachments) openaiOptions.passThroughUnsupportedFiles = true;
			return {
				model: openai(definition.providerModelId),
				providerOptions: { openai: openaiOptions },
			};
		}
		default:
			throw new Error(`Provider "${definition.provider}" is not wired up yet.`);
	}
}
