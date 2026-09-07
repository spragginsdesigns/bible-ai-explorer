// Alignment from the bundled original-language versification to KJV
// coordinates. Pure: no I/O, no dependencies, so both the seed script and
// tests/original-versification.test.mjs drive it directly.
//
// Why this exists: src/data/originals/*.json follows the Westminster
// Leningrad Codex for books 1-39, and the WLC does not number verses the way
// the KJV does. Three kinds of disagreement occur:
//
//   1. Psalm superscriptions. The WLC counts "A Psalm of David" as verse 1;
//      the KJV prints it unnumbered above verse 1. So WLC Psalm 3 has 9
//      verses to the KJV's 8, and every verse is off by one. Psalms 51, 52,
//      54 and 60 carry a two-line title and are off by two.
//   2. Chapter-boundary shifts. A verse the KJV puts at the end of one
//      chapter the WLC puts at the start of the next, or vice versa
//      (WLC Genesis 32:1 is KJV Genesis 31:55), and whole blocks move
//      (WLC Malachi 3:19-24 is KJV Malachi 4:1-6). Joel has four chapters in
//      the WLC against the KJV's three.
//   3. Verses the two traditions split differently, so one WLC verse is only
//      half a KJV verse (WLC 1 Kings 22:44 is the second half of KJV 22:43).
//      These map many-to-one onto the KJV verse that contains them; the kjv
//      columns carry no unique constraint precisely so this is expressible.
//
// The Greek (books 40-66) is Scrivener's 1894 Textus Receptus, whose
// numbering is the KJV's. Verified: every chapter of all 27 books has an
// identical verse count in src/data/originals and src/data/kjv, so those
// books need no override and fall through to the equal-counts identity rule.
//
// EVERY entry below was verified against the actual per-chapter verse counts
// in src/data/originals/*.json and src/data/kjv/*.json, and the seven
// many-to-one joins were additionally confirmed by glossing the Hebrew words
// through strongs-hebrew.json and comparing to the KJV wording. A chapter
// whose two counts disagree MUST appear here, including the neighbouring
// chapter that is otherwise an identity map, because the equal-counts rule
// cannot fire for it and it would otherwise be dropped as unmapped.

/**
 * One contiguous run of original verses and where it lands in the KJV.
 * `to` omitted means "to the end of the chapter". `chapter` omitted means
 * the same chapter number. KJV verse = original verse + `delta`.
 *
 * @typedef {{ from: number, to?: number, chapter?: number, delta?: number }} Segment
 */

