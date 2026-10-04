"use client";

import { useSyncExternalStore } from "react";
import { webPushTapUrl } from "@/lib/push-routing";
import {
	adoptPhoneHour,
	DEFAULT_WEB_NOTIFICATION_SETTINGS,
	parseStoredWebNotifications,
	sameKeyBytes,
	serializeWebNotifications,
	shouldNotifyAnswerLocally,
	shouldRequestWebPermission,
	vapidKeyToBytes,
	wantsPushRegistration,
	type StoredWebNotifications,
	type WebNotificationSettings,
	type WebPermissionTrigger,
} from "@/lib/web-notification-rules";

/**
 * Browser notifications, the web half of Android's notification settings:
 * the same two streams (the morning verse and "your answer is ready"), stored
 * per browser like Android stores them per device, delivered by Web Push to a
 * subscription registered with /api/push-tokens as platform "web".
 *
 * Push needs the PWA service worker (next-pwa, disabled in `next dev`) and
 * VAPID keys on the server; without either, the Settings section says
 * notifications are unavailable and nothing else changes.
 */

const STORAGE_KEY = "sureword.notifications.v1";

/**
 * Fired on window when the in-tab "answer is ready" notification is clicked.
 * A listener that routes in-app calls preventDefault(); otherwise the page
 * navigates to the conversation with a full load.
 */
export const OPEN_CONVERSATION_EVENT = "sureword:open-conversation";

export type WebPushAvailability =
	| { status: "checking" }
	| { status: "unsupported" }
	| { status: "unavailable" }
	| { status: "ready"; publicKey: string };

type ConfigResponse =
	| { status: "unavailable" }
	| {
			status: "ready";
			publicKey: string;
			seed: { notifyHour: number; enabled: boolean; chatReplies: boolean; updatedAt: string | null } | null;
	  };

