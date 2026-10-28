/** A deliberate Stop belongs to one stream attempt, never the whole conversation. */
export const CHAT_NOTIFICATION_STOP_TTL_MS = 60 * 60 * 1000;

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** undefined is an older client; null is a present but malformed attempt id. */
export function parseChatNotificationAttemptId(value: unknown): string | undefined | null {
	if (value === undefined) return undefined;
	return typeof value === "string" && FULL_UUID.test(value) ? value.toLowerCase() : null;
}

export interface ChatNotificationAttempt {
	userId: string;
	conversationId: string;
	attemptId: string;
}

interface NotificationStopDependencies {
	findStop: (attempt: ChatNotificationAttempt) => Promise<{ expiresAt: Date } | null>;
	notify: () => Promise<void>;
	now?: () => number;
	warn?: (message: string) => void;
}

/**
 * Invoke inside the post-persistence departure callback, immediately before
 * sending. This does not abort, drain, save or bill the answer. A Stop lookup
 * failure suppresses only the optional notification, with no identifying log.
 */
export async function notifyUnlessChatStopped(
	attempt: Omit<ChatNotificationAttempt, "attemptId"> & { attemptId?: string },
	deps: NotificationStopDependencies,
): Promise<"sent" | "stopped" | "lookup_failed"> {
	if (attempt.attemptId !== undefined) {
		try {
			const stop = await deps.findStop({ ...attempt, attemptId: attempt.attemptId });
			if (stop) {
				const expiresAt = stop.expiresAt.getTime();
				if (!Number.isFinite(expiresAt)) throw new Error("Invalid expiry");
				if (expiresAt > (deps.now ?? Date.now)()) return "stopped";
			}
		} catch {
			(deps.warn ?? console.warn)("[chat-reply-push] Stop lookup unavailable; notification skipped");
			return "lookup_failed";
		}
	}
	await deps.notify();
	return "sent";
}
