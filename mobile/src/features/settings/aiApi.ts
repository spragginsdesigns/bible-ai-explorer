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
	efforts: string[];
	available: boolean;
}

export interface AiProviderSummary {
	id: string;
	label: string;
	available: boolean;
}

export interface AiModelsResponse {
	/** Absent from pre-1.12 servers; clients derive rows from `models` then. */
	providers?: AiProviderSummary[];
	models: AiModel[];
	defaults: { modelId: string; effort: string | null };
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
