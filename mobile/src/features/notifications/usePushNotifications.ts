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
import { wasConversationStopped } from "./chatStopSignals";
import { useNotificationSettings } from "./notificationSettings";
import { notificationTapTarget } from "./tapTarget";

// HIGH-importance channel so the morning word arrives as a heads-up banner.
// Android ignores in-place importance upgrades on an existing channel, so the
// original DEFAULT-importance "verse-of-day" channel had to be replaced, not
// edited — the server cron sends this channelId, and the legacy channel is
// deleted below. (Pushes that name a channel an old install lacks fall back to
// a default channel and still display.)
const ANDROID_CHANNEL_ID = "daily-cross";
const LEGACY_ANDROID_CHANNEL_ID = "verse-of-day";
/**
 * "Your answer is ready" - a chat answer that finished after this device fell
 * off the stream. Its own channel so the user can silence chat replies from
 * Android settings without losing the morning verse.
 */
const CHAT_REPLY_CHANNEL_ID = "chat-replies";
/**
 * Remembers that this device registered a push token with the backend. When a
 * later launch can't reach the registration endpoint (offline, transient
 * failure) the local fallback must NOT be re-armed — the server still pushes,
 * and both firing is the duplicate-notification bug.
 */
const REMOTE_LIVE_KEY = "sureword.notifications.remoteLive";

