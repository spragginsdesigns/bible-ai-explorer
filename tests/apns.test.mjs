/**
 * Direct APNs delivery for the macOS app (src/lib/apns.ts): the provider JWT,
 * the stored-token shape, the payload and headers, Apple's error mapping, and
 * the sender with the HTTP layer injected. Then the registration route's Mac
 * branch, driven through the same in-memory PushToken table the device-proof
 * tests use, and the regressions that keep Android, iOS and the web exactly as
 * they were. Nothing here talks to Apple.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http2";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
	APNS_ENVIRONMENTS,
	APNS_EXPIRATION_SECONDS,
	APNS_JWT_TTL_MS,
	DEFAULT_APNS_BUNDLE_ID,
	apnsCollapseId,
	apnsConfig,
	apnsRecipientsOf,
	apnsStoredToken,
	buildApnsPayload,
	buildApnsRequest,
	classifyApnsResponse,
	createApnsJwtCache,
	createHttp2Transport,
	isApnsDeviceToken,
	isApnsStoredToken,
	normalizeApnsPrivateKey,
	parseApnsStoredToken,
	sendApnsJobs,
	signApnsJwt,
} from "../src/lib/apns.ts";
import { isAllowedWebPushEndpoint, isExpoPushToken, mayRegisterExistingPushToken, recipientFromRow, splitRecipients } from "../src/lib/push-routing.ts";
import {
	createPushTokenNonce,
	isValidPushTokenProof,
	pushTokenProof,
	pushTokenProofSecret,
} from "../src/lib/push-token-proof.ts";

const read = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
/** The .p8 the way it is pasted into Vercel: one line, literal `\n`. */
const ONE_LINE_PEM = PEM.trim().replace(/\n/g, "\\n");
const ENV = { APNS_KEY_ID: "KEY1234567", APNS_TEAM_ID: "389LLKGY3Y", APNS_PRIVATE_KEY: ONE_LINE_PEM };
const CONFIG = apnsConfig(ENV);
const developmentKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const DEVELOPMENT_PEM = developmentKeys.privateKey.export({ type: "pkcs8", format: "pem" });
const BOTH_ENV = {
	...ENV,
	APNS_DEVELOPMENT_KEY_ID: "DEV1234567",
	APNS_DEVELOPMENT_PRIVATE_KEY: DEVELOPMENT_PEM,
};
const DEVELOPMENT_CONFIG = apnsConfig(BOTH_ENV, "development");

const HEX = "a1b2c3d4".repeat(8);
const PROD = `apns:production:${HEX}`;
const DEV = `apns:development:${HEX}`;
const EXPO = "ExponentPushToken[abc123]";
const FCM = "https://fcm.googleapis.com/fcm/send/xyz";

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

// -- configuration ----------------------------------------------------------

test("APNs is off unless key id, team id and key are all set", () => {
	assert.equal(apnsConfig({}), null);
	assert.equal(apnsConfig({ ...ENV, APNS_KEY_ID: " " }), null);
	assert.equal(apnsConfig({ ...ENV, APNS_TEAM_ID: undefined }), null);
	assert.equal(apnsConfig({ ...ENV, APNS_PRIVATE_KEY: "" }), null);
	assert.equal(CONFIG.bundleId, DEFAULT_APNS_BUNDLE_ID);
	assert.equal(DEFAULT_APNS_BUNDLE_ID, "com.spragginsdesigns.sureword");
	assert.equal(apnsConfig({ ...ENV, APNS_BUNDLE_ID: "com.example.other" }).bundleId, "com.example.other");
});

test("a pasted .p8 is normalized back to a PEM: literal \\n, quotes, or a bare body", () => {
	assert.equal(CONFIG.privateKey, PEM);
	assert.equal(normalizeApnsPrivateKey(`"${ONE_LINE_PEM}"`), PEM);
	assert.equal(normalizeApnsPrivateKey(PEM.replace(/\n/g, "\r\n")), PEM);
	const body = PEM.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
	assert.equal(normalizeApnsPrivateKey(body), PEM);
});

test("sandbox requires its explicit credential pair and never falls back to the production key", () => {
	assert.deepEqual(apnsConfig(BOTH_ENV), CONFIG);
	assert.deepEqual(apnsConfig(BOTH_ENV, "production"), CONFIG);
	assert.equal(apnsConfig(ENV, "development"), null);
	assert.equal(apnsConfig({ ...BOTH_ENV, APNS_DEVELOPMENT_KEY_ID: " " }, "development"), null);
	assert.equal(apnsConfig({ ...BOTH_ENV, APNS_DEVELOPMENT_PRIVATE_KEY: undefined }, "development"), null);
	assert.equal(apnsConfig({ ...BOTH_ENV, APNS_TEAM_ID: undefined }, "development"), null);
	assert.equal(DEVELOPMENT_CONFIG.keyId, "DEV1234567");
	assert.equal(DEVELOPMENT_CONFIG.privateKey, DEVELOPMENT_PEM);
	assert.equal(DEVELOPMENT_CONFIG.teamId, CONFIG.teamId);
	assert.equal(DEVELOPMENT_CONFIG.bundleId, CONFIG.bundleId);
	// Sandbox-only deployments do not require a production pair.
	assert.equal(apnsConfig({ ...BOTH_ENV, APNS_KEY_ID: undefined }, "development").keyId, "DEV1234567");
});

