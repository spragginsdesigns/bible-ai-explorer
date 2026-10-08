import { describe, expect, it } from "vitest";
import { editedUserMessage, idsAfter, idsAfterLastUser } from "./editMessage";

describe("replaced ids", () => {
	const thread = [
		{ id: "u1", role: "user" },
		{ id: "a1", role: "assistant" },
		{ id: "u2", role: "user" },
		{ id: "a2", role: "assistant" },
	];

	it("an edit drops everything after the edited message", () => {
		expect(idsAfter(thread, "u1")).toEqual(["a1", "u2", "a2"]);
		expect(idsAfter(thread, "u2")).toEqual(["a2"]);
		expect(idsAfter(thread, "missing")).toEqual([]);
	});

	it("Try again drops what follows the newest question", () => {
		expect(idsAfterLastUser(thread)).toEqual(["a2"]);
		expect(idsAfterLastUser(thread.slice(0, 3))).toEqual([]);
		expect(idsAfterLastUser([])).toEqual([]);
	});
});

const photo = {
	type: "file" as const,
	filename: "clipboard-1791492826838.jpg",
	mediaType: "image/jpeg",
	url: "https://example.test/preview.jpg",
};

describe("editedUserMessage", () => {
	it("swaps the words and keeps the files and metadata", () => {
		const edited = editedUserMessage(
			{
				parts: [photo, { type: "text", text: "is it ethical?" }],
				metadata: { attachmentIds: ["87ab"] },
			},
			"  is it ethical to charge for a Bible app?  "
		);
		expect(edited).toEqual({
			parts: [photo, { type: "text", text: "is it ethical to charge for a Bible app?" }],
			metadata: { attachmentIds: ["87ab"] },
		});
	});

	it("lets an edit clear the words when the message still carries a file", () => {
		const edited = editedUserMessage({ parts: [photo, { type: "text", text: "old" }], metadata: undefined }, "  ");
		expect(edited?.parts).toEqual([photo]);
	});

	it("refuses an edit that would leave nothing to send", () => {
		expect(editedUserMessage({ parts: [{ type: "text", text: "old" }], metadata: undefined }, " ")).toBeNull();
	});
});
