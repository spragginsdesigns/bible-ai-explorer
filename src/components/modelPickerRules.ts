/**
 * Pure rules behind the web model picker.
 *
 * Kept free of React so the label maps, the "what does this model actually
 * offer" derivations and the search filter can be unit-tested
 * (`tests/model-picker-rules.test.mjs`) without a DOM. `ModelPicker.tsx` is
 * then only markup, positioning and localStorage.
 *
 * The server is the authority on what a model supports; everything here is
 * defensive about an older payload that has not learned the new fields yet, so
 * every one of them is optional and falls back to the narrowest sensible
 * default (one speed, no length control, no Pro mode).
 */

export interface PickerPricing {
	/** USD per 1M input tokens. */
	input: number;
	/** USD per 1M output tokens. */
	output: number;
}

/**
 * One entry of `GET /api/ai/models`. Only the first six fields are guaranteed:
 * a deploy mid-rollout can still answer with the older payload.
 */
export interface PickerModel {
	id: string;
	label: string;
	provider: string;
	supportsAttachments: boolean;
	efforts: string[];
	available: boolean;
	speeds?: string[] | null;
	verbosities?: string[] | null;
	modes?: string[] | null;
	defaultEffort?: string | null;
	tagline?: string | null;
	tier?: string | null;
	contextWindow?: number | null;
	pricing?: PickerPricing | null;
	fastModeNote?: string | null;
}

/** The four per-request options the picker owns, as stored locally. */
export interface StoredRunOptions {
	effort: string | null;
	speed: string | null;
	verbosity: string | null;
	mode: string | null;
}

/** Joins the model label and its non-default options on the trigger chip. */
export const SUMMARY_SEPARATOR = " · ";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** Lowest to highest. The server sends an unordered set; chips draw in this order. */
export const REASONING_EFFORTS: readonly string[] = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

const EFFORT_LABELS: Record<string, string> = {
	none: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra",
	max: "Max",
};

/** No override: whatever the provider runs by default. */
export const AUTO_EFFORT_LABEL = "Auto";

/**
 * What the Auto chip writes to local storage.
 *
 * Storage cannot hold "the user chose Auto" as null, because null is also what
 * a browser that has never seen the picker returns. The server reads an
 * explicit null effort as Auto and persists it, so sending null from a fresh
 * browser would wipe a default the user set on their phone. The sentinel keeps
 * the two apart: "auto" means chosen, absent means never chose.
 */
export const AUTO_EFFORT_SENTINEL = "auto";

export const SPEEDS: readonly string[] = ["standard", "fast"];
const SPEED_LABELS: Record<string, string> = { standard: "Standard", fast: "Fast" };
export const DEFAULT_SPEED = "standard";

export const VERBOSITIES: readonly string[] = ["low", "medium", "high"];
const VERBOSITY_LABELS: Record<string, string> = {
	low: "Brief",
	medium: "Normal",
	high: "Detailed",
};
export const DEFAULT_VERBOSITY = "medium";

export const MODES: readonly string[] = ["standard", "pro"];
const MODE_LABELS: Record<string, string> = { standard: "Standard", pro: "Pro" };
export const DEFAULT_MODE = "standard";

/** Shown under the MODE chips so Pro is not picked blind. */
export const PRO_MODE_NOTE = "Deeper multi-pass reasoning; slower and pricier";

/**
 * An effort we do not recognise must never draw a chip, because tapping it
 * would send garbage upstream. Anything unknown reads as Auto instead.
 */
export function effortLabel(effort: string | null | undefined): string {
	if (!effort) return AUTO_EFFORT_LABEL;
	return EFFORT_LABELS[effort] ?? AUTO_EFFORT_LABEL;
}

export function speedLabel(speed: string | null | undefined): string {
	return SPEED_LABELS[speed ?? DEFAULT_SPEED] ?? SPEED_LABELS[DEFAULT_SPEED];
}

