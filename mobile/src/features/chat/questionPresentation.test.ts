import { describe, expect, it } from "vitest";
import {
	buildSuggestedQuestionItems,
	parseReferenceLabel,
	parseSuggestedQuestions,
	parseSuggestedQuestionsResponse,
	questionReference,
} from "./questionPresentation";

const EN_DASH = "\u2013";

describe("question presentation", () => {
	it("preserves every generated question in its original order", () => {
		const questions = [
			{ question: `How does Romans 8:26${EN_DASH}27 encourage me when I do not know what to pray?`, label: "Romans 8:26" },
			{ question: "What can I learn from Jacob wrestling with God in Genesis 32?", label: "Genesis 32" },
			{ question: "How should I explain being born again to my children?", label: "APPLY" },
		];

		expect(buildSuggestedQuestionItems(questions).map((item) => item.question)).toEqual(
			questions.map((entry) => entry.question),
		);
	});

	it("shows only references that actually occur in the generated question", () => {
		expect(questionReference("What does Acts 9:17-19 show about Ananias?")).toBe(
			`Acts 9:17${EN_DASH}19`,
		);
		expect(questionReference("What can I learn from Genesis 32?")).toBe("Genesis 32");
		expect(questionReference("How should I explain being born again to my children?")).toBeNull();
	});

	it("normalizes a reference the model wrote loosely", () => {
		expect(parseReferenceLabel("james 3:5-6")).toBe(`James 3:5${EN_DASH}6`);
		expect(parseReferenceLabel("1samuel 3")).toBe("1 Samuel 3");
		expect(parseReferenceLabel("song of solomon 2:1")).toBe("Song of Solomon 2:1");
		expect(parseReferenceLabel("Genesis 1-2")).toBe(`Genesis 1${EN_DASH}2`);
	});

	it("rejects a label that is not a whole reference", () => {
		expect(parseReferenceLabel("APPLY")).toBeNull();
		expect(parseReferenceLabel("What Genesis 1 teaches")).toBeNull();
		expect(parseReferenceLabel("Hezekiah 4:2")).toBeNull();
	});

	it("renders the server's label in upper case, whatever kind it is", () => {
		const items = buildSuggestedQuestionItems([
			{ question: "What did I write about patience?", label: "YOUR NOTES" },
			{ question: "How do I carry today's word into work?", label: "TODAY'S VERSE" },
			{ question: "What does James 3 say about the tongue?", label: "James 3:5" },
		]);

		expect(items.map((item) => item.label)).toEqual(["YOUR NOTES", "TODAY'S VERSE", "JAMES 3:5"]);
	});

	it("falls back to the question's own reference only when no label was sent", () => {
		const items = buildSuggestedQuestionItems([
			{ question: "What does Acts 9:17-19 show about Ananias?", label: null },
			"What can I learn from Genesis 32?",
			{ question: "How should I pray at work?" },
		]);

		expect(items.map((item) => item.label)).toEqual([
			`ACTS 9:17${EN_DASH}19`,
			"GENESIS 32",
			null,
		]);
	});

	it("parses both the labelled shape and the bare strings an older deploy sends", () => {
		expect(
			parseSuggestedQuestions([
				{ question: "What does James 3 say about the tongue?", label: "James 3:5" },
				"What can I learn from Genesis 32?",
				{ question: "", label: "APPLY" },
				{ label: "MEMORY" },
				null,
				42,
			]),
		).toEqual([
			{ question: "What does James 3 say about the tongue?", label: "James 3:5" },
			{ question: "What can I learn from Genesis 32?", label: null },
		]);

		expect(parseSuggestedQuestions("nope")).toEqual([]);
	});

	it("reads the labelled items and falls back to the plain questions array", () => {
		expect(
			parseSuggestedQuestionsResponse({
				questions: ["What does James 3 say about the tongue?"],
				items: [{ question: "What does James 3 say about the tongue?", label: "James 3:5" }],
				personalized: true,
			}),
		).toEqual([{ question: "What does James 3 say about the tongue?", label: "James 3:5" }]);

		// A deploy that predates labels: only the plain array is there.
		expect(
			parseSuggestedQuestionsResponse({
				questions: ["What can I learn from Genesis 32?"],
				personalized: true,
			}),
		).toEqual([{ question: "What can I learn from Genesis 32?", label: null }]);

		expect(parseSuggestedQuestionsResponse({ questions: [], items: [] })).toEqual([]);
		expect(parseSuggestedQuestionsResponse(null)).toEqual([]);
	});
});
