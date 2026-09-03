import {
	PROVIDER_LABELS,
	type AiHouseMode,
	type AiModel,
	type AiModelsResponse,
	type AiProviderSummary,
} from "@/features/settings/aiApi";

/**
 * Pure selection rules behind the model picker sheet. They live outside the
 * component so the branches that actually bite - house mode, a stored pick for
 * a provider whose key is gone, a server that predates the `providers` array,
 * a stored run option the current model does not offer - are unit tested
 * without a React Native renderer.
 */

/* ------------------------------------------------------------------ *
 * Vocabulary. Mirrors the unions in src/lib/ai/models.ts on the server.
 * The client only ever renders a value it recognises here, so a server
 * that learns a new effort can never draw a chip that sends garbage back.
 * ------------------------------------------------------------------ */

/** Reasoning efforts, ordered lowest to highest. */
export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const SPEEDS = ["standard", "fast"] as const;
export type Speed = (typeof SPEEDS)[number];

export const VERBOSITIES = ["low", "medium", "high"] as const;
export type Verbosity = (typeof VERBOSITIES)[number];

export const REASONING_MODES = ["standard", "pro"] as const;
export type ReasoningMode = (typeof REASONING_MODES)[number];

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
	none: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra",
	max: "Max",
};

const SPEED_LABELS: Record<Speed, string> = {
	standard: "Standard",
	fast: "Fast",
};

const VERBOSITY_LABELS: Record<Verbosity, string> = {
	low: "Brief",
	medium: "Normal",
	high: "Detailed",
};

const MODE_LABELS: Record<ReasoningMode, string> = {
	standard: "Standard",
	pro: "Pro",
};

/** No override: the server picks. Only reasoning has an explicit Auto chip. */
export const AUTO_EFFORT_LABEL = "Auto";

/**
 * What the Auto chip stores. It is a LOCAL sentinel and never goes on the wire:
 * `effortForRequest` turns it into an explicit `effort: null`.
 *
 * The distinction it buys: a null `chatEffort` means "never chose", and a fresh
 * install must not tell the server anything about effort at all, because the
 * server reads an explicit null as "the user picked Auto" and would clear a
 * default set on another device. Anything the vocabulary does not recognise,
 * this sentinel included, reads as Auto everywhere in the picker.
 */
export const AUTO_EFFORT_SENTINEL = "auto";

/**
 * The `effort` value for a chat request, from what the picker stored.
 *
 * - the Auto sentinel -> `null`: an explicit "no reasoning override".
 * - nothing stored -> `undefined`: the caller must OMIT the key, so the account
 *   default survives a device that has never opened the picker.
 * - anything else -> as-is; the server clamps what the model cannot run.
 */
export function effortForRequest(stored: string | null | undefined): string | null | undefined {
	if (stored === AUTO_EFFORT_SENTINEL) return null;
	if (!stored) return undefined;
	return stored;
}

/** Fixed caveat under the MODE section, identical on every client. */
export const MODE_NOTE = "Deeper multi-pass reasoning; slower and pricier";

/** More models than this and the sheet grows a search field. */
export const SEARCH_THRESHOLD = 8;

