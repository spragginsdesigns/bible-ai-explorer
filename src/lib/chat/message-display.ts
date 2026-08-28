export interface MessageIdentity {
	id: string;
	role: "user" | "assistant" | "system";
}

export interface RenderableChatMessage extends MessageIdentity {
	role: "user" | "assistant";
	content: string;
	isStreaming?: boolean;
	activity?: string;
	attachments?: readonly unknown[];
	noteActions?: readonly unknown[];
	crossActions?: readonly unknown[];
	retrievedVerses?: readonly unknown[];
	tavilyResults?: readonly unknown[];
	followUps?: readonly unknown[];
}

/** Only a trailing assistant turn can belong to the request in flight. */
export function streamingAssistantId(
	messages: readonly MessageIdentity[],
	isBusy: boolean
): string | undefined {
	if (!isBusy) return undefined;
	const last = messages.at(-1);
	return last?.role === "assistant" ? last.id : undefined;
}

/**
 * Drop orphaned, settled assistant shells. They can be left behind by an old
 * stream that changed message ids after its first status part, but they have
 * no content or action a user can see—only an otherwise duplicated avatar.
 */
export function isRenderableChatMessage(message: RenderableChatMessage): boolean {
	if (message.role === "user") return true;
	return Boolean(
		message.isStreaming ||
		message.activity ||
		message.content.trim() ||
		message.attachments?.length ||
		message.noteActions?.length ||
		message.crossActions?.length ||
		message.retrievedVerses?.length ||
		message.tavilyResults?.length ||
		message.followUps?.length
	);
}
