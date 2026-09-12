/* The note-writer pass behind "Add to notes".
 *
 * Saving an answer used to store it verbatim, so a note opened in the chat's
 * second-person voice and was titled with the truncated question. These tests
 * drive the composer with a fake model: they pin what the prompt carries, what
 * the validator refuses, and - the part that matters most - that every failure
 * path still stores the user's content.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { NOTE_HOUSE_STYLE } from "../src/utils/noteHouseStyle.ts";
import { systemPrompt } from "../src/utils/systemPrompt.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

// Written as an escape: tooling on this PC flattens a literal em dash (see
// src/utils/noteHouseStyle.ts), and this test pins the real character.
const EM_DASH = "—";

/**
 * note-composer.ts reaches the provider, Prisma and the AI SDK, so its source
 * is evaluated with those injected instead of imported (same approach as
 * tests/note-title-match.test.mjs).
 */
function loadComposer({ generateText, prisma, resolveModel } = {}) {
	const source = read("../src/lib/note-composer.ts")
		.replace(/^import[^\r\n]*(?:\r?\n|$)/gm, "")
		.replace(/^export\s+/gm, "");
	const factory = new Function(
		"generateText", "Output", "z", "resolveModel", "prisma", "htmlToPlainText",
		"NOTE_HOUSE_STYLE", "systemPrompt",
		`${stripTypeScriptTypes(source)}
return { normalizeForMatch, answersMatch, findConversationForAnswer, loadConversationTranscript,
	buildTranscriptBlock, composerInstructions, buildComposerPrompt, validateComposedNote,
	correctionFor, composeNoteFromAnswer };`
	);
	return factory(
		generateText ?? (async () => ({ output: null })),
		{ object: (options) => options },
		z,
		resolveModel ?? (async () => ({ model: "fake-model", providerOptions: {} })),
		prisma ?? emptyPrisma(),
		(html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
		NOTE_HOUSE_STYLE,
		systemPrompt
	);
}

function emptyPrisma() {
	return {
		message: { findMany: async () => [] },
		note: { findFirst: async () => null },
		user: { findUnique: async () => null },
	};
}

/** A prisma double that records every where clause it is handed. */
function recordingPrisma(options = {}) {
	const calls = { messageWheres: [], noteWheres: [] };
	return {
		calls,
		prisma: {
			message: {
				findMany: async ({ where }) => {
					calls.messageWheres.push(where);
					if (where.role === "assistant") return options.candidates ?? [];
					return options.transcript ?? [];
				},
			},
			note: {
				findFirst: async ({ where }) => {
					calls.noteWheres.push(where);
					return options.note ?? null;
				},
			},
			user: { findUnique: async () => (options.user ?? null) },
		},
	};
}

/** A model that answers with each of these in turn. */
function scriptedModel(outputs) {
	const prompts = [];
	const generateText = async ({ prompt, instructions }) => {
		prompts.push({ prompt, instructions });
		const next = outputs[prompts.length - 1];
		if (next instanceof Error) throw next;
		return { output: next };
	};
	return { generateText, prompts };
}

const GOOD_NOTE = {
	title: "Why I Cannot Follow Christ Alone",
	markdown: `## The church is a body, not a building

I had been treating the assembly as optional, and Scripture does not allow it.

> Not forsaking the assembling of ourselves together, as the manner of some is; but exhorting one another: and so much the more, as ye see the day approaching.
> ${EM_DASH} Hebrews 10:25, KJV

## Membership is where obedience becomes visible

The commands I am given assume a people I am joined to.

## What I will do next

I will be in my seat Sunday morning and take my family with me.`,
};

/** Swallow the composer's own log lines while a failure path is exercised. */
async function quietly(run) {
	const { error, warn } = console;
	console.error = () => {};
	console.warn = () => {};
	try {
		return await run();
	} finally {
		console.error = error;
		console.warn = warn;
	}
}

test("the composer prompt carries the house style, the persona and the transcript", async () => {
	const { generateText, prompts } = scriptedModel([GOOD_NOTE]);
	const { prisma } = recordingPrisma({
		candidates: [{ conversationId: "conv-1", content: "unrelated" }],
		transcript: [
			{ role: "user", content: "Why do I need to go to church?" },
			{ role: "assistant", content: "Austin, the Bible has a great deal to say about this." },
		],
	});
	const composer = loadComposer({ generateText, prisma });

	const result = await composer.composeNoteFromAnswer({
		userId: "alice",
		markdown: "Austin, the Bible has a great deal to say about this.",
		conversationId: "conv-1",
	});

	assert.equal(result.composed, true);
	assert.equal(result.markdown, GOOD_NOTE.markdown);
	assert.equal(result.title, GOOD_NOTE.title);

	const [call] = prompts;
	assert.ok(call.instructions.includes(NOTE_HOUSE_STYLE), "the house style rides in the instructions");
	assert.ok(call.instructions.includes(systemPrompt), "the persona rides in the instructions");
	assert.match(call.prompt, /THE ANSWER THE USER IS SAVING:/);
	assert.match(call.prompt, /Why do I need to go to church\?/);
	assert.match(call.prompt, /SureWord: Austin, the Bible has a great deal/);
});

test("the instructions state every rule the composed note must follow", () => {
	const composer = loadComposer();
	const instructions = composer.composerInstructions();
	assert.match(instructions, /first person/i);
	assert.match(instructions, /Never address the user as "you"/);
	assert.match(instructions, /never use their name/);
	assert.match(instructions, /NEVER MENTION THE CHAT/);
	assert.match(instructions, /No "you asked"/);
	assert.match(instructions, /3 to 7 "## " headings/);
	assert.match(instructions, /what they will actually do next/);
	// The citation line must carry a real em dash; a hyphen turns the example
	// into a bullet list inside the blockquote (see noteHouseStyle.ts).
	assert.ok(instructions.includes(`"> ${EM_DASH} Book Chapter:Verse, TRANSLATION"`));
	assert.match(instructions, /descriptive noun phrase/);
});

test("a note that addresses the user, or names them, is rejected", () => {
	const composer = loadComposer();
	assert.deepEqual(composer.validateComposedNote(GOOD_NOTE), { ok: true });

	const secondPerson = composer.validateComposedNote({
		title: "Gathering With the Church",
		markdown: "## The church is a body\n\nYou asked why you should go to church, and the answer is plain.",
	});
	assert.equal(secondPerson.ok, false);
	assert.match(secondPerson.reason, /you/i);

	const named = composer.validateComposedNote(
		{ title: "Gathering With the Church", markdown: "## A body\n\nAustin should be in his seat Sunday." },
		{ userName: "Austin Spraggins" }
	);
	assert.equal(named.ok, false);
	assert.match(named.reason, /names the user/);

	// The same note is fine for a user who is not named Austin.
	assert.deepEqual(
		composer.validateComposedNote(
			{ title: "Gathering With the Church", markdown: "## A body\n\nI will be in my seat Sunday." },
			{ userName: "Mary" }
		),
		{ ok: true }
	);

	assert.equal(composer.validateComposedNote({ title: "T", markdown: "   " }).ok, false);
	assert.equal(
		composer.validateComposedNote({ title: "T", markdown: "Plain prose with no headings at all." }).ok,
		false
	);
});

test("quoted Scripture may say \"you\"; the note's own prose may not", () => {
	const composer = loadComposer();
	assert.deepEqual(
		composer.validateComposedNote({
			title: "The Promise I Stand On",
			markdown: `## God finishes what He starts\n\nI can rest in this.\n\n> Being confident of this very thing, that he which hath begun a good work in you will perform it until the day of Jesus Christ.\n> ${EM_DASH} Philippians 1:6, KJV`,
		}),
		{ ok: true }
	);
});

test("a rejected note is retried once, with the correction, then composed", async () => {
	const badNote = {
		title: "Church Attendance",
		markdown: "## Why you should go\n\nYou asked about church, and you need to be there.",
	};
	const { generateText, prompts } = scriptedModel([badNote, GOOD_NOTE]);
	const composer = loadComposer({ generateText, prisma: recordingPrisma().prisma });

	const result = await composer.composeNoteFromAnswer({ userId: "alice", markdown: "the answer" });

	assert.equal(result.composed, true);
	assert.equal(result.markdown, GOOD_NOTE.markdown);
	assert.equal(prompts.length, 2, "exactly one retry");
	assert.doesNotMatch(prompts[0].prompt, /CORRECTION:/);
	assert.match(prompts[1].prompt, /CORRECTION:/);
	assert.match(prompts[1].prompt, /previous attempt was rejected/);
});

test("two rejected attempts store the answer verbatim", async () => {
	const badNote = {
		title: "Church",
		markdown: "## Why you should go\n\nYou asked about church.",
	};
	const { generateText, prompts } = scriptedModel([badNote, badNote]);
	const composer = loadComposer({ generateText, prisma: recordingPrisma().prisma });

	const result = await quietly(() =>
		composer.composeNoteFromAnswer({ userId: "alice", markdown: "the original answer" })
	);

	assert.equal(prompts.length, 2, "never more than one retry");
	assert.deepEqual(result, {
		markdown: "the original answer",
		composed: false,
		reason: "rejected",
	});
});

test("a model error stores the original markdown, never nothing", async () => {
	const { generateText } = scriptedModel([new Error("provider exploded")]);
	const composer = loadComposer({ generateText, prisma: recordingPrisma().prisma });

	const result = await quietly(() =>
		composer.composeNoteFromAnswer({ userId: "alice", markdown: "the original answer" })
	);
	assert.deepEqual(result, { markdown: "the original answer", composed: false, reason: "error" });

	// An empty structured result is the same story.
	const empty = loadComposer({
		generateText: async () => ({ output: null }),
		prisma: recordingPrisma().prisma,
	});
	const emptyResult = await quietly(() =>
		empty.composeNoteFromAnswer({ userId: "alice", markdown: "the original answer" })
	);
	assert.deepEqual(emptyResult, { markdown: "the original answer", composed: false, reason: "empty" });

	// A provider that cannot be resolved at all must not lose the content either.
	const noModel = loadComposer({
		resolveModel: async () => {
			throw new Error("Add your OpenAI API key");
		},
		prisma: recordingPrisma().prisma,
	});
	const noModelResult = await quietly(() =>
		noModel.composeNoteFromAnswer({ userId: "alice", markdown: "the original answer" })
	);
	assert.equal(noModelResult.composed, false);
	assert.equal(noModelResult.markdown, "the original answer");
});

test("appending to an existing note passes its content and keeps its title", async () => {
	const { generateText, prompts } = scriptedModel([GOOD_NOTE]);
	const { prisma, calls } = recordingPrisma({
		note: {
			title: "Gathering With the Saints",
			htmlContent: "<h2>What I already wrote</h2><p>The assembly is not optional.</p>",
			plainText: "",
		},
	});
	const composer = loadComposer({ generateText, prisma });

	const result = await composer.composeNoteFromAnswer({
		userId: "alice",
		markdown: "the answer",
		noteId: "note-1",
	});

	assert.equal(result.composed, true);
	assert.equal(result.title, undefined, "an existing note keeps the title it has");
	assert.deepEqual(calls.noteWheres, [{ id: "note-1", userId: "alice" }]);

	const [call] = prompts;
	assert.match(call.instructions, /a note the user already keeps, titled "Gathering With the Saints"/);
	assert.match(call.instructions, /Do not restate what the note already says/);
	assert.match(call.prompt, /What I already wrote The assembly is not optional\./);
});

test("the conversation is found by content, and only among this user's messages", async () => {
	const answer =
		"The church is not a building but the assembly of believers whom God has joined to Christ and to one another, and Scripture never treats gathering with them as optional for anyone who belongs to Him.";
	const { prisma, calls } = recordingPrisma({
		candidates: [
			{ conversationId: "someone-elses", content: "A completely different answer about fasting." },
			{ conversationId: "conv-42", content: `${answer}\n\n[FOLLOWUP] What is a local church?` },
		],
	});
	const composer = loadComposer({ prisma });

	assert.equal(await composer.findConversationForAnswer("alice", answer), "conv-42");
	assert.deepEqual(calls.messageWheres[0], { role: "assistant", conversation: { userId: "alice" } });

	// Loading the transcript is scoped the same way, even though the id came
	// from the request body and could name anyone's conversation.
	await composer.loadConversationTranscript("alice", "conv-42");
	assert.deepEqual(calls.messageWheres[1], {
		conversationId: "conv-42",
		conversation: { userId: "alice" },
	});
});

test("an answer that matches nothing composes from itself alone", async () => {
	const { generateText, prompts } = scriptedModel([GOOD_NOTE]);
	const { prisma } = recordingPrisma({
		candidates: [{ conversationId: "other", content: "Nothing like it." }],
	});
	const composer = loadComposer({ generateText, prisma });

	const result = await composer.composeNoteFromAnswer({
		userId: "alice",
		markdown: "A long enough answer about the doctrine of the church that a prefix match is meaningful, and which appears in no stored message at all.",
	});
	assert.equal(result.composed, true);
	assert.match(prompts[0].prompt, /THE CONVERSATION IT CAME OUT OF: \(not available/);
});

test("two different answers that open alike are not matched to one another", () => {
	const composer = loadComposer();
	const a = "Yes. The Bible commands believers to gather, and here is why that matters for you today: ";
	assert.equal(composer.answersMatch(`${a}Hebrews says so.`, `${a}Acts says so.`), false);
	assert.equal(composer.answersMatch("Short.", "Short."), true);
	assert.equal(composer.answersMatch("Short.", "Shorter."), false);
	assert.equal(composer.answersMatch("", "anything"), false);
});

test("the transcript keeps the newest turns and stays inside its budget", () => {
	const composer = loadComposer();
	const messages = Array.from({ length: 40 }, (_, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: `turn ${index}`,
	}));

	const block = composer.buildTranscriptBlock(messages);
	assert.doesNotMatch(block, /turn 15\b/, "older turns are dropped");
	assert.match(block, /turn 39\b/, "the newest turn is always kept");
	assert.equal(block.split("\n\n").length, 24);
	assert.match(block, /^User: turn 16/);

	const tight = composer.buildTranscriptBlock(messages, { maxChars: 40 });
	assert.ok(tight.length <= 40, `length ${tight.length}`);
	assert.match(tight, /turn 39/);

	// One enormous turn is trimmed rather than allowed to crowd out the chat.
	const huge = composer.buildTranscriptBlock([{ role: "assistant", content: "x".repeat(9000) }]);
	assert.ok(huge.length < 9000, `length ${huge.length}`);
	assert.match(huge, /this turn continues/);

	assert.equal(composer.buildTranscriptBlock([]), "");
	assert.equal(composer.buildTranscriptBlock([{ role: "user", content: "   " }]), "");
});

test("the route composes by default, can be told not to, and never drops content", () => {
	const route = read("../src/app/api/notes/append/route.ts");
	assert.match(route, /const compose = !\(body && body\.compose === false\)/);
	assert.match(route, /composeNoteFromAnswer\(\{ userId, markdown, noteId, conversationId \}\)/);
	assert.match(route, /markdown: composed\?\.markdown \?\? markdown/);
	assert.match(route, /title: composed\?\.title \?\? title/);
	assert.match(route, /composed: composed\?\.composed \?\? false/);
	// The 32000 cap is what keeps a whole chat answer intact; the 8000 default
	// in notes-io is for the AI tool call.
	assert.match(route, /MAX_APPEND_MARKDOWN_LENGTH = 32000/);
});

test("the assistant's own addToNote tool keeps writing what it composed", () => {
	const tools = read("../src/lib/ai-tools.ts");
	const start = tools.indexOf("const addToNoteTool = tool(");
	const end = tools.indexOf("const readNoteTool = tool(");
	const block = tools.slice(start, end);
	assert.ok(start > 0 && end > start);
	// It calls the shared helper directly, so the route's composition pass -
	// which exists to rewrite chat answers - never runs over content the model
	// already wrote in the house style.
	assert.match(block, /appendMarkdownToNote\(\{/);
	assert.doesNotMatch(block, /notes\/append/);
	assert.doesNotMatch(tools, /composeNoteFromAnswer/);
});
