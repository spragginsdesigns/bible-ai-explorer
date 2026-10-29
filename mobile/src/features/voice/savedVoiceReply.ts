/** EOF precedes the server's background persistence; only this exact row proves save. */
export async function waitForSavedVoiceReply(options: {
	messageId: string;
	read: () => Promise<unknown>;
	isCurrent: () => boolean;
	wait?: () => Promise<void>;
	attempts?: number;
}): Promise<void> {
	for (let attempt = 0; attempt < (options.attempts ?? 12); attempt += 1) {
		if (!options.isCurrent()) throw new Error("The conversation changed. Voice controls stopped.");
		const payload = await options.read();
		if (!options.isCurrent()) throw new Error("The conversation changed. Voice controls stopped.");
		if (typeof payload === "object" && payload !== null && "messages" in payload && Array.isArray(payload.messages) && payload.messages.some((message: unknown) =>
			typeof message === "object" && message !== null && "id" in message && message.id === options.messageId && "role" in message && message.role === "assistant" && "content" in message && typeof message.content === "string" && message.content.trim().length > 0
		)) return;
		await (options.wait?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 900)));
	}
	throw new Error("Your answer has not been confirmed saved. Voice controls stopped. Check the conversation before trying again.");
}
