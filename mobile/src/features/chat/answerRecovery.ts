/**
 * Pure half of the "an answer must never be lost" recovery, kept free of React
 * and native imports so it can be unit-tested. The hook in useSureWordChat.ts
 * owns the polling and the AppState wiring.
 *
 * Why this exists: Android suspends the app's sockets when it goes to the
 * background, so the streaming fetch behind a chat answer dies mid-flight. The
 * server does NOT stop - /api/ask-question drains its own copy of the stream
 * and persists the finished answer regardless - so the answer is sitting in
 * the conversation waiting to be collected. The client just has to go and get
 * it instead of showing a failure.
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
