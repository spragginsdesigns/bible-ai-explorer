import { readFileSync } from "node:fs";
import ts from "typescript";
import { dbMessageToUIMessage, toViewMessage } from "@/lib/chatView";
import { describe, expect, it } from "vitest";
import { VoiceTurnGate, voiceControlsEligible } from "./voiceTurnGate";
import { spokenVoiceAnswer, waitForSavedVoiceReply } from "./savedVoiceReply";
import { resolveVoiceCommand } from "./voiceCommands";

describe("voice turn fences", () => {
	it("accepts one final only, ignoring interim and duplicate events", () => {
		const gate = new VoiceTurnGate(); const card = {}; const token = gate.begin(card);
		expect(gate.consume(token, card, false, false)).toBe(false);
		expect(gate.consume(token, card, true, false)).toBe(true);
		expect(gate.consume(token, card, true, false)).toBe(false);
	});
	it("rejects changed cards, account/background invalidation, and active output/network", () => {
		const gate = new VoiceTurnGate(); const card = {}; const token = gate.begin(card);
		expect(gate.consume(token, {}, true, false)).toBe(false);
		expect(gate.consume(token, card, true, true)).toBe(false);
		gate.invalidate(); expect(gate.consume(token, card, true, false)).toBe(false);
	});
	it("only trusts a successful authenticated response with explicit Pro access", () => {
		for (const value of [null, {}, { pro: false }, { pro: "true" }, { email: "atmosphere9999@gmail.com" }]) expect(voiceControlsEligible(value)).toBe(false);
		expect(voiceControlsEligible({ pro: true, available: false })).toBe(true);
	});
});
describe("spoken options and canonical saves", () => {
	it("resolves full labels and ordinals, rejecting ambiguity and stale options", () => {
		const options = ["Newly saved", "Saved and growing", "I am a pastor", "I teach Sunday school"];
		expect(resolveVoiceCommand("saved", { options }).type).toBe("ambiguous");
		expect(resolveVoiceCommand("select the fourth option", { options })).toEqual({ type: "choose", index: 3, label: options[3] });
		expect(resolveVoiceCommand("I am a pastor", { options })).toEqual({ type: "choose", index: 2, label: options[2] });
		expect(resolveVoiceCommand("select the fourth option", { options: ["Continue"] }).type).toBe("ambiguous");
		for (const destination of ["Today", "Bible", "Chat", "Connections", "Study", "Notes", "Settings"]) expect(resolveVoiceCommand(`open ${destination}`, { options: [] })).toEqual({ type: "navigate", destination: destination.toLowerCase() });
	});
	it("waits for the exact assistant row, never an older reply or user row", async () => {
		let reads = 0;
		await waitForSavedVoiceReply({ messageId: "new", isCurrent: () => true, wait: async () => {}, read: async () => ({ messages: ++reads === 1 ? [{ id: "old", role: "assistant", content: "old answer" }, { id: "new", role: "user", content: "question" }] : [{ id: "new", role: "assistant", content: "saved answer", metadata: { parts: [{ type: "text", text: "saved answer" }] } }] }) });
		expect(reads).toBe(2);
	});
	it("stops on save timeout and account changes without resending", async () => {
		let reads = 0;
		await expect(waitForSavedVoiceReply({ messageId: "new", attempts: 2, isCurrent: () => true, wait: async () => {}, read: async () => { reads++; return { messages: [] }; } })).rejects.toThrow("not been confirmed saved");
		expect(reads).toBe(2);
		await expect(waitForSavedVoiceReply({ messageId: "new", isCurrent: () => false, read: async () => { throw new Error("must not read"); } })).rejects.toThrow("conversation changed");
	});
});

