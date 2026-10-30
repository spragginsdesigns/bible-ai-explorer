/**
 * Direct Apple Push Notification service delivery, for the Apple apps.
 *
 * Android and legacy iOS installs use the Expo push API. Current Apple apps
 * register raw APNs tokens, and the server sends to Apple itself with
 * token-based (provider JWT) auth from the environment's .p8 key.
 *
 * An Apple row stores its token as `apns:<environment>:<hex>` in the ordinary
 * `PushToken.token` column, so no schema change was needed: the environment
 * (sandbox for Debug builds, production for Release) travels with the token,
 * the unique index still holds one row per device, and no APNs token can ever
 * be mistaken for an Expo token or a browser endpoint (`splitRecipients`
 * drops anything of neither shape).
 *
 * Optional like the other keyed features: production uses APNS_KEY_ID and
 * APNS_PRIVATE_KEY; sandbox requires APNS_DEVELOPMENT_KEY_ID and
 * APNS_DEVELOPMENT_PRIVATE_KEY. Both share APNS_TEAM_ID. Missing credentials
 * refuse registration for that environment, skip stored rows without error,
 * and let the app keep its local notifications.
 *
 * Kept free of Prisma and of `@/` imports (node: modules and type imports
 * only) so the JWT, the payload and the error mapping are unit tested with the
 * HTTP layer injected (tests/apns.test.mjs). push.ts retires the tokens.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session, type ClientHttp2Stream } from "node:http2";
import type { DeliveryRecipient } from "./push-routing";

export type ApnsEnvironment = "production" | "development";

export const APNS_ENVIRONMENTS: readonly ApnsEnvironment[] = ["production", "development"];

/** The macOS app's bundle id, which is the APNs topic. */
export const DEFAULT_APNS_BUNDLE_ID = "com.spragginsdesigns.sureword";

/** Prefix of every stored Mac token: `apns:<environment>:<hex>`. */
export const APNS_TOKEN_PREFIX = "apns:";

const APNS_ORIGINS: Record<ApnsEnvironment, string> = {
	production: "https://api.push.apple.com",
	development: "https://api.sandbox.push.apple.com",
};

/**
 * Apple refuses a provider token older than an hour and throttles one
 * refreshed more often than every 20 minutes; 50 minutes sits between.
 */
export const APNS_JWT_TTL_MS = 50 * 60 * 1000;

/** A morning verse or a finished answer is stale after a day, as for Web Push. */
export const APNS_EXPIRATION_SECONDS = 24 * 60 * 60;

/** Concurrent requests; HTTP/2 multiplexes them over one connection per host. */
const APNS_CONCURRENCY = 10;
const APNS_REQUEST_TIMEOUT_MS = 15_000;
/** Apple's limit on `apns-collapse-id`, in bytes. */
const APNS_COLLAPSE_ID_MAX_BYTES = 64;

// -- configuration --------------------------------------------------------

export interface ApnsConfig {
	keyId: string;
	teamId: string;
	/** The .p8 contents as PEM, newlines restored. */
	privateKey: string;
	bundleId: string;
}

/**
 * The .p8 as Vercel tends to hold it: pasted on one line with literal `\n`,
 * sometimes wrapped in quotes, sometimes only the base64 body. Normalized to a
 * PEM `createPrivateKey` accepts.
 */
export function normalizeApnsPrivateKey(raw: string): string {
	let key = raw.trim();
	if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
		key = key.slice(1, -1).trim();
	}
	key = key.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n?/g, "\n");
	if (!key.includes("-----BEGIN")) {
		const body = key.replace(/\s+/g, "");
		const lines = body.match(/.{1,64}/g) ?? [];
		key = ["-----BEGIN PRIVATE KEY-----", ...lines, "-----END PRIVATE KEY-----"].join("\n");
	}
	return key.endsWith("\n") ? key : `${key}\n`;
}

/**
 * Production/default credentials retain their existing names. Sandbox must
 * explicitly configure its own pair: a topic-specific production key cannot
 * authorize the sandbox host. A legacy key valid on both hosts may be set in
 * both pairs, but is never used for sandbox merely because it exists.
 */