/** The label for a stored effort, "Auto" for null and for anything unknown. */
export function effortLabel(effort: string | null | undefined): string {
	const known = REASONING_EFFORTS.find((candidate) => candidate === effort);
	return known ? EFFORT_LABELS[known] : AUTO_EFFORT_LABEL;
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/** The house block, but only when the server put the account in house mode. */
export function houseMode(data: AiModelsResponse | null): AiHouseMode | null {
	if (!data || data.access !== "house") return null;
	return data.house ?? null;
}

/**
 * The model to render as picked: the stored pick while the server still offers
 * it, otherwise the server default. House mode always answers the house model,
 * because the server runs that regardless of what the client asks for.
 */
export function selectModelId(
	stored: string | null,
	data: AiModelsResponse | null,
): string | null {
	if (!data) return null;
	const house = houseMode(data);
	if (house) return house.modelId;
	const stillOffered = data.models.some((model) => model.id === stored && model.available);
	return stillOffered ? stored : data.defaults.modelId;
}

/** The full entry for the picked model, so the option rows can read its caps. */
export function selectedModel(
	data: AiModelsResponse | null,
	stored: string | null,
): AiModel | null {
	const id = selectModelId(stored, data);
	if (!id) return null;
	return data?.models.find((model) => model.id === id) ?? null;
}

/**
 * Provider rows worth drawing: unlocked, and holding at least one model. Locked
 * providers are never shown - a row that only says "add a key" is noise, and
 * house mode has no provider rows at all.
 */
export function visibleProviders(data: AiModelsResponse | null): AiProviderSummary[] {
	if (!data || houseMode(data)) return [];
	if (data.providers?.length) {
		return data.providers.filter(
			(provider) => provider.available && modelsForProvider(data, provider.id).length > 0,
		);
	}
	// Pre-house-mode servers omit `providers`; derive the rows from the flat list.
	const derived = new Map<string, AiProviderSummary>();
	for (const model of data.models) {
		if (!model.available || derived.has(model.provider)) continue;
		derived.set(model.provider, {
			id: model.provider,
			label: PROVIDER_LABELS[model.provider] ?? model.provider,
			available: true,
		});
	}
	return [...derived.values()];
}

/** The models under one provider row, unavailable ones filtered out. */
export function modelsForProvider(data: AiModelsResponse | null, providerId: string): AiModel[] {
	if (!data) return [];
	return data.models.filter((model) => model.provider === providerId && model.available);
}

/** Display name for a provider id: the server's label, else our own, else the id. */
export function providerLabel(data: AiModelsResponse | null, providerId: string): string {
	const fromServer = data?.providers?.find((provider) => provider.id === providerId)?.label;
	return fromServer ?? PROVIDER_LABELS[providerId] ?? providerId;
}

/** True once the account can see enough models that scanning them is a chore. */
export function showSearch(data: AiModelsResponse | null): boolean {
	if (!data || houseMode(data)) return false;
	return data.models.filter((model) => model.available).length > SEARCH_THRESHOLD;
}

/**
 * Flat search across every provider. An empty query answers every available
 * model, so the caller decides whether to draw the flat list or the groups.
 */
export function filterModels(data: AiModelsResponse | null, query: string): AiModel[] {
	if (!data) return [];
	const available = data.models.filter((model) => model.available);
	const needle = query.trim().toLowerCase();
	if (!needle) return available;
	return available.filter(
		(model) =>
			model.label.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle),
	);
}

/* ------------------------------------------------------------------ *
 * Per-model capabilities. Every one of these fields is additive, so a
 * server that predates the run-options release answers the old shape:
 * efforts as sent, one speed, no verbosities, one mode.
 * ------------------------------------------------------------------ */

/** The efforts this model offers, in canonical order, unknown values dropped. */
export function effortsFor(model: AiModel | null | undefined): ReasoningEffort[] {
	const offered = model?.efforts ?? [];
	return REASONING_EFFORTS.filter((effort) => offered.includes(effort));
}

export function speedsFor(model: AiModel | null | undefined): Speed[] {
	const offered = model?.speeds ?? [];
	const known = SPEEDS.filter((speed) => offered.includes(speed));
	return known.length > 0 ? known : ["standard"];
}

export function verbositiesFor(model: AiModel | null | undefined): Verbosity[] {
	const offered = model?.verbosities ?? [];
	return VERBOSITIES.filter((verbosity) => offered.includes(verbosity));
}

export function modesFor(model: AiModel | null | undefined): ReasoningMode[] {
	const offered = model?.modes ?? [];
	const known = REASONING_MODES.filter((mode) => offered.includes(mode));
	return known.length > 0 ? known : ["standard"];
}

/**
 * The stored effort as the current model sees it. An effort this model does not
 * list reads as Auto and is deliberately NOT erased: switching to a model that
 * does support it must bring the setting back, so a detour costs nothing.
 */
