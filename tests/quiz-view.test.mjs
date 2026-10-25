import { test } from "node:test";
import assert from "node:assert/strict";
import {
	addDismissed,
	askPrompt,
	attemptBody,
	countCorrect,
	dismissalKey,
	keyToOption,
	loadingLine,
	nextChapterAfter,
	optionLetter,
	parseChapterQuiz,
	parseDismissed,
	quizErrorMessage,
	reflectionNote,
	resultsHeadline,
	resultsSubline,
	verseLabel,
} from "../src/components/quiz/quizView.ts";

function question(id, verses, answerIndex = 1) {
	return {
		id,
		prompt: `Question ${id}?`,
		options: ["A one", "B two", "C three", "D four"],
		answerIndex,
		verses,
		reference: `John 3:${verses.join(",")}`,
		verseText: "Verily, verily.",
		note: null,
	};
}

const quiz = {
	book: 43,
	chapter: 3,
	bookName: "John",
	title: "John 3",
	depth: "seeking",
	suggestedDepth: "seeking",
	questions: [question("q1", [3]), question("q2", [5]), question("q3", [14, 15]), question("q4", [16]), question("q5", [14])],
	reflection: { verse: 16, reference: "John 3:16", verseText: "For God so loved the world", prompt: "What does that change today?" },
	model: "m",
	cached: false,
};

test("verseLabel reads the verse part of the reference", () => {
	assert.equal(verseLabel("John 3:3"), "From verse 3");
	assert.equal(verseLabel("John 3:3-5"), "From verses 3-5");
	assert.equal(verseLabel("John 3:3 - 5"), "From verses 3-5");
	assert.equal(verseLabel("John 3:3,5"), "From verses 3, 5");
	assert.equal(verseLabel("1 John 2:1, 4"), "From verses 1, 4");
	assert.equal(verseLabel("John 3", [7]), "From verse 7");
	assert.equal(verseLabel("John 3", [7, 9]), "From verses 7, 9");
	assert.equal(verseLabel("John 3"), "");
});

test("keyToOption maps letters and digits within the option count", () => {
	assert.equal(keyToOption("a", 4), 0);
	assert.equal(keyToOption("D", 4), 3);
	assert.equal(keyToOption("1", 4), 0);
	assert.equal(keyToOption("4", 4), 3);
	assert.equal(keyToOption("5", 4), null);
	assert.equal(keyToOption("e", 4), null);
	assert.equal(keyToOption("Enter", 4), null);
	assert.equal(keyToOption(" ", 4), null);
	assert.equal(optionLetter(2), "C");
});

test("results copy follows the count of misses", () => {
	assert.equal(resultsHeadline(4, 5), "You remembered 4 of 5");
	assert.equal(resultsSubline(0), "Every answer, straight from the Word.");
	assert.equal(resultsSubline(1), "Here is the one worth another look.");
	assert.equal(resultsSubline(3), "Here are the ones worth another look.");
	assert.equal(loadingLine("John 3"), "Writing your questions from John 3...");
	assert.equal(askPrompt({ reference: "John 3:3", prompt: "Who?" }), "Help me understand John 3:3: Who?");
});

test("attemptBody counts and lists each missed primary verse once", () => {
	// q3 and q5 both miss with primary verse 14; q1 unanswered counts as a miss.
	const answers = [null, 1, 0, 1, 2];
	assert.equal(countCorrect(quiz.questions, answers), 2);
	assert.deepEqual(attemptBody(quiz, answers), {
		book: 43,
		chapter: 3,
		depth: "seeking",
		total: 5,
		correct: 2,
		missedVerses: [3, 14],
	});
	assert.deepEqual(attemptBody(quiz, [1, 1, 1, 1, 1]).missedVerses, []);
});

test("nextChapterAfter crosses books and stops after Revelation 22", () => {
	assert.deepEqual(nextChapterAfter(43, 3, 21), { book: 43, chapter: 4 });
	assert.deepEqual(nextChapterAfter(43, 21, 21), { book: 44, chapter: 1 });
	assert.equal(nextChapterAfter(66, 22, 22), null);
});

test("dismissals dedupe, keep the newest last, and cap", () => {
	assert.equal(dismissalKey(43, 3), "43:3");
	assert.deepEqual(parseDismissed(null), []);
	assert.deepEqual(parseDismissed("not json"), []);
	assert.deepEqual(parseDismissed('{"a":1}'), []);
	assert.deepEqual(parseDismissed('["1:1", 2, "1:2"]'), ["1:1", "1:2"]);
	assert.deepEqual(addDismissed(["1:1", "1:2"], "1:1"), ["1:2", "1:1"]);
	const capped = addDismissed(["a", "b", "c"], "d", 3);
	assert.deepEqual(capped, ["b", "c", "d"]);
});

test("parseChapterQuiz keeps valid questions and rejects an empty quiz", () => {
	const parsed = parseChapterQuiz({ ...quiz, questions: [...quiz.questions, { id: "bad" }] });
	assert.equal(parsed?.questions.length, 5);
	assert.equal(parsed?.reflection?.verse, 16);
	assert.equal(parseChapterQuiz({ ...quiz, questions: [{ id: "bad" }] }), null);
	assert.equal(parseChapterQuiz(null), null);
	assert.equal(parseChapterQuiz({ ...quiz, reflection: { verse: "x" } })?.reflection, null);
	const outOfRange = { ...question("q9", [1]), answerIndex: 4 };
	assert.equal(parseChapterQuiz({ ...quiz, questions: [outOfRange] }), null);
});

test("quizErrorMessage shows server text for 400/403/429 and a calm line otherwise", () => {
	assert.equal(quizErrorMessage(502, { error: "x", code: "unavailable" }), "This quiz could not be written right now.");
	assert.equal(quizErrorMessage(429, { error: "Slow down a little.", code: "rate_limited" }), "Slow down a little.");
	assert.equal(quizErrorMessage(403, { error: "Turn on AI help first." }), "Turn on AI help first.");
	assert.equal(quizErrorMessage(500, { error: "stack trace" }), "This quiz could not be written right now.");
	assert.equal(quizErrorMessage(400, null), "This quiz could not be written right now.");
});

test("reflectionNote builds an escaped blockquote, italic prompt, then the reader's words", () => {
	const note = reflectionNote("John 3", quiz.reflection, "He loves <me>.\n\nI will tell Sam.");
	assert.equal(note.title, "John 3 reflection");
	assert.equal(
		note.htmlContent,
		"<blockquote><p><strong>John 3:16</strong></p><p>For God so loved the world</p></blockquote>" +
			"<p><em>What does that change today?</em></p><p>He loves &lt;me&gt;.</p><p>I will tell Sam.</p>"
	);
	assert.ok(note.plainText.startsWith('John 3:16 "For God so loved the world"'));
	assert.ok(note.wordCount > 10);
});
