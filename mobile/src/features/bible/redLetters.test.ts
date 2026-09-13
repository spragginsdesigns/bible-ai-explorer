import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import annotations from "./data/kjv-red-letters.json";
import { readerVerseSegments, readerSectionHeadings } from "./redLetters";

const speech = (key: keyof typeof annotations) => {
	const [book, chapter, verse] = key.split(":").map(Number);
	return readerVerseSegments(
		annotations[key].text,
		"KJV",
		book,
		chapter,
		verse,
	);
};

describe("source-authored KJV red letters", () => {
	it("keeps narration neutral and marks only Jesus' reply in John 3:3", () => {
		const parts = speech("43:3:3");
		expect(parts[0]).toMatchObject({
			text: "Jesus answered and said unto him, ",
			jesusSpeech: false,
		});
		expect(
			parts
				.filter((s) => s.jesusSpeech)
				.map((s) => s.text)
				.join(""),
		).toBe(
			"Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.",
		);
	});
	it("keeps the response after Jesus' speech neutral", () => {
		const parts = speech("41:2:14");
		expect(
			parts
				.filter((s) => s.jesusSpeech)
				.map((s) => s.text)
				.join(""),
		).toBe("Follow me.");
		expect(parts.at(-1)).toMatchObject({
			text: " And he arose and followed him.",
			jesusSpeech: false,
		});
	});
	it("does not color Nicodemus or infer speech from Jesus' name", () => {
		expect(
			readerVerseSegments("Nicodemus saith unto him", "KJV", 43, 3, 4).some(
				(s) => s.jesusSpeech,
			),
		).toBe(false);
	});
	it("covers quoted speech beyond the Gospels", () => {
		for (const key of ["44:1:8", "46:11:24", "47:12:9", "66:22:20"] as const) {
			expect(speech(key).some((s) => s.jesusSpeech)).toBe(true);
		}
	});
	it("fails closed for changed text and another translation", () => {
		const text = annotations["43:3:3"].text;
		expect(
			readerVerseSegments(text + " changed", "KJV", 43, 3, 3).some(
				(s) => s.jesusSpeech,
			),
		).toBe(false);
		expect(
			readerVerseSegments(text, "NKJV", 43, 3, 3).some((s) => s.jesusSpeech),
		).toBe(false);
	});
	it("preserves italics across speech boundaries", () => {
		const text = annotations["43:3:3"].text.replace("Verily", "<i>Verily</i>");
		expect(
			readerVerseSegments(text, "KJV", 43, 3, 3).find(
				(s) => s.text === "Verily",
			),
		).toMatchObject({ italic: true, jesusSpeech: true });
	});
	it("validates every span against the actual bundled text and preserves every character", () => {
		const dir = join(import.meta.dirname, "data/kjv");
		const books = new Map(
			readdirSync(dir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => [
					Number(f.slice(0, 2)),
					JSON.parse(readFileSync(join(dir, f), "utf8")) as string[][],
				]),
		);
		expect(Object.keys(annotations)).toHaveLength(2028);
		for (const [key, entry] of Object.entries(annotations)) {
			const [book, chapter, verse] = key.split(":").map(Number);
			expect(entry.text, key).toBe(books.get(book)![chapter - 1][verse - 1]);
			let previousEnd = 0;
			for (const [start, end] of entry.ranges) {
				expect(start, key).toBeGreaterThanOrEqual(previousEnd);
				expect(end, key).toBeGreaterThan(start);
				expect(end, key).toBeLessThanOrEqual(entry.text.length);
				previousEnd = end;
			}
			expect(
				readerVerseSegments(entry.text, "KJV", book, chapter, verse)
					.map((s) => s.text)
					.join(""),
				key,
			).toBe(entry.text);
		}
	});
});

it("adds credited section headings to KJV without adding them to copied Scripture", () => {
 expect(readerSectionHeadings("KJV",43,3,1)).toEqual(["Jesus and Nicodemus"]);
 expect(readerSectionHeadings("NKJV",43,3,1)).toEqual([]);
 const text=annotations["43:3:3"].text;
 expect(readerVerseSegments(text,"KJV",43,3,3).map(s=>s.text).join("")).toBe(text);
});
