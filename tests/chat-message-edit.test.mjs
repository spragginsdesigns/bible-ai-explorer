import assert from "node:assert/strict";
import test from "node:test";

import {
	editedUserMessage,
	messageHasFiles,
	retryableAnswerId,
	userMessageText,
} from "../src/lib/chat/message-edit.ts";

const filePart = {
	type: "file",
	filename: "clipboard-1791492826838.jpg",
	mediaType: "image/jpeg",
	url: "blob:preview",
};

const withImage = {
	id: "MyPCmjwg7ASaNtU2",
	role: "user",
	parts: [filePart, { type: "text", text: "what does this say?" }],
	metadata: { attachmentIds: ["87ab17c7"] },
};

test("the composer gets back exactly the text the user typed", () => {
	assert.equal(userMessageText(withImage), "what does this say?");
	assert.equal(
		userMessageText({ id: "a", role: "user", parts: [{ type: "text", text: "one " }, { type: "text", text: "two" }] }),
		"one two",
	);
	assert.equal(userMessageText(null), "");
});

test("an edit replaces the words and keeps the files and metadata", () => {
	const edited = editedUserMessage(withImage, "  is this screenshot accurate?  ");
	assert.deepEqual(edited, {
		messageId: "MyPCmjwg7ASaNtU2",
		parts: [filePart, { type: "text", text: "is this screenshot accurate?" }],
		metadata: { attachmentIds: ["87ab17c7"] },
	});
});

test("clearing the text is allowed only when the message still has files", () => {
	assert.deepEqual(editedUserMessage(withImage, "   ")?.parts, [filePart]);
	const textOnly = { id: "t", role: "user", parts: [{ type: "text", text: "hi" }] };
	assert.equal(editedUserMessage(textOnly, " "), null);
	assert.equal(messageHasFiles(withImage), true);
	assert.equal(messageHasFiles(textOnly), false);
});

test("only a user message can be edited, and no metadata key appears from nowhere", () => {
	assert.equal(editedUserMessage({ id: "x", role: "assistant", parts: [] }, "text"), null);
	assert.equal(editedUserMessage(undefined, "text"), null);
	const bare = editedUserMessage({ id: "b", role: "user", parts: [{ type: "text", text: "old" }] }, "new");
	assert.equal("metadata" in bare, false);
});

test("Try again is offered on the newest settled answer only", () => {
	const thread = [
		{ id: "u1", role: "user" },
		{ id: "a1", role: "assistant" },
		{ id: "u2", role: "user" },
		{ id: "a2", role: "assistant" },
	];
	assert.equal(retryableAnswerId(thread, false), "a2");
	assert.equal(retryableAnswerId(thread, true), null);
	// Ending on the user's message means the answer failed; the error card owns that retry.
	assert.equal(retryableAnswerId(thread.slice(0, 3), false), null);
	assert.equal(retryableAnswerId([], false), null);
});
