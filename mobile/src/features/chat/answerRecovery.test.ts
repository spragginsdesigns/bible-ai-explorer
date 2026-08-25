import { describe, expect, it } from "vitest";
import { completedHistory } from "./answerRecovery";

describe("completedHistory", () => {
	it("returns the messages once the answer has landed", () => {
		const payload = {
			messages: [
				{ id: "1", role: "user", content: "Who is Melchizedek?" },
				{ id: "2", role: "assistant", content: "He is the king of Salem." },
			],
		};
		expect(completedHistory(payload)).toHaveLength(2);
	});

	it("returns null while the assistant reply is still being written", () => {
		const payload = { messages: [{ id: "1", role: "user", content: "Who is Melchizedek?" }] };
		expect(completedHistory(payload)).toBeNull();
	});

	it("treats an empty assistant row as not yet answered", () => {
		const payload = {
			messages: [
				{ id: "1", role: "user", content: "Hi" },
				{ id: "2", role: "assistant", content: "   " },
			],
		};
		expect(completedHistory(payload)).toBeNull();
	});

	it("rejects malformed payloads", () => {
		expect(completedHistory(null)).toBeNull();
		expect(completedHistory({})).toBeNull();
		expect(completedHistory({ messages: "nope" })).toBeNull();
		expect(completedHistory({ messages: [] })).toBeNull();
	});
});
