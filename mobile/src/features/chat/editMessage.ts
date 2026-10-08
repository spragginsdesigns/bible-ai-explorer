import type { UIMessage } from "ai";

/**
 * What an edited user message sends: the same files, new words, and the same
 * metadata (attachment ids, a Daily Cross origin), so the server re-links the
 * attachments to the message it already holds. Null when there is nothing left
 * to send: no words and no files.
 */
export function editedUserMessage(
	original: Pick<UIMessage, "parts" | "metadata">,
	text: string
): { parts: UIMessage["parts"]; metadata: UIMessage["metadata"] } | null {
	const fileParts = original.parts.filter((part) => part.type === "file");
	const trimmed = text.trim();
	if (!trimmed && fileParts.length === 0) return null;
	return {
		parts: [...fileParts, ...(trimmed ? [{ type: "text" as const, text: trimmed }] : [])],
		metadata: original.metadata,
	};
}

/**
 * The ids an edit of `messageId` drops: every message after it. Sent as the
 * request's `replaces`, the only rows the server may then delete; a row it
 * did not name (another device kept talking) refuses the turn instead.
 * Mirrors src/lib/chat/message-edit.ts.
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
