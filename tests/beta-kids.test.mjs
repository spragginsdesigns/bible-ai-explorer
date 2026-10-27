/**
 * SureWord Kids (LC-17657, docs/beta/kids.md): the checked-in adventures
 * against the bundled KJV, the one child-profile shape, the parent check, and
 * the source contracts that keep a child's data away from models and keep
 * Kids mode closed.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { KIDS_ADVENTURES, KIDS_ADVENTURE_IDS, findKidsAdventure } from "../src/lib/beta/kids/adventures.ts";
import {
	AGE_BANDS,
	CHILD_ITEM_TITLE,
	KIDS_NAME_MAX,
	PARENT_CHECK_TRIES,
	QUIZ_SHAPE,
	awardChild,
	checkChildName,
	checkParentAnswer,
	makeParentChallenge,
	memoryPlan,
	numberInWords,
	parentChallengeText,
	parentLockSeconds,
	parseKidsChild,
	parseVerseKey,
	passageReference,
	passageVerses,
	verseKey,
} from "../src/lib/beta/kids/kids-rules.ts";
import { answerIsGrounded, answerStandsOut, distractorContradictsVerse, foldWords } from "../src/lib/quiz-rules.ts";
import { verseWords } from "../src/components/learn/learn.ts";
import { BETA_MODULES } from "../src/lib/beta/modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");
const BOOKS = JSON.parse(read("src/data/books.json"));
const kjvCache = new Map();
function kjvChapter(book, chapter) {
	if (!kjvCache.has(book)) {
		const meta = BOOKS.find((entry) => entry.order === book);
		kjvCache.set(book, JSON.parse(read(`src/data/kjv/${meta.file}`)));
	}
	return kjvCache.get(book)[chapter - 1];
}
function verseText(adventure, key) {
	const ref = parseVerseKey(key);
	return kjvChapter(adventure.book, ref.chapter)[ref.verse - 1];
}
function filesUnder(relativeDir) {
	const root = join(repoRoot, relativeDir);
	if (!existsSync(root)) return [];
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else out.push(relative(repoRoot, full));
		}
	};
	walk(root);
	return out.sort();
}

test("at least twelve adventures, starting with the twelve the issue named", () => {
	assert.ok(KIDS_ADVENTURES.length >= 12);
	assert.deepEqual(KIDS_ADVENTURE_IDS.slice(0, 12), [
		"creation", "noah", "abraham", "joseph", "red-sea", "david",
		"daniel", "jonah", "birth-of-jesus", "calming-the-storm", "five-loaves", "resurrection",
	]);
	assert.equal(new Set(KIDS_ADVENTURE_IDS).size, KIDS_ADVENTURE_IDS.length, "ids are unique");
	for (const id of KIDS_ADVENTURE_IDS) assert.match(id, /^[a-z][a-z0-9-]{0,39}$/);
	assert.equal(findKidsAdventure("noah")?.title, "Noah and the Ark");
	assert.equal(findKidsAdventure("nope"), null);
});

test("every passage is a real KJV range, in order, inside its chapter", () => {
	for (const adventure of KIDS_ADVENTURES) {
		const meta = BOOKS.find((entry) => entry.order === adventure.book);
		assert.ok(meta, `${adventure.id}: book ${adventure.book}`);
		let last = 0;
		for (const segment of adventure.segments) {
			assert.ok(segment.chapter >= 1 && segment.chapter <= meta.chapters, `${adventure.id}: chapter ${segment.chapter}`);
			const verses = kjvChapter(adventure.book, segment.chapter);
			assert.ok(segment.from >= 1 && segment.from <= segment.to && segment.to <= verses.length, `${adventure.id}: ${segment.chapter}:${segment.from}-${segment.to}`);
			const start = segment.chapter * 1000 + segment.from;
			assert.ok(start > last, `${adventure.id}: segments must be in reading order and must not overlap`);
			last = segment.chapter * 1000 + segment.to;
		}
		const count = passageVerses(adventure.segments).length;
		assert.ok(count >= 5 && count <= 40, `${adventure.id}: ${count} verses is a long listen for a child`);
	}
	assert.equal(passageReference("Jonah", findKidsAdventure("jonah").segments), "Jonah 1:1-4, 12-17; 2:1, 9-10; 3:1-5, 10");
	assert.equal(passageReference("Genesis", findKidsAdventure("creation").segments), "Genesis 1:1-31; 2:1-3");
	assert.equal(passageReference("Mark", findKidsAdventure("calming-the-storm").segments), "Mark 4:35-41");
});

/** Capitalized words that are not the start of a sentence or quotation. */
function namesIn(text) {
	const names = [];
	const tokens = text.split(/\s+/);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		const previous = tokens[index - 1] ?? "";
		const opensSentence = index === 0 || /([.!?:;][”"’]*|[“"])$/.test(previous) || /^[“"]/.test(token);
		const word = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").replace(/[’']s$/u, "").replace(/[’']$/u, "");
		if (!word || opensSentence || word === "I" || word === "O") continue;
		if (/^\p{Lu}/u.test(word)) names.push(word);
	}
	return names;
}

