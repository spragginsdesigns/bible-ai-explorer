import { describe, expect, it } from "vitest";
import type { Note } from "./types";
import {
	filterNotesForLinking,
	formatWikilink,
	hasExactTarget,
	outgoingLinkLabel,
	findWikilinks,
	resolveWikilinkTarget,
	sanitizeWikilinkTarget,
	wikilinkTargetKeys,
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

describe("findWikilinks", () => {
	it("finds a plain link and labels the whole inside", () => {
		const text = "Related: [[Putting Away Corrupt Speech]]";
		const [span] = findWikilinks(text);
		expect(span.target).toBe("Putting Away Corrupt Speech");
		expect(text.slice(span.from, span.to)).toBe("[[Putting Away Corrupt Speech]]");
		expect(text.slice(span.labelFrom, span.labelTo)).toBe("Putting Away Corrupt Speech");
	});

	it("labels only the display text of an aliased link", () => {
		const text = "see [[Romans study|Paul's letter]] here";
		const [span] = findWikilinks(text, 10);
		expect(span.target).toBe("Romans study");
		expect(text.slice(span.labelFrom - 10, span.labelTo - 10)).toBe("Paul's letter");
		expect(span.from).toBe(14);
	});

	it("resolves a heading link to its note", () => {
		expect(findWikilinks("[[Grace alone#Faith]]")[0].target).toBe("Grace alone");
	});

	it("skips empty targets and keeps scanning", () => {
		expect(findWikilinks("[[ ]] and [[|x]] and [[Real]]").map((s) => s.target)).toEqual(["Real"]);
	});
});

describe("resolveWikilinkTarget", () => {
	it("matches title or alias case-insensitively, newest wins", () => {
		const older = { ...makeNote("old", "Grace"), updatedAt: "2026-01-01T00:00:00.000Z" };
		const newer = { ...makeNote("new", "Unmerited", ["grace"]), updatedAt: "2026-02-01T00:00:00.000Z" };
		expect(resolveWikilinkTarget([older, newer], " GRACE ")?.id).toBe("new");
		expect(resolveWikilinkTarget([older], "missing")).toBeNull();
	});
});

describe("wikilinkTargetKeys", () => {
	it("collects lowercased titles and aliases once each", () => {
		expect(wikilinkTargetKeys(notes)).toContain("paul to rome");
		expect(new Set(wikilinkTargetKeys(notes)).size).toBe(wikilinkTargetKeys(notes).length);
	});
});
