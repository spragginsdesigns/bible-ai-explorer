import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { openReferenceInReader } from "@/features/chat/verseLinks";
import { registerPushToken, unregisterPushToken } from "./api";
import { useNotificationSettings } from "./notificationSettings";

const ANDROID_CHANNEL_ID = "verse-of-day";
/** Stable id for the locally scheduled daily notification, so reschedules replace it. */
const LOCAL_NOTIFICATION_ID = "daily-cross";

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
					await Notifications.cancelScheduledNotificationAsync(LOCAL_NOTIFICATION_ID).catch(
						() => {}
					);
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
				// notification itself. Requires an EAS projectId (and FCM on
				// Android), which this locally-prebuilt app does not have yet —
				// so failure here is the NORMAL path today.
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
					await Notifications.cancelScheduledNotificationAsync(LOCAL_NOTIFICATION_ID).catch(
						() => {}
					);
					return;
				} catch {
					// Fall through to the local daily notification.
				}
				if (cancelled) return;

				// Local fallback: a scheduled daily notification at the chosen hour.
				// It cannot carry the verse (that is generated server-side), so it
				// invites; tapping opens the Daily Cross screen, which fetches (or
				// generates) today's guided day.
				await Notifications.cancelScheduledNotificationAsync(LOCAL_NOTIFICATION_ID).catch(
					() => {}
				);
				await Notifications.scheduleNotificationAsync({
					identifier: LOCAL_NOTIFICATION_ID,
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
