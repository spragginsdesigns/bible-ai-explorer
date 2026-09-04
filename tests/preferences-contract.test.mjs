import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_MODEL_ID,
	REASONING_EFFORTS,
	REASONING_MODES,
	resolveDefinition,
	SPEEDS,
	VERBOSITIES,
} from "../src/lib/ai/models.ts";
import { LISTEN_RATES as CARD_LISTEN_RATES } from "../src/components/cross/listen.ts";
import {
	DEFAULT_LISTEN_RATE,
	DEFAULT_TRANSLATION,
	LISTEN_RATES,
	parsePreferencesPatch,
	toPreferencesDocument,
	TRANSLATION_IDS,
} from "../src/lib/preferences-contract.ts";

/** Exactly what the route hands the validator. */
const MODELS = {
	knowsModel: (modelId) => resolveDefinition(modelId) !== undefined,
	efforts: REASONING_EFFORTS,
	speeds: SPEEDS,
	verbosities: VERBOSITIES,
	modes: REASONING_MODES,
};

const parse = (body) => parsePreferencesPatch(body, MODELS);
const document = (user, plan) => toPreferencesDocument(user, plan, MODELS);

/** A stored User row with everything at its column default. */
function row(overrides = {}) {
	return {
		webSearchEnabled: true,
		memoryEnabled: true,
		translation: "KJV",
		parchment: true,
		listenRate: 1,
		defaultModelId: null,
		defaultEffort: null,
		defaultSpeed: null,
		defaultVerbosity: null,
		defaultMode: null,
		...overrides,
	};
}

test("the listen rates the server accepts are the ones the card offers", () => {
	// The list is duplicated because a server module must not import from
	// src/components; this is what stops the copies drifting apart.
	assert.deepEqual(LISTEN_RATES, [...CARD_LISTEN_RATES]);
	assert.equal(DEFAULT_LISTEN_RATE, 1);
});

test("the translations the server accepts are the two the reader offers", () => {
	assert.deepEqual(TRANSLATION_IDS, ["KJV", "NKJV"]);
	assert.equal(DEFAULT_TRANSLATION, "KJV");
});

test("a body that is not an object is rejected", () => {
	for (const body of [null, undefined, "webSearchEnabled", 3, [], [{ parchment: true }]]) {
		const result = parse(body);
		assert.equal(result.ok, false, `expected ${JSON.stringify(body ?? null)} to be rejected`);
		assert.equal(result.error, "Body must be a JSON object");
	}
});

test("an empty body is rejected rather than treated as a no-op write", () => {
	assert.deepEqual(parse({}), { ok: false, error: "No preferences to update" });
	// A recognised key carrying nothing is the same thing: nothing to write.
	assert.deepEqual(parse({ chat: {} }), { ok: false, error: "No preferences to update" });
});

test("an unknown key is named in the error, at the top level and inside chat", () => {
	assert.deepEqual(parse({ theme: "dark" }), { ok: false, error: "Unknown preference: theme" });
	assert.deepEqual(parse({ chat: { temperature: 0.7 } }), {
		ok: false,
		error: "Unknown preference: chat.temperature",
	});
	// The tier is read-only, so it reads as unknown like any other stray key.
	assert.equal(parse({ plan: "pro" }).ok, false);
});

test("booleans must be real booleans", () => {
	for (const key of ["webSearchEnabled", "memoryEnabled", "parchment"]) {
		for (const bad of ["true", 1, 0, null]) {
			assert.deepEqual(parse({ [key]: bad }), { ok: false, error: `${key} must be a boolean` });
		}
		assert.deepEqual(parse({ [key]: false }), { ok: true, data: { [key]: false } });
		assert.deepEqual(parse({ [key]: true }), { ok: true, data: { [key]: true } });
	}
});

test("translation must be one of the two translations", () => {
	assert.deepEqual(parse({ translation: "NKJV" }), { ok: true, data: { translation: "NKJV" } });
	for (const bad of ["ESV", "kjv", "", null, 1]) {
		const result = parse({ translation: bad });
		assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
		assert.equal(result.error, "translation must be one of: KJV, NKJV");
	}
});

test("listenRate must be one of the offered speeds, compared numerically", () => {
	for (const rate of LISTEN_RATES) {
		assert.deepEqual(parse({ listenRate: rate }), { ok: true, data: { listenRate: rate } });
	}
	// 1.0 and 1 are the same number, so the write is accepted.
	assert.deepEqual(parse({ listenRate: 1.0 }), { ok: true, data: { listenRate: 1 } });
	for (const bad of [0.5, 3, "1.5", null, Number.NaN]) {
		const result = parse({ listenRate: bad });
		assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
		assert.equal(result.error, "listenRate must be one of: 0.75, 1, 1.25, 1.5, 2");
	}
});

test("chat.modelId takes a resolvable id or null, and nothing else", () => {
	assert.deepEqual(parse({ chat: { modelId: DEFAULT_MODEL_ID } }), {
		ok: true,
		data: { defaultModelId: DEFAULT_MODEL_ID },
	});
	// Uncurated but well-formed ids resolve through the provider heuristics.
	assert.deepEqual(parse({ chat: { modelId: "openai/gpt-5.6-terra" } }), {
		ok: true,
		data: { defaultModelId: "openai/gpt-5.6-terra" },
	});
	// null clears the column - "no model chosen" - rather than being rejected.
	assert.deepEqual(parse({ chat: { modelId: null } }), { ok: true, data: { defaultModelId: null } });
	for (const bad of ["gpt-5.6-luna", "acme/whatever", "", 7]) {
		const result = parse({ chat: { modelId: bad } });
		assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
		assert.equal(result.error, "chat.modelId must be null or a known model id");
	}
});

