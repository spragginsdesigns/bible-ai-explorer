#!/usr/bin/env node
// Upload a signed AAB to a Google Play track via the Android Publisher API.
//
//   node mobile/scripts/play-upload.mjs --aab <path> [--track internal] [--notes "..."]
//
// Auth: a service account JSON key. Path comes from SUREWORD_PLAY_KEY or
// defaults to ~/.sureword-signing/play-publisher.json (created 2026-08-19,
// sureword-play-publisher@versemind-auth.iam.gserviceaccount.com - it must be
// granted release access in Play Console > Users and permissions). No npm
// deps: the JWT is signed with node:crypto and everything else is fetch().
import { createSign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PACKAGE = "com.spragginsdesigns.sureword";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const aabPath = arg("--aab");
const track = arg("--track", "internal");
const notes = arg("--notes", "");
const versionName = arg("--version-name", "");
if (!aabPath) {
	console.error("usage: play-upload.mjs --aab <path> [--track internal] [--notes text] [--version-name 1.2.3]");
	process.exit(1);
}

const keyPath =
	process.env.SUREWORD_PLAY_KEY ?? join(homedir(), ".sureword-signing", "play-publisher.json");
const key = JSON.parse(readFileSync(keyPath, "utf8"));

const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function accessToken() {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const claims = b64url(
		JSON.stringify({
			iss: key.client_email,
			scope: "https://www.googleapis.com/auth/androidpublisher",
			aud: key.token_uri,
			iat: now,
			exp: now + 3600,
		})
	);
	const signer = createSign("RSA-SHA256");
	signer.update(`${header}.${claims}`);
	const jwt = `${header}.${claims}.${signer.sign(key.private_key, "base64url")}`;
	const res = await fetch(key.token_uri, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});
	const body = await res.json();
	if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
	return body.access_token;
}

async function api(token, method, path, { body, raw } = {}) {
	const url = path.startsWith("http") ? path : `${API}/applications/${PACKAGE}${path}`;
	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": raw ? "application/octet-stream" : "application/json",
		},
		body: raw ?? (body ? JSON.stringify(body) : undefined),
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
	return json;
}

const log = (m) => console.log(`[play-upload] ${m}`);

const token = await accessToken();
const sizeMb = (statSync(aabPath).size / 1024 / 1024).toFixed(1);
const edit = await api(token, "POST", "/edits");
log(`Edit ${edit.id} opened; uploading ${aabPath} (${sizeMb} MB)...`);

const bundle = await api(
	token,
	"POST",
	`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`,
	{ raw: readFileSync(aabPath) }
);
log(`Uploaded versionCode ${bundle.versionCode}.`);

await api(token, "PUT", `/edits/${edit.id}/tracks/${track}`, {
	body: {
		track,
		releases: [
			{
				...(versionName ? { name: versionName } : {}),
				versionCodes: [String(bundle.versionCode)],
				status: "completed",
				...(notes ? { releaseNotes: [{ language: "en-US", text: notes }] } : {}),
			},
		],
	},
});
await api(token, "POST", `/edits/${edit.id}:commit`);
log(`Released versionCode ${bundle.versionCode} to the "${track}" track. Live for testers in a few minutes.`);