export function visibleEffort(
	stored: string | null | undefined,
	model: AiModel | null | undefined,
): ReasoningEffort | null {
	return effortsFor(model).find((effort) => effort === stored) ?? null;
}

/* ------------------------------------------------------------------ *
 * Option sections
 * ------------------------------------------------------------------ */

export type OptionKind = "effort" | "speed" | "verbosity" | "mode";

export interface OptionChoice {
	/**
	 * Exactly what tapping this chip stores, and never null: null is reserved
	 * for "never chose". Speed, length and mode store their default verbatim
	 * ("standard" / "medium" / "standard") because the server reads a null as
	 * "no opinion, apply the account default", which would leave someone who
	 * once stored Fast running Fast forever. Reasoning's Auto chip stores
	 * `AUTO_EFFORT_SENTINEL`, which the request layer turns into a real null.
	 */
	id: string;
	label: string;
}

export interface OptionSection {
	kind: OptionKind;
	/** Uppercase section heading, as drawn. */
	title: string;
	/** Sentence-case name, for screen readers. */
	name: string;
	choices: OptionChoice[];
	/** The chip that reads selected when nothing has ever been chosen. */
	defaultId: string;
	/** Caveat drawn under the chips in muted metadata text. */
	note: string | null;
}

/**
 * The option rows to pin under the model list. A section only appears when the
 * model offers more than its default, so a model with nothing to tune shows no
 * rows at all rather than four inert ones.
 */
export function optionSections(model: AiModel | null | undefined): OptionSection[] {
	if (!model) return [];
	const sections: OptionSection[] = [];

	const efforts = effortsFor(model);
	if (efforts.length > 0) {
		sections.push({
			kind: "effort",
			title: "REASONING",
			name: "Reasoning",
			choices: [
				// The Auto chip stores the sentinel, not null: null has to stay
				// available to mean "never chose", so the request can omit `effort`.
				{ id: AUTO_EFFORT_SENTINEL, label: AUTO_EFFORT_LABEL },
				...efforts.map((effort) => ({ id: effort, label: EFFORT_LABELS[effort] })),
			],
			defaultId: AUTO_EFFORT_SENTINEL,
			note: null,
		});
	}

	if (speedsFor(model).includes("fast")) {
		sections.push({
			kind: "speed",
			title: "SPEED",
			name: "Speed",
			choices: [
				{ id: "standard", label: SPEED_LABELS.standard },
				{ id: "fast", label: SPEED_LABELS.fast },
			],
			defaultId: "standard",
			note: model.fastModeNote ?? null,
		});
	}

	const verbosities = verbositiesFor(model);
	if (verbosities.length > 0) {
		sections.push({
			kind: "verbosity",
			title: "LENGTH",
			name: "Length",
			// Normal is the default, so it is always offered, and it stores
			// "medium" rather than null so choosing it clears an earlier Detailed.
			choices: VERBOSITIES.filter(
				(verbosity) => verbosity === "medium" || verbosities.includes(verbosity),
			).map((verbosity) => ({ id: verbosity, label: VERBOSITY_LABELS[verbosity] })),
			defaultId: "medium",
			note: null,
		});
	}

	if (modesFor(model).includes("pro")) {
		sections.push({
			kind: "mode",
			title: "MODE",
			name: "Mode",
			choices: [
				{ id: "standard", label: MODE_LABELS.standard },
				{ id: "pro", label: MODE_LABELS.pro },
			],
			defaultId: "standard",
			note: MODE_NOTE,
		});
	}

	return sections;
}

/**
 * Which chip in a section reads as selected. Nothing stored yet reads as the
 * section's default, and so does a stored value this section does not offer -
 * in both cases without touching the store, so a value the current model
 * rejects survives a detour through another model.
 */
