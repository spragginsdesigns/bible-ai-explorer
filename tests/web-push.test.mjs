import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	buildWebPushPayload,
	isAllowedWebPushEndpoint,
	isExpoPushToken,
	isGoneWebPushStatus,
	recipientFromRow,
	splitRecipients,
	webPushTapUrl,
} from "../src/lib/push-routing.ts";
import {
	DEFAULT_WEB_NOTIFICATION_SETTINGS,
	formatNotifyHour,
	parseStoredWebNotifications,
	sameKeyBytes,
	serializeWebNotifications,
	shouldNotifyAnswerLocally,
	shouldRequestWebPermission,
	stepHour,
	vapidKeyToBytes,
	wantsPushRegistration,
	adoptPhoneHour,
} from "../src/lib/web-notification-rules.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const EXPO = "ExponentPushToken[abc123]";
const FCM = "https://fcm.googleapis.com/fcm/send/xyz";
const KEYS = { p256dh: "BP256", auth: "AUTH" };

test("Expo token shape is recognised and browser endpoints are not", () => {
	assert.equal(isExpoPushToken(EXPO), true);
	assert.equal(isExpoPushToken("ExpoPushToken[abc]"), true);
	assert.equal(isExpoPushToken(FCM), false);
	assert.equal(isExpoPushToken("ExponentPushToken[]"), false);
});

