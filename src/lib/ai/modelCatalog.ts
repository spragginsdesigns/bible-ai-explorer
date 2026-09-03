import { createHash } from "node:crypto";
import {
	buildDefinition,
	getModel,
	isReasoningEffort,
	MODELS,
	prettyModelLabel,
	REASONING_EFFORTS,
	type ModelDefinition,
	type ModelPricing,
	type ProviderId,
	type ReasoningEffort,
} from "./models";

/**
 * Live per-provider model catalogs. Every provider exposes a free "list
 * models" endpoint (the same one key validation already uses), so the picker
 * shows what a key can actually reach — gpt-5.6-luna, sol, new Claude
 * releases — instead of the curated registry's snapshot. Curated entries
 * still win on label and ordering; the registry is also the fallback when a
 * provider's endpoint is down.
 *
 * Only recent heads are offered: every list endpoint reports when a model was
 * created, and anything older than MAX_MODEL_AGE_MS is dropped so the picker
 * never surfaces a years-old model (OpenAI alone still lists gpt-3.5-turbo
 * and gpt-4 from 2023). Curated entries are exempt because the registry is
 * hand-maintained; rows without a date are kept because they cannot be judged.
 */

interface ProviderEndpoint {
	url: string;
	headers: (apiKey: string) => Record<string, string>;
}

const ENDPOINTS: Record<ProviderId, ProviderEndpoint> = {
	openai: {
		url: "https://api.openai.com/v1/models",
		headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
	},
	anthropic: {
		url: "https://api.anthropic.com/v1/models?limit=100",
		headers: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
	},
	moonshot: {
		url: "https://api.moonshot.ai/v1/models",
		headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
	},
	openrouter: {
		url: "https://openrouter.ai/api/v1/models",
		headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
	},
};

/**
 * OpenAI's list mixes chat models with embeddings, audio, image, and
 * moderation models, plus dated snapshots of each chat model. Keep the
 * conversational heads only.
 */
const OPENAI_CHAT_PREFIX = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NON_CHAT =
	/(embed|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|search|instruct|davinci|babbage|curie|ada)/;
const DATED_SNAPSHOT = /-\d{4}(-\d{2}-\d{2})?$/;

function isOpenAiChatModel(id: string): boolean {
	return OPENAI_CHAT_PREFIX.test(id) && !OPENAI_NON_CHAT.test(id) && !DATED_SNAPSHOT.test(id);
}

function isMoonshotChatModel(id: string): boolean {
	return /^(kimi|moonshot)/.test(id) && !OPENAI_NON_CHAT.test(id);
}

/** Models created more than this long ago are not offered (Austin, 2026-09-02: "last 6 months or less"). */
export const MAX_MODEL_AGE_MS = 180 * 24 * 60 * 60 * 1000;

interface ProviderModelRow {
	id: string;
	displayName?: string;
	/** Epoch milliseconds the provider first listed the model, when reported. */
	createdAt?: number;
	/** OpenRouter: does the model output text rather than only images/audio? */
	chatOutput?: boolean;
	/** OpenRouter: does the model advertise image input? */
	imageInput?: boolean;
	/** OpenRouter: exact reasoning levels advertised by this vendor/model. */
	efforts?: ReasoningEffort[];
	/** OpenRouter: can this model accept the tools SureWord always sends? */
	supportsTools?: boolean;
	/** OpenRouter: the level the vendor runs when no effort is sent. */
	defaultEffort?: ReasoningEffort;
	/** OpenRouter: the model takes a real `verbosity` parameter. */
	verbosityNative?: boolean;
	/** OpenRouter: tokens the served endpoint actually accepts. */
	contextWindow?: number;
	/** OpenRouter: USD per 1M tokens, converted from its per-token strings. */
	pricing?: ModelPricing;
}

/** OpenRouter prices per token, as strings. The picker shows per 1M tokens. */
function perMillion(value: unknown): number | undefined {
	if (typeof value !== "string" || value.trim() === "") return undefined;
	const perToken = Number(value);
	if (!Number.isFinite(perToken)) return undefined;
	return Math.round(perToken * 1e6 * 10_000) / 10_000;
}

