/**
 * Edit and "Try again" on chat messages: the pure half.
 *
 * Both are the AI SDK's own operations. `sendMessage({ messageId })` replaces a
 * user message and drops every message after it; `regenerate()` replaces the
 * newest answer. The server sees the user message arrive again under its own
 * id and deletes every stored row after it (persistUserMessage in
 * /api/ask-question), so the thread on screen and the thread on reload agree.
 *
 * Structural types only, so this file has no imports and the rules can be unit
 * tested without the SDK (tests/chat-message-edit.test.mjs).
 */

interface MessagePart {
	type: string;
	text?: string;
}

interface EditableMessage<Part extends MessagePart = MessagePart, Metadata = unknown> {
	id: string;
	role: string;
	parts: Part[];
	metadata?: Metadata;
}

/** Everything the user typed in a message, as it goes back into the composer. */
export function userMessageText(message: EditableMessage | null | undefined): string {
	if (!message) return "";
	return message.parts
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/** Whether a message carries files, which make an empty-text edit still sendable. */
export function messageHasFiles(message: EditableMessage | null | undefined): boolean {
	return Boolean(message?.parts.some((part) => part.type === "file"));
}

/**
 * The `sendMessage` argument that replaces `original` with `text`. Files and
 * metadata (attachmentIds, a Daily Cross origin) ride along unchanged, so an
 * edit changes the words and nothing else. Null when the edit would leave the
 * message empty: no text and no files is not a message.
 */
export function editedUserMessage<Part extends MessagePart, Metadata>(
	original: EditableMessage<Part, Metadata> | null | undefined,
	text: string,
): { messageId: string; parts: Part[]; metadata?: Metadata } | null {
	if (!original || original.role !== "user") return null;
	const trimmed = text.trim();
	const files = original.parts.filter((part) => part.type === "file");
	if (!trimmed && files.length === 0) return null;
	return {
		messageId: original.id,
		parts: [...files, ...(trimmed ? [{ type: "text", text: trimmed } as Part] : [])],
		...(original.metadata !== undefined ? { metadata: original.metadata } : {}),
	};
}

/**
 * The ids an edit of `messageId` drops: every message after it. Sent as the
 * request's `replaces`, the only rows the server may then delete.
 */
export function idsAfter(messages: readonly { id: string }[], messageId: string): string[] {
	const index = messages.findIndex((message) => message.id === messageId);
	return index < 0 ? [] : messages.slice(index + 1).map((message) => message.id);
}

/** The ids "Try again" drops: everything after the newest user message. */
export function idsAfterLastUser(messages: readonly { id: string; role: string }[]): string[] {
	const index = messages.findLastIndex((message) => message.role === "user");
	return index < 0 ? [] : messages.slice(index + 1).map((message) => message.id);
}

/**
 * The answer "Try again" may replace: the newest message, when it is a settled
 * answer. A thread that ends on the user's own message has a failed answer,
 * which the error card's retry already owns.
 */
export function retryableAnswerId(
	messages: readonly { id: string; role: string }[],
	busy: boolean,
): string | null {
	if (busy) return null;
	const last = messages.at(-1);
	return last?.role === "assistant" ? last.id : null;
}
