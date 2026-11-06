import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { wrapLanguageModel } from "ai";
import { traceTurn, withTurnTrace } from "../src/lib/ai/turn-trace.ts";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const providerSource = read("src/lib/ai/provider.ts");
const start = providerSource.indexOf("export async function resolveVerificationModel(");
const end = providerSource.indexOf("\n/**", start);
assert.ok(start > 0 && end > start);
const resolverCode = stripTypeScriptTypes(providerSource.slice(start, end).replace(/^export /, ""));
const makeResolver = new Function("aiAccessFor", "HOUSE_MODEL_ID", "houseKeyFor", "serverKeyFor", "apiKeyFor", "HouseModelUnavailableError", "buildModel", "meterIncludedModel", "wrapLanguageModel", "process", "traceTurn", `${resolverCode}\nreturn resolveVerificationModel;`);
const usageSource = read("src/lib/billing/usage.ts");
const meterCode = stripTypeScriptTypes(usageSource.slice(usageSource.indexOf("export function meterIncludedModel(")).replace(/^export /, ""));
const makeMeter = new Function("usageEnabled", "scopes", "reserve", "prisma", "wrapLanguageModel", "IncludedAiLimitError", "randomUUID", "finish", `${meterCode}\nreturn meterIncludedModel;`);
const usage = { inputTokens: { total: 100, cacheRead: 10, cacheWrite: 20 }, outputTokens: { total: 50 } };
const definition = { id: "test-house", provider: "openai", providerModelId: "same-answer-head", pricing: { input: 2, output: 8 } };
const params = { prompt: [{ role: "user", content: [{ type: "text", text: "Verify this." }] }], maxOutputTokens: 64 };
function harness(access = "house", trace) {
	const events = [];
	const scope = { id: "existing-request", calls: 8, steps: 12, visible: false, ended: false, background: false };
	const records = [];
	const reservations = [];
	const built = [];
	const meters = [];
	const credentials = [];
	let providerCalls = 0;
	const realMeter = makeMeter(() => true, { getStore: () => scope }, async (sameScope, userId) => { reservations.push({ sameScope, userId }); },
		{ aiUsageRequest: { update: async update => { records.push(update); } } }, wrapLanguageModel, Error,
		() => { throw new Error("Must reuse the current request ledger"); }, async () => { throw new Error("Must not finish the foreground ledger"); });
	const resolver = makeResolver(async userId => { credentials.push(["access", userId]); return access; }, "test-house",
		() => { credentials.push(["house"]); return "TEST-HOUSE-KEY"; }, provider => { credentials.push(["server", provider]); return "TEST-SERVER-KEY"; },
		async (userId, provider) => { credentials.push(["user", userId, provider]); return "TEST-USER-KEY"; }, Error,
		(provider, modelId, key, structured) => {
			built.push({ provider, modelId, key, structured });
			return { specificationVersion: "v4", provider, modelId, supportedUrls: {},
				doGenerate: async () => { providerCalls += 1; return { content: [{ type: "text", text: "Checked." }], usage, finishReason: { unified: "stop" }, warnings: [] }; },
				doStream: async () => { providerCalls += 1; return { stream: new ReadableStream({ start(controller) {
					controller.enqueue({ type: "text-delta", id: "checked", delta: "Checked." });
					controller.enqueue({ type: "finish", usage, finishReason: { unified: "stop" } }); controller.close();
				} }), warnings: [] }; },
			};
		},
		(userId, model, utility, price) => { meters.push({ userId, model, utility, price }); return realMeter(userId, model, utility, price); }, wrapLanguageModel, { env: {} }, trace ?? ((stage, phase, fields) => { events.push({ stage, phase, ...fields }); traceTurn(stage, phase, fields); }));
	return { resolver, events, scope, records, reservations, built, meters, credentials, get providerCalls() { return providerCalls; } };
}

