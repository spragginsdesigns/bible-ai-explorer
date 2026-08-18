import { useEffect } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { openReferenceInReader } from "@/features/chat/verseLinks";
import { registerPushToken, unregisterPushToken } from "./api";
import { useNotificationSettings } from "./notificationSettings";

const ANDROID_CHANNEL_ID = "verse-of-day";
/**
 * Remembers that this device registered a push token with the backend. When a
 * later launch can't reach the registration endpoint (offline, transient
 * failure) the local fallback must NOT be re-armed — the server still pushes,
 * and both firing is the duplicate-notification bug.
 */
const REMOTE_LIVE_KEY = "sureword.notifications.remoteLive";

// A verse arriving while the app is open still surfaces as a banner rather
// than vanishing into the tray.
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldPlaySound: false,
		shouldSetBadge: false,
		shouldShowBanner: true,
		shouldShowList: true,
	}),
});

/**
 * Expo push tokens are issued against an EAS project. This app prebuilds
 * locally (no eas init yet), so until `extra.eas.projectId` lands in app.json
 * there is no projectId and token retrieval throws — the registration effect
 * below treats that as "push unavailable" and moves on.
 */
function resolveProjectId(): string | undefined {
	const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
	if (typeof extra?.eas?.projectId === "string" && extra.eas.projectId) {
		return extra.eas.projectId;
	}
	const fromEasConfig = (Constants.easConfig as { projectId?: unknown } | null)?.projectId;
	return typeof fromEasConfig === "string" && fromEasConfig ? fromEasConfig : undefined;
}

/**
 * This app only ever schedules the verse-of-the-day local notification, so
 * cancelling everything is equivalent to cancelling that one — and it also
 * sweeps up stale copies a by-id cancel could miss.
 */
function cancelAllScheduled(): Promise<void> {
	return Notifications.cancelAllScheduledNotificationsAsync();
}

function asInt(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Verse-of-the-day wiring, mounted once in the (app) layout:
 *
 * - Registers this device's Expo push token with the backend (with the local
 *   timezone and chosen hour) on startup and whenever the setting changes;
 *   disabling the setting unregisters instead.
 * - Tapping a notification deep-links into the Bible reader at the verse.
 *
 * Everything is best-effort: permission denial, a missing EAS projectId, and
 * network failures are all swallowed — push must never break app startup.
 */
export function useVerseOfDayNotifications(): void {
	const router = useRouter();
	const getToken = useStableGetToken();
	const { enabled, hour } = useNotificationSettings();

	// Tap → the "Pick Up Your Cross" screen (the guided day). Older
	// notifications that carry only a verse reference fall back to the reader.
	useEffect(() => {
		const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
			const data = response.notification.request.content.data as {
				screen?: unknown;
				book?: unknown;
				chapter?: unknown;
				verse?: unknown;
			};
			if (data.screen === "cross") {
				router.push("/cross");
				return;
			}
			const chapter = asInt(data.chapter);
			const verse = asInt(data.verse);
			if (typeof data.book !== "string" || chapter === null || verse === null) return;
			openReferenceInReader(router, `${data.book} ${chapter}:${verse}`);
		});
		return () => subscription.remove();
	}, [router]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				if (!Device.isDevice) return; // Emulators can't receive pushes.

				if (Platform.OS === "android") {
					await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
						name: "Pick Up Your Cross",
						importance: Notifications.AndroidImportance.DEFAULT,
					});
				}

				if (!enabled) {
					await AsyncStorage.removeItem(REMOTE_LIVE_KEY).catch(() => {});
					await cancelAllScheduled().catch(() => {});
					// Best-effort remote unregister — token retrieval itself may be
					// unavailable (no EAS projectId yet), which is fine.
					try {
						const projectId = resolveProjectId();
						const { data: pushToken } = await Notifications.getExpoPushTokenAsync(
							projectId ? { projectId } : undefined
						);
						await unregisterPushToken(getToken, pushToken).catch(() => {});
					} catch {
						// No token to unregister.
					}
					return;
				}

				let granted = (await Notifications.getPermissionsAsync()).granted;
				if (!granted) {
					granted = (await Notifications.requestPermissionsAsync()).granted;
				}
				if (!granted || cancelled) return;

				// Remote push first: it can carry the personalized verse in the
				// notification itself. Needs an Expo push token (EAS projectId /
				// FCM); if that fails, fall back to a locally scheduled daily.
				try {
					const projectId = resolveProjectId();
					const { data: pushToken } = await Notifications.getExpoPushTokenAsync(
						projectId ? { projectId } : undefined
					);
					if (cancelled) return;
					const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
					await registerPushToken(getToken, {
						token: pushToken,
						platform: Platform.OS === "ios" ? "ios" : "android",
						timezone,
						notifyHour: hour,
					});
					// Remote delivery is live; a local daily would duplicate it.
					await AsyncStorage.setItem(REMOTE_LIVE_KEY, "1").catch(() => {});
					await cancelAllScheduled().catch(() => {});
					return;
				} catch {
					// Fall through to the local daily notification.
				}
				if (cancelled) return;

				// A transient failure (offline launch, Expo API hiccup) must not
				// re-arm the local daily while the server still holds this
				// device's token — that is how both notifications fire at once.
				const remoteLive = await AsyncStorage.getItem(REMOTE_LIVE_KEY).catch(() => null);
				if (remoteLive === "1") {
					await cancelAllScheduled().catch(() => {});
					return;
				}

				// Local fallback: a scheduled daily notification at the chosen hour.
				// It cannot carry the verse (that is generated server-side), so it
				// invites; tapping opens the Daily Cross screen, which fetches (or
				// generates) today's guided day.
				await cancelAllScheduled().catch(() => {});
				await Notifications.scheduleNotificationAsync({
					content: {
						title: "✝ Pick up your cross",
						body: "Your word for today is ready.",
						data: { screen: "cross" },
					},
					trigger: {
						type: Notifications.SchedulableTriggerInputTypes.DAILY,
						hour,
						minute: 0,
						channelId: Platform.OS === "android" ? ANDROID_CHANNEL_ID : undefined,
					},
				});
			} catch {
				// Push setup is best-effort; never break app startup over it.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [enabled, hour, getToken]);
}
