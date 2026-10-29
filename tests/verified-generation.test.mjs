import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Output } from "ai";
import { z } from "zod";
import { gateAnswer } from "../src/lib/ai/answer-gate.ts";
import { createDashStripper } from "../src/lib/ai/plain-dashes.ts";

// Execute the production module with only external/provider dependencies injected.
// Its orchestration, deadline, coverage checks, real gate and dash handling run unchanged.
const production = stripTypeScriptTypes(readFileSync(new URL("../src/lib/ai/verified-generation.ts", import.meta.url), "utf8")
	.replace(/^import .*;\n/gm, "").replace(/^export /gm, ""));
const compile = new Function("generateText", "Output", "z", "doctrinalFoundation", "getChapter", "verifyScriptureDraft", "gateAnswer", "createDashStripper", "console", `${production}\nreturn { verifyGeneratedAnswer, verifiedTextStream, VERIFICATION_UNAVAILABLE };`);
const reference = (name = "John 3:16") => ({ reference: name, verses: [{ order: 43, chapter: 3, verse: 16, text: "Canonical Scripture words." }] });
const checked = (text, refs = [], extra = {}) => ({ text, ok: true, issues: [], references: refs, originalEvidence: [], ...extra });
const options = extra => ({ model: { test: true }, providerOptions: { openai: { reasoningEffort: "low" } }, translation: "KJV", question: "Explain the passage.", ...extra });
const pass = prompt => ({ checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: prompt.expectedCheckedOriginalSources,
	allScriptureQuotationsVerified: true, allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: true, issues: [], requiredReferences: [] });
function load(overrides = {}) {
	const requests = [];
	const verify = overrides.verifyScriptureDraft ?? (async text => checked(text));
	const generate = overrides.generateText ?? (async request => ({ output: pass(JSON.parse(request.prompt)) }));
	const module = compile(async request => { requests.push(request); return generate(request); }, Output, z, "FIXED FOUNDATION FIXTURE", overrides.getChapter ?? (async () => Array.from({ length: 30 }, (_, i) => `Canonical verse ${i + 1}`)), verify, gateAnswer, createDashStripper, { info() {} });
	return { ...module, requests };
}

test("deadline covers a slow canonical source and a late result cannot release text", async () => {
	let sourceReturned = false;
	const module = load({ verifyScriptureDraft: async text => { await delay(1500); sourceReturned = true; return checked(text); } });
	const started = performance.now();
	const outcome = await module.verifyGeneratedAnswer([{ id: "answer", text: "Do not leak this draft." }], options({ timeoutMs: 1000 }));
	const elapsed = performance.now() - started;
	assert.ok(elapsed >= 900 && elapsed < 1450, `deadline took ${elapsed}ms`);
	assert.equal(sourceReturned, false);
	assert.equal(outcome.verified, false);
	assert.deepEqual(outcome.issueCodes, ["verification_timeout"]);
	assert.equal(outcome.blocks[0].text, module.VERIFICATION_UNAVAILABLE.en);
	await delay(650);
	assert.equal(sourceReturned, true);
	assert.equal(module.requests.length, 0, "aborted source completion must not initiate a review");
	assert.equal(outcome.blocks[0].text.includes("Do not leak"), false);
});

test("review coverage is the exact draft reference set, with question evidence kept separate", async () => {
	const module = load({ verifyScriptureDraft: async text => checked(text, [reference(text === "Question Matthew 5:9" ? "Matthew 5:9" : text === "Background Romans 8:28" ? "Romans 8:28" : "John 3:16")]) });
	const outcome = await module.verifyGeneratedAnswer([{ id: "a", text: "Draft John 3:16" }], options({ question: "Question Matthew 5:9", context: "Background Romans 8:28" }));
	assert.equal(outcome.verified, true);
	const prompt = JSON.parse(module.requests[0].prompt);
	assert.deepEqual(prompt.expectedCheckedReferences, ["John 3:16"]);
	assert.deepEqual(prompt.canonical.questionEvidence.map(item => item.reference), ["Matthew 5:9"]);
	assert.deepEqual(prompt.canonical.contextEvidence.map(item => item.reference), ["Romans 8:28"]);
	assert.equal(prompt.extraContext, "Background Romans 8:28");
	assert.deepEqual(prompt.expectedCheckedOriginalSources, []);
	assert.equal(module.requests[0].providerOptions.openai.reasoningEffort, "high");
	assert.ok(module.requests[0].system.startsWith("FIXED FOUNDATION FIXTURE"));
});

test("a reviewer cannot omit or duplicate a draft citation or original source", async () => {
	for (const coverage of [
		{ checkedReferences: [], checkedOriginalSources: ["TR John 3:16"] },
		{ checkedReferences: ["John 3:16", "John 3:16"], checkedOriginalSources: ["TR John 3:16"] },
		{ checkedReferences: ["John 3:16"], checkedOriginalSources: [] },
		{ checkedReferences: ["John 3:16"], checkedOriginalSources: ["WLC 1:1"] },
	]) {
		const module = load({
			verifyScriptureDraft: async text => checked(text, [reference()], { originalEvidence: [{ book: "John", sourceIdentifier: "TR John 3:16", words: ["Greek source"] }] }),
			generateText: async request => { const prompt = JSON.parse(request.prompt); return { output: request.system.includes("Repair the supplied answer") ? { blocks: prompt.blocks.map(({ id, text }) => ({ id, text })) } : { ...pass(prompt), ...coverage } }; },
		});
		const outcome = await module.verifyGeneratedAnswer([{ id: "a", text: "Draft citation and original word." }], options());
		assert.equal(outcome.verified, false);
		assert.equal(outcome.repaired, true);
		assert.equal(outcome.blocks[0].text, module.VERIFICATION_UNAVAILABLE.en);
	}
});

