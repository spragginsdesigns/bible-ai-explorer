/**
 * The bundled KJV is eBible.org's standard 1769 text, built by
 * scripts/bible/build-kjv.py. It replaced a Project Gutenberg text that
 * misspelled words (Galatians 2:20 "neverthless"), dropped or swapped others
 * (Jonah 1:15 "look up Jonah", Mark 15:2 "unto them") and modernized
 * spellings. The verses below pin that history so a regenerated corpus
 * can't quietly bring any of it back.
 *
 * The same text ships four ways: biblical-texts/kjv.json (read at runtime by
 * src/utils/kjvBible.ts) and the per-book JSON in src/data/kjv (web + API),
 * mobile/src/features/bible/data/kjv (Android) and macos/Shared/Bible/Data/kjv
 * (macOS + iOS). Every one is checked.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getKjvVerseText } from "../src/utils/kjvBible.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const COPIES = [
	"../src/data/kjv",
	"../mobile/src/features/bible/data/kjv",
	"../macos/Shared/Bible/Data/kjv",
];
const books = JSON.parse(read("../src/data/books.json"));
const runtime = JSON.parse(read("../biblical-texts/kjv.json"));

const PINNED = [
	// Misspellings in the Gutenberg text.
	[48, 2, 20, "I am crucified with Christ: nevertheless I live; yet not I, but Christ liveth in me: and the life which I now live in the flesh I live by the faith of the Son of God, who loved me, and gave himself for me."],
	[1, 47, 4, "They said moreover unto Pharaoh, For to sojourn in the land are we come; for thy servants have no pasture for their flocks; for the famine is sore in the land of Canaan: now therefore, we pray thee, let thy servants dwell in the land of Goshen."],
	[26, 22, 21, "Yea, I will gather you, and blow upon you in the fire of my wrath, and ye shall be melted in the midst thereof."],
	[54, 6, 14, "That thou keep this commandment without spot, unrebukeable, until the appearing of our Lord Jesus Christ:"],
	[43, 21, 18, "Verily, verily, I say unto thee, When thou wast young, thou girdedst thyself, and walkedst whither thou wouldest: but when thou shalt be old, thou shalt stretch forth thy hands, and another shall gird thee, and carry thee whither thou wouldest not."],
	// Wrong or missing words.
	[32, 1, 15, "So they took up Jonah, and cast him forth into the sea: and the sea ceased from her raging."],
	[41, 15, 2, "And Pilate asked him, Art thou the King of the Jews? And he answering said unto him, Thou sayest it."],
	[9, 15, 33, "And Samuel said, As thy sword hath made women childless, so shall thy mother be childless among women. And Samuel hewed Agag in pieces before the LORD in Gilgal."],
	[62, 2, 23, "Whosoever denieth the Son, the same hath not the Father: [but] he that acknowledgeth the Son hath the Father also."],
	// Spellings the Gutenberg text had modernized.
	[40, 16, 3, "And in the morning, It will be foul weather to day: for the sky is red and lowring. O ye hypocrites, ye can discern the face of the sky; but can ye not discern the signs of the times?"],
	// The source's "*** The New Testament" divider is not Scripture.
	[39, 4, 6, "And he shall turn the heart of the fathers to the children, and the heart of the children to their fathers, lest I come and smite the earth with a curse."],
	// A Psalm's title is not its first verse.
	[19, 3, 1, "LORD, how are they increased that trouble me! many are they that rise up against me."],
];

const bookFile = (order) => books.find((book) => book.order === order).file;

for (const [order, chapter, verse, expected] of PINNED) {
	const label = `${books.find((book) => book.order === order).name} ${chapter}:${verse}`;

	test(`${label} reads as the KJV in every bundled JSON copy`, () => {
		for (const dir of COPIES) {
			const chapters = JSON.parse(read(`${dir}/${bookFile(order)}`));
			assert.equal(chapters[chapter - 1][verse - 1], expected, dir);
		}
	});

	test(`${label} reads as the KJV from the runtime corpus`, async () => {
		assert.equal(await getKjvVerseText(order, chapter, verse), expected);
	});
}

test("every bundled copy of the KJV is identical, runtime corpus included", () => {
	let verses = 0;
	for (const book of books) {
		const [web, ...others] = COPIES.map((dir) => read(`${dir}/${book.file}`));
		for (const other of others) assert.equal(other, web, book.file);
		const chapters = JSON.parse(web);
		assert.deepEqual(runtime[book.order - 1], chapters, book.file);
		assert.equal(chapters.length, book.chapters, book.file);
		verses += chapters.reduce((sum, chapter) => sum + chapter.length, 0);
	}
	assert.equal(verses, 31102);
});

test("no verse carries source markup, headings or stray whitespace", () => {
	for (const { file } of books) {
		for (const chapter of JSON.parse(read(`../src/data/kjv/${file}`))) {
			for (const text of chapter) {
				assert.ok(text && text === text.trim() && !/\s{2}/.test(text), `${file}: ${text}`);
				assert.ok(!/[\\*¶æ<>{}|]/.test(text), `${file}: ${text}`);
			}
		}
	}
});
