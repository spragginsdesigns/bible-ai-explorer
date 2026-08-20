import { describe, expect, it } from "vitest";

import {
	closeOpenInlineMarkdown,
	joinAssistantTextParts,
	normalizeAssistantMarkdown,
	repairMarkdownBlocks,
	stripFollowUpMarkers,
} from "./assistantMarkdown";

// Keep these vectors mirrored in tests/assistant-markdown.test.mjs on the web
// side — the two copies of the module must behave identically.

describe("joinAssistantTextParts", () => {
	it("separates tool-call-split parts with a blank line", () => {
		expect(
			joinAssistantTextParts(["...in that setting He says:", "- **Cease your striving.**"])
		).toBe("...in that setting He says:\n\n- **Cease your striving.**");
		expect(joinAssistantTextParts(["only one part"])).toBe("only one part");
		expect(joinAssistantTextParts([])).toBe("");
	});
});

describe("stripFollowUpMarkers", () => {
	it("removes complete marker lines anywhere in the text", () => {
		expect(
			stripFollowUpMarkers("Answer.\n[FOLLOWUP] What else?\n[FOLLOWUP] More?", {
				streaming: false,
			})
		).toBe("Answer.");
		// A marker line mid-answer is removed without eating what follows.
		expect(
			stripFollowUpMarkers("Before.\n[FOLLOWUP] stray\nAfter.", { streaming: false })
		).toBe("Before.\nAfter.");
	});

	it("removes a half-typed marker only while streaming", () => {
		expect(stripFollowUpMarkers("Answer.\n[FOLLO", { streaming: true })).toBe("Answer.");
		expect(stripFollowUpMarkers("Answer.\n[", { streaming: true })).toBe("Answer.");
		// Settled messages keep whatever the model actually wrote.
		expect(stripFollowUpMarkers("Answer.\n[FOLLO", { streaming: false })).toBe(
			"Answer.\n[FOLLO"
		);
	});
});

describe("repairMarkdownBlocks", () => {
	it("separates a block construct jammed against text", () => {
		expect(repairMarkdownBlocks("Contextually, its force is:\n- Cease your striving.")).toBe(
			"Contextually, its force is:\n\n- Cease your striving."
		);
		expect(repairMarkdownBlocks("Some intro.\n## A heading")).toBe("Some intro.\n\n## A heading");
		expect(repairMarkdownBlocks("He says:\n> Be still, and know that I am God.")).toBe(
			"He says:\n\n> Be still, and know that I am God."
		);
	});

	it("leaves tight lists and fence contents alone", () => {
		const tight = "- one\n- two\n- three";
		expect(repairMarkdownBlocks(tight)).toBe(tight);
		const fence = "```\n- not a list\n## not a heading\n```";
		expect(repairMarkdownBlocks(fence)).toBe(fence);
	});

	it("converts exotic bullets but not citation dashes", () => {
		expect(repairMarkdownBlocks("• first point")).toBe("- first point");
		expect(repairMarkdownBlocks("  ◦ nested point")).toBe("  - nested point");
		// Verse attribution lines must not become list items.
		expect(repairMarkdownBlocks("— Psalm 46:10, KJV")).toBe("— Psalm 46:10, KJV");
	});
});

describe("closeOpenInlineMarkdown", () => {
	it("closes constructs left open by a partial stream", () => {
		expect(closeOpenInlineMarkdown("It is a command to **stop striving")).toBe(
			"It is a command to **stop striving**"
		);
		expect(closeOpenInlineMarkdown("```\ncode still coming")).toBe("```\ncode still coming\n```");
		expect(closeOpenInlineMarkdown("He said `selah")).toBe("He said `selah`");
		// Balanced text is untouched.
		expect(closeOpenInlineMarkdown("Already **closed** and `done`.")).toBe(
			"Already **closed** and `done`."
		);
	});
});

describe("normalizeAssistantMarkdown", () => {
	it("runs the full pipeline", () => {
		expect(
			normalizeAssistantMarkdown("Intro:\n• **Cease your striving.\n[FOLLOWUP] Next?", {
				streaming: true,
			})
		).toBe("Intro:\n\n- **Cease your striving.**");
		// Non-streaming keeps partial markers and open inline constructs as written.
		expect(
			normalizeAssistantMarkdown("It is a command to **stop striving", { streaming: false })
		).toBe("It is a command to **stop striving");
	});
});