test("every retelling line retells verses inside its passage, and names only who the passage names", () => {
	for (const adventure of KIDS_ADVENTURES) {
		const inPassage = new Set(passageVerses(adventure.segments).map((ref) => verseKey(ref.chapter, ref.verse)));
		const passageText = [...inPassage].map((key) => verseText(adventure, key)).join(" ").toLowerCase();
		const allowed = new Set((adventure.alsoNamed ?? []).map((entry) => entry.name.toLowerCase()));
		for (const band of AGE_BANDS) {
			const lines = adventure.retelling[band];
			assert.ok(lines.length >= 4 && lines.length <= 10, `${adventure.id} ${band}: ${lines.length} lines`);
			let previousFirst = 0;
			for (const line of lines) {
				assert.ok(line.text.trim() && line.text.length <= 320, `${adventure.id} ${band}: line length`);
				assert.ok(line.verses.length >= 1, `${adventure.id} ${band}: "${line.text}" cites no verse`);
				for (const key of line.verses) assert.ok(inPassage.has(key), `${adventure.id} ${band}: ${key} is outside the passage`);
				const first = Math.min(...line.verses.map((key) => { const ref = parseVerseKey(key); return ref.chapter * 1000 + ref.verse; }));
				assert.ok(first >= previousFirst, `${adventure.id} ${band}: lines follow the passage's order ("${line.text.slice(0, 40)}")`);
				previousFirst = first;
				for (const name of namesIn(line.text)) {
					const key = name.toLowerCase();
					assert.ok(passageText.includes(key) || allowed.has(key), `${adventure.id} ${band}: "${name}" is not named in the passage`);
				}
				assert.equal(/\bGoliath\b/.test(line.text) && !passageText.includes("goliath"), false);
			}
		}
		for (const entry of adventure.alsoNamed ?? []) {
			assert.equal(passageText.includes(entry.name.toLowerCase()), false, `${adventure.id}: ${entry.name} is named in the passage, so it needs no allowance`);
			assert.ok(entry.where.length > 10);
		}
	}
});

test("every quiz answer is in its verse and no wrong choice is, by Quiz me's own rules", () => {
	for (const adventure of KIDS_ADVENTURES) {
		const inPassage = new Set(passageVerses(adventure.segments).map((ref) => verseKey(ref.chapter, ref.verse)));
		for (const band of AGE_BANDS) {
			const shape = QUIZ_SHAPE[band];
			const questions = adventure.questions[band];
			assert.equal(questions.length, shape.questions, `${adventure.id} ${band}: question count`);
			for (const question of questions) {
				const label = `${adventure.id} ${band}: "${question.prompt}"`;
				assert.equal(question.wrong.length, shape.choices - 1, `${label}: choices`);
				assert.ok(question.verses.length >= 1 && question.verses.length <= 3, `${label}: verses`);
				for (const key of question.verses) assert.ok(inPassage.has(key), `${label}: ${key} is outside the passage`);
				const text = question.verses.map((key) => verseText(adventure, key)).join(" ");
				assert.ok(answerIsGrounded(question.correct, text), `${label}: "${question.correct}" is not what the verse says`);
				for (const wrong of question.wrong) {
					assert.equal(distractorContradictsVerse(wrong, question.correct, text), false, `${label}: wrong choice "${wrong}" is something the verse says`);
				}
				assert.equal(answerStandsOut(question.correct, question.wrong), false, `${label}: the right answer gives itself away by length`);
				const folded = [question.correct, ...question.wrong].map((option) => foldWords(option).join(" "));
				assert.equal(new Set(folded).size, folded.length, `${label}: duplicate choices`);
				assert.ok(question.prompt.length <= 120 && [question.correct, ...question.wrong].every((option) => option.length <= 60), `${label}: too long for a child`);
			}
		}
	}
});

