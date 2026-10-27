/**
 * Scripture Memory (LC-17651, docs/beta/memory.md): the pure rules that turn
 * Learn a verse's cards into passages, exercises and grades, and the source
 * contracts that keep the module on Learn a verse's own schedule.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	MEMORY_PASSAGE_MAX_VERSES,
	answerKey,
	cardStatus,
	choiceBlankIndex,
	choiceDistractors,
	choicePool,
	choiceRound,
	defaultExercise,
	describeNextReview,
	firstLetter,
	foldWord,
	gradeBlanks,
	gradeRecall,
	groupConsecutiveVerses,
	joinRanges,
	letterTargets,
	memoryTokens,
	parseVerseSpan,
	planCandidates,
	planUnits,
	rangeKey,
	rangeReference,
	unitSeed,
	unitStage,
} from "../src/lib/beta/memory/memory-rules.ts";
import { BETA_MODULES } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");
const ephesians = JSON.parse(read("src/data/kjv/49-ephesians.json"));
const EPH_2 = ephesians[1];
const EPH_2_8_9 = `${EPH_2[7]} ${EPH_2[8]}`;

function card(verse, overrides = {}) {
	return {
		id: `c${verse}`,
		revision: 0,
		book: 49,
		chapter: 2,
		verse,
		stage: 0,
		intervalDays: 0,
		dueAt: "2026-10-26T07:00:00.000Z",
		knownAt: null,
		...overrides,
	};
}

test("a reference's verse span is a memory passage only within one chapter and six verses", () => {
	assert.deepEqual(parseVerseSpan("Ephesians 2:8-9"), { start: 8, end: 9 });
	assert.deepEqual(parseVerseSpan("John 3:16"), { start: 16, end: 16 });
	assert.deepEqual(parseVerseSpan("Psalm 23:1–6"), { start: 1, end: 6 });
	assert.equal(parseVerseSpan("Psalm 23:1-7"), null, `longer than ${MEMORY_PASSAGE_MAX_VERSES} verses`);
	assert.equal(parseVerseSpan("John 3:16-4:2"), null, "across chapters");
	assert.equal(parseVerseSpan("John 3:16-14"), null, "reversed");
	assert.equal(parseVerseSpan("John 3"), null, "a chapter is not a card");
	assert.equal(rangeReference("Ephesians", { chapter: 2, start: 8, end: 9 }), "Ephesians 2:8-9");
	assert.equal(rangeKey({ book: 43, chapter: 3, start: 16, end: 16 }), "43.3.16");
	assert.equal(rangeKey({ book: 49, chapter: 2, start: 8, end: 9 }), "49.2.8-9");
});

test("overlapping passages join, and never past six verses", () => {
	const eph = (start, end) => ({ book: 49, chapter: 2, start, end });
	assert.deepEqual(joinRanges(eph(9, 10), [eph(8, 9)]), eph(8, 10));
	assert.deepEqual(joinRanges(eph(8, 9), [eph(1, 3), { ...eph(8, 9), chapter: 3 }]), eph(8, 9), "another chapter never joins");
	assert.equal(joinRanges(eph(6, 9), [eph(8, 12)]), null);
});

test("consecutive highlighted verses become one passage, split at six", () => {
	const verses = [9, 8, 1, 10, 11, 12, 13, 14, 8].map((verse) => ({ book: 49, chapter: 2, verse }));
	const groups = groupConsecutiveVerses(verses).map((group) => [group.range.start, group.range.end]);
	assert.deepEqual(groups, [[1, 1], [8, 13], [14, 14]]);
});

test("a deck splits into units: whole passages, then single verses, every card once", () => {
	const cards = [card(8), card(9), card(10), card(16, { book: 43, chapter: 3 })];
	const units = planUnits(cards, [{ id: "p1", book: 49, chapter: 2, start: 8, end: 9 }]);
	assert.deepEqual(units.map((unit) => [rangeKey(unit.range), unit.passageId, unit.cards.map((c) => c.id)]), [
		["43.3.16", null, ["c16"]],
		["49.2.8-9", "p1", ["c8", "c9"]],
		["49.2.10", null, ["c10"]],
	]);
	// A verse removed in Learn a verse leaves continuous runs only.
	const gap = planUnits([card(8), card(10)], [{ id: "p2", book: 49, chapter: 2, start: 8, end: 10 }]);
	assert.deepEqual(gap.map((unit) => [rangeKey(unit.range), unit.passageId]), [["49.2.8", null], ["49.2.10", null]]);
	const part = planUnits([card(8), card(9)], [{ id: "p3", book: 49, chapter: 2, start: 8, end: 10 }]);
	assert.deepEqual(part.map((unit) => [rangeKey(unit.range), unit.passageId]), [["49.2.8-9", null]]);
});

test("status: due wins, then known (Learn a verse's knownAt), then learning", () => {
	const dueBefore = Date.parse("2026-10-27T07:00:00.000Z");
	assert.equal(cardStatus({ dueAt: "2026-10-26T07:00:00.000Z", knownAt: "2026-10-01T00:00:00.000Z" }, dueBefore), "due");
	assert.equal(cardStatus({ dueAt: "2026-11-20T07:00:00.000Z", knownAt: "2026-10-01T00:00:00.000Z" }, dueBefore), "known");
	assert.equal(cardStatus({ dueAt: "2026-10-29T07:00:00.000Z", knownAt: null }, dueBefore), "learning");
});

test("the exercise climbs with the ladder, and questions take every other turn", () => {
	assert.equal(defaultExercise(0, 1, true), "choice");
	assert.equal(defaultExercise(1, 0, true), "blank");
	assert.equal(defaultExercise(1, 1, true), "question");
	assert.equal(defaultExercise(1, 1, false), "blank");
	assert.equal(defaultExercise(2, 2, true), "letters");
	assert.equal(defaultExercise(2, 3, true), "question");
	assert.equal(defaultExercise(3, 3, true), "typed");
	assert.equal(unitStage([{ stage: 3 }, { stage: 1 }]), 1);
	assert.notEqual(unitSeed([card(8, { revision: 1 })]), unitSeed([card(8, { revision: 2 })]), "a review changes the round");
});

test("tokens keep punctuation beside the word, as Learn a verse's ladder does", () => {
	const tokens = memoryTokens("it is the gift of God:");
	assert.deepEqual(tokens.at(-1), { text: "God:", prefix: "", core: "God", suffix: ":" });
	assert.equal(foldWord("Believeth,"), "believeth");
	assert.equal(firstLetter("well-beloved,"), "w");
	assert.deepEqual(letterTargets(memoryTokens("Jesus wept. —")), [0, 1]);
});

test("multiple choice on Ephesians 2:8-9 blanks a real word and offers chapter words of the same shape", () => {
	const pool = choicePool(EPH_2);
	assert.ok(pool.includes("workmanship") && pool.includes("God"), "names keep their capitals");
	assert.ok(!pool.includes("For") && !pool.includes("Wherefore"), "sentence openers are lowercased");
	for (let seed = 0; seed < 6; seed++) {
		const round = choiceRound(EPH_2_8_9, pool, seed);
		assert.ok(round, `seed ${seed}`);
		const answer = round.tokens[round.blankIndex].core;
		assert.ok(answer.length >= 4, answer);
		assert.equal(foldWord(round.options[round.answerIndex]), foldWord(answer));
		assert.equal(new Set(round.options.map(foldWord)).size, 4, "four distinct options");
		const verseWords = new Set(round.tokens.map((token) => foldWord(token.core)));
		for (const [index, option] of round.options.entries()) {
			if (index !== round.answerIndex) assert.ok(!verseWords.has(foldWord(option)), `${option} is in the verse`);
		}
	}
	const seeds = new Set([0, 1, 2, 3, 4].map((seed) => choiceBlankIndex(memoryTokens(EPH_2_8_9), seed)));
	assert.ok(seeds.size >= 3, "the blank moves as the card is reviewed");
	// The board's own example: "boast" is offered other plain verbs, not names or -eth forms.
	const boast = choiceDistractors("boast", pool, memoryTokens(EPH_2_8_9).map((t) => t.core), 1);
	assert.equal(boast.length, 3);
	assert.ok(boast.every((word) => /^[a-z]+$/.test(word) && !/eth$/.test(word)), boast.join(","));
	const names = choiceDistractors("God", pool, memoryTokens(EPH_2_8_9).map((t) => t.core), 1);
	assert.ok(names.every((word) => /^[A-Z]/.test(word)), names.join(","));
	const verbs = choiceDistractors("believeth", choicePool(JSON.parse(read("src/data/kjv/43-john.json"))[2]), [], 4);
	assert.ok(verbs.every((word) => word.endsWith("eth")), verbs.join(","));
});

test("a verse too small for its chapter still gets four options from the fallback words", () => {
	const round = choiceRound("Jesus wept.", [], 0);
	assert.ok(round);
	assert.equal(round.options.length, 4);
});

test("grading: right sends good, a slip in a long recall is the founder's call, more is again", () => {
	assert.equal(gradeRecall(0, 25), "right");
	assert.equal(gradeRecall(1, 6), "close", "one slip");
	assert.equal(gradeRecall(2, 25), "close");
	assert.equal(gradeRecall(3, 25), "wrong");
	assert.equal(gradeRecall(2, 6), "wrong");
	assert.equal(gradeRecall(0, 0), "wrong", "nothing to recall is never right");
	assert.deepEqual(gradeBlanks(["saved", "yourselves:"], ["Saved", "yourself"]), { correct: [true, false], mistakes: 1 });
	assert.deepEqual(gradeBlanks(["works,"], [""]).mistakes, 1);
});

test("two comprehension answers that differ only by an article are one answer", () => {
	// Hebrews 11:1 came back with "The substance" and "Substance" as two questions (LC-17651 proof).
	assert.equal(answerKey("The substance"), answerKey("Substance"));
	assert.equal(answerKey("An evidence,"), "evidence");
	assert.notEqual(answerKey("Through Christ"), answerKey("Christ"), "a different answer stays a different question");
});

test("the next review is read off the card Learn a verse returned", () => {
	assert.deepEqual(describeNextReview({ stage: 2, dueDay: "2026-10-26" }, "2026-10-26"), { later: false, days: 0, text: "Back later in this session, step 3 of 4" });
	assert.deepEqual(describeNextReview({ stage: 3, dueDay: "2026-10-27" }, "2026-10-26"), { later: true, days: 1, text: "Next review tomorrow" });
	assert.equal(describeNextReview({ stage: 3, dueDay: "2026-10-30" }, "2026-10-26").text, "Next review in 4 days");
});

test("cards from study: one per passage, strongest source and newest, nothing already learned", () => {
	const range = (start, end, chapter = 2) => ({ book: 49, chapter, start, end });
	const plans = planCandidates(
		[
			{ source: "chat", range: range(8, 9), at: 50 },
			{ source: "highlight", range: range(8, 9), at: 10 },
			{ source: "note", range: range(1, 3), at: 30, title: "Grace" },
			{ source: "note", range: range(1, 3), at: 40, title: "Newer" },
			{ source: "note", range: range(10, 10), at: 20 },
			{ source: "study", range: range(4, 4), at: 5 },
			{ source: "module", range: range(1, 12), at: 99 },
		],
		new Set(["49.2.4"]),
	);
	assert.deepEqual(plans.map((plan) => [plan.source, plan.key, plan.title ?? null]), [
		["highlight", "49.2.8-9", null],
		["note", "49.2.1-3", "Newer"],
		["note", "49.2.10", null],
	]);
	assert.equal(plans[0].newVerses, 2);
	const capped = planCandidates(
		Array.from({ length: 12 }, (_, index) => ({ source: "highlight", range: range(index + 1, index + 1, 3), at: index })),
		new Set(),
		8,
	);
	assert.equal(capped.length, 8);
	assert.equal(capped[0].range.start, 12, "newest first");
});

test("another module's verses are offered as whole runs: a short passage stays, a reading is left out, never cut", () => {
	// A Learning Paths enrollment's refs: Ephesians 2:1-10 read in one lesson, 2 Timothy 3:14-17 in another.
	const verses = [
		...Array.from({ length: 10 }, (_, index) => ({ book: 49, chapter: 2, verse: index + 1 })),
		...[14, 15, 16, 17].map((verse) => ({ book: 55, chapter: 3, verse })),
	];
	const runs = groupConsecutiveVerses(verses, Number.POSITIVE_INFINITY);
	assert.deepEqual(runs.map((run) => rangeKey(run.range)), ["49.2.1-10", "55.3.14-17"]);
	const plans = planCandidates(runs.map((run) => ({ source: "module", range: run.range, at: 1 })), new Set());
	assert.deepEqual(plans.map((plan) => plan.key), ["55.3.14-17"]);
	assert.match(read("src/lib/beta/memory/memory.ts"), /groupConsecutiveVerses\(verses, Number\.POSITIVE_INFINITY\)/, "module refs are grouped whole, not cut at six");
});

test("the module reviews through Learn a verse's own route and owns no scheduler", () => {
	const client = read("src/components/beta/memory/memoryClient.ts");
	assert.match(client, /\/api\/learn\/\$\{encodeURIComponent\(card\.id\)\}\/review/);
	assert.match(client, /expectedRevision: card\.revision/);
	const server = read("src/lib/beta/memory/memory.ts");
	assert.match(server, /addCard\(/, "cards are added through Learn a verse's addCard");
	assert.equal(/verseMemory\.(update|create|upsert|delete)/.test(server), false, "the module never writes VerseMemory itself");
	assert.equal(/\breviewCard\b/.test(server + client + read("src/components/beta/memory/MemorySession.tsx")), false, "no second scheduler");
	const scheduleImports = [...server.matchAll(/import \{([^}]*)\} from "@\/lib\/learn-schedule"/g)].map((match) => match[1].trim());
	assert.deepEqual(scheduleImports, ["startOfTomorrow"], "only the day boundary, never the ladder");
	assert.equal(/prisma\.betaItem/.test(server), false, "the store goes through store.ts");
});

test("the registry entry is live and names this issue", () => {
	const entry = BETA_MODULES.find((item) => item.slug === "memory");
	assert.equal(entry.status, "live");
	assert.equal(entry.issue, "LC-17651");
	assert.equal(entry.destination, "learn");
});