let stored: StoredWebNotifications = {
	settings: DEFAULT_WEB_NOTIFICATION_SETTINGS,
	permissionAskedAt: null,
	customized: false,
	hourChangedAt: null,
};
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): string | null {
	try {
		return window.localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStorage() {
	try {
		window.localStorage.setItem(STORAGE_KEY, serializeWebNotifications(stored));
	} catch {
		// Private windows and blocked storage keep the in-memory value.
	}
}

function hydrate() {
	if (hydrated || typeof window === "undefined") return;
	hydrated = true;
	stored = parseStoredWebNotifications(readStorage());
}

function update(next: Partial<StoredWebNotifications>) {
	hydrate();
	stored = { ...stored, ...next };
	writeStorage();
	listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
	hydrate();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Reactive preferences for the Settings section. */
export function useWebNotificationSettings(): WebNotificationSettings {
	return useSyncExternalStore(
		subscribe,
		() => {
			hydrate();
			return stored.settings;
		},
		() => DEFAULT_WEB_NOTIFICATION_SETTINGS
	);
}

export function getWebNotificationSettings(): WebNotificationSettings {
	hydrate();
	return stored.settings;
}

/** Whether this browser can do push at all (Notification, service worker, PushManager). */
export function browserSupportsPush(): boolean {
	return (
		typeof window !== "undefined" &&
		"Notification" in window &&
		"serviceWorker" in navigator &&
		"PushManager" in window
	);
}

export function notificationPermission(): NotificationPermission | "unsupported" {
	if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
	return Notification.permission;
}

/** How long a first visit waits for next-pwa to finish registering sw.js. */
const WORKER_WAIT_MS = 4000;

/**
 * The PWA service worker. With `register`, a missing worker is registered and
 * waited on briefly; without it, only an existing one is returned. Null in
 * `next dev` (next-pwa is disabled there) or when registration failed.
 *
 * Registration waits until notifications are actually granted: the worker
 * precaches every chunk of the build, which a reader who never asked for
 * notifications should not pay for on each deploy.
 */
async function workerRegistration(register = false): Promise<ServiceWorkerRegistration | null> {
	const existing = await navigator.serviceWorker.getRegistration();
	if (existing) return existing;
	if (!register) return null;
	// next-pwa's `register: true` only injects into the Pages Router's main
	// bundle, which App Router pages never load, so nothing else registers
	// sw.js. Production only: next-pwa is disabled in dev and a stale sw.js
	// left in public/ would start caching the dev server.
	if (process.env.NODE_ENV !== "production") return null;
	try {
		await navigator.serviceWorker.register("/sw.js", { scope: "/" });
	} catch {
		return null;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), WORKER_WAIT_MS);
	});
	try {
		return await Promise.race([navigator.serviceWorker.ready, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

let configPromise: Promise<ConfigResponse> | null = null;

function loadConfig(): Promise<ConfigResponse> {
	configPromise ??= fetch("/api/push-tokens", { cache: "no-store" })
		.then(async (response) => {
			if (!response.ok) throw new Error(`push config ${response.status}`);
			return (await response.json()) as ConfigResponse;
		})
		.catch((error: unknown) => {
			configPromise = null;
			throw error;
		});
	return configPromise;
}

/**
 * Whether push can work here: the browser, the server's VAPID keys, and a
 * production build (the service worker is registered later, once permission
 * is granted). A first visit also adopts the
 * person's phone settings (see GET /api/push-tokens) so the browser does not
 * move their morning hour.
 */
export async function checkWebPushAvailability(): Promise<WebPushAvailability> {
	if (!browserSupportsPush()) return { status: "unsupported" };
	try {
		const config = await loadConfig();
		if (config.status !== "ready") return { status: "unavailable" };
		if (process.env.NODE_ENV !== "production") return { status: "unavailable" };
		hydrate();
		if (!stored.customized && config.seed) {
			update({
				settings: {
					enabled: config.seed.enabled,
					hour: config.seed.notifyHour,
					chatReplies: config.seed.chatReplies,
				},
				customized: true,
			});
		}
		const hour = adoptPhoneHour({
			hour: stored.settings.hour,
			hourChangedAt: stored.hourChangedAt,
			seed: config.seed,
		});
		if (hour !== stored.settings.hour) update({ settings: { ...stored.settings, hour } });
		return { status: "ready", publicKey: config.publicKey };
	} catch {
		return { status: "unavailable" };
	}
}

function timezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

async function currentSubscription(): Promise<PushSubscription | null> {
	const registration = await workerRegistration();
	return registration ? registration.pushManager.getSubscription() : null;
}

async function unregister(subscription: PushSubscription | null): Promise<void> {
	if (!subscription) return;
	await fetch("/api/push-tokens", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: subscription.endpoint }),
	}).catch(() => undefined);
	await subscription.unsubscribe().catch(() => false);
}

let syncChain: Promise<unknown> = Promise.resolve();

/**
 * Drop this browser's subscription when nobody is signed in. Runs after
 * sign-out, when the server DELETE can no longer authenticate, so it only
 * unsubscribes locally: the push service then rejects the endpoint and the
 * next send prunes the row (404/410). Without it a shared computer would keep
 * receiving the last account's verses and answer previews.
 */
export async function releaseWebPushSubscription(): Promise<void> {
	if (!browserSupportsPush()) return;
	try {
		const subscription = await currentSubscription();
		await subscription?.unsubscribe();
	} catch {
		// Nothing to release, or the browser refused; the server prunes either way.
	}
}

/**
 * Bring this browser's server registration in line with its preferences:
 * subscribed and registered while either stream is wanted and permission is
 * granted, unregistered when both are off. Safe to call on every visit; each
 * registration refreshes the row the cron reads. Calls run one at a time so a
 * quick double toggle cannot leave a stale subscription behind.
 */
export function syncWebPushRegistration(): Promise<void> {
	const run = syncChain.then(() => syncOnce()).catch(() => undefined);
	syncChain = run;
	return run;
}

async function syncOnce(): Promise<void> {
	const availability = await checkWebPushAvailability();
	if (availability.status !== "ready") return;
	const settings = getWebNotificationSettings();
	const existing = await currentSubscription();

	if (!wantsPushRegistration(settings)) {
		await unregister(existing);
		return;
	}
	if (Notification.permission !== "granted") return;

	const registration = await workerRegistration(true);
	if (!registration) return;
	const key = vapidKeyToBytes(availability.publicKey);
	let subscription = existing;
	if (subscription && !sameKeyBytes(subscription.options.applicationServerKey, key)) {
		// The server's VAPID key changed; a subscription made with the old one
		// can never be sent to again.
		await unregister(subscription);
		subscription = null;
	}
	subscription ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: key as BufferSource,
	});

	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
	await fetch("/api/push-tokens", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: json.endpoint,
			platform: "web",
			keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
			timezone: timezone(),
			notifyHour: settings.hour,
			enabled: settings.enabled,
			chatReplies: settings.chatReplies,
		}),
	});
}

let asking = false;

