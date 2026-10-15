import { describe, expect, it } from "vitest";
import {
	matchChapterNotes,
	notesForSelection,
	versesWithNotes,
} from "./chapterNotes";

describe("chapterNotes", () => {
	const notes = [
		{
			id: "n-1",
			title: "John 3:16",
			plainText: 'John 3:16 — "For God so loved the world" (KJV)\nSacrificial love.',
			updatedAt: "2026-10-14T10:00:00.000Z",
		},
		{
			id: "n-2",
			title: "Born Again",
			plainText: "See Jn. 3:3-5 for Jesus' words to Nicodemus.",
			updatedAt: "2026-10-14T12:00:00.000Z",
		},
		{
			id: "n-3",
			title: "John 3 Study",
			plainText: "Overview of the chapter.",
			updatedAt: "2026-10-14T08:00:00.000Z",
		},
		{
			id: "n-4",
			title: "1 John 3:16",
			plainText: "1 John 3:16 — Hereby perceive we the love of God.",
			updatedAt: "2026-10-14T14:00:00.000Z",
		},
	];

	it("links verse, range, and chapter notes without matching 1 John as John", () => {
		const matches = matchChapterNotes(notes, {
			bookName: "John",
			bookAbbr: "John",
			chapter: 3,
			verseCount: 36,
		});

		expect(matches.map((m) => m.id)).toEqual(["n-2", "n-1", "n-3"]);
		expect([...versesWithNotes(matches)].sort((a, b) => a - b)).toEqual([3, 4, 5, 16]);
		expect(notesForSelection(matches, { start: 4, end: 4 }).map((m) => m.id)).toEqual([
			"n-2",
			"n-3",
		]);
	});

	it("matches numbered books accurately", () => {
		const matches = matchChapterNotes(notes, {
			bookName: "1 John",
			bookAbbr: "1 John",
			chapter: 3,
			verseCount: 24,
		});
		expect(matches.map((m) => m.id)).toEqual(["n-4"]);
		expect(matches[0]?.verses).toEqual([16]);
	});
});
