import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiProvider } from "@prisma/client";
import type { JSONValue, LanguageModel } from "ai";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "./crypto";
import { decideAccess, houseEffortFor, type AiAccess } from "./access";
import { listProviderModels } from "./modelCatalog";
import {
	ATTACHMENT_CAPABLE_MODEL_IDS,
	buildProviderOptions,
	decideStructuredProvider,
	DEFAULT_MODEL_ID,
	HOUSE_EFFORT,
	HOUSE_MODEL_ID,
	isReasoningEffort,
	isReasoningMode,
	isSpeed,
	isVerbosity,
	NO_RUN_OPTIONS,
	overlayLiveDefinition,
	providerSupportsStructuredOutput,
	resolveDefinition,
	resolveEffortPreference,
	STRUCTURED_FALLBACK_PROVIDER_IDS,
	UTILITY_MODELS,
	verbosityPromptHints,
	type ModelDefinition,
	type ProviderId,
	type ReasoningEffort,
	type ReasoningMode,
	type Speed,
	type Verbosity,
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

/**
 * Thrown when a keyless account asks a question and the server has no OpenAI
 * key of its own to answer it with. It extends AiCredentialError so
 * `codeForError` still classifies it as `provider_key_missing`, but the message
 * must not tell the user to add a key: nothing they can do in Settings fixes a
 * missing server-side env var.
 */
export class HouseModelUnavailableError extends AiCredentialError {
	constructor() {
		super("openai", PROVIDER_LABELS.openai);
		this.name = "HouseModelUnavailableError";
		this.message = "SureWord's built-in model is not configured on this server.";
	}
}

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

/**
 * Whether this account runs on SureWord's own key (house) or on credentials of
 * its own (keys). One count answers it: owning any key at all, or being
 * allowlisted, means the user picks their models and pays their own bills.
 */
export async function aiAccessFor(userId: string): Promise<AiAccess> {
	const allowlisted = isServerCredentialUser(userId);
	const ownKeyCount = await prisma.providerCredential.count({ where: { userId } });
	return decideAccess({ allowlisted, ownKeyCount });
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

export interface ResolvedModel {
	model: LanguageModel;
	providerOptions: Record<string, Record<string, JSONValue>>;
	definition: ModelDefinition;
	effort: ReasoningEffort | null;
	/** Applied run options, after clamping to what this model accepts. */
	speed: Speed | null;
	verbosity: Verbosity | null;
	mode: ReasoningMode | null;
	/**
	 * Sentences the caller must append to its system prompt, for choices this
	 * provider cannot take as a parameter (every non-OpenAI verbosity today).
	 * Empty for utility work and for every caller that sends no run options.
	 */
	promptHints: string[];
	/**
	 * Which world this call ran in. `house` means the server picked both the
	 * model and the effort, so callers must not record either as a user choice.
	 */
	access: AiAccess;
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
 * Single place every AI call site gets its model from.
 *
 * An account with no key of its own runs on the house model: SureWord's own
 * OpenAI key, one model, one effort, and every requested or stored preference
 * ignored, because a user with no picker cannot have expressed one.
 *
 * For everyone else, resolution order for the model and effort is unchanged:
 * explicit request value, then the user's stored default, then the app
 * default. Credentials: the user's own key for that provider, then the
 * server's key when the account is allowlisted, else AiCredentialError.
 */
export async function resolveModel(options: {
	userId: string;
	modelId?: string | null;
	effort?: ReasoningEffort | null;
	/** Effort used when neither the request nor the user's settings pick one. */
	fallbackEffort?: ReasoningEffort;
	/**
	 * The request chose Auto explicitly (an `effort` key carrying JSON null), so
	 * the stored default must not fill it back in. An absent key is unchanged:
	 * no opinion, stored default applies. See `resolveEffortPreference`.
	 */
	ignoreStoredEffort?: boolean;
	/**
	 * Picker-driven run options for this turn. Only the chat path sends them.
	 *
	 * Passing the object at all - even empty - opts the call into the user's
	 * stored speed/verbosity/mode defaults. Every other caller leaves it out, so
	 * a chat preference never silently reshapes tap-a-verse (whose cache key
	 * does not include it) or background utility work.
	 */
	run?: { speed?: Speed | null; verbosity?: Verbosity | null; mode?: ReasoningMode | null };
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
	const access = await aiAccessFor(options.userId);
	const structuredCall = options.structured ?? Boolean(options.utility);

	if (access === "house") {
		// The house key is the only credential in play, so the attachment and
		// structured-provider fallbacks have nothing to choose between: Luna reads
		// every attachment type and OpenAI honours JSON schemas.
		const houseKey = serverKeyFor("openai")?.trim();
		if (!houseKey) throw new HouseModelUnavailableError();

		if (options.utility) {
			const utility = UTILITY_MODELS.openai;
			const houseUtilityDefinition = utilityDefinition("openai");
			return {
				model: buildModel("openai", utility.providerModelId, houseKey, structuredCall),
				providerOptions: buildProviderOptions(
					"openai",
					{ ...NO_RUN_OPTIONS, effort: utility.effort },
					false,
					houseUtilityDefinition,
				),
				definition: houseUtilityDefinition,
				effort: utility.effort,
				speed: null,
				verbosity: null,
				mode: null,
				promptHints: [],
				access,
				attachmentFallbackFrom: null,
				attachmentsUnsupported: false,
				structuredFallbackFrom: null,
				structuredOutputUnsupported: false,
			};
		}

		const houseDefinition = resolveDefinition(HOUSE_MODEL_ID);
		if (!houseDefinition) throw new Error("The house AI model is not registered.");
		const preferredHouseEffort = houseEffortFor(options.effort);
		const houseEffort = houseDefinition.efforts.includes(preferredHouseEffort)
			? preferredHouseEffort
			: null;

		return {
			model: buildModel("openai", houseDefinition.providerModelId, houseKey, structuredCall),
			// Speed, verbosity and mode are ignored outright here. A house answer
			// is billed to SureWord's own key, and fast mode alone doubles that
			// bill, so an account with no picker gets no run options either.
			providerOptions: buildProviderOptions(
				"openai",
				{ ...NO_RUN_OPTIONS, effort: houseEffort },
				Boolean(options.attachments) && houseDefinition.supportsAttachments,
				houseDefinition,
			),
			definition: houseDefinition,
			effort: houseEffort,
			speed: null,
			verbosity: null,
			mode: null,
			promptHints: [],
			access,
			attachmentFallbackFrom: null,
			attachmentsUnsupported: false,
			structuredFallbackFrom: null,
			structuredOutputUnsupported: false,
		};
	}

	const user = await prisma.user.findUnique({
		where: { id: options.userId },
		select: {
			defaultModelId: true,
			defaultEffort: true,
			defaultSpeed: true,
			defaultVerbosity: true,
			defaultMode: true,
		},
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

	if (options.utility) {
		// A provider that ignores the schema does not fail loudly: it returns
		// well-formed JSON under keys it made up, and Zod rejects it after the
		// tokens are paid for. Move the call somewhere capable when we can.
		const decision = decideStructuredProvider({
			provider: definition.provider,
			availableProviders:
				structuredCall && !providerSupportsStructuredOutput(definition.provider)
					? await credentialedProviders(options.userId)
					: [],
			structured: structuredCall,
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
			model: buildModel(decision.provider, utility.providerModelId, utilityKey, structuredCall),
			// Gated on the cheap sibling actually being built, not on `definition`,
			// which is still the user's chat pick when no structured fallback fired.
			providerOptions: buildProviderOptions(
				decision.provider,
				{ ...NO_RUN_OPTIONS, effort: utility.effort },
				false,
				utilityDefinition(decision.provider),
			),
			definition: utilityModel,
			effort: utility.effort,
			speed: null,
			verbosity: null,
			mode: null,
			promptHints: [],
			access,
			attachmentFallbackFrom: null,
			attachmentsUnsupported: false,
			structuredFallbackFrom: decision.fallbackFrom ? definition : null,
			structuredOutputUnsupported: decision.unsupported,
		};
	}

	const apiKey = await apiKeyFor(options.userId, definition.provider);

	// The picker renders OpenRouter's chips from its live catalog, which is the
	// only place its per-model reasoning levels and verbosity parameter exist.
	// A definition resolved from an id alone advertises neither, so without this
	// every OpenRouter chip would be clamped away here and do nothing. The list
	// is cached five minutes per key and never throws, so this is cheap and
	// falls back to the derived definition on any failure. Covers the
	// attachment fallback too: `definition` is already the final choice.
	if (definition.provider === "openrouter") {
		definition = overlayLiveDefinition(
			definition,
			await listProviderModels("openrouter", apiKey),
		);
	}

	const storedEffort = isReasoningEffort(user?.defaultEffort) ? user.defaultEffort : null;
	const requestedEffort = isReasoningEffort(options.effort) ? options.effort : null;
	const preferredEffort = resolveEffortPreference({
		requested: requestedEffort,
		explicitAuto: Boolean(options.ignoreStoredEffort),
		stored: storedEffort,
		fallback: options.fallbackEffort ?? "medium",
	});
	// Models that reject the reasoning parameter (Haiku, non-reasoning OpenAI
	// heads) advertise no efforts; sending one anyway is a hard API error.
	const effort = definition.efforts.includes(preferredEffort) ? preferredEffort : null;

	// Same order as effort: this request, then the stored default, then nothing
	// (which leaves the provider's own default in force). Clamped last, so a
	// model that does not sell fast mode simply runs standard.
	const requested = options.run;
	const preferredSpeed = requested
		? ((isSpeed(requested.speed) ? requested.speed : null) ??
			(isSpeed(user?.defaultSpeed) ? user.defaultSpeed : null))
		: null;
	const preferredVerbosity = requested
		? ((isVerbosity(requested.verbosity) ? requested.verbosity : null) ??
			(isVerbosity(user?.defaultVerbosity) ? user.defaultVerbosity : null))
		: null;
	const preferredMode = requested
		? ((isReasoningMode(requested.mode) ? requested.mode : null) ??
			(isReasoningMode(user?.defaultMode) ? user.defaultMode : null))
		: null;

	const speed =
		preferredSpeed && definition.speeds.includes(preferredSpeed) ? preferredSpeed : null;
	const verbosity =
		preferredVerbosity && definition.verbosities.includes(preferredVerbosity)
			? preferredVerbosity
			: null;
	const mode = preferredMode && definition.modes.includes(preferredMode) ? preferredMode : null;

	return {
		model: buildModel(definition.provider, definition.providerModelId, apiKey, structuredCall),
		providerOptions: buildProviderOptions(
			definition.provider,
			{ effort, speed, verbosity, mode },
			Boolean(options.attachments) && definition.supportsAttachments,
			definition,
		),
		definition,
		effort,
		speed,
		verbosity,
		mode,
		promptHints: verbosityPromptHints(definition, verbosity),
		access,
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