// -- stored tokens ----------------------------------------------------------

test("a Mac token is stored as apns:<environment>:<lowercase hex>", () => {
	assert.equal(apnsStoredToken(HEX.toUpperCase(), "production"), PROD);
	assert.equal(apnsStoredToken(HEX, "development"), DEV);
	assert.equal(apnsStoredToken(HEX, "sandbox"), null);
	assert.equal(apnsStoredToken(HEX, undefined), null);
	for (const bad of ["", "abc", "zz".repeat(32), `${HEX}a`, "ab".repeat(101), EXPO]) {
		assert.equal(apnsStoredToken(bad, "production"), null, bad);
	}
	assert.deepEqual(APNS_ENVIRONMENTS, ["production", "development"]);
	assert.equal(isApnsDeviceToken(HEX), true);
});

test("stored tokens parse back; Expo tokens and browser endpoints are not APNs", () => {
	assert.deepEqual(parseApnsStoredToken(PROD), { environment: "production", deviceToken: HEX });
	assert.deepEqual(parseApnsStoredToken(DEV), { environment: "development", deviceToken: HEX });
	assert.equal(parseApnsStoredToken(`apns:staging:${HEX}`), null);
	assert.equal(parseApnsStoredToken(`apns:production:${HEX.toUpperCase()}`), null);
	assert.equal(parseApnsStoredToken(EXPO), null);
	assert.equal(isApnsStoredToken(PROD), true);
	assert.equal(isApnsStoredToken("apns:junk"), true);
	assert.equal(isApnsStoredToken(EXPO), false);
	assert.equal(isApnsStoredToken(FCM), false);
});

test("Macs are picked out of a message once each; Expo and web routing is untouched", () => {
	const rows = [
		{ id: "a", token: EXPO, platform: "android" },
		{ id: "m", token: PROD, platform: "macos" },
		{ id: "w", token: FCM, platform: "web", webP256dh: "P", webAuth: "A" },
		{ id: "m2", token: PROD, platform: "macos" },
		{ id: "d", token: DEV, platform: "macos" },
		{ id: "j", token: "apns:production:nothex", platform: "macos" },
	];
	const recipients = rows.map(recipientFromRow);
	assert.deepEqual(apnsRecipientsOf(recipients), [
		{ tokenId: "m", environment: "production", deviceToken: HEX },
		{ tokenId: "d", environment: "development", deviceToken: HEX },
	]);
	// splitRecipients drops every APNs-shaped token, so Expo never sees one
	// and the phones' and browsers' recipients are what they were before.
	const split = splitRecipients(recipients);
	assert.deepEqual(split.expo, [{ tokenId: "a", to: EXPO }]);
	assert.deepEqual(split.web, [{ tokenId: "w", endpoint: FCM, keys: { p256dh: "P", auth: "A" } }]);
	assert.equal(split.dropped, 3);
	const withoutMacs = splitRecipients(recipientsWithout(recipients, "apns:"));
	assert.deepEqual(withoutMacs.expo, split.expo);
	assert.deepEqual(withoutMacs.web, split.web);
});

function recipientsWithout(recipients, prefix) {
	return recipients.filter((recipient) => !recipient.to.startsWith(prefix));
}

// -- provider token ---------------------------------------------------------

test("the provider JWT is ES256 with kid, iss and iat, signed raw r||s", () => {
	const now = Date.UTC(2026, 9, 28, 12, 0, 0);
	const jwt = signApnsJwt(CONFIG, CONFIG.privateKey, now);
	const [header, claims, signature] = jwt.split(".");
	assert.deepEqual(decode(header), { alg: "ES256", kid: "KEY1234567" });
	assert.deepEqual(decode(claims), { iss: "389LLKGY3Y", iat: now / 1000 });
	const raw = Buffer.from(signature, "base64url");
	assert.equal(raw.length, 64, "JOSE ES256 is 64 bytes, not DER");
	assert.equal(
		verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, raw),
		true,
	);
});