const savedRow = (content = "Checked answer.", card?: object) => ({ id: "exact", role: "assistant", content, metadata: { parts: [{ type: "text", text: content }, ...(card ? [{ type: "tool-presentChoices", state: "output-available", output: card }] : [])] } });
const savedOptions = (row: unknown, expectedSpokenText?: string) => ({ messageId: "exact", expectedSpokenText, read: async () => ({ messages: [savedRow("Unrelated older answer."), row].map((value, index) => index === 0 ? { ...(value as object), id: "old" } : value) }), isCurrent: () => true, attempts: 1, wait: async () => {} });
it("returns authoritative ordinary text or full choice guidance using real DB/UI conversion", async () => {
 const row = savedRow(), card = { step: "faith", question: "Where are you?", options: ["Pastor", "Newly saved"], skipLabel: "Skip for now" };
 expect(await waitForSavedVoiceReply(savedOptions(row, "Checked answer."))).toBe("Checked answer.");
 const expected = "Checked answer. Where are you? Option 1. Pastor. Option 2. Newly saved. Option 3. Skip for now.";
 expect(await waitForSavedVoiceReply(savedOptions(savedRow("Checked answer.", card), expected))).toBe(expected);
 expect(spokenVoiceAnswer({ role: "assistant", content: row.content, choiceCard: { ...card, allowOther: true, terms: [] } })).toBe(expected);
 expect(spokenVoiceAnswer({ role: "user", content: "Don't narrate a user" })).toBeNull();
});
it("refuses changed saved prose or question/options/skip while preserving exact spoken equality", async () => {
 const card = { step: "faith", question: "Where are you?", options: ["Pastor", "Newly saved"], skipLabel: "Skip for now" };
 const expected = spokenVoiceAnswer({ role: "assistant", content: "Checked answer.", choiceCard: { ...card, allowOther: true, terms: [] } })!;
 for (const row of [savedRow("Different saved answer.", card), ...[{ question: "Changed question?" }, { options: ["Other", "Newly saved"] }, { skipLabel: "Not now" }].map(change => savedRow("Checked answer.", { ...card, ...change }))]) {
  await expect(waitForSavedVoiceReply(savedOptions(row, expected))).rejects.toThrow("saved answer changed");
 }
});
it("rejects pending/withheld, null/undefined own markers and malformed target rows", async () => {
 const row = savedRow();
 for (const marker of [{ state: "pending" }, { state: "withheld" }, null, undefined]) await expect(waitForSavedVoiceReply(savedOptions({ ...row, metadata: { ...row.metadata, historyVerification: marker } }))).rejects.toThrow("needs checking");
 for (const metadata of [null, [], {}, { parts: [null] }, { parts: [{ type: "text", text: 42 }] }, { parts: ["bad"] }]) await expect(waitForSavedVoiceReply(savedOptions({ ...row, metadata }))).rejects.toThrow("needs checking");
 await expect(waitForSavedVoiceReply({ ...savedOptions(row), read: async () => ({ messages: [row, row] }) })).rejects.toThrow("inconsistent");
 for (const target of [{ ...row, id: "foreign" }, { ...row, role: "user" }]) await expect(waitForSavedVoiceReply(savedOptions(target))).rejects.toThrow("not been confirmed saved");
});
it("a held saved response cannot authorize speech after the captured account/session/conversation changes", async () => {
 let current = true;
 await expect(waitForSavedVoiceReply({ ...savedOptions(savedRow()), isCurrent: () => current, read: async () => { current = false; return { messages: [savedRow()] }; } })).rejects.toThrow("conversation changed");
});

it("actual ChatScreen voice-send callback binds the shared formatter and refuses a local review marker before proof", async () => {
 const source = readFileSync(new URL("../../../app/(app)/index.tsx", import.meta.url), "utf8");
 const start = source.indexOf("const sendVoiceMessage = useCallback(async (text: string) => {");
 const end = source.indexOf("}, [sendMessage, voiceIdentity, getToken]);", start);
 expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
 const compiled = ts.transpileModule(source.slice(start, end + "}, [sendMessage, voiceIdentity, getToken]);".length), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 for (const marked of [false, true]) {
  const reply = toViewMessage(dbMessageToUIMessage({ ...savedRow(), id: "new", ...(marked ? { metadata: { parts: [], historyVerification: { surface: "chat", parentId: "chat", messageId: "new", state: "withheld", code: "review_required", sourceDigest: "a".repeat(64) } } } : {}) }), { isStreaming: false });
  const latestChat = { current: { messages: [] as unknown[], activeConversationId: "chat", error: null } }, calls: unknown[] = [];
  const callback = new Function("useCallback", "latestChat", "sendMessage", "voiceIdentity", "getToken", "spokenVoiceAnswer", "waitForSavedVoiceReply", "voiceAccount", "apiJson", compiled + "return sendVoiceMessage;")(
   (value: unknown) => value, latestChat, async () => { latestChat.current.messages = [reply]; }, "owner:session", async () => "token", spokenVoiceAnswer, async (value: unknown) => { calls.push(value); }, { current: "owner:session" }, async () => ({}),
  );
  if (marked) { await expect(callback("question")).rejects.toThrow("needs checking"); expect(calls).toHaveLength(0); }
  else { await callback("question"); expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ messageId: "new", expectedSpokenText: spokenVoiceAnswer(reply) }); }
 }
});