export function verbosityLabel(verbosity: string | null | undefined): string {
	return VERBOSITY_LABELS[verbosity ?? DEFAULT_VERBOSITY] ?? VERBOSITY_LABELS[DEFAULT_VERBOSITY];
}

export function modeLabel(mode: string | null | undefined): string {
	return MODE_LABELS[mode ?? DEFAULT_MODE] ?? MODE_LABELS[DEFAULT_MODE];
}

/* -------------------------------------------------------------------------- */
/* What a model offers                                                         */
/* -------------------------------------------------------------------------- */

function inVocabulary(values: unknown, vocabulary: readonly string[]): string[] {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value === "string" && vocabulary.includes(value)) seen.add(value);
	}
	return vocabulary.filter((value) => seen.has(value));
}

/**
 * The efforts the model really supports, in canonical order. An unknown value
 * in the payload is dropped rather than rendered.
 */
export function supportedEfforts(model: PickerModel | null | undefined): string[] {
	if (!model) return [];
	return inVocabulary(model.efforts, REASONING_EFFORTS);
}

/** Auto first, then every supported effort. Empty when the model takes none. */
export function effortsFor(model: PickerModel | null | undefined): (string | null)[] {
	const efforts = supportedEfforts(model);
	if (efforts.length === 0) return [];
	return [null, ...efforts];
}

/** Every model has at least the standard speed, even on the older payload. */
export function speedsFor(model: PickerModel | null | undefined): string[] {
	if (!model) return [DEFAULT_SPEED];
	const speeds = inVocabulary(model.speeds, SPEEDS);
	if (speeds.length === 0) return [DEFAULT_SPEED];
	return speeds.includes(DEFAULT_SPEED) ? speeds : [DEFAULT_SPEED, ...speeds];
}

/**
 * Normal is always on the scale, even when the payload omits it, so the LENGTH
 * row can never render without its own default. A model that offers nothing
 * else therefore comes back with one entry, which `optionSections` reads as
 * "no real choice here" and skips. Same rule as Android.
 */
export function verbositiesFor(model: PickerModel | null | undefined): string[] {
	if (!model) return [DEFAULT_VERBOSITY];
	const verbosities = inVocabulary(model.verbosities, VERBOSITIES);
	if (verbosities.includes(DEFAULT_VERBOSITY)) return verbosities;
	return VERBOSITIES.filter(
		(verbosity) => verbosity === DEFAULT_VERBOSITY || verbosities.includes(verbosity),
	);
}

export function modesFor(model: PickerModel | null | undefined): string[] {
	if (!model) return [DEFAULT_MODE];
	const modes = inVocabulary(model.modes, MODES);
	if (modes.length === 0) return [DEFAULT_MODE];
	return modes.includes(DEFAULT_MODE) ? modes : [DEFAULT_MODE, ...modes];
}

/* -------------------------------------------------------------------------- */
/* Stored value -> what the chips show                                         */
/* -------------------------------------------------------------------------- */

/**
 * An effort the current model rejects reads as Auto **without being erased**:
 * a detour through a model with a narrower scale must not cost the setting.
 */
export function visibleEffort(
	stored: string | null | undefined,
	model: PickerModel | null | undefined,
): string | null {
	if (!stored || stored === AUTO_EFFORT_SENTINEL) return null;
	return supportedEfforts(model).includes(stored) ? stored : null;
}

/**
 * The `effort` field of an `/api/ask-question` body, from the stored pref.
 *
 * Three states, three wire shapes:
 * - "auto": the user chose Auto, so send an explicit null and let the server
 *   record that choice.
 * - nothing stored: this browser has never expressed an opinion, so return
 *   `undefined` and let `JSON.stringify` drop the key entirely. Sending null
 *   here would overwrite a default the user set on another device.
 * - anything else: send it as-is and let the server clamp it.
 */
