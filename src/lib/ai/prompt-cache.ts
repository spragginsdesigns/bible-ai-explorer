import type { Instructions, JSONValue, SystemModelMessage } from "ai";

type ProviderOptions = Record<string, Record<string, JSONValue>>;

type PromptCacheProvider = "openai" | "anthropic" | "moonshot" | "openrouter";

export interface PromptCachePlan {
	system: Instructions;
	providerOptions: ProviderOptions;
	mode: "explicit" | "automatic" | "none";
}

export interface PromptCachePlanOptions {
	provider: PromptCacheProvider;
	modelId: string;
	stableSystem: string;
	volatileSystem?: string;
	providerOptions: ProviderOptions;
	cacheKey: string;
}

function supportsOpenAiExplicitCache(modelId: string): boolean {
	const gpt5 = /^gpt-5\.(\d+)(?:-|$)/.exec(modelId);
	if (gpt5) return Number(gpt5[1]) >= 6;
	return /^gpt-6(?:\.\d+)?(?:-|$)/.test(modelId);
}

function withBreakpoint(
	provider: PromptCacheProvider,
	content: string,
	): SystemModelMessage {
	if (provider === "anthropic") {
		return {
			role: "system",
			content,
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		};
	}

	return {
		role: "system",
		content,
		providerOptions: {
			openai: { promptCacheBreakpoint: { mode: "explicit" } },
		},
	};
}

function appendSystemText(stableSystem: string, volatileSystem: string | undefined): string {
	return `${stableSystem}${volatileSystem ?? ""}`;
}

/**
 * Keep reusable instructions separate from request-specific context where the
 * provider supports explicit cache boundaries. Other providers receive the
 * exact same concatenated system text they received before this helper.
 */
export function buildPromptCachePlan(options: PromptCachePlanOptions): PromptCachePlan {
	const volatileSystem = options.volatileSystem ?? "";

	if (options.stableSystem.length > 0 && options.provider === "anthropic") {
		const stable = withBreakpoint("anthropic", options.stableSystem);
		return {
			system: volatileSystem
				? [stable, { role: "system", content: volatileSystem }]
				: stable,
			providerOptions: options.providerOptions,
			mode: "explicit",
		};
	}

	if (
		options.stableSystem.length > 0 &&
		options.provider === "openai" &&
		supportsOpenAiExplicitCache(options.modelId)
	) {
		const stable = withBreakpoint("openai", options.stableSystem);
		const existingOpenAi = options.providerOptions.openai ?? {};
		return {
			system: volatileSystem
				? [stable, { role: "system", content: volatileSystem }]
				: stable,
			providerOptions: {
				...options.providerOptions,
				openai: {
					...existingOpenAi,
					promptCacheKey: options.cacheKey,
					// No promptCacheOptions.mode: "explicit" there would suppress
					// OpenAI's implicit breakpoint at the end of the prompt, so
					// history and earlier tool steps would stop being cached.
				},
			},
			mode: "explicit",
		};
	}

	return {
		system: appendSystemText(options.stableSystem, options.volatileSystem),
		providerOptions: options.providerOptions,
		mode: options.provider === "openai" ? "automatic" : "none",
	};
}

/** Split a full prompt without changing its original concatenated text. */
export function splitStableSystemPrefix(
	fullSystem: string,
	stablePrefix: string,
): { stableSystem: string; volatileSystem: string } {
	if (!fullSystem.startsWith(stablePrefix)) {
		return { stableSystem: "", volatileSystem: fullSystem };
	}
	return {
		stableSystem: stablePrefix,
		volatileSystem: fullSystem.slice(stablePrefix.length),
	};
}
