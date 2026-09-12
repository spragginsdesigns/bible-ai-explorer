import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildReceipts } from "../src/lib/chat/receipts.ts";

// The same fixture drives mobile/src/lib/receipts.test.ts, so web and Android
// produce identical receipts for the same persisted parts.
const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/chat-receipts.json", import.meta.url), "utf8")
);

for (const { name, parts, expected } of fixture.cases) {
	test(`receipts: ${name}`, () => {
		assert.deepEqual(buildReceipts(parts), expected);
	});
}

test("receipts: the mobile fixture copy is identical", () => {
	const mobileCopy = readFileSync(
		new URL("../mobile/src/lib/__fixtures__/chat-receipts.json", import.meta.url),
		"utf8"
	);
	assert.deepEqual(JSON.parse(mobileCopy), fixture);
});

test("receipts: malformed parts are ignored rather than thrown on", () => {
	assert.deepEqual(
		buildReceipts([
			null,
			"text",
			{ type: 42 },
			{ type: "tool-addToNote", state: "output-available", output: null },
			{ type: "tool-addToNote", state: "output-available", output: { noteId: "", noteTitle: "T" } },
			{ type: "tool-deleteMemories", state: "output-available", output: { success: true, deleted: 0 } },
			{ type: "tool-highlightVerse", state: "output-available", output: { success: true, reference: "Romans 8:28", book: "Romans", chapter: 8, verse: 28 } },
			{ type: "data-memoryExtracted", data: { content: "no id" } },
		]),
		[]
	);
});

test("receipts: a tool part without a toolCallId still gets a stable id", () => {
	const [receipt] = buildReceipts([
		{ type: "text", text: "Done." },
		{ type: "tool-updateNote", state: "output-available", output: { noteId: "n", noteTitle: "Title" } },
	]);
	assert.equal(receipt.id, "part-1");
});
