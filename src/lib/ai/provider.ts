import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiProvider } from "@prisma/client";
import type { JSONValue, LanguageModel } from "ai";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "./crypto";
import {
	ATTACHMENT_CAPABLE_MODEL_IDS,
	decideStructuredProvider,
	DEFAULT_MODEL_ID,
	isReasoningEffort,
	providerSupportsStructuredOutput,
	resolveDefinition,
	STRUCTURED_FALLBACK_PROVIDER_IDS,
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
	openrouter: "OPENROUTER",
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
	openrouter: "OpenRouter",
};

function serverKeyFor(provider: ProviderId): string | undefined {
	switch (provider) {
		case "openai":
			return process.env.OPENAI_API_KEY;
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY;
		case "moonshot":
			return process.env.MOONSHOT_API_KEY;
		case "openrouter":
			return process.env.OPENROUTER_API_KEY;
	}
}

/**
 * Only allowlisted accounts (Austin's) may run on the server's own API keys.
 * Everyone else brings their own key — the app never foots their LLM bill.
 */
export function isServerCredentialUser(userId: string): boolean {
	return parseUserIdAllowlist(process.env.SERVER_CREDENTIAL_USER_IDS).includes(userId);
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

/**
 * `structured` marks a call that sends a JSON schema (`Output.object`).
 *
 * It only changes Moonshot, and it is the whole fix for the daily cross
 * silently falling back to John 3:16 on Kimi: `@ai-sdk/openai-compatible`
 * downgrades `response_format` to `{ type: "json_object" }` and throws the
 * schema away unless the provider is built with `supportsStructuredOutputs`,
 * so the model answered with keys of its own invention and Zod rejected it.
 * With the flag the SDK sends the `json_schema` block Kimi K3 documents.
 *
 * It stays off for chat, which carries no `response_format` schema and may run
 * on any model the user's Moonshot account lists - including older heads that
 * predate structured output.
 */
function buildModel(
	provider: ProviderId,
	providerModelId: string,
	apiKey: string,
	structured = false,
): LanguageModel {
	switch (provider) {
		case "openai":
			return createOpenAI({ apiKey })(providerModelId);
		case "anthropic":
			return createAnthropic({ apiKey })(providerModelId);
		case "moonshot":
			return createOpenAICompatible({
				name: "moonshot",
				baseURL: MOONSHOT_BASE_URL,
				apiKey,
				supportsStructuredOutputs: structured,
			})(providerModelId);
		case "openrouter":
			// This is the same official adapter used by Learnest. It preserves
			// OpenRouter's unified reasoning options, tools, file parts and JSON
			// schemas while attributing traffic to SureWord.
			return createOpenRouter({
				apiKey,
				appName: "SureWord",
				appUrl: "https://sureword.app",
			})(providerModelId);
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
		case "openrouter":
			return effort ? { openrouter: { reasoning: { effort } } } : {};
	}
}

export interface ResolvedModel {
	model: LanguageModel;
	providerOptions: Record<string, Record<string, JSONValue>>;
	definition: ModelDefinition;
	effort: ReasoningEffort | null;
	/**
	 * The model the user actually picked, when it could not read the request's
	 * attachments and this call ran on a capable one instead. Null otherwise.
	 */
	attachmentFallbackFrom: ModelDefinition | null;
	/**
	 * True when the request carries attachments and the model running it still
	 * cannot read them - no capable provider is unlocked for this user. Callers
	 * must strip file parts rather than let the provider reject the request.
	 */
	attachmentsUnsupported: boolean;
	/**
	 * The model the user actually picked, when it could not honour a JSON schema
	 * and this structured call ran on a capable provider's utility model
	 * instead. Null otherwise.
	 */
	structuredFallbackFrom: ModelDefinition | null;
	/**
	 * True when a structured call is running on a provider that will ignore the
	 * schema, because the user has credentials for nothing better. The answer
	 * may fail to parse; callers already treat that as a soft failure.
	 */
	structuredOutputUnsupported: boolean;
}

/** First attachment-capable model this user holds working credentials for. */
async function firstAttachmentCapableModel(userId: string): Promise<ModelDefinition | null> {
	for (const modelId of ATTACHMENT_CAPABLE_MODEL_IDS) {
		const candidate = resolveDefinition(modelId);
		if (!candidate?.supportsAttachments) continue;
		if (await apiKeyOrNull(userId, candidate.provider)) return candidate;
	}
	return null;
}

/** Providers this user can currently reach, by their own key or a server key. */
async function credentialedProviders(userId: string): Promise<ProviderId[]> {
	const reachable = await Promise.all(
		STRUCTURED_FALLBACK_PROVIDER_IDS.map(async (provider) =>
			(await apiKeyOrNull(userId, provider)) ? provider : null
		)
	);
	return reachable.filter((provider): provider is ProviderId => provider !== null);
}

/** The cheap sibling this provider runs background work on, as a definition. */
function utilityDefinition(provider: ProviderId): ModelDefinition {
	const definition = resolveDefinition(`${provider}/${UTILITY_MODELS[provider].providerModelId}`);
	if (!definition) throw new Error(`No utility model is registered for ${provider}.`);
	return definition;
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
	/** This request actually carries files: swap to a capable model rather than let the provider reject it. */
	requireAttachments?: boolean;
	/** Background work (memory extraction, summaries): use the provider's cheap sibling model. */
	utility?: boolean;
	/**
	 * This call sends a JSON schema (`Output.object`). Defaults to true for
	 * utility work, because every utility caller today parses a schema.
	 */
	structured?: boolean;
}): Promise<ResolvedModel> {
	const user = await prisma.user.findUnique({
		where: { id: options.userId },
		select: { defaultModelId: true, defaultEffort: true },
	});

	const picked =
		(options.modelId ? resolveDefinition(options.modelId) : undefined) ??
		(user?.defaultModelId ? resolveDefinition(user.defaultModelId) : undefined) ??
		resolveDefinition(DEFAULT_MODEL_ID);
	if (!picked) throw new Error("No default AI model is registered.");

	// A file part sent to a model that cannot take one is a hard provider 400
	// that kills the answer (Moonshot: "invalid part type: file"). Run the
	// message on a capable model instead, and tell the caller so it can say so.
	let definition = picked;
	let attachmentFallbackFrom: ModelDefinition | null = null;
	let attachmentsUnsupported = false;
	if (options.requireAttachments && !picked.supportsAttachments && !options.utility) {
		const capable = await firstAttachmentCapableModel(options.userId);
		if (capable) {
			definition = capable;
			attachmentFallbackFrom = picked;
		} else {
			attachmentsUnsupported = true;
		}
	}

	const structured = options.structured ?? Boolean(options.utility);

	if (options.utility) {
		// A provider that ignores the schema does not fail loudly: it returns
		// well-formed JSON under keys it made up, and Zod rejects it after the
		// tokens are paid for. Move the call somewhere capable when we can.
		const decision = decideStructuredProvider({
			provider: definition.provider,
			availableProviders:
				structured && !providerSupportsStructuredOutput(definition.provider)
					? await credentialedProviders(options.userId)
					: [],
			structured,
		});

		if (decision.unsupported) {
			console.warn(
				`[ai] ${definition.provider} ignores JSON schemas and no capable provider is unlocked for user ${options.userId}; this structured call may return unparseable output.`
			);
		}

		const utilityModel = decision.fallbackFrom
			? utilityDefinition(decision.provider)
			: definition;
		const utility = UTILITY_MODELS[decision.provider];
		const utilityKey = await apiKeyFor(options.userId, decision.provider);

		return {
			model: buildModel(decision.provider, utility.providerModelId, utilityKey, structured),
			providerOptions: buildProviderOptions(decision.provider, utility.effort, false),
			definition: utilityModel,
			effort: utility.effort,
			attachmentFallbackFrom: null,
			attachmentsUnsupported: false,
			structuredFallbackFrom: decision.fallbackFrom ? definition : null,
			structuredOutputUnsupported: decision.unsupported,
		};
	}

	const apiKey = await apiKeyFor(options.userId, definition.provider);

	const storedEffort = isReasoningEffort(user?.defaultEffort) ? user.defaultEffort : null;
	const requestedEffort = isReasoningEffort(options.effort) ? options.effort : null;
	const preferredEffort = requestedEffort ?? storedEffort ?? options.fallbackEffort ?? "medium";
	// Models that reject the reasoning parameter (Haiku, non-reasoning OpenAI
	// heads) advertise no efforts; sending one anyway is a hard API error.
	const effort = definition.efforts.includes(preferredEffort) ? preferredEffort : null;

	return {
		model: buildModel(definition.provider, definition.providerModelId, apiKey, structured),
		providerOptions: buildProviderOptions(
			definition.provider,
			effort,
			Boolean(options.attachments) && definition.supportsAttachments,
		),
		definition,
		effort,
		attachmentFallbackFrom,
		attachmentsUnsupported,
		structuredFallbackFrom: null,
		structuredOutputUnsupported: false,
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