function openRouterMeta(entry: Record<string, unknown>): Pick<
	ProviderModelRow,
	| "chatOutput"
	| "imageInput"
	| "efforts"
	| "supportsTools"
	| "defaultEffort"
	| "verbosityNative"
	| "contextWindow"
	| "pricing"
> {
	const architecture =
		typeof entry.architecture === "object" && entry.architecture !== null
			? (entry.architecture as Record<string, unknown>)
			: {};
	const inputModalities = Array.isArray(architecture.input_modalities)
		? architecture.input_modalities
		: [];
	const outputModalities = Array.isArray(architecture.output_modalities)
		? architecture.output_modalities
		: [];
	const reasoning =
		typeof entry.reasoning === "object" && entry.reasoning !== null
			? (entry.reasoning as Record<string, unknown>)
			: {};
	const supportedEfforts = Array.isArray(reasoning.supported_efforts)
		? reasoning.supported_efforts
		: [];
	const supportedParameters = Array.isArray(entry.supported_parameters)
		? entry.supported_parameters
		: [];
	const topProvider =
		typeof entry.top_provider === "object" && entry.top_provider !== null
			? (entry.top_provider as Record<string, unknown>)
			: {};
	const pricing =
		typeof entry.pricing === "object" && entry.pricing !== null
			? (entry.pricing as Record<string, unknown>)
			: {};
	// A model whose reasoning is mandatory rejects "none"; offering it would be
	// a chip that 400s.
	const mandatory = reasoning.mandatory === true;
	const efforts = supportedEfforts
		.filter((value): value is ReasoningEffort => isReasoningEffort(value))
		.filter((value) => !(mandatory && value === "none"))
		.sort((a, b) => REASONING_EFFORTS.indexOf(a) - REASONING_EFFORTS.indexOf(b));
	const defaultEffort = isReasoningEffort(reasoning.default_effort)
		? reasoning.default_effort
		: undefined;
	const input = perMillion(pricing.prompt);
	const output = perMillion(pricing.completion);
	// `context_length` and `top_provider.context_length` disagree on some heads;
	// the served endpoint's figure is the honest one.
	const contextWindow =
		typeof topProvider.context_length === "number"
			? topProvider.context_length
			: typeof entry.context_length === "number"
				? entry.context_length
				: undefined;

	return {
		chatOutput: outputModalities.length ? outputModalities.includes("text") : undefined,
		imageInput: inputModalities.length ? inputModalities.includes("image") : undefined,
		supportsTools: supportedParameters.length
			? supportedParameters.includes("tools")
			: undefined,
		efforts,
		defaultEffort,
		verbosityNative: supportedParameters.length
			? supportedParameters.includes("verbosity")
			: undefined,
		contextWindow,
		pricing: input !== undefined && output !== undefined ? { input, output } : undefined,
	};
}

/**
 * OpenAI, Moonshot and OpenRouter report `created` as unix seconds;
 * Anthropic reports `created_at` as an ISO-8601 string.
 */
