import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Output } from "ai";
import { z } from "zod";
import { gateAnswer } from "../src/lib/ai/answer-gate.ts";
import { createDashStripper } from "../src/lib/ai/plain-dashes.ts";
import { traceTurn, classifyTurnError, withTurnTrace } from "../src/lib/ai/turn-trace.ts";
import { HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS } from "../src/lib/ai/verification-limits.mjs";

// Run the production orchestration and gate with a scripted provider, using the
// actual AsyncLocalStorage logger and its privacy allowlist. No external IO.
const source = stripTypeScriptTypes(readFileSync(new URL("../src/lib/ai/verified-generation.ts", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""));
const compile = new Function("generateText", "Output", "z", "doctrinalFoundation", "getChapter", "verifyScriptureDraft", "gateAnswer", "createDashStripper", "console", "HISTORY_REVIEW_CONTEXT_CHARS", "COMPLETE_VERIFICATION_REQUEST_CHARS", "traceTurn", "classifyTurnError", `${source}\nreturn verifyGeneratedAnswer;`);
const privateText = "PRIVATE_QUESTION_DRAFT_CONTEXT_REFERENCE_REASONING_8f4a";
const ref = (verse = 1) => ({ reference: `${privateText}:${verse}`, verses: [{ order: 43, chapter: 3, verse, text: privateText }] });
const checked = (text, references = [], issues = []) => ({ text, references, issues, ok: !issues.some(issue => issue.severity === "error"), originalEvidence: [] });
const verdict = prompt => ({ checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: prompt.expectedCheckedOriginalSources,
    allScriptureQuotationsVerified: true, allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: true, issues: [], requiredReferences: [] });
const usage = { inputTokens: 91, outputTokens: 17, totalTokens: 108, inputTokenDetails: { cacheReadTokens: 41, cacheWriteTokens: 9 }, outputTokenDetails: { reasoningTokens: 5 } };
function load(overrides = {}) {
    const requests = [];
    const verify = compile(async request => { requests.push(request); return (overrides.generate ?? (async value => ({ output: verdict(JSON.parse(value.prompt)), usage, finishReason: "stop" })))(request); }, Output, z, privateText,
        overrides.getChapter ?? (async () => Array(30).fill(privateText)), overrides.check ?? (async text => checked(text)), gateAnswer, createDashStripper, overrides.console ?? console,
        HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS, overrides.trace ?? traceTurn, classifyTurnError);
    return { verify, requests };
}
async function record(run) {
    const lines = [];
    const original = console.info;
    console.info = (...args) => lines.push(args);
    try {
        let result;
        const response = await withTurnTrace(async () => { result = await run(); return new Response("ok"); })(new Request("https://fixture.invalid/api/ask-question"));
        const events = lines.filter(line => line[0] === "[ai.turn]").map(line => JSON.parse(line[1]));
        assert.ok(events.length > 0);
        const traceId = response.headers.get("x-sureword-trace-id");
        assert.match(traceId, /^[a-f0-9-]{36}$/);
        assert.ok(events.every(event => event.traceId === traceId));
        assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
        assert.equal(JSON.stringify(lines).includes(privateText), false, "private source/reviewer/provider strings must never enter logs");
        return { result, events, traceId, lines };
    } finally { console.info = original; }
}
const opts = extra => ({ model: { fixture: true }, translation: "KJV", question: privateText, context: privateText, ...extra });
const blocks = [{ id: privateText, text: privateText }];
const steps = events => events.filter(event => ["verification", "canonical", "source-loading", "review", "repair", "evidence-completion"].includes(event.stage)).map(event => `${event.stage}:${event.phase}`);

test("success logs each canonical check and review in order, normalized usage and one request-local id", async () => {
    const fixture = load({ check: async text => checked(text, [ref()]) });
    const { result, events } = await record(() => fixture.verify(blocks, opts()));
    assert.equal(result.verified, true);
    assert.deepEqual(steps(events), ["verification:started", "canonical:started", "canonical:completed", "source-loading:started", "canonical:started", "canonical:completed", "canonical:started", "canonical:completed", "source-loading:completed", "review:started", "review:completed", "verification:completed"]);
    const review = events.find(event => event.stage === "review" && event.phase === "completed");
    for (const [key, value] of Object.entries({ inputTokens: 91, outputTokens: 17, totalTokens: 108, cacheReadTokens: 41, cacheWriteTokens: 9, reasoningTokens: 5, finishReason: "stop", coverageMatches: true, issueCount: 0 })) assert.equal(review[key], value);
    assert.equal(review.allScriptureQuotationsVerified, true);
    assert.equal(review.allCitationsSupportTheirClaims, true);
    assert.equal(review.faithfulToFoundation, true);
    assert.equal(review.answersRequestedQuestion, true);
    assert.ok(events.filter(event => event.stage === "canonical").every(event => event.timeoutMs === 75000 && event.remainingBudgetMs <= 75000));
    const second = await record(() => fixture.verify(blocks, opts()));
    assert.notEqual(second.traceId, events[0].traceId);
});

test("all true reviewer flags with private issues remain withheld and expose the nonempty issue count", async () => {
    const fixture = load({ generate: async request => ({ output: { ...verdict(JSON.parse(request.prompt)), issues: [privateText] } }) });
    const { result, events } = await record(() => fixture.verify(blocks, opts({ allowRepair: false })));
    assert.equal(result.verified, false);
    assert.deepEqual(result.issueCodes, ["review_rejected"]);
    const review = events.find(event => event.stage === "review" && event.phase === "completed");
    assert.equal(review.allScriptureQuotationsVerified, true);
    assert.equal(review.answersRequestedQuestion, true);
    assert.equal(review.issueCount, 1);
    assert.deepEqual(events.findLast(event => event.stage === "verification").issueCodes, ["review_rejected"]);
});

test("repair logs independent usage and rechecks every block without changing the gate", async () => {
    let reviews = 0;
    const fixture = load({ generate: async request => {
        const prompt = JSON.parse(request.prompt);
        if (request.system.includes("Repair the supplied answer")) return { output: { blocks: [{ id: privateText, text: privateText + " repaired" }] }, usage, finishReason: "stop" };
        return { output: { ...verdict(prompt), ...(reviews++ === 0 ? { answersRequestedQuestion: false, issues: [privateText] } : {}) }, usage, finishReason: "stop" };
    } });
    const { result, events } = await record(() => fixture.verify(blocks, opts()));
    assert.equal(result.verified, true);
    assert.equal(result.repaired, true);
    assert.equal(fixture.requests.length, 3);
    assert.deepEqual(events.filter(event => ["repair", "review"].includes(event.stage)).map(event => `${event.stage}:${event.phase}`), ["review:started", "review:completed", "repair:started", "repair:completed", "review:started", "review:completed"]);
    assert.equal(events.find(event => event.stage === "repair" && event.phase === "completed").cacheReadTokens, 41);
});

test("evidence completion records requested and retrieved counts before the second immutable review", async () => {
    let reviews = 0;
    const fixture = load({ check: async text => checked(text, text.startsWith("[[SCRIPTURE:") ? [ref(25)] : []), generate: async request => {
        const prompt = JSON.parse(request.prompt);
        return { output: { ...verdict(prompt), ...(reviews++ === 0 ? { allCitationsSupportTheirClaims: false, issues: [privateText], requiredReferences: [privateText] } : {}) } };
    } });
    const { result, events } = await record(() => fixture.verify(blocks, opts({ historyReview: true, allowRepair: false, requireCompleteContext: true, allowEvidenceCompletion: true })));
    assert.equal(result.verified, true);
    assert.equal(fixture.requests.length, 2);
    const completion = events.find(event => event.stage === "evidence-completion" && event.phase === "completed");
    assert.equal(completion.requestedReferenceCount, 1);
    assert.equal(completion.retrievedReferenceCount, 1);
    assert.equal(completion.complete, true);
    assert.ok(events.indexOf(completion) < events.findIndex(event => event.stage === "review" && event.phase === "started" && event.attempt === 2));
});

test("mechanical rejection retains its stable code despite an optimistic reviewer", async () => {
    const fixture = load({ check: async text => checked(text, [], [{ code: "quote_mismatch", severity: "error", message: privateText }]) });
    const { result, events } = await record(() => fixture.verify(blocks, opts({ allowRepair: false })));
    assert.equal(result.verified, false);
    assert.ok(result.issueCodes.includes("quote_mismatch"));
    assert.deepEqual(events.find(event => event.stage === "canonical" && event.phase === "completed").issueCodes, ["quote_mismatch"]);
});

for (const [name, errorName, status, expected] of [["provider", "AI_APICallError", 429, "ProviderError"], ["invalid output", "AI_NoObjectGeneratedError", undefined, "schema-error"]]) {
    test(`${name} failure logs only its stable classification and HTTP status`, async () => {
        const error = Object.assign(new Error(privateText), { name: errorName, statusCode: status, requestBodyValues: { question: privateText } });
        const fixture = load({ generate: async () => { throw error; } });
        const { result, events } = await record(() => fixture.verify(blocks, opts()));
        assert.equal(result.verified, false);
        const failure = events.find(event => event.stage === "review" && event.phase === "failed");
        assert.equal(failure.errorClass, expected);
        assert.equal(failure.httpStatus, status);
        assert.equal(fixture.requests.length, 1);
    });
}

test("canonical source failure differs from provider/schema failures and never starts inference", async () => {
    const fixture = load({ check: async () => { throw new Error(privateText); } });
    const { result, events } = await record(() => fixture.verify(blocks, opts()));
    assert.equal(result.verified, false);
    assert.equal(fixture.requests.length, 0);
    assert.equal(events.find(event => event.stage === "canonical" && event.phase === "failed").errorClass, "canonical-unavailable");
});

test("deadline records cancellation while a late canonical read cannot initiate inference", async () => {
    const controller = new AbortController();
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const fixture = load({ check: async text => { await waiting; return checked(text); } });
    const captured = await record(async () => {
        const answer = fixture.verify(blocks, opts({ signal: controller.signal }));
        await delay(10);
        controller.abort(new DOMException(privateText, "TimeoutError"));
        const result = await answer;
        release();
        await delay(10);
        return result;
    });
    assert.deepEqual(captured.result.issueCodes, ["verification_timeout"]);
    const terminal = captured.events.find(event => event.stage === "verification" && event.phase === "completed");
    assert.equal(terminal.aborted, true);
    assert.equal(terminal.errorClass, "TimeoutError");
    assert.equal(fixture.requests.length, 0);
});

test("a throwing diagnostic sink cannot change provider requests or successful truth decisions", async () => {
    const fixture = load({ trace: () => { throw new Error(privateText); }, console: { info() { throw new Error(privateText); } } });
    const result = await fixture.verify(blocks, opts());
    assert.equal(result.verified, true);
    assert.equal(fixture.requests.length, 1);
});


test("invalid structured output retains already available usage on its failed review event", async () => {
    const fixture = load({ generate: async () => ({ usage, finishReason: "stop", get output() { throw Object.assign(new Error(privateText), { name: "AI_NoObjectGeneratedError" }); } }) });
    const { result, events } = await record(() => fixture.verify(blocks, opts()));
    assert.equal(result.verified, false);
    const failure = events.find(event => event.stage === "review" && event.phase === "failed");
    assert.equal(failure.errorClass, "schema-error");
    assert.equal(failure.cacheReadTokens, 41);
    assert.equal(failure.totalTokens, 108);
});

test("a repair provider failure is attributed to repair and withholds the original draft", async () => {
    const fixture = load({ generate: async request => {
        if (request.system.includes("Repair the supplied answer")) throw Object.assign(new Error(privateText), { name: "AI_APICallError", statusCode: 503 });
        return { output: { ...verdict(JSON.parse(request.prompt)), answersRequestedQuestion: false, issues: [privateText] } };
    } });
    const { result, events } = await record(() => fixture.verify(blocks, opts()));
    assert.equal(result.verified, false);
    assert.equal(fixture.requests.length, 2);
    assert.equal(events.find(event => event.stage === "repair" && event.phase === "failed").httpStatus, 503);
    assert.equal(events.filter(event => event.stage === "review" && event.phase === "failed").length, 0);
});

test("a second model review failure does not relabel completed evidence retrieval as failed", async () => {
    let reviews = 0;
    const fixture = load({ check: async text => checked(text, text.startsWith("[[SCRIPTURE:") ? [ref(25)] : []), generate: async request => {
        if (reviews++ > 0) throw Object.assign(new Error(privateText), { name: "AI_APICallError", statusCode: 429 });
        return { output: { ...verdict(JSON.parse(request.prompt)), allCitationsSupportTheirClaims: false, issues: [privateText], requiredReferences: [privateText] } };
    } });
    const { result, events } = await record(() => fixture.verify(blocks, opts({ historyReview: true, allowRepair: false, requireCompleteContext: true, allowEvidenceCompletion: true })));
    assert.equal(result.verified, false);
    assert.equal(events.filter(event => event.stage === "evidence-completion" && event.phase === "completed").length, 1);
    assert.equal(events.filter(event => event.stage === "evidence-completion" && event.phase === "failed").length, 0);
    assert.equal(events.find(event => event.stage === "review" && event.phase === "failed").attempt, 2);
});

test("context/request budget rejection stays distinct from canonical source failure", async () => {
    const contextFixture = load();
    const context = await record(() => contextFixture.verify(blocks, opts({ context: "x".repeat(HISTORY_REVIEW_CONTEXT_CHARS + 1), maxContextChars: HISTORY_REVIEW_CONTEXT_CHARS, requireCompleteContext: true })));
    assert.equal(contextFixture.requests.length, 0);
    assert.deepEqual(context.result.issueCodes, ["verification_context_limit"]);
    assert.equal(context.events.findLast(event => event.stage === "verification").reason, "context-budget");
    const requestFixture = load({ check: async text => checked(text, [{ reference: privateText, verses: [{ order: 43, chapter: 3, verse: 1, text: "x".repeat(COMPLETE_VERIFICATION_REQUEST_CHARS) }] }]) });
    const request = await record(() => requestFixture.verify(blocks, opts({ requireCompleteContext: true })));
    assert.equal(request.result.verified, false);
    assert.equal(requestFixture.requests.length, 0);
    assert.equal(request.events.find(event => event.stage === "verification-request" && event.phase === "failed").reason, "context-budget");
});
