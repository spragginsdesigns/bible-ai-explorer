import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signalNotificationPermissionMoment } from "./permissionPrompt";

/**
 * Verse-of-the-day notification preferences, modeled on settingsStore: a
 * module-level snapshot exposed through useSyncExternalStore, hydrated from /
 * persisted to AsyncStorage. The push-token registration effect in
 * usePushNotifications subscribes through the hook so a change here
 * re-registers (or unregisters) the device with the backend.
 */

export interface NotificationSettings {
	enabled: boolean;
	/** Local hour the morning verse should arrive, 0-23. */
	hour: number;
	/**
	 * Notify when a chat answer finishes after this device dropped off the
	 * stream (app backgrounded, screen locked). Independent of `enabled` - the
	 * device stays registered for push either way.
	 */
	chatReplies: boolean;
}

const STORAGE_KEY = "sureword.notifications.v1";

const DEFAULT_SETTINGS: NotificationSettings = {
	enabled: true,
	hour: 8,
	chatReplies: true,
};

let snapshot: NotificationSettings = DEFAULT_SETTINGS;
/**
 * When this install last showed the OS permission dialog (epoch ms). Kept out
 * of NotificationSettings because it is device state, not a preference, but
 * persisted in the same blob so it hydrates with the settings before the
 * (app) layout mounts.
 */
let permissionAskedAt: number | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function setSnapshot(next: NotificationSettings) {
	snapshot = next;
	persist();
	listeners.forEach((listener) => listener());
}

function persist() {
	AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, permissionAskedAt })).catch(
		() => {}
	);
}

/** Load the saved preferences once at startup (root layout holds the splash). */
export async function hydrateNotificationSettings(): Promise<void> {
	if (hydrated) return;
	hydrated = true;
	try {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<NotificationSettings> & {
			permissionAskedAt?: unknown;
		};
		permissionAskedAt =
			typeof parsed.permissionAskedAt === "number" ? parsed.permissionAskedAt : null;
		snapshot = {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
			hour:
				typeof parsed.hour === "number" && parsed.hour >= 0 && parsed.hour <= 23
					? Math.floor(parsed.hour)
					: DEFAULT_SETTINGS.hour,
			chatReplies:
				typeof parsed.chatReplies === "boolean"
					? parsed.chatReplies
					: DEFAULT_SETTINGS.chatReplies,
		};
	} catch {
		// A corrupt or unreadable store falls back to defaults.
	}
}

// Settings is the only caller of these two setters, so switching one on is an
// explicit request for notifications and asks for permission right away.
export function setVerseOfDayEnabled(enabled: boolean) {
	const switchedOn = enabled && !snapshot.enabled;
	setSnapshot({ ...snapshot, enabled });
	if (switchedOn) signalNotificationPermissionMoment("settings-enabled");
}

export function setChatRepliesEnabled(chatReplies: boolean) {
	const switchedOn = chatReplies && !snapshot.chatReplies;
	setSnapshot({ ...snapshot, chatReplies });
	if (switchedOn) signalNotificationPermissionMoment("settings-enabled");
}

export function setVerseOfDayHour(hour: number) {
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
	setSnapshot({ ...snapshot, hour });
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useNotificationSettings(): NotificationSettings {
	return useSyncExternalStore(subscribe, () => snapshot);
}

/** Non-reactive read of the current preferences, for one-shot request bodies. */
export function getNotificationSettings(): NotificationSettings {
	return snapshot;
}

export function hasAskedNotificationPermission(): boolean {
	return permissionAskedAt !== null;
}

/** Recorded before the dialog opens, so two triggers racing cannot both ask. */
export function markNotificationPermissionAsked(): void {
	permissionAskedAt = Date.now();
	persist();
}