function parseCreatedAt(entry: Record<string, unknown>): number | undefined {
	if (typeof entry.created === "number" && Number.isFinite(entry.created)) {
		return entry.created * 1000;
	}
	if (typeof entry.created_at === "string") {
		const parsed = Date.parse(entry.created_at);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

/** Recent enough to offer: curated, undated, or created within MAX_MODEL_AGE_MS. */
export function isRecentModel(
	provider: ProviderId,
	row: Pick<ProviderModelRow, "id" | "createdAt">,
	now = Date.now(),
): boolean {
	if (getModel(`${provider}/${row.id}`)) return true;
	if (row.createdAt === undefined) return true;
	return now - row.createdAt <= MAX_MODEL_AGE_MS;
}

function parseListResponse(provider: ProviderId, body: unknown): ProviderModelRow[] {
	const data =
		typeof body === "object" && body !== null && Array.isArray((body as { data?: unknown }).data)
			? ((body as { data: unknown[] }).data as Record<string, unknown>[])
			: [];
	const rows: ProviderModelRow[] = [];
	for (const entry of data) {
		if (typeof entry?.id !== "string") continue;
		rows.push({
			id: entry.id,
			createdAt: parseCreatedAt(entry),
			displayName:
				provider === "anthropic" && typeof entry.display_name === "string"
					? entry.display_name
					: provider === "openrouter" && typeof entry.name === "string"
						? entry.name
					: undefined,
			...(provider === "openrouter" ? openRouterMeta(entry) : {}),
		});
	}
	return rows;
}

function toDefinition(provider: ProviderId, row: ProviderModelRow): ModelDefinition {
	const id = `${provider}/${row.id}`;
	const base =
		getModel(id) ??
		buildDefinition({
			provider,
			providerModelId: row.id,
			label: row.displayName ?? prettyModelLabel(row.id),
			supportsAttachments: row.imageInput ?? provider !== "moonshot",
		});

	// OpenRouter is the only list endpoint that reports per-model reasoning,
	// verbosity, price and context. Its live row beats both the derivation and
	// the curated snapshot, so a curated entry is overlaid rather than returned
	// whole; label, ordering and attachment support stay curated.
	if (provider !== "openrouter") return base;
	const efforts = row.efforts && row.efforts.length > 0 ? row.efforts : base.efforts;
	const defaultEffort = row.defaultEffort ?? base.defaultEffort;
	return {
		...base,
		efforts,
		defaultEffort: defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : null,
		verbosityMechanism:
			row.verbosityNative === undefined
				? base.verbosityMechanism
				: row.verbosityNative
					? "native"
					: "prompt",
		contextWindow: row.contextWindow ?? base.contextWindow,
		pricing: row.pricing ?? base.pricing,
	};
}

/** Curated models first, in registry order; the rest alphabetically. */
function sortCatalog(provider: ProviderId, definitions: ModelDefinition[]): ModelDefinition[] {
	const curatedOrder = new Map(
		MODELS.filter((model) => model.provider === provider).map((model, index) => [model.id, index]),
	);
	return definitions.sort((a, b) => {
		const aCurated = curatedOrder.get(a.id);
		const bCurated = curatedOrder.get(b.id);
		if (aCurated !== undefined || bCurated !== undefined) {
			if (aCurated === undefined) return 1;
			if (bCurated === undefined) return -1;
			return aCurated - bCurated;
		}
		return a.label.localeCompare(b.label);
	});
}

export function curatedModelsFor(provider: ProviderId): ModelDefinition[] {
	return MODELS.filter((model) => model.provider === provider);
}

// Model lists barely change; a short per-key cache keeps the picker snappy
// without holding raw keys as map keys. Instance-local, best-effort.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expires: number; models: ModelDefinition[] }>();

function cacheKey(provider: ProviderId, apiKey: string): string {
	return `${provider}:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

/**
 * The models this key can reach, filtered to chat models. Falls back to the
 * curated registry if the provider's endpoint errors — the picker must never
 * come up empty just because a list call failed.
 */
export async function listProviderModels(
	provider: ProviderId,
	apiKey: string,
): Promise<ModelDefinition[]> {
	const key = cacheKey(provider, apiKey);
	const cached = cache.get(key);
	if (cached && cached.expires > Date.now()) return cached.models;

	try {
		const endpoint = ENDPOINTS[provider];
		const response = await fetch(endpoint.url, {
			headers: endpoint.headers(apiKey),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`${provider} models list returned ${response.status}`);
		const rows = parseListResponse(provider, await response.json()).filter((row) => {
			if (!isRecentModel(provider, row)) return false;
			if (provider === "openai") return isOpenAiChatModel(row.id);
			if (provider === "moonshot") return isMoonshotChatModel(row.id);
			if (provider === "openrouter") {
				// SureWord always supplies Scripture/note tools. OpenRouter otherwise
				// accepts the selection and fails only when the first request arrives.
				return row.chatOutput !== false && row.supportsTools !== false;
			}
			return true; // Anthropic's list is chat models only.
		});
		if (rows.length === 0) throw new Error(`${provider} models list came back empty`);

		const models = sortCatalog(
			provider,
			rows.map((row) => toDefinition(provider, row)),
		);
		cache.set(key, { expires: Date.now() + CACHE_TTL_MS, models });
		return models;
	} catch (error) {
		console.error(`[modelCatalog] falling back to curated list for ${provider}:`, error);
		return curatedModelsFor(provider);
	}
}
