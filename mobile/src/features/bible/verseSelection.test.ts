import { describe, expect, it } from "vitest";
import {
	MAX_SELECTED_VERSES,
	selectionColor,
	selectionIncludes,
	selectionReference,
	selectionShareText,
	selectionText,
	selectionVerses,
	toggleVerse,
} from "./verseSelection";

describe("toggleVerse", () => {
	it("starts a selection on the tapped verse", () => {
		expect(toggleVerse(null, 4)).toEqual({ start: 4, end: 4 });
	});

	it("clears a single-verse selection when that verse is tapped again", () => {
		expect(toggleVerse({ start: 4, end: 4 }, 4)).toBeNull();
	});

	it("grows the range to cover a verse tapped below or above it", () => {
		expect(toggleVerse({ start: 4, end: 4 }, 6)).toEqual({ start: 4, end: 6 });
		expect(toggleVerse({ start: 4, end: 6 }, 2)).toEqual({ start: 2, end: 6 });
	});

	it("re-anchors on a verse tapped inside a wider range", () => {
		expect(toggleVerse({ start: 2, end: 6 }, 3)).toEqual({ start: 3, end: 3 });
		expect(toggleVerse({ start: 2, end: 6 }, 2)).toEqual({ start: 2, end: 2 });
	});

	it("refuses to grow past the maximum", () => {
		const full = { start: 1, end: MAX_SELECTED_VERSES };
		expect(toggleVerse(full, MAX_SELECTED_VERSES + 1)).toBe(full);
		expect(toggleVerse({ start: 1, end: 1 }, MAX_SELECTED_VERSES + 1)).toEqual({
			start: 1,
			end: 1,
		});
		expect(toggleVerse({ start: 1, end: 1 }, MAX_SELECTED_VERSES)).toEqual({
			start: 1,
			end: MAX_SELECTED_VERSES,
		});
	});
});

describe("selection helpers", () => {
	it("lists the verses and answers membership", () => {
		expect(selectionVerses({ start: 3, end: 5 })).toEqual([3, 4, 5]);
		expect(selectionIncludes({ start: 3, end: 5 }, 5)).toBe(true);
		expect(selectionIncludes({ start: 3, end: 5 }, 6)).toBe(false);
		expect(selectionIncludes(null, 3)).toBe(false);
	});

	it("labels one verse and a range", () => {
		expect(selectionReference("Genesis", 1, { start: 1, end: 1 })).toBe("Genesis 1:1");
		expect(selectionReference("1 John", 3, { start: 16, end: 18 })).toBe("1 John 3:16-18");
	});

	it("joins a range with verse numbers and leaves a single verse bare", () => {
		const texts = ["In the beginning", "And the earth", "And God said"];
		expect(selectionText(texts, { start: 2, end: 2 })).toBe("And the earth");
		expect(selectionText(texts, { start: 1, end: 3 })).toBe(
			"1 In the beginning 2 And the earth 3 And God said"
		);
	});

	it("tolerates a selection past the loaded chapter", () => {
		expect(selectionText(["only"], { start: 2, end: 3 })).toBe("2 3");
		expect(selectionText(["only"], { start: 5, end: 5 })).toBe("");
	});

	it("formats the share payload the way the sheet always has", () => {
		expect(selectionShareText("John 3:16", "For God so loved", "KJV")).toBe(
			'John 3:16 — "For God so loved" (KJV)'
		);
	});

	it("reports a shared color only when every verse carries it", () => {
		const highlights = new Map([
			[1, "#F5D76E"],
			[2, "#f5d76e"],
			[3, "#E84C3D"],
		]);
		expect(selectionColor(highlights, { start: 1, end: 2 })).toBe("#F5D76E");
		expect(selectionColor(highlights, { start: 1, end: 3 })).toBeUndefined();
		expect(selectionColor(highlights, { start: 3, end: 4 })).toBeUndefined();
		expect(selectionColor(highlights, { start: 3, end: 3 })).toBe("#E84C3D");
	});
});
