#!/usr/bin/env node
// Promote an ALREADY-UPLOADED bundle to another Google Play track.
//
//   node mobile/scripts/play-promote.mjs --track alpha --code 79
//
// Why this exists separately from play-upload.mjs: that script always uploads
// the AAB, and Play rejects a versionCode it has already seen. So there was no
// way to put a build that internal testing already has onto closed testing
// without rebuilding it under a new versionCode - which would mean shipping a
// DIFFERENT binary to the two tracks. This promotes the exact bytes Play
// already holds.
//
// Track names are the API's, not the Console's:
//   internal -> "Internal testing"   (no review, reaches testers in minutes)
//   alpha    -> "Closed testing"     (goes through Play review first)
//   beta     -> "Open testing"
//   production -> "Production"
//
// Release notes come from mobile/CHANGELOG.md, same as every other publish
// path - the entry for the versionCode being promoted must already exist.
//
// Auth: the same service account play-upload.mjs uses (SUREWORD_PLAY_KEY, or
// ~/.sureword-signing/play-publisher.json).
import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "com.spragginsdesigns.sureword";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(SCRIPTS, "..");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const track = arg("--track");
const code = arg("--code");
if (!track || !code) {
	console.error("usage: play-promote.mjs --track <internal|alpha|beta|production> --code <versionCode>");
	process.exit(1);
}

// Same rule as push-phone.sh: internal testing is where releases go, because
// it is the only track that skips Play review. This script's whole purpose is
// the occasional promotion to a slower track, so the opt-in is explicit rather
// than assumed (Austin, 2026-09-20).
if (track !== "internal" && process.env.SUREWORD_ALLOW_SLOW_TRACK !== "1") {
	console.error(
		`[play-promote] REFUSED: "${track}" goes through Play review, so it is not how a release reaches the phone.\n` +
			"Releases go to internal testing: bash mobile/scripts/push-phone.sh\n" +
			"If this is the 14-day closed-testing run Play requires before production access, re-run with:\n" +
			`  SUREWORD_ALLOW_SLOW_TRACK=1 node mobile/scripts/play-promote.mjs --track ${track} --code ${code}`
	);
	process.exit(1);
}

const log = (m) => console.log(`[play-promote] ${m}`);

// The version name is whatever app.json says, so the Play release is labelled
// the same way the build that produced it was.
const versionName = JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")).expo.version;

// Same mandatory changelog gate as push-phone.sh: no entry, no publish.
let notes;
try {
	notes = execFileSync(
		process.execPath,
		[join(SCRIPTS, "play-notes.mjs"), join(MOBILE, "CHANGELOG.md"), code, versionName],
		{ encoding: "utf8" }
	).trim();
} catch {
	console.error(
		`[play-promote] BLOCKED: mobile/CHANGELOG.md has no entry for versionCode ${code}.\n` +
			"[play-promote] Play notes are never typed ad hoc - write the entry first (rules at the top of that file)."
	);
	process.exit(1);
}
log(`Play notes for versionCode ${code} from CHANGELOG.md (${notes.length} chars).`);

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

const token = await accessToken();
async function api(method, path, body) {
	const res = await fetch(`${API}/applications/${PACKAGE}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
	return text ? JSON.parse(text) : {};
}

const edit = await api("POST", "/edits");

// Refuse to promote a versionCode Play does not already hold: without this the
// call would happily create a release pointing at a bundle that does not exist.
const known = new Set(
	((await api("GET", `/edits/${edit.id}/bundles`)).bundles ?? []).map((b) => String(b.versionCode))
);
if (!known.has(String(code))) {
	console.error(
		`[play-promote] versionCode ${code} has not been uploaded to Play. Known: ${[...known].join(", ") || "(none)"}.\n` +
			"[play-promote] Build and upload it with push-phone.sh first; this script only moves an existing bundle."
	);
	process.exit(1);
}

await api("PUT", `/edits/${edit.id}/tracks/${track}`, {
	track,
	releases: [
		{
			name: versionName,
			versionCodes: [String(code)],
			status: "completed",
			releaseNotes: [{ language: "en-US", text: notes }],
		},
	],
});
await api("POST", `/edits/${edit.id}:commit`);
log(`${versionName} (${code}) is now on the "${track}" track.`);
if (track !== "internal") {
	log('Tracks other than "internal" go through Play review, so this is not instant.');
}
