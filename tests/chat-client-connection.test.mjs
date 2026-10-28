import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { createChatClientConnection } from "../src/lib/chat-client-connection.ts";

function deferred() {
	let resolve;
	const promise = new Promise((accept) => { resolve = accept; });
	return { promise, resolve };
}

async function collectSse(stream) {
	const reader = stream.getReader();
	let result = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) return result;
			result += chunk.value;
		}
	} finally {
		reader.releaseLock();
	}
}

/** Exercise the installed SDK's actual tee, finish callback and SSE encoding. */
function answerStream(connection, onEnd = () => {}) {
	const generation = deferred();
	const ended = deferred();
	let drained;
	const stream = createUIMessageStream({
		generateId: () => "answer-qa",
		onEnd(event) {
			onEnd(event);
			ended.resolve(event);
		},
		execute: async ({ writer }) => {
			writer.write({ type: "start", messageId: "answer-qa" });
			writer.write({ type: "text-start", id: "text-qa" });
			writer.write({ type: "text-delta", id: "text-qa", delta: "The Lord is my shepherd; " });
			await generation.promise;
			writer.write({ type: "text-delta", id: "text-qa", delta: "I shall not want." });
			writer.write({ type: "text-end", id: "text-qa" });
			writer.write({ type: "finish", finishReason: "stop" });
		},
	});
	const response = createUIMessageStreamResponse({
		stream,
		status: 202,
		statusText: "Accepted",
		headers: { "x-qa-header": "preserved" },
		consumeSseStream: ({ stream: copy }) => { drained = collectSse(copy); },
	});
	return {
		response: connection.trackResponse(response),
		generation,
		ended: ended.promise,
		drained,
	};
}

test("response cancellation is synchronous while the SDK drain finishes the whole answer", { timeout: 5000 }, async () => {
	const request = new Request("https://example.test/api/ask-question");
	const connection = createChatClientConnection(request.signal);
	let finished = false;
	let notifications = 0;
	const persisted = deferred();
	let notificationWork;
	const answer = answerStream(connection, () => {
		finished = true;
		notificationWork = persisted.promise.then(() => connection.afterPersistence(async () => { notifications += 1; }));
	});
	const reader = answer.response.body.getReader();
	await reader.read();
	const cancellation = reader.cancel("app quit");
	let drainSettled = false;
	void answer.drained.then(() => { drainSettled = true; });

	assert.equal(connection.disconnected, true, "do not await the tee's other reader to record departure");
	assert.equal(request.signal.aborted, false, "the response body is an independent disconnect signal");
	await nextTurn();
	assert.equal(drainSettled, false, "the server is still waiting for the rest of the answer");
	assert.equal(finished, false);

	answer.generation.resolve();
	const [event, sse] = await Promise.all([answer.ended, answer.drained, cancellation]);
	assert.equal(event.isAborted, false, "client departure must not abort answer generation");
	assert.equal(event.responseMessage.parts.find((part) => part.type === "text").text,
		"The Lord is my shepherd; I shall not want.");
	assert.match(sse, /I shall not want\./);
	assert.match(sse, /data: \[DONE\]/);
	assert.equal(notifications, 0, "departure alone cannot notify before the answer is saved");
	persisted.resolve();
	await notificationWork;
	assert.equal(notifications, 1);
});

test("normal EOF before persistence preserves SSE and prevents a late abort notification", { timeout: 5000 }, async () => {
	const request = new AbortController();
	const connection = createChatClientConnection(request.signal);
	const answer = answerStream(connection);
	assert.equal(answer.response.status, 202);
	assert.equal(answer.response.statusText, "Accepted");
	assert.equal(answer.response.headers.get("x-qa-header"), "preserved");
	assert.match(answer.response.headers.get("content-type"), /text\/event-stream/);
	answer.generation.resolve();
	const [clientSse, serverSse] = await Promise.all([answer.response.text(), answer.drained]);
	assert.equal(clientSse, serverSse);
	assert.equal(connection.disconnected, false);
	await answer.ended;
	request.abort("normal response teardown");
	assert.equal(connection.disconnected, false, "EOF detaches the request abort observer");
	let notifications = 0;
	await connection.afterPersistence(async () => { notifications += 1; });
	assert.equal(notifications, 0);
});

test("departure is recorded before a pending tee cancellation resolves", { timeout: 5000 }, async () => {
	const connection = createChatClientConnection(new AbortController().signal);
	let source;
	let sourceCancelled = false;
	const stream = new ReadableStream({
		start(controller) { source = controller; },
		cancel() { sourceCancelled = true; },
	});
	const [client, server] = stream.tee();
	const response = connection.trackResponse(new Response(client));
	const drained = new Response(server).text();
	const reader = response.body.getReader();
	source.enqueue(new TextEncoder().encode("first "));
	await reader.read();
	const cancellation = reader.cancel("app quit");
	let cancellationSettled = false;
	void cancellation.then(() => { cancellationSettled = true; });
	assert.equal(connection.disconnected, true);
	await nextTurn();
	assert.equal(cancellationSettled, false);
	assert.equal(sourceCancelled, false);
	source.enqueue(new TextEncoder().encode("last"));
	source.close();
	assert.equal(await drained, "first last");
	await cancellation;
	assert.equal(sourceCancelled, false, "only the client branch was cancelled");
});

