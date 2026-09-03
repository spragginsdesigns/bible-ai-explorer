import { describe, expect, it, vi } from "vitest";

// The rules module reads PROVIDER_LABELS from aiApi, which pulls in the Expo
// networking layer; stub it the way api.test.ts does so this stays a node test.
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));

import type { AiModel, AiModelsResponse } from "@/features/settings/aiApi";
import {
	AUTO_EFFORT_SENTINEL,
	activeOptionId,
	effortForRequest,
	effortLabel,
	effortsFor,
	filterModels,
	formatContextWindow,
	formatPricing,
	houseMode,
	modelMeta,
	modelPills,
	modelsForProvider,
	modesFor,
	optionSections,
	providerLabel,
	seedRunOptions,
	selectModelId,
	selectedModel,
	showSearch,
	speedsFor,
	summaryLabel,
	verbositiesFor,
	visibleEffort,
	visibleProviders,
	type OptionKind,
} from "./modelPickerRules";

const model = (id: string, provider: string, available = true): AiModel => ({
	id,
	label: id,
	provider,
	supportsAttachments: false,
	efforts: ["low", "medium", "high"],
	available,
});

/** A model carrying everything the run-options release added. */
const richModel = (overrides: Partial<AiModel> = {}): AiModel => ({
	...model("openai/gpt-5.6-luna", "openai"),
	label: "GPT-5.6 Luna",
	supportsAttachments: true,
	efforts: ["none", "low", "medium", "high", "xhigh", "max"],
	speeds: ["standard", "fast"],
	verbosities: ["low", "medium", "high"],
	modes: ["standard", "pro"],
	defaultEffort: "medium",
	tagline: "Fastest and lowest cost",
	tier: "fast",
	contextWindow: 1_050_000,
	pricing: { input: 0.2, output: 1.2 },
	fastModeNote: "About 2x the standard price",
	...overrides,
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

const sectionOf = (sections: ReturnType<typeof optionSections>, kind: OptionKind) =>
	sections.find((section) => section.kind === kind);

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

describe("selectedModel", () => {
	it("resolves the entry the option rows read their capabilities from", () => {
		expect(selectedModel(keysPayload(), "gpt-5.6-mini")?.id).toBe("gpt-5.6-mini");
		expect(selectedModel(keysPayload(), "nope")?.id).toBe("gpt-5.6");
		expect(selectedModel(null, "gpt-5.6")).toBeNull();
	});

	it("answers null when the default names a model the list does not carry", () => {
		const data = keysPayload({ defaults: { modelId: "ghost", effort: null } });
		expect(selectedModel(data, null)).toBeNull();
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

describe("providerLabel", () => {
	it("prefers the server's label, then ours, then the raw id", () => {
		const data = keysPayload({
			providers: [{ id: "openai", label: "OpenAI (work key)", available: true }],
		});
		expect(providerLabel(data, "openai")).toBe("OpenAI (work key)");
		expect(providerLabel(data, "anthropic")).toBe("Anthropic");
		expect(providerLabel(data, "somethingnew")).toBe("somethingnew");
	});
});

describe("showSearch / filterModels", () => {
	const many = (count: number) =>
		keysPayload({
			models: Array.from({ length: count }, (_, index) => model(`m${index}`, "openai")),
		});

	it("grows a search field only past eight available models", () => {
		expect(showSearch(many(8))).toBe(false);
		expect(showSearch(many(9))).toBe(true);
		expect(showSearch(housePayload())).toBe(false);
		expect(showSearch(null)).toBe(false);
	});

	it("does not count models the account cannot run", () => {
		const data = keysPayload({
			models: [
				...Array.from({ length: 8 }, (_, index) => model(`m${index}`, "openai")),
				model("revoked", "anthropic", false),
			],
		});
		expect(showSearch(data)).toBe(false);
	});

	it("matches label or id, case-insensitively, across providers", () => {
		const data = keysPayload({
			providers: [
				{ id: "openai", label: "OpenAI", available: true },
				{ id: "anthropic", label: "Anthropic", available: true },
			],
			models: [
				{ ...model("openai/gpt-5.6-luna", "openai"), label: "GPT-5.6 Luna" },
				{ ...model("anthropic/claude-opus-5", "anthropic"), label: "Claude Opus 5" },
				{ ...model("anthropic/gone", "anthropic", false), label: "Claude Gone" },
			],
		});
		expect(filterModels(data, "LUNA").map((entry) => entry.id)).toEqual(["openai/gpt-5.6-luna"]);
		expect(filterModels(data, "opus").map((entry) => entry.id)).toEqual([
			"anthropic/claude-opus-5",
		]);
		expect(filterModels(data, "anthropic/").map((entry) => entry.id)).toEqual([
			"anthropic/claude-opus-5",
		]);
		expect(filterModels(data, "zzz")).toEqual([]);
		expect(filterModels(data, "  ").map((entry) => entry.id)).toEqual([
			"openai/gpt-5.6-luna",
			"anthropic/claude-opus-5",
		]);
		expect(filterModels(null, "luna")).toEqual([]);
	});
});

describe("capability arrays", () => {
	it("returns efforts in canonical order and drops anything unknown", () => {
		expect(effortsFor({ ...model("m", "openai"), efforts: ["high", "low"] })).toEqual([
			"low",
			"high",
		]);
		expect(effortsFor({ ...model("m", "openai"), efforts: ["ludicrous", "max", "none"] })).toEqual(
			["none", "max"],
		);
		expect(effortsFor({ ...model("m", "openai"), efforts: [] })).toEqual([]);
		expect(effortsFor(null)).toEqual([]);
	});

	it("falls back to the conservative shape when an older server omits the fields", () => {
		const legacy = model("m", "openai");
		expect(speedsFor(legacy)).toEqual(["standard"]);
		expect(verbositiesFor(legacy)).toEqual([]);
		expect(modesFor(legacy)).toEqual(["standard"]);
		expect(speedsFor(null)).toEqual(["standard"]);
		expect(modesFor(null)).toEqual(["standard"]);
	});

	it("reads the new arrays when the server sends them", () => {
		const rich = richModel();
		expect(speedsFor(rich)).toEqual(["standard", "fast"]);
		expect(verbositiesFor(rich)).toEqual(["low", "medium", "high"]);
		expect(modesFor(rich)).toEqual(["standard", "pro"]);
	});
});

describe("visibleEffort", () => {
	it("shows a stored effort the model supports", () => {
		expect(visibleEffort("max", richModel())).toBe("max");
	});

	it("reads as Auto for an effort the model rejects, without erasing it", () => {
		// The caller passes the raw stored value back in, so a detour through a
		// model that lacks "max" must not cost the setting.
		const narrow = richModel({ efforts: ["low", "medium", "high"] });
		expect(visibleEffort("max", narrow)).toBeNull();
		expect(visibleEffort("max", richModel())).toBe("max");
	});

	it("is null for Auto, for the sentinel, for an unknown value, and for no model", () => {
		expect(visibleEffort(null, richModel())).toBeNull();
		expect(visibleEffort(AUTO_EFFORT_SENTINEL, richModel())).toBeNull();
		expect(visibleEffort("ludicrous", richModel())).toBeNull();
		expect(visibleEffort("high", null)).toBeNull();
	});
});

describe("effortForRequest", () => {
	it("omits the key entirely when the picker has never been used", () => {
		// undefined, not null: a null tells the server the user picked Auto, which
		// would clear a defaultEffort set on another device.
		expect(effortForRequest(null)).toBeUndefined();
		expect(effortForRequest(undefined)).toBeUndefined();
		expect(effortForRequest("")).toBeUndefined();
	});

	it("turns the Auto sentinel into an explicit null", () => {
		expect(effortForRequest(AUTO_EFFORT_SENTINEL)).toBeNull();
	});

	it("passes a real effort through untouched", () => {
		expect(effortForRequest("xhigh")).toBe("xhigh");
		expect(effortForRequest("max")).toBe("max");
		// The server clamps what the model cannot run; the client does not guess.
		expect(effortForRequest("ludicrous")).toBe("ludicrous");
	});
});

describe("effortLabel", () => {
	it("uses the shared vocabulary and falls back to Auto", () => {
		expect(effortLabel(null)).toBe("Auto");
		expect(effortLabel(AUTO_EFFORT_SENTINEL)).toBe("Auto");
		expect(effortLabel("none")).toBe("Off");
		expect(effortLabel("minimal")).toBe("Minimal");
		expect(effortLabel("xhigh")).toBe("Extra");
		expect(effortLabel("max")).toBe("Max");
		expect(effortLabel("ludicrous")).toBe("Auto");
	});
});

describe("optionSections", () => {
	it("draws every section a fully capable model offers", () => {
		const sections = optionSections(richModel());
		expect(sections.map((section) => section.title)).toEqual([
			"REASONING",
			"SPEED",
			"LENGTH",
			"MODE",
		]);
	});

	it("leads reasoning with Auto and lists the model's own efforts", () => {
		const section = sectionOf(optionSections(richModel()), "effort");
		expect(section?.choices).toEqual([
			{ id: "auto", label: "Auto" },
			{ id: "none", label: "Off" },
			{ id: "low", label: "Low" },
			{ id: "medium", label: "Medium" },
			{ id: "high", label: "High" },
			{ id: "xhigh", label: "Extra" },
			{ id: "max", label: "Max" },
		]);
	});

	it("gives speed and mode an explicit default chip and their caveats", () => {
		const sections = optionSections(richModel());
		expect(sectionOf(sections, "speed")?.choices).toEqual([
			{ id: "standard", label: "Standard" },
			{ id: "fast", label: "Fast" },
		]);
		expect(sectionOf(sections, "speed")?.defaultId).toBe("standard");
		expect(sectionOf(sections, "speed")?.note).toBe("About 2x the standard price");
		expect(sectionOf(sections, "mode")?.choices).toEqual([
			{ id: "standard", label: "Standard" },
			{ id: "pro", label: "Pro" },
		]);
		expect(sectionOf(sections, "mode")?.defaultId).toBe("standard");
		expect(sectionOf(sections, "mode")?.note).toBe(
			"Deeper multi-pass reasoning; slower and pricier",
		);
	});

	it("maps length onto Brief / Normal / Detailed, Normal storing medium", () => {
		const section = sectionOf(optionSections(richModel()), "verbosity");
		expect(section?.choices).toEqual([
			{ id: "low", label: "Brief" },
			{ id: "medium", label: "Normal" },
			{ id: "high", label: "Detailed" },
		]);
		expect(section?.defaultId).toBe("medium");
	});

	it("never gives any chip a null id, so null can mean 'never chose'", () => {
		// A null speed/length/mode means "no opinion" to the server, which would
		// leave an earlier Fast in force; a null effort reads as an explicit Auto
		// and would clear an account default. Every chip stores a real string.
		for (const section of optionSections(richModel())) {
			for (const choice of section.choices) expect(typeof choice.id).toBe("string");
			expect(typeof section.defaultId).toBe("string");
		}
		expect(sectionOf(optionSections(richModel()), "effort")?.defaultId).toBe(
			AUTO_EFFORT_SENTINEL,
		);
	});

	it("omits a section the model cannot vary", () => {
		const plain = richModel({
			speeds: ["standard"],
			verbosities: [],
			modes: ["standard"],
		});
		expect(optionSections(plain).map((section) => section.kind)).toEqual(["effort"]);
	});

	it("draws nothing at all for a model with no options and no model", () => {
		const inert = richModel({
			efforts: [],
			speeds: ["standard"],
			verbosities: [],
			modes: ["standard"],
		});
		expect(optionSections(inert)).toEqual([]);
		expect(optionSections(null)).toEqual([]);
	});

	it("shows only reasoning for a model from a server that predates run options", () => {
		expect(optionSections(model("gpt-5.6", "openai")).map((section) => section.kind)).toEqual([
			"effort",
		]);
	});
});

describe("activeOptionId", () => {
	const sections = optionSections(richModel());

	it("selects the stored value when the section offers it", () => {
		expect(activeOptionId(sectionOf(sections, "effort")!, "xhigh")).toBe("xhigh");
		expect(activeOptionId(sectionOf(sections, "speed")!, "fast")).toBe("fast");
		expect(activeOptionId(sectionOf(sections, "verbosity")!, "high")).toBe("high");
	});

	it("selects the explicit default when it is what was stored", () => {
		expect(activeOptionId(sectionOf(sections, "speed")!, "standard")).toBe("standard");
		expect(activeOptionId(sectionOf(sections, "verbosity")!, "medium")).toBe("medium");
		expect(activeOptionId(sectionOf(sections, "mode")!, "standard")).toBe("standard");
	});

	it("reads nothing stored as the section's default chip", () => {
		expect(activeOptionId(sectionOf(sections, "effort")!, null)).toBe(AUTO_EFFORT_SENTINEL);
		expect(activeOptionId(sectionOf(sections, "speed")!, null)).toBe("standard");
		expect(activeOptionId(sectionOf(sections, "verbosity")!, undefined)).toBe("medium");
		expect(activeOptionId(sectionOf(sections, "mode")!, null)).toBe("standard");
	});

	it("treats the Auto sentinel as reasoning's default chip", () => {
		expect(activeOptionId(sectionOf(sections, "effort")!, AUTO_EFFORT_SENTINEL)).toBe(
			AUTO_EFFORT_SENTINEL,
		);
	});

	it("falls back to the default chip for anything the section does not offer", () => {
		expect(activeOptionId(sectionOf(sections, "speed")!, "turbo")).toBe("standard");
		expect(activeOptionId(sectionOf(sections, "verbosity")!, "epic")).toBe("medium");
		expect(activeOptionId(sectionOf(sections, "effort")!, "ludicrous")).toBe(
			AUTO_EFFORT_SENTINEL,
		);
	});
});

describe("modelPills", () => {
	it("names at most three capabilities", () => {
		expect(modelPills(richModel())).toEqual(["Files", "Fast", "Pro"]);
		expect(modelPills(model("gpt-5.6", "openai"))).toEqual([]);
		expect(modelPills(richModel({ speeds: ["standard"], modes: ["standard"] }))).toEqual([
			"Files",
		]);
	});
});

describe("formatContextWindow / formatPricing / modelMeta", () => {
	it("abbreviates context windows the way the contract spells them", () => {
		expect(formatContextWindow(1_050_000)).toBe("1M");
		expect(formatContextWindow(1_048_576)).toBe("1M");
		expect(formatContextWindow(1_500_000)).toBe("1.5M");
		expect(formatContextWindow(400_000)).toBe("400K");
		expect(formatContextWindow(128_000)).toBe("128K");
		expect(formatContextWindow(900)).toBe("900");
		expect(formatContextWindow(null)).toBeNull();
		expect(formatContextWindow(0)).toBeNull();
	});

	it("prints whole dollars bare and everything else to two decimals", () => {
		// Matches web and Apple: "$1.20", never "$1.2".
		expect(formatPricing({ input: 2, output: 12 })).toBe("$2 / $12 per M");
		expect(formatPricing({ input: 0.2, output: 1.2 })).toBe("$0.20 / $1.20 per M");
		expect(formatPricing({ input: 0.75, output: 4.5 })).toBe("$0.75 / $4.50 per M");
		expect(formatPricing(null)).toBeNull();
	});

	it("prefers the tagline, then the numbers, then nothing", () => {
		expect(modelMeta(richModel())).toBe("Fastest and lowest cost");
		expect(modelMeta(richModel({ tagline: null }))).toBe("1M context · $0.20 / $1.20 per M");
		expect(modelMeta(richModel({ tagline: null, pricing: null }))).toBe("1M context");
		expect(modelMeta(model("gpt-5.6", "openai"))).toBeNull();
	});
});

describe("seedRunOptions", () => {
	const nothingStored = { effort: null, speed: null, verbosity: null, mode: null };

	it("adopts every account default this device has never chosen", () => {
		expect(
			seedRunOptions(nothingStored, {
				effort: "high",
				speed: "fast",
				verbosity: "low",
				mode: "pro",
			}),
		).toEqual({ effort: "high", speed: "fast", verbosity: "low", mode: "pro" });
	});

	it("never overwrites a local choice", () => {
		// The reviewer scenario in reverse: Standard picked here must survive a
		// Fast sitting on the account from another client.
		expect(
			seedRunOptions(
				{ effort: "low", speed: "standard", verbosity: "high", mode: "standard" },
				{ effort: "high", speed: "fast", verbosity: "low", mode: "pro" },
			),
		).toEqual({});
	});

	it("seeds only the fields the server actually sent", () => {
		expect(seedRunOptions(nothingStored, { effort: null, speed: "fast" })).toEqual({
			speed: "fast",
		});
		expect(seedRunOptions(nothingStored, {})).toEqual({});
		expect(seedRunOptions(nothingStored, undefined)).toEqual({});
	});

	it("ignores an empty string, which would store a value that means nothing", () => {
		expect(seedRunOptions(nothingStored, { effort: "", mode: "pro" })).toEqual({ mode: "pro" });
	});
});

describe("summaryLabel", () => {
	it("is just the model when everything is on its default", () => {
		expect(
			summaryLabel(richModel(), { effort: null, speed: null, verbosity: null, mode: null }),
		).toBe("GPT-5.6 Luna");
	});

	it("appends each non-default option in picker order", () => {
		expect(
			summaryLabel(richModel(), {
				effort: "high",
				speed: "fast",
				verbosity: "high",
				mode: "pro",
			}),
		).toBe("GPT-5.6 Luna · High · Fast · Detailed · Pro");
	});

	it("says nothing about an option the selected model does not support", () => {
		const plain = richModel({
			efforts: ["low", "medium", "high"],
			speeds: ["standard"],
			verbosities: [],
			modes: ["standard"],
		});
		expect(
			summaryLabel(plain, { effort: "max", speed: "fast", verbosity: "low", mode: "pro" }),
		).toBe("GPT-5.6 Luna");
	});

	it("says nothing about the Auto sentinel", () => {
		expect(summaryLabel(richModel(), { effort: AUTO_EFFORT_SENTINEL })).toBe("GPT-5.6 Luna");
	});

	it("says nothing about an explicitly stored default", () => {
		expect(
			summaryLabel(richModel(), {
				effort: null,
				speed: "standard",
				verbosity: "medium",
				mode: "standard",
			}),
		).toBe("GPT-5.6 Luna");
	});

	it("is empty before a model is resolved", () => {
		expect(summaryLabel(null, { effort: "high" })).toBe("");
	});
});
