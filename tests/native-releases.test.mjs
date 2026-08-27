import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	FALLBACK_NATIVE_RELEASES,
	selectLatestNativeRelease,
	selectNativeReleases,
} from "../src/lib/native-releases.ts";

const asset = (name, url) => ({ name, browser_download_url: url });
const release = (tag_name, options = {}) => ({
	tag_name,
	draft: false,
	published_at: options.published_at ?? "2026-08-01T00:00:00Z",
	assets: options.assets ?? [],
	...options,
});

test("selects each platform independently by newest published eligible release", () => {
	const releases = [
		release("android-v1.19.0", {
			published_at: "2026-08-02T00:00:00Z",
			assets: [asset("SureWord.apk", "https://example.test/android-119.apk")],
		}),
		release("android-v1.20.0", {
			published_at: "2026-08-03T00:00:00Z",
			assets: [asset("notes.txt", "https://example.test/notes.txt")],
		}),
		release("macos-v1.4.0", {
			published_at: "2026-08-01T00:00:00Z",
			assets: [asset("SureWord.dmg", "https://example.test/macos-140.dmg")],
		}),
		release("android-v1.18.0", {
			published_at: "2026-07-01T00:00:00Z",
			assets: [asset("SureWord.apk", "https://example.test/android-118.apk")],
		}),
	];

	assert.deepEqual(selectNativeReleases(releases), {
		android: { version: "1.19.0", url: "https://example.test/android-119.apk" },
		macos: { version: "1.4.0", url: "https://example.test/macos-140.dmg" },
	});
});

test("ignores drafts and prereleases and falls back independently when a platform has no asset", () => {
	const releases = [
		release("android-v2.0.0", {
			draft: true,
			assets: [asset("SureWord.apk", "https://example.test/draft.apk")],
		}),
		release("android-v2.1.0-beta.1", {
			prerelease: true,
			assets: [asset("SureWord.apk", "https://example.test/prerelease.apk")],
		}),
		release("macos-v1.5.0", {
			assets: [asset("SureWord.dmg", "https://example.test/macos-150.dmg")],
		}),
	];

	assert.equal(selectLatestNativeRelease(releases, "android"), null);
	assert.deepEqual(selectNativeReleases(releases), {
		android: FALLBACK_NATIVE_RELEASES.android,
		macos: { version: "1.5.0", url: "https://example.test/macos-150.dmg" },
	});
});

test("uses the stable fallback URLs and Latest marker", () => {
	assert.deepEqual(FALLBACK_NATIVE_RELEASES, {
		android: {
			version: "Latest",
			url: "https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk",
		},
		macos: {
			version: "Latest",
			url: "https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.dmg",
		},
	});
});

test("keeps native release metadata public for signed-out download cards", async () => {
	const middleware = await readFile("src/middleware.ts", "utf8");
	assert.match(middleware, /["']\/api\/native-releases["']/);
});

test("Android publish binds and verifies one AAB/APK pair before Play", async () => {
	const [build, publish] = await Promise.all([
		readFile("mobile/scripts/build-aab.sh", "utf8"),
		readFile("mobile/scripts/push-phone.sh", "utf8"),
	]);

	assert.match(build, /bundleRelease assembleRelease/);
	assert.match(build, /release-artifacts\.env/);
	assert.match(build, /aabSha256/);
	assert.match(build, /apkSha256/);

	const verification = publish.indexOf("EXPECTED_AAB_SHA");
	const playUpload = publish.lastIndexOf("play-upload.mjs");
	const githubPublish = publish.lastIndexOf("release-apk.sh");
	assert.ok(verification >= 0 && verification < playUpload);
	assert.ok(githubPublish > playUpload);
	assert.match(publish.slice(0, playUpload), /release-apk\.sh" --preflight/);
});

test("platform release scripts fail closed while preserving fixed-name assets", async () => {
	const [android, macos] = await Promise.all([
		readFile("mobile/scripts/release-apk.sh", "utf8"),
		readFile("macos/release-dmg.sh", "utf8"),
	]);

	assert.match(android, /No published macOS release exists to preserve/);
	assert.doesNotMatch(android, /SureWord\.dmg[^\n]*\|\| true/);
	assert.match(android, /isPrerelease == false/);
	assert.match(macos, /no published Android release exists to preserve/);
	assert.match(macos, /SureWord\.apk/);
	assert.match(macos, /isPrerelease == false/);
	assert.match(macos, /CFBundleShortVersionString/);
	assert.match(macos, /DMG contains SureWord/);
});
