/**
 * Pins verses where the Project Gutenberg KJV (#10) - the source of every
 * bundled copy - departs from the KJV text, so a regenerated corpus
 * (mobile/scripts/build-kjv-data.py) can't quietly bring a typo back.
 *
 * The same text ships four ways: biblical-texts/KJV-Bible.txt (read at runtime
 * by src/utils/kjvBible.ts) and the per-book JSON in src/data/kjv (web + API),
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

const PINNED = [
	[48, 2, 20, "I am crucified with Christ: nevertheless I live; yet not I, but Christ liveth in me: and the life which I now live in the flesh I live by the faith of the Son of God, who loved me, and gave himself for me."],
	[1, 14, 5, "And in the fourteenth year came Chedorlaomer, and the kings that were with him, and smote the Rephaims in Ashteroth Karnaim, and the Zuzims in Ham, and the Emims in Shaveh Kiriathaim,"],
	[1, 47, 4, "They said moreover unto Pharaoh, For to sojourn in the land are we come; for thy servants have no pasture for their flocks; for the famine is sore in the land of Canaan: now therefore, we pray thee, let thy servants dwell in the land of Goshen."],
	[6, 18, 23, "And Avim, and Parah, and Ophrah,"],
	[10, 14, 10, "And the king said, Whosoever saith ought unto thee, bring him to me, and he shall not touch thee any more."],
	[20, 6, 26, "For by means of a whorish woman a man is brought to a piece of bread: and the adulteress will hunt for the precious life."],
	[26, 22, 21, "Yea, I will gather you, and blow upon you in the fire of my wrath, and ye shall be melted in the midst thereof."],
	[32, 1, 15, "So they took up Jonah, and cast him forth into the sea: and the sea ceased from her raging."],
	[39, 4, 6, "And he shall turn the heart of the fathers to the children, and the heart of the children to their fathers, lest I come and smite the earth with a curse."],
	[43, 21, 18, "Verily, verily, I say unto thee, When thou wast young, thou girdedst thyself, and walkedst whither thou wouldest: but when thou shalt be old, thou shalt stretch forth thy hands, and another shall gird thee, and carry thee whither thou wouldest not."],
	[54, 6, 14, "That thou keep this commandment without spot, unrebukeable, until the appearing of our Lord Jesus Christ:"],
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

test("every bundled JSON copy of the KJV is identical", () => {
	for (const { file } of books) {
		const [web, ...others] = COPIES.map((dir) => read(`${dir}/${file}`));
		for (const other of others) assert.equal(other, web, file);
	}
});

test("no verse carries Gutenberg's section divider", () => {
	for (const { file } of books) {
		for (const chapter of JSON.parse(read(`../src/data/kjv/${file}`))) {
			for (const text of chapter) assert.ok(!text.includes("***"), `${file}: ${text}`);
		}
	}
});
