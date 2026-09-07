import { describe, expect, it, vi } from "vitest";
import {
	dbMessageToUIMessage,
	isRenderableChatViewMessage,
	parseFollowUps,
	streamingAssistantId,
	toViewMessage,
	toViewMessageCached,
	visibleResponseContent,
} from "@/lib/chatView";

vi.mock("ai", () => ({})); // type-only import; keep vitest from resolving the package

const textMessage = (id: string, role: "user" | "assistant", text: string, extra = {}) =>
	({ id, role, parts: [{ type: "text", text }], ...extra }) as never;

describe("assistant turn display", () => {
	it("streams only a trailing assistant turn", () => {
		expect(streamingAssistantId([
			{ id: "a1", role: "assistant" },
			{ id: "u2", role: "user" },
		], true)).toBeUndefined();
		expect(streamingAssistantId([
			{ id: "a1", role: "assistant" },
			{ id: "u2", role: "user" },
			{ id: "a2", role: "assistant" },
		], true)).toBe("a2");
	});

	it("hides only settled assistant shells with nothing to render", () => {
		const empty = { id: "a", role: "assistant" as const, content: "" };
		expect(isRenderableChatViewMessage(empty)).toBe(false);
		expect(isRenderableChatViewMessage({ ...empty, isStreaming: true })).toBe(true);
		expect(isRenderableChatViewMessage({ ...empty, activity: "Thinking" })).toBe(true);
		expect(isRenderableChatViewMessage({ ...empty, content: "Answer" })).toBe(true);
		expect(isRenderableChatViewMessage({ ...empty, retrievedVerses: [{ reference: "John 3:16", similarity: 1 }] })).toBe(true);
	});
});

describe("visibleResponseContent", () => {
	it("strips the follow-up block from the end", () => {
		expect(visibleResponseContent("Answer text.\n[FOLLOWUP] Next?")).toBe("Answer text.");
	});

	it("strips everything from the first follow-up onward", () => {
		expect(
			visibleResponseContent("Body\n[FOLLOWUP] One\n[FOLLOWUP] Two")
		).toBe("Body");
	});

	it("leaves ordinary text untouched", () => {
		expect(visibleResponseContent("Plain answer.")).toBe("Plain answer.");
	});
});

describe("parseFollowUps", () => {
	it("extracts up to two unique follow-ups", () => {
		const content = "A\n[FOLLOWUP] First?\n[FOLLOWUP] Second?\n[FOLLOWUP] Third?";
		expect(parseFollowUps(content)).toEqual(["First?", "Second?"]);
	});

	it("dedupes case-insensitively", () => {
		expect(parseFollowUps("[FOLLOWUP] Same?\n[FOLLOWUP] same?")).toEqual(["Same?"]);
	});

	it("returns [] when there are none", () => {
		expect(parseFollowUps("No follow-ups here.")).toEqual([]);
	});
});

describe("toViewMessageCached", () => {
	it("reuses the settled conversion for the same message object", () => {
		const message = textMessage("c1", "assistant", "Hello");
		const first = toViewMessageCached(message, { isStreaming: false });
		const second = toViewMessageCached(message, { isStreaming: false });
		expect(second).toBe(first);
		expect(second).toEqual(toViewMessage(message, { isStreaming: false }));
	});

	it("does not serve a streaming view-model once the stream has settled", () => {
		const message = textMessage("c2", "assistant", "Hello");
		const streamed = toViewMessageCached(message, { isStreaming: true });
		expect(streamed.isStreaming).toBe(true);
		const settled = toViewMessageCached(message, { isStreaming: false });
		expect(settled).not.toBe(streamed);
		expect(settled.isStreaming).toBeUndefined();
		expect(settled).toEqual(toViewMessage(message, { isStreaming: false }));
	});

	it("keeps a different message object out of the cache", () => {
		const first = toViewMessageCached(textMessage("c3", "assistant", "One"), { isStreaming: false });
		const second = toViewMessageCached(textMessage("c4", "assistant", "Two"), { isStreaming: false });
		expect(second).not.toBe(first);
		expect(second).toMatchObject({ id: "c4", content: "Two" });
	});
});

