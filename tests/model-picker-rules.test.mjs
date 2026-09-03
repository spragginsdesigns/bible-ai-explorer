import assert from "node:assert/strict";
import test from "node:test";

import {
	activeChipId,
	AUTO_EFFORT_SENTINEL,
	capabilityPills,
	effortForRequest,
	effortLabel,
	effortsFor,
	formatContextWindow,
	formatPrice,
	modeLabel,
	modelMeta,
	modesFor,
	optionSections,
	searchModels,
	shouldShowSearch,
	speedLabel,
	speedsFor,
	summaryLabel,
	verbositiesFor,
	verbosityLabel,
	visibleEffort,
	visibleMode,
	visibleSpeed,
	visibleVerbosity,
} from "../src/components/modelPickerRules.ts";

/** A model as the new server sends it. Override one field per test. */
function model(overrides = {}) {
	return {
		id: "openai/gpt-5.6-luna",
		label: "GPT-5.6 Luna",
		provider: "openai",
		supportsAttachments: true,
		efforts: ["none", "low", "medium", "high", "xhigh", "max"],
		available: true,
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
	};
}

/** What a server still on the pre-overhaul payload sends: six fields, no more. */
function legacyModel(overrides = {}) {
	return {
		id: "openai/gpt-5.4-mini",
		label: "GPT-5.4 mini",
		provider: "openai",
		supportsAttachments: false,
		efforts: ["low", "medium", "high"],
		available: true,
		...overrides,
	};
}

const NO_OPTIONS = { effort: null, speed: null, verbosity: null, mode: null };

/* -- labels ---------------------------------------------------------------- */

test("effort labels cover the whole widened vocabulary", () => {
	assert.equal(effortLabel(null), "Auto");
	assert.equal(effortLabel("none"), "Off");
	assert.equal(effortLabel("minimal"), "Minimal");
	assert.equal(effortLabel("low"), "Low");
	assert.equal(effortLabel("medium"), "Medium");
	assert.equal(effortLabel("high"), "High");
	assert.equal(effortLabel("xhigh"), "Extra");
	assert.equal(effortLabel("max"), "Max");
});

test("an effort we do not understand reads as Auto rather than raw", () => {
	// A chip carrying an unrecognised id would send garbage upstream.
	assert.equal(effortLabel("ludicrous"), "Auto");
});

test("speed, length and mode labels match the shared contract", () => {
	assert.equal(speedLabel(null), "Standard");
	assert.equal(speedLabel("fast"), "Fast");
	assert.equal(verbosityLabel("low"), "Brief");
	assert.equal(verbosityLabel(null), "Normal");
	assert.equal(verbosityLabel("medium"), "Normal");
	assert.equal(verbosityLabel("high"), "Detailed");
	assert.equal(modeLabel(null), "Standard");
	assert.equal(modeLabel("pro"), "Pro");
});

/* -- what a model offers --------------------------------------------------- */

test("effortsFor puts Auto first and sorts the rest lowest to highest", () => {
	const efforts = effortsFor(model({ efforts: ["max", "low", "high"] }));
	assert.deepEqual(efforts, [null, "low", "high", "max"]);
});

test("effortsFor drops an unknown effort and returns nothing for a model with none", () => {
	assert.deepEqual(effortsFor(model({ efforts: ["ludicrous", "medium"] })), [null, "medium"]);
	assert.deepEqual(effortsFor(model({ efforts: [] })), []);
	assert.deepEqual(effortsFor(null), []);
});

test("the older payload's missing fields fall back to the narrowest defaults", () => {
	const old = legacyModel();
	assert.deepEqual(speedsFor(old), ["standard"]);
	assert.deepEqual(modesFor(old), ["standard"]);
	assert.equal(modelMeta(old), null);
	// Normal is always on the length scale, so the row can never draw without
	// its own default; one entry means there is nothing to choose.
	assert.deepEqual(verbositiesFor(old), ["medium"]);
	assert.ok(!optionSections(old).some((section) => section.key === "verbosity"));
});

test("Normal is inserted when the payload lists the ends but not the middle", () => {
	assert.deepEqual(verbositiesFor(model({ verbosities: ["low", "high"] })), [
		"low",
		"medium",
		"high",
	]);
});

test("standard is always offered even if the server forgets to list it", () => {
	assert.deepEqual(speedsFor(model({ speeds: ["fast"] })), ["standard", "fast"]);
	assert.deepEqual(modesFor(model({ modes: ["pro"] })), ["standard", "pro"]);
});

/* -- stored value to visible chip ------------------------------------------ */

