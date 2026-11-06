import assert from "node:assert/strict";
import test from "node:test";
import { captureTurnTrace, classifyTurnError, registerTurnTraceCatalog, traceTurn, withTurnTrace } from "../src/lib/ai/turn-trace.ts";
import { classifyChatOutcome } from "../src/lib/ai/chat-metrics.ts";

async function collect(run) {
	const original = console.info;
	const events = [];
	console.info = (prefix, serialized) => { if (prefix === "[ai.turn]") events.push(JSON.parse(serialized)); };
	try { await run(events); } finally { console.info = original; }
	return events;
}
const request = () => new Request("https://sureword.test/api/ask-question", { headers: { "x-sureword-trace-id": "caller-controlled-secret" } });
const tick = () => new Promise(resolve => setTimeout(resolve, 2));

test("concurrent requests keep distinct server trace ids through async stream and persistence callbacks", async () => {
	await collect(async events => {
		const handler = withTurnTrace(async () => {
			registerTurnTraceCatalog({ tools: ["searchScripture"], models: ["gpt-6-luna"] });
			return new Response(new ReadableStream({
				async start(controller) {
					await tick();
					traceTurn("tool", "started", { toolName: "searchScripture" });
					await tick();
					traceTurn("tool", "completed", { model: "gpt-6-luna" });
					traceTurn("stream", "completed");
					await tick();
					traceTurn("persistence", "completed", { persisted: true });
					traceTurn("turn", "completed", { outcome: "answered" });
					controller.enqueue(new TextEncoder().encode("data: answer\n\n"));
					controller.close();
				},
			}), { headers: { "content-type": "text/event-stream", "x-existing": "retained" } });
		});
		const responses = await Promise.all([handler(request()), handler(request())]);
		assert.notEqual(responses[0].headers.get("x-sureword-trace-id"), responses[1].headers.get("x-sureword-trace-id"));
		assert.equal(events.some(event => event.stage === "turn"), false, "headers are not turn success");
		for (const response of responses) {
			assert.equal(response.headers.get("x-existing"), "retained");
			assert.equal(await response.text(), "data: answer\n\n");
			const id = response.headers.get("x-sureword-trace-id");
			assert.match(id, /^[0-9a-f-]{36}$/);
			const scoped = events.filter(event => event.traceId === id);
			assert.deepEqual(scoped.map(event => event.sequence), scoped.map((_, index) => index + 1));
			assert.equal(scoped.filter(event => event.stage === "turn").length, 1);
			assert.equal(scoped.at(-1).outcome, "answered");
			assert.ok(scoped.findIndex(event => event.stage === "persistence") < scoped.findIndex(event => event.stage === "turn"));
		}
	});
});

test("shape allowlist strips adversarial content, spoofed names, nested payloads and invalid scalars", async () => {
	const secret = "PRIVATE_question_key_user_id_url";
	const events = await collect(async () => {
		await withTurnTrace(async () => {
			registerTurnTraceCatalog({ tools: ["searchScripture"], models: ["gpt-6-luna"] });
			traceTurn("review", "completed", {
				question: secret, userId: secret, conversationId: secret, memory: secret,
				toolArgs: { secret }, output: secret, model: secret, toolName: secret,
				errorClass: secret, reason: secret, outcome: secret, purpose: secret,
				inputTokens: Infinity, outputTokens: -2, totalTokens: 1e99,
				certified: secret, issueCount: 3, fallback: true,
				issueCodes: [secret, "quote_mismatch", "quote_mismatch", "context_limit"],
			});
			traceTurn("tool", "completed", { toolName: "searchScripture", model: "gpt-6-luna", inputTokens: 8 });
			const fields = { issueCount: 2 };
			Object.defineProperty(fields, "privateGetter", { enumerable: true, get() { throw new Error(secret); } });
			traceTurn("review", "completed", fields);
			return new Response("unchanged");
		})(request());
	});
	assert.equal(JSON.stringify(events).includes(secret), false);
	const review = events.find(event => event.stage === "review");
	assert.equal(review.issueCount, 3);
	assert.equal(review.totalTokens, 1_000_000_000);
	assert.equal("inputTokens" in review, false);
	assert.equal("outputTokens" in review, false);
	assert.equal("certified" in review, false);
	assert.deepEqual(review.issueCodes, ["quote_mismatch", "context_limit"]);
	assert.equal(events.find(event => event.stage === "tool").toolName, "searchScripture");
	assert.equal(events.filter(event => event.stage === "review").length, 2);
});

test("captured callbacks restore the trace when a stream consumer invokes them outside the request chain", async () => {
	await collect(async events => {
		const callbacks = [];
		const handler = withTurnTrace(async () => {
			const inTrace = captureTurnTrace();
			callbacks.push(() => inTrace(async () => {
				await tick();
				traceTurn("persistence", "completed", { persisted: true });
				traceTurn("turn", "completed", { outcome: "answered" });
			}));
			return new Response("body");
		});
		const first = await handler(request());
		const second = await handler(request());
		await Promise.all(callbacks.map(callback => callback()));
		for (const response of [first, second]) {
			const scoped = events.filter(event => event.traceId === response.headers.get("x-sureword-trace-id"));
			assert.equal(scoped.at(-1).stage, "turn");
			assert.equal(scoped.at(-1).outcome, "answered");
			assert.equal(scoped.filter(event => event.stage === "persistence").length, 1);
		}
	});
});

