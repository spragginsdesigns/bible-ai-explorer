import { describe, expect, it } from "vitest";
import type { Note } from "./types";
import {
	filterNotesForLinking,
	formatWikilink,
	hasExactTarget,
	outgoingLinkLabel,
	sanitizeWikilinkTarget,
} from "./wikilinks";

function makeNote(id: string, title: string, aliases: string[] = []): Note {
	return {
		id,
		title,
		content: "",
		htmlContent: "",
		plainText: "",
		folderId: null,
		tagIds: [],
		aliases,
		properties: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		isPinned: false,
		wordCount: 0,
	};
}

const notes = [
	makeNote("a", "Romans study", ["Paul to Rome"]),
	makeNote("b", "Grace alone"),
	makeNote("c", "Sermon notes"),
];

describe("sanitizeWikilinkTarget", () => {
	it("strips the characters that carry meaning inside brackets", () => {
		expect(sanitizeWikilinkTarget("Romans [1] | notes # 3")).toBe("Romans 1 notes 3");
	});

	it("collapses whitespace and trims", () => {
		expect(sanitizeWikilinkTarget("  Grace   alone  ")).toBe("Grace alone");
	});
});

describe("formatWikilink", () => {
	it("wraps a sanitized target", () => {
		expect(formatWikilink("Romans study")).toBe("[[Romans study]]");
		expect(formatWikilink("Romans|study")).toBe("[[Romans study]]");
	});

	it("returns an empty string when nothing usable survives", () => {
		expect(formatWikilink("  ")).toBe("");
		expect(formatWikilink("[[]]")).toBe("");
	});
});

describe("filterNotesForLinking", () => {
	it("excludes the note being edited", () => {
		expect(filterNotesForLinking(notes, "", "a").map((n) => n.id)).toEqual(["b", "c"]);
	});

	it("matches titles and aliases case-insensitively", () => {
		expect(filterNotesForLinking(notes, "romans", "z").map((n) => n.id)).toEqual(["a"]);
		expect(filterNotesForLinking(notes, "paul to rome", "z").map((n) => n.id)).toEqual(["a"]);
	});
});

describe("hasExactTarget", () => {
	it("is true for an exact title or alias", () => {
		expect(hasExactTarget(notes, "grace alone", "z")).toBe(true);
		expect(hasExactTarget(notes, "Paul to Rome", "z")).toBe(true);
	});

	it("is false for a title no note carries", () => {
		expect(hasExactTarget(notes, "Ephesians", "z")).toBe(false);
	});

	it("treats a blank query as nothing to create", () => {
		expect(hasExactTarget(notes, "  ", "z")).toBe(true);
	});

	it("ignores the note being edited", () => {
		expect(hasExactTarget(notes, "Romans study", "a")).toBe(false);
	});
});

describe("outgoingLinkLabel", () => {
	it("prefers the resolved note title", () => {
		expect(outgoingLinkLabel({ targetTitle: "romans study", title: "Romans study" })).toBe(
			"Romans study"
		);
	});

	it("falls back to what was typed when unresolved", () => {
		expect(outgoingLinkLabel({ targetTitle: "Ephesians", title: null })).toBe("Ephesians");
	});
});
