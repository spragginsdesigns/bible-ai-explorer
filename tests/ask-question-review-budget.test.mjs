import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { generateText, Output } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { gateAnswer } from "../src/lib/ai/answer-gate.ts";
import { createDashStripper } from "../src/lib/ai/plain-dashes.ts";
import { traceTurn, classifyTurnError } from "../src/lib/ai/turn-trace.ts";
import { PREPARED_CONTEXT_CHARS, HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS } from "../src/lib/ai/verification-limits.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("src/app/api/ask-question/route.ts");
const verifierSource = stripTypeScriptTypes(read("src/lib/ai/verified-generation.ts").replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""));
const verifyGeneratedAnswer = new Function("generateText", "Output", "z", "doctrinalFoundation", "getChapter", "verifyScriptureDraft", "gateAnswer", "createDashStripper", "HISTORY_REVIEW_CONTEXT_CHARS", "COMPLETE_VERIFICATION_REQUEST_CHARS", "traceTurn", "classifyTurnError", `${verifierSource}\nreturn verifyGeneratedAnswer;`)(
	generateText, Output, z, "Synthetic foundation fixture.", async () => { throw new Error("No Scripture/network dependency in this budget-only test"); },
	async text => ({ ok: true, text, references: [], issues: [], originalEvidence: [] }), gateAnswer, createDashStripper,
	HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS, traceTurn, classifyTurnError,
);
const extract = (start, end) => {
	const offset = route.indexOf(start);
	assert.ok(offset >= 0, `Actual route block exists: ${start}`);
	const finish = route.indexOf(end, offset);
	assert.ok(finish > offset, `Actual route block ends: ${end}`);
	return stripTypeScriptTypes(route.slice(offset, finish));
};
const blocks = [{ id: "fixture", text: "Fixture response." }];
function fixture() {
	const question = "Fixture question.";
	const messages = [{ id: "fixture-user", role: "user", parts: [{ type: "text", text: question }] }];
	// Match the observed owner prompt's stable/volatile sizes using synthetic
	// text only. Escaping consumes the remaining raw-capture allowance, so the
	// composite review must have its separate budget even before any tool output.
	const stableChars = 28_157, volatileChars = 32_371, fullChars = stableChars + volatileChars;
	const baseCaptureChars = JSON.stringify({ messages, systemContext: "x".repeat(fullChars) }).length;
	const newlineCount = PREPARED_CONTEXT_CHARS - 32 - baseCaptureChars;
	assert.ok(newlineCount > 0 && newlineCount < volatileChars);
	const volatile = "v".repeat(volatileChars - newlineCount) + "\n".repeat(newlineCount);
	const system = "s".repeat(stableChars) + volatile;
	assert.equal(system.length, fullChars);
	assert.ok(JSON.stringify({ messages, systemContext: system }).length < PREPARED_CONTEXT_CHARS);
	const preparedContext = JSON.stringify({ preparedRequest: messages, preparedSystemContext: system });
	const canonicalPreparedContext = JSON.stringify({ preparedRequest: messages, preparedSystemContext: volatile });
	const prompts = [];
	const model = new MockLanguageModelV4({ doGenerate: async options => {
		const prompt = JSON.parse(options.prompt.find(message => message.role === "user").content.find(part => part.type === "text").text);
		prompts.push(prompt);
		return { content: [{ type: "text", text: JSON.stringify({ checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: prompt.expectedCheckedOriginalSources, allScriptureQuotationsVerified: true, allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: true, issues: [], requiredReferences: [] }) }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };
	} });
	return { model, prompts, question, preparedContext, canonicalPreparedContext };
}

test("the actual ask-question answer review builder gives expanded prepared evidence the shared 128k budget", async t => {
	t.mock.method(globalThis, "fetch", () => { throw new Error("External IO forbidden"); });
	t.mock.method(console, "info", () => {});
	const f = fixture();
	const body = extract("const answerReviewOptions = async () => {", "\n\t\t\t\t\tconst checkedAnswer =");
	const optionsFor = new Function("verificationModel", "providerOptions", "translation", "language", "reviewQuestion", "reviewMediaParts", "preparedContext", "canonicalPreparedContext", "toolReceipts", "noteWriteIds", "readSavedNoteEvidence", "prisma", "userId", "HISTORY_REVIEW_CONTEXT_CHARS", `${body}\nreturn answerReviewOptions;`)(
		f.model, {}, "KJV", "en", f.question, [], f.preparedContext, f.canonicalPreparedContext,
		[{ tool: "readStudy", success: true, result: "Synthetic owned tool evidence." }], new Set(), () => { throw new Error("No saved notes in this fixture"); }, {}, "fixture-owner", HISTORY_REVIEW_CONTEXT_CHARS,
	);
	const options = await optionsFor();
	assert.equal(options.maxContextChars, HISTORY_REVIEW_CONTEXT_CHARS);
	assert.equal(options.requireCompleteContext, true);
	assert.ok(options.context.length > PREPARED_CONTEXT_CHARS);
	assert.ok(options.context.length <= HISTORY_REVIEW_CONTEXT_CHARS);
	const baseline = await verifyGeneratedAnswer(blocks, { ...options, maxContextChars: PREPARED_CONTEXT_CHARS });
	assert.equal(baseline.verified, false);
	assert.deepEqual(baseline.issueCodes, ["verification_context_limit"]);
	assert.equal(f.model.doGenerateCalls.length, 0, "the stale caller opt-in refused before review");
	const result = await verifyGeneratedAnswer(blocks, options);
	assert.equal(result.verified, true);
	assert.equal(f.model.doGenerateCalls.length, 1);
	assert.equal(f.prompts[0].extraContext, options.context, "complete composite context reaches the reviewer unchanged");
	assert.equal(JSON.parse(f.prompts[0].extraContext).preparedRequest, f.preparedContext);
});

test("the actual generated-tool-content review caller uses the same expanded budget without clipping", async t => {
	t.mock.method(globalThis, "fetch", () => { throw new Error("External IO forbidden"); });
	t.mock.method(console, "info", () => {});
	const f = fixture(), calls = [];
	const body = extract("verifyToolContent = async (blocks, purpose) => {", "\n\t\t\t\t\tmetricProvider =");
	const verifyToolContent = new Function("verifyGeneratedAnswer", "verificationModel", "providerOptions", "translation", "language", "reviewQuestion", "reviewMediaParts", "preparedContext", "canonicalPreparedContext", "turnStartedAtMs", "HISTORY_REVIEW_CONTEXT_CHARS", `let verifyToolContent;${body}\nreturn verifyToolContent;`)(
		async (input, options) => { calls.push(options); return verifyGeneratedAnswer(input, options); }, f.model, {}, "KJV", "en", f.question, [], f.preparedContext, f.canonicalPreparedContext, Date.now(), HISTORY_REVIEW_CONTEXT_CHARS,
	);
	const approved = await verifyToolContent(blocks, "synthetic note fixture");
	assert.deepEqual(approved, blocks);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].maxContextChars, HISTORY_REVIEW_CONTEXT_CHARS);
	assert.equal(calls[0].requireCompleteContext, true);
	assert.ok(calls[0].context.length > PREPARED_CONTEXT_CHARS);
	assert.ok(calls[0].context.endsWith(f.preparedContext));
	assert.equal(f.model.doGenerateCalls.length, 1);
	assert.equal(f.prompts[0].extraContext, calls[0].context);
	const baseline = await verifyGeneratedAnswer(blocks, { ...calls[0], maxContextChars: PREPARED_CONTEXT_CHARS });
	assert.equal(baseline.verified, false);
	assert.deepEqual(baseline.issueCodes, ["verification_context_limit"]);
	assert.equal(f.model.doGenerateCalls.length, 1, "old caller cap adds no reviewer request");
});