test("the provider JWT is reused for 50 minutes, then re-signed; invalidate forces a new one", () => {
	const cache = createApnsJwtCache();
	const t0 = 1_800_000_000_000;
	const first = cache.get(CONFIG, t0);
	assert.equal(cache.get(CONFIG, t0 + APNS_JWT_TTL_MS - 1), first);
	const second = cache.get(CONFIG, t0 + APNS_JWT_TTL_MS);
	assert.notEqual(second, first);
	assert.equal(decode(second.split(".")[1]).iat, Math.floor((t0 + APNS_JWT_TTL_MS) / 1000));
	assert.equal(APNS_JWT_TTL_MS, 50 * 60 * 1000);
	cache.invalidate();
	assert.notEqual(cache.get(CONFIG, t0 + APNS_JWT_TTL_MS + 1000), second);
	// A different key id is a different identity, never served the old token.
	assert.equal(decode(cache.get({ ...CONFIG, keyId: "OTHER" }, t0 + APNS_JWT_TTL_MS + 1000).split(".")[0]).kid, "OTHER");
});

test("alternating environments cache independent JWTs and invalidate only the rejected identity", () => {
	const cache = createApnsJwtCache();
	const now = 1_800_000_000_000;
	const production = cache.get(CONFIG, now);
	const development = cache.get(DEVELOPMENT_CONFIG, now);
	for (let i = 1; i < 5; i += 1) {
		assert.equal(cache.get(CONFIG, now + i * 1000), production);
		assert.equal(cache.get(DEVELOPMENT_CONFIG, now + i * 1000), development);
	}
	cache.invalidate(CONFIG);
	assert.notEqual(cache.get(CONFIG, now + 5000), production);
	assert.equal(cache.get(DEVELOPMENT_CONFIG, now + 5000), development);
});

// -- payload and request ----------------------------------------------------

const MORNING = {
	title: "✝ Pick up your cross",
	body: "“For God so loved the world” - John 3:16",
	data: { screen: "cross", book: "John", chapter: 3, verse: 16 },
};
const ANSWER = {
	title: "Your answer is ready",
	body: "Grace is the unmerited favour of God…",
	data: { screen: "chat", conversationId: "conv_1" },
};

test("the payload keeps the Expo title, body and data, with data at the top level", () => {
	assert.deepEqual(buildApnsPayload(MORNING), {
		aps: { alert: { title: MORNING.title, body: MORNING.body }, sound: "default" },
		screen: "cross",
		book: "John",
		chapter: 3,
		verse: 16,
	});
	assert.deepEqual(buildApnsPayload(ANSWER), {
		aps: { alert: { title: ANSWER.title, body: ANSWER.body }, sound: "default" },
		screen: "chat",
		conversationId: "conv_1",
	});
	// Data can never overwrite the aps dictionary.
	assert.deepEqual(buildApnsPayload({ ...ANSWER, data: { aps: { badge: 9 }, screen: "chat" } }).aps, {
		alert: { title: ANSWER.title, body: ANSWER.body },
		sound: "default",
	});
});

test("collapse ids match the web tags and the Mac's local answer notice", () => {
	assert.equal(apnsCollapseId(MORNING.data), "daily-cross");
	assert.equal(apnsCollapseId(ANSWER.data), "chat-conv_1");
	assert.equal(apnsCollapseId({ type: "sermon-watchdog" }), undefined);
	assert.equal(apnsCollapseId({ screen: "chat", conversationId: "x".repeat(80) }), undefined);
});

test("requests go to the token's own APNs host with the alert headers", () => {
	const nowMs = 1_800_000_000_000;
	const production = buildApnsRequest(
		ANSWER,
		{ environment: "production", deviceToken: HEX },
		{ jwt: "JWT", bundleId: "com.spragginsdesigns.sureword", nowMs },
	);
	assert.equal(production.origin, "https://api.push.apple.com");
	assert.equal(production.path, `/3/device/${HEX}`);
	assert.deepEqual(production.headers, {
		authorization: "bearer JWT",
		"apns-topic": "com.spragginsdesigns.sureword",
		"apns-push-type": "alert",
		"apns-priority": "10",
		"apns-expiration": String(nowMs / 1000 + APNS_EXPIRATION_SECONDS),
		"apns-collapse-id": "chat-conv_1",
		"content-type": "application/json",
	});
	assert.deepEqual(JSON.parse(production.body), buildApnsPayload(ANSWER));
	const sandbox = buildApnsRequest(
		{ title: "t", body: "b", data: { type: "sermon-watchdog" } },
		{ environment: "development", deviceToken: HEX },
		{ jwt: "JWT", bundleId: "com.spragginsdesigns.sureword", nowMs },
	);
	assert.equal(sandbox.origin, "https://api.sandbox.push.apple.com");
	assert.equal("apns-collapse-id" in sandbox.headers, false);
});

// -- Apple's answers --------------------------------------------------------