describe("toViewMessage", () => {
	it("maps a plain assistant text message", () => {
		const view = toViewMessage(textMessage("m1", "assistant", "Hello"), { isStreaming: false });
		expect(view).toMatchObject({ id: "m1", role: "assistant", content: "Hello" });
		expect(view.retrievedVerses).toBeUndefined();
	});

	it("collects verses and averages similarity from searchScripture tool output", () => {
		const message = {
			id: "m2",
			role: "assistant",
			parts: [
				{
					type: "tool-searchScripture",
					state: "output-available",
					output: {
						verses: [
							{ reference: "John 3:16", similarity: 0.9, text: "For God so loved…" },
							{ reference: "John 3:17", similarity: 0.7 },
						],
					},
				},
				{ type: "text", text: "Answer" },
			],
		} as never;
		const view = toViewMessage(message, { isStreaming: false });
		expect(view.retrievedVerses).toHaveLength(2);
		expect(view.averageSimilarity).toBeCloseTo(0.8);
	});

	it("drops malformed verses instead of crashing", () => {
		const message = {
			id: "m3",
			role: "assistant",
			parts: [
				{
					type: "tool-searchScripture",
					state: "output-available",
					output: { verses: [{ reference: 42 }, "junk", { reference: "Psalm 23:1", similarity: 0.8 }] },
				},
			],
		} as never;
		const view = toViewMessage(message, { isStreaming: false });
		expect(view.retrievedVerses).toEqual([{ reference: "Psalm 23:1", similarity: 0.8 }]);
	});

	it("renders findVerses output through the same retrieved-verses card as searchScripture", () => {
		const message = {
			id: "m3b",
			role: "assistant",
			parts: [
				{
					type: "tool-searchScripture",
					state: "output-available",
					output: { verses: [{ reference: "John 3:16", similarity: 0.9 }] },
				},
				{
					type: "tool-findVerses",
					state: "output-available",
					output: {
						verses: [
							{ reference: "Psalm 23:1", similarity: 0.7, text: "The LORD is my shepherd" },
							{ reference: "Psalm 23:2", similarity: 0.5 },
						],
						averageSimilarity: 0.6,
						formatted: "Psalm 23:1-2",
					},
				},
			],
		} as never;
		const view = toViewMessage(message, { isStreaming: false });
		expect(view.retrievedVerses).toEqual([
			{ reference: "John 3:16", similarity: 0.9 },
			{ reference: "Psalm 23:1", similarity: 0.7, text: "The LORD is my shepherd" },
			{ reference: "Psalm 23:2", similarity: 0.5 },
		]);
		expect(view.averageSimilarity).toBeCloseTo(0.7);
	});

	it("labels a running findVerses call as an exact-word Bible search", () => {
		const message = {
			id: "m3c",
			role: "assistant",
			parts: [{ type: "tool-findVerses", state: "input-available" }],
		} as never;
		expect(toViewMessage(message, { isStreaming: true }).activity).toBe(
			"Searching the Bible for those words",
		);
	});

	it("shows tool activity only while streaming", () => {
		const message = {
			id: "m4",
			role: "assistant",
			parts: [{ type: "tool-getPassage", state: "input-available" }],
		} as never;
		expect(toViewMessage(message, { isStreaming: true }).activity).toBe("Opening the passage");
		expect(toViewMessage(message, { isStreaming: false }).activity).toBeUndefined();
	});

	it("shows distinct activity labels for memory tools", () => {
		const labels = [
			["tool-listMemories", "Reading your memories"],
			["tool-saveMemory", "Saving your memory"],
			["tool-updateMemory", "Updating your memory"],
			["tool-deleteMemories", "Deleting your memories"],
		] as const;
		for (const [type, label] of labels) {
			const message = {
				id: `memory-${type}`,
				role: "assistant",
				parts: [{ type, state: "input-available" }],
			} as never;
			expect(toViewMessage(message, { isStreaming: true }).activity).toBe(label);
		}
	});

	it("shows the server status label, and lets a running tool override it", () => {
		const status = {
			id: "m4a",
			role: "assistant",
			parts: [{ type: "data-status", id: "status", data: { label: "Reading Church-Notes.pdf" } }],
		} as never;
		expect(toViewMessage(status, { isStreaming: true }).activity).toBe(
			"Reading Church-Notes.pdf"
		);
		expect(toViewMessage(status, { isStreaming: false }).activity).toBeUndefined();

		const withTool = {
			id: "m4b",
			role: "assistant",
			parts: [
				{ type: "data-status", id: "status", data: { label: "Thinking" } },
				{ type: "tool-getPassage", state: "input-available" },
			],
		} as never;
		expect(toViewMessage(withTool, { isStreaming: true }).activity).toBe("Opening the passage");
	});

	it("drops the status line once answer text has streamed", () => {
		const message = {
			id: "m4d",
			role: "assistant",
			parts: [
				{ type: "data-status", id: "status", data: { label: "Thinking" } },
				{ type: "text", text: "For God so loved the world" },
			],
		} as never;
		expect(toViewMessage(message, { isStreaming: true }).activity).toBeUndefined();
	});

	it("keeps an in-flight tool label even after answer text has streamed", () => {
		const message = {
			id: "m4e",
			role: "assistant",
			parts: [
				{ type: "data-status", id: "status", data: { label: "Thinking" } },
				{ type: "text", text: "Let me look that up." },
				{ type: "tool-searchScripture", state: "input-available" },
			],
		} as never;
		expect(toViewMessage(message, { isStreaming: true }).activity).toBe(
			"Searching the Scriptures"
		);
	});

	it("ignores a malformed status part", () => {
		const message = {
			id: "m4c",
			role: "assistant",
			parts: [{ type: "data-status", id: "status", data: { label: 7 } }],
		} as never;
		expect(toViewMessage(message, { isStreaming: true }).activity).toBeUndefined();
	});

	it("maps note-writing tool output to a note action", () => {
		const message = {
			id: "m5",
			role: "assistant",
			parts: [
				{
					type: "tool-addToNote",
					state: "output-available",
					output: { noteId: "n1", noteTitle: "Study", created: true },
				},
			],
		} as never;
		expect(toViewMessage(message, { isStreaming: false }).noteActions).toEqual([
			{ noteId: "n1", noteTitle: "Study", created: true },
		]);
	});

	it("maps a replaced daily cross to a cross action, and reads to nothing", () => {
		const replaced = {
			id: "m6",
			role: "assistant",
			parts: [
				{
					type: "tool-setDailyCross",
					state: "output-available",
					output: {
						reference: "James 1:4",
						text: "But let patience have her perfect work…",
						reason: "For the waiting you are in.",
						previousReference: "Hebrews 12:2",
					},
				},
			],
		} as never;
		expect(toViewMessage(replaced, { isStreaming: false }).crossActions).toEqual([
			{
				reference: "James 1:4",
				text: "But let patience have her perfect work…",
				reason: "For the waiting you are in.",
				previousReference: "Hebrews 12:2",
			},
		]);

		// Reading the day is silent: no receipt card for getDailyCross.
		const read = {
			id: "m7",
			role: "assistant",
			parts: [
				{
					type: "tool-getDailyCross",
					state: "output-available",
					output: { reference: "James 1:4", text: "But let patience…" },
				},
			],
		} as never;
		expect(toViewMessage(read, { isStreaming: false }).crossActions).toBeUndefined();
	});
});