export function apnsConfig(
	env: Record<string, string | undefined> = process.env,
	environment: ApnsEnvironment = "production",
): ApnsConfig | null {
	const keyId = (environment === "development" ? env.APNS_DEVELOPMENT_KEY_ID : env.APNS_KEY_ID)?.trim();
	const teamId = env.APNS_TEAM_ID?.trim();
	const privateKey = (environment === "development" ? env.APNS_DEVELOPMENT_PRIVATE_KEY : env.APNS_PRIVATE_KEY)?.trim();
	if (!keyId || !teamId || !privateKey) return null;
	return {
		keyId,
		teamId,
		privateKey: normalizeApnsPrivateKey(privateKey),
		bundleId: env.APNS_BUNDLE_ID?.trim() || DEFAULT_APNS_BUNDLE_ID,
	};
}

// -- stored tokens --------------------------------------------------------

/**
 * A raw APNs device token as the Mac hands it over: hex, even length. Apple
 * documents the token as variable length (32 bytes today), so only a sane
 * range is enforced.
 */
export function isApnsDeviceToken(hex: string): boolean {
	return /^[0-9a-fA-F]{64,200}$/.test(hex) && hex.length % 2 === 0;
}

export function isApnsEnvironment(value: unknown): value is ApnsEnvironment {
	return value === "production" || value === "development";
}

/** The `PushToken.token` a Mac registration is stored under, or null for a malformed one. */
export function apnsStoredToken(hex: string, environment: unknown): string | null {
	if (!isApnsDeviceToken(hex) || !isApnsEnvironment(environment)) return null;
	return `${APNS_TOKEN_PREFIX}${environment}:${hex.toLowerCase()}`;
}

/** Whether a stored token belongs to APNs at all (well-formed or not). */
export function isApnsStoredToken(token: string): boolean {
	return token.startsWith(APNS_TOKEN_PREFIX);
}

/** The environment and device token a stored Mac token carries, or null. */
export function parseApnsStoredToken(
	token: string,
): { environment: ApnsEnvironment; deviceToken: string } | null {
	const match = /^apns:(production|development):([0-9a-f]+)$/.exec(token);
	if (!match || !isApnsDeviceToken(match[2])) return null;
	return { environment: match[1] as ApnsEnvironment, deviceToken: match[2] };
}

/** One Mac a push is delivered to. */
export interface ApnsRecipient {
	tokenId: string;
	environment: ApnsEnvironment;
	deviceToken: string;
}

/**
 * The Mac recipients of one message, each device once. Everything else is
 * left to `splitRecipients`, which drops APNs tokens because they are neither
 * Expo tokens nor browser subscriptions, so Expo and Web Push see exactly the
 * recipients they always did.
 */
export function apnsRecipientsOf(recipients: readonly DeliveryRecipient[]): ApnsRecipient[] {
	const seen = new Set<string>();
	const apns: ApnsRecipient[] = [];
	for (const recipient of recipients) {
		if (seen.has(recipient.to)) continue;
		seen.add(recipient.to);
		const parsed = parseApnsStoredToken(recipient.to);
		if (parsed) apns.push({ tokenId: recipient.tokenId, ...parsed });
	}
	return apns;
}

// -- provider token -------------------------------------------------------

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/**
 * The ES256 provider token: header `{ alg, kid }`, claims `{ iss, iat }`,
 * signed with the .p8 key. JOSE wants the raw r||s signature, not DER.
 */
export function signApnsJwt(
	config: Pick<ApnsConfig, "keyId" | "teamId">,
	key: KeyObject | string,
	nowMs: number,
): string {
	const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
	const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) }));
	const signingInput = `${header}.${claims}`;
	const keyObject = typeof key === "string" ? createPrivateKey(key) : key;
	const signature = sign("sha256", Buffer.from(signingInput), { key: keyObject, dsaEncoding: "ieee-p1363" });
	return `${signingInput}.${base64url(signature)}`;
}

/**
 * Provider tokens reused for APNS_JWT_TTL_MS. `invalidate` drops the cached
 * one after Apple rejects it, so the next send signs afresh.
 */
