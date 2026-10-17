import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	findPassageForReference,
	groupRetrievedVerses,
	passagePlainText,
	passagesSummary,
} from "../src/lib/chat/versePassages.ts";

// A minimal resolver: the real ones (web verseParser, Android verseLinks) map
// book names to canon order; these tests only need a stable book key.
const BOOKS = { genesis: 1, psalms: 19, ps: 19, acts: 44, "2 peter": 61, revelation: 66 };
function resolve(reference) {
	// The en dash comes from its code point: this PC's tools flatten a literal or escape.
	const match = new RegExp(
		String.raw`^(.*\S)\s+(\d+)(?::(\d+))?(?:\s*[-` + String.fromCharCode(0x2013) + String.raw`]\s*\d+)?(?:\s+KJV)?$`
	).exec(reference.trim());
	if (!match) return null;
	const order = BOOKS[match[1].toLowerCase()];
	if (!order) return null;
	return { order, chapter: Number(match[2]), ...(match[3] ? { verse: Number(match[3]) } : {}) };
}

const passage = (reference, text) => ({ reference, similarity: 1, text, translation: "KJV", source: "passage" });
const hit = (reference, similarity) => ({ reference, similarity, text: `${reference} text`, translation: "KJV" });

test("verse passages: the Android copy is byte-identical", () => {
	const web = readFileSync(new URL("../src/lib/chat/versePassages.ts", import.meta.url), "utf8");
	const mobile = readFileSync(new URL("../mobile/src/lib/versePassages.ts", import.meta.url), "utf8");
	assert.equal(mobile, web);
});

test("verse passages: a getPassage range reads as one passage, not one row per verse", () => {
	const grouped = groupRetrievedVerses(
		[passage("Psalms 56:1", "Be merciful"), passage("Psalms 56:2", "Mine enemies"), passage("Psalms 56:3", "What time"), passage("Psalms 56:4", "In God")],
		{ resolve }
	);
	assert.equal(grouped.passages.length, 1);
	assert.equal(grouped.passages[0].reference, "Psalms 56:1-4");
	assert.equal(grouped.passages[0].firstReference, "Psalms 56:1");
	assert.deepEqual(grouped.passages[0].verses.map((v) => v.verse), [1, 2, 3, 4]);
	assert.equal(passagePlainText(grouped.passages[0]), "1 Be merciful 2 Mine enemies 3 What time 4 In God");
	assert.equal(passagesSummary(grouped), "1 passage");
});

test("verse passages: passages follow the order the answer cites them", () => {
	// Production turn 2026-10-15 ("The New Heavens and Earth"): lookups ran
	// Revelation, then 2 Peter, then Genesis; the answer cites Genesis first.
	const grouped = groupRetrievedVerses(
		[
			passage("Revelation 21:1", "a"), passage("Revelation 21:2", "b"),
			passage("2 Peter 3:10", "c"), passage("2 Peter 3:11", "d"),
			passage("Genesis 1:31", "e"),
			passage("Acts 19:13", "uncited"),
		],
		{ resolve, citedReferences: ["Genesis 1:31", "2 Peter 3:10-13", "Ps 99:1", "Revelation 21:2"] }
	);
	assert.deepEqual(
		grouped.passages.map((p) => p.reference),
		["Genesis 1:31", "2 Peter 3:10-11", "Revelation 21:1-2", "Acts 19:13"]
	);
});

test("verse passages: a gap, a new chapter or a new translation starts a new passage", () => {
	const grouped = groupRetrievedVerses(
		[
			passage("Psalms 56:1", "a"), passage("Psalms 56:3", "b"),
			passage("Psalms 57:1", "c"),
			{ ...passage("Psalms 57:2", "d"), translation: "NKJV" },
		],
		{ resolve }
	);
	assert.deepEqual(grouped.passages.map((p) => p.reference), ["Psalms 56:1", "Psalms 56:3", "Psalms 57:1", "Psalms 57:2"]);
});

test("verse passages: search hits stay separate, keep their order and lose duplicates of passages", () => {
	const grouped = groupRetrievedVerses(
		[hit("Acts 19:15", 0.81), hit("Acts 19:13", 0.7), passage("Acts 19:13", "x"), hit("Acts 19:15", 0.6)],
		{ resolve }
	);
	assert.deepEqual(grouped.passages.map((p) => [p.reference, p.similarity]), [["Acts 19:13", null]]);
	assert.deepEqual(grouped.searchHits.map((p) => [p.reference, p.similarity]), [["Acts 19:15", 0.81]]);
	assert.equal(passagesSummary(grouped), "1 passage · 1 search result");
});

test("verse passages: a repeated lookup does not duplicate verses", () => {
	const grouped = groupRetrievedVerses(
		[passage("Psalms 56:1", "a"), passage("Psalms 56:2", "b"), passage("Psalms 56:1", "a"), passage("Psalms 56:2", "b")],
		{ resolve }
	);
	assert.equal(grouped.passages.length, 1);
	assert.deepEqual(grouped.passages[0].verses.map((v) => v.verse), [1, 2]);
});

test("verse passages: an unparseable reference still shows on its own", () => {
	const grouped = groupRetrievedVerses([{ reference: "Psalm of David", similarity: 0.5, text: "t" }], { resolve });
	assert.equal(grouped.searchHits.length, 1);
	assert.equal(grouped.searchHits[0].reference, "Psalm of David");
	assert.equal(passagePlainText(grouped.searchHits[0]), "t");
});

test("verse passages: a tapped reference finds its passage, including abbreviations and ranges", () => {
	const grouped = groupRetrievedVerses(
		[passage("Psalms 56:1", "a"), passage("Psalms 56:2", "b"), passage("Psalms 56:3", "c"), hit("Acts 19:15", 0.8)],
		{ resolve }
	);
	assert.equal(findPassageForReference(grouped, "Ps 56:3", resolve)?.reference, "Psalms 56:1-3");
	assert.equal(findPassageForReference(grouped, "Psalms 56:2-3", resolve)?.reference, "Psalms 56:1-3");
	assert.equal(findPassageForReference(grouped, "Acts 19:15", resolve)?.kind, "search");
	assert.equal(findPassageForReference(grouped, "Psalms 56:9", resolve), null);
	assert.equal(findPassageForReference(grouped, "Genesis 1:1", resolve), null);
});

test("verse passages: word-match hits carry no score, scored hits keep theirs", () => {
	const grouped = groupRetrievedVerses(
		[{ ...hit("Acts 19:13", 1), source: "exact" }, hit("Acts 19:15", 0.72)],
		{ resolve }
	);
	assert.deepEqual(grouped.searchHits.map((p) => [p.reference, p.similarity]), [["Acts 19:13", null], ["Acts 19:15", 0.72]]);
});

test("verse passages: a cited range matches a passage that holds any verse of it", () => {
	const grouped = groupRetrievedVerses(
		[passage("Acts 19:13", "a"), passage("2 Peter 3:10", "b"), passage("2 Peter 3:11", "c")],
		{ resolve, citedReferences: ["2 Peter 3:5-13"] }
	);
	assert.deepEqual(grouped.passages.map((p) => p.reference), ["2 Peter 3:10-11", "Acts 19:13"]);
	assert.equal(findPassageForReference(grouped, `2 Peter 3:5${String.fromCharCode(0x2013)}13 KJV`, resolve)?.reference, "2 Peter 3:10-11");
	assert.equal(findPassageForReference(grouped, "2 Peter 3:5-9", resolve), null);
});
