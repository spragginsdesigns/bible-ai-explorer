import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { loadEnvFile } from "node:process";
import { openLiveLedger } from "../src/lib/voice/live-ledger.mjs";
import { LiveRelaySession } from "../src/lib/voice/live-relay-session.mjs";
import { liveAppOrigin, liveSecret, relaySignature } from "../src/lib/voice/live-policy.ts";

try { loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (process.env.SUREWORD_LIVE_ENABLED !== "true") throw new Error("The private live voice trial is disabled.");
const secret = liveSecret(process.env);
const key = process.env.OPENAI_API_KEY?.trim();
if (!key) throw new Error("SureWord's existing OPENAI_API_KEY is required.");
const origin = liveAppOrigin(process.env);
const ledger = openLiveLedger(process.env.SUREWORD_LIVE_LEDGER_PATH || resolve(".private/live-voice.sqlite"));
const port = Number(process.env.SUREWORD_LIVE_RELAY_PORT || 3145);
const host = process.env.SUREWORD_LIVE_RELAY_HOST || "127.0.0.1";
const require = createRequire(import.meta.url);
const { createClerkClient } = createRequire(require.resolve("@clerk/nextjs/server"))("@clerk/backend");
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const sessions = new Set();
const rpc = async input => {
	const grant = ledger.get(input.sessionId);
	if (!grant) throw new Error("Unknown voice session.");
	const token = await clerk.sessions.getToken(grant.clerkSessionId);
	const body = JSON.stringify(input); const timestamp = String(Date.now());
	const response = await fetch(`${origin}/api/voice/live/relay`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.jwt}`, "x-live-timestamp": timestamp, "x-live-signature": relaySignature(body, timestamp, secret) }, body, signal: AbortSignal.timeout(330_000) });
	if (!response.ok) throw new Error(`Voice backend failed (${response.status}).`);
	return response.json();
};
const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
const wss = new WebSocketServer({ noServer: true, maxPayload: 64_000, perMessageDeflate: false });
server.on("upgrade", (req, socket, head) => {
	if (req.headers.origin !== origin || req.url !== "/" || sessions.size >= 32) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
	wss.handleUpgrade(req, socket, head, browser => {
		const session = new LiveRelaySession(browser, { ledger, secret, rpc, upstreamFactory: () => new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15_000, maxPayload: 2_000_000, perMessageDeflate: false }) });
		sessions.add(session); browser.on("close", () => sessions.delete(session));
	});
});
server.listen(port, host, () => console.log(`SureWord private voice relay listening on ${host}:${port}; application ${origin}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
	server.close();
	const drain = Promise.all([...sessions].map(session => session.end("Voice relay stopped. Check chat for saved turns.")));
	const timeout = new Promise(resolve => setTimeout(() => resolve("timeout"), 10_000));
	void Promise.race([drain, timeout]).then(result => { ledger.close(); process.exit(result === "timeout" ? 1 : 0); });
});
