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
