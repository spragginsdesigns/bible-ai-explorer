import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Austin, 2026-10-09: the Play Store and App Store say the same thing. The
// App Store description is the Play full description plus Apple's required
// subscription terms and links, and the Play short description is the App
// Store promotional text. Both docs are the source of truth the stores are
// filled from, so drift here becomes drift in the stores.
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const play = read("store-listing/play-store.md");
const apple = read("store-listing/app-store.md");

const fenced = (doc, heading) => {
	const at = doc.indexOf(heading);
	assert.ok(at >= 0, `missing heading ${heading}`);
	const match = /```\n([\s\S]*?)\n```/.exec(doc.slice(at));
	assert.ok(match, `no fenced block under ${heading}`);
	return match[1];
};
const chars = (text) => [...text].length;

const playFull = fenced(play, "## Full description");
const appleFull = fenced(apple, "## Description (4000 max)");
const appleFooterStart = "\n\nPayment is charged to your Apple Account";

test("the App Store description is the Play description plus Apple's subscription footer", () => {
	const cut = appleFull.indexOf(appleFooterStart);
	assert.ok(cut > 0, "App Store description lost its subscription terms footer");
	assert.equal(appleFull.slice(0, cut), playFull);
	for (const line of ["https://sureword.app/terms", "https://sureword.app/privacy", "renews automatically"]) {
		assert.ok(appleFull.includes(line), `App Store footer is missing ${line}`);
	}
});

test("the Play short description is the App Store promotional text", () => {
	const promo = fenced(apple, "## Promotional text");
	const short = fenced(play, "## Short description");
	assert.equal(short, promo);
	assert.ok(chars(short) <= 80, `Play short description is ${chars(short)} chars (max 80)`);
});

test("listing text fits each store's limits and carries no dashes", () => {
	assert.ok(chars(playFull) <= 4000, `Play description is ${chars(playFull)} chars`);
	assert.ok(chars(appleFull) <= 4000, `App Store description is ${chars(appleFull)} chars`);
	const keywords = fenced(apple, "## Keywords");
	assert.ok(chars(keywords) <= 100, `keywords are ${chars(keywords)} chars`);
	assert.ok(!/,\s/.test(keywords), "App Store keywords must not have spaces after commas");
	// Char codes, not \u escapes: editors on this Windows PC flatten those escapes
	// to plain hyphens, which would turn this check against every hyphen.
	const dashes = [0x2013, 0x2014].map((code) => String.fromCharCode(code));
	assert.ok(!dashes.some((dash) => (playFull + appleFull).includes(dash)), "agents write no em or en dashes");
});