export function activeOptionId(section: OptionSection, stored: string | null | undefined): string {
	if (!stored) return section.defaultId;
	return section.choices.some((choice) => choice.id === stored) ? stored : section.defaultId;
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

/** Up to three tiny capability pills after the model label. */
export function modelPills(model: AiModel): string[] {
	const pills: string[] = [];
	if (model.supportsAttachments) pills.push("Files");
	if (speedsFor(model).includes("fast")) pills.push("Fast");
	if (modesFor(model).includes("pro")) pills.push("Pro");
	return pills.slice(0, 3);
}

/** "1M", "400K", or null when the server sent no context window. */
export function formatContextWindow(tokens: number | null | undefined): string | null {
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return null;
	if (tokens >= 1_000_000) {
		// Nearest half million: 1,050,000 and 1,048,576 both read "1M", while a
		// genuine 1.5M window still says so.
		return `${trimZero(Math.round((tokens / 1_000_000) * 2) / 2)}M`;
	}
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(Math.round(tokens));
}

/** "$2 / $12 per M", or null when the server sent no pricing. */
export function formatPricing(
	pricing: { input: number; output: number } | null | undefined,
): string | null {
	if (!pricing) return null;
	const { input, output } = pricing;
	if (typeof input !== "number" || typeof output !== "number") return null;
	if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
	return `$${formatPrice(input)} / $${formatPrice(output)} per M`;
}

/**
 * The model row's second line: the curated tagline when there is one, else
 * whatever hard numbers the server sent, else nothing at all.
 */
export function modelMeta(model: AiModel): string | null {
	if (model.tagline) return model.tagline;
	const bits: string[] = [];
	const context = formatContextWindow(model.contextWindow);
	if (context) bits.push(`${context} context`);
	const pricing = formatPricing(model.pricing);
	if (pricing) bits.push(pricing);
	return bits.length > 0 ? bits.join(" · ") : null;
}

export interface RunOptions {
	effort?: string | null;
	speed?: string | null;
	verbosity?: string | null;
	mode?: string | null;
}

/**
 * "GPT-5.6 Luna · High · Fast · Detailed": the model plus every option that is
 * not the default. Auto reasoning contributes nothing, nor does an explicitly
 * stored default ("standard" / "medium"), nor an option the selected model does
 * not support, so the line always describes what the next message will run with.
 */
export function summaryLabel(model: AiModel | null | undefined, run: RunOptions): string {
	if (!model) return "";
	const parts: string[] = [model.label];

	const effort = visibleEffort(run.effort, model);
	if (effort) parts.push(EFFORT_LABELS[effort]);

	if (run.speed === "fast" && speedsFor(model).includes("fast")) parts.push(SPEED_LABELS.fast);

	const verbosities = verbositiesFor(model);
	for (const verbosity of VERBOSITIES) {
		if (verbosity === "medium") continue;
		if (run.verbosity === verbosity && verbosities.includes(verbosity)) {
			parts.push(VERBOSITY_LABELS[verbosity]);
		}
	}

	if (run.mode === "pro" && modesFor(model).includes("pro")) parts.push(MODE_LABELS.pro);

	return parts.join(" · ");
}

export const RUN_OPTION_KEYS = ["effort", "speed", "verbosity", "mode"] as const;

/**
 * Which run options to copy out of the account defaults the server sent.
 *
 * A client that has never opened the picker stores null for everything, while
 * the account may already carry a choice made elsewhere - and the server WILL
 * apply that choice. Seeding the store makes the chips agree with what the next
 * message actually runs, instead of showing Standard while the request runs
 * Fast. Only unset fields are seeded, so a local choice always wins.
 */
export function seedRunOptions(stored: RunOptions, defaults: RunOptions | undefined): RunOptions {
	const seed: RunOptions = {};
	for (const key of RUN_OPTION_KEYS) {
		const value = defaults?.[key];
		if (stored[key] == null && typeof value === "string" && value.length > 0) seed[key] = value;
	}
	return seed;
}

function trimZero(value: number): string {
	return String(Number(value.toFixed(1)));
}

/** Whole dollars bare, everything else to two decimals: 2, 12, 0.20, 1.20, 4.50. */
function formatPrice(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
