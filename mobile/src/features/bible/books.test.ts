import { describe, expect, it } from "vitest";
import { bookByOrder, resolveReference } from "./books";

describe("bookByOrder", () => {
	it("returns the book for a valid order", () => {
		expect(bookByOrder(43)?.name).toBe("John");
		expect(bookByOrder(1)?.name).toBe("Genesis");
		expect(bookByOrder(66)?.name).toBe("Revelation");
	});

	it("returns null out of range", () => {
		expect(bookByOrder(0)).toBeNull();
		expect(bookByOrder(67)).toBeNull();
	});
});

describe("resolveReference", () => {
	it("parses book, chapter and verse", () => {
		expect(resolveReference("John 3:16")).toEqual({ order: 43, chapter: 3, verse: 16 });
	});

	it("parses a chapter-only reference", () => {
		expect(resolveReference("Psalm 23")).toEqual({ order: 19, chapter: 23 });
	});

	it("parses abbreviations", () => {
		expect(resolveReference("Gen 1")).toEqual({ order: 1, chapter: 1 });
		expect(resolveReference("1 Cor 13:4")).toEqual({ order: 46, chapter: 13, verse: 4 });
	});

	it("parses numbered books with full names", () => {
		expect(resolveReference("1 Samuel 2:1")).toEqual({ order: 9, chapter: 2, verse: 1 });
		expect(resolveReference("2 Kings 25")).toEqual({ order: 12, chapter: 25 });
	});

	it("returns the start verse of a range", () => {
		expect(resolveReference("1 Samuel 2:1-10")).toEqual({ order: 9, chapter: 2, verse: 1 });
		expect(resolveReference("John 3:16-18")).toEqual({ order: 43, chapter: 3, verse: 16 });
	});

	it("is case-insensitive and tolerant of punctuation/whitespace", () => {
		expect(resolveReference("john 3:16")).toEqual({ order: 43, chapter: 3, verse: 16 });
		expect(resolveReference("GEN. 1")).toEqual({ order: 1, chapter: 1 });
		expect(resolveReference("  Song of Solomon  4 ")).toEqual({ order: 22, chapter: 4 });
	});

	it("rejects unresolvable input", () => {
		expect(resolveReference("")).toBeNull();
		expect(resolveReference("Not a reference")).toBeNull();
		expect(resolveReference("Hezekiah 1:1")).toBeNull();
		expect(resolveReference("John")).toBeNull();
		expect(resolveReference("John 3:16 extra")).toBeNull();
	});

	it("rejects chapters outside the book", () => {
		expect(resolveReference("Jude 2")).toBeNull();
		expect(resolveReference("Genesis 51")).toBeNull();
		expect(resolveReference("John 0")).toBeNull();
	});
});
