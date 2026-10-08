/* The installed web app's share target: shared text lands on /share and turns
 * into a prefilled /check or /reply. Apps fill title/text/url inconsistently,
 * so each part is kept only when it adds something.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MAX_SHARED_TEXT_LENGTH, combineSharedText, shareActionHref, sharedLinkKind } from "../src/lib/share-target.ts";

test("text alone passes through, trimmed", () => {
	assert.equal(combineSharedText({ text: "  karma is biblical  " }), "karma is biblical");
});

test("a link repeated inside the text is not added twice, and a title inside the text is dropped", () => {
	const text = "Watch this https://example.com/v";
	assert.equal(combineSharedText({ title: "Watch this", text, url: "https://example.com/v" }), text);
	assert.equal(
		combineSharedText({ title: "Discord", text: "God helps those who help themselves", url: "https://x.y/z" }),
		"Discord\n\nGod helps those who help themselves\n\nhttps://x.y/z",
	);
});

test("arrays read their first value, empty input is empty, and long input is capped", () => {
	assert.equal(combineSharedText({ text: ["first", "second"] }), "first");
	assert.equal(combineSharedText({}), "");
	assert.equal(combineSharedText({ text: "x".repeat(MAX_SHARED_TEXT_LENGTH + 50) }).length, MAX_SHARED_TEXT_LENGTH);
});

test("the two actions prefill the chat with the command and the text", () => {
	assert.equal(shareActionHref("check", "karma"), `/?prompt=${encodeURIComponent("/check karma")}`);
	assert.equal(shareActionHref("reply", "hi"), `/?prompt=${encodeURIComponent("/reply hi")}`);
});

test("the manifest declares the share target at /share", () => {
	const manifest = JSON.parse(readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"));
	assert.equal(manifest.share_target.action, "/share");
	assert.equal(manifest.share_target.method, "GET");
	assert.deepEqual(manifest.share_target.params, { title: "title", text: "text", url: "url" });
});

test("share target: a shared link offers Verify, worded for a video when it is one", () => {
	assert.equal(sharedLinkKind("https://youtu.be/GMwihA5jnhY?si=abc"), "video");
	assert.equal(sharedLinkKind("Read this https://example.com/post"), "link");
	assert.equal(sharedLinkKind("https://notyoutube.com/watch?v=GMwihA5jnhY"), "link");
	assert.equal(sharedLinkKind("Karma is in the Bible, right?"), null);
	assert.equal(shareActionHref("verify", "https://youtu.be/x"), `/?prompt=${encodeURIComponent("/verify https://youtu.be/x")}`);
});
