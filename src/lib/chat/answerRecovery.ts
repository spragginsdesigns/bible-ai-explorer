/**
 * Pure half of the "an answer must never be lost" recovery. Mirrors
 * mobile/src/features/chat/answerRecovery.ts - keep the two in step.
 *
 * When the client's streaming connection dies mid-answer (a phone leaving the
 * foreground, a laptop sleeping, a network change) the server does not stop:
 * /api/ask-question drains its own copy of the stream and persists the
 * finished answer. So a dead stream is never a lost answer - the client just
 * has to collect it from the conversation instead of showing a failure.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * The messages of a conversation whose newest message is a finished assistant
 * reply, or null while the answer is still being written (the user message is
 * persisted when the stream opens, the assistant message only at the end - so
 * a trailing user message means "not done yet").
 */
export function completedHistory(payload: unknown): unknown[] | null {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) return null;
	const last = payload.messages.at(-1);
	if (!isRecord(last) || last.role !== "assistant") return null;
	// An assistant row with no content is a persistence artifact, not an answer.
	if (typeof last.content === "string" && last.content.trim().length === 0) return null;
	return payload.messages;
}
