import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isRightToLeft, stripCantillation } from "../src/lib/bible/original-text.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const section = read("../src/components/bible/OriginalLanguageSection.tsx");
const hook = read("../src/components/bible/useOriginalVerse.ts");
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

test("the section reads both public routes and mirrors the Android contract", () => {
	assert.match(hook, /\/api\/bible\/original\?book=\$\{book\}&chapter=\$\{chapter\}&verse=\$\{verse\}/);
	assert.match(hook, /\/api\/bible\/strongs\?number=\$\{encodeURIComponent\(number\)\}/);
	// A 404 is a real answer worth caching; a 500 must stay retryable.
	assert.match(hook, /if \(res\.status === 404\) verseCache\.set\(key, null\)/);
});

test("the word row honours script direction and hides itself when there is no data", () => {
	assert.match(section, /dir=\{rtl \? "rtl" : "ltr"\}/);
	assert.match(section, /rtl \? stripCantillation\(word\.text\) : word\.text/);
	assert.match(section, /rtl \? "text-xl" : "text-lg"/);
	assert.match(section, /if \(notFound \|\| !data \|\| data\.words\.length === 0\) return null/);
});

test("word buttons carry the shared accessibility contract", () => {
	assert.match(section, /aria-pressed=\{active\}/);
	assert.match(section, /aria-label=\{`\$\{word\.translit \?\? word\.text\}, Strong's \$\{word\.strongs\}`\}/);
});

test("selection and definitions reset when the panel moves to another verse", () => {
	assert.match(section, /setSelected\(null\);\s*\n\s*setDefinitions\(\{\}\);\s*\n\s*\}, \[book, chapter, verse\]\)/);
	assert.match(section, /setSelected\(\(current\) => \(current === index \? null : index\)\)/);
});

test("the reader mounts the section between the insight text and Expand with AI", () => {
	const sectionAt = reader.indexOf("<OriginalLanguageSection");
	const expandAt = reader.indexOf("Expand with AI");
	const insightAt = reader.indexOf("insightStatus === \"streaming\"");
	assert.ok(sectionAt > 0, "the section should be mounted in the reader");
	assert.ok(insightAt < sectionAt, "it belongs after the streaming insight block");
	assert.ok(sectionAt < expandAt, "it belongs before the Expand with AI button");
	assert.match(reader, /verse=\{actionVerse\.number\}/);
});
