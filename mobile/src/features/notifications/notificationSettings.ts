import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Verse-of-the-day notification preferences, modeled on settingsStore: a
 * module-level snapshot exposed through useSyncExternalStore, hydrated from /
 * persisted to AsyncStorage. The push-token registration effect in
 * useVerseOfDayNotifications subscribes through the hook so a change here
 * re-registers (or unregisters) the device with the backend.
 */

export interface NotificationSettings {
	enabled: boolean;
	/** Local hour the morning verse should arrive, 0-23. */
	hour: number;
}

const STORAGE_KEY = "sureword.notifications.v1";

const DEFAULT_SETTINGS: NotificationSettings = {
	enabled: true,
	hour: 8,
};

let snapshot: NotificationSettings = DEFAULT_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function setSnapshot(next: NotificationSettings) {
	snapshot = next;
	persist();
	listeners.forEach((listener) => listener());
}

function persist() {
	AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => {});
}

/** Load the saved preferences once at startup (root layout holds the splash). */
export async function hydrateNotificationSettings(): Promise<void> {
	if (hydrated) return;
	hydrated = true;
	try {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
		snapshot = {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
			hour:
				typeof parsed.hour === "number" && parsed.hour >= 0 && parsed.hour <= 23
					? Math.floor(parsed.hour)
					: DEFAULT_SETTINGS.hour,
		};
	} catch {
		// A corrupt or unreadable store falls back to defaults.
	}
}

export function setVerseOfDayEnabled(enabled: boolean) {
	setSnapshot({ ...snapshot, enabled });
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
