import assert from "node:assert/strict";
import test from "node:test";

import { linksInText, normalizeLink } from "../src/lib/chat/user-links.ts";

// readLink opens only what the user typed, so these are the whole allowlist.
test("user links: a /verify link is found and normalized the way readLink compares it", () => {
	assert.deepEqual(linksInText("/verify https://Example.com/article#comments"), ["https://example.com/article"]);
	assert.equal(normalizeLink("https://example.com/article"), "https://example.com/article");
});

test("user links: the sentence's punctuation is not part of the link", () => {
	assert.deepEqual(linksInText("Is this true? https://example.com/post. And www.blog.org/x!"), [
		"https://example.com/post",
		"https://www.blog.org/x",
	]);
});

test("user links: plain words, bare domains and other schemes are not links", () => {
	assert.deepEqual(linksInText("Karma is in the Bible, right? example.com"), []);
	assert.equal(normalizeLink("javascript:alert(1)"), null);
});

test("user links: a link the user never typed does not match one they did", () => {
	const allowed = linksInText("/verify https://example.com/article");
	assert.equal(allowed.includes(normalizeLink("https://evil.example/?d=memories")), false);
	assert.equal(allowed.includes(normalizeLink("https://example.com/article")), true);
});