describe("dbMessageToUIMessage", () => {
	it("wraps legacy content rows into a text part", () => {
		const ui = dbMessageToUIMessage({ id: "d1", role: "user", content: "Hi" });
		expect(ui.parts).toEqual([{ type: "text", text: "Hi" }]);
	});

	it("restores durable attachment file parts and ids", () => {
		const ui = dbMessageToUIMessage({
			id: "with-file",
			role: "user",
			content: "What is shown here?",
			attachments: [{
				id: "att-1",
				filename: "screenshot.png",
				mediaType: "image/png",
				size: 1200,
				previewUrl: "https://example.test/private-signed",
				previewExpiresAt: "2030-01-01T00:00:00.000Z",
			}],
		});
		expect(ui.parts[0]).toMatchObject({
			type: "file",
			filename: "screenshot.png",
			mediaType: "image/png",
			url: "https://example.test/private-signed",
		});
		expect(ui.metadata).toMatchObject({ attachmentIds: ["att-1"] });
	});

	it("preserves stored parts and strips them from metadata", () => {
		const ui = dbMessageToUIMessage({
			id: "d2",
			role: "assistant",
			content: "",
			metadata: { parts: [{ type: "text", text: "Saved" }], followUps: ["Next?"] },
		});
		expect(ui.parts).toEqual([{ type: "text", text: "Saved" }]);
		expect(ui.metadata).toEqual({ followUps: ["Next?"] });
	});

	it("drops stored status parts on restore", () => {
		const ui = dbMessageToUIMessage({
			id: "d4",
			role: "assistant",
			content: "",
			metadata: {
				parts: [
					{ type: "data-status", id: "status", data: { label: "Thinking" } },
					{ type: "text", text: "Saved" },
				],
			},
		});
		expect(ui.parts).toEqual([{ type: "text", text: "Saved" }]);
	});

	it("rejects malformed rows", () => {
		expect(() => dbMessageToUIMessage({ id: "d3", role: "system", content: "x" })).toThrow();
		expect(() => dbMessageToUIMessage(null)).toThrow();
	});
});