test("mechanically rejected quotations cannot pass on an optimistic semantic review", async () => {
	const module = load({
		verifyScriptureDraft: async text => checked(text, [reference()], { ok: false, issues: [{ code: "quote_mismatch", message: "Wrong source wording", severity: "error" }] }),
		generateText: async request => { const prompt = JSON.parse(request.prompt); return { output: request.system.includes("Repair the supplied answer") ? { blocks: [{ id: "a", text: "Still a wrong quotation." }] } : pass(prompt) }; },
	});
	const outcome = await module.verifyGeneratedAnswer([{ id: "a", text: "Unattributed wrong Scripture quotation." }], options());
	assert.equal(outcome.verified, false);
	assert.ok(outcome.issueCodes.includes("quote_mismatch"));
	const instructions = module.requests[0].system;
	for (const contract of ["unattributed wording", "inline quotes", "fenced/code text", "numbered blocks", "speaker, audience, negation"]) assert.ok(instructions.includes(contract));
});

test("original source coverage is qualified by book, not just shared WLC coordinates", async () => {
  const module = load({ verifyScriptureDraft: async text => checked(text, [], { originalEvidence: [
    { book:'Genesis',sourceIdentifier:'WLC1:1' }, { book:'Exodus',sourceIdentifier:'WLC1:1' },
  ] }) });
  assert.equal((await module.verifyGeneratedAnswer([{id:'a',text:'Original sources'}],options())).verified,true);
  assert.deepEqual(JSON.parse(module.requests[0].prompt).expectedCheckedOriginalSources,['Genesis (WLC1:1)','Exodus (WLC1:1)']);
});

test("repair passes through the real dash stripper and another complete review", async () => {
	let reviews = 0;
	const em = String.fromCodePoint(0x2014);
	const module = load({ generateText: async request => {
		const prompt = JSON.parse(request.prompt);
		if (request.system.includes("Repair the supplied answer")) return { output: { blocks: [{ id: "a", text: `Grace ${em} received.` }] } };
		reviews += 1;
		return { output: { ...pass(prompt), ...(reviews === 1 ? { answersRequestedQuestion: false, issues: ["Answer the question"] } : {}) } };
	} });
	const outcome = await module.verifyGeneratedAnswer([{ id: "a", text: "Needs repair." }], options());
	assert.equal(outcome.verified, true);
	assert.equal(outcome.repaired, true);
	assert.equal(reviews, 2);
	assert.equal(outcome.blocks[0].text, "Grace, received.");
	assert.equal(JSON.parse(module.requests[2].prompt).blocks[0].text.includes(em), false);
});

test("provider failures withhold every draft block without leaking exceptions", async () => {
	const module = load({ generateText: async () => { throw new Error("PROVIDER PRIVATE DETAIL"); } });
	const outcome = await module.verifyGeneratedAnswer([{ id: "a", text: "Raw draft" }, { id: "b", text: "Other raw draft" }], options({ language: "es" }));
	assert.equal(outcome.verified, false);
	assert.deepEqual(outcome.blocks, [{ id: "a", text: module.VERIFICATION_UNAVAILABLE.es }, { id: "b", text: "" }]);
	assert.equal(JSON.stringify(outcome).includes("PRIVATE DETAIL"), false);
});

test("plain stream emits only blank keepalives until decision, then closes cleanly", async () => {
	const module = load();
	let decide;
	const answer = new Promise(resolve => { decide = resolve; });
	const reader = module.verifiedTextStream(answer, 5).getReader();
	const hold = delay(200);
	const first = await reader.read();
	assert.equal(first.value, "\n");
	const second = await reader.read();
	assert.equal(second.value, "\n");
	decide("Checked answer.");
	let text = "";
	for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += chunk.value; }
	assert.equal(text.trim(), "Checked answer.");
	await hold;
});

test("cancelled plain stream ignores late answer and late provider failure", async () => {
	const module = load();
	for (const rejectLate of [false, true]) {
		let resolve, reject;
		const answer = new Promise((done, fail) => { resolve = done; reject = fail; });
		const reader = module.verifiedTextStream(answer, 5).getReader();
		await reader.cancel();
		if (rejectLate) reject(new Error("late provider failure")); else resolve("Late answer must not enqueue");
		await delay(15);
		assert.deepEqual(await reader.read(), { value: undefined, done: true });
	}
});

test("complete original-source coverage passes and is deduplicated across answer blocks", async () => {
	const module = load({ verifyScriptureDraft: async text => checked(text, [reference()], { originalEvidence: [
		{ book: "John", sourceIdentifier: "TR John 3:16", words: ["Greek text"] },
		{ book: "Psalms", sourceIdentifier: "WLC 51:3", words: ["Hebrew text"] },
	] }) });
	const outcome = await module.verifyGeneratedAnswer([{ id: "a", text: "Original-language statement." }, { id: "b", text: "Second statement from the same source." }], options());
	assert.equal(outcome.verified, true);
	const prompt = JSON.parse(module.requests[0].prompt);
	assert.deepEqual(prompt.expectedCheckedReferences, ["John 3:16"]);
	assert.deepEqual(prompt.expectedCheckedOriginalSources, ["John (TR John 3:16)", "Psalms (WLC 51:3)"]);
});
