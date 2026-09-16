import {
	DEFAULT_LISTEN_RATE,
	LISTEN_RATE_PREF_KEY,
	normalizeListenRate,
} from "@/components/cross/listen";
import type { TranslationId } from "@/lib/bible/translations";
import {
	HIGHLIGHT_COLOR_IDS,
	HIGHLIGHT_LABEL_PRESETS as HIGHLIGHT_LABEL_PRESET_ROWS,
	MAX_ABOUT_ME_LENGTH,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	MAX_HIGHLIGHT_MEANING_LENGTH,
	highlightLabelFor,
	type HighlightLabels,
	type HighlightMeanings,
} from "@/lib/preferences-contract";

export type HighlightLabelId =
	| "yellow"
	| "orange"
	| "red"
	| "pink"
	| "purple"
	| "blue"
	| "teal"
	| "green";
export type { HighlightLabels, HighlightMeanings };
export {
	highlightLabelFor,
	MAX_ABOUT_ME_LENGTH,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	MAX_HIGHLIGHT_MEANING_LENGTH,
};

export const HIGHLIGHT_LABEL_IDS = HIGHLIGHT_COLOR_IDS as readonly HighlightLabelId[];
export const EMPTY_HIGHLIGHT_LABELS: HighlightLabels = Object.freeze({});
export const EMPTY_HIGHLIGHT_MEANINGS: HighlightMeanings = Object.freeze({});

/**
 * The starter set behind "Use suggested labels", re-exported with the colour id
 * narrowed: the contract module has no runtime imports and so cannot name
 * `HighlightLabelId`, but every id in it is one by construction (the contract
 * test pins the list to `HIGHLIGHT_COLOR_IDS`).
 */
export const HIGHLIGHT_LABEL_PRESETS = HIGHLIGHT_LABEL_PRESET_ROWS as readonly {
	id: HighlightLabelId;
	label: string;
	meaning: string;
}[];

function isHighlightLabelId(value: string): value is HighlightLabelId {
	return (HIGHLIGHT_LABEL_IDS as readonly string[]).includes(value);
}

/**
 * Labels and meanings are the same shape, keyed by the same eight ids, and
 * differ only in how long an entry may be, so one reader serves both.
 */
function normalizeColorMap(
	value: unknown,
	maxLength: number,
	empty: Record<string, string>
): Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return empty;
	}
	const map: Record<string, string> = {};
	for (const [id, raw] of Object.entries(value)) {
		if (!isHighlightLabelId(id) || typeof raw !== "string") continue;
		const entry = raw.trim().slice(0, maxLength);
		if (entry) map[id] = entry;
	}
	return Object.keys(map).length > 0 ? map : empty;
}

function mergeColorMapEdits(
	base: Record<string, string>,
	edits: Partial<Record<HighlightLabelId, string>>,
	maxLength: number,
	empty: Record<string, string>
): Record<string, string> {
	const merged: Record<string, string> = { ...normalizeColorMap(base, maxLength, empty) };
	for (const id of HIGHLIGHT_LABEL_IDS) {
		if (!Object.prototype.hasOwnProperty.call(edits, id)) continue;
		const entry = (edits[id] ?? "").trim().slice(0, maxLength);
		if (entry) merged[id] = entry;
		else delete merged[id];
	}
	return normalizeColorMap(merged, maxLength, empty);
}

/** Normalize either a server document or the local cache to the public contract. */
export function normalizeHighlightLabels(value: unknown): HighlightLabels {
	return normalizeColorMap(value, MAX_HIGHLIGHT_LABEL_LENGTH, EMPTY_HIGHLIGHT_LABELS);
}

/** Same read for the meanings map, which only differs in its length cap. */
export function normalizeHighlightMeanings(value: unknown): HighlightMeanings {
	return normalizeColorMap(value, MAX_HIGHLIGHT_MEANING_LENGTH, EMPTY_HIGHLIGHT_MEANINGS);
}

/** Apply only the rows the user edited to the freshest whole map from the server. */
export function mergeHighlightLabelEdits(
	base: HighlightLabels,
	edits: Partial<Record<HighlightLabelId, string>>
): HighlightLabels {
	return mergeColorMapEdits(base, edits, MAX_HIGHLIGHT_LABEL_LENGTH, EMPTY_HIGHLIGHT_LABELS);
}

export function mergeHighlightMeaningEdits(
	base: HighlightMeanings,
	edits: Partial<Record<HighlightLabelId, string>>
): HighlightMeanings {
	return mergeColorMapEdits(base, edits, MAX_HIGHLIGHT_MEANING_LENGTH, EMPTY_HIGHLIGHT_MEANINGS);
}

