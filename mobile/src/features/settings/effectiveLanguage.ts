/**
 * The device half of the answer language: reads the first preferred locale
 * from expo-localization and resolves the account's choice against it. Sent as
 * `language` with every chat and verse insight request.
 */
import { getLocales } from "expo-localization";
import type { BibleLanguage } from "@/features/bible/translations";
import { resolveAnswerLanguage, type AnswerLanguage } from "./answerLanguage";

/** The device's first preferred language code ("es"), or null when it cannot be read. */
export function deviceLanguageCode(): string | null {
	try {
		return getLocales()[0]?.languageCode ?? null;
	} catch {
		return null;
	}
}

export function effectiveAnswerLanguage(choice: AnswerLanguage): BibleLanguage {
	return resolveAnswerLanguage(choice, choice === "auto" ? deviceLanguageCode() : null);
}