export function createApnsJwtCache(ttlMs = APNS_JWT_TTL_MS) {
	const cached = new Map<string, { jwt: string; issuedAt: number }>();
	const keys = new Map<string, KeyObject>();
	const identityOf = (config: ApnsConfig) => `${config.teamId}:${config.keyId}:${config.privateKey}`;
	return {
		get(config: ApnsConfig, nowMs: number): string {
			const identity = identityOf(config);
			const entry = cached.get(identity);
			if (entry && nowMs - entry.issuedAt < ttlMs) return entry.jwt;
			let key = keys.get(identity);
			if (!key) {
				key = createPrivateKey(config.privateKey);
				keys.set(identity, key);
			}
			const fresh = { jwt: signApnsJwt(config, key, nowMs), issuedAt: nowMs };
			cached.set(identity, fresh);
			return fresh.jwt;
		},
		invalidate(config?: ApnsConfig) {
			if (config) cached.delete(identityOf(config));
			else cached.clear();
		},
	};
}

// -- requests -------------------------------------------------------------

/** The notification push.ts hands over: the same title, body and data as Expo's. */
export interface ApnsMessage {
	title: string;
	body: string;
	data: Record<string, unknown>;
}

export interface ApnsHttpRequest {
	origin: string;
	path: string;
	headers: Record<string, string>;
	body: string;
}

export interface ApnsHttpResponse {
	status: number;
	body: string;
}

/**
 * Where a notification lands, and what replaces what: the web tag
 * (`buildWebPushPayload`) and the Mac's own local notice identifiers agree, so
 * `chat-<id>` is shared by the remote and the local "Your answer is ready".
 */
export function apnsCollapseId(data: Record<string, unknown>): string | undefined {
	let id: string | undefined;
	if (data.screen === "cross") id = "daily-cross";
	else if (data.screen === "chat" && typeof data.conversationId === "string" && data.conversationId) {
		id = `chat-${data.conversationId}`;
	}
	return id && Buffer.byteLength(id) <= APNS_COLLAPSE_ID_MAX_BYTES ? id : undefined;
}

/**
 * The iOS notification category for a push, which picks its long-press view
 * (SureWord-iOS-NotificationContent). Mirrors notificationArtFor's
 * apnsCategory in push-routing.ts, kept inline because this file imports
 * types only; tests/apns.test.mjs holds the two in step.
 */
export function apnsCategoryFor(data: Record<string, unknown>): "SUREWORD_CROSS" | "SUREWORD_ANSWER" | undefined {
	if (data.screen === "cross") return "SUREWORD_CROSS";
	if (data.screen === "chat") return "SUREWORD_ANSWER";
	return undefined;
}

/**
 * The APNs JSON payload. `data` sits at the top level, where the Mac's
 * `NotificationTapTarget` reads `screen` and `conversationId` (it also reads
 * Expo's nesting under `body`). No subtitle: the morning body already carries
 * the reference, as on Android and the web, so it is not repeated.
 */
export function buildApnsPayload(message: ApnsMessage): Record<string, unknown> {
	const data = Object.fromEntries(Object.entries(message.data).filter(([key]) => key !== "aps"));
	const category = apnsCategoryFor(message.data);
	return {
		aps: {
			alert: { title: message.title, body: message.body },
			sound: "default",
			// mutable-content wakes the Notification Service Extension, which
			// attaches the kind's art as the banner thumbnail; the category
			// picks the long-press view. A build without the extensions shows
			// the plain alert, so this is safe for older installs.
			...(category ? { "mutable-content": 1, category } : {}),
		},
		...data,
	};
}