// A verse arriving while the app is open still surfaces as a banner rather
// than vanishing into the tray. The exception is a chat answer this device
// deliberately walked away from: the server cannot tell "the user pressed
// stop" from "the app went to the background", so it notifies for both and
// the client drops the ones it knows were unwanted.
Notifications.setNotificationHandler({
	handleNotification: async (notification) => {
		const data = notification.request.content.data ?? {};
		const target = notificationTapTarget(data);
		const unwanted =
			target !== null &&
			"screen" in target &&
			target.screen === "chat" &&
			wasConversationStopped(target.conversationId);

		return {
			shouldPlaySound: false,
			shouldSetBadge: false,
			shouldShowBanner: !unwanted,
			shouldShowList: !unwanted,
		};
	},
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

/**
 * The tap that launched the app also surfaces through
 * getLastNotificationResponse, and the live listener can deliver the same
 * response again in some launch paths — this remembers what was already acted
 * on so a tap navigates exactly once per process.
 */
let handledTapId: string | null = null;

/**
 * Push wiring, mounted once in the (app) layout. Two independent streams ride
 * one registration:
 *
 * - The verse of the day, sent by the hourly cron at the user's chosen local
 *   hour, with a locally scheduled daily as the fallback when remote push is
 *   unavailable.
 * - "Your answer is ready", sent when a chat answer finishes after this device
 *   dropped off the stream.
 *
 * The device's Expo push token is registered whenever either stream is wanted;
 * the two preferences travel with the token rather than deciding whether it
 * exists, so silencing one never silences the other. Taps land on the Pick Up
 * Your Cross screen, the conversation the answer belongs to, or (for older
 * reference-only payloads) the Bible reader - including the tap that
 * cold-launched the app.
 *
 * Everything is best-effort: permission denial, a missing EAS projectId, and
 * network failures are all swallowed - push must never break app startup.
 */
export function usePushNotifications(): void {
	const router = useRouter();
	const getToken = useStableGetToken();
	const { enabled, chatReplies, hour } = useNotificationSettings();

	// Tap → the "Pick Up Your Cross" screen (the guided day), or the chat
	// conversation whose answer landed while the app was away. Older
	// notifications that carry only a verse reference fall back to the reader.
	useEffect(() => {
		const handleTap = (response: Notifications.NotificationResponse) => {
			const target = notificationTapTarget(response.notification.request.content.data ?? {});
			if (!target) return;
			if ("reference" in target) {
				openReferenceInReader(router, target.reference);
			} else if (target.screen === "chat") {
				router.push({ pathname: "/", params: { conversationId: target.conversationId } });
			} else {
				router.push("/cross");
			}
		};

		const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
			handledTapId = response.notification.request.identifier;
			handleTap(response);
		});

		// Cold start: the tap that launched the app fired before this listener
		// existed (this layout mounts only after fonts, settings, and auth), so
		// the listener alone loses the morning tap. KNOWN GAP (verified on the
		// S24 Ultra, 2026-08-19): on a killed-state tap this getter returns null
		// and the listener never fires either — the response never reaches JS at
		// all, so the tap opens the app on the default tab. Upstream
		// expo-notifications (SDK 57, new architecture) drops the launching
		// response before the emitter module ever sees it; nothing at this layer
		// can recover it. Kept because it is correct per the API contract and
		// covers devices/launch paths where the response IS delivered.
		const launchResponse = Notifications.getLastNotificationResponse();
		if (launchResponse) {
			const id = launchResponse.notification.request.identifier;
			if (id !== handledTapId) {
				handledTapId = id;
				handleTap(launchResponse);
			}
		}

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
						importance: Notifications.AndroidImportance.HIGH,
						lightColor: "#d97706",
					});
					await Notifications.setNotificationChannelAsync(CHAT_REPLY_CHANNEL_ID, {
						name: "Chat answers",
						importance: Notifications.AndroidImportance.HIGH,
						lightColor: "#d97706",
					});
					await Notifications.deleteNotificationChannelAsync(LEGACY_ANDROID_CHANNEL_ID).catch(
						() => {}
					);
				}

				// The device registers whenever ANY push stream is wanted. It used
				// to unregister when the morning verse was switched off, which also
				// silenced chat answers - the two preferences now travel with the
				// token instead of deciding whether it exists.
				const wantsPush = enabled || chatReplies;

				let granted = (await Notifications.getPermissionsAsync()).granted;
				if (!granted && wantsPush) {
					granted = (await Notifications.requestPermissionsAsync()).granted;
				}
				if (cancelled) return;

				let pushToken: string | null = null;
				if (granted) {
					try {
						const projectId = resolveProjectId();
						pushToken = (
							await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
						).data;
					} catch {
						// No EAS projectId / FCM setup - remote push is unavailable.
					}
				}
				if (cancelled) return;

				if (pushToken && !wantsPush) {
					await AsyncStorage.removeItem(REMOTE_LIVE_KEY).catch(() => {});
					await cancelAllScheduled().catch(() => {});
					await unregisterPushToken(getToken, pushToken).catch(() => {});
					return;
				}

				if (!wantsPush || !granted) {
					await AsyncStorage.removeItem(REMOTE_LIVE_KEY).catch(() => {});
					await cancelAllScheduled().catch(() => {});
					return;
				}

				// Remote push first: it can carry the personalized verse (or the
				// answer preview) in the notification itself.
				if (pushToken) {
					try {
						const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
						await registerPushToken(getToken, {
							token: pushToken,
							platform: Platform.OS === "ios" ? "ios" : "android",
							timezone,
							notifyHour: hour,
							enabled,
							chatReplies,
						});
						if (cancelled) return;
						// Remote delivery is live; a local daily would duplicate it.
						await AsyncStorage.setItem(REMOTE_LIVE_KEY, "1").catch(() => {});
						await cancelAllScheduled().catch(() => {});
						return;
					} catch {
						// Fall through to the local daily notification.
					}
				}
				if (cancelled) return;

				// Chat answers can only arrive by remote push. Everything below is
				// the verse-of-the-day fallback.
				if (!enabled) {
					await cancelAllScheduled().catch(() => {});
					return;
				}

				// A transient failure (offline launch, Expo API hiccup) must not
				// re-arm the local daily while the server still holds this
				// device's token - that is how both notifications fire at once.
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
	}, [enabled, chatReplies, hour, getToken]);
}
