/**
 * Pure transport rules for push delivery: which stored tokens go to Expo,
 * which go to a browser through Web Push, and what a browser notification
 * carries. Kept free of Prisma, fetch and web-push so the decisions are unit
 * testable on their own, like push-audience.ts.
 */
import type { PushRecipient } from "./push-audience";

/** The encryption keys of a browser PushSubscription. */
export interface WebPushKeys {
	p256dh: string;
	auth: string;
}

/**
 * One device a push is delivered to. Expo devices carry only `to` (the Expo
 * token); browsers carry the subscription endpoint in `to` plus its keys.
 */
export interface DeliveryRecipient extends PushRecipient {
	webKeys?: WebPushKeys | null;
}

/** A browser recipient with everything web-push needs to encrypt and send. */
export interface WebRecipient {
	tokenId: string;
	endpoint: string;
	keys: WebPushKeys;
}

/** The PushToken columns a recipient is built from. */
export interface PushTokenRow {
	id: string;
	token: string;
	platform?: string | null;
	webP256dh?: string | null;
	webAuth?: string | null;
}

const EXPO_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[.+\]$/;

/**
 * Expo's API validates the whole request, so one malformed `to` (a browser
 * endpoint) fails every message in the chunk. Every token reaching Expo must
 * have Expo's shape.
 */
export function isExpoPushToken(token: string): boolean {
	return EXPO_TOKEN_PATTERN.test(token);
}

/** A stored row as a recipient; browser rows keep their keys. */
export function recipientFromRow(row: PushTokenRow): DeliveryRecipient {
	const webKeys =
		row.platform === "web" && row.webP256dh && row.webAuth
			? { p256dh: row.webP256dh, auth: row.webAuth }
			: null;
	return webKeys ? { tokenId: row.id, to: row.token, webKeys } : { tokenId: row.id, to: row.token };
}

/**
 * Split recipients by transport. A browser needs a known push service
 * endpoint and both keys; anything that is neither a complete browser subscription nor an Expo
 * token is dropped rather than poisoning an Expo request. Each endpoint or
 * token appears once, so one device never gets the same push twice.
 */
export function splitRecipients(recipients: readonly DeliveryRecipient[]): {
	expo: PushRecipient[];
	web: WebRecipient[];
	dropped: number;
} {
	const expo: PushRecipient[] = [];
	const web: WebRecipient[] = [];
	const seen = new Set<string>();
	let dropped = 0;
	for (const recipient of recipients) {
		if (seen.has(recipient.to)) continue;
		seen.add(recipient.to);
		if (recipient.webKeys && isAllowedWebPushEndpoint(recipient.to)) {
			web.push({ tokenId: recipient.tokenId, endpoint: recipient.to, keys: recipient.webKeys });
		} else if (isExpoPushToken(recipient.to)) {
			expo.push({ tokenId: recipient.tokenId, to: recipient.to });
		} else {
			dropped += 1;
		}
	}
	return { expo, web, dropped };
}

/**
 * Where a tap on a browser notification lands, mirroring the native
 * notificationTapTarget: the guided day for `screen: "cross"`, the finished
 * conversation for `screen: "chat"`, home for anything else.
 */
export function webPushTapUrl(data: Record<string, unknown>): string {
	if (data.screen === "cross") return "/cross";
	if (data.screen === "chat" && typeof data.conversationId === "string" && data.conversationId) {
		return `/?conversationId=${encodeURIComponent(data.conversationId)}`;
	}
	return "/";
}

/** What the service worker receives and shows. */
export interface WebPushPayload {
	title: string;
	body: string;
	/** Same-origin path opened on tap. */
	url: string;
	/** Replaces an earlier notification with the same tag instead of stacking. */
	tag: string;
	data: Record<string, unknown>;
}

/**
 * The browser notification for one logical push. Same title, body and data as
 * the Expo message; `subtitle` is iOS-only and Android-style bodies already
 * carry the reference, so it is not repeated.
 */
export function buildWebPushPayload(message: {
	title: string;
	body: string;
	data: Record<string, unknown>;
}): WebPushPayload {
	const url = webPushTapUrl(message.data);
	const tag =
		message.data.screen === "cross"
			? "daily-cross"
			: message.data.screen === "chat" && typeof message.data.conversationId === "string"
				? `chat-${message.data.conversationId}`
				: "sureword";
	return { title: message.title, body: message.body, url, tag, data: message.data };
}

/**
 * Browser push services a subscription endpoint may point at: Chrome/Edge
 * (FCM), Firefox (Mozilla autopush), Edge legacy (WNS) and Safari (Apple).
 * The server POSTs to whatever endpoint is stored, so an arbitrary URL from a
 * client would turn registration into a request-forgery hook.
 */
const WEB_PUSH_HOST_SUFFIXES = [
	"fcm.googleapis.com",
	"android.googleapis.com",
	"push.services.mozilla.com",
	"notify.windows.com",
	"push.apple.com",
];

export function isAllowedWebPushEndpoint(endpoint: string): boolean {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
	const host = url.hostname.toLowerCase();
	return WEB_PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The stored PushToken columns that decide who may re-register a token. */
export interface PushTokenOwnerRow {
	userId: string;
	platform: string;
	webP256dh: string | null;
	webAuth: string | null;
	/** The device has sent its proof back (push-token-proof.ts). */
	deviceBound?: boolean;
}

/**
 * Whether `userId` may register `token` when a row for it already exists.
 * Registration upserts by token, so without this rule anyone who learned
 * another account's token could move it to themselves.
 *
 * - The owner refreshing their own row: always.
 * - A browser endpoint owned by someone else: only by a caller holding the
 *   same subscription keys. `auth` is the browser's secret, so matching it is
 *   proof of holding the subscription, not just of having seen its URL. The
 *   honest path never needs more: the same browser signing into another
 *   account re-sends its own subscription unchanged (and sign-out normally
 *   unsubscribes, which mints a new endpoint anyway).
 * - An Expo token owned by someone else, on a `deviceBound` row: only with
 *   the device proof. The proof comes from the token, not the account, so a
 *   second account signed in on the same phone still has it.
 * - An Expo token owned by someone else, not yet bound: allowed, as before.
 *   These rows come from builds that never kept a proof, where refusing would
 *   break signing out and in as someone else on a shared phone (the app does
 *   not unregister on sign-out) and keep the old account's answer previews
 *   landing on the new person's phone.
 *
 * `proofValid` is null when the proof feature is off (no
 * PUSH_TOKEN_PROOF_SECRET): binding is then ignored and Expo rows move as they
 * always did, so a deploy without the secret behaves exactly as before.
 */
export function mayRegisterExistingPushToken(
	stored: PushTokenOwnerRow,
	request: {
		userId: string;
		platform: string;
		keys?: WebPushKeys | null;
		proofValid?: boolean | null;
	},
): boolean {
	if (stored.userId === request.userId) return true;
	if (stored.platform === "web") {
		return (
			request.platform === "web" &&
			Boolean(stored.webP256dh && stored.webAuth) &&
			request.keys?.p256dh === stored.webP256dh &&
			request.keys?.auth === stored.webAuth
		);
	}
	if (request.platform === "web") return false;
	if (stored.deviceBound && request.proofValid !== null && request.proofValid !== undefined) {
		return request.proofValid;
	}
	return true;
}

/** Push services answer 404 or 410 for a subscription that will never work again. */
export function isGoneWebPushStatus(statusCode: number | undefined): boolean {
	return statusCode === 404 || statusCode === 410;
}
