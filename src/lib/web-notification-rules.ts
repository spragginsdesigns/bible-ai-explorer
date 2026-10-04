/**
 * Pure decisions behind browser notifications, free of DOM access so they are
 * unit testable. The browser half lives in web-notifications.ts. Mirrors the
 * Android rules in mobile/src/features/notifications (notificationSettings.ts
 * defaults, permissionPrompt.ts).
 */

export interface WebNotificationSettings {
	/** Verse of the day each morning. */
	enabled: boolean;
	/** Local hour the morning verse should arrive, 0-23. */
	hour: number;
	/** "Your answer is ready" when an answer finishes while SureWord is out of view. */
	chatReplies: boolean;
}

export const DEFAULT_WEB_NOTIFICATION_SETTINGS: WebNotificationSettings = {
	enabled: true,
	hour: 8,
	chatReplies: true,
};

export interface StoredWebNotifications {
	settings: WebNotificationSettings;
	/** When this browser last showed the permission ask (epoch ms). */
	permissionAskedAt: number | null;
	/** False until the user (or a server seed) has set anything here. */
	customized: boolean;
	/** When the hour was last changed by hand in this browser (epoch ms). */
	hourChangedAt: number | null;
}

/** Read the persisted blob; anything missing or malformed falls back to defaults. */
export function parseStoredWebNotifications(raw: string | null): StoredWebNotifications {
	const fallback: StoredWebNotifications = {
		settings: DEFAULT_WEB_NOTIFICATION_SETTINGS,
		permissionAskedAt: null,
		customized: false,
		hourChangedAt: null,
	};
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown> | null;
		if (!parsed || typeof parsed !== "object") return fallback;
		const hour = parsed.hour;
		return {
			settings: {
				enabled:
					typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_WEB_NOTIFICATION_SETTINGS.enabled,
				hour:
					typeof hour === "number" && hour >= 0 && hour <= 23
						? Math.floor(hour)
						: DEFAULT_WEB_NOTIFICATION_SETTINGS.hour,
				chatReplies:
					typeof parsed.chatReplies === "boolean"
						? parsed.chatReplies
						: DEFAULT_WEB_NOTIFICATION_SETTINGS.chatReplies,
			},
			permissionAskedAt: typeof parsed.permissionAskedAt === "number" ? parsed.permissionAskedAt : null,
			customized: parsed.customized === true,
			hourChangedAt: typeof parsed.hourChangedAt === "number" ? parsed.hourChangedAt : null,
		};
	} catch {
		return fallback;
	}
}

export function serializeWebNotifications(stored: StoredWebNotifications): string {
	return JSON.stringify({
		...stored.settings,
		permissionAskedAt: stored.permissionAskedAt,
		customized: stored.customized,
		hourChangedAt: stored.hourChangedAt,
	});
}

/**
 * The hour this browser should register with, given the newest phone
 * registration. The morning cron follows whichever device registered last, and
 * every browser visit re-registers, so a browser sending its own stale hour
 * would quietly move the phone's morning verse. The phone's hour wins whenever
 * its row is newer than this browser's last hand-made change, which is the
 * same "last touched device wins" rule the cron applies between two phones.
 */
export function adoptPhoneHour(input: {
	hour: number;
	hourChangedAt: number | null;
	seed: { notifyHour: number; updatedAt: string | null } | null;
}): number {
	const { hour, hourChangedAt, seed } = input;
	if (!seed || seed.notifyHour === hour) return hour;
	const seedTime = seed.updatedAt ? Date.parse(seed.updatedAt) : NaN;
	if (!Number.isFinite(seedTime)) return hourChangedAt === null ? seed.notifyHour : hour;
	return seedTime > (hourChangedAt ?? 0) ? seed.notifyHour : hour;
}

/** One more or one fewer hour on the stepper, wrapping around midnight like Android. */
export function stepHour(hour: number, delta: 1 | -1): number {
	return (hour + delta + 24) % 24;
}

/** "8:00 AM", "12:00 PM": Android's formatHour label for the stepper. */
export function formatNotifyHour(hour: number): string {
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	return `${twelve}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/** The browser stays subscribed while either stream is wanted, like the native token. */
export function wantsPushRegistration(settings: WebNotificationSettings): boolean {
	return settings.enabled || settings.chatReplies;
}

export type WebPermissionTrigger = "first-answer" | "cross-visit" | "settings-enabled";

/**
 * Whether to ask for notification permission now. Same rules as Android's
 * shouldRequestPermission: an explicit Settings toggle always asks; a passive
 * moment (first answer, Cross visit) asks at most once per browser and only
 * while some notification is wanted. The browser stops showing its dialog
 * once the user has decided, which is Android's `canAskAgain: false`.
 */
export function shouldRequestWebPermission(input: {
	settings: WebNotificationSettings;
	asked: boolean;
	permission: NotificationPermission | "unsupported";
	trigger: WebPermissionTrigger;
}): boolean {
	const { settings, asked, permission, trigger } = input;
	if (permission === "unsupported" || permission === "granted") return false;
	if (trigger === "settings-enabled") return permission === "default";
	if (!settings.enabled && !settings.chatReplies) return false;
	if (asked) return false;
	return permission === "default";
}

/**
 * A local "answer is ready" notification covers the tab that stayed connected
 * but out of view. A visible tab needs nothing, and a closed or disconnected
 * one is the server push's job, so the two never both fire.
 */
export function shouldNotifyAnswerLocally(input: {
	visibility: DocumentVisibilityState | "unknown";
	permission: NotificationPermission | "unsupported";
	chatReplies: boolean;
}): boolean {
	return input.visibility === "hidden" && input.permission === "granted" && input.chatReplies;
}

/** The VAPID public key (base64url) as the bytes PushManager.subscribe expects. */
export function vapidKeyToBytes(base64Url: string): Uint8Array {
	const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** Whether an existing subscription was made with this VAPID key (a rotated key needs a new one). */
export function sameKeyBytes(a: ArrayBuffer | Uint8Array | null | undefined, b: Uint8Array): boolean {
	if (!a) return false;
	const left = a instanceof Uint8Array ? a : new Uint8Array(a);
	if (left.length !== b.length) return false;
	return left.every((byte, index) => byte === b[index]);
}