test("410, BadDeviceToken and Unregistered retire the token; configuration errors never do", () => {
	const answer = (status, reason) => classifyApnsResponse({ status, body: reason ? JSON.stringify({ reason }) : "" });
	assert.equal(answer(200).outcome, "sent");
	assert.equal(answer(410, "Unregistered").outcome, "retire");
	assert.equal(answer(410, "ExpiredToken").outcome, "retire");
	assert.equal(answer(410).outcome, "retire");
	assert.equal(answer(400, "BadDeviceToken").outcome, "retire");
	assert.equal(answer(403, "ExpiredProviderToken").outcome, "auth");
	assert.equal(answer(403, "InvalidProviderToken").outcome, "auth");
	for (const [status, reason] of [
		[400, "DeviceTokenNotForTopic"],
		[400, "TopicDisallowed"],
		[400, "BadCollapseId"],
		[403, "BadCertificate"],
		[429, "TooManyRequests"],
		[500, "InternalServerError"],
		[503, "ServiceUnavailable"],
	]) {
		assert.deepEqual(answer(status, reason), { outcome: "failed", reason }, `${status} ${reason}`);
	}
	assert.equal(classifyApnsResponse({ status: 502, body: "<html>bad gateway</html>" }).outcome, "failed");
});

// -- the sender -------------------------------------------------------------

function fakeTransport(answer) {
	const requests = [];
	let closed = 0;
	return {
		requests,
		get closed() {
			return closed;
		},
		send: async (request) => {
			requests.push(request);
			return answer(request, requests.length);
		},
		close: () => {
			closed += 1;
		},
	};
}

const mac = (tokenId, environment = "production", deviceToken = HEX) => ({ tokenId, environment, deviceToken });

test("a mixed-environment batch uses each host's own key and reuses its JWT", async () => {
	const transport = fakeTransport(() => ({ status: 200, body: "" }));
	const resolved = [];
	const result = await sendApnsJobs([{
		message: ANSWER,
		recipients: [mac("p1"), mac("d1", "development"), mac("p2"), mac("d2", "development")],
	}], "test", {
		config: (environment) => {
			resolved.push(environment);
			return apnsConfig(BOTH_ENV, environment);
		},
		transport,
		jwtCache: createApnsJwtCache(),
		now: () => 1_800_000_000_000,
	});
	assert.deepEqual(result, { sent: 4, failed: 0, retiredTokenIds: [], skipped: false });
	assert.deepEqual(resolved, ["production", "development"]);
	const jwtByHost = new Map();
	for (const request of transport.requests) {
		const sandbox = request.origin === "https://api.sandbox.push.apple.com";
		const jwt = request.headers.authorization.slice("bearer ".length);
		const [header, claims, signature] = jwt.split(".");
		assert.equal(decode(header).kid, sandbox ? "DEV1234567" : "KEY1234567");
		assert.equal(verify("sha256", Buffer.from(`${header}.${claims}`), {
			key: sandbox ? developmentKeys.publicKey : publicKey,
			dsaEncoding: "ieee-p1363",
		}, Buffer.from(signature, "base64url")), true);
		if (jwtByHost.has(request.origin)) assert.equal(jwt, jwtByHost.get(request.origin));
		jwtByHost.set(request.origin, jwt);
	}
	assert.equal(jwtByHost.size, 2);
	assert.equal(transport.closed, 1);
});

test("missing sandbox credentials skip sandbox rows without blocking production or retiring any token", async () => {
	const transport = fakeTransport(() => ({ status: 200, body: "" }));
	const logs = [];
	const result = await sendApnsJobs([{
		message: ANSWER,
		recipients: [mac("p"), mac("d", "development")],
	}], "test", {
		config: (environment) => apnsConfig(ENV, environment),
		transport,
		jwtCache: createApnsJwtCache(),
		log: (line) => logs.push(line),
	});
	assert.deepEqual(result, { sent: 1, failed: 0, retiredTokenIds: [], skipped: false });
	assert.equal(transport.requests.length, 1);
	assert.equal(transport.requests[0].origin, "https://api.push.apple.com");
	assert.equal(logs.length, 1);
	assert.match(logs[0], /not configured for development.*APNS_DEVELOPMENT_KEY_ID/);
});

test("unconfigured APNs skips every Mac without sending or throwing, and logs why", async () => {
	const transport = fakeTransport(() => ({ status: 200, body: "" }));
	const logs = [];
	const result = await sendApnsJobs([{ message: ANSWER, recipients: [mac("m")] }], "test", {
		config: null,
		transport,
		log: (line) => logs.push(line),
	});
	assert.deepEqual(result, { sent: 0, failed: 0, retiredTokenIds: [], skipped: true });
	assert.equal(transport.requests.length, 0);
	assert.equal(logs.length, 1);
	assert.match(logs[0], /APNs is not configured/);
	// Nothing to send is not worth a log line at all.
	const empty = await sendApnsJobs([], "test", { config: null, transport, log: (line) => logs.push(line) });
	assert.equal(empty.skipped, false);
	assert.equal(logs.length, 1);
});

