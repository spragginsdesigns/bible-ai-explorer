import { describe, expect, it } from "vitest";

import {
	PREFERENCES_REFRESH_INTERVAL_MS,
	DEFAULT_SYNCED_SETTINGS,
	cacheDiscardFor,
	overridesToPush,
	parsePreferencesDocument,
	settingsFromDocument,
	shouldApplyResponse,
	shouldFetchNow,
	type PreferencesDocument,
} from "@/features/settings/preferences";

const FULL_DOCUMENT = {
	plan: "pro",
	webSearchEnabled: false,
	memoryEnabled: false,
	translation: "NKJV",
	parchment: false,
	listenRate: 1.5,
	chat: {
		modelId: "openai/gpt-5.6-luna",
		effort: "high",
		speed: "fast",
		verbosity: "low",
		mode: "pro",
	},
};

describe("parsePreferencesDocument", () => {
	it("reads a full document unchanged", () => {
		expect(parsePreferencesDocument(FULL_DOCUMENT)).toEqual({
			plan: "pro",
			webSearchEnabled: false,
			memoryEnabled: false,
			translation: "NKJV",
			parchment: false,
			listenRate: 1.5,
			chat: {
				modelId: "openai/gpt-5.6-luna",
				effort: "high",
				speed: "fast",
				verbosity: "low",
				mode: "pro",
			},
		});
	});

	it("falls back to the documented defaults for an empty document", () => {
		expect(parsePreferencesDocument({})).toEqual({
			plan: "free",
			webSearchEnabled: true,
			memoryEnabled: true,
			translation: "KJV",
			parchment: true,
			listenRate: 1,
			chat: { modelId: null, effort: null, speed: null, verbosity: null, mode: null },
		});
	});

	it("normalizes a listen rate this build does not offer", () => {
		expect(parsePreferencesDocument({ listenRate: 3 })?.listenRate).toBe(1);
		expect(parsePreferencesDocument({ listenRate: "0.75" })?.listenRate).toBe(0.75);
	});

	it("keeps an unknown translation on KJV", () => {
		expect(parsePreferencesDocument({ translation: "ESV" })?.translation).toBe("KJV");
	});

	it("reads a non-string chat value as never chosen", () => {
		const doc = parsePreferencesDocument({ chat: { modelId: 7, effort: "", speed: null } });
		expect(doc?.chat).toEqual({
			modelId: null,
			effort: null,
			speed: null,
			verbosity: null,
			mode: null,
		});
	});

	it("rejects anything that is not an object", () => {
		expect(parsePreferencesDocument(null)).toBeNull();
		expect(parsePreferencesDocument("<html>error</html>")).toBeNull();
		expect(parsePreferencesDocument([FULL_DOCUMENT])).toBeNull();
	});
});

describe("settingsFromDocument", () => {
	it("maps the document onto the settings store's field names", () => {
		const doc = parsePreferencesDocument(FULL_DOCUMENT) as PreferencesDocument;
		expect(settingsFromDocument(doc)).toEqual({
			translation: "NKJV",
			parchment: false,
			listenRate: 1.5,
			chatModelId: "openai/gpt-5.6-luna",
			chatEffort: "high",
			chatSpeed: "fast",
			chatVerbosity: "low",
			chatMode: "pro",
		});
	});

	it("carries no theme mode, which stays a device setting", () => {
		const doc = parsePreferencesDocument({}) as PreferencesDocument;
		expect(Object.keys(settingsFromDocument(doc))).not.toContain("themeMode");
	});
});

describe("shouldApplyResponse", () => {
	it("applies a response when no edit happened while it was in flight", () => {
		expect(shouldApplyResponse(4, 4)).toBe(true);
	});

	it("discards a response the user has already overtaken", () => {
		expect(shouldApplyResponse(4, 5)).toBe(false);
	});
});

describe("shouldFetchNow", () => {
	it("always fetches when nothing has been fetched yet", () => {
		expect(shouldFetchNow(null, 1_000)).toBe(true);
	});

	it("throttles a second foreground inside the interval", () => {
		expect(shouldFetchNow(1_000, 1_000 + PREFERENCES_REFRESH_INTERVAL_MS - 1)).toBe(false);
	});

	it("fetches again once the interval has passed", () => {
		expect(shouldFetchNow(1_000, 1_000 + PREFERENCES_REFRESH_INTERVAL_MS)).toBe(true);
	});
});

describe("overridesToPush", () => {
	const defaults = DEFAULT_SYNCED_SETTINGS;

	it("pushes nothing when the device holds only defaults", () => {
		expect(overridesToPush(defaults, defaults)).toBeNull();
	});

	it("pushes a local choice into a column the account never wrote", () => {
		expect(overridesToPush({ ...defaults, translation: "NKJV" }, defaults)).toEqual({
			translation: "NKJV",
		});
	});

	it("lets an established account win over a stale local default", () => {
		expect(overridesToPush(defaults, { ...defaults, translation: "NKJV" })).toBeNull();
	});

	it("pushes only the columns the account has not written", () => {
		expect(
			overridesToPush(
				{ ...defaults, translation: "KJV", listenRate: 1.5 },
				{ ...defaults, translation: "NKJV", listenRate: 1 }
			)
		).toEqual({ listenRate: 1.5 });
	});

	it("nests only the unwritten chat columns", () => {
		expect(
			overridesToPush(
				{ ...defaults, chatModelId: "openai/gpt-5.6-luna", chatSpeed: "fast" },
				{ ...defaults, chatSpeed: "standard" }
			)
		).toEqual({ chat: { modelId: "openai/gpt-5.6-luna" } });
	});
});

describe("cacheDiscardFor", () => {
	it("keeps the cache for the account that wrote it", () => {
		expect(cacheDiscardFor("user_a", "user_a")).toBe("none");
	});

	it("discards everything a different account left behind", () => {
		expect(cacheDiscardFor("user_a", "user_b")).toBe("all");
	});

	it("discards only the private caches when no owner was recorded", () => {
		expect(cacheDiscardFor(null, "user_a")).toBe("private");
	});
});
