/**
 * Conversations whose answer this device deliberately walked away from - the
 * user pressed stop, switched conversations, or started a new chat.
 *
 * The server cannot tell those apart from a backgrounded app: both look like
 * the same dropped connection, and both leave a finished answer worth keeping.
 * It sends "your answer is ready" for either, so the client suppresses the ones
 * it knows the user did not want. Memory-only and short-lived by design: a push
 * for an answer abandoned minutes ago is stale anyway.
 */

const STOP_MEMORY_MS = 3 * 60 * 1000;

const stoppedAt = new Map<string, number>();

export function markConversationStopped(conversationId: string): void {
	const now = Date.now();
	stoppedAt.set(conversationId, now);
	// Sweep here rather than on a timer; the map only ever holds conversations
	// this session actually stopped.
	for (const [id, at] of stoppedAt) {
		if (now - at > STOP_MEMORY_MS) stoppedAt.delete(id);
	}
}

export function wasConversationStopped(conversationId: string): boolean {
	const at = stoppedAt.get(conversationId);
	if (at === undefined) return false;
	if (Date.now() - at > STOP_MEMORY_MS) {
		stoppedAt.delete(conversationId);
		return false;
	}
	return true;
}