test("every verse to learn is the KJV's own words, word for word", () => {
	for (const adventure of KIDS_ADVENTURES) {
		const { chapter, verse, text } = adventure.memory;
		const kjv = kjvChapter(adventure.book, chapter)[verse - 1];
		assert.ok(kjv, `${adventure.id}: ${chapter}:${verse} exists`);
		assert.ok(kjv.includes(text), `${adventure.id}: "${text}" is not in ${chapter}:${verse}`);
		const at = kjv.indexOf(text);
		assert.ok(at === 0 || kjv[at - 1] === " ", `${adventure.id}: the memory text starts mid-word`);
		const after = kjv[at + text.length];
		assert.ok(after === undefined || after === " " || after === "," || after === ":" || after === ";", `${adventure.id}: the memory text ends mid-word`);
		assert.ok(text.split(/\s+/).length >= 3 && text.split(/\s+/).length <= 24, `${adventure.id}: memory length`);
		// Learn a verse's ladder hides words at every stage the plan uses.
		for (const band of AGE_BANDS) {
			const plan = memoryPlan(band, text.split(/\s+/).length);
			assert.equal(plan.stages[0], 0, "every ladder starts by reading the verse");
			assert.ok(plan.stages.length >= 2);
			for (const stage of plan.stages.slice(1)) assert.ok(verseWords(text, stage).some((word) => word.hidden), `${adventure.id} ${band}: stage ${stage} hides nothing`);
		}
	}
	assert.deepEqual(memoryPlan("3-5", 3), { stages: [0, 2], order: true });
	assert.deepEqual(memoryPlan("6-8", 3), { stages: [0, 2], order: true });
	assert.deepEqual(memoryPlan("3-5", 8), { stages: [0, 1], order: true });
	assert.deepEqual(memoryPlan("3-5", 19), { stages: [0, 1], order: false });
	assert.deepEqual(memoryPlan("9-12", 19), { stages: [0, 1, 2, 3], order: true });
});

test("a child is a first name or nickname and an age band, nothing else", () => {
	assert.deepEqual(checkChildName("  Lily  "), { ok: true, value: "Lily" });
	assert.deepEqual(checkChildName("Mary  Ann"), { ok: true, value: "Mary Ann" });
	assert.equal(checkChildName("Zoë").ok, true);
	assert.equal(checkChildName("O’Neil").ok, true);
	assert.equal(checkChildName("J.J.").ok, true);
	for (const bad of ["", "   ", "Lily2", "lily@example.com", "https://x.y", "x".repeat(KIDS_NAME_MAX + 1), "😀", "-Lily", 42, null, undefined]) {
		assert.equal(checkChildName(bad).ok, false, `${String(bad)} must be refused`);
	}
	const ids = KIDS_ADVENTURE_IDS;
	const item = { id: "c1", module: "kids", kind: "child", data: { name: "Lily", ageBand: "6-8", stars: ["noah", "gone", "creation"], verses: "nope" } };
	assert.deepEqual(parseKidsChild(item, ids), { id: "c1", name: "Lily", ageBand: "6-8", stars: ["creation", "noah"], verses: [] });
	assert.equal(parseKidsChild({ ...item, module: "family" }, ids), null);
	assert.equal(parseKidsChild({ ...item, kind: "session" }, ids), null);
	assert.equal(parseKidsChild({ ...item, data: { name: "Lily", ageBand: "13-15" } }, ids), null);
	assert.equal(parseKidsChild({ ...item, data: { name: "", ageBand: "3-5" } }, ids), null);
	assert.equal(CHILD_ITEM_TITLE, "Child profile");
});

test("a star or a learned verse is added once, only for a real adventure", () => {
	const ids = KIDS_ADVENTURE_IDS;
	const child = { id: "c1", name: "Lily", ageBand: "3-5", stars: [], verses: [] };
	const one = awardChild(child, "noah", "star", ids);
	assert.deepEqual(one.stars, ["noah"]);
	assert.equal(awardChild(one, "noah", "star", ids), one, "the same star twice is a no-op");
	assert.deepEqual(awardChild(one, "creation", "star", ids).stars, ["creation", "noah"], "kept in catalog order");
	assert.deepEqual(awardChild(one, "daniel", "verse", ids).verses, ["daniel"]);
	assert.equal(awardChild(one, "not-an-adventure", "star", ids), one);
	assert.deepEqual(child.stars, [], "awarding never mutates");
});

