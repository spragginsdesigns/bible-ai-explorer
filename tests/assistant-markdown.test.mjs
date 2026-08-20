import assert from "node:assert/strict";
import test from "node:test";

import {
	closeOpenInlineMarkdown,
	joinAssistantTextParts,
	normalizeAssistantMarkdown,
	repairMarkdownBlocks,
	stripFollowUpMarkers,
} from "../src/utils/assistantMarkdown.ts";

// Keep these vectors mirrored in mobile/src/lib/assistantMarkdown.test.ts —
// the two copies of the module must behave identically.

test("joinAssistantTextParts separates tool-call-split parts with a blank line", () => {
	assert.equal(
		joinAssistantTextParts(["...in that setting He says:", "- **Cease your striving.**"]),
		"...in that setting He says:\n\n- **Cease your striving.**"
	);
	assert.equal(joinAssistantTextParts(["only one part"]), "only one part");
	assert.equal(joinAssistantTextParts([]), "");
});

test("stripFollowUpMarkers removes complete marker lines anywhere in the text", () => {
	assert.equal(
		stripFollowUpMarkers("Answer.\n[FOLLOWUP] What else?\n[FOLLOWUP] More?", {
			streaming: false,
		}),
		"Answer."
	);
	// A marker line mid-answer is removed without eating what follows.
	assert.equal(
		stripFollowUpMarkers("Before.\n[FOLLOWUP] stray\nAfter.", { streaming: false }),
		"Before.\nAfter."
	);
});

test("stripFollowUpMarkers removes a half-typed marker only while streaming", () => {
	assert.equal(
		stripFollowUpMarkers("Answer.\n[FOLLO", { streaming: true }),
		"Answer."
	);
	assert.equal(stripFollowUpMarkers("Answer.\n[", { streaming: true }), "Answer.");
	// Settled messages keep whatever the model actually wrote.
	assert.equal(
		stripFollowUpMarkers("Answer.\n[FOLLO", { streaming: false }),
		"Answer.\n[FOLLO"
	);
});

test("repairMarkdownBlocks separates a block construct jammed against text", () => {
	assert.equal(
		repairMarkdownBlocks("Contextually, its force is:\n- Cease your striving."),
		"Contextually, its force is:\n\n- Cease your striving."
	);
	assert.equal(
		repairMarkdownBlocks("Some intro.\n## A heading"),
		"Some intro.\n\n## A heading"
	);
	assert.equal(
		repairMarkdownBlocks("He says:\n> Be still, and know that I am God."),
		"He says:\n\n> Be still, and know that I am God."
	);
});

test("repairMarkdownBlocks leaves tight lists and fence contents alone", () => {
	const tight = "- one\n- two\n- three";
	assert.equal(repairMarkdownBlocks(tight), tight);
	const fence = "```\n- not a list\n## not a heading\n```";
	assert.equal(repairMarkdownBlocks(fence), fence);
});

test("repairMarkdownBlocks converts exotic bullets but not citation dashes", () => {
	assert.equal(repairMarkdownBlocks("• first point"), "- first point");
	assert.equal(repairMarkdownBlocks("  ◦ nested point"), "  - nested point");
	// Verse attribution lines must not become list items.
	assert.equal(
		repairMarkdownBlocks("— Psalm 46:10, KJV"),
		"— Psalm 46:10, KJV"
	);
});

test("closeOpenInlineMarkdown closes constructs left open by a partial stream", () => {
	assert.equal(
		closeOpenInlineMarkdown("It is a command to **stop striving"),
		"It is a command to **stop striving**"
	);
	assert.equal(
		closeOpenInlineMarkdown("```\ncode still coming"),
		"```\ncode still coming\n```"
	);
	assert.equal(closeOpenInlineMarkdown("He said `selah"), "He said `selah`");
	// Balanced text is untouched.
	assert.equal(
		closeOpenInlineMarkdown("Already **closed** and `done`."),
		"Already **closed** and `done`."
	);
});

test("normalizeAssistantMarkdown runs the full pipeline", () => {
	assert.equal(
		normalizeAssistantMarkdown("Intro:\n• **Cease your striving.\n[FOLLOWUP] Next?", {
			streaming: true,
		}),
		"Intro:\n\n- **Cease your striving.**"
	);
	// Non-streaming keeps partial markers and open inline constructs as written.
	assert.equal(
		normalizeAssistantMarkdown("It is a command to **stop striving", {
			streaming: false,
		}),
		"It is a command to **stop striving"
	);
});
