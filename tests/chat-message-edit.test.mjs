import assert from "node:assert/strict";
import test from "node:test";

import {
	editedUserMessage,
	idsAfter,
	idsAfterLastUser,
	messageHasFiles,
	retryableAnswerId,
	userMessageText,
} from "../src/lib/chat/message-edit.ts";
import { completedHistory } from "../src/lib/chat/answerRecovery.ts";

test("an edit or Try again names exactly the rows it drops", () => {
	const thread = [
		{ id: "u1", role: "user" },
		{ id: "a1", role: "assistant" },
		{ id: "u2", role: "user" },
		{ id: "a2", role: "assistant" },
	];
	assert.deepEqual(idsAfter(thread, "u1"), ["a1", "u2", "a2"]);
	assert.deepEqual(idsAfter(thread, "missing"), []);
	assert.deepEqual(idsAfterLastUser(thread), ["a2"]);
	assert.deepEqual(idsAfterLastUser(thread.slice(0, 3)), []);
});

test("answer recovery never collects the answer being replaced", () => {
	const payload = {
		messages: [
			{ id: "u1", role: "user", content: "Who is Melchizedek?" },
			{ id: "old", role: "assistant", content: "The king of Salem." },
		],
	};
	assert.equal(completedHistory(payload, ["old"]), null);
	assert.equal(completedHistory(payload).length, 2);
});

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
