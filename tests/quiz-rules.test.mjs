/**
 * "Quiz me" safety rules (src/lib/quiz-rules.ts): a generated question only
 * reaches a reader when the verse it cites says the right answer and does not
 * say a wrong one. Driven against the real John 3 text.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	answerIsGrounded,
	arrangeOptions,
	defaultDepthFromProfile,
	distractorContradictsVerse,
	formatReference,
	parseAttempt,
	selectQuestions,
	validateDraft,
} from "../src/lib/quiz-rules.ts";

const JOHN_3 = {
	3: "Jesus answered and said unto him, Verily, verily, I say unto thee, Except a man be born again, he cannot see the kingdom of God.",
	5: "Jesus answered, Verily, verily, I say unto thee, Except a man be born of water and of the Spirit, he cannot enter into the kingdom of God.",
	14: "And as Moses lifted up the serpent in the wilderness, even so must the Son of man be lifted up:",
	16: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
	30: "He must increase, but I must decrease.",
};
const verses = Array.from({ length: 36 }, (_, index) => JOHN_3[index + 1] ?? `Verse ${index + 1} of the chapter.`);
const ctx = { book: 43, chapter: 3, bookName: "John", verses };

const good = {
	prompt: "What did Jesus tell Nicodemus must happen before a man can see the kingdom of God?",
	correct: "He must be born again",
	wrong: ["He must keep the whole law", "He must be baptized by John", "He must sell all that he has"],
	verses: [3],
	note: null,
};

test("a question the verse answers is kept, with the verse text from the Bible", () => {
	const result = validateDraft(good, ctx, "q1");
	assert.ok("question" in result, JSON.stringify(result));
	const { question } = result;
	assert.equal(question.reference, "John 3:3");
	assert.equal(question.verseText, JOHN_3[3]);
	assert.equal(question.options.length, 4);
	assert.equal(question.options[question.answerIndex], "He must be born again");
});

test("an answer the verse does not say is dropped", () => {
	const result = validateDraft({ ...good, correct: "He must repent of his sins" }, ctx, "q1");
	assert.deepEqual(result, { dropped: "ungrounded_answer" });
});

test("a wrong answer that is really the verse's own words is dropped", () => {
	const result = validateDraft(
		{ ...good, wrong: ["Except a man be born again", "He must be baptized by John", "He must sell all"] },
		ctx,
		"q1"
	);
	assert.deepEqual(result, { dropped: "distractor_in_verse" });
});

test("a right answer much longer than every wrong one is dropped", () => {
	const result = validateDraft(
		{
			...good,
			correct: "Except a man be born again, he cannot see the kingdom of God",
			wrong: ["Keep the law", "Be baptized", "Sell all"],
		},
		ctx,
		"q1"
	);
	assert.deepEqual(result, { dropped: "answer_stands_out" });
});

test("verse numbers outside the chapter, or none, are dropped", () => {
	assert.deepEqual(validateDraft({ ...good, verses: [37] }, ctx, "q1"), { dropped: "bad_verses" });
	assert.deepEqual(validateDraft({ ...good, verses: [] }, ctx, "q1"), { dropped: "bad_verses" });
	assert.deepEqual(validateDraft({ ...good, verses: [0] }, ctx, "q1"), { dropped: "bad_verses" });
});

test("duplicate options and the wrong number of distractors are dropped", () => {
	assert.deepEqual(
		validateDraft({ ...good, wrong: ["He must be born again!", "x y z", "a b c"] }, ctx, "q1"),
		{ dropped: "duplicate_options" }
	);
	assert.deepEqual(validateDraft({ ...good, wrong: ["One", "Two"] }, ctx, "q1"), { dropped: "wrong_count" });
});

test("KJV word forms meet modern ones", () => {
	assert.ok(answerIsGrounded("whoever believes in him", JOHN_3[16]));
	assert.ok(answerIsGrounded("The serpent, by Moses", JOHN_3[14]));
	assert.ok(!answerIsGrounded("He must", JOHN_3[30]), "stopwords alone prove nothing");
});

test("a short distractor sharing one verse word is fine", () => {
	assert.equal(distractorContradictsVerse("Moses", "The serpent", JOHN_3[14]), false);
	assert.equal(distractorContradictsVerse("Aaron's rod", "The serpent", JOHN_3[14]), false);
});

test("option order is seeded: stable for one question, varied across questions", () => {
	const a = arrangeOptions("right", ["w1", "w2", "w3"], "43:3:first");
	assert.deepEqual(arrangeOptions("right", ["w1", "w2", "w3"], "43:3:first"), a);
	const positions = new Set(
		Array.from({ length: 20 }, (_, index) => arrangeOptions("right", ["w1", "w2", "w3"], `43:3:${index}`).answerIndex)
	);
	assert.ok(positions.size >= 3, `answers sat in only ${positions.size} positions`);
});

test("references read the way the reader writes them", () => {
	assert.equal(formatReference("John", 3, [3]), "John 3:3");
	assert.equal(formatReference("John", 3, [5, 3, 4]), "John 3:3-5");
	assert.equal(formatReference("John", 3, [3, 5]), "John 3:3, 5");
});

test("questions are spread across the chapter and put in chapter order", () => {
	const make = (verse, id) => ({ ...good, id, verses: [verse], reference: `John 3:${verse}`, verseText: "", options: [], answerIndex: 0, prompt: id, note: null });
	const picked = selectQuestions([make(16, "a"), make(16, "b"), make(3, "c"), make(14, "d"), make(30, "e"), make(5, "f")], 5);
	assert.deepEqual(picked.map((q) => q.verses[0]), [3, 5, 14, 16, 30]);
	assert.deepEqual(picked.map((q) => q.id), ["q1", "q2", "q3", "q4", "q5"]);
});

test("the default depth comes from the reader's own words", () => {
	assert.equal(defaultDepthFromProfile([]), "growing");
	assert.equal(defaultDepthFromProfile(["Saved believer for 6 years, deep in Bible study."]), "growing");
	assert.equal(defaultDepthFromProfile(["She is still seeking and not yet saved."]), "seeking");
	assert.equal(defaultDepthFromProfile(["I'm a skeptic exploring the faith"]), "seeking");
});

test("an attempt is coordinates and counts, validated", () => {
	assert.deepEqual(parseAttempt({ book: 43, chapter: 3, depth: "growing", total: 5, correct: 4, missedVerses: [14, 14, 0, "x"] }), {
		book: 43,
		chapter: 3,
		depth: "growing",
		total: 5,
		correct: 4,
		missedVerses: [14],
	});
	assert.deepEqual(parseAttempt({ book: 43, chapter: 3, depth: "growing", total: 5, correct: 6 }), { error: "invalid_score" });
	assert.deepEqual(parseAttempt({ book: 67, chapter: 3, depth: "growing", total: 5, correct: 1 }), { error: "invalid_reference" });
	assert.deepEqual(parseAttempt({ book: 43, chapter: 3, depth: "deep", total: 5, correct: 1 }), { error: "invalid_depth" });
});
