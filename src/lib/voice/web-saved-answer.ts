/** Narrate the exact persisted assistant content, never an in-flight transcript. */
export function savedVoiceAnswer(body: unknown, messageId: string): string | null {
	if (!body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages)) return null;
	for (const item of body.messages) {
		if (item && typeof item === "object" && item.id === messageId && item.role === "assistant"
			&& typeof item.content === "string") return item.content;
	}
	return null;
}
