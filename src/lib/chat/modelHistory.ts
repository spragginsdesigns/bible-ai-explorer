import type { ModelMessage } from "ai";

/**
 * Chat displays public activity instead of transporting reasoning protocol
 * blocks. Replay those turns as full text/tool calls: an OpenAI item reference
 * alone can require an omitted reasoning item and make the next turn fail.
 * Complete reasoning-bearing messages and other providers' metadata stay intact.
 */
export function withoutOrphanedOpenAIReferences(messages: ModelMessage[]): ModelMessage[] {
	return messages.map(message => {
		if (message.role !== "assistant" || typeof message.content === "string" ||
			message.content.some(part => part.type === "reasoning")) return message;
		return { ...message, content: message.content.map(part => {
			if (part.type !== "text" && part.type !== "tool-call") return part;
			const openai = part.providerOptions?.openai;
			if (!openai || !("itemId" in openai)) return part;
			const { itemId: _itemId, ...options } = openai;
			return { ...part, providerOptions: { ...part.providerOptions, openai: options } };
		}) };
	});
}