test("each Mac gets one request; dead tokens are reported for deletion; the connection closes", async () => {
	const dead = "dead".repeat(16);
	const bad = "bad0".repeat(16);
	const misconfigured = "beef".repeat(16);
	const transport = fakeTransport((request) => {
		if (request.path.endsWith(dead)) return { status: 410, body: JSON.stringify({ reason: "Unregistered" }) };
		if (request.path.endsWith(bad)) return { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) };
		if (request.path.endsWith(misconfigured)) {
			return { status: 400, body: JSON.stringify({ reason: "DeviceTokenNotForTopic" }) };
		}
		return { status: 200, body: "" };
	});
	const logs = [];
	const result = await sendApnsJobs(
		[
			{ message: MORNING, recipients: [mac("ok"), mac("dead", "production", dead)] },
			{ message: ANSWER, recipients: [mac("bad", "development", bad), mac("cfg", "production", misconfigured)] },
		],
		"cron/verse-of-day",
		{ config: CONFIG, transport, jwtCache: createApnsJwtCache(), now: () => 1_800_000_000_000, log: (l) => logs.push(l) },
	);
	assert.equal(result.sent, 1);
	assert.equal(result.failed, 1);
	assert.deepEqual([...result.retiredTokenIds].sort(), ["bad", "dead"]);
	assert.equal(transport.requests.length, 4);
	assert.equal(transport.closed, 1);
	assert.equal(transport.requests.find((r) => r.path.endsWith(bad)).origin, "https://api.sandbox.push.apple.com");
	assert.equal(logs.length, 1);
	assert.match(logs[0], /\[cron\/verse-of-day\] APNs send failed \(400 DeviceTokenNotForTopic\)/);
	// The log never carries a device token or the JWT.
	assert.doesNotMatch(logs.join("\n"), new RegExp(`${misconfigured}|bearer`));
});

test("a rejected provider token is re-signed and the send retried once", async () => {
	let now = 1_800_000_000_000;
	const transport = fakeTransport((_request, count) =>
		count === 1 ? { status: 403, body: JSON.stringify({ reason: "ExpiredProviderToken" }) } : { status: 200, body: "" },
	);
	const result = await sendApnsJobs([{ message: ANSWER, recipients: [mac("m")] }], "test", {
		config: CONFIG,
		transport,
		jwtCache: createApnsJwtCache(),
		now: () => (now += 1000),
		log: () => {},
	});
	assert.equal(result.sent, 1);
	assert.equal(transport.requests.length, 2);
	assert.notEqual(transport.requests[0].headers.authorization, transport.requests[1].headers.authorization);

	// One that keeps being refused is a failure, not a loop, and keeps its row.
	const refusing = fakeTransport(() => ({ status: 403, body: JSON.stringify({ reason: "InvalidProviderToken" }) }));
	const refused = await sendApnsJobs([{ message: ANSWER, recipients: [mac("m")] }], "test", {
		config: CONFIG,
		transport: refusing,
		jwtCache: createApnsJwtCache(),
		log: () => {},
	});
	assert.deepEqual(refused, { sent: 0, failed: 1, retiredTokenIds: [], skipped: false });
	assert.equal(refusing.requests.length, 2);
});

