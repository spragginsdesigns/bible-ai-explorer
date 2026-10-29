import { describe, expect, it } from "vitest";
import { VoiceTurnGate, voiceControlsEligible } from "./voiceTurnGate";
import { waitForSavedVoiceReply } from "./savedVoiceReply";
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
		await waitForSavedVoiceReply({ messageId: "new", isCurrent: () => true, wait: async () => {}, read: async () => ({ messages: ++reads === 1 ? [{ id: "old", role: "assistant", content: "old answer" }, { id: "new", role: "user", content: "question" }] : [{ id: "new", role: "assistant", content: "saved answer" }] }) });
		expect(reads).toBe(2);
	});
	it("stops on save timeout and account changes without resending", async () => {
		let reads = 0;
		await expect(waitForSavedVoiceReply({ messageId: "new", attempts: 2, isCurrent: () => true, wait: async () => {}, read: async () => { reads++; return { messages: [] }; } })).rejects.toThrow("not been confirmed saved");
		expect(reads).toBe(2);
		await expect(waitForSavedVoiceReply({ messageId: "new", isCurrent: () => false, read: async () => { throw new Error("must not read"); } })).rejects.toThrow("conversation changed");
	});
});
