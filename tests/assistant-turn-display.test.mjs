import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	isRenderableChatMessage,
	streamingAssistantId,
} from "../src/lib/chat/message-display.ts";
import { startStatusNarration } from "../src/lib/ai/status-narration.ts";

const root = process.cwd();

test("only a trailing assistant turn can be the response in flight", () => {
	const previous = { id: "a1", role: "assistant" };
	const user = { id: "u2", role: "user" };
	const current = { id: "a2", role: "assistant" };

	assert.equal(streamingAssistantId([previous], false), undefined);
	assert.equal(streamingAssistantId([previous, user], true), undefined);
	assert.equal(streamingAssistantId([previous, user, current], true), "a2");
});

test("an orphaned empty assistant shell is hidden but real states remain", () => {
	const base = { id: "a", role: "assistant", content: "" };
	assert.equal(isRenderableChatMessage(base), false);
	assert.equal(isRenderableChatMessage({ ...base, isStreaming: true }), true);
	assert.equal(isRenderableChatMessage({ ...base, activity: "Thinking" }), true);
	assert.equal(isRenderableChatMessage({ ...base, content: "Answer" }), true);
	assert.equal(isRenderableChatMessage({ ...base, noteActions: [{}] }), true);
	assert.equal(isRenderableChatMessage({ id: "u", role: "user", content: "" }), true);
});

test("status narration opens the persisted assistant id before its first label", () => {
	const chunks = [];
	const writeStatus = startStatusNarration(
		{ write: chunk => chunks.push(chunk) },
		"msg-server-1",
	);
	writeStatus("Thinking");

	assert.deepEqual(chunks, [
		{ type: "start", messageId: "msg-server-1" },
		{ type: "data-status", id: "status", data: { label: "Thinking" } },
	]);
});

test("chat and Notes streams suppress the model's later duplicate start", () => {
	for (const route of [
		"src/app/api/ask-question/route.ts",
		"src/app/api/note-ai/route.ts",
	]) {
		const source = readFileSync(join(root, route), "utf8");
		assert.match(source, /const responseMessageId = generateMessageId\(\)/, route);
		assert.match(source, /generateId: \(\) => responseMessageId/, route);
		assert.match(source, /startStatusNarration\(writer, responseMessageId\)/, route);
		assert.match(source, /sendStart: false/, route);
	}
});

test("every conversation surface uses one guide avatar and a separate activity label", () => {
	const webChat = readFileSync(join(root, "src/components/ChatMessage.tsx"), "utf8");
	const webNotes = readFileSync(join(root, "src/components/notes/NoteAIMessage.tsx"), "utf8");
	const macChat = readFileSync(join(root, "macos/SureWord/Chat/Views/MessageBubble.swift"), "utf8");
	const iosChat = readFileSync(
		join(root, "macos/SureWord-iOS/Views/Chat/MessageBubble.swift"),
		"utf8",
	);

	assert.equal((webChat.match(/<SureWordGuideAvatar/g) ?? []).length, 1);
	assert.equal((webNotes.match(/<SureWordGuideAvatar/g) ?? []).length, 1);
	assert.equal((macChat.match(/SureWordGuideAvatar\(/g) ?? []).length, 1);
	assert.equal((iosChat.match(/SureWordGuideAvatar\(/g) ?? []).length, 1);
	assert.doesNotMatch(macChat, /Text\("✦"\).*Text\(activity\)/s);
	assert.doesNotMatch(iosChat, /Image\(systemName: "sparkles"\).*Text\(activity\)/s);
	assert.match(webChat, /message\.activity/);
	assert.match(macChat, /Text\(activity\)/);
	assert.match(iosChat, /Text\(activity\)/);
});

test("every client filters orphaned shells in chat and Notes", () => {
	for (const path of [
		"src/components/useChat.ts",
		"src/hooks/useNoteAI.ts",
	]) {
		assert.match(readFileSync(join(root, path), "utf8"), /\.filter\(isRenderableChatMessage\)/, path);
	}
	for (const path of [
		"mobile/src/features/chat/useSureWordChat.ts",
		"mobile/src/features/notes/useNoteAI.ts",
	]) {
		assert.match(
			readFileSync(join(root, path), "utf8"),
			/\.filter\(isRenderableChatViewMessage\)/,
			path,
		);
	}
	for (const path of [
		"macos/Shared/Chat/ChatViewModel.swift",
		"macos/Shared/Notes/NoteAIModel.swift",
	]) {
		assert.match(readFileSync(join(root, path), "utf8"), /\.filter\(\\\.hasRenderableContent\)/, path);
	}
});

test("the guide artwork is packaged for web, macOS, and iOS", () => {
	for (const path of [
		"public/sureword-guide.png",
		"macos/SureWord/Assets.xcassets/SureWordGuide.imageset/sureword-guide.png",
		"macos/SureWord/Assets.xcassets/SureWordGuide.imageset/sureword-guide@2x.png",
		"macos/SureWord/Assets.xcassets/SureWordGuide.imageset/sureword-guide@3x.png",
		"macos/SureWord-iOS/Assets.xcassets/SureWordGuide.imageset/sureword-guide.png",
		"macos/SureWord-iOS/Assets.xcassets/SureWordGuide.imageset/sureword-guide@2x.png",
		"macos/SureWord-iOS/Assets.xcassets/SureWordGuide.imageset/sureword-guide@3x.png",
	]) {
		assert.equal(existsSync(join(root, path)), true, path);
	}

	const webPng = readFileSync(join(root, "public/sureword-guide.png"));
	assert.equal(webPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	assert.equal(webPng[25], 6, "web guide must retain its RGBA alpha channel");
});
