import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("react-native", () => ({ useColorScheme: () => "dark" }));
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "en" }] }));
vi.mock("@react-native-async-storage/async-storage", () => ({
	default: {
		getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
		setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
	},
}));

beforeEach(() => { storage.clear(); vi.resetModules(); });

describe("existing text size preference persistence", () => {
	it("updates offline immediately and restores the choice after restart", async () => {
		const store = await import("./settingsStore");
		await store.hydrateSettings();
		store.setTextScale("largest");
		expect(store.getSettings().textScale).toBe("largest");
		vi.resetModules();
		const restarted = await import("./settingsStore");
		await restarted.hydrateSettings();
		expect(restarted.getSettings().textScale).toBe("largest");
	});

	it("falls back to Standard for a corrupted persisted size", async () => {
		storage.set("sureword.settings.v1", JSON.stringify({ textScale: "unlimited" }));
		const store = await import("./settingsStore");
		await store.hydrateSettings();
		expect(store.getSettings().textScale).toBe("standard");
	});

	it("keeps the existing account write-through and rolls back a rejected choice", async () => {
		const store = await import("./settingsStore");
		const writer = vi.fn();
		store.setPreferencesWriter(writer);
		store.setTextScale("large");
		expect(writer).toHaveBeenCalledWith({ textScale: "large" }, expect.any(Function));
		const revert = writer.mock.calls[0][1] as () => void;
		revert();
		expect(store.getSettings().textScale).toBe("standard");
	});
});
