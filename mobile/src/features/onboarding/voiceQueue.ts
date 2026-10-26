/**
 * Which welcome messages voice mode reads next ("Read it to me"). Pure, so
 * the rules are tested without audio: only settled SureWord messages are
 * read, each once, in order, and turning voice mode on reads the latest one
 * rather than the whole conversation from the top.
 */

export interface VoiceMessage {
	id: string;
	role: "user" | "assistant";
	isStreaming?: boolean;
	/** The card under the message, whose scripted question is read after it. */
	step?: string;
}

export type VoiceItem = { messageId: string } | { step: string };

/** The ids to treat as already heard when voice mode turns on: all but the last SureWord message. */
export function heardOnEnable(messages: readonly VoiceMessage[]): Set<string> {
	const assistant = messages.filter((message) => message.role === "assistant" && !message.isStreaming);
	return new Set(assistant.slice(0, -1).map((message) => message.id));
}

/** Messages not heard yet, as the requests to make, oldest first. Marks them heard. */
export function takeUnheard(messages: readonly VoiceMessage[], heard: Set<string>): VoiceItem[] {
	const items: VoiceItem[] = [];
	for (const message of messages) {
		if (message.role !== "assistant" || message.isStreaming || heard.has(message.id)) continue;
		heard.add(message.id);
		items.push({ messageId: message.id });
		if (message.step && message.step !== "other") items.push({ step: message.step });
	}
	return items;
}
