/* Ways to Serve (GitHub issue #28): optional, faith first, never a scorecard.
 *
 * Pins Austin's decisions of 2026-10-27: the reader picks off/nearby/online/
 * both (online by default), "I already give to my church" removes every
 * suggestion to give there and keeps giving out of the daily pick, every verse
 * is real KJV, and no wording counts deeds or ties serving to salvation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	DEFAULT_SERVE_MODE,
	FAITH_FIRST_REFS,
	FAITH_FIRST_TEXT,
	JOURNAL_PROMPT,
	JOURNAL_REF,
	NEARBY_WAYS,
	ONLINE_WAYS,
	SERVE_MODES,
	SERVE_TITLE,
	cleanEntryText,
	cleanLocation,
	parseVerseRef,
	pickToday,
	readServeMode,
	waysFor,
} from "../src/lib/serve-rules.ts";
import { getKjvBookNumber, getKjvVerseText } from "../src/utils/kjvBible.ts";

const ALL = [...ONLINE_WAYS, ...NEARBY_WAYS];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("modes: off, nearby, online, both, with online the default", () => {
	assert.deepEqual([...SERVE_MODES], ["off", "nearby", "online", "both"]);
	assert.equal(DEFAULT_SERVE_MODE, "online");
	assert.equal(readServeMode(null), "online");
	assert.equal(readServeMode("garbage"), "online");
	assert.equal(readServeMode("both"), "both");
});

test("it is called Ways to Serve and says first that serving never saves", () => {
	assert.equal(SERVE_TITLE, "Ways to Serve");
	assert.match(FAITH_FIRST_TEXT, /^Serving never saves anyone\./);
	assert.match(FAITH_FIRST_TEXT, /by grace through faith/);
	assert.match(FAITH_FIRST_TEXT, /None of them is required/);
	assert.deepEqual(FAITH_FIRST_REFS.map((ref) => `${ref.book} ${ref.chapter}:${ref.verse}`), ["Ephesians 2:8", "Ephesians 2:9", "Ephesians 2:10"]);
});

test("no wording counts deeds, demands them, or ties them to salvation", () => {
	const copy = [FAITH_FIRST_TEXT, JOURNAL_PROMPT, ...ALL.flatMap((way) => [way.title, way.detail])].join("\n");
	assert.doesNotMatch(copy, /\b(streak|points?|score|badge|level|rank|earn|you must|required to|should have)\b/i);
	assert.doesNotMatch(copy, /\bsaved? by (serving|works|giving)\b/i);
	for (const way of ALL) assert.doesNotMatch(way.title, /^(You must|Must|Do)\b/, way.id);
});

test("every way, the intro and the journal sit on a real KJV verse", async () => {
	for (const ref of [...FAITH_FIRST_REFS, JOURNAL_REF, ...ALL.map((way) => way.ref)]) {
		const book = getKjvBookNumber(ref.book);
		assert.ok(book, ref.book);
		const text = await getKjvVerseText(book, ref.chapter, ref.verse);
		assert.ok(text && text.length > 10, `${ref.book} ${ref.chapter}:${ref.verse}`);
	}
	const ids = ALL.map((way) => way.id);
	assert.equal(new Set(ids).size, ids.length, "way ids are unique");
});

test("the mode decides which ways are offered", () => {
	const base = { hasChurch: true, givesToChurch: false };
	assert.deepEqual(waysFor({ ...base, mode: "off" }), []);
	assert.ok(waysFor({ ...base, mode: "online" }).every((way) => way.kind === "online"));
	assert.ok(waysFor({ ...base, mode: "nearby" }).every((way) => way.kind === "nearby"));
	assert.equal(waysFor({ ...base, mode: "both" }).length, ALL.length);
});

test("church ways need a church, and 'I already give' removes giving to it", () => {
	const noChurch = waysFor({ mode: "both", hasChurch: false, givesToChurch: false });
	assert.ok(!noChurch.some((way) => way.needsChurch));
	const gives = waysFor({ mode: "both", hasChurch: true, givesToChurch: true });
	assert.ok(!gives.some((way) => way.giving === "church"));
	assert.ok(gives.some((way) => way.id === "church-hands"), "serving at church is still offered");
});

test("today's way is stable per reader per day and walks the list without repeats", () => {
	const context = { mode: "both", hasChurch: true, givesToChurch: false };
	assert.equal(pickToday("user_a", "2026-10-27", context)?.id, pickToday("user_a", "2026-10-27", context)?.id);
	const ways = waysFor(context);
	const seen = new Set();
	for (let day = 0; day < ways.length; day++) {
		const key = new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);
		seen.add(pickToday("user_a", key, context)?.id);
	}
	assert.equal(seen.size, ways.length, "a full cycle shows every way exactly once");
	assert.equal(pickToday("user_a", "2026-10-27", { ...context, mode: "off" }), null);
});

test("someone who already gives to their church is never handed a giving suggestion as today's way", () => {
	const context = { mode: "both", hasChurch: true, givesToChurch: true };
	for (let day = 0; day < 60; day++) {
		const key = new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);
		assert.equal(pickToday("user_austin", key, context)?.giving, undefined, key);
	}
});

test("journal text, verse references and locations are bounded", () => {
	assert.equal(cleanEntryText("  helped carry groceries  "), "helped carry groceries");
	assert.equal(cleanEntryText("   "), null);
	assert.equal(cleanEntryText("x".repeat(1001)), null);
	assert.deepEqual(parseVerseRef("Matthew 25:40"), { book: "Matthew", chapter: 25, verse: 40 });
	assert.deepEqual(parseVerseRef("1 John 3:18"), { book: "1 John", chapter: 3, verse: 18 });
	assert.equal(parseVerseRef("not a verse"), null);
	assert.equal(cleanLocation("Fresno, CA"), "Fresno, CA");
	assert.equal(cleanLocation("x"), null);
});

test("the chat knows Ways to Serve and treats serving as fruit, never root, in every answer", async () => {
	const { chatSystemPrompt, discernmentGuidance } = await import("../src/utils/systemPrompt.ts");
	assert.match(discernmentGuidance, /always the fruit of faith, never its root/);
	assert.ok(chatSystemPrompt("KJV", {}).includes(discernmentGuidance));
	const tools = read("src/lib/ai-tools.ts");
	assert.match(tools, /buildServeTools\(context\.userId\)/);
	const labels = read("src/lib/tool-activity-labels.ts");
	for (const name of ["getWaysToServe", "saveServeEntry", "listServeEntries"]) assert.match(labels, new RegExp(`${name}:`));
	assert.match(read("src/lib/account-deletion.ts"), /model: "ServiceEntry"/);
});
