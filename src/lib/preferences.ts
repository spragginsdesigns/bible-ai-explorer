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