test("an effort the current model rejects renders as Auto without being erased", () => {
	const narrow = model({ efforts: ["low", "medium", "high"] });
	assert.equal(visibleEffort("max", narrow), null);
	// The caller still holds "max"; nothing here rewrites it.
	assert.equal(visibleEffort("max", model()), "max");
});

test("speed, length and mode fall back to their default when unsupported", () => {
	const old = legacyModel();
	assert.equal(visibleSpeed("fast", old), "standard");
	assert.equal(visibleVerbosity("high", old), "medium");
	assert.equal(visibleMode("pro", old), "standard");
	assert.equal(visibleSpeed("fast", model()), "fast");
	assert.equal(visibleVerbosity("high", model()), "high");
	assert.equal(visibleMode("pro", model()), "pro");
});

test("the Auto sentinel reads as Auto and never lights a real effort chip", () => {
	const full = model();
	assert.equal(visibleEffort(AUTO_EFFORT_SENTINEL, full), null);
	assert.equal(activeChipId("reasoning", { ...NO_OPTIONS, effort: AUTO_EFFORT_SENTINEL }, full), null);
	assert.equal(effortLabel(AUTO_EFFORT_SENTINEL), "Auto");
	// It is a storage marker, not a value the model can run.
	assert.ok(!effortsFor(full).includes(AUTO_EFFORT_SENTINEL));
});

test("the Auto sentinel adds nothing to the trigger summary", () => {
	assert.equal(
		summaryLabel(model(), { ...NO_OPTIONS, effort: AUTO_EFFORT_SENTINEL }),
		"GPT-5.6 Luna",
	);
});

test("the request omits effort entirely when this browser never chose one", () => {
	// null on the wire would read as an explicit Auto and overwrite a default
	// the user set on their phone; undefined makes JSON.stringify drop the key.
	assert.equal(effortForRequest(null), undefined);
	assert.equal(effortForRequest(undefined), undefined);
	assert.equal(effortForRequest(""), undefined);
	// Auto is a real choice, and travels as an explicit null.
	assert.equal(effortForRequest(AUTO_EFFORT_SENTINEL), null);
	// Anything else goes as-is; the server clamps what the model cannot take.
	assert.equal(effortForRequest("high"), "high");
	assert.equal(effortForRequest("ludicrous"), "ludicrous");
});

test("an explicitly stored default still reads and renders as the default", () => {
	const full = model();
	const explicit = { effort: null, speed: "standard", verbosity: "medium", mode: "standard" };
	assert.equal(activeChipId("speed", explicit, full), "standard");
	assert.equal(activeChipId("verbosity", explicit, full), "medium");
	assert.equal(activeChipId("mode", explicit, full), "standard");
	// And it contributes nothing to the trigger chip.
	assert.equal(summaryLabel(full, explicit), "GPT-5.6 Luna");
});

test("the pressed chip is the default one while nothing is stored", () => {
	const full = model();
	assert.equal(activeChipId("reasoning", NO_OPTIONS, full), null);
	assert.equal(activeChipId("speed", NO_OPTIONS, full), "standard");
	assert.equal(activeChipId("verbosity", NO_OPTIONS, full), "medium");
	assert.equal(activeChipId("mode", NO_OPTIONS, full), "standard");
});

/* -- sections -------------------------------------------------------------- */

test("a fully capable model draws all four sections in contract order", () => {
	const sections = optionSections(model());
	assert.deepEqual(
		sections.map((section) => section.title),
		["REASONING", "SPEED", "LENGTH", "MODE"],
	);
	assert.deepEqual(
		sections[0].chips.map((chip) => chip.label),
		["Auto", "Off", "Low", "Medium", "High", "Extra", "Max"],
	);
	assert.equal(sections[1].note, "About 2x the standard price");
	assert.equal(sections[3].note, "Deeper multi-pass reasoning; slower and pricier");
});

test("a section is omitted when the model offers only its default", () => {
	const plain = model({
		speeds: ["standard"],
		verbosities: [],
		modes: ["standard"],
		fastModeNote: null,
	});
	assert.deepEqual(
		optionSections(plain).map((section) => section.key),
		["reasoning"],
	);
});

test("a model with no reasoning scale draws no REASONING row", () => {
	const haiku = model({ efforts: [], speeds: ["standard"], verbosities: [], modes: ["standard"] });
	assert.deepEqual(optionSections(haiku), []);
	assert.deepEqual(optionSections(null), []);
});

test("every section carries a spoken name for its chip group", () => {
	for (const section of optionSections(model())) {
		assert.ok(section.ariaLabel.length > 0, `${section.key} needs an aria-label`);
	}
});

