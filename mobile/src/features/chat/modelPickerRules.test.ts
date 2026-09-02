import { describe, expect, it, vi } from "vitest";

// The rules module reads PROVIDER_LABELS from aiApi, which pulls in the Expo
// networking layer; stub it the way api.test.ts does so this stays a node test.
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import type { AiModel, AiModelsResponse } from "@/features/settings/aiApi";
import {
	houseMode,
	modelsForProvider,
	selectModelId,
	visibleProviders,
} from "./modelPickerRules";

const model = (id: string, provider: string, available = true): AiModel => ({
	id,
	label: id,
	provider,
	supportsAttachments: false,
	efforts: ["low", "medium", "high"],
	available,
});

const keysPayload = (overrides: Partial<AiModelsResponse> = {}): AiModelsResponse => ({
	access: "keys",
	providers: [{ id: "openai", label: "OpenAI", available: true }],
	models: [model("gpt-5.6", "openai"), model("gpt-5.6-mini", "openai")],
	defaults: { modelId: "gpt-5.6", effort: null },
	house: null,
	...overrides,
});

const housePayload = (): AiModelsResponse => ({
	access: "house",
	providers: [],
	models: [model("gpt-5.6-luna", "openai")],
	defaults: { modelId: "gpt-5.6-luna", effort: "medium" },
	house: {
		modelId: "gpt-5.6-luna",
		label: "GPT-5.6 Luna",
		effort: "medium",
		note: "Included with SureWord. Add your own API key in Settings to choose other models.",
	},
});

describe("houseMode", () => {
	it("returns the house block only in house mode", () => {
		expect(houseMode(housePayload())?.modelId).toBe("gpt-5.6-luna");
		expect(houseMode(keysPayload())).toBeNull();
		expect(houseMode(null)).toBeNull();
	});

	it("stays null when the server claims house mode but sends no block", () => {
		expect(houseMode({ ...housePayload(), house: null })).toBeNull();
	});
});

describe("selectModelId", () => {
	it("keeps a stored pick the server still offers", () => {
		expect(selectModelId("gpt-5.6-mini", keysPayload())).toBe("gpt-5.6-mini");
	});

	it("falls back to the server default for an unknown or revoked pick", () => {
		expect(selectModelId("claude-opus-5", keysPayload())).toBe("gpt-5.6");
		const revoked = keysPayload({
			models: [model("gpt-5.6", "openai"), model("gpt-5.6-mini", "openai", false)],
		});
		expect(selectModelId("gpt-5.6-mini", revoked)).toBe("gpt-5.6");
	});

	it("pins the house model regardless of what is stored", () => {
		expect(selectModelId("claude-opus-5", housePayload())).toBe("gpt-5.6-luna");
	});

	it("has nothing to select before the payload lands", () => {
		expect(selectModelId("gpt-5.6", null)).toBeNull();
	});
});

describe("visibleProviders", () => {
	it("drops locked providers instead of showing an add-a-key row", () => {
		const data = keysPayload({
			providers: [
				{ id: "openai", label: "OpenAI", available: true },
				{ id: "anthropic", label: "Anthropic", available: false },
			],
			models: [model("gpt-5.6", "openai"), model("claude-opus-5", "anthropic", false)],
		});
		expect(visibleProviders(data).map((provider) => provider.id)).toEqual(["openai"]);
	});

	it("drops an unlocked provider that listed no models", () => {
		const data = keysPayload({
			providers: [
				{ id: "openai", label: "OpenAI", available: true },
				{ id: "moonshot", label: "Moonshot", available: true },
			],
		});
		expect(visibleProviders(data).map((provider) => provider.id)).toEqual(["openai"]);
	});

	it("derives rows from the flat list when an older server omits providers", () => {
		const data = keysPayload({
			access: undefined,
			providers: undefined,
			models: [
				model("gpt-5.6", "openai"),
				model("claude-opus-5", "anthropic"),
				model("kimi", "moonshot", false),
			],
		});
		expect(visibleProviders(data)).toEqual([
			{ id: "openai", label: "OpenAI", available: true },
			{ id: "anthropic", label: "Anthropic", available: true },
		]);
	});

	it("shows no provider rows in house mode", () => {
		expect(visibleProviders(housePayload())).toEqual([]);
		expect(visibleProviders(null)).toEqual([]);
	});
});

describe("modelsForProvider", () => {
	it("returns only that provider's available models", () => {
		const data = keysPayload({
			models: [
				model("gpt-5.6", "openai"),
				model("gpt-5.6-mini", "openai", false),
				model("claude-opus-5", "anthropic"),
			],
		});
		expect(modelsForProvider(data, "openai").map((entry) => entry.id)).toEqual(["gpt-5.6"]);
		expect(modelsForProvider(null, "openai")).toEqual([]);
	});
});
