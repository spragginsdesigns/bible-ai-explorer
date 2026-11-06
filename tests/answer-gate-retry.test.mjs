/* A draft the pre-display gate withholds after its own single repair gets more
 * complete rounds before the reader sees "I couldn't finish checking this
 * answer". On 2026-11-05 (deploy a7e14daf) "What does Romans 8:28 mean for a
 * believer who is suffering?" was withheld this way: the gate's repair round
 * threw (verification_unavailable) and nothing ran again.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { gateErrorSummary, gateWithRetries } from "../src/lib/ai/answer-gate-retry.ts";

const passed = { blocks: [{ id: "a", text: "checked answer" }], verified: true, repaired: true, issueCodes: [] };
const rejected = (review) => ({ blocks: [{ id: "a", text: "withheld" }], verified: false, repaired: true, issueCodes: ["review_rejected"], ...(review ? { review } : {}) });
const unavailable = { blocks: [{ id: "a", text: "withheld" }], verified: false, repaired: true, issueCodes: ["verification_unavailable"] };
const findings = { pass: false, issues: ["missing context"], requiredReferences: ["Romans 8:18"] };
const roomy = { remainingMs: () => 200_000, maxExtraRounds: 2, minRoundMs: 45_000, maxRoundMs: 75_000 };

test("an approved first round runs once", async () => {
	const rounds = [];
	const result = await gateWithRetries(async (round) => { rounds.push(round); return passed; }, roomy);
	assert.equal(result, passed);
	assert.equal(rounds.length, 1);
	assert.equal(rounds[0].priorReview, undefined);
	assert.equal(rounds[0].timeoutMs, 75_000);
});

test("a rejection is repaired against its own findings in the next round", async () => {
	const rounds = [];
	const result = await gateWithRetries(async (round) => { rounds.push(round); return rounds.length === 1 ? rejected(findings) : passed; }, roomy);
	assert.equal(result.verified, true);
	assert.equal(rounds.length, 2);
	assert.equal(rounds[1].priorReview, findings);
});

test("a thrown review or repair runs the gate again from the draft", async () => {
	const rounds = [];
	const result = await gateWithRetries(async (round) => { rounds.push(round); return rounds.length === 1 ? unavailable : passed; }, roomy);
	assert.equal(result.verified, true);
	assert.equal(rounds[1].priorReview, undefined);
});

test("at most two extra rounds, and the last withheld result is returned", async () => {
	let calls = 0;
	const result = await gateWithRetries(async () => { calls++; return rejected(findings); }, roomy);
	assert.equal(calls, 3);
	assert.equal(result.verified, false);
	assert.deepEqual(result.issueCodes, ["review_rejected"]);
});

test("no round starts without time for a whole one", async () => {
	let left = 50_000;
	const rounds = [];
	const result = await gateWithRetries(async (round) => { rounds.push(round); left -= 10_000; return rejected(findings); }, { ...roomy, remainingMs: () => left });
	assert.equal(rounds.length, 1, "40s left is under the 45s a round needs");
	assert.equal(rounds[0].timeoutMs, 50_000);
	assert.equal(result.verified, false);
});

test("a later round's timeout never runs past the deadline", async () => {
	let left = 120_000;
	const rounds = [];
	await gateWithRetries(async (round) => { rounds.push(round); left -= 60_000; return rejected(findings); }, { ...roomy, remainingMs: () => left });
	assert.equal(rounds.length, 2);
	assert.equal(rounds[1].timeoutMs, 60_000);
});

test("limits another round cannot change stop at once", async () => {
	for (const code of ["answer_limit", "verification_context_limit", "repair_not_allowed"]) {
		let calls = 0;
		await gateWithRetries(async () => { calls++; return { ...unavailable, issueCodes: [code] }; }, roomy);
		assert.equal(calls, 1, code);
	}
});

test("a failed step is summarised without its message", () => {
	const error = Object.assign(new Error("No object generated: the draft said <private text>"), { name: "AI_NoObjectGeneratedError", finishReason: "length" });
	assert.deepEqual(gateErrorSummary(error), { name: "AI_NoObjectGeneratedError", finishReason: "length" });
	assert.deepEqual(gateErrorSummary(Object.assign(new Error("x"), { name: "AI_APICallError", statusCode: 500 })), { name: "AI_APICallError", statusCode: 500 });
	assert.deepEqual(gateErrorSummary("boom"), { name: "string" });
	assert.ok(!JSON.stringify(gateErrorSummary(error)).includes("private"));
});
