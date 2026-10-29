import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { alignFromKjv, alignToKjv, unmappedChapters } from "../scripts/lib/original-versification.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));

const counts = new Map();
function chapterCounts(order) {
	if (!counts.has(order)) {
		const book = books.find((entry) => entry.order === order);
		assert.ok(book, `no book with order ${order}`);
		const read = (dir) =>
			JSON.parse(fs.readFileSync(path.join(root, "src/data", dir, book.file), "utf8")).map(
				(chapter) => chapter.length
			);
		counts.set(order, { name: book.name, original: read("originals"), kjv: read("kjv") });
	}
	return counts.get(order);
}

/** Align one reference and render it as "chapter:verse", or null. */
function align(order, chapter, verse) {
	const { original, kjv } = chapterCounts(order);
	const target = alignToKjv(order, original, kjv)(chapter, verse);
	return target ? `${target.chapter}:${target.verse}` : null;
}

test("a Psalm superscription is dropped and the rest shifts by one", () => {
	// WLC Psalm 3 has 9 verses to the KJV's 8 because "A Psalm of David, when
	// he fled from Absalom his son" is numbered. Mapping the title to a verse
	// would put the wrong Hebrew under every verse of the psalm.
	assert.equal(chapterCounts(19).original[2], 9);
	assert.equal(chapterCounts(19).kjv[2], 8);
	assert.equal(align(19, 3, 1), null);
	assert.equal(align(19, 3, 2), "3:1");
	assert.equal(align(19, 3, 9), "3:8");
});

test("a two-line Psalm title shifts by two", () => {
	// Psalm 51 carries the longer Bathsheba heading over two verses: WLC 21,
	// KJV 19.
	assert.equal(chapterCounts(19).original[50], 21);
	assert.equal(chapterCounts(19).kjv[50], 19);
	assert.equal(align(19, 51, 1), null);
	assert.equal(align(19, 51, 2), null);
	assert.equal(align(19, 51, 3), "51:1");
	assert.equal(align(19, 51, 21), "51:19");
});

test("a Psalm with no title maps straight through", () => {
	assert.equal(align(19, 1, 1), "1:1");
	assert.equal(align(19, 119, 176), "119:176");
});

test("Genesis 32:1 belongs to the previous KJV chapter", () => {
	// The WLC starts chapter 32 at "and Laban rose up early in the morning",
	// which the KJV prints as 31:55.
	assert.equal(align(1, 32, 1), "31:55");
	assert.equal(align(1, 32, 2), "32:1");
	assert.equal(align(1, 32, 33), "32:32");
	// The chapter it borrows from still maps to itself.
	assert.equal(align(1, 31, 54), "31:54");
});

test("Joel has a fourth chapter the KJV folds into its third", () => {
	assert.equal(chapterCounts(29).original.length, 4);
	assert.equal(chapterCounts(29).kjv.length, 3);
	assert.equal(align(29, 4, 1), "3:1");
	assert.equal(align(29, 4, 21), "3:21");
	// The five verses of WLC Joel 3 are the KJV's "I will pour out my spirit"
	// passage at the end of chapter 2.
	assert.equal(align(29, 3, 1), "2:28");
	assert.equal(align(29, 3, 5), "2:32");
	assert.equal(align(29, 2, 27), "2:27");
});

test("Malachi 3:19 opens the KJV's fourth chapter", () => {
	assert.equal(chapterCounts(39).original.length, 3);
	assert.equal(chapterCounts(39).kjv.length, 4);
	assert.equal(align(39, 3, 18), "3:18");
	assert.equal(align(39, 3, 19), "4:1");
	assert.equal(align(39, 3, 24), "4:6");
});

test("Jonah 2:1 is the KJV's great fish verse in chapter 1", () => {
	assert.equal(align(32, 2, 1), "1:17");
	assert.equal(align(32, 2, 2), "2:1");
	assert.equal(align(32, 2, 11), "2:10");
});

test("a verse the KJV only half-contains still points at that verse", () => {
	// Four WLC verses are the second half of a KJV verse that another WLC
	// verse already covers. They map onto it rather than to null, because a
	// reader asking for the Hebrew behind KJV 1 Kings 22:43 needs both rows.
	assert.equal(align(11, 22, 43), "22:43");
	assert.equal(align(11, 22, 44), "22:43");
	assert.equal(align(11, 22, 45), "22:44");
	assert.equal(align(4, 25, 19), "26:1");
	assert.equal(align(4, 26, 1), "26:1");
	assert.equal(align(9, 21, 1), "20:42");
	assert.equal(align(9, 21, 2), "21:1");
	assert.equal(align(13, 12, 5), "12:4");
	assert.equal(align(13, 12, 6), "12:5");
});

test("Nehemiah 7 runs the other way, the KJV having the extra verse", () => {
	// KJV Nehemiah 7:68 (the horses and mules) has no WLC verse at all, so
	// the WLC runs one behind from verse 68 on.
	assert.equal(align(16, 7, 67), "7:67");
	assert.equal(align(16, 7, 68), "7:69");
	assert.equal(align(16, 7, 72), "7:73");
});

test("Greek books map straight through", () => {
	// Scrivener's TR numbering is the KJV's. If a Greek book ever disagreed,
	// the fallback rule would null the whole chapter and this would fail.
	for (const book of books.filter((entry) => entry.order >= 40)) {
		const { original, kjv } = chapterCounts(book.order);
		assert.deepEqual(
			original,
			kjv,
			`${book.name} has a chapter whose Greek and KJV verse counts differ`
		);
		assert.equal(align(book.order, 1, 1), "1:1");
	}
});

