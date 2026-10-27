/**
 * SureWord Beta's Socratic Tutor (LC-17650, docs/beta/tutor.md): the pure
 * rules for a close reading, from the passage it accepts to the stage each
 * question belongs to, when the level adapts, and the note it saves.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	NO_AGAINST_VERSES,
	TUTOR_ADAPT_COOLDOWN,
	TUTOR_ANSWER_MAX,
	TUTOR_HINT_STEPS,
	TUTOR_PASSAGE_MAX_VERSES,
	TUTOR_STAGE_EXTRA,
	TUTOR_STAGE_TARGETS,
	adaptLevel,
	checkActionInput,
	checkPassageRange,
	effectiveAction,
	escapeMarkdownText,
	formatPassageReference,
	hintsOnOpenQuestion,
	hintsPerQuestion,
	nextHintStep,
	nextStageOptions,
	newSessionData,
	openQuestion,
	parseSessionData,
	passageRefKeys,
	plannedStage,
	sessionBody,
	sessionNoteMarkdown,
	sessionView,
	settleNextStage,
	stageProgress,
	summarizeSession,
	transcriptForModel,
} from "../src/lib/beta/tutor/tutor-rules.ts";

const ROMANS = { book: 45, chapter: 5, start: 1, end: 11, reference: "Romans 5:1-11" };
let seq = 0;
const at = "2026-10-26T20:00:00.000Z";
const q = (stage, text = `${stage} question?`, focus = [1]) => ({ id: `t${++seq}`, at, role: "tutor", kind: "question", stage, text, lead: null, focus });
const answer = (text = "an answer") => ({ id: `t${++seq}`, at, role: "you", kind: "answer", text });
const fb = (verdict) => ({ id: `t${++seq}`, at, role: "tutor", kind: "feedback", verdict, text: `${verdict} feedback`, citations: [] });
const hint = (step) => [
	{ id: `t${++seq}`, at, role: "you", kind: "hint", text: "" },
	{ id: `t${++seq}`, at, role: "tutor", kind: "hint", step, text: `hint ${step}`, citations: [] },
];
const cite = (reference, text, why = "shows it", source = "passage") => ({ reference, keys: ["45.5.8"], text, why, source });

test("a passage is a forward range inside one chapter, at most thirty verses", () => {
	assert.deepEqual(checkPassageRange(1, 11, 21), { ok: true, value: { start: 1, end: 11 } });
	assert.deepEqual(checkPassageRange(1, null, 21), { ok: true, value: { start: 1, end: 21 } }, "a whole chapter");
	assert.deepEqual(checkPassageRange(16, 16, 36), { ok: true, value: { start: 16, end: 16 } }, "one verse");
	assert.equal(checkPassageRange(1, 22, 21).ok, false, "past the chapter's end");
	assert.equal(checkPassageRange(11, 1, 21).ok, false, "backwards");
	assert.equal(checkPassageRange(0, 3, 21).ok, false);
	assert.equal(checkPassageRange(1, null, 176).ok, false, "Psalm 119 whole is too long to read closely");
	assert.equal(checkPassageRange(1, TUTOR_PASSAGE_MAX_VERSES, 40).ok, true);
	assert.equal(checkPassageRange(1, TUTOR_PASSAGE_MAX_VERSES + 1, 40).ok, false);
	assert.equal(checkPassageRange(1, 3, 0).ok, false, "a chapter that does not exist");
});

test("references and store keys are canonical", () => {
	assert.equal(formatPassageReference("Romans", 5, 1, 11), "Romans 5:1-11");
	assert.equal(formatPassageReference("John", 3, 16, 16), "John 3:16");
	assert.equal(formatPassageReference("Psalms", 23, 1, 6), "Psalm 23:1-6", "one psalm is a Psalm");
	assert.deepEqual(passageRefKeys({ book: 59, chapter: 2, start: 24, end: 26 }), ["59.2.24", "59.2.25", "59.2.26"]);
});

test("the open question is the last asked, and hints count only on it", () => {
	const turns = [q("observation"), answer(), fb("affirm"), q("observation", "Second?"), ...hint(1), ...hint(2)];
	assert.equal(openQuestion(turns).text, "Second?");
	assert.equal(hintsOnOpenQuestion(turns), 2);
	assert.equal(nextHintStep(turns), 3);
	assert.equal(nextHintStep([...turns, ...hint(3)]), null, `only ${TUTOR_HINT_STEPS} hints a question`);
	assert.equal(openQuestion([]), null);
	assert.deepEqual(hintsPerQuestion([q("observation"), ...hint(1), q("observation"), q("interpretation"), ...hint(1), ...hint(2)]), [1, 0, 2]);
});

test("a stage counts only answers the text supports, then opens the next", () => {
	const level = "growing";
	const target = TUTOR_STAGE_TARGETS[level].observation;
	assert.equal(target, 2);
	let turns = [q("observation"), answer(), fb("affirm")];
	assert.equal(plannedStage(turns, level), "observation", "one of two observation questions done");
	turns = [...turns, q("observation"), answer(), fb("correct")];
	assert.deepEqual(stageProgress(turns).observation, { asked: 2, done: 1 });
	assert.equal(plannedStage(turns, level), "observation", "a corrected answer holds the stage");
	turns = [...turns, q("observation"), answer(), fb("partly")];
	assert.equal(plannedStage(turns, level), "interpretation", "partly right still credits the question");
	turns = [...turns, q("interpretation"), answer(), fb("affirm"), q("interpretation"), answer(), fb("affirm"), q("application"), answer(), fb("affirm")];
	assert.equal(plannedStage(turns, level), "conclusion");
	assert.equal(stageProgress([...turns, q("conclusion"), { id: "c", at, role: "you", kind: "conclusion", text: "x" }, { id: "k", at, role: "tutor", kind: "check", verdict: "supported", text: "", supports: [], corrects: [], context: [], takeaways: [] }]).conclusion.done, 1);
});

test("a stage that keeps being missed moves on after its follow-ups run out", () => {
	const level = "beginner";
	const limit = TUTOR_STAGE_TARGETS[level].application + TUTOR_STAGE_EXTRA;
	let turns = [];
	for (const stage of ["observation", "observation", "observation", "interpretation", "interpretation"]) turns.push(q(stage), answer(), fb("affirm"));
	for (let i = 0; i < limit; i++) turns.push(q("application"), answer(), fb("correct"));
	assert.equal(plannedStage(turns, level), "conclusion", "never stuck forever on one stage");
	assert.equal(plannedStage(turns.slice(0, -3), level), "application");
});

test("the next question's stage follows the verdict, never the model's say-so", () => {
	const turns = [q("observation"), answer(), fb("affirm"), q("observation")];
	const options = nextStageOptions(turns, "growing");
	assert.deepEqual(options, { ifCredited: "interpretation", ifNot: "observation" });
	assert.equal(settleNextStage("affirm", options), "interpretation");
	assert.equal(settleNextStage("partly", options), "interpretation");
	assert.equal(settleNextStage("correct", options), "observation", "a wrong answer looks again at the same stage");
	assert.equal(settleNextStage("unclear", options), "observation");
	// At the limit of follow-ups, even a miss moves on.
	const stuck = [];
	for (let i = 0; i < TUTOR_STAGE_TARGETS.growing.observation + TUTOR_STAGE_EXTRA; i++) stuck.push(q("observation"), answer(), fb("correct"));
	stuck.push(q("observation"));
	assert.equal(nextStageOptions(stuck.slice(0, -1), "growing").ifNot, "interpretation");
});

test("a harder level never sends the founder back a stage they already moved past", () => {
	// Reached application at Growing (2 interpretation answers), then went Deep (which wants 3).
	const turns = [];
	for (const stage of ["observation", "observation", "interpretation", "interpretation"]) turns.push(q(stage), answer(), fb("affirm"));
	turns.push(q("application"));
	assert.equal(plannedStage(turns, "deep"), "interpretation", "from the start, Deep would still want interpretation");
	assert.deepEqual(nextStageOptions(turns, "deep"), { ifCredited: "conclusion", ifNot: "application" });
	assert.equal(plannedStage([...turns, answer(), fb("affirm"), q("conclusion")], "deep", "conclusion"), "conclusion");
});

test("the level goes deeper only on a clean run, easier only on real struggle, never within the cooldown", () => {
	const base = { level: "growing", answersSinceLevelChange: TUTOR_ADAPT_COOLDOWN, hintsUsed: 0, hintsBefore: 0 };
	assert.equal(adaptLevel({ ...base, verdicts: ["affirm", "affirm"], signal: "deeper" }), "deep");
	assert.equal(adaptLevel({ ...base, verdicts: ["affirm", "affirm"], signal: "same" }), "growing", "the model must also see it");
	assert.equal(adaptLevel({ ...base, verdicts: ["partly", "affirm"], signal: "deeper" }), "growing", "two clean answers in a row");
	assert.equal(adaptLevel({ ...base, verdicts: ["affirm", "affirm"], hintsUsed: 1, signal: "deeper" }), "growing", "not after a hint");
	assert.equal(adaptLevel({ ...base, answersSinceLevelChange: 1, verdicts: ["affirm", "affirm"], signal: "deeper" }), "growing", "cooldown");
	assert.equal(adaptLevel({ ...base, level: "deep", verdicts: ["affirm", "affirm"], signal: "deeper" }), "deep", "no deeper than deep");
	assert.equal(adaptLevel({ ...base, verdicts: ["correct", "unclear"], signal: "easier" }), "beginner");
	assert.equal(adaptLevel({ ...base, verdicts: ["affirm", "correct"], signal: "easier" }), "growing", "one miss is not struggle");
	assert.equal(adaptLevel({ ...base, verdicts: ["affirm", "partly"], hintsUsed: 2, signal: "easier" }), "beginner", "leaning on hints");
	assert.equal(adaptLevel({ ...base, verdicts: ["correct", "correct"], signal: "same" }), "growing");
	assert.equal(adaptLevel({ ...base, level: "beginner", verdicts: ["correct", "correct"], signal: "easier" }), "beginner");
	assert.equal(adaptLevel({ ...base, verdicts: ["affirm"], signal: "deeper" }), "growing", "needs two answers");
});

test("actions are checked: answers need words, a stale count is refused upstream", () => {
	assert.deepEqual(checkActionInput({ action: "answer", text: "  Peace with God  ", expect: 3 }), { ok: true, value: { action: "answer", text: "Peace with God", expect: 3 } });
	assert.deepEqual(checkActionInput({ action: "hint", expect: 0 }), { ok: true, value: { action: "hint", text: "", expect: 0 } });
	assert.equal(checkActionInput({ action: "answer", text: "   ", expect: 1 }).error, "empty_answer");
	assert.equal(checkActionInput({ action: "conclude", expect: 1 }).error, "empty_answer");
	assert.equal(checkActionInput({ action: "answer", text: "x".repeat(TUTOR_ANSWER_MAX + 1), expect: 1 }).error, "answer_too_long");
	assert.equal(checkActionInput({ action: "lecture", expect: 1 }).error, "invalid_action");
	assert.equal(checkActionInput({ action: "answer", text: "x", expect: -1 }).error, "invalid_expect");
	assert.equal(checkActionInput({ action: "answer", text: "x", expect: "3" }).error, "invalid_expect");
	assert.equal(checkActionInput(null).error, "invalid_body");
	assert.equal(checkActionInput([]).error, "invalid_body");
});

test("an answer to the conclusion question, or after a check, is a conclusion", () => {
	assert.equal(effectiveAction("answer", [q("observation")]), "answer");
	assert.equal(effectiveAction("answer", [q("conclusion")]), "conclude");
	assert.equal(effectiveAction("answer", []), "conclude");
	const checked = [q("application"), { id: "c", at, role: "you", kind: "conclusion", text: "x" }, { id: "k", at, role: "tutor", kind: "check", verdict: "partly", text: "", supports: [], corrects: [], context: [], takeaways: [] }];
	assert.equal(effectiveAction("answer", checked), "conclude");
	assert.equal(effectiveAction("hint", [q("observation")]), "hint");
});

test("stored data is read defensively", () => {
	const data = newSessionData(ROMANS, "deep");
	data.turns.push(q("observation"));
	assert.deepEqual(parseSessionData(JSON.parse(JSON.stringify(data))), data);
	assert.equal(parseSessionData({ ...data, v: 2 }), null, "a future version is not misread");
	assert.equal(parseSessionData({ ...data, level: "expert" }), null);
	assert.equal(parseSessionData({ ...data, passage: { ...ROMANS, end: 0 } }), null);
	assert.equal(parseSessionData(null), null);
	const junk = parseSessionData({ ...data, turns: [null, 4, { kind: "question" }, ...data.turns], noteTurns: -3, noteId: "" });
	assert.equal(junk.turns.length, 1);
	assert.equal(junk.noteTurns, 0);
	assert.equal(junk.noteId, null);
});

test("the model reads the session in order, the learner's words marked as theirs", () => {
	const turns = [q("observation", "What does verse 1 say we have?"), answer("Peace with God"), fb("affirm"), ...hint(1)];
	const text = transcriptForModel(turns);
	assert.match(text, /TUTOR \(observation question, verses 1\): What does verse 1 say we have\?/);
	assert.match(text, /LEARNER: Peace with God/);
	assert.match(text, /TUTOR \(verdict: affirm\)/);
	assert.match(text, /LEARNER: \(asked for a hint\)/);
	assert.match(transcriptForModel(turns, 2), /^\(3 earlier turns not shown\)/);
});

test("the Vault indexes the founder's own words and what was learned", () => {
	const body = sessionBody({ passage: ROMANS, turns: [q("observation", "What do we have?"), answer("Peace with God"), fb("affirm")] });
	assert.match(body, /Romans 5:1-11/);
	assert.match(body, /My answer: Peace with God/);
	assert.match(body, /Question: What do we have\?/);
});

test("markdown from people and models cannot inject HTML or stray markup", () => {
	assert.equal(escapeMarkdownText('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror="alert(1)"&gt;');
	assert.equal(escapeMarkdownText("**bold** _x_ # [link](y)"), "\\*\\*bold\\*\\* \\_x\\_ \\# \\[link\\](y)");
	assert.equal(escapeMarkdownText("line one\n\n line two"), "line one line two");
});

test("the note holds the passage, what was learned, the checked conclusion and the questions; a later save only adds", () => {
	const verses = [{ verse: 1, text: "Therefore being justified by faith, we have peace with God through our Lord Jesus Christ:" }];
	const turns = [
		q("observation", "What do we have?"),
		answer("Peace <b>with</b> God"),
		fb("affirm"),
		q("conclusion", "What does it teach?"),
		{ id: "c1", at, role: "you", kind: "conclusion", text: "We are justified by faith and have peace." },
		{ id: "k1", at, role: "tutor", kind: "check", verdict: "supported", text: "Yes, verse 1 says it.", supports: [cite("Romans 5:1", verses[0].text)], corrects: [], context: [cite("Romans 4:5", "But to him that worketh not...", "faith counted for righteousness", "preceding")], takeaways: ["Peace with God comes by faith (Romans 5:1)"] },
	];
	const first = sessionNoteMarkdown({ data: { passage: ROMANS, level: "growing", turns }, verses, takeaways: ["Peace with God comes by faith (Romans 5:1)"], dateLabel: "October 26, 2026", fromTurn: 0 });
	assert.match(first, /## Romans 5:1-11 \(KJV\)/);
	assert.match(first, /> \*\*1\*\* Therefore being justified by faith/);
	assert.match(first, /## What I learned\n\n- Peace with God comes by faith \(Romans 5:1\)/);
	assert.match(first, /## My conclusion, checked against the text\n\n> We are justified by faith and have peace\./);
	assert.match(first, /\*\*Supported by the text\.\*\* Yes, verse 1 says it\./);
	assert.match(first, /The wider context/);
	assert.match(first, /\*\*My answer:\*\* Peace &lt;b&gt;with&lt;\/b&gt; God/);
	assert.match(first, /Growing, October 26, 2026/);
	assert.equal(first.includes("<b>"), false);

	const later = sessionNoteMarkdown({ data: { passage: ROMANS, level: "growing", turns: [...turns, q("observation", "Next?"), answer("More")] }, verses, takeaways: [], dateLabel: "October 27, 2026", fromTurn: turns.length });
	assert.match(later, /^## Continued, October 27, 2026/);
	assert.equal(later.includes("(KJV)"), false, "the passage is not repeated");
	assert.match(later, /\*\*My answer:\*\* More/);
	assert.equal(later.includes("Peace &lt;b&gt;"), false, "turns already saved are not saved twice");
});

test("the tutor's reading is labelled interpretation, and an empty list of verses against it says so", () => {
	const reading = (againstVerses) => ({ id: `t${++seq}`, at, role: "tutor", kind: "reading", text: "Paul grounds peace in justification.", forVerses: [cite("Romans 5:1", "Therefore being justified by faith")], againstVerses, consider: null });
	const verses = [{ verse: 1, text: "Therefore being justified by faith" }];
	const note = (turn) => sessionNoteMarkdown({ data: { passage: ROMANS, level: "growing", turns: [q("observation"), turn] }, verses, takeaways: [], dateLabel: "October 26, 2026", fromTurn: 0 });
	const none = note(reading([]));
	assert.match(none, /\*\*The tutor's reading \(interpretation, not Scripture\):\*\*/);
	assert.match(none, new RegExp(`\\*\\*Verses to weigh against it:\\*\\* ${NO_AGAINST_VERSES.replace(/\./g, "\\.")}`));
	const some = note(reading([cite("James 2:24", "Ye see then how that by works a man is justified", "works show faith", "cross-reference")]));
	assert.match(some, /\*\*Verses to weigh against it:\*\*\n\n- \*\*James 2:24\*\*/);
	assert.equal(some.includes(NO_AGAINST_VERSES), false);
});

test("summaries and the screen's view say where a session stands", () => {
	const data = newSessionData(ROMANS, "beginner");
	data.turns.push(q("observation"), answer(), fb("affirm"), q("interpretation"), ...hint(1));
	const summary = summarizeSession("s1", "Close reading: Romans 5:1-11", at, data);
	assert.equal(summary.answered, 1);
	assert.equal(summary.stage, "interpretation");
	assert.equal(summary.finished, false);
	const view = sessionView({ id: "s1", title: "t", createdAt: at, updatedAt: at }, { ...data, noteId: "n1", noteTurns: data.turns.length }, []);
	assert.equal(view.hintsLeft, TUTOR_HINT_STEPS - 1);
	assert.equal(view.noteCurrent, true);
	assert.equal(view.stage, "interpretation");
	assert.equal(sessionView({ id: "s1", title: "t", createdAt: at, updatedAt: at }, { ...data, noteId: "n1", noteTurns: 2 }, []).noteCurrent, false);
});