export function effortForRequest(
	stored: string | null | undefined,
): string | null | undefined {
	if (stored === AUTO_EFFORT_SENTINEL) return null;
	if (!stored) return undefined;
	return stored;
}

export function visibleSpeed(
	stored: string | null | undefined,
	model: PickerModel | null | undefined,
): string {
	if (!stored) return DEFAULT_SPEED;
	return speedsFor(model).includes(stored) ? stored : DEFAULT_SPEED;
}

export function visibleVerbosity(
	stored: string | null | undefined,
	model: PickerModel | null | undefined,
): string {
	if (!stored) return DEFAULT_VERBOSITY;
	return verbositiesFor(model).includes(stored) ? stored : DEFAULT_VERBOSITY;
}

export function visibleMode(
	stored: string | null | undefined,
	model: PickerModel | null | undefined,
): string {
	if (!stored) return DEFAULT_MODE;
	return modesFor(model).includes(stored) ? stored : DEFAULT_MODE;
}

/* -------------------------------------------------------------------------- */
/* Option sections                                                             */
/* -------------------------------------------------------------------------- */

export type OptionSectionKey = "reasoning" | "speed" | "verbosity" | "mode";

export interface OptionChip {
	/** Null is the REASONING Auto chip. Other sections use real values. */
	id: string | null;
	label: string;
}

export interface OptionSection {
	key: OptionSectionKey;
	/** Tiny caps heading. */
	title: string;
	/** Spoken name for the chip group. */
	ariaLabel: string;
	chips: OptionChip[];
	/** Muted line under the chips, when the section has a caveat worth reading. */
	note: string | null;
}

/**
 * The chip rows to draw for a model. A section only appears when the model
 * offers more than its default, so a model with one speed never shows a SPEED
 * row that cannot do anything.
 */
export function optionSections(model: PickerModel | null | undefined): OptionSection[] {
	if (!model) return [];
	const sections: OptionSection[] = [];

	const efforts = effortsFor(model);
	if (efforts.length > 0) {
		sections.push({
			key: "reasoning",
			title: "REASONING",
			ariaLabel: "Reasoning effort",
			chips: efforts.map((effort) => ({ id: effort, label: effortLabel(effort) })),
			note: null,
		});
	}

	const speeds = speedsFor(model);
	if (speeds.includes("fast")) {
		sections.push({
			key: "speed",
			title: "SPEED",
			ariaLabel: "Response speed",
			chips: speeds.map((speed) => ({ id: speed, label: speedLabel(speed) })),
			note: model.fastModeNote?.trim() ? model.fastModeNote.trim() : null,
		});
	}

	const verbosities = verbositiesFor(model);
	// One chip is Normal on its own: a row that cannot change anything.
	if (verbosities.length > 1) {
		sections.push({
			key: "verbosity",
			title: "LENGTH",
			ariaLabel: "Answer length",
			chips: verbosities.map((verbosity) => ({
				id: verbosity,
				label: verbosityLabel(verbosity),
			})),
			note: null,
		});
	}

	const modes = modesFor(model);
	if (modes.includes("pro")) {
		sections.push({
			key: "mode",
			title: "MODE",
			ariaLabel: "Reasoning mode",
			chips: modes.map((mode) => ({ id: mode, label: modeLabel(mode) })),
			note: PRO_MODE_NOTE,
		});
	}

	return sections;
}

/** The value a section's chip is compared against to decide `aria-pressed`. */
export function activeChipId(
	section: OptionSectionKey,
	stored: StoredRunOptions,
	model: PickerModel | null | undefined,
): string | null {
	switch (section) {
		case "reasoning":
			return visibleEffort(stored.effort, model);
		case "speed":
			return visibleSpeed(stored.speed, model);
		case "verbosity":
			return visibleVerbosity(stored.verbosity, model);
		case "mode":
			return visibleMode(stored.mode, model);
	}
}