/**
 * Client-side user preferences shared across the web app. The Android app
 * persists the same choices in AsyncStorage ("sureword.settings.v1"); on web
 * they live in localStorage.
 *
 * These are a cache of the account document, not the store of record: the
 * server row is the source of truth and `src/lib/preferencesSync.ts` owns the
 * hydrate/write-through pipe. Everything here stays a plain local read or
 * write so first paint never waits on the network - go through the setters in
 * preferencesSync for anything a user changed, so the other clients follow.
 */

export const TRANSLATION_PREF_KEY = "sureword-translation";

/** Cached account labels. Absence means this account has not hydrated yet. */
export const HIGHLIGHT_LABELS_PREF_KEY = "sureword-highlight-labels";

let cachedHighlightLabelsRaw: string | null | undefined;
let cachedHighlightLabels: HighlightLabels | null = null;

export function readHighlightLabelsPref(): HighlightLabels | null {
	if (typeof window === "undefined") return null;
	const raw = window.localStorage.getItem(HIGHLIGHT_LABELS_PREF_KEY);
	if (raw === cachedHighlightLabelsRaw) return cachedHighlightLabels;
	cachedHighlightLabelsRaw = raw;
	if (raw === null) {
		cachedHighlightLabels = null;
		return null;
	}
	try {
		cachedHighlightLabels = normalizeHighlightLabels(JSON.parse(raw));
	} catch {
		cachedHighlightLabels = EMPTY_HIGHLIGHT_LABELS;
	}
	return cachedHighlightLabels;
}

export function writeHighlightLabelsPref(labels: HighlightLabels): void {
	if (typeof window === "undefined") return;
	const normalized = normalizeHighlightLabels(labels);
	const raw = JSON.stringify(normalized);
	window.localStorage.setItem(HIGHLIGHT_LABELS_PREF_KEY, raw);
	cachedHighlightLabelsRaw = raw;
	cachedHighlightLabels = normalized;
}

/**
 * Cached account meanings, alongside the labels. Same absence rule: null means
 * this account has not hydrated yet, so Settings shows its loading row rather
 * than eight empty fields it might be about to overwrite.
 */
export const HIGHLIGHT_MEANINGS_PREF_KEY = "sureword-highlight-meanings";

let cachedHighlightMeaningsRaw: string | null | undefined;
let cachedHighlightMeanings: HighlightMeanings | null = null;

export function readHighlightMeaningsPref(): HighlightMeanings | null {
	if (typeof window === "undefined") return null;
	const raw = window.localStorage.getItem(HIGHLIGHT_MEANINGS_PREF_KEY);
	if (raw === cachedHighlightMeaningsRaw) return cachedHighlightMeanings;
	cachedHighlightMeaningsRaw = raw;
	if (raw === null) {
		cachedHighlightMeanings = null;
		return null;
	}
	try {
		cachedHighlightMeanings = normalizeHighlightMeanings(JSON.parse(raw));
	} catch {
		cachedHighlightMeanings = EMPTY_HIGHLIGHT_MEANINGS;
	}
	return cachedHighlightMeanings;
}

export function writeHighlightMeaningsPref(meanings: HighlightMeanings): void {
	if (typeof window === "undefined") return;
	const normalized = normalizeHighlightMeanings(meanings);
	const raw = JSON.stringify(normalized);
	window.localStorage.setItem(HIGHLIGHT_MEANINGS_PREF_KEY, raw);
	cachedHighlightMeaningsRaw = raw;
	cachedHighlightMeanings = normalized;
}

/**
 * The user's "About me", cached whole. The stored string may legitimately be
 * empty (they erased it), which is why absence rather than "" is what stands
 * for "not hydrated yet".
 */
export const ABOUT_ME_PREF_KEY = "sureword-about-me";

export function readAboutMePref(): string | null {
	if (typeof window === "undefined") return null;
	const raw = window.localStorage.getItem(ABOUT_ME_PREF_KEY);
	if (raw === null) return null;
	return raw.slice(0, MAX_ABOUT_ME_LENGTH);
}

export function writeAboutMePref(aboutMe: string): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(ABOUT_ME_PREF_KEY, aboutMe.slice(0, MAX_ABOUT_ME_LENGTH));
}

export function readTranslationPref(): TranslationId {
	if (typeof window === "undefined") return "KJV";
	const saved = window.localStorage.getItem(TRANSLATION_PREF_KEY);
	return saved === "BSB" || saved === "NKJV" ? saved : "KJV";
}

