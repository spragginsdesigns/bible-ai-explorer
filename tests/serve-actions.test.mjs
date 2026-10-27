/* Ways to Serve on the web: what each way's button does (GitHub issue #28).
 *
 * Pins the mapping from the server's `action` to a web destination, so a
 * button never opens chat already sent, never offers a giving link that is
 * not there, and falls back to chat when nearby search is unavailable.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	MY_CHURCH_HREF,
	NEARBY_FALLBACK_PROMPT,
	PRAY_PROMPT,
	chatPrefillHref,
	serveActionLabel,
	serveActionTarget,
	verseRangeLabel,
} from "../src/components/serve/serveActions.ts";
import { NEARBY_WAYS, ONLINE_WAYS } from "../src/lib/serve-rules.ts";

const way = (action, title = "Check on someone", reference = "Galatians 6:2") => ({ title, action, verse: { reference } });
const base = { nearbyAvailable: true, churchWebsite: "https://church.example/give" };

function promptOf(target) {
	assert.equal(target.type, "chat");
	assert.ok(target.href.startsWith("/?prompt="));
	return new URLSearchParams(target.href.slice(2)).get("prompt");
}

test("share-verse opens Send a word for the way's own verse", () => {
	assert.deepEqual(serveActionTarget(way("share-verse", "Send someone a verse", "Hebrews 3:13"), base), {
		type: "send-word",
		reference: "Hebrews 3:13",
	});
});

test("share-verse without a reference falls back to a prefilled chat", () => {
	assert.equal(promptOf(serveActionTarget(way("share-verse", "x", ""), base)), "Help me send someone a verse with a word of encouragement");
});

test("pray and reach-out prefill chat and never send", () => {
	assert.equal(promptOf(serveActionTarget(way("pray"), base)), PRAY_PROMPT);
	assert.equal(
		promptOf(serveActionTarget(way("reach-out", "Call someone who's alone"), base)),
		"Help me write a kind message to call someone who's alone."
	);
	assert.equal(chatPrefillHref("a & b"), "/?prompt=a%20%26%20b");
});

test("nearby and give-need focus the search when it is available, else ask in chat", () => {
	for (const action of ["nearby", "give-need"]) {
		assert.deepEqual(serveActionTarget(way(action), base), { type: "focus", section: "nearby" });
		assert.equal(promptOf(serveActionTarget(way(action), { ...base, nearbyAvailable: false })), NEARBY_FALLBACK_PROMPT);
	}
});

test("church opens My church; give-church opens only a real web address", () => {
	assert.deepEqual(serveActionTarget(way("church"), base), { type: "link", href: MY_CHURCH_HREF, external: false });
	assert.deepEqual(serveActionTarget(way("give-church"), base), { type: "link", href: "https://church.example/give", external: true });
	assert.equal(serveActionTarget(way("give-church"), { ...base, churchWebsite: null }), null);
	assert.equal(serveActionTarget(way("give-church"), { ...base, churchWebsite: "javascript:alert(1)" }), null);
});

test("journal focuses the journal; no action means no button", () => {
	assert.deepEqual(serveActionTarget(way("journal"), base), { type: "focus", section: "journal" });
	assert.equal(serveActionTarget(way(null), base), null);
});

test("every way the server can send maps to a labelled button or deliberately none", () => {
	for (const serveWay of [...ONLINE_WAYS, ...NEARBY_WAYS]) {
		const target = serveActionTarget({ ...serveWay, verse: { reference: "John 3:16" } }, base);
		assert.ok(target, serveWay.id);
		const label = serveActionLabel(serveWay.action, target);
		assert.ok(label.length > 0, serveWay.id);
		assert.doesNotMatch(label, /[--]/, serveWay.id);
	}
});

test("consecutive verses in one chapter read as a range", () => {
	assert.equal(verseRangeLabel(["Ephesians 2:8", "Ephesians 2:9", "Ephesians 2:10"]), "Ephesians 2:8-10");
	assert.equal(verseRangeLabel(["1 John 3:18"]), "1 John 3:18");
	assert.equal(verseRangeLabel(["Ephesians 2:8", "Ephesians 2:10"]), "Ephesians 2:8; Ephesians 2:10");
	assert.equal(verseRangeLabel([]), "");
});