test("all twelve verification calls use the answer key/head/pricing and existing utility ledger", async () => {
	const state = harness();
	const model = await state.resolver("reader", definition);
	assert.deepEqual(state.built, [{ provider: "openai", modelId: "same-answer-head", key: "TEST-HOUSE-KEY", structured: true }]);
	assert.equal(state.meters.length, 1);
	assert.equal(state.meters[0].utility, true);
	assert.equal(state.meters[0].price, definition.pricing);
	for (let call = 0; call < 12; call++) {
		if (call % 2) {
			const response = await model.doStream(params);
			for await (const _ of response.stream) { /* Consuming is required to meter streamed output. */ }
		} else await model.doGenerate(params);
	}
	assert.equal(state.providerCalls, 12);
	assert.equal(state.scope.steps, 12, "verification must not consume the already full foreground allowance");
	assert.equal(state.scope.calls, 20);
	assert.equal(state.scope.visible, false, "utility output must not create another visible chat message");
	assert.equal(state.reservations.length, 12);
	assert.ok(state.reservations.every(item => item.sameScope === state.scope && item.userId === "reader"));
	assert.ok(state.records.every(record => record.where.id === "existing-request"));
	const calls = state.records.filter(record => record.data.calls);
	const costs = state.records.filter(record => record.data.costMicros);
	assert.equal(calls.length, 12);
	assert.equal(costs.length, 12);
	assert.ok(costs.every(record => record.data.costMicros.increment === 592));
	assert.ok(costs.every(record => record.data.inputTokens.increment === 100 && record.data.outputTokens.increment === 50));
	const previousRecords = state.records.length;
	await assert.rejects(model.doGenerate(params), error => error.message === "Scripture verification call allowance exhausted" && error.name === "VerificationCallLimitError" && error.code === "verification_call_limit");
	assert.equal(state.providerCalls, 12);
	assert.equal(state.records.length, previousRecords, "thirteenth call is rejected before any billing write");
	assert.equal(state.reservations.length, 12);
	assert.deepEqual(state.events.filter(event => event.phase === "completed").map(event => event.verificationCalls), Array.from({ length: 12 }, (_, index) => index + 1));
	assert.ok(state.events.every(event => event.stage === "verification-budget" && event.verificationCallLimit === 12));
	assert.deepEqual(state.events.at(-1), { stage: "verification-budget", phase: "failed", verificationCalls: 12, verificationCallLimit: 12, issueCodes: ["verification_call_limit"], errorClass: "QuotaError" });
});

test("caller-owned credentials retain the same provider head and remain outside included billing", async () => {
	const state = harness("keys");
	const customDefinition = { ...definition, id: "selected-head", provider: "anthropic", providerModelId: "selected-answer-head" };
	const model = await state.resolver("owner-reader", customDefinition);
	assert.deepEqual(state.built, [{ provider: "anthropic", modelId: "selected-answer-head", key: "TEST-USER-KEY", structured: true }]);
	assert.deepEqual(state.credentials, [["access", "owner-reader"], ["user", "owner-reader", "anthropic"]]);
	for (let call = 0; call < 12; call++) await model.doGenerate(params);
	await assert.rejects(model.doGenerate(params), /verification call allowance exhausted/);
	assert.equal(state.providerCalls, 12);
	assert.equal(state.meters.length, 0);
	assert.equal(state.records.length, 0);
});

test("guest verification uses the house key without an account meter and each resolver has its own cap", async () => {
	const state = harness();
	const first = await state.resolver(null, definition);
	const second = await state.resolver(null, definition);
	for (let call = 0; call < 12; call++) await first.doGenerate(params);
	await assert.rejects(first.doGenerate(params), /verification call allowance exhausted/);
	await second.doGenerate(params);
	assert.equal(state.providerCalls, 13);
	assert.equal(state.meters.length, 0);
	assert.deepEqual(state.credentials, [["house"], ["house"]]);
	assert.ok(state.built.every(build => build.key === "TEST-HOUSE-KEY" && build.modelId === definition.providerModelId));
});


test("a throwing budget logger preserves all twelve calls and still rejects the thirteenth before metering", async () => {
    const state = harness("house", () => { throw new Error("PRIVATE LOGGER DETAIL"); });
    const model = await state.resolver("reader", definition);
    for (let call = 0; call < 12; call++) await model.doGenerate(params);
    const before = state.records.length;
    await assert.rejects(model.doGenerate(params), error => error.name === "VerificationCallLimitError" && error.code === "verification_call_limit");
    assert.equal(state.providerCalls, 12);
    assert.equal(state.reservations.length, 12);
    assert.equal(state.records.length, before);
});

test("the actual INFO logger reports reserved counts 1 through 12 and a content-free rejection", async () => {
    const lines = [];
    const previous = console.info;
    console.info = (...args) => lines.push(args);
    try {
        await withTurnTrace(async () => {
            const state = harness();
            const model = await state.resolver("PRIVATE ACCOUNT", definition);
            for (let call = 0; call < 12; call++) await model.doGenerate(params);
            await assert.rejects(model.doGenerate(params), error => error.code === "verification_call_limit");
            return new Response("ok");
        })(new Request("https://fixture.invalid/api/ask-question"));
    } finally { console.info = previous; }
    const events = lines.filter(line => line[0] === "[ai.turn]").map(line => JSON.parse(line[1])).filter(event => event.stage === "verification-budget");
    assert.equal(events.length, 13);
    assert.deepEqual(events.filter(event => event.phase === "completed").map(event => event.verificationCalls), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.ok(events.every(event => event.verificationCallLimit === 12));
    assert.equal(events.at(-1).verificationCalls, 12);
    assert.equal(events.at(-1).errorClass, "QuotaError");
    assert.deepEqual(events.at(-1).issueCodes, ["verification_call_limit"]);
    const serialized = JSON.stringify(lines);
    for (const forbidden of ["PRIVATE ACCOUNT", "TEST-HOUSE-KEY", "Verify this.", "same-answer-head", "costMicros"]) assert.equal(serialized.includes(forbidden), false);
});
