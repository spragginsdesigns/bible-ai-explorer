/**
 * Pure audience rules for Expo pushes, kept free of Prisma and fetch so the
 * decisions that decide how many notifications a person receives are unit
 * testable on their own.
 */

/** One device a push is delivered to; `tokenId` lets a dead token be retired. */
export interface PushRecipient {
	tokenId: string;
	to: string;
}

/** The PushToken columns the morning audience is planned from. */
export interface MorningAudienceToken {
	id: string;
	userId: string;
	token: string;
	timezone: string;
	notifyHour: number;
	updatedAt: Date;
}

/** One user who is due this run, with every device their single push fans out to. */
export interface MorningAudience {
	userId: string;
	recipients: PushRecipient[];
}

/**
 * Devices re-register (and bump `updatedAt`) on every app launch, so a token
 * this far behind the user's freshest one belongs to an install that stopped
 * launching - a reinstall, a wiped debug build, a retired phone. Measured
 * against the user's newest token rather than the clock, so someone who has
 * not opened the app lately still gets their morning verse on their current
 * device.
 */
export const STALE_TOKEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A person's morning word goes to their newest few devices, not every install
 * they ever registered. Real accounts hold one to three tokens; the account
 * with 143 is the Play reviewer demo login, signed into by Google's pre-launch
 * device farm and our own QA emulators in nine timezones, all re-registering
 * within the stale window, so only a count cap stops that fan-out.
 */
export const MAX_MORNING_DEVICES_PER_USER = 3;

/**
 * Group verse-of-the-day tokens into one push per user.
 *
 * Due-ness is decided per user, not per token: tokens that disagree on
 * timezone or notify hour (a user who travelled, or changed the hour on one
 * device) follow the most recently updated token, because that is the device
 * the user touched last. Deciding per token let each disagreeing token fire in
 * its own hour, which is how one account got a stack of identical mornings.
 */
export function planMorningAudience(
	tokens: readonly MorningAudienceToken[],
	now: Date,
	localHour: (timezone: string, now: Date) => number | null,
): MorningAudience[] {
	const byUser = new Map<string, MorningAudienceToken[]>();
	for (const token of tokens) {
		const list = byUser.get(token.userId) ?? [];
		list.push(token);
		byUser.set(token.userId, list);
	}

	const audience: MorningAudience[] = [];
	for (const [userId, userTokens] of byUser) {
		const newestFirst = [...userTokens].sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
		const settings = newestFirst[0];
		if (!settings || localHour(settings.timezone, now) !== settings.notifyHour) continue;

		const seen = new Set<string>();
		const recipients: PushRecipient[] = [];
		for (const token of newestFirst) {
			if (recipients.length >= MAX_MORNING_DEVICES_PER_USER) break;
			if (settings.updatedAt.getTime() - token.updatedAt.getTime() > STALE_TOKEN_AFTER_MS) break;
			if (seen.has(token.token)) continue;
			seen.add(token.token);
			recipients.push({ tokenId: token.id, to: token.token });
		}
		audience.push({ userId, recipients });
	}
	return audience;
}

/**
 * Chat-reply recipients. `chatReplies` alone decides - the schema and every
 * client treat it as independent of `enabled`, so switching off the morning
 * verse must not silence "your answer is ready".
 */
export function chatReplyRecipientWhere(userId: string): { userId: string; chatReplies: true } {
	return { userId, chatReplies: true };
}

/** A message's recipients, deduped by token string so one device is never sent the same push twice. */
export function distinctRecipients(recipients: readonly PushRecipient[]): PushRecipient[] {
	const seen = new Set<string>();
	return recipients.filter((recipient) => {
		if (seen.has(recipient.to)) return false;
		seen.add(recipient.to);
		return true;
	});
}

/** A slice of one message's recipients placed in a single Expo request. */
export interface ExpoRequestPiece<M> {
	message: M;
	recipients: PushRecipient[];
}

/**
 * Split messages into Expo requests. Expo's per-request limit counts
 * recipients, not messages (a message with `to: [a, b]` is two), so a user with
 * more devices than the limit has their one message split across requests.
 */
export function chunkByRecipients<M extends { recipients: readonly PushRecipient[] }>(
	messages: readonly M[],
	limit: number,
): ExpoRequestPiece<M>[][] {
	const size = Math.max(1, Math.floor(limit));
	const chunks: ExpoRequestPiece<M>[][] = [];
	let current: ExpoRequestPiece<M>[] = [];
	let count = 0;

	for (const message of messages) {
		const recipients = distinctRecipients(message.recipients);
		let offset = 0;
		while (offset < recipients.length) {
			const take = Math.min(size - count, recipients.length - offset);
			current.push({ message, recipients: recipients.slice(offset, offset + take) });
			offset += take;
			count += take;
			if (count === size) {
				chunks.push(current);
				current = [];
				count = 0;
			}
		}
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

export interface ExpoTicket {
	status: "ok" | "error";
	details?: { error?: string };
}

/**
 * Match Expo's tickets back to devices. Expo answers with one ticket per
 * recipient, in request order, with multi-recipient `to` arrays flattened -
 * the same count expo-server-sdk-node checks in `_getActualMessageCount`.
 */
export function classifyTickets(
	recipients: readonly PushRecipient[],
	tickets: readonly ExpoTicket[],
): { retiredTokenIds: string[]; errors: Array<ExpoTicket["details"] | ExpoTicket> } {
	const retiredTokenIds: string[] = [];
	const errors: Array<ExpoTicket["details"] | ExpoTicket> = [];
	const count = Math.min(recipients.length, tickets.length);
	for (let index = 0; index < count; index++) {
		const ticket = tickets[index];
		if (ticket?.status !== "error") continue;
		if (ticket.details?.error === "DeviceNotRegistered") {
			retiredTokenIds.push(recipients[index].tokenId);
		} else {
			errors.push(ticket.details ?? ticket);
		}
	}
	return { retiredTokenIds, errors };
}