test("each run option takes its own vocabulary or null", () => {
	const cases = [
		{ field: "effort", column: "defaultEffort", good: "high", bad: "highest" },
		{ field: "speed", column: "defaultSpeed", good: "fast", bad: "turbo" },
		{ field: "verbosity", column: "defaultVerbosity", good: "medium", bad: "verbose" },
		{ field: "mode", column: "defaultMode", good: "pro", bad: "ultra" },
	];
	for (const { field, column, good, bad } of cases) {
		assert.deepEqual(parse({ chat: { [field]: good } }), { ok: true, data: { [column]: good } });
		assert.deepEqual(parse({ chat: { [field]: null } }), { ok: true, data: { [column]: null } });
		const rejected = parse({ chat: { [field]: bad } });
		assert.equal(rejected.ok, false);
		assert.match(rejected.error, new RegExp(`^chat\\.${field} must be null or one of: `));
		assert.equal(parse({ chat: { [field]: 3 } }).ok, false);
	}
	// Efforts span the full provider union, not just OpenAI's levels.
	assert.equal(parse({ chat: { effort: "xhigh" } }).ok, true);
	// The vocabularies are not interchangeable with each other.
	assert.equal(parse({ chat: { speed: "high" } }).ok, false);
	assert.equal(parse({ chat: { verbosity: "fast" } }).ok, false);
	assert.equal(parse({ chat: { mode: "high" } }).ok, false);
});

test("chat must be an object when it is present", () => {
	for (const bad of [null, "standard", 4, ["modelId"]]) {
		const result = parse({ chat: bad });
		assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
		assert.equal(result.error, "chat must be a JSON object");
	}
});

test("one bad field poisons the whole body, so nothing is written", () => {
	const result = parse({ translation: "NKJV", parchment: true, listenRate: 9 });
	assert.equal(result.ok, false);
	assert.equal(result.error, "listenRate must be one of: 0.75, 1, 1.25, 1.5, 2");
	assert.equal(result.data, undefined);

	// Same when the bad field is nested and every top-level field is fine.
	const nested = parse({
		webSearchEnabled: false,
		chat: { modelId: DEFAULT_MODEL_ID, effort: "nope" },
	});
	assert.equal(nested.ok, false);
	assert.equal(nested.data, undefined);
});

test("a fully valid body maps to the exact Prisma column names", () => {
	const result = parse({
		webSearchEnabled: false,
		memoryEnabled: false,
		translation: "NKJV",
		parchment: false,
		listenRate: 1.25,
		chat: {
			modelId: DEFAULT_MODEL_ID,
			effort: "high",
			speed: "fast",
			verbosity: "low",
			mode: "pro",
		},
	});
	assert.deepEqual(result, {
		ok: true,
		data: {
			webSearchEnabled: false,
			memoryEnabled: false,
			translation: "NKJV",
			parchment: false,
			listenRate: 1.25,
			defaultModelId: DEFAULT_MODEL_ID,
			defaultEffort: "high",
			defaultSpeed: "fast",
			defaultVerbosity: "low",
			defaultMode: "pro",
		},
	});
	// The patch is flat: no nested "chat" key ever reaches Prisma.
	assert.equal("chat" in result.data, false);
});

test("the document mirrors a stored row, with the tier passed in", () => {
	const doc = document(
		row({
			webSearchEnabled: false,
			memoryEnabled: false,
			translation: "NKJV",
			parchment: false,
			listenRate: 2,
			defaultModelId: DEFAULT_MODEL_ID,
			defaultEffort: "medium",
			defaultSpeed: "standard",
			defaultVerbosity: "high",
			defaultMode: "standard",
		}),
		"pro"
	);
	assert.deepEqual(doc, {
		plan: "pro",
		webSearchEnabled: false,
		memoryEnabled: false,
		translation: "NKJV",
		parchment: false,
		listenRate: 2,
		chat: {
			modelId: DEFAULT_MODEL_ID,
			effort: "medium",
			speed: "standard",
			verbosity: "high",
			mode: "standard",
		},
	});
});

test("an account with no row yet reads as every default", () => {
	assert.deepEqual(document(null, "free"), {
		plan: "free",
		webSearchEnabled: true,
		memoryEnabled: true,
		translation: "KJV",
		parchment: true,
		listenRate: 1,
		chat: { modelId: null, effort: null, speed: null, verbosity: null, mode: null },
	});
	assert.deepEqual(document(undefined, "free"), document(null, "free"));
});

test("stored values the registry no longer knows read as never-chosen", () => {
	const doc = document(
		row({
			translation: "ESV",
			listenRate: 4,
			defaultEffort: "extreme",
			defaultSpeed: "warp",
			defaultVerbosity: "chatty",
			defaultMode: "turbo",
		}),
		"free"
	);
	assert.equal(doc.translation, "KJV");
	assert.equal(doc.listenRate, 1);
	assert.deepEqual(doc.chat, {
		modelId: null,
		effort: null,
		speed: null,
		verbosity: null,
		mode: null,
	});
});

test("a stored model id is returned verbatim, even one this account cannot run", () => {
	// Whether a stored pick is still offered is the picker's decision, made
	// against /api/ai/models - not this route's.
	const doc = document(row({ defaultModelId: "anthropic/claude-retired-1" }), "free");
	assert.equal(doc.chat.modelId, "anthropic/claude-retired-1");
});
