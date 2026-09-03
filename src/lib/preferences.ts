import {
	DEFAULT_LISTEN_RATE,
	LISTEN_RATE_PREF_KEY,
	normalizeListenRate,
} from "@/components/cross/listen";
import type { TranslationId } from "@/lib/bible/translations";

/**
 * Client-side user preferences shared across the web app. The Android app
 * persists the same choices in AsyncStorage ("sureword.settings.v1"); on web
 * they live in localStorage.
 */

export const TRANSLATION_PREF_KEY = "sureword-translation";

export function readTranslationPref(): TranslationId {
	if (typeof window === "undefined") return "KJV";
	return window.localStorage.getItem(TRANSLATION_PREF_KEY) === "NKJV" ? "NKJV" : "KJV";
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

export function writeModelPref(modelId: string) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(MODEL_PREF_KEY, modelId);
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

/** Client helpers for /api/preferences (Settings → Web Search toggle). */
async function parsePreferencesError(res: Response): Promise<never> {
	const data = (await res.json().catch(() => null)) as { error?: string } | null;
	throw new Error(data?.error ?? `Request failed (${res.status})`);
}

export async function fetchWebSearchEnabled(): Promise<{ webSearchEnabled: boolean }> {
	const res = await fetch("/api/preferences", { credentials: "same-origin" });
	if (!res.ok) return parsePreferencesError(res);
	return (await res.json()) as { webSearchEnabled: boolean };
}

export async function setWebSearchEnabled(
	webSearchEnabled: boolean
): Promise<{ webSearchEnabled: boolean }> {
	const res = await fetch("/api/preferences", {
		method: "PATCH",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ webSearchEnabled }),
	});
	if (!res.ok) return parsePreferencesError(res);
	return (await res.json()) as { webSearchEnabled: boolean };
}

/**
 * Listen playback speed. Per-device on purpose: a speed someone picked on this
 * machine is a habit, not an account preference worth a round trip. Android
 * keeps the same value in its settings store.
 */
export function readListenRatePref(): number {
	if (typeof window === "undefined") return DEFAULT_LISTEN_RATE;
	return normalizeListenRate(window.localStorage.getItem(LISTEN_RATE_PREF_KEY));
}

export function writeListenRatePref(rate: number) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(LISTEN_RATE_PREF_KEY, String(normalizeListenRate(rate)));
}
