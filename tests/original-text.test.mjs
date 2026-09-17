import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isRightToLeft, stripCantillation } from "../src/lib/bible/original-text.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const section = read("../src/components/bible/WordStudySection.tsx");
const hook = read("../src/components/bible/useVerseWords.ts");
const reader = read("../src/components/bible/ChapterReader.tsx");

// Genesis 1:1, first word, straight out of src/data/originals/01-genesis.json:
// consonants + niqqud + a tipcha accent (U+0596) on the third letter.
const BERESHIT = "\u05D1\u05BC\u05B0\u05E8\u05B5\u05D0\u05E9\u05C1\u05B4\u0596\u05D9\u05EA";

test("stripCantillation drops accents and keeps the vowel points", () => {
	const stripped = stripCantillation(BERESHIT);
	assert.equal(stripped.includes("\u0596"), false, "the tipcha accent should be gone");
	assert.equal(stripped.includes("\u05BC"), true, "the dagesh should survive");
	assert.equal(stripped.includes("\u05B0"), true, "the sheva should survive");
	assert.equal(stripped.includes("\u05B4"), true, "the hiriq should survive");
	assert.equal(stripped.includes("\u05C1"), true, "the shin dot should survive");
	assert.equal(stripped, "\u05D1\u05BC\u05B0\u05E8\u05B5\u05D0\u05E9\u05C1\u05B4\u05D9\u05EA");
});

test("stripCantillation removes every mark in the accent block", () => {
	assert.equal(stripCantillation("\u05D0\u0591\u05D1\u05AF\u05D2"), "\u05D0\u05D1\u05D2");
	assert.equal(stripCantillation("\u05D0\u05A0\u05D1"), "\u05D0\u05D1");
});

test("stripCantillation leaves Greek and plain text untouched", () => {
	assert.equal(stripCantillation("\u03BB\u03BF\u03B3\u03BF\u03C2"), "\u03BB\u03BF\u03B3\u03BF\u03C2");
	assert.equal(stripCantillation("In the beginning"), "In the beginning");
	assert.equal(stripCantillation(""), "");
});

test("isRightToLeft is true for Hebrew only", () => {
	assert.equal(isRightToLeft("Hebrew"), true);
	assert.equal(isRightToLeft("Greek"), false);
	assert.equal(isRightToLeft("hebrew"), false);
	assert.equal(isRightToLeft(""), false);
});

test("the section reads the study route and the public Strong's route", () => {
	// The study is per-account work behind Clerk, so it is a POST that must
	// carry the session cookie; the dictionary is public-domain data.
	assert.match(hook, /await fetch\("\/api\/verse-words", \{/);
	assert.match(hook, /credentials: "same-origin"/);
	assert.match(
		hook,
		/\/api\/bible\/strongs\?number=\$\{encodeURIComponent\(number\)\}&examples=3&exclude=\$\{exclude\}/
	);
	// A 404 is a real answer worth caching; a 502 must stay retryable.
	assert.match(hook, /studyCache\.set\(key, "not-found"\)/);
	assert.match(hook, /setState\(\{ status: "error", message: ERROR_MESSAGE, retryable: true \}\)/);
});

test("the word row honours script direction and says when a verse has no original", () => {
	assert.match(section, /dir=\{rtl \? "rtl" : "ltr"\}/);
	assert.match(section, /rtl \? stripCantillation\(row\.original\) : row\.original/);
	assert.match(section, /rtl \? "text-right" : "text-left"/);
	assert.match(section, /No original-language text for this verse\./);
});

test("row buttons carry the shared accessibility contract", () => {
	assert.match(section, /aria-expanded=\{open\}/);
	assert.match(section, /aria-label=\{`Reading the \$\{language\}`\}/);
});

test("the open row resets when the panel moves to another verse", () => {
	assert.match(section, /setOpenRow\(null\);\s*\n\s*\}, \[book, chapter, verse\]\)/);
	assert.match(section, /setOpenRow\(\(current\) => \(current === index \? null : index\)\)/);
});

test("the row's two buttons open chat, one of them with the passage pinned", () => {
	assert.match(section, /onAsk\(askPrompt, true\)/);
	assert.match(section, /onAsk\(everyPrompt, false\)/);
	// The prompt param is what prefills the composer; attachRef pins the verse.
	assert.match(reader, /const query = new URLSearchParams\(\{ prompt \}\)/);
	assert.match(reader, /query\.set\("attachRef", selectionRef\)/);
});

test("the reader mounts the section in the verse panel's Words tab, for the first selected verse", () => {
	const sectionAt = reader.indexOf("<WordStudySection");
	const wordsAt = reader.indexOf('studyTab === "words"');
	const insightAt = reader.indexOf("insightStatus === \"streaming\"");
	assert.ok(sectionAt > 0, "the section should be mounted in the reader");
	assert.ok(insightAt < sectionAt, "Explain comes before Words in the panel body");
	assert.ok(wordsAt > 0 && wordsAt < sectionAt, "it belongs inside the Words tab");
	// Each study is a model generation, so a range studies its first verse only.
	assert.match(reader, /verse=\{selection\.start\}/);
	assert.doesNotMatch(reader.slice(wordsAt, wordsAt + 1200), /selectionVerses\(selection\)\.map/);
});
