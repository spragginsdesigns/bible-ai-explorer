import type { LanguageModel } from "ai";
import type { ResolvedModel } from "./provider";
import { buildProviderOptions, NO_RUN_OPTIONS, resolveDefinition, type ProviderId } from "./models";

/** Audit the actual SDK head; do not reinterpret a utility job as foreground chat. */
export function checkedStructuredProseModel(resolved: ResolvedModel, utility: boolean) {
	if (typeof resolved.model === "string") throw new Error("A concrete resolved model is required.");
	const actual = resolved.model as Exclude<LanguageModel, string>;
	const provider = (["openrouter", "openai", "anthropic", "moonshot"] as ProviderId[]).find(name => actual.provider === name || actual.provider.startsWith(name + "."));
	if (!provider || !actual.modelId) throw new Error("The runtime model head could not be identified.");
	const definition = utility ? resolveDefinition(provider + "/" + actual.modelId) : resolved.definition;
	if (!definition || definition.provider !== provider || definition.providerModelId !== actual.modelId || !definition.pricing || !Number.isFinite(definition.pricing.input) || !Number.isFinite(definition.pricing.output) || definition.pricing.input < 0 || definition.pricing.output < 0) throw new Error("The runtime model lacks matching explicit pricing.");
	// Existing included utility resolution meters at this fallback price.
	// Preserve that meter and refuse drift rather than double-metering it or
	// silently adopting HOUSE_CHAT_MODEL_ID / a changed HOUSE_MODEL_ID.
	if (utility && resolved.access === "house" && (definition.pricing.input !== 0.2 || definition.pricing.output !== 1.2)) throw new Error("Included utility metering no longer matches the actual head.");
	return {
		...resolved, definition,
		providerOptions: utility ? buildProviderOptions(provider, { ...NO_RUN_OPTIONS, effort: resolved.effort }, false, definition) : resolved.providerOptions,
		// Reuse this exact already-metered object for generation and checking:
		// no second resolver, utility ledger or included-message reservation.
		model: actual,
	};
}