test("only known push services are accepted as web endpoints", () => {
	assert.equal(isAllowedWebPushEndpoint(FCM), true);
	assert.equal(isAllowedWebPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/a"), true);
	assert.equal(isAllowedWebPushEndpoint("https://web.push.apple.com/QH"), true);
	assert.equal(isAllowedWebPushEndpoint("https://wns2-by3p.notify.windows.com/w/?token=a"), true);
	assert.equal(isAllowedWebPushEndpoint("http://fcm.googleapis.com/fcm/send/x"), false);
	assert.equal(isAllowedWebPushEndpoint("https://evil.example/fcm.googleapis.com"), false);
	assert.equal(isAllowedWebPushEndpoint("https://fcm.googleapis.com.evil.example/x"), false);
	assert.equal(isAllowedWebPushEndpoint("https://fcm.googleapis.com:8443/x"), false);
	assert.equal(isAllowedWebPushEndpoint("https://user:pw@fcm.googleapis.com/x"), false);
	assert.equal(isAllowedWebPushEndpoint("not a url"), false);
});

test("rows become recipients; only complete web rows keep keys", () => {
	assert.deepEqual(recipientFromRow({ id: "a", token: EXPO, platform: "android" }), { tokenId: "a", to: EXPO });
	assert.deepEqual(
		recipientFromRow({ id: "w", token: FCM, platform: "web", webP256dh: "BP256", webAuth: "AUTH" }),
		{ tokenId: "w", to: FCM, webKeys: KEYS }
	);
	assert.deepEqual(
		recipientFromRow({ id: "w", token: FCM, platform: "web", webP256dh: "BP256", webAuth: null }),
		{ tokenId: "w", to: FCM }
	);
	// Keys on a non-web row are ignored.
	assert.deepEqual(
		recipientFromRow({ id: "a", token: EXPO, platform: "android", webP256dh: "x", webAuth: "y" }),
		{ tokenId: "a", to: EXPO }
	);
});

test("splitRecipients routes by transport, dedupes, and keeps junk out of Expo", () => {
	const { expo, web, dropped } = splitRecipients([
		{ tokenId: "1", to: EXPO },
		{ tokenId: "2", to: FCM, webKeys: KEYS },
		{ tokenId: "3", to: EXPO },
		{ tokenId: "4", to: FCM }, // web row missing keys
		{ tokenId: "5", to: "https://attacker.example/push", webKeys: KEYS },
	]);
	assert.deepEqual(expo, [{ tokenId: "1", to: EXPO }]);
	assert.deepEqual(web, [{ tokenId: "2", endpoint: FCM, keys: KEYS }]);
	assert.equal(dropped, 1);
});

test("tap URLs mirror the native tap targets", () => {
	assert.equal(webPushTapUrl({ screen: "cross", book: "John", chapter: 3, verse: 16 }), "/cross");
	assert.equal(webPushTapUrl({ screen: "chat", conversationId: "c 1" }), "/?conversationId=c%201");
	assert.equal(webPushTapUrl({ screen: "chat" }), "/");
	assert.equal(webPushTapUrl({ type: "sermon-watchdog" }), "/");
});

test("web payload keeps the Expo title, body and data with a tap URL and tag", () => {
	const cross = buildWebPushPayload({
		title: "✝ Pick up your cross",
		body: "“For God so loved the world” - John 3:16",
		data: { screen: "cross", book: "John", chapter: 3, verse: 16 },
	});
	assert.deepEqual(cross, {
		title: "✝ Pick up your cross",
		body: "“For God so loved the world” - John 3:16",
		url: "/cross",
		tag: "daily-cross",
		data: { screen: "cross", book: "John", chapter: 3, verse: 16 },
	});
	const chat = buildWebPushPayload({
		title: "Your answer is ready",
		body: "Grace is",
		data: { screen: "chat", conversationId: "abc" },
	});
	assert.equal(chat.url, "/?conversationId=abc");
	assert.equal(chat.tag, "chat-abc");
});

test("404 and 410 retire a subscription; other failures do not", () => {
	assert.equal(isGoneWebPushStatus(404), true);
	assert.equal(isGoneWebPushStatus(410), true);
	assert.equal(isGoneWebPushStatus(429), false);
	assert.equal(isGoneWebPushStatus(500), false);
	assert.equal(isGoneWebPushStatus(undefined), false);
});

test("defaults match Android: daily verse on at 8, answer-ready on", () => {
	assert.deepEqual(DEFAULT_WEB_NOTIFICATION_SETTINGS, { enabled: true, hour: 8, chatReplies: true });
});

test("stored settings parse defensively and round-trip", () => {
	assert.deepEqual(parseStoredWebNotifications(null).settings, DEFAULT_WEB_NOTIFICATION_SETTINGS);
	assert.deepEqual(parseStoredWebNotifications("{bad json").settings, DEFAULT_WEB_NOTIFICATION_SETTINGS);
	const parsed = parseStoredWebNotifications(
		JSON.stringify({ enabled: false, hour: 30, chatReplies: "yes", permissionAskedAt: 5 })
	);
	assert.deepEqual(parsed.settings, { enabled: false, hour: 8, chatReplies: true });
	assert.equal(parsed.permissionAskedAt, 5);
	assert.equal(parsed.customized, false);
	const stored = {
		settings: { enabled: true, hour: 6, chatReplies: false },
		permissionAskedAt: 42,
		customized: true,
		hourChangedAt: 1791100000000,
	};
	assert.deepEqual(parseStoredWebNotifications(serializeWebNotifications(stored)), stored);
});

test("hour stepper wraps and labels like Android's formatHour", () => {
	assert.equal(stepHour(0, -1), 23);
	assert.equal(stepHour(23, 1), 0);
	assert.equal(formatNotifyHour(0), "12:00 AM");
	assert.equal(formatNotifyHour(8), "8:00 AM");
	assert.equal(formatNotifyHour(12), "12:00 PM");
	assert.equal(formatNotifyHour(19), "7:00 PM");
});

test("registration is wanted while either stream is on", () => {
	assert.equal(wantsPushRegistration({ enabled: false, hour: 8, chatReplies: true }), true);
	assert.equal(wantsPushRegistration({ enabled: false, hour: 8, chatReplies: false }), false);
});

test("permission asks follow Android's once-per-install rules", () => {
	const settings = DEFAULT_WEB_NOTIFICATION_SETTINGS;
	const ask = (overrides) =>
		shouldRequestWebPermission({ settings, asked: false, permission: "default", trigger: "cross-visit", ...overrides });
	assert.equal(ask({}), true);
	assert.equal(ask({ asked: true }), false);
	assert.equal(ask({ permission: "granted" }), false);
	assert.equal(ask({ permission: "denied" }), false);
	assert.equal(ask({ permission: "unsupported" }), false);
	assert.equal(ask({ settings: { enabled: false, hour: 8, chatReplies: false } }), false);
	// An explicit Settings toggle ignores the once-per-install cap.
	assert.equal(ask({ trigger: "settings-enabled", asked: true }), true);
	assert.equal(ask({ trigger: "settings-enabled", permission: "denied" }), false);
});

test("a local answer-ready notification needs a hidden tab, permission and the pref", () => {
	const base = { visibility: "hidden", permission: "granted", chatReplies: true };
	assert.equal(shouldNotifyAnswerLocally(base), true);
	assert.equal(shouldNotifyAnswerLocally({ ...base, visibility: "visible" }), false);
	assert.equal(shouldNotifyAnswerLocally({ ...base, permission: "default" }), false);
	assert.equal(shouldNotifyAnswerLocally({ ...base, chatReplies: false }), false);
});

test("VAPID keys decode from base64url and compare by bytes", () => {
	const bytes = vapidKeyToBytes("AQID_-8");
	assert.deepEqual([...bytes], [1, 2, 3, 255, 239]);
	assert.equal(sameKeyBytes(new Uint8Array([1, 2, 3, 255, 239]).buffer, bytes), true);
	assert.equal(sameKeyBytes(new Uint8Array([1, 2, 3]), bytes), false);
	assert.equal(sameKeyBytes(null, bytes), false);
});

test("every push sender routes through the transport split", async () => {
	const cron = await read("src/app/api/cron/verse-of-day/route.ts");
	assert.match(cron, /sendPushMessages\(pending/);
	assert.match(cron, /webP256dh: true/);
	const push = await read("src/lib/push.ts");
	assert.match(push, /splitRecipients\(message\.recipients\)/);
	assert.match(push, /select: PUSH_RECIPIENT_SELECT/);
});

test("the service worker handles push and notificationclick", async () => {
	const worker = await read("public/push-handlers.js");
	assert.match(await read("next.config.mjs"), /importScripts: \["\/push-handlers\.js"\]/);
	assert.match(worker, /addEventListener\("push"/);
	assert.match(worker, /addEventListener\("notificationclick"/);
	assert.match(worker, /openWindow/);
});

test("a browser refresh never moves the phone's morning hour", () => {
	const phoneAt = (iso) => ({ notifyHour: 6, updatedAt: iso });
	const changed = Date.parse("2026-10-04T12:00:00.000Z");
	// Phone changed after the browser's last hand-made change: follow it.
	assert.equal(adoptPhoneHour({ hour: 8, hourChangedAt: changed, seed: phoneAt("2026-10-05T07:00:00.000Z") }), 6);
	// Browser changed it more recently: keep the browser's hour.
	assert.equal(adoptPhoneHour({ hour: 8, hourChangedAt: changed, seed: phoneAt("2026-10-03T07:00:00.000Z") }), 8);
	// Never changed here: the phone wins.
	assert.equal(adoptPhoneHour({ hour: 8, hourChangedAt: null, seed: phoneAt("2026-10-03T07:00:00.000Z") }), 6);
	// No phone: nothing to follow.
	assert.equal(adoptPhoneHour({ hour: 8, hourChangedAt: null, seed: null }), 8);
});
