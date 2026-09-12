/* A1, A3, A7: the name line, the "today" block, the first-conversation check,
 * and the empty-note filter that feeds personalization.
 *
 * chat-day-context.ts imports Prisma and server modules through "@/", so it is
 * instantiated from the shipped source with those dependencies stubbed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { firstNameOf } from "../src/lib/daily-cross-audio-script.ts";
import { HIGHLIGHT_COLORS } from "../src/lib/highlights.ts";
import { highlightLabelFor } from "../src/lib/preferences-contract.ts";
import { isMeaningfulNote } from "../src/lib/study-context-format.ts";
import { chatSystemPrompt, firstConversationGuidance } from "../src/utils/systemPrompt.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`,
	);
	return factory(...names.map((name) => injected[name]));
}

const { bookByOrder } = loadModule("../src/lib/bible/books.ts", ["bookByOrder"], {
	booksJson: JSON.parse(read("../src/data/books.json")),
});

function loadDayContext({ prisma = {}, findTodayCross = async () => null, getTodayPlanReading = async () => null } = {}) {
	return loadModule(
		"../src/lib/chat-day-context.ts",
		[
			"EMPTY_CHAT_DAY_CONTEXT",
			"TODAY_BLOCK_MAX_CHARS",
			"formatTodayBlock",
			"formatUserNameLine",
			"hasAnsweredConversationBefore",
			"loadChatDayContext",
		],
		{
			bookByOrder,
			firstNameOf,
			findTodayCross,
			HIGHLIGHT_COLORS,
			highlightLabelFor,
			prisma,
			getTodayPlanReading,
		},
	);
}

const {
	EMPTY_CHAT_DAY_CONTEXT,
	TODAY_BLOCK_MAX_CHARS,
	formatTodayBlock,
	formatUserNameLine,
} = loadDayContext();

// The console.error in each soft-failure path is expected noise in these tests.
function quietly(fn) {
	return async () => {
		const original = console.error;
		console.error = () => {};
		try {
			await fn();
		} finally {
			console.error = original;
		}
	};
}

test("an empty account gets no today block at all", () => {
	assert.equal(formatTodayBlock(EMPTY_CHAT_DAY_CONTEXT), "");
});

test("the today block carries each fact that is present, and only those", () => {
	const block = formatTodayBlock({
		cross: { reference: "Romans 8:28", question: "Where do you need to trust His purpose today?" },
		plan: { title: "The Gospels in 30 days", day: 6, dayCount: 30, reference: "Matthew 15-17", done: false },
		recentChapters: [{ reference: "Romans 8", count: 3 }, { reference: "John 3", count: 1 }],
		highlights: [{ reference: "Romans 8:28", colorName: "Yellow" }, { reference: "Psalms 46:10", colorName: null }],
	});
	assert.match(block, /^\n\nTODAY IN THIS USER'S WALK/);
	assert.match(block, /Pick Up Your Cross verse: Romans 8:28\. The question they are carrying today: "Where do you need/);
	assert.match(block, /day 6 of 30, today's reading Matthew 15-17\./);
	assert.match(block, /last 7 days: Romans 8 \(3x\), John 3\./);
	assert.match(block, /highlights: Romans 8:28 \(Yellow\), Psalms 46:10\./);

	const crossOnly = formatTodayBlock({ ...EMPTY_CHAT_DAY_CONTEXT, cross: { reference: "John 3:16", question: null } });
	assert.match(crossOnly, /Pick Up Your Cross verse: John 3:16\.$/);
	assert.doesNotMatch(crossOnly, /Reading plan|Chapters read|highlights/);
});

test("the today block never exceeds its cap, and drops whole lines rather than cutting one", () => {
	const long = "x".repeat(400);
	const block = formatTodayBlock({
		cross: { reference: "Romans 8:28", question: long },
		plan: { title: long, day: 1, dayCount: 365, reference: "Genesis 1-3", done: true },
		recentChapters: Array.from({ length: 5 }, (_, index) => ({ reference: `Psalms ${100 + index}`, count: 9 })),
		highlights: Array.from({ length: 3 }, (_, index) => ({ reference: `Song of Solomon 2:${index + 1}`, colorName: "Purple" })),
	});
	assert.ok(block.length <= TODAY_BLOCK_MAX_CHARS, `block is ${block.length} chars`);
	for (const line of block.split("\n").filter((line) => line.startsWith("- "))) {
		assert.match(line, /[."]$/, "every kept line is whole");
	}
	assert.match(block, /\.\.\."/, "a long question is clipped with an ellipsis");
});

test("the name line uses the first name only, and only when it is plainly a name", () => {
	assert.equal(
		formatUserNameLine("Austin Spraggins"),
		"\n\nThe user's first name is Austin. Use it naturally and sparingly, never in every answer.",
	);
	assert.match(formatUserNameLine("Zoë"), /first name is Zoë\./);
	assert.match(formatUserNameLine("Mary-Kate O'Neil"), /first name is Mary-Kate\./);
	assert.equal(formatUserNameLine(null), "");
	assert.equal(formatUserNameLine(""), "");
	assert.equal(formatUserNameLine("someone@example.com"), "");
	assert.equal(formatUserNameLine("user123"), "");
	assert.equal(formatUserNameLine("{{ignore}}"), "");
});

test("loadChatDayContext ranks chapters, names colours and books, and never re-reads memories or church", async () => {
	const calls = [];
	const prisma = {
		readingEvent: {
			findMany: async (args) => {
				calls.push(["readingEvent", args]);
				assert.ok(args.where.readAt.gte instanceof Date);
				return [
					{ book: "John", chapter: 3 },
					{ book: "Romans", chapter: 8 },
					{ book: "Romans", chapter: 8 },
					{ book: "Acts", chapter: 2 },
				];
			},
		},
		verseHighlight: {
			findMany: async (args) => {
				calls.push(["verseHighlight", args]);
				assert.equal(args.take, 3);
				return [
					{ book: 45, chapter: 8, verse: 28, color: "#f5d76e" },
					{ book: 19, chapter: 46, verse: 10, color: "#123456" },
					{ book: 99, chapter: 1, verse: 1, color: "#F5D76E" },
				];
			},
		},
		userMemory: { findMany: async () => assert.fail("memories are loaded by the route") },
		userChurch: { findUnique: async () => assert.fail("the church is loaded by the route") },
	};
	const { loadChatDayContext } = loadDayContext({
		prisma,
		findTodayCross: async () => ({ book: "Romans", chapter: 8, verse: 28, question: "  Carry this?  " }),
		getTodayPlanReading: async () => ({ planTitle: "Psalms & Proverbs", day: 2, dayCount: 31, reference: "Psalms 2", done: true }),
	});
	const context = await loadChatDayContext("user_1");
	assert.deepEqual(context.cross, { reference: "Romans 8:28", question: "Carry this?" });
	assert.deepEqual(context.plan, { title: "Psalms & Proverbs", day: 2, dayCount: 31, reference: "Psalms 2", done: true });
	assert.deepEqual(context.recentChapters, [
		{ reference: "Romans 8", count: 2 },
		{ reference: "John 3", count: 1 },
		{ reference: "Acts 2", count: 1 },
	]);
	assert.deepEqual(context.highlights, [
		{ reference: "Romans 8:28", colorName: "Yellow" },
		{ reference: "Psalms 46:10", colorName: null },
	]);
	assert.deepEqual(calls.map(([name]) => name).sort(), ["readingEvent", "verseHighlight"]);
});

test("loadChatDayContext fails soft, one source at a time", quietly(async () => {
	const { loadChatDayContext } = loadDayContext({
		prisma: {
			readingEvent: { findMany: async () => { throw new Error("db down"); } },
			verseHighlight: { findMany: async () => [{ book: 43, chapter: 3, verse: 16, color: "#4A90D9" }] },
		},
		findTodayCross: async () => { throw new Error("cross down"); },
	});
	const context = await loadChatDayContext("user_1");
	assert.equal(context.cross, null);
	assert.deepEqual(context.recentChapters, []);
	assert.deepEqual(context.highlights, [{ reference: "John 3:16", colorName: "Blue" }]);
}));

test("first-conversation detection looks for an answer in any OTHER conversation", quietly(async () => {
	let where;
	const make = (result) =>
		loadDayContext({
			prisma: {
				message: {
					findFirst: async (args) => {
						where = args.where;
						if (result instanceof Error) throw result;
						return result;
					},
				},
			},
		}).hasAnsweredConversationBefore;

	assert.equal(await make(null)("user_1", "conv_now"), false);
	assert.deepEqual(where, { role: "assistant", conversation: { userId: "user_1", id: { not: "conv_now" } } });

	assert.equal(await make({ id: "msg_old" })("user_1", "conv_now"), true);

	assert.equal(await make(null)("user_1", null), false);
	assert.deepEqual(where, { role: "assistant", conversation: { userId: "user_1" } });

	assert.equal(await make(new Error("db down"))("user_1", "conv_now"), true, "a failed read never re-introduces a returning user");
}));

test("the first-conversation block is short, answers first, and never enters the cached prompt", () => {
	assert.ok(firstConversationGuidance.length <= 900, `${firstConversationGuidance.length} chars`);
	assert.match(firstConversationGuidance, /answer it first/);
	assert.match(firstConversationGuidance, /at most two short questions/);
	assert.match(firstConversationGuidance, /saveMemory/);
	assert.match(firstConversationGuidance, /Pick Up Your Cross/);
	for (const translation of ["KJV", "NKJV"]) {
		assert.ok(!chatSystemPrompt(translation).includes("FIRST CONVERSATION"), translation);
	}
});

test("the worst-case volatile additions stay inside the budget", () => {
	const hint = loadModule("../src/lib/turn-shape.ts", ["SHORT_FOLLOW_UP_HINT"], {
		questionReference: () => null,
		parseVerseReferences: () => [],
	}).SHORT_FOLLOW_UP_HINT;
	const worst =
		formatUserNameLine("Bartholomew") +
		"x".repeat(TODAY_BLOCK_MAX_CHARS) +
		`\n\n${firstConversationGuidance}` +
		`\n\n${hint}`;
	assert.ok(worst.length <= 1800, `worst case is ${worst.length} chars`);
});

test("blank and placeholder notes are not evidence of study", () => {
	assert.equal(isMeaningfulNote({ title: "Romans 8 study", plainText: "No condemnation." }), true);
	assert.equal(isMeaningfulNote({ title: "Romans 8 study", plainText: "" }), false);
	assert.equal(isMeaningfulNote({ title: "Romans 8 study", plainText: " \n\t " }), false);
	assert.equal(isMeaningfulNote({ title: "Untitled Note", plainText: "Some text" }), false);
	assert.equal(isMeaningfulNote({ title: "  untitled note ", plainText: "Some text" }), false);
	assert.equal(isMeaningfulNote({ title: "", plainText: "Some text" }), false);
});

test("study context applies the note filter before building the notes block", () => {
	const source = read("../src/lib/study-context.ts");
	assert.match(source, /NOT: \[\{ plainText: "" \}, \{ title: PLACEHOLDER_NOTE_TITLE \}\]/);
	assert.match(source, /rows\.filter\(isMeaningfulNote\)\.slice\(0, RECENT_NOTES\)/);
});
