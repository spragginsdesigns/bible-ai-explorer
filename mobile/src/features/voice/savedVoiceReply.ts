import { dbMessageToUIMessage, toViewMessage, type ChatViewMessage } from "@/lib/chatView";

/** One formatter for the visible live reply and its authoritative saved projection. */
export function spokenVoiceAnswer(message: Pick<ChatViewMessage, "role" | "content" | "choiceCard" | "historyVerification">): string | null {
	if (message.role !== "assistant" || typeof message.content !== "string" || Object.prototype.hasOwnProperty.call(message, "historyVerification")) return null;
	const card = message.choiceCard;
	if (!card) return message.content;
	return `${message.content} ${card.question} ${[...card.options, card.skipLabel].map((label, index) => `Option ${index + 1}. ${label}.`).join(" ")}`;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** EOF precedes persistence. Only this exact safe row and spoken envelope prove save. */
export async function waitForSavedVoiceReply(options: {
	messageId: string;
	expectedSpokenText?: string;
	read: () => Promise<unknown>;
	isCurrent: () => boolean;
	wait?: () => Promise<void>;
	attempts?: number;
}): Promise<string> {
	for (let attempt = 0; attempt < (options.attempts ?? 12); attempt += 1) {
		if (!options.isCurrent()) throw new Error("The conversation changed. Voice controls stopped.");
		const payload = await options.read();
		if (!options.isCurrent()) throw new Error("The conversation changed. Voice controls stopped.");
		if (record(payload) && Array.isArray(payload.messages)) {
			const matches = payload.messages.filter((message: unknown) => record(message) && message.id === options.messageId);
			if (matches.length > 1) throw new Error("The saved answer is inconsistent. Voice controls stopped.");
			const row: unknown = matches[0];
			if (record(row) && row.role === "assistant") {
				if (typeof row.content !== "string" || !record(row.metadata) || Object.prototype.hasOwnProperty.call(row.metadata, "historyVerification")
					|| !Array.isArray(row.metadata.parts) || !row.metadata.parts.every(part => record(part) && typeof part.type === "string" && (part.type !== "text" || typeof part.text === "string"))) {
					throw new Error("The saved answer needs checking. Voice controls stopped.");
				}
				const text = spokenVoiceAnswer(toViewMessage(dbMessageToUIMessage(row), { isStreaming: false }));
				if (text === null || (options.expectedSpokenText !== undefined && text !== options.expectedSpokenText)) throw new Error("The saved answer changed. Voice controls stopped. Check Chat before trying again.");
				if (text.trim()) return text;
			}
		}
		await (options.wait?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 900)));
	}
	throw new Error("Your answer has not been confirmed saved. Voice controls stopped. Check the conversation before trying again.");
}
