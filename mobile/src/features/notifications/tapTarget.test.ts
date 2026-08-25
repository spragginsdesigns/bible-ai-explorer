import { describe, expect, it } from "vitest";
import { notificationTapTarget } from "./tapTarget";

describe("notificationTapTarget", () => {
	it("routes screen:cross payloads to the Daily Cross screen", () => {
		expect(
			notificationTapTarget({ screen: "cross", book: "John", chapter: 3, verse: 16 })
		).toEqual({ screen: "cross" });
	});

	it("prefers the cross screen even without a verse reference", () => {
		expect(notificationTapTarget({ screen: "cross" })).toEqual({ screen: "cross" });
	});

	it("routes screen:chat payloads to the conversation the answer belongs to", () => {
		expect(notificationTapTarget({ screen: "chat", conversationId: "conv_123" })).toEqual({
			screen: "chat",
			conversationId: "conv_123",
		});
	});

	it("navigates nowhere for a chat payload with no conversation", () => {
		expect(notificationTapTarget({ screen: "chat" })).toBeNull();
		expect(notificationTapTarget({ screen: "chat", conversationId: "" })).toBeNull();
	});

	it("falls back to the reader for legacy verse-only payloads", () => {
		expect(notificationTapTarget({ book: "John", chapter: 3, verse: 16 })).toEqual({
			reference: "John 3:16",
		});
	});

	it("accepts numeric strings, as JSON round-tripped through FCM may carry", () => {
		expect(notificationTapTarget({ book: "Psalms", chapter: "23", verse: "1" })).toEqual({
			reference: "Psalms 23:1",
		});
	});

	it("navigates nowhere on malformed or empty payloads", () => {
		expect(notificationTapTarget({})).toBeNull();
		expect(notificationTapTarget({ screen: "other" })).toBeNull();
		expect(notificationTapTarget({ book: "John", chapter: "three", verse: 16 })).toBeNull();
		expect(notificationTapTarget({ chapter: 3, verse: 16 })).toBeNull();
	});
});