test("no outer scope means no log, and a failed logger never changes response or stream body", async () => {
	const original = console.info;
	console.info = () => { throw new Error("logger unavailable"); };
	try {
		assert.doesNotThrow(() => traceTurn("review", "failed", { issueCount: 1 }));
		const response = await withTurnTrace(async () => {
			traceTurn("turn", "completed", { outcome: "withheld" });
			return new Response("exact original body", { status: 429, headers: { "retry-after": "30" } });
		})(request());
		assert.equal(response.status, 429);
		assert.equal(response.headers.get("retry-after"), "30");
		assert.ok(response.headers.get("x-sureword-trace-id"));
		assert.equal(await response.text(), "exact original body");
	} finally { console.info = original; }
});

test("response headers and streaming body remain unread for success and every route error status", async () => {
	await collect(async events => {
		for (const status of [200, 400, 401, 403, 404, 429, 500, 503]) {
			const original = new Response(`body-${status}`, { status, headers: { "content-type": "text/event-stream", "x-preserved": "yes" } });
			const response = await withTurnTrace(async () => original)(request());
			assert.equal(original.bodyUsed, false);
			assert.equal(response.body, original.body);
			assert.equal(response.status, status);
			assert.equal(response.headers.get("x-preserved"), "yes");
			assert.equal(await response.text(), `body-${status}`);
			const scoped = events.filter(event => event.traceId === response.headers.get("x-sureword-trace-id"));
			if (status === 200) assert.equal(scoped.some(event => event.stage === "turn"), false);
			else assert.equal(scoped.at(-1).outcome, "failed");
		}
	});
});

test("safe error classification never emits writable names, messages, nested data or getter exceptions", () => {
	const secret = "PrivateUserName";
	const error = new Error(secret);
	error.name = secret;
	error.statusCode = 429;
	assert.deepEqual(classifyTurnError(error), { errorClass: "Error", httpStatus: 429 });
	error.name = "AI_APICallError";
	assert.equal(classifyTurnError(error).errorClass, "ProviderError");
	error.name = "AI_NoObjectGeneratedError";
	assert.equal(classifyTurnError(error).errorClass, "schema-error");
	Object.defineProperty(error, "name", { get() { throw new Error(secret); } });
	assert.deepEqual(classifyTurnError(error), { errorClass: "Error" });
	assert.deepEqual(classifyTurnError({ name: secret, message: secret }), { errorClass: "NonError" });
	assert.deepEqual(classifyTurnError(new DOMException(secret, "TimeoutError")), { errorClass: "TimeoutError" });
	class HistoryError extends Error {}
	assert.equal(classifyTurnError(new HistoryError(secret)).errorClass, "HistoryError");
});

test("disconnects stay correlated without cancelling work and terminal outcome is emitted once", async () => {
	await collect(async events => {
		const controller = new AbortController();
		const response = await withTurnTrace(async () => {
			setTimeout(() => {
				traceTurn("persistence", "completed", { persisted: true });
				traceTurn("turn", "completed", { outcome: "answered" });
				traceTurn("turn", "failed", { outcome: "failed" });
			}, 5);
			return new Response("answer");
		})(new Request("https://sureword.test", { signal: controller.signal }));
		controller.abort();
		await new Promise(resolve => setTimeout(resolve, 12));
		const id = response.headers.get("x-sureword-trace-id");
		assert.ok(events.some(event => event.traceId === id && event.reason === "disconnect"));
		assert.equal(events.filter(event => event.stage === "turn").length, 1);
		assert.equal(events.at(-1).outcome, "answered");
	});
});

test("terminal outcomes use authoritative dispositions and persistence exits, including tool-only answers", () => {
	const base = { exit: "persisted", error: null, answerHasText: true };
	assert.equal(classifyChatOutcome(base), "answered");
	assert.equal(classifyChatOutcome({ ...base, answerDisposition: "withheld" }), "withheld");
	assert.equal(classifyChatOutcome({ ...base, answerDisposition: "incomplete" }), "incomplete");
	assert.equal(classifyChatOutcome({ ...base, error: new Error("provider failed") }), "incomplete");
	assert.equal(classifyChatOutcome({ ...base, answerHasText: false }), "answered");
	assert.equal(classifyChatOutcome({ ...base, exit: "aborted", answerDisposition: "withheld" }), "cancelled");
	assert.equal(classifyChatOutcome({ ...base, exit: "persist_error", answerDisposition: "withheld" }), "failed");
	assert.equal(classifyChatOutcome({ ...base, exit: "conversation_missing" }), "failed");
	assert.equal(classifyChatOutcome({ ...base, exit: "empty_response" }), "incomplete");
	assert.equal(classifyChatOutcome({ ...base, exit: "empty_response", error: new Error("setup failed") }), "failed");
});
