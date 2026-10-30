import { describe, expect, it } from "vitest";
import { checkedHistoryState, historyPath, matchesHistoryLocator, parseHistoryVerification, type HistoryVerification } from "./historyReview";
import { toViewMessage } from "./chatView";
const review: HistoryVerification = { surface: "chat", parentId: "conversation-1", messageId: "answer-1", state: "pending", code: "history_review_required", sourceDigest: "a".repeat(64) };
const row = { id: review.messageId, role: "assistant", content: "Safe saved answer", metadata: { parts: [{ type: "text", text: "Safe saved answer" }] } };
describe("mobile history review contract", () => {
	it("accepts only complete owned locator, digest and notice state metadata", () => {
		expect(parseHistoryVerification(review, review.messageId)).toEqual(review);
		for (const change of [{ surface: ["chat"] }, { state: ["pending"] }, { surface: "admin" }, { parentId: "" }, { messageId: "different-answer" }, { state: "verified" }, { code: "" }, { sourceDigest: "not-a-digest" }]) {
			expect(parseHistoryVerification({ ...review, ...change }, review.messageId)).toBeNull();
		}
		for (const malformed of [null, [], "pending", true]) expect(parseHistoryVerification(malformed, review.messageId)).toBeNull();
	});
	it("binds a review to its actual visible parent and surface", () => {
		expect(matchesHistoryLocator(review, review)).toBe(true);
		expect(matchesHistoryLocator(review, { ...review, surface: "note" })).toBe(false);
		expect(matchesHistoryLocator(review, { ...review, parentId: "another-conversation" })).toBe(false);
		expect(matchesHistoryLocator(review, { ...review, messageId: "another-answer" })).toBe(false);
	});
	it("encodes locators and never accepts a free-form download URL", () => {
		expect(historyPath("original", { surface: "note", parentId: "note/with space", messageId: "answer?one" })).toBe("/api/ai/history/original?surface=note&parentId=note%2Fwith+space&messageId=answer%3Fone");
		expect(() => historyPath("state", { ...review, parentId: "" })).toThrow();
	});
	it("accepts only a safe GET state row with the exact requested digest and message", () => {
		expect(checkedHistoryState({ state: "verified", sourceDigest: review.sourceDigest, row }, review).row.content).toBe("Safe saved answer");
		for (const response of [
			{ state: ["verified"], sourceDigest: review.sourceDigest, row },
			{ state: "pending", sourceDigest: review.sourceDigest, row },
			{ state: "withheld", sourceDigest: review.sourceDigest, row },
			{ state: "verified", sourceDigest: "b".repeat(64), row },
			{ state: "verified", sourceDigest: review.sourceDigest, row: { ...row, id: "other" } },
			{ state: "verified", sourceDigest: review.sourceDigest, row: { ...row, role: "user" } },
			{ state: "verified", sourceDigest: review.sourceDigest, row: { ...row, metadata: {} } },
		]) expect(() => checkedHistoryState(response, review)).toThrow();
	});
	it("clean fixed notices remain notices and contradictory markers always fail closed", () => {
		const clean = checkedHistoryState({ state: "notice", sourceDigest: review.sourceDigest, row }, review);
		expect(clean.state).toBe("notice"); expect(clean.row.content).toBe(row.content);
		for (const state of ["verified", "notice"]) for (const marker of [review, null, undefined]) {
			expect(() => checkedHistoryState({ state, sourceDigest: review.sourceDigest, row: { ...row, metadata: { ...row.metadata, historyVerification: marker } } }, review)).toThrow();
		}
	});
	it("rejects invalid review digests and malformed typed parts without widening row fields", () => {
		for (const invalid of ["", "a", "A".repeat(64)]) expect(() => checkedHistoryState({ state: "verified", sourceDigest: invalid, row }, { ...review, sourceDigest: invalid })).toThrow();
		for (const part of [null, [], "text", {}, { type: 1 }]) expect(() => checkedHistoryState({ state: "verified", sourceDigest: review.sourceDigest, row: { ...row, metadata: { parts: [part] } } }, review)).toThrow();
		const response = { state: "verified", sourceDigest: review.sourceDigest, row: { ...row, createdAt: "2026-10-30T00:00:00Z", attachments: ["unchecked"], unknown: "unchecked" } };
		expect(checkedHistoryState(response, review).row).toEqual({ ...row, createdAt: response.row.createdAt });
	});
	it("malformed review metadata fails closed in the actual chat view adapter", () => {
		const message = toViewMessage({ id: review.messageId, role: "assistant", parts: [{ type: "text", text: "Original should stay hidden" }], metadata: { historyVerification: { state: "pending" } } }, { isStreaming: false });
		expect(message.historyVerification?.state).toBe("withheld"); expect(message.historyVerification?.code).toBe("invalid_history_review");
	});
	it("chat and note history use the same adapter without changing ordinary messages", () => {
		for (const surface of ["chat", "note"] as const) {
			const message = toViewMessage({ id: review.messageId, role: "assistant", parts: [], metadata: { historyVerification: { ...review, surface } } }, { isStreaming: false });
			expect(message.historyVerification?.surface).toBe(surface);
		}
		expect(toViewMessage({ id: "ordinary", role: "assistant", parts: [{ type: "text", text: "Answer" }] }, { isStreaming: false }).historyVerification).toBeUndefined();
	});
});
