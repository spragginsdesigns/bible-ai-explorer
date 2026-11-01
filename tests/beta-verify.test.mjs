/**
 * SureWord Beta's Scripture Check (LC-17649, docs/beta/verify.md): the pure
 * rules that decide a quotation's verdict, word by word, and find what a
 * teaching quotes. Verse text below is the bundled KJV and BSB, verbatim.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	alignWords,
	citesAfter,
	citesBefore,
	findQuoteSpans,
	isSamePassage,
	looseWord,
	presentedAsScripture,
	quotationVerdict,
	romanToNumber,
	tokenize,
} from "../src/lib/beta/verify/verify-rules.ts";

const MATTHEW_11_28 = "Come unto me, all ye that labour and are heavy laden, and I will give you rest.";
const ISAIAH_41_10 = "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.";
const ISAIAH_43_1 = "But now thus saith the LORD that created thee, O Jacob, and he that formed thee, O Israel, Fear not: for I have redeemed thee, I have called thee by thy name; thou art mine.";
const ROMANS_9_22 = "What if God, willing to shew his wrath, and to make his power known, endured with much longsuffering the vessels of wrath fitted to destruction:";
const PETER_5_7_BSB = "Cast all your anxiety on Him, because He cares for you.";
const GENESIS_6_1 = "And it came to pass, when men began to multiply on the face of the earth, and daughters were born unto them,";

function check(quote, verse, stated = null) {
	const q = tokenize(quote);
	const alignment = alignWords(q, tokenize(verse, 0));
	return { alignment, verdict: quotationVerdict(alignment, q, stated) };
}

test("a word-for-word quotation of part of a verse is exact", () => {
	const { alignment, verdict } = check("Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee", ISAIAH_41_10);
	assert.equal(verdict, "exact");
	assert.equal(alignment.changed, 0);
	// The rest of the verse is shown, unmarked, as the words around the quotation.
	assert.ok(alignment.passage.slice(-5).every((word) => word.mark === "outside"));
});

test("one changed word is a misquote, marked on both sides", () => {
	const { alignment, verdict } = check("Come unto me, all ye that labour and are heavy laden, and I will give you peace", MATTHEW_11_28);
	assert.equal(verdict, "misquote");
	assert.deepEqual(alignment.quote.filter((word) => word.mark !== "same").map((word) => [word.text, word.mark]), [["peace", "changed"]]);
	assert.deepEqual(alignment.passage.filter((word) => word.mark !== "same").map((word) => [word.text, word.mark]), [["rest", "changed"]]);
});

test("older spellings and verb forms are minor, never a misquote", () => {
	assert.equal(looseWord("shew"), looseWord("show"));
	assert.equal(looseWord("labour"), looseWord("labor"));
	assert.equal(looseWord("calleth"), looseWord("calls"));
	assert.equal(looseWord("fulfil"), looseWord("fulfill"));
	const { verdict } = check("What if God, willing to show his wrath, and to make his power known", ROMANS_9_22);
	assert.equal(verdict, "minor");
});

test("a modern-English quotation of the verse is another translation, not a misquote", () => {
	// Our Daily Bread, 2026-10-26, quoting the NIV: "[God has] summoned you by name; you are mine".
	const { verdict } = check("[God has] summoned you by name; you are mine", ISAIAH_43_1);
	assert.equal(verdict, "translation");
	// The bracketed editorial words are not the quotation's.
	assert.deepEqual(tokenize("[God has] summoned you").map((word) => word.text), ["summoned", "you"]);
	// The same words in the KJV's own forms are held to the KJV.
	assert.equal(check("I have named thee by thy name; thou art mine", ISAIAH_43_1).verdict, "misquote");
});

test("a quotation that names a bundled translation is held to it", () => {
	assert.equal(check("Cast all your anxiety on Him, because He cares for you", PETER_5_7_BSB, "BSB").verdict, "exact");
	assert.equal(check("Cast all your worries on Him, because He loves you", PETER_5_7_BSB, "BSB").verdict, "misquote");
	// Named as a translation SureWord does not bundle: shown, not judged.
	assert.equal(check("Cast all your worries on Him, because He loves you", PETER_5_7_BSB, "NIV").verdict, "translation");
});

test("an omission the quotation marks with an ellipsis is not an error", () => {
	const { alignment, verdict } = check("Fear thou not; for I am with thee ... I will strengthen thee", ISAIAH_41_10);
	assert.equal(verdict, "exact");
	assert.ok(alignment.passage.some((word) => word.mark === "omitted"));
	// Without the ellipsis the same omission is a misquote.
	assert.equal(check("Fear thou not; for I am with thee I will strengthen thee", ISAIAH_41_10).verdict, "misquote");
});

test("sharing small words with a verse does not make it that verse", () => {
	const quote = tokenize("speck on the surface of the earth.");
	const alignment = alignWords(quote, tokenize(GENESIS_6_1, 0));
	assert.equal(isSamePassage(alignment, quote.length, 0.6), false);
	const real = tokenize("Fear thou not; for I am with thee");
	assert.equal(isSamePassage(alignWords(real, tokenize(ISAIAH_41_10, 0)), real.length, 0.6), true);
});

test("marked quotations: curly and straight quotes and blockquotes, not apostrophes or short fragments", () => {
	const text = [
		"Peter tells us, \"Cast all your anxiety on Him, because He cares for you\" (1 Peter 5:7, BSB).",
		"It’s a way to be “seen.” He said, “I have called thee by thy name”.",
		"",
		"> Be careful for nothing; but in every thing by prayer",
		"> Philippians 4:6 (KJV)",
		"",
		"Edwards: “Their foot shall slide”.",
	].join("\n");
	const spans = findQuoteSpans(text);
	assert.deepEqual(
		spans.map((span) => [span.block, span.text.trim().split("\n")[0]]),
		[
			[false, "Cast all your anxiety on Him, because He cares for you"],
			[false, "I have called thee by thy name"],
			[true, "Be careful for nothing; but in every thing by prayer"],
			[false, "Their foot shall slide"],
		],
	);
});

test("a citation belongs to the quotation right after it or just before it in the same sentence", () => {
	assert.equal(citesAfter(" ("), true);
	assert.equal(citesAfter(" — "), true);
	assert.equal(citesAfter(" and then he said "), false);
	assert.equal(citesBefore(" says, "), true);
	assert.equal(citesBefore(": "), true);
	assert.equal(citesBefore("). The prophet was reminding the people, "), false);
});

test("presented as Scripture: a biblical speaker or Scripture with a verb of saying", () => {
	assert.equal(presentedAsScripture("The Bible also promises, "), true);
	assert.equal(presentedAsScripture("Jesus invites us, "), true);
	assert.equal(presentedAsScripture("It is written, "), true);
	assert.equal(presentedAsScripture("As C. S. Lewis wrote, "), false);
	// An imperative "say" introduces the speaker's own words.
	assert.equal(presentedAsScripture("And then, having thus asserted God's word, say, "), false);
	assert.equal(presentedAsScripture("the Bible says you are lost.\" And then he went home and said, "), false);
});

test("old-style Roman chapter numbers", () => {
	assert.equal(romanToNumber("xxxii"), 32);
	assert.equal(romanToNumber("lxxiii"), 73);
	assert.equal(romanToNumber("cl"), 150);
	assert.equal(romanToNumber("cli"), null);
	assert.equal(romanToNumber("abc"), null);
});

test("the pure rules import nothing, so the tests can load them", () => {
	const source = readFileSync(new URL("../src/lib/beta/verify/verify-rules.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /^\s*import\s/m);
});
