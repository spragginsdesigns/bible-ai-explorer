import { createHmac, timingSafeEqual } from "node:crypto";

export interface LiveLimits { sessionSeconds: number; dailySeconds: number; monthlySeconds: number }
export interface LiveTicket { sessionId: string; userId: string; expiresAt: number }

/** Limits count connected time, including muted time, not only spoken audio. */
export function liveLimits(env: Record<string, string | undefined>): LiveLimits {
	const seconds = (key: string, fallback: number, maximum: number) => {
		const value = env[key];
		if (value === undefined) return fallback;
		const number = Number(value);
		return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, maximum) : 0;
	};
	return {
		sessionSeconds: seconds("SUREWORD_LIVE_SESSION_SECONDS", 300, 600),
		dailySeconds: seconds("SUREWORD_LIVE_DAILY_SECONDS", 600, 1800),
		monthlySeconds: seconds("SUREWORD_LIVE_MONTHLY_SECONDS", 3600, 7200),
	};
}

export function liveSecret(env: Record<string, string | undefined>): string {
	const secret = env.SUREWORD_LIVE_RELAY_SECRET?.trim();
	if (!secret || secret.length < 32) throw new Error("The private voice relay is not configured.");
	return secret;
}

export function signLiveTicket(ticket: LiveTicket, secret: string): string {
	const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
	return `${payload}.${createHmac("sha256", secret).update(`ticket:${payload}`).digest("base64url")}`;
}

export function verifyLiveTicket(raw: string, secret: string, now = Date.now()): LiveTicket {
	if (raw.length > 2048) throw new Error("Invalid voice ticket.");
	const [payload, signature, extra] = raw.split(".");
	if (!payload || !signature || extra) throw new Error("Invalid voice ticket.");
	const expected = createHmac("sha256", secret).update(`ticket:${payload}`).digest("base64url");
	if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid voice ticket.");
	const ticket = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LiveTicket;
	if (typeof ticket.sessionId !== "string" || typeof ticket.userId !== "string" || !Number.isSafeInteger(ticket.expiresAt) || ticket.expiresAt < now || ticket.expiresAt > now + 60_000) throw new Error("Voice ticket expired.");
	return ticket;
}

export function relaySignature(body: string, timestamp: string, secret: string): string {
	return createHmac("sha256", secret).update(`relay:${timestamp}:${body}`).digest("hex");
}

export function validRelaySignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
	if (!timestamp || !signature || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 30_000) return false;
	const expected = relaySignature(body, timestamp, secret);
	return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function liveRelayUrl(env: Record<string, string | undefined>): string {
	const raw = env.SUREWORD_LIVE_RELAY_URL || "ws://127.0.0.1:3145";
	const url = new URL(raw);
	if (url.username || url.password || url.search || url.hash || (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Voice relay requires WSS or a loopback connection.");
	return url.toString();
}

export function liveAppOrigin(env: Record<string, string | undefined>): string {
	const url = new URL(env.SUREWORD_LIVE_APP_ORIGIN || "http://localhost:3144");
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Invalid voice application origin.");
	return url.origin;
}
