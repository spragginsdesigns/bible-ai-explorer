import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the original-language builder reads pinned commits, verifies hashes and never evals", () => {
	const builder = read("scripts/build-original-languages.mjs");
	const lock = JSON.parse(read("scripts/build-original-languages.lock.json"));
	const bases = [...builder.matchAll(/^const RAW_\w+ = "([^"]+)";$/gm)].map((match) => match[1]);

	assert.equal(bases.length, 3);
	for (const base of bases) {
		assert.match(base, /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\/[0-9a-f]{40}(\/|$)/, base);
	}
	assert.doesNotMatch(builder, /\beval\b/);
	assert.match(builder, /lock\[url\] !== sha256/);

	const urls = Object.keys(lock);
	assert.equal(urls.length, 39 + 27 + 2);
	for (const url of urls) {
		assert.ok(bases.some((base) => url.startsWith(`${base}/`)), `${url} is outside the pinned sources`);
		assert.match(lock[url], /^[0-9a-f]{64}$/, url);
	}
});

test("Android publishing refuses artifacts not signed by the pinned upload certificate", () => {
	const pins = read("mobile/scripts/upload-cert.sha256")
		.split("\n")
		.map((line) => line.replace(/#.*/, "").trim())
		.filter(Boolean);
	assert.deepEqual(pins, ["5f7f48390a7486eb3b2ecd4a81b106e38ce5d9d21cf84743f88ba9b1c51fca6a"]);

	const pushPhone = read("mobile/scripts/push-phone.sh");
	const signer = pushPhone.indexOf('release_require_android_signer "$AAB"');
	const apkSigner = pushPhone.indexOf('release_require_android_signer "$APK"');
	const source = pushPhone.indexOf("release_require_unchanged_source");
	const upload = pushPhone.indexOf('node "$MOBILE_DIR/scripts/play-upload.mjs"');
	assert.ok(signer > 0 && apkSigner > 0 && source > 0, "push-phone.sh runs the signer and source checks");
	assert.ok(signer < upload && apkSigner < upload && source < upload, "checks run before the Play upload");

	const releaseApk = read("mobile/scripts/release-apk.sh");
	assert.ok(releaseApk.indexOf("release_require_android_signer") < releaseApk.indexOf("gh release create"));

	const buildAab = read("mobile/scripts/build-aab.sh");
	for (const field of ["signerSha256", "sourceCommit", "sourceSha256"]) {
		assert.ok(buildAab.includes(field), `build-aab.sh records ${field}`);
	}

	// A drift refusal points at the no-bump rebuild, which push-phone supports.
	assert.ok(pushPhone.includes("bash mobile/scripts/push-phone.sh --rebuild"));
	assert.match(pushPhone, /--rebuild\) REBUILD=1/);
});

test("the source digest ignores only files that cannot reach the binary", () => {
	const lib = read("scripts/lib/release-provenance.sh");
	for (const excluded of [
		"mobile/src/**/*.test.*",
		"mobile/src/**/__fixtures__/**",
		"mobile/scripts/play-*.mjs",
		"macos/*Tests/**",
	]) {
		assert.ok(lib.includes(excluded), `${excluded} is excluded`);
	}
	// expo-router turns every file under app/ into a route, and the build
	// scripts patch Gradle, so neither may ever be excluded.
	assert.doesNotMatch(lib, /exclude[^"]*mobile\/app/);
	assert.doesNotMatch(lib, /exclude[^"]*(build-aab|push-phone)\.sh/);
});

test("the macOS DMG is checked for its signer and provenance before any GitHub write", () => {
	const releaseDmg = read("macos/release-dmg.sh");
	const firstWrite = releaseDmg.indexOf("git -C \"$repo_root\" tag -f");
	for (const check of ["codesign --verify --deep --strict", 'team_id="389LLKGY3Y"', "release_require_unchanged_source", "dmgSha256"]) {
		const at = releaseDmg.indexOf(check);
		assert.ok(at > 0 && at < firstWrite, `${check} runs before the tag and release are written`);
	}
	assert.ok(releaseDmg.indexOf("appCdhash") < firstWrite, "the DMG app must be the recorded build");

	const buildDmg = read("scripts/build-dmg.sh");
	assert.ok(buildDmg.indexOf("release_require_app_build") < buildDmg.indexOf("create-dmg \\"), "no packaging without a build record");
	const installMac = read("macos/install-mac.sh");
	assert.ok(installMac.indexOf("release_source_listing") < installMac.indexOf("xcodebuild -project"), "source is snapshotted before xcodebuild");
	assert.ok(installMac.includes("release_record_app_build"));
});