/** @type {Record<number, Record<number, Segment[]>>} */
const OVERRIDES = {
	// Genesis: WLC 32:1 is KJV 31:55 (Laban rises early), so chapter 32 runs
	// one behind. WLC 31 = 54 verses, KJV 31 = 55; WLC 32 = 33, KJV 32 = 32.
	1: {
		31: [{ from: 1, delta: 0 }],
		32: [
			{ from: 1, to: 1, chapter: 31, delta: 54 },
			{ from: 2, delta: -1 },
		],
	},
	// Exodus: WLC 7:26-29 is KJV 8:1-4 (WLC 7 = 29 verses, KJV 7 = 25;
	// WLC 8 = 28, KJV 8 = 32). Separately WLC 21:37 is KJV 22:1
	// (WLC 21 = 37, KJV 21 = 36; WLC 22 = 30, KJV 22 = 31).
	2: {
		7: [
			{ from: 1, to: 25, delta: 0 },
			{ from: 26, chapter: 8, delta: -25 },
		],
		8: [{ from: 1, chapter: 8, delta: 4 }],
		21: [
			{ from: 1, to: 36, delta: 0 },
			{ from: 37, to: 37, chapter: 22, delta: -36 },
		],
		22: [{ from: 1, delta: 1 }],
	},
	// Leviticus: WLC 5:20-26 is KJV 6:1-7. WLC 5 = 26 verses, KJV 5 = 19;
	// WLC 6 = 23, KJV 6 = 30.
	3: {
		5: [
			{ from: 1, to: 19, delta: 0 },
			{ from: 20, chapter: 6, delta: -19 },
		],
		6: [{ from: 1, delta: 7 }],
	},
	// Numbers: WLC 17:1-15 is KJV 16:36-50 (WLC 16 = 35, KJV 16 = 50;
	// WLC 17 = 28, KJV 17 = 13). WLC 30:1 is KJV 29:40 (WLC 29 = 39,
	// KJV 29 = 40; WLC 30 = 17, KJV 30 = 16). WLC 25:19 ("and it came to
	// pass after the plague") is the opening clause of KJV 26:1, which WLC
	// 26:1 also feeds, so both map onto KJV 26:1. WLC 25 = 19, KJV 25 = 18.
	4: {
		16: [{ from: 1, delta: 0 }],
		17: [
			{ from: 1, to: 15, chapter: 16, delta: 35 },
			{ from: 16, delta: -15 },
		],
		25: [
			{ from: 1, to: 18, delta: 0 },
			{ from: 19, to: 19, chapter: 26, delta: -18 },
		],
		29: [{ from: 1, delta: 0 }],
		30: [
			{ from: 1, to: 1, chapter: 29, delta: 39 },
			{ from: 2, delta: -1 },
		],
	},
	// Deuteronomy: WLC 13:1 is KJV 12:32, WLC 23:1 is KJV 22:30, and
	// WLC 28:69 is KJV 29:1. Counts: WLC 12 = 31 / KJV 32, WLC 13 = 19 / 18,
	// WLC 22 = 29 / 30, WLC 23 = 26 / 25, WLC 28 = 69 / 68, WLC 29 = 28 / 29.
	5: {
		12: [{ from: 1, delta: 0 }],
		13: [
			{ from: 1, to: 1, chapter: 12, delta: 31 },
			{ from: 2, delta: -1 },
		],
		22: [{ from: 1, delta: 0 }],
		23: [
			{ from: 1, to: 1, chapter: 22, delta: 29 },
			{ from: 2, delta: -1 },
		],
		28: [
			{ from: 1, to: 68, delta: 0 },
			{ from: 69, to: 69, chapter: 29, delta: -68 },
		],
		29: [{ from: 1, delta: 1 }],
	},
	// 1 Samuel: WLC 21:1 ("he arose and departed, and Jonathan went into the
	// city") is the tail of KJV 20:42, so it joins that verse; WLC 21:2 is
	// KJV 21:1. WLC 24:1 is KJV 23:29. Counts: WLC 20 = 42 / KJV 42,
	// WLC 21 = 16 / 15, WLC 23 = 28 / 29, WLC 24 = 23 / 22.
	9: {
		21: [
			{ from: 1, to: 1, chapter: 20, delta: 41 },
			{ from: 2, delta: -1 },
		],
		23: [{ from: 1, delta: 0 }],
		24: [
			{ from: 1, to: 1, chapter: 23, delta: 28 },
			{ from: 2, delta: -1 },
		],
	},
	// 2 Samuel: WLC 19:1 is KJV 18:33. WLC 18 = 32 / KJV 33, WLC 19 = 44 / 43.
	10: {
		18: [{ from: 1, delta: 0 }],
		19: [
			{ from: 1, to: 1, chapter: 18, delta: 32 },
			{ from: 2, delta: -1 },
		],
	},
	// 1 Kings: WLC 5:1-14 is KJV 4:21-34 (WLC 4 = 20 / KJV 34,
	// WLC 5 = 32 / 18). WLC 22:44 ("the high places were not taken away")
	// is the second half of KJV 22:43, and everything after it runs one
	// behind. WLC 22 = 54 / KJV 53.
	11: {
		4: [{ from: 1, delta: 0 }],
		5: [
			{ from: 1, to: 14, chapter: 4, delta: 20 },
			{ from: 15, delta: -14 },
		],
		22: [
			{ from: 1, to: 43, delta: 0 },
			{ from: 44, delta: -1 },
		],
	},
	// 2 Kings: WLC 12:1 is KJV 11:21. WLC 11 = 20 / KJV 21, WLC 12 = 22 / 21.
	12: {
		11: [{ from: 1, delta: 0 }],
		12: [
			{ from: 1, to: 1, chapter: 11, delta: 20 },
			{ from: 2, delta: -1 },
		],
	},
	// 1 Chronicles: WLC 5:27-41 is KJV 6:1-15 (WLC 5 = 41 / KJV 26,
	// WLC 6 = 66 / 81). WLC 12:5 ("Jeremiah, Jahaziel, Johanan, Josabad the
	// Gederathite") is the second half of KJV 12:4, so it joins that verse
	// and the rest of the chapter runs one behind. WLC 12 = 41 / KJV 40.
	13: {
		5: [
			{ from: 1, to: 26, delta: 0 },
			{ from: 27, chapter: 6, delta: -26 },
		],
		6: [{ from: 1, delta: 15 }],
		12: [
			{ from: 1, to: 4, delta: 0 },
			{ from: 5, delta: -1 },
		],
	},
	// 2 Chronicles: WLC 1:18 is KJV 2:1 and WLC 13:23 is KJV 14:1.
	// Counts: WLC 1 = 18 / KJV 17, WLC 2 = 17 / 18, WLC 13 = 23 / 22,
	// WLC 14 = 14 / 15.
	14: {
		1: [
			{ from: 1, to: 17, delta: 0 },
			{ from: 18, to: 18, chapter: 2, delta: -17 },
		],
		2: [{ from: 1, delta: 1 }],
		13: [
			{ from: 1, to: 22, delta: 0 },
			{ from: 23, to: 23, chapter: 14, delta: -22 },
		],
		14: [{ from: 1, delta: 1 }],
	},
	// Nehemiah: WLC 3:33-38 is KJV 4:1-6 (WLC 3 = 38 / KJV 32,
	// WLC 4 = 17 / 23). WLC 10:1 is KJV 9:38 (WLC 9 = 37 / KJV 38,
	// WLC 10 = 40 / 39). Chapter 7 runs the other way: KJV 7:68 (the horses
	// and mules) has no WLC verse at all, a known ketiv omission, so
	// WLC 7:68 onward is KJV 7:69 onward. WLC 7 = 72 / KJV 73.
	16: {
		3: [
			{ from: 1, to: 32, delta: 0 },
			{ from: 33, chapter: 4, delta: -32 },
		],
		4: [{ from: 1, delta: 6 }],
		7: [
			{ from: 1, to: 67, delta: 0 },
			{ from: 68, delta: 1 },
		],
		9: [{ from: 1, delta: 0 }],
		10: [
			{ from: 1, to: 1, chapter: 9, delta: 37 },
			{ from: 2, delta: -1 },
		],
	},
	// Job: WLC 40:25-32 is KJV 41:1-8. WLC 40 = 32 / KJV 24, WLC 41 = 26 / 34.
	18: {
		40: [
			{ from: 1, to: 24, delta: 0 },
			{ from: 25, chapter: 41, delta: -24 },
		],
		41: [{ from: 1, delta: 8 }],
	},
	// Ecclesiastes: WLC 4:17 is KJV 5:1. WLC 4 = 17 / KJV 16, WLC 5 = 19 / 20.
	21: {
		4: [
			{ from: 1, to: 16, delta: 0 },
			{ from: 17, to: 17, chapter: 5, delta: -16 },
		],
		5: [{ from: 1, delta: 1 }],
	},
	// Song of Solomon: WLC 7:1 is KJV 6:13. WLC 6 = 12 / KJV 13,
	// WLC 7 = 14 / 13.
	22: {
		6: [{ from: 1, delta: 0 }],
		7: [
			{ from: 1, to: 1, chapter: 6, delta: 12 },
			{ from: 2, delta: -1 },
		],
	},
	// Isaiah: WLC 8:23 is KJV 9:1 (WLC 8 = 23 / KJV 22, WLC 9 = 20 / 21).
	// Chapter 64 runs the other way: the KJV splits the long Hebrew 63:19
	// and prints its second half as 64:1, so KJV 64:1 has no WLC verse of
	// its own and WLC 64:1 is KJV 64:2. WLC 63 = 19 / KJV 19 (identity),
	// WLC 64 = 11 / KJV 12.
	23: {
		8: [
			{ from: 1, to: 22, delta: 0 },
			{ from: 23, to: 23, chapter: 9, delta: -22 },
		],
		9: [{ from: 1, delta: 1 }],
		64: [{ from: 1, delta: 1 }],
	},
	// Jeremiah: WLC 8:23 is KJV 9:1. WLC 8 = 23 / KJV 22, WLC 9 = 25 / 26.
	24: {
		8: [
			{ from: 1, to: 22, delta: 0 },
			{ from: 23, to: 23, chapter: 9, delta: -22 },
		],
		9: [{ from: 1, delta: 1 }],
	},
	// Ezekiel: WLC 21:1-5 is KJV 20:45-49. WLC 20 = 44 / KJV 49,
	// WLC 21 = 37 / 32.
	26: {
		20: [{ from: 1, delta: 0 }],
		21: [
			{ from: 1, to: 5, chapter: 20, delta: 44 },
			{ from: 6, delta: -5 },
		],
	},
	// Daniel: WLC 3:31-33 is KJV 4:1-3 (WLC 3 = 33 / KJV 30,
	// WLC 4 = 34 / 37) and WLC 6:1 is KJV 5:31 (WLC 5 = 30 / KJV 31,
	// WLC 6 = 29 / 28).
	27: {
		3: [
			{ from: 1, to: 30, delta: 0 },
			{ from: 31, chapter: 4, delta: -30 },
		],
		4: [{ from: 1, delta: 3 }],
		5: [{ from: 1, delta: 0 }],
		6: [
			{ from: 1, to: 1, chapter: 5, delta: 30 },
			{ from: 2, delta: -1 },
		],
	},
	// Hosea: WLC 2:1-2 is KJV 1:10-11 (WLC 1 = 9 / KJV 11, WLC 2 = 25 / 23),
	// WLC 12:1 is KJV 11:12 (WLC 11 = 11 / KJV 12, WLC 12 = 15 / 14), and
	// WLC 14:1 is KJV 13:16 (WLC 13 = 15 / KJV 16, WLC 14 = 10 / 9).
	28: {
		1: [{ from: 1, delta: 0 }],
		2: [
			{ from: 1, to: 2, chapter: 1, delta: 9 },
			{ from: 3, delta: -2 },
		],
		11: [{ from: 1, delta: 0 }],
		12: [
			{ from: 1, to: 1, chapter: 11, delta: 11 },
			{ from: 2, delta: -1 },
		],
		13: [{ from: 1, delta: 0 }],
		14: [
			{ from: 1, to: 1, chapter: 13, delta: 15 },
			{ from: 2, delta: -1 },
		],
	},
	// Joel has four chapters in the WLC and three in the KJV. WLC 3:1-5 is
	// KJV 2:28-32 and the whole of WLC 4 is KJV 3. Counts: WLC 1 = 20 / 20,
	// WLC 2 = 27 / KJV 32, WLC 3 = 5 / KJV 21, WLC 4 = 21 / KJV has no ch4.
	29: {
		2: [{ from: 1, delta: 0 }],
		3: [{ from: 1, chapter: 2, delta: 27 }],
		4: [{ from: 1, chapter: 3, delta: 0 }],
	},
	// Jonah: WLC 2:1 (the great fish) is KJV 1:17. WLC 1 = 16 / KJV 17,
	// WLC 2 = 11 / 10.
	32: {
		1: [{ from: 1, delta: 0 }],
		2: [
			{ from: 1, to: 1, chapter: 1, delta: 16 },
			{ from: 2, delta: -1 },
		],
	},
	// Micah: WLC 4:14 is KJV 5:1. WLC 4 = 14 / KJV 13, WLC 5 = 14 / 15.
	33: {
		4: [
			{ from: 1, to: 13, delta: 0 },
			{ from: 14, to: 14, chapter: 5, delta: -13 },
		],
		5: [{ from: 1, delta: 1 }],
	},
	// Nahum: WLC 2:1 is KJV 1:15. WLC 1 = 14 / KJV 15, WLC 2 = 14 / 13.
	34: {
		1: [{ from: 1, delta: 0 }],
		2: [
			{ from: 1, to: 1, chapter: 1, delta: 14 },
			{ from: 2, delta: -1 },
		],
	},
	// Zechariah: WLC 2:1-4 is KJV 1:18-21. WLC 1 = 17 / KJV 21,
	// WLC 2 = 17 / 13.
	38: {
		1: [{ from: 1, delta: 0 }],
		2: [
			{ from: 1, to: 4, chapter: 1, delta: 17 },
			{ from: 5, delta: -4 },
		],
	},
	// Malachi has three chapters in the WLC and four in the KJV:
	// WLC 3:19-24 is KJV 4:1-6. WLC 3 = 24 / KJV 18.
	39: {
		3: [
			{ from: 1, to: 18, delta: 0 },
			{ from: 19, chapter: 4, delta: -18 },
		],
	},
};

