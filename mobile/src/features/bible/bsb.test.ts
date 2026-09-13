import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBsbChapter } from "./bsb";
import { BOOKS } from "./books";
import { getChapter } from "./translations";
import { readerVerseSegments } from "./redLetters";
import { searchBible } from "./search";

describe("publisher BSB edition", () => {
	it("keeps source headings separate from Scripture and copied text", async () => {
		const chapter = getBsbChapter(43, 3);
		expect(chapter[0].headings).toEqual(["Jesus and Nicodemus"]);
		expect(chapter[0].text).not.toContain("Jesus and Nicodemus");
		expect(await getChapter("BSB", 43, 3)).toEqual(chapter.map((v) => v.text));
	});
	it("carries source speech over verse boundaries and handles narration within a verse", () => {
		const chapter = getBsbChapter(43, 3);
		expect(chapter[5].segments.every((s) => s.jesusSpeech)).toBe(true);
		expect(chapter[3].segments.some((s) => s.jesusSpeech)).toBe(false);
		const parts = readerVerseSegments(chapter[9].text, "BSB", 43, 3, 10);
		expect(
			parts
				.filter((s) => !s.jesusSpeech)
				.map((s) => s.text)
				.join(""),
		).toContain("said Jesus");
		expect(parts.filter((s) => s.jesusSpeech)).toHaveLength(2);
	});
	it("preserves omitted numbers so later verses never shift", () => {
		const verses = getBsbChapter(40, 17);
		expect(verses[20]).toMatchObject({ number: 21, text: "", omitted: true });
		expect(verses[21].number).toBe(22);
		expect(verses[21].text).toContain("Galilee");
	});
	it("serves the same complete edition on web and mobile", () => {
		let total = 0,
			headings = 0;
		for (const book of BOOKS) {
			const web = JSON.parse(
				readFileSync(
					resolve(
						import.meta.dirname,
						`../../../../src/data/bsb/${String(book.order).padStart(2, "0")}.json`,
					),
					"utf8",
				),
			);
			expect(web).toHaveLength(book.chapters);
			for (let chapter = 1; chapter <= book.chapters; chapter++) {
				const verses = getBsbChapter(book.order, chapter);
				expect(verses).toEqual(web[chapter - 1]);
				verses.forEach((verse, index) => {
					expect(verse.number).toBe(index + 1);
					expect(verse.segments.map((s) => s.text).join("")).toBe(verse.text);
					expect(verse.text).not.toMatch(/\\(?:wj|v|f|s1)/);
					expect(verse.text.length > 0 || verse.omitted === true).toBe(true);
					total++;
					headings += verse.headings.length;
				});
			}
		}
		expect(total).toBe(31102);
		expect(headings).toBe(3140);
	});
	it("searches BSB locally with correct translation attribution", async () => {
		const result = await searchBible("no one can see the kingdom", "BSB", 3);
		expect(result.translation).toBe("BSB");
		expect(result.hits).toContainEqual(
			expect.objectContaining({ order: 43, chapter: 3, verse: 3, translation: "BSB" }),
		);
	});
	it("rejects invalid references", () => {
		expect(() => getBsbChapter(0, 1)).toThrow();
		expect(() => getBsbChapter(43, 0)).toThrow();
		expect(() => getBsbChapter(43, 22)).toThrow();
	});
});