test("a network failure or an unreadable key fails the send without throwing", async () => {
	const throwing = { send: async () => { throw new Error("ECONNRESET"); }, close: () => {} };
	const network = await sendApnsJobs([{ message: ANSWER, recipients: [mac("m")] }], "test", {
		config: CONFIG,
		transport: throwing,
		jwtCache: createApnsJwtCache(),
		log: () => {},
	});
	assert.deepEqual(network, { sent: 0, failed: 1, retiredTokenIds: [], skipped: false });

	const unread = fakeTransport(() => ({ status: 200, body: "" }));
	const badKey = await sendApnsJobs([{ message: ANSWER, recipients: [mac("m")] }], "test", {
		config: { ...CONFIG, privateKey: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n" },
		transport: unread,
		jwtCache: createApnsJwtCache(),
		log: () => {},
	});
	assert.equal(badKey.failed, 1);
	assert.equal(unread.requests.length, 0);
});

test("the HTTP/2 transport posts the request and reads Apple's status and reason", async () => {
	const seen = [];
	const server = createServer();
	server.on("stream", (stream, headers) => {
		let body = "";
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => (body += chunk));
		stream.on("end", () => {
			seen.push({ headers, body });
			const gone = headers[":path"].endsWith("dead");
			stream.respond({ ":status": gone ? 410 : 200 });
			stream.end(gone ? JSON.stringify({ reason: "Unregistered" }) : "");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const transport = createHttp2Transport(2000);
	try {
		const request = buildApnsRequest(ANSWER, { environment: "production", deviceToken: HEX }, {
			jwt: "JWT",
			bundleId: DEFAULT_APNS_BUNDLE_ID,
			nowMs: 1_800_000_000_000,
		});
		const ok = await transport.send({ ...request, origin });
		const gone = await transport.send({ ...request, origin, path: "/3/device/dead" });
		assert.deepEqual(ok, { status: 200, body: "" });
		assert.equal(classifyApnsResponse(gone).outcome, "retire");
		assert.equal(seen[0].headers[":method"], "POST");
		assert.equal(seen[0].headers[":path"], `/3/device/${HEX}`);
		assert.equal(seen[0].headers["apns-topic"], DEFAULT_APNS_BUNDLE_ID);
		assert.equal(seen[0].headers["apns-push-type"], "alert");
		assert.deepEqual(JSON.parse(seen[0].body), buildApnsPayload(ANSWER));
	} finally {
		transport.close();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("HTTP/2 timeout and a reset stream settle instead of hanging the push batch", async () => {
	const server = createServer();
	const sessions = new Set();
	server.on("session", (session) => {
		sessions.add(session);
		session.on("close", () => sessions.delete(session));
	});
	server.on("stream", (stream, headers) => {
		stream.on("error", () => {});
		if (headers[":path"] === "/reset") stream.close(8);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const transport = createHttp2Transport(50);
	const request = { origin: `http://127.0.0.1:${server.address().port}`, path: "/stalled", headers: {}, body: "{}" };
	try {
		await assert.rejects(transport.send(request), /timed out/);
		await assert.rejects(transport.send({ ...request, path: "/reset" }), /closed|reset|without a response|NGHTTP2_CANCEL/);
	} finally {
		transport.close();
		for (const session of sessions) session.destroy();
		await new Promise((resolve) => server.close(resolve));
	}
});

// -- push.ts wiring ---------------------------------------------------------

test("push.ts sends Macs to APNs beside Expo and Web Push, and retires what APNs reports dead", () => {
	const push = read("../src/lib/push.ts");
	// The phones' and browsers' path is the same call it always was.
	assert.match(push, /const \{ expo, web \} = splitRecipients\(message\.recipients\);/);
	assert.match(push, /apnsRecipientsOf\(message\.recipients\)/);
	assert.match(push, /sendViaExpo\(expoMessages, label\),\s*sendViaWebPush\(webJobs, label\),\s*sendViaApns\(apnsJobs, label\)/);
	assert.match(push, /retiredTokenIds[\s\S]*prisma\.pushToken\.delete\(\{ where: \{ id: tokenId \} \}\)/);
	// The cron and the answer-ready push need no Mac-specific code: the token
	// they already select carries everything.
	const cron = read("../src/app/api/cron/verse-of-day/route.ts");
	assert.match(cron, /token: true/);
	assert.match(push, /data: \{ screen: "chat", conversationId: options\.conversationId \}/);
	assert.match(cron, /data: \{ screen: "cross", book: cross\.book, chapter: cross\.chapter, verse: cross\.verse \}/);
});

// -- the registration route -------------------------------------------------

class PrismaClientKnownRequestError extends Error {
	constructor(message, { code }) {
		super(message);
		this.code = code;
	}
}

/** The route against a table of rows, honouring its conditional writes. */
function loadRoute({ rows = [], userId = "user_mac", env = BOTH_ENV } = {}) {
	const table = rows.map((row, index) => ({ id: `row-${index}`, ...row }));
	const deletes = [];
	const matches = (where, current) =>
		Object.entries(where).every(([key, value]) =>
			value && typeof value === "object" && "in" in value ? value.in.includes(current[key]) : current[key] === value,
		);
	const prisma = {
		pushToken: {
			findUnique: async ({ where }) => {
				const found = table.find((row) => row.token === where.token);
				return found ? { ...found } : null;
			},
			findFirst: async () => null,
			create: async ({ data }) => {
				if (table.some((row) => row.token === data.token)) {
					throw new PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002" });
				}
				const row = { id: `row-${table.length}`, ...data };
				table.push(row);
				return { id: row.id };
			},
			updateMany: async ({ where, data }) => {
				const row = table.find((candidate) => matches(where, candidate));
				if (!row) return { count: 0 };
				Object.assign(row, data);
				return { count: 1 };
			},
			deleteMany: async ({ where }) => {
				deletes.push(where);
				for (let index = table.length - 1; index >= 0; index -= 1) {
					if (matches(where, table[index])) table.splice(index, 1);
				}
				return { count: 0 };
			},
		},
	};
	const injected = {
		NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
		Prisma: { PrismaClientKnownRequestError },
		ANALYTICS_EVENTS: { pushRegistrationChanged: "push_registration_changed" },
		platformFromHeaders: () => "macos",
		captureServerEvent: () => {},
		z,
		getAuthUser: async () => userId,
		prisma,
		webPushConfig: () => null,
		isAllowedWebPushEndpoint,
		isExpoPushToken,
		mayRegisterExistingPushToken,
		createPushTokenNonce,
		isValidPushTokenProof,
		pushTokenProof,
		pushTokenProofSecret,
		APNS_ENVIRONMENTS,
		apnsConfig: (_unused, environment) => apnsConfig(env, environment),
		apnsStoredToken,
		isApnsDeviceToken,
		isApnsStoredToken,
	};
	const source = read("../src/app/api/push-tokens/route.ts")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const { POST, DELETE } = new Function(...names, `${stripTypeScriptTypes(source)}\nreturn { POST, DELETE };`)(
		...names.map((name) => injected[name]),
	);
	const request = (body) => ({ json: async () => body, headers: new Headers() });
	return {
		table,
		deletes,
		register: (extra = {}) =>
			POST(
				request({
					token: HEX,
					platform: "macos",
					apnsEnvironment: "production",
					timezone: "America/Chicago",
					notifyHour: 7,
					enabled: true,
					chatReplies: true,
					...extra,
				}),
			),
		unregister: (body) => DELETE(request(body)),
	};
}

async function withSecret(secret, fn) {
	const previous = process.env.PUSH_TOKEN_PROOF_SECRET;
	if (secret === null) delete process.env.PUSH_TOKEN_PROOF_SECRET;
	else process.env.PUSH_TOKEN_PROOF_SECRET = secret;
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.PUSH_TOKEN_PROOF_SECRET;
		else process.env.PUSH_TOKEN_PROOF_SECRET = previous;
	}
}

const SECRET = "test-proof-secret";

test("a Mac registers its hex token under its environment and gets a device proof", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute();
		const response = await route.register({ token: HEX.toUpperCase() });
		assert.equal(response.status, 200);
		const [row] = route.table;
		assert.equal(row.token, PROD);
		assert.equal(row.platform, "macos");
		assert.equal(row.userId, "user_mac");
		assert.equal(row.notifyHour, 7);
		assert.equal(row.webP256dh, null);
		assert.deepEqual(response.body, { id: row.id, proof: pushTokenProof(SECRET, PROD, row.proofNonce) });

		// Echoing the proof binds the row, exactly as for a phone.
		const bound = await route.register({ proof: response.body.proof });
		assert.equal(bound.status, 200);
		assert.equal(route.table[0].deviceBound, true);

		// A sandbox token from a Debug build is its own row.
		await route.register({ apnsEnvironment: "development" });
		assert.deepEqual(route.table.map((r) => r.token), [PROD, DEV]);
	});
});

test("a bound Mac token moves to another account only with its proof", async () => {
	await withSecret(SECRET, async () => {
		const nonce = "nonce-1";
		const base = { token: PROD, userId: "user_old", platform: "macos", webP256dh: null, webAuth: null, deviceBound: true, proofNonce: nonce, timezone: "UTC" };
		const refused = loadRoute({ rows: [base] });
		assert.equal((await refused.register()).status, 400);
		assert.equal(refused.table[0].userId, "user_old");
		const moved = loadRoute({ rows: [base] });
		assert.equal((await moved.register({ proof: pushTokenProof(SECRET, PROD, nonce) })).status, 200);
		assert.equal(moved.table[0].userId, "user_mac");
	});
});

test("an iOS raw token registers and binds through the same canonical device proof", async () => {
	await withSecret(SECRET, async () => {
		for (const environment of APNS_ENVIRONMENTS) {
			const route = loadRoute();
			const response = await route.register({ platform: "ios", token: HEX.toUpperCase(), apnsEnvironment: environment });
			assert.equal(response.status, 200);
			const [row] = route.table;
			assert.equal(row.token, apnsStoredToken(HEX, environment));
			assert.equal(row.platform, "ios");
			assert.equal(response.body.proof, pushTokenProof(SECRET, row.token, row.proofNonce));
			assert.equal((await route.register({ platform: "ios", apnsEnvironment: environment, proof: response.body.proof })).status, 200);
			assert.equal(row.deviceBound, true);
		}
	});
});

test("a bound iOS raw token moves to a different account only with the device proof", async () => {
	await withSecret(SECRET, async () => {
		const row = { token: PROD, userId: "previous", platform: "ios", webP256dh: null, webAuth: null, deviceBound: true, proofNonce: "nonce-ios", timezone: "UTC" };
		const route = loadRoute({ rows: [row] });
		assert.equal((await route.register({ platform: "ios" })).status, 400);
		assert.equal(route.table[0].userId, "previous");
		const response = await route.register({ platform: "ios", proof: pushTokenProof(SECRET, PROD, row.proofNonce) });
		assert.equal(response.status, 200);
		assert.equal(route.table[0].userId, "user_mac");
	});
});

test("Apple registration checks the requested environment's credentials before writing a row", async () => {
	for (const platform of ["ios", "macos"]) {
		const route = loadRoute({ env: ENV });
		assert.equal((await route.register({ platform, apnsEnvironment: "development" })).status, 503);
		assert.equal(route.table.length, 0);
		assert.equal((await route.register({ platform, apnsEnvironment: "production" })).status, 200);
		assert.equal(route.table[0].token, PROD);
		const sandboxOnly = loadRoute({ env: { ...BOTH_ENV, APNS_KEY_ID: undefined, APNS_PRIVATE_KEY: undefined } });
		assert.equal((await sandboxOnly.register({ platform, apnsEnvironment: "production" })).status, 503);
		assert.equal((await sandboxOnly.register({ platform, apnsEnvironment: "development" })).status, 200);
		assert.equal(sandboxOnly.table[0].token, DEV);
	}
});

test("iOS direct registration requires raw hex and its environment", async () => {
	for (const extra of [
		{ apnsEnvironment: undefined },
		{ apnsEnvironment: "sandbox" },
		{ token: "nothex" },
		{ token: PROD },
	]) {
		const route = loadRoute();
		assert.equal((await route.register({ platform: "ios", ...extra })).status, 400);
		assert.equal(route.table.length, 0);
	}
	const android = loadRoute();
	assert.equal((await android.register({ platform: "android" })).status, 400);
	assert.equal(android.table.length, 0);
});

test("a Mac registration needs a hex token and an environment", async () => {
	for (const extra of [
		{ apnsEnvironment: undefined },
		{ apnsEnvironment: "sandbox" },
		{ token: "not-hex" },
		{ token: EXPO },
		{ token: PROD },
	]) {
		const route = loadRoute();
		const response = await route.register(extra);
		assert.equal(response.status, 400, JSON.stringify(extra));
		assert.equal(route.table.length, 0);
	}
});

test("without APNs credentials a Mac is refused with 503 and nothing is stored", async () => {
	const route = loadRoute({ env: {} });
	const response = await route.register();
	assert.equal(response.status, 503);
	assert.equal(response.body.status, "unavailable");
	assert.equal(route.table.length, 0);
});

test("no other platform may register an APNs-shaped token", async () => {
	for (const platform of ["android", "ios"]) {
		const route = loadRoute();
		const response = await route.register({ platform, token: PROD, apnsEnvironment: undefined });
		assert.equal(response.status, 400, platform);
		assert.equal(route.table.length, 0);
	}
});

test("phones register exactly as before, with or without APNs configured", async () => {
	for (const env of [ENV, {}]) {
		const route = loadRoute({ env });
		const response = await route.register({ platform: "android", token: EXPO, apnsEnvironment: undefined });
		assert.equal(response.status, 200);
		assert.equal(route.table[0].token, EXPO);
		assert.equal(route.table[0].platform, "android");
		// An apnsEnvironment sent by mistake changes nothing for a phone.
		const ios = loadRoute({ env });
		await ios.register({ platform: "ios", token: "ExponentPushToken[ios]", apnsEnvironment: "production" });
		assert.equal(ios.table[0].token, "ExponentPushToken[ios]");
	}
});

test("a Mac unregisters by its hex token from either environment; phones delete as before", async () => {
	const rows = [
		{ token: PROD, userId: "user_mac", platform: "macos" },
		{ token: DEV, userId: "user_mac", platform: "macos" },
		{ token: EXPO, userId: "user_mac", platform: "android" },
	];
	const route = loadRoute({ rows });
	assert.equal((await route.unregister({ token: HEX, platform: "macos" })).status, 200);
	assert.deepEqual(route.deletes, [{ token: { in: [PROD, DEV] }, userId: "user_mac" }]);
	assert.deepEqual(route.table.map((row) => row.token), [EXPO]);

	assert.equal((await route.unregister({ token: EXPO })).status, 200);
	assert.deepEqual(route.deletes[1], { token: EXPO, userId: "user_mac" });
	assert.equal(route.table.length, 0);
});

test("iOS APNs rows coexist with legacy Expo rows and unregister without touching other accounts", async () => {
	const old = { token: "ExponentPushToken[legacy-ios]", userId: "user_mac", platform: "ios" };
	const other = { token: `apns:production:${"cd".repeat(32)}`, userId: "someone_else", platform: "ios" };
	const route = loadRoute({ rows: [old, other] });
	assert.equal((await route.register({ platform: "ios" })).status, 200);
	assert.equal((await route.register({ platform: "ios", apnsEnvironment: "development" })).status, 200);
	assert.equal(route.table.length, 4);
	const recipients = route.table.filter((row) => row.userId === "user_mac").map(recipientFromRow);
	assert.deepEqual(splitRecipients(recipients).expo.map((row) => row.to), [old.token]);
	assert.deepEqual(apnsRecipientsOf(recipients).map((row) => row.environment).sort(), ["development", "production"]);
	assert.equal((await route.unregister({ token: HEX, platform: "ios" })).status, 200);
	assert.deepEqual(route.deletes[0], { token: { in: [PROD, DEV] }, userId: "user_mac" });
	assert.deepEqual(route.table.map((row) => row.token), [old.token, other.token]);
	assert.equal((await route.unregister({ token: old.token, platform: "ios" })).status, 200);
	assert.deepEqual(route.deletes[1], { token: old.token, userId: "user_mac" });
	assert.deepEqual(route.table.map((row) => row.token), [other.token]);
});
