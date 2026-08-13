import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiProvider } from "@prisma/client";
import type { JSONValue, LanguageModel } from "ai";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "./crypto";
import {
	DEFAULT_MODEL_ID,
	isReasoningEffort,
	resolveDefinition,
	UTILITY_MODELS,
	type ModelDefinition,
	type ProviderId,
	type ReasoningEffort,
} from "./models";

const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";

export const DB_PROVIDER: Record<ProviderId, AiProvider> = {
	openai: "OPENAI",
	anthropic: "ANTHROPIC",
	moonshot: "MOONSHOT",
};

/** Thrown when the user picked a model they have no working credentials for. */
export class AiCredentialError extends Error {
	constructor(public provider: ProviderId, public providerLabel: string) {
		super(`Add your ${providerLabel} API key in Settings → AI Providers to use this model.`);
		this.name = "AiCredentialError";
	}
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	moonshot: "Moonshot",
};

function serverKeyFor(provider: ProviderId): string | undefined {
	switch (provider) {
		case "openai":
			return process.env.OPENAI_API_KEY;
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY;
		case "moonshot":
			return process.env.MOONSHOT_API_KEY;
	}
}

/**
 * Only allowlisted accounts (Austin's) may run on the server's own API keys.
 * Everyone else brings their own key — the app never foots their LLM bill.
 */
export function isServerCredentialUser(userId: string): boolean {
	return (process.env.SERVER_CREDENTIAL_USER_IDS ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean)
		.includes(userId);
}

async function userKeyFor(userId: string, provider: ProviderId): Promise<string | null> {
	const credential = await prisma.providerCredential.findUnique({
		where: { userId_provider: { userId, provider: DB_PROVIDER[provider] } },
		select: { encryptedKey: true },
	});
	return credential ? decryptSecret(credential.encryptedKey) : null;
}

async function apiKeyFor(userId: string, provider: ProviderId): Promise<string> {
	const userKey = await userKeyFor(userId, provider);
	if (userKey) return userKey;
	if (isServerCredentialUser(userId)) {
		const serverKey = serverKeyFor(provider);
		if (serverKey) return serverKey;
	}
	throw new AiCredentialError(provider, PROVIDER_LABELS[provider]);
}

/** Non-throwing variant for callers that degrade gracefully (model listing). */
export async function apiKeyOrNull(userId: string, provider: ProviderId): Promise<string | null> {
	try {
		return await apiKeyFor(userId, provider);
	} catch {
		return null;
	}
}

function buildModel(provider: ProviderId, providerModelId: string, apiKey: string): LanguageModel {
	switch (provider) {
		case "openai":
			return createOpenAI({ apiKey })(providerModelId);
		case "anthropic":
			return createAnthropic({ apiKey })(providerModelId);
		case "moonshot":
			return createOpenAICompatible({ name: "moonshot", baseURL: MOONSHOT_BASE_URL, apiKey })(providerModelId);
	}
}

function buildProviderOptions(
	provider: ProviderId,
	effort: ReasoningEffort | null,
	attachments: boolean,
): Record<string, Record<string, JSONValue>> {
	switch (provider) {
		case "openai": {
			const options: Record<string, JSONValue> = {};
			if (effort) options.reasoningEffort = effort;
			if (attachments) options.passThroughUnsupportedFiles = true;
			return { openai: options };
		}
		case "anthropic":
			return { anthropic: effort ? { effort } : {} };
		case "moonshot":
			return { moonshot: effort ? { reasoningEffort: effort } : {} };
	}
}

export interface ResolvedModel {
	model: LanguageModel;
	providerOptions: Record<string, Record<string, JSONValue>>;
	definition: ModelDefinition;
	effort: ReasoningEffort | null;
}

/**
 * Single place every AI call site gets its model from. Resolution order for
 * the model and effort: explicit request value → the user's stored default →
 * the app default. Credentials: the user's own key for that provider, then
 * the server's key when the account is allowlisted, else AiCredentialError.
 */
export async function resolveModel(options: {
	userId: string;
	modelId?: string | null;
	effort?: ReasoningEffort | null;
	/** Effort used when neither the request nor the user's settings pick one. */
	fallbackEffort?: ReasoningEffort;
	/** Chat sends user files; unsupported mime types must pass through to the model rather than fail validation. */
	attachments?: boolean;
	/** Background work (memory extraction, summaries): use the provider's cheap sibling model. */
	utility?: boolean;
}): Promise<ResolvedModel> {
	const user = await prisma.user.findUnique({
		where: { id: options.userId },
		select: { defaultModelId: true, defaultEffort: true },
	});

	const definition =
		(options.modelId ? resolveDefinition(options.modelId) : undefined) ??
		(user?.defaultModelId ? resolveDefinition(user.defaultModelId) : undefined) ??
		resolveDefinition(DEFAULT_MODEL_ID);
	if (!definition) throw new Error("No default AI model is registered.");

	const apiKey = await apiKeyFor(options.userId, definition.provider);

	if (options.utility) {
		const utility = UTILITY_MODELS[definition.provider];
		return {
			model: buildModel(definition.provider, utility.providerModelId, apiKey),
			providerOptions: buildProviderOptions(definition.provider, utility.effort, false),
			definition,
			effort: utility.effort,
		};
	}

	const storedEffort = isReasoningEffort(user?.defaultEffort) ? user.defaultEffort : null;
	const requestedEffort = isReasoningEffort(options.effort) ? options.effort : null;
	const preferredEffort = requestedEffort ?? storedEffort ?? options.fallbackEffort ?? "medium";
	// Models that reject the reasoning parameter (Haiku, non-reasoning OpenAI
	// heads) advertise no efforts; sending one anyway is a hard API error.
	const effort = definition.efforts.includes(preferredEffort) ? preferredEffort : null;

	return {
		model: buildModel(definition.provider, definition.providerModelId, apiKey),
		providerOptions: buildProviderOptions(
			definition.provider,
			effort,
			Boolean(options.attachments) && definition.supportsAttachments,
		),
		definition,
		effort,
	};
}

/** Which providers this user can currently use, and through which credential. */
export async function availableProviders(
	userId: string,
): Promise<Record<ProviderId, { available: boolean; source: "user-key" | "server" | null }>> {
	const credentials = await prisma.providerCredential.findMany({
		where: { userId },
		select: { provider: true },
	});
	const owned = new Set(credentials.map((credential) => credential.provider));
	const allowlisted = isServerCredentialUser(userId);

	const result = {} as Record<ProviderId, { available: boolean; source: "user-key" | "server" | null }>;
	for (const provider of Object.keys(DB_PROVIDER) as ProviderId[]) {
		if (owned.has(DB_PROVIDER[provider])) {
			result[provider] = { available: true, source: "user-key" };
		} else if (allowlisted && serverKeyFor(provider)) {
			result[provider] = { available: true, source: "server" };
		} else {
			result[provider] = { available: false, source: null };
		}
	}
	return result;
}