/* -- model row presentation ------------------------------------------------ */

test("context windows round to the nearest half million above 1M", () => {
	assert.equal(formatContextWindow(1_050_000), "1M");
	assert.equal(formatContextWindow(1_048_576), "1M");
	assert.equal(formatContextWindow(1_000_000), "1M");
	// A genuine 1.5M window must not be flattened to 2M.
	assert.equal(formatContextWindow(1_500_000), "1.5M");
	assert.equal(formatContextWindow(2_000_000), "2M");
	assert.equal(formatContextWindow(400_000), "400K");
	assert.equal(formatContextWindow(null), null);
	assert.equal(formatContextWindow(0), null);
});

test("prices keep whole dollars whole and everything else to the cent", () => {
	assert.equal(formatPrice(2), "$2");
	assert.equal(formatPrice(12), "$12");
	assert.equal(formatPrice(0.2), "$0.20");
	assert.equal(formatPrice(4.5), "$4.50");
});

test("the second line is the tagline when curated, derived facts otherwise", () => {
	assert.equal(modelMeta(model()), "Fastest and lowest cost");
	assert.equal(
		modelMeta(model({ tagline: null })),
		"1M context · $0.20 / $1.20 per M",
	);
	assert.equal(
		modelMeta(model({ tagline: "   ", pricing: null })),
		"1M context",
	);
	assert.equal(modelMeta(model({ tagline: null, contextWindow: null, pricing: null })), null);
});

test("pills are capped at three and follow a fixed order", () => {
	assert.deepEqual(capabilityPills(model()), ["Files", "Fast", "Pro"]);
	assert.deepEqual(capabilityPills(legacyModel()), []);
	assert.deepEqual(
		capabilityPills(model({ supportsAttachments: false, modes: ["standard"] })),
		["Fast"],
	);
});

/* -- search ---------------------------------------------------------------- */

test("search only appears once the list stops being scannable", () => {
	const many = Array.from({ length: 9 }, (_, index) =>
		model({ id: `openai/m${index}`, label: `Model ${index}` }),
	);
	assert.equal(shouldShowSearch(many), true);
	assert.equal(shouldShowSearch(many.slice(0, 8)), false);
	// A revoked model is not a reason to show a search box.
	assert.equal(
		shouldShowSearch([...many.slice(0, 8), model({ id: "x", available: false })]),
		false,
	);
});

test("search matches label or id, case-insensitively, across providers", () => {
	const models = [
		model({ id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" }),
		model({ id: "anthropic/claude-opus-5", label: "Opus 5", provider: "anthropic" }),
		model({ id: "moonshot/kimi-k3", label: "Kimi K3", provider: "moonshot" }),
	];
	assert.deepEqual(
		searchModels(models, "LUNA").map((entry) => entry.id),
		["openai/gpt-5.6-luna"],
	);
	assert.deepEqual(
		searchModels(models, "anthropic").map((entry) => entry.id),
		["anthropic/claude-opus-5"],
	);
	assert.deepEqual(searchModels(models, "  ").length, 3);
	assert.deepEqual(searchModels(models, "zzz"), []);
});

test("search never offers a model the account cannot use", () => {
	const models = [model({ id: "a", label: "Alpha" }), model({ id: "b", label: "Alpha two", available: false })];
	assert.deepEqual(
		searchModels(models, "alpha").map((entry) => entry.id),
		["a"],
	);
});

/* -- trigger summary ------------------------------------------------------- */

test("the trigger shows the model alone when nothing is overridden", () => {
	assert.equal(summaryLabel(model(), NO_OPTIONS), "GPT-5.6 Luna");
});

test("the trigger lists only the options that differ from the default", () => {
	assert.equal(
		summaryLabel(model(), { effort: "high", speed: "fast", verbosity: "high", mode: "pro" }),
		"GPT-5.6 Luna · High · Fast · Detailed · Pro",
	);
	assert.equal(
		summaryLabel(model(), { effort: null, speed: "standard", verbosity: "medium", mode: "standard" }),
		"GPT-5.6 Luna",
	);
});

test("options the selected model cannot do never reach the trigger", () => {
	const old = legacyModel();
	assert.equal(
		summaryLabel(old, { effort: "max", speed: "fast", verbosity: "high", mode: "pro" }),
		"GPT-5.4 mini",
	);
});

test("the trigger falls back to a placeholder before a model is known", () => {
	assert.equal(summaryLabel(null, NO_OPTIONS), "Model");
	assert.equal(summaryLabel(null, NO_OPTIONS, "Choose"), "Choose");
});
