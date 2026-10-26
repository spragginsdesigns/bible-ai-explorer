#!/usr/bin/env node
// Check or publish SureWord's Play Store listing from store-listing/play-store.md.
//
//   node mobile/scripts/play-listing.mjs check   # report drift, change nothing
//   node mobile/scripts/play-listing.mjs apply   # write title, short and full description
//
// The Play twin of `macos/scripts/asc.py listing check|apply`. The text lives in
// store-listing/play-store.md (the source of truth), never in this script.
//
// Apply needs the publisher service account to hold "Manage store presence" on
// SureWord (Play Console > Users and permissions). Without it the edit commit
// answers 403; it was granted on 2026-10-25.
//
// Auth: the same service account play-upload.mjs uses (SUREWORD_PLAY_KEY, or
// ~/.sureword-signing/play-publisher.json).
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "com.spragginsdesigns.sureword";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mode = process.argv[2];
if (mode !== "check" && mode !== "apply") {
	console.error("usage: node mobile/scripts/play-listing.mjs check|apply");
	process.exit(2);
}

const md = readFileSync(join(ROOT, "store-listing", "play-store.md"), "utf8").replace(/\r\n/g, "\n");
const field = (re, name) => {
	const m = md.match(re);
	if (!m) throw new Error(`play-store.md: could not find the ${name}`);
	return m[1];
};
const want = {
	title: field(/\| App name \| `([^`]+)`/, "App name"),
	shortDescription: field(/## Short description \(80 max\)\n\n```\n([\s\S]*?)\n```/, "short description"),
	fullDescription: field(/## Full description \(4000 max\)\n\n```\n([\s\S]*?)\n```/, "full description"),
};

const key = JSON.parse(readFileSync(process.env.SUREWORD_PLAY_KEY ?? join(homedir(), ".sureword-signing", "play-publisher.json"), "utf8"));
const b64url = (value) => Buffer.from(value).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: key.token_uri, iat: now, exp: now + 3600 }))}`;
const signer = createSign("RSA-SHA256");
signer.update(unsigned);
const tokenRes = await fetch(key.token_uri, {
	method: "POST",
	headers: { "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signer.sign(key.private_key, "base64url")}` }),
});
const { access_token: token } = await tokenRes.json();
if (!token) throw new Error(`Play auth failed (${tokenRes.status})`);

async function api(method, path, body) {
	const res = await fetch(`${API}/applications/${PACKAGE}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : {};
}

const edit = await api("POST", "/edits");
const live = await api("GET", `/edits/${edit.id}/listings/en-US`);
const drift = Object.keys(want).filter((k) => live[k] !== want[k]);

if (mode === "check" || drift.length === 0) {
	await api("DELETE", `/edits/${edit.id}`);
	console.log(drift.length === 0 ? "[play-listing] Live listing matches play-store.md." : `[play-listing] Drift in: ${drift.join(", ")}`);
	process.exit(drift.length === 0 ? 0 : 1);
}

await api("PATCH", `/edits/${edit.id}/listings/en-US`, want);
await api("POST", `/edits/${edit.id}:commit`);
console.log(`[play-listing] Published ${drift.join(", ")} to the live Play listing.`);
