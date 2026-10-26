/**
 * The language SureWord answers in (Settings > Language). The account stores a
 * choice, `"auto"` by default, synced through `/api/preferences` like
 * `textScale`; `"auto"` follows the device. See docs/languages/PLAN.md,
 * "Implementation contract".
 *
 * Pure on purpose: the device's locale is passed in, so the logic tests run in
 * Node. `effectiveLanguage.ts` reads it from expo-localization.
 */
import {
	BIBLE_LANGUAGE_NAMES,
	BIBLE_LANGUAGES,
	LANGUAGE_BIBLES,
	TRANSLATIONS,
	type BibleLanguage,
	type TranslationId,
} from "@/features/bible/translations";

export const ANSWER_LANGUAGES = ["auto", "en", "es", "de"] as const;
export type AnswerLanguage = (typeof ANSWER_LANGUAGES)[number];
export const DEFAULT_ANSWER_LANGUAGE: AnswerLanguage = "auto";

export function isAnswerLanguage(value: unknown): value is AnswerLanguage {
	return typeof value === "string" && (ANSWER_LANGUAGES as readonly string[]).includes(value);
}

export function normalizeAnswerLanguage(value: unknown): AnswerLanguage {
	return isAnswerLanguage(value) ? value : DEFAULT_ANSWER_LANGUAGE;
}

function isBibleLanguage(value: unknown): value is BibleLanguage {
	return typeof value === "string" && (BIBLE_LANGUAGES as readonly string[]).includes(value);
}

/**
 * The language a device's first preferred locale asks for, when SureWord
 * speaks it. English is the fallback, so a French phone gets English answers.
 */
export function deviceAnswerLanguage(languageCode: string | null | undefined): BibleLanguage {
	const code = languageCode?.trim().toLowerCase();
	return code === "es" || code === "de" ? code : "en";
}

/** The explicit choice, else the device's language when SureWord speaks it, else English. */
export function resolveAnswerLanguage(
	choice: AnswerLanguage,
	deviceLanguageCode: string | null | undefined
): BibleLanguage {
	return isBibleLanguage(choice) ? choice : deviceAnswerLanguage(deviceLanguageCode);
}

/** "Follow my device (Español)", or a language's own name. */
export function answerLanguageOptionLabel(
	choice: AnswerLanguage,
	deviceLanguageCode: string | null | undefined
): string {
	if (choice === "auto") {
		return `Follow my device (${BIBLE_LANGUAGE_NAMES[deviceAnswerLanguage(deviceLanguageCode)]})`;
	}
	return BIBLE_LANGUAGE_NAMES[choice];
}

/**
 * The Bible to open after choosing a language: the current one when it is
 * already in that language (a BSB reader who picks English keeps the BSB),
 * otherwise that language's own Bible.
 */
export function bibleForLanguage(current: TranslationId, language: BibleLanguage): TranslationId {
	return TRANSLATIONS[current].language === language ? current : LANGUAGE_BIBLES[language];
}
