import React from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import { dbMessageToUIMessage, toViewMessage } from "@/lib/chatView";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator" }));
vi.mock("@/components/AppText", () => ({ AppText: "Text" }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: "owner", sessionId: "session" }) }));
vi.mock("@/features/notes/useStableGetToken", () => ({ useStableGetToken: () => async () => "token" }));
vi.mock("@/features/settings/settingsStore", () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock("@/lib/api", () => ({ API_URL: "https://sureword.app", makeAuthedFetch: () => mocks.fetch }));
vi.mock("expo-file-system", () => ({ Paths: { cache: "cache" }, File: class {} }));
vi.mock("expo-sharing", () => ({}));
import { HistoryReviewCard } from "./HistoryReviewCard";
const stub = (name: string) => (props: object) => React.createElement(name, props);
const deps: Record<string, unknown> = {
 react: React, "react-native": { AccessibilityInfo: {}, ActivityIndicator: "ActivityIndicator", Alert: {}, Pressable: "Pressable", StyleSheet: { create: (v: unknown) => v }, View: "View" },
 "@/components/AppText": { AppText: "Text" }, "@expo/vector-icons": { Ionicons: stub("Icon") }, "expo-clipboard": {}, "expo-router": { useRouter: () => ({}) },
 "@/components/SureWordGuideAvatar": { SureWordGuideAvatar: stub("Avatar") }, "@/components/guideMotion": { guidePhase: () => "idle" }, "@/lib/chatView": { dbMessageToUIMessage, toViewMessage },
 "@/lib/assistantMarkdown": { normalizeAssistantMarkdown: (v: unknown) => v }, "@/theme": { radius: {}, spacing: {}, typography: {} },
 "@/features/settings/settingsStore": { useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) },
 "@/lib/answerFeedback": { copyableAnswerText: (v: unknown) => v, nextFeedback: (current: unknown, tapped: unknown) => current === tapped ? null : tapped },
 "@/features/shareCards/ShareCardSheet": { ShareCardSheet: () => null }, "./HistoryReviewCard": { HistoryReviewCard },
 "./verseLinks": { segmentVerseReferences: () => [], resolveVerseReference: () => null }, "@/lib/versePassages": { groupRetrievedVerses: () => null },
};
for (const name of ["AddToNoteSheet", "FeedbackSheet", "FollowUpChips", "MarkdownBody", "CrossActionCard", "ReceiptLine", "RetrievedVersesCard", "WorkActivity", "TypingDots", "WebResultsCard", "FileAttachmentCards"]) deps["./" + name] = { [name]: stub(name) };
deps["@/features/onboarding/ChoiceCard"] = { ChoiceCard: stub("ChoiceCard") };
deps["@/features/onboarding/ShowMeCard"] = { ShowMeCard: stub("ShowMeCard") };
const output = ts.transpileModule(readFileSync(new URL("./MessageBubble.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const compiled = { exports: {} as Record<string, React.ElementType> };
new Function("require", "module", "exports", output)((id: string) => { if (!(id in deps)) throw new Error("Unexpected dependency " + id); return deps[id]; }, compiled, compiled.exports);
let root: ReturnType<typeof create> | null = null;
const review = { surface: "chat", parentId: "chat-1", messageId: "answer-1", state: "pending", code: "review_required", sourceDigest: "a".repeat(64) };
let message = dbMessageToUIMessage({ id: "answer-1", role: "assistant", content: "UNCHECKED PARENT CONTENT", metadata: { historyVerification: review, parts: [{ type: "text", text: "UNCHECKED PARENT CONTENT" }, { type: "tool-presentChoices", state: "output-available", output: { step: "raw", question: "UNCHECKED CARD", options: [] } }] } });
const view = (onFeedback = vi.fn()) => React.createElement(compiled.exports.MessageBubble, { message: toViewMessage(message, { isStreaming: false }), conversationId: "chat-1", onFeedback });
const thumb = (label: string) => root!.root.findAllByType("Pressable" as React.ElementType).find(n => n.props.accessibilityLabel === label)!;
beforeEach(() => {
 Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mocks.fetch.mockReset();
 mocks.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ state: "verified", sourceDigest: review.sourceDigest, row: { id: "answer-1", role: "assistant", content: "Checked answer", metadata: { parts: [{ type: "text", text: "Checked answer" }] } } }) }));
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; });
it("keeps the same checked row across actual metadata feedback updates, toggle and rollback without borrowing parent content/cards", async () => {
 const onFeedback = vi.fn(); await act(async () => { root = create(view(onFeedback)); });
 await act(async () => { root!.root.findAllByType("Pressable" as React.ElementType)[0].props.onPress(); });
 for (const feedback of ["up", "down", null, "up", null, "down", "up"] as const) {
  // The exact shallow metadata update used by useSureWordChat.writeFeedbackLocally.
  const { feedback: _previous, ...rest } = message.metadata as Record<string, unknown>;
  message = { ...message, metadata: { ...rest, ...(feedback ? { feedback } : {}) } };
  expect(toViewMessage(message, { isStreaming: false }).historyVerification).toBe(review);
  await act(async () => { root!.update(view(onFeedback)); });
  expect(thumb("This answer was helpful").props.accessibilityState.selected).toBe(feedback === "up");
  expect(thumb("This answer was not helpful").props.accessibilityState.selected).toBe(feedback === "down");
  expect(root!.root.findAllByType("MarkdownBody" as React.ElementType)[0].props.content).toBe("Checked answer");
  expect(root!.root.findAllByType("ChoiceCard" as React.ElementType)).toHaveLength(0);
  expect(JSON.stringify(root!.toJSON())).not.toContain("UNCHECKED");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
 }
 await act(async () => { thumb("This answer was helpful").props.onPress(); });
 expect(onFeedback).toHaveBeenLastCalledWith("answer-1", null);
 message = { ...message, metadata: { ...message.metadata as object, historyVerification: { ...review, sourceDigest: "b".repeat(64) } } };
 await act(async () => { root!.update(view(onFeedback)); });
 expect(root!.root.findAllByType("MarkdownBody" as React.ElementType)).toHaveLength(0);
 expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
