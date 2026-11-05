import { test } from "node:test";
import assert from "node:assert/strict";
import { plainVerseInsight } from "../src/lib/verse-insight-text.ts";

const words = text => text.replace(/[*>]/g, " ").split(/\s+/).filter(Boolean);

test("flattens the verifier's expanded passage after the prose", () => {
	const raw = "Romans 5:8 shows God’s love toward us.\n\n**Romans 5:8 (KJV)**\n> 8 But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.";
	assert.equal(plainVerseInsight(raw),
		"Romans 5:8 shows God’s love toward us.\n\nRomans 5:8 (KJV)\n8 But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.");
});

test("separates a leading passage from the prose that follows, even without a blank line", () => {
	const raw = "**Numbers 1:1 (BSB)**\n> 1 On the first day of the second month.\nNumbers 1:1 dates the event.";
	assert.equal(plainVerseInsight(raw), "Numbers 1:1 (BSB)\n1 On the first day of the second month.\n\nNumbers 1:1 dates the event.");
});

test("keeps every verse of a range on its own line", () => {
	const raw = "**John 3:16-17 (KJV)**\n> 16 For God so loved the world,\n> 17 For God sent not his Son\n\nBoth verses speak of the Son.";
	assert.equal(plainVerseInsight(raw), "John 3:16-17 (KJV)\n16 For God so loved the world,\n17 For God sent not his Son\n\nBoth verses speak of the Son.");
});

test("never adds, drops or reorders a word", () => {
	const raw = "Intro **bold** word.\n\n**Genesis 8:1 (KJV)**\n> 1 And God remembered Noah\n\nIn this verse, remembered describes care.\n\n\n\nEnd.";
	assert.deepEqual(words(plainVerseInsight(raw)), words(raw));
});

test("leaves plain text untouched", () => {
	const raw = "Psalm 23:1 calls the LORD a shepherd.\n\nHe provides.";
	assert.equal(plainVerseInsight(raw), raw);
});

test("leaves the fixed withholding notice untouched", () => {
	const notice = "I couldn't finish checking this answer against Scripture, so I've withheld it. Please try again.";
	assert.equal(plainVerseInsight(notice), notice);
});