test("an out-of-range reference is null, never a guess", () => {
	assert.equal(align(1, 1, 0), null);
	assert.equal(align(1, 1, 999), null);
	assert.equal(align(1, 999, 1), null);
	assert.equal(align(39, 4, 1), null);
});

test("no chapter of any book falls through to the unmapped rule", () => {
	// This is the guard on the whole override table. Any chapter whose two
	// verse counts disagree must be explained by an override or by the Psalm
	// title rule; anything else would silently lose a chapter of Hebrew.
	for (const book of books) {
		const { original, kjv } = chapterCounts(book.order);
		assert.deepEqual(
			unmappedChapters(book.order, original, kjv),
			[],
			`${book.name} has chapters with no alignment rule`
		);
	}
});

test("the whole Bible aligns, and only Psalm titles are unmapped", () => {
	// The end-to-end count the seed script depends on: 31,170 original verses,
	// 67 of them Psalm superscriptions with no KJV coordinate, every other one
	// landing on a KJV verse that actually exists.
	let total = 0;
	let mapped = 0;
	let nulls = 0;
	const covered = new Set();
	for (const book of books) {
		const { original, kjv } = chapterCounts(book.order);
		const map = alignToKjv(book.order, original, kjv);
		for (let chapter = 1; chapter <= original.length; chapter++) {
			for (let verse = 1; verse <= original[chapter - 1]; verse++) {
				total++;
				const target = map(chapter, verse);
				if (!target) {
					nulls++;
					assert.equal(book.order, 19, `${book.name} ${chapter}:${verse} is unmapped`);
					continue;
				}
				mapped++;
				assert.ok(
					target.verse >= 1 && target.verse <= kjv[target.chapter - 1],
					`${book.name} ${chapter}:${verse} maps outside the KJV`
				);
				covered.add(`${book.order}.${target.chapter}.${target.verse}`);
			}
		}
	}
	assert.equal(total, 31170);
	assert.equal(nulls, 67);
	assert.equal(mapped, 31103);
	// The legacy whole-source index has no separate row for Nehemiah 7:68,
	// Isaiah 64:1, or Psalm 13:6. Precise inverse retrieval covers the two
	// split verses with word fragments.
	assert.equal(covered.size, 31099);
});


test("the inverse covers every KJV coordinate except the absent Nehemiah verse", () => {
	let covered = 0;
	let joins = 0;
	for (const book of books) {
		const { original, kjv } = chapterCounts(book.order);
		const forward = alignToKjv(book.order, original, kjv);
		const inverse = alignFromKjv(book.order, original, kjv);
		const seen = new Map();
		for (let chapter = 1; chapter <= kjv.length; chapter++) {
			for (let verse = 1; verse <= kjv[chapter - 1]; verse++) {
				const fragments = inverse(chapter, verse);
				if (book.order === 16 && chapter === 7 && verse === 68) {
					assert.deepEqual(fragments, []);
					continue;
				}
				assert.ok(fragments.length, `${book.name} ${chapter}:${verse} missing`);
				covered++;
				if (fragments.length > 1) joins++;
				for (const fragment of fragments) {
					assert.ok(fragment.verse >= 1 && fragment.verse <= original[fragment.chapter - 1]);
					const key = `${fragment.chapter}:${fragment.verse}`;
					seen.set(key, (seen.get(key) ?? 0) + 1);
					if (book.order === 23 && fragment.chapter === 63 && fragment.verse === 19) {
						assert.deepEqual([chapter, verse], fragment.wordStart === 0 ? [63, 19] : [64, 1]);
					} else if (book.order === 19 && fragment.chapter === 13 && fragment.verse === 6) {
						assert.deepEqual([chapter, verse], fragment.wordStart === 0 ? [13, 5] : [13, 6]);
					} else {
						assert.deepEqual(forward(fragment.chapter, fragment.verse), { chapter, verse });
						if (!(book.order === 19 && fragment.verse === 1)) assert.equal(fragment.wordStart, undefined);
						assert.equal(fragment.wordEnd, undefined);
					}
				}
			}
		}
		for (let chapter = 1; chapter <= original.length; chapter++) {
			for (let verse = 1; verse <= original[chapter - 1]; verse++) {
				const frequency = seen.get(`${chapter}:${verse}`) ?? 0;
				const split = (book.order === 23 && chapter === 63 && verse === 19) || (book.order === 19 && chapter === 13 && verse === 6);
				const expected = !forward(chapter, verse) ? 0 : split ? 2 : 1;
				assert.equal(frequency, expected, `${book.name} ${chapter}:${verse} lost or duplicated`);
			}
		}
	}
	assert.equal(covered, 31101);
	assert.equal(joins, 4);
});

test("inverse alignment fails closed for unexplained counts and invalid references", () => {
	const unexplained = alignFromKjv(1, [4], [5]);
	assert.deepEqual(unexplained(1, 1), []);
	const { original, kjv } = chapterCounts(19);
	const inverse = alignFromKjv(19, original, kjv);
	for (const ref of [[3, 0], [3, 9], [3, 1.5], [0, 1], [NaN, 1]]) assert.deepEqual(inverse(...ref), []);
	const result = inverse(3, 1);
	result[0].verse = 999;
	assert.deepEqual(inverse(3, 1), [{ chapter: 3, verse: 2 }]);
});


test("Psalm 13 overrides equal counts because its title and split cancel in the totals", () => {
  assert.equal(align(19, 13, 1), null);
  assert.equal(align(19, 13, 2), "13:1");
  assert.equal(align(19, 13, 5), "13:4");
  assert.equal(align(19, 13, 6), "13:5");
});
