import { describe, expect, it } from "vitest";
import { buildSuggestedQuestionItems, questionReference } from "./questionPresentation";

describe("question presentation", () => {
	it("preserves every generated question in its original order", () => {
		const questions = [
			"How does Romans 8:26–27 encourage me when I do not know what to pray?",
			"What can I learn from Jacob wrestling with God in Genesis 32?",
			"How should I explain being born again to my children?",
		];

		expect(buildSuggestedQuestionItems(questions).map((item) => item.question)).toEqual(questions);
	});

	it("shows only references that actually occur in the generated question", () => {
		expect(questionReference("What does Acts 9:17-19 show about Ananias?")).toBe(
			"ACTS 9:17–19",
		);
		expect(questionReference("What can I learn from Genesis 32?")).toBe("GENESIS 32");
		expect(questionReference("How should I explain being born again to my children?")).toBeNull();
	});
});