/** The HTTP/2 request for one device. */
export function buildApnsRequest(
	message: ApnsMessage,
	recipient: Pick<ApnsRecipient, "environment" | "deviceToken">,
	options: { jwt: string; bundleId: string; nowMs: number },
): ApnsHttpRequest {
	const collapseId = apnsCollapseId(message.data);
	return {
		origin: APNS_ORIGINS[recipient.environment],
		path: `/3/device/${recipient.deviceToken}`,
		headers: {
			authorization: `bearer ${options.jwt}`,
			"apns-topic": options.bundleId,
			"apns-push-type": "alert",
			// 10 = deliver now; both pushes are meant to be seen when they land.
			"apns-priority": "10",
			"apns-expiration": String(Math.floor(options.nowMs / 1000) + APNS_EXPIRATION_SECONDS),
			...(collapseId ? { "apns-collapse-id": collapseId } : {}),
			"content-type": "application/json",
		},
		body: JSON.stringify(buildApnsPayload(message)),
	};
}

export type ApnsOutcome =
	/** Accepted by APNs. */
	| "sent"
	/** The token will never work again: delete the row. */
	| "retire"
	/** Apple rejected the provider token: sign a new one. */
	| "auth"
	/** Anything else, logged and left alone. */
	| "failed";

/**
 * Apple's answer, mapped. 410 (`Unregistered`, `ExpiredToken`) and
 * `BadDeviceToken` mean the token is dead, the same as Expo's
 * `DeviceNotRegistered`. `BadDeviceToken` is also what a sandbox token sent to
 * production gets, and the app re-registers with the right one at its next
 * launch. `DeviceTokenNotForTopic` and the rest are configuration problems,
 * never the device's, so they never cost anyone their row.
 */