const PSALMS = 19;

/**
 * Build the alignment for one book.
 *
 * Rules are applied in this order:
 *   (a) an explicit override segment for the chapter,
 *   (b) in Psalms, a superscription offset inferred from the count difference
 *       (the title verse or verses map to null),
 *   (c) equal verse counts in the chapter, which is an identity map,
 *   (d) otherwise null for the whole chapter.
 *
 * @param {number} book 1-66, the book's `order` in src/data/books.json
 * @param {number[]} originalVerseCounts verses per chapter of the original
 * @param {number[]} kjvVerseCounts verses per chapter of the bundled KJV
 * @returns {(chapter: number, verse: number) => {chapter: number, verse: number} | null}
 */
export function alignToKjv(book, originalVerseCounts, kjvVerseCounts) {
	const overrides = OVERRIDES[book] ?? null;

	const inKjv = (chapter, verse) => {
		const count = kjvVerseCounts[chapter - 1];
		return Number.isInteger(count) && verse >= 1 && verse <= count;
	};

	return (chapter, verse) => {
		const originalCount = originalVerseCounts[chapter - 1];
		if (!Number.isInteger(originalCount) || verse < 1 || verse > originalCount) return null;

		// (a) Explicit override. A chapter listed here is fully described by
		// its segments; a verse falling outside all of them is unmapped, and
		// so is a segment target that does not exist in the KJV (which would
		// mean the table and the data have drifted apart).
		const segments = overrides?.[chapter];
		if (segments) {
			for (const segment of segments) {
				const to = segment.to ?? Infinity;
				if (verse < segment.from || verse > to) continue;
				const kjvChapter = segment.chapter ?? chapter;
				const kjvVerse = verse + (segment.delta ?? 0);
				return inKjv(kjvChapter, kjvVerse) ? { chapter: kjvChapter, verse: kjvVerse } : null;
			}
			return null;
		}

		const kjvCount = kjvVerseCounts[chapter - 1];

		// (b) Psalm superscriptions: the WLC's extra leading verse or two.
		if (book === PSALMS && Number.isInteger(kjvCount)) {
			const titleVerses = originalCount - kjvCount;
			if (titleVerses === 1 || titleVerses === 2) {
				if (verse <= titleVerses) return null;
				const kjvVerse = verse - titleVerses;
				return inKjv(chapter, kjvVerse) ? { chapter, verse: kjvVerse } : null;
			}
		}

		// (c) Same number of verses: the two traditions agree.
		if (kjvCount === originalCount) return { chapter, verse };

		// (d) Unexplained disagreement. Better a null than a silently wrong
		// coordinate; the seed script prints every chapter that lands here.
		return null;
	};
}

/**
 * Chapters of a book that rule (d) drops entirely, i.e. the counts disagree
 * and neither an override nor the Psalm-title rule explains it. An empty
 * array means the book is fully accounted for.
 *
 * @param {number} book
 * @param {number[]} originalVerseCounts
 * @param {number[]} kjvVerseCounts
 * @returns {number[]}
 */
export function unmappedChapters(book, originalVerseCounts, kjvVerseCounts) {
	const overrides = OVERRIDES[book] ?? null;
	const chapters = [];
	for (let index = 0; index < originalVerseCounts.length; index++) {
		const chapter = index + 1;
		const originalCount = originalVerseCounts[index];
		const kjvCount = kjvVerseCounts[index];
		if (overrides?.[chapter]) continue;
		if (kjvCount === originalCount) continue;
		if (book === PSALMS && Number.isInteger(kjvCount)) {
			const titleVerses = originalCount - kjvCount;
			if (titleVerses === 1 || titleVerses === 2) continue;
		}
		chapters.push(chapter);
	}
	return chapters;
}
