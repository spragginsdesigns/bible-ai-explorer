import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiProvider } from "@prisma/client";
import { wrapLanguageModel, type JSONValue, type LanguageModel } from "ai";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import { prisma } from "@/lib/prisma";
import { houseKeyFor } from "./house-key";
import { meterIncludedModel, resolveRequestAccess, reserveIncludedRequest, requestUserPlan } from "@/lib/billing/usage";
import { decideAccess, includedEffortFor, type AiAccess } from "./access";
import { listProviderModels } from "./modelCatalog";
import {
	ATTACHMENT_CAPABLE_MODEL_IDS,
	buildProviderOptions,
	decideStructuredProvider,
	DEFAULT_MODEL_ID,
	HOUSE_CHAT_MODEL_ID,
	HOUSE_EFFORT,
	HOUSE_MODEL_ID,
	houseChatModelId,
	OWNER_SOL_MODEL_ID,
	ownerPickForModelId,
	sureWordPlanDefinition,
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

/** Thrown when a call needs a provider the server holds no key for. */
export class AiCredentialError extends Error {
	constructor(public provider: ProviderId, public providerLabel: string) {
		super(`${providerLabel} is not configured on this server.`);
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
 * Only allowlisted accounts (Austin's) may run on the server's own API keys
 * unmetered. Everyone else is Free or Pro on included AI.
 */
export function isServerCredentialUser(userId: string): boolean {
	return parseUserIdAllowlist(process.env.SERVER_CREDENTIAL_USER_IDS).includes(userId);
}

/**
 * The key a `keys` call runs on. Only the owner reaches this path, and only on
 * the server's keys: stored personal keys stopped being read when BYOK was
 * removed (2026-10-25).
 */
async function apiKeyFor(userId: string, provider: ProviderId): Promise<string> {
	if (isServerCredentialUser(userId)) {
		const serverKey = serverKeyFor(provider);
		if (serverKey) return serverKey;
	}
	throw new AiCredentialError(provider, PROVIDER_LABELS[provider]);
}

/**
 * Whether this account runs on SureWord's included AI (house) or is the owner
 * on the server's keys (keys). Every other account is Free or Pro on included
 * AI; there are no personal keys any more.
 */
export async function aiAccessFor(userId: string): Promise<AiAccess> {
	return resolveRequestAccess(userId, async () => decideAccess({ allowlisted: isServerCredentialUser(userId) }));
}

/**
 * The model a house account chats on, chosen by plan (see HOUSE_CHAT_MODEL_IDS),
 * and the server credential that pays for it. The dedicated free-tier OpenAI
 * key is reserved for the Luna paths, so every other head runs on the
 * provider's own server key.
 */
export async function houseChatModel(
	userId: string,
): Promise<{ definition: ModelDefinition; apiKey: string; plan: "pro" | "free" }> {
	const plan = await requestUserPlan(userId);
	const modelId = houseChatModelId(plan, { openrouter: Boolean(serverKeyFor("openrouter")?.trim()) });
	const definition = resolveDefinition(modelId);
	if (!definition) throw new Error(`The house AI model ${modelId} is not registered.`);
	const apiKey = modelId === HOUSE_MODEL_ID ? houseKeyFor(process.env) : serverKeyFor(definition.provider)?.trim();
	if (!apiKey) throw new HouseModelUnavailableError();
	return { definition, apiKey, plan };
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
): Exclude<LanguageModel, string> {
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

/** Small, optional activity writer. Its failure never prevents the main answer. */
export async function resolveProgressModel(userId: string, provider: ProviderId): Promise<Pick<ResolvedModel, "model" | "providerOptions"> | null> {
	// Kimi's thinking pass is too expensive for a short status line; factual tool updates still work.
	if (provider === "moonshot") return null;
	const house = await aiAccessFor(userId) === "house";
	// Whatever a house answer runs on, its status lines stay on Luna and the
	// free-tier key: a house account holds no provider key of its own.
	if (house) provider = "openai";
	const key = house ? houseKeyFor(process.env) : await apiKeyOrNull(userId, provider);
	if (!key) return null;
	const modelId = provider === "openai" ? "gpt-5.6-luna" : UTILITY_MODELS[provider].providerModelId;
	return {
		model: house ? meterIncludedModel(userId, buildModel(provider, modelId, key), true) : buildModel(provider, modelId, key),
		providerOptions: provider === "openai"
			? { openai: { reasoningEffort: "none", reasoningSummary: null, textVerbosity: "low" } }
			: {},
	};
}

/**
 * The model for a signed-out guest's answer (docs/FEATURES.md, "Try before
 * you sign up"): the house model on SureWord's own key, at medium effort.
 *
 * Deliberately outside `resolveModel`, which is keyed by an account at every
 * step (access, stored defaults, included-AI metering all read a User row). A
 * guest has none of that; the GuestTurn rows are the meter, and the route
 * enforces their ceilings before this is ever called.
 */
export function resolveGuestModel(): Pick<ResolvedModel, "model" | "providerOptions" | "definition"> {
	const houseKey = houseKeyFor(process.env);
	if (!houseKey) throw new HouseModelUnavailableError();
	const definition = resolveDefinition(HOUSE_MODEL_ID);
	if (!definition) throw new Error("The house AI model is not registered.");
	const effort = definition.efforts.includes("medium") ? "medium" : null;
	return {
		model: buildModel("openai", definition.providerModelId, houseKey),
		providerOptions: buildProviderOptions("openai", { ...NO_RUN_OPTIONS, effort }, false, definition),
		definition,
	};
}

/**
 * Source/claim checks share the answer's model, key, request ledger and price.
 * They have their own bounded call allowance, so checking an eight-step study
 * cannot consume the foreground tool-loop allowance or a second user message.
 */
export async function resolveVerificationModel(userId: string | null, definition: ModelDefinition): Promise<LanguageModel> {
	const house = userId ? await aiAccessFor(userId) === "house" : true;
	const apiKey = house
		? (definition.id === HOUSE_MODEL_ID ? houseKeyFor(process.env) : serverKeyFor(definition.provider))
		: await apiKeyFor(userId!, definition.provider);
	if (!apiKey) throw new HouseModelUnavailableError();
	const base = buildModel(definition.provider, definition.providerModelId, apiKey, true);
	const metered = house && userId ? meterIncludedModel(userId, base, true, definition.pricing) : base;
	let calls = 0;
	return wrapLanguageModel({ model: metered, middleware: {
		transformParams: async ({ params }) => {
			if (++calls > 12) throw new Error("Scripture verification call allowance exhausted");
			return params;
		},
	} });
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
	/** Cache lookup only. The caller must reserve included inference before opening a cache-miss stream. */
	deferReservation?: boolean;
}): Promise<ResolvedModel> {
	const access = await aiAccessFor(options.userId);
	const structuredCall = options.structured ?? Boolean(options.utility);

	if (access === "house") {
		// Server keys are the only credentials in play, so the attachment and
		// structured-provider fallbacks have nothing to choose between: every
		// house chat model reads attachments and honours JSON schemas, and
		// utility work stays on Luna.
		if (options.utility) {
			const houseKey = houseKeyFor(process.env);
			if (!houseKey) throw new HouseModelUnavailableError();
			const utility = { providerModelId: "gpt-5.6-luna", effort: "low" as const };
			const houseUtilityDefinition = resolveDefinition(HOUSE_MODEL_ID)!;
			return {
				model: meterIncludedModel(options.userId, buildModel("openai", utility.providerModelId, houseKey, structuredCall), true),
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

		const { definition: houseDefinition, apiKey: houseChatKey, plan } = await houseChatModel(options.userId);
		if (!options.deferReservation) await reserveIncludedRequest(options.userId);
		// The plan sets the effort; a pick stored while Pro still had Reasoning
		// chips is ignored, or an old "low" would hold Pro answers below high.
		// Chat (the only caller that passes `run`) sends that stored pick in its
		// body, so only a server call site's pin may lower it.
		const preferredHouseEffort = includedEffortFor({
			requested: options.effort,
			plan,
			fromChat: options.run !== undefined,
		});
		const houseEffort = houseDefinition.efforts.includes(preferredHouseEffort)
			? preferredHouseEffort
			: null;

		return {
			model: meterIncludedModel(
				options.userId,
				buildModel(houseDefinition.provider, houseDefinition.providerModelId, houseChatKey, structuredCall),
				false,
				houseDefinition.pricing,
			),
			// Speed, verbosity and mode are ignored outright here. A house answer
			// is billed to SureWord's own key, and fast mode alone doubles that
			// bill, so an account with no picker gets no run options either.
			providerOptions: buildProviderOptions(
				houseDefinition.provider,
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

	// The owner picks a plan's SureWord AI, not a model (Austin, 2026-10-25):
	// the included head at that plan's effort, on the server key, unmetered.
	// Utility work keeps the keys path below.
	if (!options.utility && isServerCredentialUser(options.userId)) {
		const pick = ownerPickForModelId(options.modelId) ?? ownerPickForModelId(user?.defaultModelId) ?? "pro";
		const headId = pick === "sol" ? OWNER_SOL_MODEL_ID : HOUSE_CHAT_MODEL_ID;
		const head = resolveDefinition(headId);
		if (!head) throw new Error(`The owner chat model ${headId} is not registered.`);
		const apiKey = await apiKeyFor(options.userId, head.provider);
		// Sol answers chat at high, like Pro; a server call site's latency pin
		// (tap-a-verse, word study) still lowers it, as it does for Pro.
		const effort = includedEffortFor({
			requested: options.effort,
			plan: pick === "sol" ? "pro" : pick,
			fromChat: options.run !== undefined,
		});
		return {
			model: buildModel(head.provider, head.providerModelId, apiKey, structuredCall),
			providerOptions: buildProviderOptions(
				head.provider,
				{ ...NO_RUN_OPTIONS, effort },
				Boolean(options.attachments) && head.supportsAttachments,
				head,
			),
			definition: pick === "sol" ? head : sureWordPlanDefinition(pick),
			effort,
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