/**
 * Ask for permission when the moment calls for it (see
 * shouldRequestWebPermission) and register on a grant. Must run inside a user
 * gesture: browsers ignore or quietly block permission requests without one.
 * Resolves to the permission afterwards.
 */
export async function requestWebNotificationPermission(
	trigger: WebPermissionTrigger
): Promise<NotificationPermission | "unsupported"> {
	const permission = notificationPermission();
	if (permission === "unsupported" || asking) return permission;
	hydrate();
	const ask = shouldRequestWebPermission({
		settings: stored.settings,
		asked: stored.permissionAskedAt !== null,
		permission,
		trigger,
	});
	if (!ask) {
		if (permission === "granted") void syncWebPushRegistration();
		return permission;
	}
	asking = true;
	// Recorded before the dialog opens, so two triggers racing cannot both ask.
	update({ permissionAskedAt: Date.now() });
	try {
		const result = await Notification.requestPermission();
		if (result === "granted") await syncWebPushRegistration();
		return result;
	} catch {
		return notificationPermission();
	} finally {
		asking = false;
	}
}

/** Whether a passive moment (first answer, Cross visit) would ask right now. */
export function wouldAskForPermission(trigger: WebPermissionTrigger): boolean {
	hydrate();
	return shouldRequestWebPermission({
		settings: stored.settings,
		asked: stored.permissionAskedAt !== null,
		permission: notificationPermission(),
		trigger,
	});
}

/** "Not now" on a passive ask counts as the once-per-browser ask. */
export function dismissPermissionAsk(): void {
	update({ permissionAskedAt: Date.now() });
}

// Settings is the only caller of these setters, so switching a stream on is
// an explicit request and asks for permission right away (inside the click).
// Each resolves once the permission dialog and registration have settled.
export function setWebVerseOfDayEnabled(enabled: boolean): Promise<unknown> {
	const switchedOn = enabled && !getWebNotificationSettings().enabled;
	update({ settings: { ...getWebNotificationSettings(), enabled }, customized: true });
	return switchedOn
		? requestWebNotificationPermission("settings-enabled")
		: syncWebPushRegistration();
}

export function setWebChatRepliesEnabled(chatReplies: boolean): Promise<unknown> {
	const switchedOn = chatReplies && !getWebNotificationSettings().chatReplies;
	update({ settings: { ...getWebNotificationSettings(), chatReplies }, customized: true });
	return switchedOn
		? requestWebNotificationPermission("settings-enabled")
		: syncWebPushRegistration();
}

export function setWebVerseOfDayHour(hour: number): void {
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
	update({ settings: { ...getWebNotificationSettings(), hour }, customized: true, hourChangedAt: Date.now() });
	void syncWebPushRegistration();
}

function openConversation(conversationId: string) {
	window.focus();
	const event = new CustomEvent(OPEN_CONVERSATION_EVENT, {
		detail: { conversationId },
		cancelable: true,
	});
	if (window.dispatchEvent(event)) {
		window.location.assign(webPushTapUrl({ screen: "chat", conversationId }));
	}
}

/**
 * A local "Your answer is ready" for a tab that stayed connected while out of
 * view; the server only pushes when the stream lost its client, so the two do
 * not overlap. Same tag as the server push, so even a race replaces rather
 * than stacks. A click focuses the tab and opens the conversation.
 */
export function notifyAnswerReady(opts: { conversationId: string; title?: string }): void {
	if (typeof document === "undefined" || !opts.conversationId) return;
	if (
		!shouldNotifyAnswerLocally({
			visibility: document.visibilityState,
			permission: notificationPermission(),
			chatReplies: getWebNotificationSettings().chatReplies,
		})
	) {
		return;
	}
	const title = "Your answer is ready";
	const options: NotificationOptions = {
		body: opts.title?.trim() || "Tap to read it in SureWord.",
		tag: `chat-${opts.conversationId}`,
		icon: "/icon-192.png",
	};
	try {
		const notification = new Notification(title, options);
		notification.onclick = () => {
			notification.close();
			openConversation(opts.conversationId);
		};
	} catch {
		// Android Chrome only shows notifications through the service worker;
		// its click handler opens the same conversation URL.
		void navigator.serviceWorker
			?.getRegistration()
			.then((registration) =>
				registration?.showNotification(title, {
					...options,
					data: { url: webPushTapUrl({ screen: "chat", conversationId: opts.conversationId }) },
				})
			)
			.catch(() => undefined);
	}
}