export function classifyApnsResponse(response: ApnsHttpResponse): { outcome: ApnsOutcome; reason: string } {
	let reason = "";
	try {
		const parsed = JSON.parse(response.body) as { reason?: unknown };
		if (typeof parsed?.reason === "string") reason = parsed.reason;
	} catch {
		// An empty 200 body, or a proxy page: the status decides.
	}
	if (response.status === 200) return { outcome: "sent", reason };
	if (response.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken" || reason === "ExpiredToken") {
		return { outcome: "retire", reason };
	}
	if (response.status === 403 && (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")) {
		return { outcome: "auth", reason };
	}
	return { outcome: "failed", reason };
}

// -- transport ------------------------------------------------------------

export interface ApnsTransport {
	send(request: ApnsHttpRequest): Promise<ApnsHttpResponse>;
	close(): void;
}

/**
 * HTTP/2 to Apple (`fetch` cannot speak HTTP/2), one session per host for the
 * life of a batch, closed afterwards so a serverless invocation does not hang
 * on an open socket.
 */
export function createHttp2Transport(timeoutMs = APNS_REQUEST_TIMEOUT_MS): ApnsTransport {
	const sessions = new Map<string, ClientHttp2Session>();
	const session = (origin: string) => {
		const existing = sessions.get(origin);
		if (existing && !existing.closed && !existing.destroyed) return existing;
		const created = connect(origin);
		// A connection error fails the requests on it; without a listener it
		// would crash the process instead.
		created.on("error", () => {});
		sessions.set(origin, created);
		return created;
	};
	return {
		send(request) {
			return new Promise<ApnsHttpResponse>((resolve, reject) => {
				let stream: ClientHttp2Stream;
				try {
					stream = session(request.origin).request({
						":method": "POST",
						":path": request.path,
						...request.headers,
					});
				} catch (error) {
					reject(error);
					return;
				}
				let status = 0;
				let body = "";
				let completed = false;
				stream.setEncoding("utf8");
				stream.setTimeout(timeoutMs, () => {
					reject(new Error("APNs request timed out"));
					stream.close();
				});
				stream.on("response", (headers) => {
					status = Number(headers[":status"]) || 0;
				});
				stream.on("data", (chunk: string) => {
					body += chunk;
				});
				stream.on("end", () => {
					completed = true;
					if (status) resolve({ status, body });
					else reject(new Error("APNs stream ended without a response"));
				});
				stream.on("close", () => {
					if (!completed) reject(new Error("APNs stream closed before its response completed"));
				});
				stream.on("error", reject);
				stream.end(request.body);
			});
		},
		close() {
			for (const open of sessions.values()) open.close();
			sessions.clear();
		},
	};
}

// -- sending --------------------------------------------------------------

export interface ApnsJob {
	message: ApnsMessage;
	recipients: ApnsRecipient[];
}

export interface ApnsSendResult {
	sent: number;
	failed: number;
	/** Rows to delete, like Expo's DeviceNotRegistered. */
	retiredTokenIds: string[];
	/** True when no credentials are configured and nothing was attempted. */
	skipped: boolean;
}

const sharedJwtCache = createApnsJwtCache();
const warnedUnconfigured = new Set<ApnsEnvironment>();

/**
 * Deliver every job to its Macs. Never throws: a misconfigured key, Apple
 * being down or a dead token each end up in the result or the log, so a Mac
 * failure can never stop the phones' pushes in the same batch.
 *
 * Everything is injectable for tests; production passes nothing.
 */
export async function sendApnsJobs(
	jobs: readonly ApnsJob[],
	label: string,
	options: {
		/** Explicit shared test credentials, or a resolver for each environment. */
		config?: ApnsConfig | null | ((environment: ApnsEnvironment) => ApnsConfig | null);
		transport?: ApnsTransport;
		jwtCache?: ReturnType<typeof createApnsJwtCache>;
		now?: () => number;
		log?: (message: string) => void;
	} = {},
): Promise<ApnsSendResult> {
	const result: ApnsSendResult = { sent: 0, failed: 0, retiredTokenIds: [], skipped: false };
	const pending = jobs.flatMap(({ message, recipients }) => recipients.map((recipient) => ({ message, recipient })));
	if (pending.length === 0) return result;

	const log = options.log ?? ((line: string) => console.error(line));
	const configs = new Map<ApnsEnvironment, ApnsConfig | null>();
	for (const { recipient } of pending) {
		if (configs.has(recipient.environment)) continue;
		const config = typeof options.config === "function"
			? options.config(recipient.environment)
			: options.config === undefined ? apnsConfig(process.env, recipient.environment) : options.config;
		configs.set(recipient.environment, config);
		if (!config && (!warnedUnconfigured.has(recipient.environment) || options.log)) {
			warnedUnconfigured.add(recipient.environment);
			const pair = recipient.environment === "development"
				? "APNS_DEVELOPMENT_KEY_ID, APNS_DEVELOPMENT_PRIVATE_KEY"
				: "APNS_KEY_ID, APNS_PRIVATE_KEY";
			log(`[${label}] APNs is not configured for ${recipient.environment} (${pair}, APNS_TEAM_ID); skipped this environment.`);
		}
	}
	const sends = pending.flatMap((send) => {
		const config = configs.get(send.recipient.environment);
		return config ? [{ ...send, config }] : [];
	});
	if (sends.length === 0) return { ...result, skipped: true };

	const jwtCache = options.jwtCache ?? sharedJwtCache;
	const now = options.now ?? Date.now;
	const transport = options.transport ?? createHttp2Transport();
	let next = 0;
	const worker = async () => {
		while (next < sends.length) {
			const { message, recipient, config } = sends[next];
			next += 1;
			// A rejected provider token is retried once with a fresh one.
			for (let attempt = 0; attempt < 2; attempt += 1) {
				let jwt: string;
				try {
					jwt = jwtCache.get(config, now());
				} catch {
					log(`[${label}] APNs ${recipient.environment} private key could not be read; check its credential pair.`);
					result.failed += 1;
					break;
				}
				try {
					const response = await transport.send(
						buildApnsRequest(message, recipient, { jwt, bundleId: config.bundleId, nowMs: now() }),
					);
					const { outcome, reason } = classifyApnsResponse(response);
					if (outcome === "auth" && attempt === 0) {
						jwtCache.invalidate(config);
						continue;
					}
					if (outcome === "sent") result.sent += 1;
					else if (outcome === "retire") result.retiredTokenIds.push(recipient.tokenId);
					else {
						result.failed += 1;
						log(`[${label}] APNs send failed (${response.status}${reason ? ` ${reason}` : ""}).`);
					}
				} catch {
					result.failed += 1;
					log(`[${label}] APNs send failed (network).`);
				}
				break;
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.min(APNS_CONCURRENCY, sends.length) }, () => worker()));
	} finally {
		transport.close();
	}
	return result;
}
