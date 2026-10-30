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
import { createHash, createSign } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = "com.spragginsdesigns.sureword";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function accessToken(key) {
	if (key?.token_uri !== TOKEN_URI || typeof key.client_email !== "string" || !key.client_email.trim() || typeof key.private_key !== "string" || !key.private_key)
		throw new Error("Invalid Play service account credentials or token endpoint.");
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const claims = b64url(
		JSON.stringify({
			iss: key.client_email,
			scope: "https://www.googleapis.com/auth/androidpublisher",
			aud: TOKEN_URI,
			iat: now,
			exp: now + 3600,
		})
	);
	let jwt;
	try {
		const signer = createSign("RSA-SHA256");
		signer.update(`${header}.${claims}`);
		jwt = `${header}.${claims}.${signer.sign(key.private_key, "base64url")}`;
	} catch { throw new Error("Could not sign Play authentication request."); }
	let res;
	try { res = await fetch(TOKEN_URI, {
		method: "POST",
		redirect: "error",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	}); } catch { throw new Error("Play authentication transport failed."); }
	const body = await responseJson(res, "Play authentication");
	if (typeof body.access_token !== "string" || !body.access_token.trim()) throw new Error("Play authentication returned no access token.");
	return body.access_token;
}

async function responseJson(res, operation) {
	if (!res.ok) throw new Error(`${operation} failed (HTTP ${res.status}).`);
	let text;
	try { text = await res.text(); } catch { throw new Error(`${operation} response could not be read.`); }
	if (!text) return {};
	try {
		const value = JSON.parse(text);
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
		return value;
	} catch { throw new Error(`${operation} returned invalid JSON.`); }
}

async function api(token, method, path, { body, raw } = {}) {
	const url = path.startsWith("http") ? path : `${API}/applications/${PACKAGE}${path}`;
	let res;
	try { res = await fetch(url, {
		method,
		redirect: "error",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": raw ? "application/octet-stream" : "application/json",
		},
		body: raw ?? (body ? JSON.stringify(body) : undefined),
	}); } catch { throw new Error("Play API transport failed."); }
	return responseJson(res, "Play API");
}

const versionCode = value => {
	if (!["number", "string"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2100000000)
		throw new Error("Invalid Play versionCode.");
	return Number(value);
};

/** Exact immutable payload reuse; importing this script never authenticates or publishes. */
export async function publishBundle({ bytes, track = "internal", notes = "", versionName = "", expectedVersionCode }, call, log = () => {}) {
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const expected = expectedVersionCode === undefined ? null : versionCode(expectedVersionCode);
	const edit = await call("POST", "/edits");
	if (typeof edit.id !== "string" || !edit.id) throw new Error("Play did not return an edit ID.");
	const editPath = `/edits/${encodeURIComponent(edit.id)}`;
	const listed = await call("GET", `${editPath}/bundles`);
	if (listed.bundles !== undefined && !Array.isArray(listed.bundles)) throw new Error("Invalid Play bundle list.");
	const bundles = listed.bundles ?? [];
	for (const bundle of bundles) {
		versionCode(bundle.versionCode);
		if (!/^[a-f0-9]{64}$/.test(bundle.sha256 ?? "")) throw new Error("Invalid Play bundle SHA-256.");
	}
	if (expected !== null && bundles.some(bundle => versionCode(bundle.versionCode) === expected && bundle.sha256 !== sha256))
		throw new Error("Expected versionCode belongs to a different AAB payload.");
	const matches = bundles.filter(bundle => bundle.sha256 === sha256);
	if (matches.length > 1) throw new Error("Ambiguous Play bundle payload identity.");
	let bundle = matches[0];
	const reused = Boolean(bundle);
	if (bundle && expected !== null && versionCode(bundle.versionCode) !== expected)
		throw new Error("Exact AAB payload has a different versionCode than expected.");
	if (!bundle) bundle = await call("POST",
		`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}${editPath}/bundles?uploadType=media`,
		{ raw: bytes });
	const code = versionCode(bundle.versionCode);
	if (bundle.sha256 !== sha256 || (expected !== null && code !== expected))
		throw new Error("Play bundle receipt does not match the exact AAB and expected versionCode.");
	log(`${reused ? "Reusing" : "Uploaded"} exact AAB versionCode ${code}.`);
	await call("PUT", `${editPath}/tracks/${encodeURIComponent(track)}`, {
	body: {
		track,
		releases: [
			{
				...(versionName ? { name: versionName } : {}),
				versionCodes: [String(code)],
				status: "completed",
				...(notes ? { releaseNotes: [{ language: "en-US", text: notes }] } : {}),
			},
		],
	},
});
	await call("POST", `${editPath}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW`);
	log(`Released versionCode ${code} to the "${track}" track. Live for testers in a few minutes.`);
	return { versionCode: code, sha256, reused };
}

async function main() {
	const args = process.argv.slice(2);
	const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
	const aabPath = arg("--aab");
	if (!aabPath) throw new Error("usage: play-upload.mjs --aab <path> [--track internal] [--expected-code n] [--notes text] [--version-name 1.2.3]");
	const keyPath = process.env.SUREWORD_PLAY_KEY ?? join(homedir(), ".sureword-signing", "play-publisher.json");
	let key, bytes;
	try { key = JSON.parse(readFileSync(keyPath, "utf8")); } catch { throw new Error("Could not read Play service account credentials."); }
	try { bytes = readFileSync(aabPath); } catch { throw new Error("Could not read the AAB payload."); }
	const token = await accessToken(key);
	await publishBundle({ bytes, track: arg("--track", "internal"), notes: arg("--notes", ""), versionName: arg("--version-name", ""), expectedVersionCode: arg("--expected-code") },
		(method, path, options) => api(token, method, path, options), m => console.log(`[play-upload] ${m}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
	try { await main(); } catch (error) { console.error(`[play-upload] ${error.message}`); process.exitCode = 1; }
}
