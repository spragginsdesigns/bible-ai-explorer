import { describe, expect, it, vi } from "vitest";
import {
	dbMessageToUIMessage,
	parseFollowUps,
	toViewMessage,
	visibleResponseContent,
} from "@/lib/chatView";

vi.mock("ai", () => ({})); // type-only import; keep vitest from resolving the package

const textMessage = (id: string, role: "user" | "assistant", text: string, extra = {}) =>
	({ id, role, parts: [{ type: "text", text }], ...extra }) as never;

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

	it("shows tool activity only while streaming", () => {
		const message = {
			id: "m4",
			role: "assistant",
			parts: [{ type: "tool-getPassage", state: "input-available" }],
		} as never;
		expect(toViewMessage(message, { isStreaming: true }).activity).toBe("Opening the passage");
		expect(toViewMessage(message, { isStreaming: false }).activity).toBeUndefined();
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

	it("rejects malformed rows", () => {
		expect(() => dbMessageToUIMessage({ id: "d3", role: "system", content: "x" })).toThrow();
		expect(() => dbMessageToUIMessage(null)).toThrow();
	});
});
