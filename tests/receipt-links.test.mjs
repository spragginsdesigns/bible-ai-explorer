import assert from "node:assert/strict";
import test from "node:test";

import { receiptHref } from "../src/lib/chat/receipt-links.ts";

// One case per shape in ChatReceiptTarget, so a new screen added to the
// contract without a route fails here rather than rendering a dead fragment.
test("receipt links: note targets open the notes page with the note selected", () => {
	assert.equal(receiptHref({ screen: "note", noteId: "note_123" }), "/notes?note=note_123");
});

test("receipt links: note ids are URL-encoded", () => {
	assert.equal(
		receiptHref({ screen: "note", noteId: "a b/c?d&e" }),
		"/notes?note=a%20b%2Fc%3Fd%26e"
	);
});

test("receipt links: memory targets open the Settings memory section", () => {
	assert.equal(receiptHref({ screen: "memories" }), "/settings#memory");
	assert.equal(receiptHref({ screen: "memories", memoryId: "mem_1" }), "/settings#memory");
});

test("receipt links: chapter targets carry book and chapter", () => {
	assert.equal(receiptHref({ screen: "chapter", book: 43, chapter: 3 }), "/bible/chapter?book=43&chapter=3");
});

test("receipt links: chapter targets carry verse and translation when present", () => {
	assert.equal(
		receiptHref({ screen: "chapter", book: 43, chapter: 3, verse: 16, translation: "KJV" }),
		"/bible/chapter?book=43&chapter=3&verse=16&translation=KJV"
	);
	assert.equal(
		receiptHref({ screen: "chapter", book: 19, chapter: 23, verse: 1, translation: "BSB" }),
		"/bible/chapter?book=19&chapter=23&verse=1&translation=BSB"
	);
	assert.equal(
		receiptHref({ screen: "chapter", book: 1, chapter: 1, translation: "NKJV" }),
		"/bible/chapter?book=1&chapter=1&translation=NKJV"
	);
});

test("receipt links: plan, reading history, cross and learn have their own pages", () => {
	assert.equal(receiptHref({ screen: "plan" }), "/bible/plan");
	assert.equal(receiptHref({ screen: "readingHistory" }), "/bible/history");
	assert.equal(receiptHref({ screen: "cross" }), "/cross");
	assert.equal(receiptHref({ screen: "learn" }), "/bible/learn");
});

test("receipt links: settings targets use the section anchors the sidebar uses", () => {
	assert.equal(receiptHref({ screen: "settings" }), "/settings");
	assert.equal(receiptHref({ screen: "settings", section: "memory" }), "/settings#memory");
	assert.equal(receiptHref({ screen: "settings", section: "church" }), "/settings#church");
	// No "preferences" anchor exists on the page; the rows are spread across
	// Appearance, Bible translation and Web search.
	assert.equal(receiptHref({ screen: "settings", section: "preferences" }), "/settings");
});
