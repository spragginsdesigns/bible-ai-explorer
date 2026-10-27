/**
 * Learning Paths content (LC-17648, docs/beta/paths.md). Every written path in
 * src/lib/beta/paths/content/ is checked against the bundled KJV: every
 * reference exists, and every right answer, ordered step, matched truth and
 * blanked word is in the words of the verse it cites (Quiz me's grounding
 * rules, src/lib/quiz-rules.ts). A path that fails here would teach something
 * the verse does not say.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	findWordSpan,
	formatPassage,
	lessonProblems,
	parsePassage,
	pathProblems,
	splitAroundBlank,
	verseTokens,
} from "../src/lib/beta/paths/content-rules.ts";
import { answerIsGrounded, answerStandsOut, distractorContradictsVerse, foldWords, overlapWithVerse } from "../src/lib/quiz-rules.ts";
import { buildPresetPlan } from "../src/lib/reading-plan-presets.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const books = JSON.parse(readFileSync(join(repoRoot, "src/data/books.json"), "utf8"));
const byName = new Map(books.map((book) => [book.name, book]));
byName.set("Psalm", byName.get("Psalms"));
const kjvCache = new Map();
function kjvBook(order) {
	if (!kjvCache.has(order)) {
		const book = books.find((entry) => entry.order === order);
		kjvCache.set(order, JSON.parse(readFileSync(join(repoRoot, "src/data/kjv", book.file), "utf8")));
	}
	return kjvCache.get(order);
}

export const deps = {
	resolveBook: (name) => byName.get(name) ?? null,
	verses: (passage) => {
		const chapter = kjvBook(passage.book)[passage.chapter - 1];
		if (!chapter || passage.end > chapter.length) return null;
		return chapter.slice(passage.start - 1, passage.end);
	},
	answerIsGrounded,
	distractorContradictsVerse,
	answerStandsOut,
	foldWords,
	overlapWithVerse,
};

const contentDir = join(repoRoot, "src/lib/beta/paths/content");
const contentFiles = readdirSync(contentDir).filter((file) => file.endsWith(".ts")).sort();

async function loadPaths() {
	const paths = [];
	for (const file of contentFiles) {
		const module = await import(pathToFileURL(join(contentDir, file)).href);
		for (const value of Object.values(module)) if (value && typeof value === "object" && Array.isArray(value.units)) paths.push({ file, path: value });
	}
	return paths;
}

test("passage references parse, format and refuse what is not in the Bible", () => {
	assert.deepEqual(parsePassage("Romans 3:21-26", deps.resolveBook), { book: 45, bookName: "Romans", chapter: 3, start: 21, end: 26 });
	assert.deepEqual(parsePassage("1 Corinthians 15:3", deps.resolveBook), { book: 46, bookName: "1 Corinthians", chapter: 15, start: 3, end: 3 });
	assert.equal(formatPassage(parsePassage("Psalms 119:105", deps.resolveBook)), "Psalm 119:105");
	assert.equal(formatPassage(parsePassage("Psalm 23:1-6", deps.resolveBook)), "Psalm 23:1-6");
	for (const bad of ["Romans 17:1", "Romans 3:26-21", "Rom 3:23", "Romans 3", "Romans 3:23-4:2", "Hezekiah 1:1", "", null, 45]) {
		assert.equal(parsePassage(bad, deps.resolveBook), null, String(bad));
	}
	assert.equal(deps.verses(parsePassage("Romans 3:31-32", deps.resolveBook)), null, "Romans 3 has 31 verses");
});

test("a blank is found once, as written, and the verse splits around it with its punctuation", () => {
	const john316 = deps.verses(parsePassage("John 3:16", deps.resolveBook))[0];
	assert.deepEqual(findWordSpan(john316, "loved"), { start: 3, end: 3 });
	assert.deepEqual(findWordSpan(john316, "only begotten Son"), { start: 10, end: 12 });
	assert.equal(findWordSpan(john316, "Loved"), null, "case matters: the blank is the verse's own word");
	assert.equal(findWordSpan(john316, "that"), null, "twice in the verse is ambiguous");
	assert.deepEqual(splitAroundBlank(john316, "world"), { before: "For God so loved the ", hidden: "world", after: ", that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." });
	const split = splitAroundBlank(john316, "everlasting life");
	assert.equal(`${split.before}${split.hidden}${split.after}`, john316);
	assert.deepEqual(verseTokens("Lord's (for he is good:)"), ["Lord's", "for", "he", "is", "good"]);
});

test("there are at least four written paths, with the ones the issue names", async () => {
	const paths = await loadPaths();
	const titles = paths.map(({ path }) => path.title);
	for (const title of ["Foundations of the Christian Faith", "Mastering Romans", "How to Read and Interpret Scripture", "The Life of Paul"]) {
		assert.ok(titles.includes(title), `missing path: ${title}`);
	}
	assert.equal(new Set(paths.map(({ path }) => path.id)).size, paths.length, "path ids are unique");
});

test("every written path is grounded in the KJV, lesson by lesson", async () => {
	const paths = await loadPaths();
	assert.ok(paths.length >= 1);
	for (const { file, path } of paths) {
		const problems = pathProblems(path, deps);
		assert.deepEqual(problems, [], `${file}:\n  ${problems.join("\n  ")}`);
	}
});

test("exercise ids are unique across every path, and read-along presets exist", async () => {
	const paths = await loadPaths();
	const seen = new Map();
	for (const { path } of paths) {
		for (const lesson of path.units.flatMap((unit) => unit.lessons)) {
			for (const ex of lesson.exercises) {
				assert.equal(seen.has(ex.id), false, `${ex.id} is in ${seen.get(ex.id)} and ${path.id}`);
				seen.set(ex.id, path.id);
			}
		}
		if (path.readAlong?.kind === "preset") assert.ok(buildPresetPlan(path.readAlong.presetKey), `${path.id}: unknown reading plan ${path.readAlong.presetKey}`);
		if (path.readAlong?.kind === "goal") assert.ok(path.readAlong.days >= 7 && path.readAlong.days <= 365, `${path.id}: read-along days`);
	}
});

test("the rules catch what would teach something the verse does not say", () => {
	const lesson = {
		id: "sample-01",
		title: "Sample",
		summary: "A lesson that should fail",
		reading: "John 3:14-18",
		teaching: "God gave His Son so that whosoever believeth in Him should not perish. This is the heart of the gospel.",
		keyVerse: "John 3:16",
		reflection: { prompt: "What does it mean to you that God so loved the world?", answer: "John 3:16" },
		exercises: [
			{ id: "sample-01.1", type: "choice", concept: "love", level: 1, prompt: "Why did God give His Son?", correct: "Because He was angry", wrong: ["God so loved the world that he gave his Son", "To judge", "To rule"], answer: "John 3:16" },
			{ id: "sample-01.2", type: "blank", concept: "faith", level: 1, answer: "John 3:16", word: "believes", wrong: ["loves", "hears", "sees"] },
			{ id: "sample-01.3", type: "order", concept: "faith", level: 2, prompt: "Put these in order", steps: [{ text: "Moses lifted up the serpent", answer: "John 3:14" }, { text: "Pilate washed his hands", answer: "John 3:15" }, { text: "God sent his Son", answer: "John 3:17" }] },
			{ id: "sample-01.4", type: "match", concept: "love", level: 3, prompt: "Match", pairs: [{ answer: "John 3:16", truth: "Whosoever believeth shall not perish" }, { answer: "John 3:17", truth: "God sent his Son not to condemn" }, { answer: "John 3:16", truth: "God so loved the world" }] },
		],
	};
	const problems = lessonProblems(lesson, deps).join("\n");
	assert.match(problems, /"Because He was angry" is not in the words of John 3:16/);
	assert.match(problems, /wrong answer "God so loved the world that he gave his Son" is something John 3:16 says/);
	assert.match(problems, /"believes" is not in John 3:16 exactly once/);
	assert.match(problems, /step "Pilate washed his hands" is not in the words of John 3:15/);
	assert.match(problems, /uses the same verse twice/);
	assert.match(problems, /needs 7 to 10 exercises/);
	assert.match(problems, /needs at least two multiple-choice questions/);
});
