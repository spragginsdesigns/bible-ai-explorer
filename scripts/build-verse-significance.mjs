#!/usr/bin/env node
/**
 * Build src/data/learn/verse-significance.json: how heavily the rest of
 * Scripture leans on each verse, counted as inbound cross-references.
 *
 * Input is the bundled cross-reference corpus (src/data/crossrefs/*.json,
 * itself built by scripts/build-cross-references.mjs from openbible.info).
 * Each file is keyed "chapter:verse" for the SOURCE verse, and its values are
 * the TARGETS it points at: [order, chapter, verse] or
 * [order, chapter, verse, endChapter, endVerse]. This script inverts that:
 * for every verse in the Bible, how many edges arrive.
 *
 * Why a range is capped. A target like "Romans 8:28-30" really is about three
 * verses and each deserves the credit. A target like "Psalm 119:1-176" is a
 * pointer at a chapter, and crediting all 176 verses would let a handful of
 * chapter-sized pointers outweigh the verses Scripture actually quotes. So a
 * range covering RANGE_MAX_VERSES or fewer credits every verse it covers, and
 * a longer one credits only the verse it names first, which is the anchor a
 * reader would look up.
 *
 * Usage: node scripts/build-verse-significance.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CROSSREFS_DIR = path.join(ROOT, "src", "data", "crossrefs");
const KJV_DIR = path.join(ROOT, "src", "data", "kjv");
const OUT_DIR = path.join(ROOT, "src", "data", "learn");
const OUT_FILE = path.join(OUT_DIR, "verse-significance.json");

/** Longest range that still credits every verse it covers. */
const RANGE_MAX_VERSES = 8;

/**
 * Verses below this many inbound references are left out of the file. Chosen
 * against the real distribution, not a round number: it keeps every verse a
 * reader could plausibly be pointed to while holding the bundle well under the
 * 200KB budget. Verses under it are not "unimportant", they are simply not
 * load-bearing enough for the product to argue a verse is worth memorising on
 * the strength of its cross-references.
 */
const MIN_COUNT = 12;

/** Verse counts per chapter, so a range that crosses a chapter can be expanded. */
function loadChapterLengths() {
	const lengths = new Map(); // book order -> number[] (verses per chapter)
	for (const file of readdirSync(KJV_DIR).filter((name) => name.endsWith(".json"))) {
		const order = Number.parseInt(file.slice(0, 2), 10);
		const chapters = JSON.parse(readFileSync(path.join(KJV_DIR, file), "utf8"));
		lengths.set(
			order,
			chapters.map((verses) => verses.length),
		);
	}
	return lengths;
}

/** Every verse a target tuple covers, already capped. */
function targetVerses(tuple, lengths) {
	const [order, chapter, verse] = tuple;
	const anchor = [{ order, chapter, verse }];
	if (tuple.length < 5) return anchor;
	const endChapter = tuple[3];
	const endVerse = tuple[4];
	if (endChapter < chapter || (endChapter === chapter && endVerse <= verse)) return anchor;

	const chapterLengths = lengths.get(order);
	if (!chapterLengths) return anchor;

	const covered = [];
	for (let c = chapter; c <= endChapter && c <= chapterLengths.length; c++) {
		const first = c === chapter ? verse : 1;
		const last = c === endChapter ? Math.min(endVerse, chapterLengths[c - 1]) : chapterLengths[c - 1];
		for (let v = first; v <= last; v++) {
			// One verse past the cap is enough to know the range is too long.
			if (covered.length > RANGE_MAX_VERSES) return anchor;
			covered.push({ order, chapter: c, verse: v });
		}
	}
	return covered.length === 0 ? anchor : covered;
}

function main() {
	const lengths = loadChapterLengths();
	const counts = new Map(); // "book:chapter:verse" -> inbound count
	let edges = 0;
	let cappedRanges = 0;

	for (const file of readdirSync(CROSSREFS_DIR).filter((name) => name.endsWith(".json"))) {
		const book = JSON.parse(readFileSync(path.join(CROSSREFS_DIR, file), "utf8"));
		for (const tuples of Object.values(book)) {
			for (const tuple of tuples) {
				if (!Array.isArray(tuple) || tuple.length < 3) continue;
				edges += 1;
				const verses = targetVerses(tuple, lengths);
				if (tuple.length === 5 && verses.length === 1) cappedRanges += 1;
				for (const target of verses) {
					const key = `${target.order}:${target.chapter}:${target.verse}`;
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
			}
		}
	}

	const kept = [...counts.entries()].filter(([, count]) => count >= MIN_COUNT);
	kept.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

	// Written in descending weight order so the head of the file is readable
	// by eye; consumers index it by key, never by position.
	const verses = {};
	for (const [key, count] of kept) verses[key] = count;
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(OUT_FILE, `${JSON.stringify({ minCount: MIN_COUNT, verses })}\n`, "utf8");

	const bytes = readFileSync(OUT_FILE).length;
	const bookNames = JSON.parse(readFileSync(path.join(ROOT, "src", "data", "books.json"), "utf8"));
	const nameOf = (order) => bookNames.find((entry) => entry.order === order)?.name ?? String(order);

	console.log(`edges read:        ${edges.toLocaleString()}`);
	console.log(`ranges over cap:   ${cappedRanges.toLocaleString()} (credited their first verse only)`);
	console.log(`verses with a count: ${counts.size.toLocaleString()}`);
	console.log(`kept (>= ${MIN_COUNT}):      ${kept.length.toLocaleString()}`);
	console.log(`file size:         ${(bytes / 1024).toFixed(1)} KB`);
	console.log("");
	console.log("Top 20 by inbound cross-references:");
	for (const [key, count] of kept.slice(0, 20)) {
		const [order, chapter, verse] = key.split(":").map(Number);
		console.log(`  ${String(count).padStart(5)}  ${nameOf(order)} ${chapter}:${verse}`);
	}
}

main();