test("the parent check is a three-digit sum, in words, that a tap cannot pass", () => {
	let seed = 1;
	const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	for (let index = 0; index < 500; index += 1) {
		const challenge = makeParentChallenge(random);
		const sum = challenge.a + challenge.b;
		assert.ok(challenge.a >= 51 && challenge.a <= 89 && challenge.b >= 51 && challenge.b <= 89);
		assert.ok(sum >= 100 && sum <= 999, "always three digits");
		assert.equal(checkParentAnswer(challenge, String(sum)), true);
		assert.equal(checkParentAnswer(challenge, String(sum + 1)), false);
		assert.equal(/\d/.test(parentChallengeText(challenge)), false, "written in words, so it takes reading too");
	}
	assert.equal(numberInWords(64), "sixty-four");
	assert.equal(numberInWords(70), "seventy");
	assert.equal(parentChallengeText({ a: 64, b: 57 }), "What is sixty-four plus fifty-seven?");
	for (const typed of ["", "1", "12", "1210", "abc", "12 1", " 121"]) assert.equal(checkParentAnswer({ a: 64, b: 57 }, typed), false);
	assert.equal(checkParentAnswer({ a: 64, b: 57 }, "121"), true);
	assert.deepEqual([0, 1, 2].map(parentLockSeconds), [0, 0, 0]);
	assert.equal(parentLockSeconds(PARENT_CHECK_TRIES), 30);
	assert.equal(parentLockSeconds(PARENT_CHECK_TRIES + 1), 0);
	assert.equal(parentLockSeconds(PARENT_CHECK_TRIES * 2), 60);
	assert.equal(parentLockSeconds(PARENT_CHECK_TRIES * 9), 300, "the lock tops out at five minutes");
});

const KIDS_SOURCES = [
	...filesUnder("src/lib/beta/kids"),
	...filesUnder("src/components/beta/kids"),
	...filesUnder("src/app/beta/together/kids"),
	...filesUnder("src/app/api/beta/kids"),
];

test("nothing about a child goes to a model, and no route is ungated", () => {
	assert.ok(KIDS_SOURCES.length >= 8);
	for (const file of KIDS_SOURCES) {
		const source = read(file);
		for (const banned of ["@/lib/ai", "@ai-sdk", "from \"ai\"", "openai", "anthropic", "/api/ask-question", "/api/chat", "embedding", "posthog", "@/lib/analytics", "console.log"]) {
			assert.equal(source.includes(banned), false, `${file} must not use ${banned}`);
		}
	}
	for (const route of KIDS_SOURCES.filter((file) => file.endsWith("route.ts"))) {
		assert.match(read(route), /const gate = await requireBetaApi\(\);\s*if \(!gate\.ok\) return gate\.response;/, `${route} must gate first`);
	}
	for (const page of KIDS_SOURCES.filter((file) => file.endsWith("page.tsx"))) {
		assert.match(read(page), /await requireBetaPage\(\)/, `${page} must call requireBetaPage()`);
		assert.match(read(page), /return betaMetadata\(/, `${page} metadata goes through betaMetadata()`);
	}
	const server = read("src/lib/beta/kids/children.ts");
	assert.equal(server.includes("prisma"), false, "children go through the shared store, never prisma directly");
	assert.match(server, /title: CHILD_ITEM_TITLE/, "the name never becomes a title");
});

test("Kids mode has no way out but the parent check: no links, no text a child could type", () => {
	const kidsMode = filesUnder("src/components/beta/kids").filter((file) => !file.endsWith("KidsParent.tsx"));
	assert.ok(kidsMode.some((file) => file.endsWith("KidsMode.tsx")));
	for (const file of kidsMode) {
		const source = read(file);
		for (const banned of ["next/link", "<Link", "<a ", "href=", "<input", "<textarea", "contentEditable", "window.open", "location.href ="]) {
			assert.equal(source.includes(banned), false, `${file} must not contain ${banned}`);
		}
	}
	const mode = read("src/components/beta/kids/KidsMode.tsx");
	assert.match(mode, /showModal\(\)/, "a modal dialog makes the rest of the page inert");
	assert.match(mode, /onCancel=\{/, "Escape opens the parent check instead of closing");
	assert.match(mode, /popstate/, "Back opens the parent check instead of leaving");
	const progress = read("src/app/api/beta/kids/children/[id]/progress/route.ts");
	assert.match(progress, /isKidsAward\(/);
	assert.match(progress, /findKidsAdventure\(/, "only catalog ids are ever stored, never text");
	const quiet = read("src/components/whats-new/WhatsNewPresenter.tsx");
	assert.match(quiet, /beta\\\/together\\\/kids\\\/play/, "What's new, with its links, never opens over Kids mode");
});

test("the registry entry is live and points at this issue", () => {
	const entry = BETA_MODULES.find((item) => item.slug === "kids");
	assert.equal(entry.status, "live");
	assert.equal(entry.issue, "LC-17657");
	assert.ok(existsSync(join(repoRoot, "src/app/beta/together/kids/page.tsx")));
	assert.ok(existsSync(join(repoRoot, "docs/beta/kids.md")));
});