test("cancelling a reader after normal EOF does not record departure", async () => {
	const connection = createChatClientConnection(new AbortController().signal);
	const reader = connection.trackResponse(new Response("complete")).body.getReader();
	while (!(await reader.read()).done) { /* Consume through EOF. */ }
	await reader.cancel();
	assert.equal(connection.disconnected, false);
	reader.releaseLock();
});

test("Request.signal remains a live fallback, including a pre-aborted request", () => {
	const request = new AbortController();
	const connection = createChatClientConnection(request.signal);
	assert.equal(connection.disconnected, false);
	request.abort();
	assert.equal(connection.disconnected, true);
	assert.equal(createChatClientConnection(request.signal).disconnected, true);
});

test("pre-abort, repeated persistence and body cancellation notify only once", async () => {
	const request = new AbortController();
	request.abort();
	const connection = createChatClientConnection(request.signal);
	let notifications = 0;
	const first = connection.afterPersistence(async () => { notifications += 1; });
	const repeated = connection.afterPersistence(async () => { notifications += 1; });
	assert.equal(first, repeated);
	await connection.trackResponse(new Response("answer")).body.cancel("also cancelled");
	await Promise.all([first, repeated]);
	assert.equal(notifications, 1);
});

test("departure after onEnd but during persistence is visible at the notification decision", { timeout: 5000 }, async () => {
	const request = new AbortController();
	const connection = createChatClientConnection(request.signal);
	const persisted = deferred();
	let notifications = 0;
	let notificationWork;
	const answer = answerStream(connection, () => {
		notificationWork = persisted.promise.then(() => connection.afterPersistence(async () => { notifications += 1; }));
	});
	const reader = answer.response.body.getReader();
	await reader.read();
	answer.generation.resolve();
	await answer.ended;
	assert.equal(connection.disconnected, false);
	const cancellation = reader.cancel("left while saving");
	assert.equal(request.signal.aborted, false);
	persisted.resolve();
	await notificationWork;
	assert.equal(notifications, 1, "the pre-save connected state must not be captured");
	request.abort("duplicate request signal");
	await Promise.all([cancellation, answer.drained]);
	assert.equal(notifications, 1);
});

test("persistence first waits for later SDK body cancellation and the actual notification", { timeout: 5000 }, async () => {
	const request = new AbortController();
	const connection = createChatClientConnection(request.signal);
	const persistenceRegistered = deferred();
	const sendStarted = deferred();
	const sendFinished = deferred();
	let notifications = 0;
	let notificationWork;
	const answer = answerStream(connection, () => {
		// The route returns this promise from its already-registered waitUntil.
		notificationWork = Promise.resolve("persisted").then(() => {
			const work = connection.afterPersistence(async () => {
				notifications += 1;
				sendStarted.resolve();
				await sendFinished.promise;
			});
			persistenceRegistered.resolve();
			return work;
		});
	});
	const reader = answer.response.body.getReader();
	await reader.read();
	answer.generation.resolve();
	await Promise.all([answer.ended, answer.drained, persistenceRegistered.promise]);
	let workSettled = false;
	void notificationWork.then(() => { workSettled = true; });
	await nextTurn();
	assert.equal(notifications, 0);
	assert.equal(workSettled, false, "saving first must retain the later disconnect decision");

	const cancellation = reader.cancel("left after save, before client EOF");
	await sendStarted.promise;
	assert.equal(request.signal.aborted, false);
	assert.equal(notifications, 1);
	assert.equal(workSettled, false, "the waitUntil work must hold the actual send promise");
	request.abort("duplicate signal after cancellation");
	sendFinished.resolve();
	await Promise.all([notificationWork, cancellation]);
	assert.equal(notifications, 1);
});

test("upstream stream errors are preserved and do not imply client departure", async () => {
	const request = new AbortController();
	const connection = createChatClientConnection(request.signal);
	const error = new Error("upstream failure");
	const response = connection.trackResponse(new Response(new ReadableStream({
		start(controller) { controller.error(error); },
	})));
	await assert.rejects(response.text(), (actual) => actual === error);
	request.abort("error response teardown");
	assert.equal(connection.disconnected, false);
	let notifications = 0;
	await connection.afterPersistence(async () => { notifications += 1; });
	assert.equal(notifications, 0);
});

test("notification rejection remains part of the once-only background promise", async () => {
	const request = new AbortController();
	const connection = createChatClientConnection(request.signal);
	const error = new Error("notification failed");
	let attempts = 0;
	const work = connection.afterPersistence(async () => { attempts += 1; throw error; });
	request.abort();
	await assert.rejects(work, (actual) => actual === error);
	assert.equal(connection.afterPersistence(async () => { attempts += 1; }), work);
	assert.equal(attempts, 1);
});

test("a bodyless response passes through unchanged", () => {
	const connection = createChatClientConnection(new AbortController().signal);
	const response = new Response(null, { status: 204, headers: { "x-qa": "bodyless" } });
	assert.equal(connection.trackResponse(response), response);
	assert.equal(connection.disconnected, false);
});
