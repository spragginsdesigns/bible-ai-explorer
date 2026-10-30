import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HistoryVerification } from "@/lib/historyReview";
const mocks = vi.hoisted(() => ({ account: "owner", session: "session-1", fetch: vi.fn(), download: vi.fn(), share: vi.fn(), remove: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator" }));
vi.mock("@/components/AppText", () => ({ AppText: "Text" }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: mocks.account, sessionId: mocks.session }) }));
vi.mock("@/features/notes/useStableGetToken", () => ({ useStableGetToken: () => async () => "token" }));
vi.mock("@/features/settings/settingsStore", () => ({ useTheme: () => ({ colors: { borderStrong: "gray", accent: "gold" } }) }));
vi.mock("@/lib/api", () => ({ API_URL: "https://sureword.app", makeAuthedFetch: () => mocks.fetch, boundedToken: async (token: () => Promise<string>) => token() }));
vi.mock("expo-file-system", () => ({ Paths: { cache: "cache" }, File: class { uri = "cache/original.json"; delete() { mocks.remove(); } static downloadFileAsync = mocks.download; } }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: mocks.share }));
import { HistoryReviewCard } from "./HistoryReviewCard";
const review: HistoryVerification = { surface: "chat", parentId: "chat-1", messageId: "answer-1", state: "pending", code: "review_required", sourceDigest: "a".repeat(64) };
let root: ReturnType<typeof create> | null = null;
const view = (notice = review) => React.createElement(HistoryReviewCard, {
	review: notice, locator: { surface: "chat", parentId: "chat-1", messageId: "answer-1" },
	renderVerified: row => React.createElement("Verified", { text: row.content }),
});
const response = () => ({ ok: true, json: async () => ({ state: "verified", sourceDigest: review.sourceDigest, row: { id: review.messageId, role: "assistant", content: "Checked answer", metadata: { parts: [{ type: "text", text: "Checked answer" }] } } }) });
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mocks.account = "owner"; mocks.session = "session-1"; mocks.fetch.mockReset(); mocks.download.mockReset(); mocks.share.mockReset(); mocks.remove.mockReset(); mocks.fetch.mockImplementation(async () => response());
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; });
it("renders a safe GET projection after recheck, then discards it on same-owner session replacement", async () => {
	await act(async () => { root = create(view()); });
	await act(async () => { root!.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress(); });
	expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(1);
	expect(mocks.fetch.mock.calls.map(call => String(call[0]))).toEqual(["https://sureword.app/api/ai/history/recheck", "https://sureword.app/api/ai/history/state?surface=chat&parentId=chat-1&messageId=answer-1"]);
	mocks.session = "session-2";
	await act(async () => { root!.update(view()); });
	expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(0);
});
it("discards a verified override when the stored source digest changes", async () => {
	await act(async () => { root = create(view()); });
	await act(async () => { root!.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress(); });
	expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(1);
	await act(async () => { root!.update(view({ ...review, sourceDigest: "b".repeat(64) })); });
	expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(0);
});
it("a held projection from an old session cannot replace the new session's notice", async () => {
	let finish!: (value: unknown) => void;
	const held = new Promise(done => { finish = done; });
	mocks.fetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true, json: () => held });
	await act(async () => { root = create(view()); });
	await act(async () => { root!.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress(); });
	mocks.session = "replacement-session";
	await act(async () => { root!.update(view()); });
	await act(async () => { finish(await response().json()); });
	expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(0);
});
it("downloads the authenticated original to file sharing without rendering its bytes", async () => {
	mocks.download.mockResolvedValueOnce({ uri: "cache/original.json", delete: mocks.remove });
	await act(async () => { root = create(view()); });
	await act(async () => { root!.root.findAllByType("Pressable" as React.ElementType)[1].props.onPress(); });
	expect(mocks.download.mock.calls[0][0]).toBe("https://sureword.app/api/ai/history/original?surface=chat&parentId=chat-1&messageId=answer-1");
	expect(mocks.download.mock.calls[0][2].headers).toEqual({ Authorization: "Bearer token" });
	expect(mocks.share).toHaveBeenCalledWith("cache/original.json", expect.objectContaining({ mimeType: "application/json" }));
	expect(mocks.remove).toHaveBeenCalledOnce(); expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(0);
});

it("never renders a forged verified response carrying an explicit withheld marker", async () => {
	const state = await response().json();
	mocks.fetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true, json: async () => ({ ...state, row: { ...state.row, content: "SYNTHETIC UNCHECKED BODY", metadata: { ...state.row.metadata, historyVerification: { ...review, state: "withheld" } } } }) });
	await act(async () => { root = create(view()); });
	await act(async () => { root!.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress(); });
	expect(root!.root.findAllByType("Verified" as React.ElementType)).toHaveLength(0);
	expect(JSON.stringify(root!.toJSON())).not.toContain("SYNTHETIC UNCHECKED BODY");
});