/* -------------------------------------------------------------------------- */
/* Model row presentation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 1050000 -> "1M", 1500000 -> "1.5M", 400000 -> "400K". Millions round to the
 * nearest half so a 1.05M window does not read as 1.1M and a genuine 1.5M
 * window is not flattened to 2M. Matches Android. Null when the server sent
 * nothing usable.
 */
export function formatContextWindow(tokens: number | null | undefined): string | null {
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return null;
	if (tokens >= 1_000_000) return `${Math.round(tokens / 500_000) / 2}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(Math.round(tokens));
}

/** USD per 1M tokens. Whole dollars stay whole; anything else gets cents. */
export function formatPrice(amount: number): string {
	return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * The muted second line of a model row: the curated tagline when there is one,
 * otherwise whatever hard facts the server sent. Null means draw no line.
 */
export function modelMeta(model: PickerModel | null | undefined): string | null {
	if (!model) return null;
	const tagline = model.tagline?.trim();
	if (tagline) return tagline;
	const parts: string[] = [];
	const context = formatContextWindow(model.contextWindow);
	if (context) parts.push(`${context} context`);
	const pricing = model.pricing;
	if (
		pricing &&
		Number.isFinite(pricing.input) &&
		Number.isFinite(pricing.output)
	) {
		parts.push(`${formatPrice(pricing.input)} / ${formatPrice(pricing.output)} per M`);
	}
	return parts.length > 0 ? parts.join(SUMMARY_SEPARATOR) : null;
}

/** At most three, in a fixed order, so rows stay scannable. */
export function capabilityPills(model: PickerModel | null | undefined): string[] {
	if (!model) return [];
	const pills: string[] = [];
	if (model.supportsAttachments) pills.push("Files");
	if (speedsFor(model).includes("fast")) pills.push("Fast");
	if (modesFor(model).includes("pro")) pills.push("Pro");
	return pills.slice(0, 3);
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

/** Above this many models the accordions alone stop being findable. */
export const SEARCH_THRESHOLD = 8;

export function shouldShowSearch(models: PickerModel[] | null | undefined): boolean {
	if (!models) return false;
	return models.filter((model) => model.available).length > SEARCH_THRESHOLD;
}

/**
 * Flat, cross-provider filter on label or id. An empty query returns every
 * available model, so the caller can use this for the unfiltered list too.
 */
export function searchModels(
	models: PickerModel[] | null | undefined,
	query: string,
): PickerModel[] {
	const available = (models ?? []).filter((model) => model.available);
	const needle = query.trim().toLowerCase();
	if (!needle) return available;
	return available.filter(
		(model) =>
			model.label.toLowerCase().includes(needle) ||
			model.id.toLowerCase().includes(needle),
	);
}

/* -------------------------------------------------------------------------- */
/* Trigger chip                                                                */
/* -------------------------------------------------------------------------- */

/**
 * "GPT-5.6 Luna · High · Fast · Detailed" - the model, then only the options
 * that differ from the default. Auto effort contributes nothing, because Auto
 * is the absence of a choice.
 */
export function summaryLabel(
	model: PickerModel | null | undefined,
	stored: StoredRunOptions,
	fallbackLabel = "Model",
): string {
	const label = model?.label ?? fallbackLabel;
	const parts: string[] = [];

	const effort = visibleEffort(stored.effort, model);
	if (effort) parts.push(effortLabel(effort));

	if (visibleSpeed(stored.speed, model) !== DEFAULT_SPEED) {
		parts.push(speedLabel(visibleSpeed(stored.speed, model)));
	}

	const verbosity = visibleVerbosity(stored.verbosity, model);
	if (verbosity !== DEFAULT_VERBOSITY) parts.push(verbosityLabel(verbosity));

	if (visibleMode(stored.mode, model) !== DEFAULT_MODE) {
		parts.push(modeLabel(visibleMode(stored.mode, model)));
	}

	return parts.length > 0 ? [label, ...parts].join(SUMMARY_SEPARATOR) : label;
}