export function writeTranslationPref(translation: TranslationId) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(TRANSLATION_PREF_KEY, translation);
}

/** Bible reader parchment page surface (Settings → Appearance). Default on. */
export const PARCHMENT_PREF_KEY = "sureword-parchment";

export function readParchmentPref(): boolean {
	if (typeof window === "undefined") return true;
	return window.localStorage.getItem(PARCHMENT_PREF_KEY) !== "false";
}

export function writeParchmentPref(enabled: boolean) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(PARCHMENT_PREF_KEY, String(enabled));
}

/**
 * Chat model/effort picks. Sent with every chat request; the server persists
 * the last choice as the account default so other clients follow along.
 * Null means "no local pick" — the server falls back to the account default.
 */
export const MODEL_PREF_KEY = "sureword-model";
export const EFFORT_PREF_KEY = "sureword-effort";

export function readModelPref(): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(MODEL_PREF_KEY);
}

export function writeModelPref(modelId: string | null) {
	if (typeof window === "undefined") return;
	if (modelId) window.localStorage.setItem(MODEL_PREF_KEY, modelId);
	else window.localStorage.removeItem(MODEL_PREF_KEY);
}

export function readEffortPref(): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(EFFORT_PREF_KEY);
}

export function writeEffortPref(effort: string | null) {
	if (typeof window === "undefined") return;
	if (effort) window.localStorage.setItem(EFFORT_PREF_KEY, effort);
	else window.localStorage.removeItem(EFFORT_PREF_KEY);
}

/**
 * The other three per-request run options the model picker owns: response
 * speed, answer length and reasoning mode. Same shape as the effort pref:
 * null removes the key rather than storing "null", because absent means "no
 * local pick" and the server then applies the account default.
 */
export const SPEED_PREF_KEY = "sureword-speed";
export const VERBOSITY_PREF_KEY = "sureword-verbosity";
export const MODE_PREF_KEY = "sureword-mode";

function readOptionalPref(key: string): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(key);
}

function writeOptionalPref(key: string, value: string | null) {
	if (typeof window === "undefined") return;
	if (value) window.localStorage.setItem(key, value);
	else window.localStorage.removeItem(key);
}

export function readSpeedPref(): string | null {
	return readOptionalPref(SPEED_PREF_KEY);
}

export function writeSpeedPref(speed: string | null) {
	writeOptionalPref(SPEED_PREF_KEY, speed);
}

export function readVerbosityPref(): string | null {
	return readOptionalPref(VERBOSITY_PREF_KEY);
}

export function writeVerbosityPref(verbosity: string | null) {
	writeOptionalPref(VERBOSITY_PREF_KEY, verbosity);
}

export function readModePref(): string | null {
	return readOptionalPref(MODE_PREF_KEY);
}

export function writeModePref(mode: string | null) {
	writeOptionalPref(MODE_PREF_KEY, mode);
}

/**
 * Local caches of the server-persisted feature toggles (User.memoryEnabled,
 * User.webSearchEnabled). The settings screen seeds its toggle state from
 * these so a returning user sees the right position on first paint instead of
 * "off" while the GET round-trips; the server value then replaces the cache.
 */
export const MEMORY_ENABLED_PREF_KEY = "sureword-memory-enabled";
export const WEB_SEARCH_ENABLED_PREF_KEY = "sureword-web-search-enabled";

function readBooleanPref(key: string): boolean | null {
	if (typeof window === "undefined") return null;
	const value = window.localStorage.getItem(key);
	return value === "true" ? true : value === "false" ? false : null;
}

export function readMemoryEnabledPref(): boolean | null {
	return readBooleanPref(MEMORY_ENABLED_PREF_KEY);
}

export function writeMemoryEnabledPref(enabled: boolean) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(MEMORY_ENABLED_PREF_KEY, String(enabled));
}

export function readWebSearchEnabledPref(): boolean | null {
	return readBooleanPref(WEB_SEARCH_ENABLED_PREF_KEY);
}

export function writeWebSearchEnabledPref(enabled: boolean) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(WEB_SEARCH_ENABLED_PREF_KEY, String(enabled));
}

/**
 * Listen playback speed. Synced with the account like the rest of this file;
 * Android keeps the same value in its settings store.
 */
export function readListenRatePref(): number {
	if (typeof window === "undefined") return DEFAULT_LISTEN_RATE;
	return normalizeListenRate(window.localStorage.getItem(LISTEN_RATE_PREF_KEY));
}

export function writeListenRatePref(rate: number) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(LISTEN_RATE_PREF_KEY, String(normalizeListenRate(rate)));
}
