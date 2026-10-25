import { describe, expect, it } from "vitest";
import * as webContract from "../../../../src/lib/quiz-contract";
import * as mobileContract from "./quizContract";
import type { ChapterQuiz, QuizQuestion } from "./quizContract";
import {
	addDismissed,
	askAboutPrompt,
	buildAttempt,
	continueLabel,
	correctCount,
	missedQuestions,
	nextChapterAfter,
	offerTitle,
	optionAccessibilityLabel,
	progressAccessibilityLabel,
	progressLabel,
	quizErrorMessage,
	reflectionNote,
	resultsHeadline,
	resultsSubline,
	showsKjvNotice,
	verseLabel,
	OFFLINE_MESSAGE,
	UNAVAILABLE_MESSAGE,
} from "./quizView";

function question(id: string, verses: number[], reference: string, answerIndex = 1): QuizQuestion {
	return {
		id,
		prompt: `Prompt ${id}`,
		options: ["a", "b", "c", "d"],
		answerIndex,
		verses,
		reference,
		verseText: "Verse text",
		note: null,
	};
}

const quiz: ChapterQuiz = {
	book: 43,
	chapter: 3,
	bookName: "John",
	title: "John 3",
	depth: "seeking",
	suggestedDepth: "seeking",
	questions: [
		question("q1", [3], "John 3:3"),
		question("q2", [14], "John 3:14"),
		question("q3", [16], "John 3:16"),
		question("q4", [3, 5], "John 3:3, 5"),
		question("q5", [14], "John 3:14-15"),
	],
	reflection: { verse: 16, reference: "John 3:16", verseText: "For God so loved the world", prompt: "What changes?" },
	model: null,
	cached: true,
};

describe("quiz contract mirror", () => {
	it("matches the web contract's constants", () => {
		expect(mobileContract.QUIZ_LENGTH).toBe(webContract.QUIZ_LENGTH);
		expect(mobileContract.QUIZ_OPTION_COUNT).toBe(webContract.QUIZ_OPTION_COUNT);
		expect([...mobileContract.QUIZ_DEPTHS]).toEqual([...webContract.QUIZ_DEPTHS]);
	});
});

describe("verse label", () => {
	it("reads one verse, a range and a list from the reference", () => {
		expect(verseLabel({ reference: "John 3:3", verses: [3] })).toBe("From verse 3");
		expect(verseLabel({ reference: "John 3:3-5", verses: [3, 4, 5] })).toBe("From verses 3-5");
		expect(verseLabel({ reference: "John 3:3,5", verses: [3, 5] })).toBe("From verses 3, 5");
		expect(verseLabel({ reference: "1 John 4:8", verses: [8] })).toBe("From verse 8");
	});

	it("falls back to the verse list without a verse part", () => {
		expect(verseLabel({ reference: "John 3", verses: [7] })).toBe("From verse 7");
		expect(verseLabel({ reference: "John 3", verses: [7, 9] })).toBe("From verses 7, 9");
	});
});

describe("copy", () => {
	it("renders the offer, progress and option strings", () => {
		expect(offerTitle("John", 3)).toBe("Quiz me on John 3");
		expect(progressLabel(1, 5)).toBe("2 of 5");
		expect(progressAccessibilityLabel(1, 5)).toBe("Question 2 of 5");
		expect(optionAccessibilityLabel(0, "He must be born again")).toBe("Option A: He must be born again");
		expect(askAboutPrompt("John 3:3", "Who?")).toBe("Help me understand John 3:3: Who?");
	});

	it("notes the King James text only when another text is on screen", () => {
		expect(showsKjvNotice("KJV")).toBe(false);
		expect(showsKjvNotice("NKJV")).toBe(true);
		expect(showsKjvNotice("BSB")).toBe(true);
	});

	it("words the results by miss count", () => {
		expect(resultsHeadline(4, 5)).toBe("You remembered 4 of 5");
		expect(resultsSubline(0)).toBe("Every answer, straight from the Word.");
		expect(resultsSubline(1)).toBe("Here is the one worth another look.");
		expect(resultsSubline(2)).toBe("Here are the ones worth another look.");
	});

	it("never writes an em or en dash", () => {
		const strings = [resultsSubline(0), resultsSubline(1), resultsSubline(3), UNAVAILABLE_MESSAGE, OFFLINE_MESSAGE];
		for (const value of strings) expect(value).not.toMatch(/[--]/);
	});
});

describe("scoring and attempt", () => {
	it("counts right answers and records the primary verse of each miss once", () => {
		const answers = [1, 0, 1, 2, null];
		expect(correctCount(quiz, answers)).toBe(2);
		expect(missedQuestions(quiz, answers).map(({ question: q }) => q.id)).toEqual(["q2", "q4", "q5"]);
		expect(buildAttempt(quiz, answers)).toEqual({
			book: 43,
			chapter: 3,
			depth: "seeking",
			total: 5,
			correct: 2,
			missedVerses: [14, 3],
		});
	});

	it("reports a perfect run with no missed verses", () => {
		expect(buildAttempt(quiz, [1, 1, 1, 1, 1])).toMatchObject({ correct: 5, missedVerses: [] });
	});
});

describe("next chapter", () => {
	it("moves within a book, across books and stops after Revelation 22", () => {
		expect(nextChapterAfter(43, 3)).toEqual({ book: 43, chapter: 4, label: "John 4" });
		expect(nextChapterAfter(1, 50)).toEqual({ book: 2, chapter: 1, label: "Exodus 1" });
		expect(nextChapterAfter(66, 22)).toBeNull();
		expect(continueLabel({ book: 43, chapter: 4, label: "John 4" })).toBe("Continue to John 4");
	});
});

describe("dismissed chapters", () => {
	it("moves repeats to the end and keeps only the newest past the cap", () => {
		expect(addDismissed(["1:1", "2:2"], "1:1")).toEqual(["2:2", "1:1"]);
		expect(addDismissed(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
	});
});

describe("error message", () => {
	it("shows what the server said for 400, 403 and 429 and a retry line otherwise", () => {
		expect(quizErrorMessage({ status: 403, message: "AI features are off." })).toBe("AI features are off.");
		expect(quizErrorMessage({ status: 429, message: "Slow down." })).toBe("Slow down.");
		expect(quizErrorMessage({ status: 502, message: "unavailable" })).toBe(UNAVAILABLE_MESSAGE);
		expect(quizErrorMessage({ isNetworkError: true, message: "x" })).toBe(OFFLINE_MESSAGE);
		expect(quizErrorMessage({ isTimeout: true, message: "x" })).toBe(UNAVAILABLE_MESSAGE);
		expect(quizErrorMessage(null)).toBe(UNAVAILABLE_MESSAGE);
	});
});

describe("reflection note", () => {
	it("quotes the verse, italicizes the prompt and escapes the reader's words", () => {
		const note = reflectionNote("John 3", quiz.reflection!, "He loves <me>\n\nand you");
		expect(note.title).toBe("John 3 reflection");
		expect(note.htmlContent).toBe(
			"<blockquote><p><strong>John 3:16</strong></p><p>For God so loved the world</p></blockquote>" +
				"<p><em>What changes?</em></p><p>He loves &lt;me&gt;</p><p>and you</p>",
		);
		expect(note.plainText).toContain("He loves <me>");
		expect(note.wordCount).toBeGreaterThan(5);
	});
});
