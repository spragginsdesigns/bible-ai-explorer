import webpush, { WebPushError } from "web-push";
import { prisma } from "@/lib/prisma";
import {
	chatReplyRecipientWhere,
	chunkByRecipients,
	classifyTickets,
	type ExpoTicket,
	type PushRecipient,
} from "@/lib/push-audience";
import {
	buildWebPushPayload,
	isGoneWebPushStatus,
	recipientFromRow,
	splitRecipients,
	type DeliveryRecipient,
	type WebRecipient,
} from "@/lib/push-routing";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_CHUNK_SIZE = 100;
/** Browsers sent to at once; each send is its own HTTPS request. */
const WEB_PUSH_CONCURRENCY = 10;
/** A morning verse or a finished answer is stale after a day. */
const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;

/** The PushToken columns a recipient needs, for callers that build PendingPush. */
export const PUSH_RECIPIENT_SELECT = {
	id: true,
	token: true,
	platform: true,
	webP256dh: true,
	webAuth: true,
} as const;

/**
 * VAPID identity for Web Push, or null when any part is unset. Optional like
 * the other paid or keyed features: without it browser subscriptions are
 * skipped silently and the web Notifications section explains why.
 */
export function webPushConfig(): { publicKey: string; privateKey: string; subject: string } | null {
	const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
	const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
	const subject = process.env.VAPID_SUBJECT?.trim();
	if (!publicKey || !privateKey || !subject) return null;
	return { publicKey, privateKey, subject };
}

/**
 * One logical notification for one person, fanned out to their devices in a
 * single Expo message (and one Web Push per browser). Each recipient carries
 * its row id so a dead token can be retired.
 */
export interface PendingPush {
	recipients: DeliveryRecipient[];
	title: string;
	/** iOS-only second line; Android carries the same context inside `body`. */
	subtitle?: string;
	body: string;
	data: Record<string, unknown>;
	/** Android notification channel the payload should land in. */
	channelId: string;
}

/**
 * Deliver queued messages to every recipient's transport: Expo tokens through
 * the Expo push API, browser subscriptions through Web Push. Dead Expo tokens
 * (DeviceNotRegistered) and gone browser subscriptions (404/410) are deleted.
 * Returns how many were deleted.
 *
 * `label` only tags log lines, so a failing send is traceable to the caller
 * (the verse-of-day cron vs. a chat answer) without reading a stack trace.
 */
export async function sendPushMessages(messages: PendingPush[], label: string): Promise<number> {
	const expoMessages: PendingPush[] = [];
	const webJobs: Array<{ message: PendingPush; recipients: WebRecipient[] }> = [];
	for (const message of messages) {
		const { expo, web } = splitRecipients(message.recipients);
		if (expo.length > 0) expoMessages.push({ ...message, recipients: expo });
		if (web.length > 0) webJobs.push({ message, recipients: web });
	}
	const [expoRetired, webRetired] = await Promise.all([
		sendViaExpo(expoMessages, label),
		sendViaWebPush(webJobs, label),
	]);
	return expoRetired + webRetired;
}

/**
 * The name every caller used while Expo was the only transport; it routes
 * browsers too now. Kept for the sermon watchdog cron.
 */
export const sendExpoPushMessages = sendPushMessages;

async function sendViaWebPush(
	jobs: Array<{ message: PendingPush; recipients: WebRecipient[] }>,
	label: string
): Promise<number> {
	if (jobs.length === 0) return 0;
	const config = webPushConfig();
	if (!config) return 0;

	const sends = jobs.flatMap(({ message, recipients }) => {
		const payload = JSON.stringify(buildWebPushPayload(message));
		return recipients.map((recipient) => ({ recipient, payload }));
	});
	let retired = 0;
	let next = 0;
	const worker = async () => {
		while (next < sends.length) {
			const { recipient, payload } = sends[next];
			next += 1;
			try {
				await webpush.sendNotification(
					{ endpoint: recipient.endpoint, keys: recipient.keys },
					payload,
					{
						TTL: WEB_PUSH_TTL_SECONDS,
						urgency: "high",
						vapidDetails: {
							subject: config.subject,
							publicKey: config.publicKey,
							privateKey: config.privateKey,
						},
					}
				);
			} catch (error) {
				if (error instanceof WebPushError && isGoneWebPushStatus(error.statusCode)) {
					await prisma.pushToken.delete({ where: { id: recipient.tokenId } }).catch(() => {});
					retired += 1;
				} else {
					const status = error instanceof WebPushError ? error.statusCode : "network";
					console.error(`[${label}] Web push send failed (${status}).`);
				}
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(WEB_PUSH_CONCURRENCY, sends.length) }, () => worker())
	);
	return retired;
}

async function sendViaExpo(messages: PendingPush[], label: string): Promise<number> {
	if (messages.length === 0) return 0;
	let deactivated = 0;

	for (const chunk of chunkByRecipients(messages, EXPO_PUSH_CHUNK_SIZE)) {
		const recipients = chunk.flatMap((piece) => piece.recipients);
		try {
			const response = await fetch(EXPO_PUSH_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify(
					chunk.map(({ message, recipients: pieceRecipients }) => ({
						to:
							pieceRecipients.length === 1
								? pieceRecipients[0].to
								: pieceRecipients.map((recipient) => recipient.to),
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

			const receipt = (await response.json()) as { data?: ExpoTicket[] };
			const tickets = Array.isArray(receipt.data) ? receipt.data : [];
			const { retiredTokenIds, errors } = classifyTickets(recipients, tickets);
			for (const tokenId of retiredTokenIds) {
				await prisma.pushToken.delete({ where: { id: tokenId } }).catch(() => {});
				deactivated += 1;
			}
			for (const ticketError of errors) {
				// Non-fatal ticket errors (InvalidCredentials, rate limits, …)
				// must be visible in logs rather than vanishing silently.
				console.error(`[${label}] Push ticket error:`, ticketError);
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
			where: chatReplyRecipientWhere(options.userId),
			select: PUSH_RECIPIENT_SELECT,
		});
		if (tokens.length === 0) return;

		await sendPushMessages(
			[
				{
					recipients: tokens.map(recipientFromRow),
					title: "Your answer is ready",
					body: preview,
					data: { screen: "chat", conversationId: options.conversationId },
					channelId: CHAT_REPLY_CHANNEL_ID,
				},
			],
			"chat-reply-push"
		);
	} catch (error) {
		console.error("[chat-reply-push] Failed to notify:", error);
	}
}
