import { prisma } from "@/lib/prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_CHUNK_SIZE = 100;

/** One queued Expo push, carrying the row id so a dead token can be retired. */
export interface PendingPush {
	tokenId: string;
	to: string;
	title: string;
	/** iOS-only second line; Android carries the same context inside `body`. */
	subtitle?: string;
	body: string;
	data: Record<string, unknown>;
	/** Android notification channel the payload should land in. */
	channelId: string;
}

interface ExpoPushTicket {
	status: "ok" | "error";
	details?: { error?: string };
}

/**
 * Send queued messages through the Expo push API in chunks and retire tokens
 * Expo reports as DeviceNotRegistered. Returns how many tokens were deleted.
 *
 * `label` only tags log lines, so a failing send is traceable to the caller
 * (the verse-of-day cron vs. a chat answer) without reading a stack trace.
 */
export async function sendExpoPushMessages(
	messages: PendingPush[],
	label: string
): Promise<number> {
	let deactivated = 0;

	for (let start = 0; start < messages.length; start += EXPO_PUSH_CHUNK_SIZE) {
		const chunk = messages.slice(start, start + EXPO_PUSH_CHUNK_SIZE);
		try {
			const response = await fetch(EXPO_PUSH_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(
					chunk.map((message) => ({
						to: message.to,
						title: message.title,
						...(message.subtitle ? { subtitle: message.subtitle } : {}),
						body: message.body,
						data: message.data,
						// High priority so FCM delivers during Doze instead of
						// holding the payload until a maintenance window. A client
						// that lacks the named channel falls back to a default one
						// and still displays the notification.
						priority: "high",
						channelId: message.channelId,
					}))
				),
			});
			if (!response.ok) {
				console.error(`[${label}] Expo push API answered ${response.status}.`);
				continue;
			}

			const receipt = (await response.json()) as { data?: ExpoPushTicket[] };
			const tickets = Array.isArray(receipt.data) ? receipt.data : [];
			for (let index = 0; index < tickets.length; index++) {
				const ticket = tickets[index];
				if (ticket?.status !== "error") continue;
				if (ticket.details?.error === "DeviceNotRegistered") {
					await prisma.pushToken.delete({ where: { id: chunk[index].tokenId } }).catch(() => {});
					deactivated += 1;
				} else {
					// Non-fatal ticket errors (InvalidCredentials, rate limits, …)
					// must be visible in logs rather than vanishing silently.
					console.error(`[${label}] Push ticket error:`, ticket.details ?? ticket);
				}
			}
		} catch (error) {
			console.error(`[${label}] Expo push send failed:`, error);
		}
	}

	return deactivated;
}

/** Android channel the "your answer is ready" push is routed to. */
export const CHAT_REPLY_CHANNEL_ID = "chat-replies";

/** Keep the tray line readable; the full answer is one tap away. */
function trayPreview(text: string, max = 220): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Tell the user their answer finished while they were away. Called only when
 * the client disconnected mid-stream (app backgrounded, screen locked, network
 * dropped) - a user watching the answer stream in gets nothing.
 *
 * Best-effort by design: a push failure must never surface as a chat failure.
 */
export async function notifyChatAnswerReady(options: {
	userId: string;
	conversationId: string;
	answerText: string;
}): Promise<void> {
	const preview = trayPreview(options.answerText);
	if (!preview) return;

	try {
		const tokens = await prisma.pushToken.findMany({
			where: { userId: options.userId, enabled: true, chatReplies: true },
			select: { id: true, token: true },
		});
		if (tokens.length === 0) return;

		await sendExpoPushMessages(
			tokens.map((token) => ({
				tokenId: token.id,
				to: token.token,
				title: "Your answer is ready",
				body: preview,
				data: { screen: "chat", conversationId: options.conversationId },
				channelId: CHAT_REPLY_CHANNEL_ID,
			})),
			"chat-reply-push"
		);
	} catch (error) {
		console.error("[chat-reply-push] Failed to notify:", error);
	}
}
