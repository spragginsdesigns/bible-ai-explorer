import { apiJson, type GetToken } from "@/lib/api";

/**
 * AI model picker + provider-key (BYOK) endpoints. The server is the single
 * source of truth for which models this account has unlocked — the same
 * /api/ai/models payload drives the web and macOS pickers.
 */

export interface AiModel {
	id: string;
	label: string;
	provider: string;
	supportsAttachments: boolean;
	/** Reasoning efforts this model offers, lowest to highest. */
	efforts: string[];
	available: boolean;
	/**
	 * Everything below is additive: a server older than the run-options release
	 * omits it, so every field is optional and the picker falls back to the
	 * conservative default (one speed, no verbosities, one mode, no metadata).
	 * See modelPickerRules for those defaults.
	 */
	speeds?: string[];
	verbosities?: string[];
	modes?: string[];
	/** What the provider runs when no effort is sent, when the server knows. */
	defaultEffort?: string | null;
	/** One curated line for the model row; null means derive from the numbers. */
	tagline?: string | null;
	tier?: string | null;
	/** Context window in tokens. */
	contextWindow?: number | null;
	/** USD per 1M tokens. */
	pricing?: { input: number; output: number } | null;
	/** Caveat shown beside the Fast chip. */
	fastModeNote?: string | null;
}

export interface AiProviderSummary {
	id: string;
	label: string;
	available: boolean;
}

/**
 * "house" = the account has no provider key of its own, so SureWord runs it on
 * the house model and there is nothing to pick. "keys" = the account unlocked
 * at least one provider and chooses among its own models.
 */
export type AiAccess = "house" | "keys";

/** The single included model, sent only when `access` is "house". */
export interface AiHouseMode {
	modelId: string;
	label: string;
	/** Pinned by the server; the client stores it so requests agree. */
	effort: string;
	note: string;
}

export interface AiModelsResponse {
	/** Absent from servers older than the house-mode release; treat as "keys". */
	access?: AiAccess;
	/** Only providers this account unlocked. Empty in house mode. */
	providers?: AiProviderSummary[];
	/** Only models this account can run. Exactly one entry in house mode. */
	models: AiModel[];
	/**
	 * The account's stored defaults. Only `modelId` and `effort` come from every
	 * server; the rest arrive with the run-options release.
	 */
	defaults: {
		modelId: string;
		effort: string | null;
		speed?: string | null;
		verbosity?: string | null;
		mode?: string | null;
	};
	house?: AiHouseMode | null;
}

export interface ProviderStatus {
	id: string;
	label: string;
	keyUrl: string;
	connected: boolean;
	last4: string | null;
	validatedAt: string | null;
}

export interface ProvidersResponse {
	serverCredentials: boolean;
	providers: ProviderStatus[];
}

export const PROVIDER_LABELS: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	moonshot: "Moonshot",
	openrouter: "OpenRouter",
};

export function fetchAiModels(getToken: GetToken) {
	return apiJson<AiModelsResponse>(getToken, "/api/ai/models");
}

export function fetchProviders(getToken: GetToken) {
	return apiJson<ProvidersResponse>(getToken, "/api/providers");
}

/** Validates against the provider before storing; rejects bad keys with a message. */
export function saveProviderKey(getToken: GetToken, provider: string, apiKey: string) {
	return apiJson<{ ok: boolean; last4: string }>(getToken, "/api/providers", {
		method: "POST",
		body: { provider, apiKey },
	});
}

export function removeProviderKey(getToken: GetToken, provider: string) {
	return apiJson<{ ok: boolean }>(getToken, "/api/providers", {
		method: "DELETE",
		body: { provider },
	});
}
