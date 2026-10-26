import { afterEach, describe, expect, it, vi } from "vitest";

const getLocales = vi.fn();
vi.mock("expo-localization", () => ({ getLocales: () => getLocales() }));

import {
	ANSWER_LANGUAGES,
	DEFAULT_ANSWER_LANGUAGE,
	answerLanguageOptionLabel,
	bibleForLanguage,
	deviceAnswerLanguage,
	normalizeAnswerLanguage,
	resolveAnswerLanguage,
} from "./answerLanguage";
import { deviceLanguageCode, effectiveAnswerLanguage } from "./effectiveLanguage";

afterEach(() => {
	getLocales.mockReset();
});

describe("answer language choices", () => {
	it("offers Follow my device first, then each language, and defaults to it", () => {
		expect(ANSWER_LANGUAGES).toEqual(["auto", "en", "es", "de"]);
		expect(DEFAULT_ANSWER_LANGUAGE).toBe("auto");
	});

	it("normalizes anything unknown to auto", () => {
		expect(normalizeAnswerLanguage("de")).toBe("de");
		expect(normalizeAnswerLanguage("fr")).toBe("auto");
		expect(normalizeAnswerLanguage(undefined)).toBe("auto");
	});
});

describe("resolveAnswerLanguage", () => {
	it("uses an explicit choice whatever the device says", () => {
		expect(resolveAnswerLanguage("de", "es")).toBe("de");
		expect(resolveAnswerLanguage("en", "es")).toBe("en");
	});

	it("follows a Spanish or German device under auto", () => {
		expect(resolveAnswerLanguage("auto", "es")).toBe("es");
		expect(resolveAnswerLanguage("auto", "de")).toBe("de");
		expect(resolveAnswerLanguage("auto", "ES")).toBe("es");
	});

	it("falls back to English for any other or unknown device language", () => {
		expect(resolveAnswerLanguage("auto", "fr")).toBe("en");
		expect(resolveAnswerLanguage("auto", null)).toBe("en");
		expect(deviceAnswerLanguage(undefined)).toBe("en");
	});
});

describe("answerLanguageOptionLabel", () => {
	it("names what Follow my device resolved to", () => {
		expect(answerLanguageOptionLabel("auto", "es")).toBe("Follow my device (Español)");
		expect(answerLanguageOptionLabel("auto", "pt")).toBe("Follow my device (English)");
	});

	it("names each language in that language", () => {
		expect(answerLanguageOptionLabel("en", "es")).toBe("English");
		expect(answerLanguageOptionLabel("es", null)).toBe("Español");
		expect(answerLanguageOptionLabel("de", null)).toBe("Deutsch");
	});
});

describe("bibleForLanguage", () => {
	it("opens the language's own Bible when the current one is in another language", () => {
		expect(bibleForLanguage("KJV", "es")).toBe("RV1909");
		expect(bibleForLanguage("NKJV", "de")).toBe("LUT1912");
		expect(bibleForLanguage("RV1909", "de")).toBe("LUT1912");
		expect(bibleForLanguage("LUT1912", "en")).toBe("KJV");
	});

	it("keeps a Bible already in that language", () => {
		expect(bibleForLanguage("BSB", "en")).toBe("BSB");
		expect(bibleForLanguage("RV1909", "es")).toBe("RV1909");
	});
});

describe("effectiveAnswerLanguage (device locale)", () => {
	it("reads the first preferred locale under auto", () => {
		getLocales.mockReturnValue([{ languageCode: "de" }, { languageCode: "en" }]);
		expect(deviceLanguageCode()).toBe("de");
		expect(effectiveAnswerLanguage("auto")).toBe("de");
	});

	it("uses only the first locale, so a second Spanish one does not count", () => {
		getLocales.mockReturnValue([{ languageCode: "fr" }, { languageCode: "es" }]);
		expect(effectiveAnswerLanguage("auto")).toBe("en");
	});

	it("ignores the device for an explicit choice", () => {
		getLocales.mockReturnValue([{ languageCode: "de" }]);
		expect(effectiveAnswerLanguage("es")).toBe("es");
	});

	it("answers in English when the locale cannot be read", () => {
		getLocales.mockImplementation(() => {
			throw new Error("native module missing");
		});
		expect(deviceLanguageCode()).toBeNull();
		expect(effectiveAnswerLanguage("auto")).toBe("en");
		getLocales.mockReturnValue([{ languageCode: null }]);
		expect(effectiveAnswerLanguage("auto")).toBe("en");
	});
});
