/* Regression test for the 2026-08-10 history bug: the API routes persist the
   assistant message by responseMessage.id. Without generateMessageId the AI
   SDK leaves that id as "", so every exchange's upsert collided on one shared
   empty-primary-key row and assistant messages vanished from history.
   The routes pass createIdGenerator(...) to toUIMessageStream; this proves
   that option yields a non-empty id (and documents that omitting it yields ""). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdGenerator, toUIMessageStream } from "ai";

const userMessage = {
	id: "user-1",
	role: "user",
	parts: [{ type: "text", text: "Where was Jesus born?" }],
};

// Minimal streamText full-stream: start -> text -> finish.
function fakeFullStream() {
	return new ReadableStream({
		start(controller) {
			controller.enqueue({ type: "start" });
			controller.enqueue({ type: "text-start", id: "t1" });
			controller.enqueue({ type: "text-delta", id: "t1", delta: "In Bethlehem." });
			controller.enqueue({ type: "text-end", id: "t1" });
			controller.enqueue({ type: "finish", finishReason: "stop" });
			controller.close();
		},
	});
}

async function captureResponseId(options) {
	let captured = null;
	const stream = toUIMessageStream({
		stream: fakeFullStream(),
		originalMessages: [userMessage],
		onEnd: ({ responseMessage }) => {
			captured = responseMessage.id;
		},
		...options,
	});
	for await (const _ of stream) {
		// drain
	}
	return captured;
}

test("toUIMessageStream without generateMessageId yields an empty id (the bug)", async () => {
	assert.equal(await captureResponseId({}), "");
});

test("toUIMessageStream with generateMessageId yields a persistable id (the fix)", async () => {
	const id = await captureResponseId({
		generateMessageId: createIdGenerator({ prefix: "msg", size: 24 }),
	});
	assert.equal(typeof id, "string");
	assert.ok(id.length > 0, "responseMessage.id must be non-empty");
});
