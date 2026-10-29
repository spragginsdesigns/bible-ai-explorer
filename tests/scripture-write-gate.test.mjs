import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = new Map();
// Cache transpilation while keeping every test's dependency and database mocks isolated.
function loadCached(relative, mocks) {
	if (!compiled.has(relative)) compiled.set(relative, ts.transpileModule(readFileSync(relative, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText);
	const module = { exports: {} };
	new Function("require", "module", "exports", compiled.get(relative))(id => {
		if (id in mocks) return mocks[id];
		if (id.startsWith("@/")) return {};
		return require(id);
	}, module, module.exports);
	return module.exports;
}

function harness(verifyGeneratedContent) {
	const writes = [];
	const checks = [];
	const record = data => ({ id: "study-1", revision: 1, ...data, createdAt: new Date(0), updatedAt: new Date(0) });
	const db = {
		note: { count: async () => 1 },
		agentStudy: {
			upsert: async args => { writes.push({ kind: "study-create", ...args }); return record(args.create); },
			updateMany: async args => { writes.push({ kind: "study-update", ...args }); return { count: 1 }; },
			findFirst: async () => record({ title: "saved" }),
		},
	};
	const study = loadCached("src/lib/study-tools.ts", {
		ai: { tool: input => input },
		"@/lib/prisma": { prisma: db },
		"@/lib/agent-intent": { isStudyWorkRequest: text => text === "save this study" },
		"@/lib/bible/books": { resolveReference: reference => reference === "John 3:16" ? { verse: 16 } : null },
		"@/lib/bible/passage-context": { canonicalPassage: async reference => { checks.push(reference); } },
	});
	const emptyBuilders = {
		"@/lib/serve-tools": { buildServeTools: () => ({}) },
		"@/lib/reading-tools": { buildReadingTools: () => ({}) },
		"@/lib/memory-tools": { buildMemoryTools: () => ({}) },
		"@/lib/onboarding-tools": { buildOnboardingTools: () => ({}) },
		"@/lib/agent-actions": { buildActionTools: () => ({}) },
	};
	const ai = loadCached("src/lib/ai-tools.ts", {
		...emptyBuilders,
		ai: { tool: input => input },
		"@/lib/study-tools": study,
		"@/lib/bible/atlas": { ATLAS_ERAS: [] },
		"@/lib/highlights": { HIGHLIGHT_COLORS: [] },
		"@/lib/reading-plan-presets": { READING_PLAN_PRESETS: [] },
		"@/lib/notes-io": {
			MAX_ORGANIZE_NAME_LENGTH: 60,
			MAX_ORGANIZE_TAGS: 10,
			appendMarkdownToNote: async args => { writes.push({ kind: "note-append", ...args }); return { success: true }; },
			rewriteNote: async args => { writes.push({ kind: "note-rewrite", ...args }); return { success: true }; },
			organizeUserNote: async args => { writes.push({ kind: "note-organize", ...args }); return { success: true }; },
		},
	});
	const context = { userId: "user-1", defaultNoteId: "open-note", userText: () => "save this study", messageId: () => "message-1", verifyGeneratedContent };
	return { ...study, tools: ai.buildSureWordTools(context), writes, checks };
}

const noteInput = { markdown: 'Jesus says "incorrect quotation" (John 3:16).', title: "Incorrect claim (John 3:16)" };
function checkpoint(extra = {}) {
	return {
		title: "A study title", goal: "A study goal",
		state: {
			audience: "A Bible study group", passages: ["John 3:16"],
			conclusions: [{ statement: "A conclusion supported by John 3:16", references: ["John 3:16"] }],
			openQuestions: ["What does John 3:16 teach?"], nextStep: "Read John 3:16", noteIds: ["note-1"], status: "active",
		},
		...extra,
	};
}

for (const [label, verifier] of [
	["missing verifier", undefined],
	["rejected Scripture", async () => null],
	["unavailable verifier", async () => { throw new Error("timeout"); }],
]) {
	test(`${label} prevents append, rewrite, study creation and study revision`, async () => {
		const h = harness(verifier);
		for (const name of ["addToNote", "updateNote"]) {
			await assert.rejects(h.tools[name].execute(noteInput), /nothing was saved/);
		}
		for (const input of [checkpoint(), checkpoint({ id: "study-1", revision: 3 })]) {
			const result = await h.tools.saveStudy.execute(input);
			assert.equal(result.success, false);
			assert.match(result.error, /nothing was saved/);
		}
		assert.deepEqual(h.writes, []);
	});
}

test("note writes persist only canonical replacements, including their titles", async () => {
	const calls = [];
	const h = harness(async (blocks, purpose) => {
		calls.push({ blocks, purpose });
		return blocks.map(block => ({ ...block, text: block.id === "markdown" ? "For God so loved the world (John 3:16)." : "God's love (John 3:16)" }));
	});
	await h.tools.addToNote.execute({ ...noteInput, noteId: " " });
	await h.tools.updateNote.execute(noteInput);
	assert.deepEqual(calls.map(call => call.purpose), ["addToNote", "updateNote"]);
	for (const call of calls) assert.deepEqual(call.blocks.map(block => block.id), ["markdown", "title"]);
	assert.equal(h.writes.length, 2);
	for (const write of h.writes) {
		assert.equal(write.markdown, "For God so loved the world (John 3:16).");
		assert.equal(write.title, "God's love (John 3:16)");
		assert.equal(write.noteId, "open-note");
	}
	assert.equal(h.writes[0].matchExistingTitle, true, "retry title matching is preserved");
});

test("rejected title alone prevents a note or study write", async () => {
	const seen = [];
	const h = harness(async blocks => {
		seen.push(blocks);
		return blocks.some(block => block.id === "title" && block.text.includes("Incorrect claim")) ? null : blocks;
	});
	await assert.rejects(h.tools.addToNote.execute(noteInput), /nothing was saved/);
	await assert.rejects(h.tools.updateNote.execute(noteInput), /nothing was saved/);
	assert.equal((await h.tools.saveStudy.execute(checkpoint({ title: noteInput.title }))).success, false);
	assert.equal(seen.length, 3);
	assert.deepEqual(h.writes, []);
});

test("study verifies all prose together and preserves coordinates, links, revisions and idempotency", async () => {
	const calls = [];
	const h = harness(async (blocks, purpose) => {
		calls.push({ blocks, purpose });
		return blocks.map(block => ({ ...block, text: `Verified: ${block.text}` }));
	});
	assert.equal((await h.tools.saveStudy.execute(checkpoint())).success, true);
	assert.equal((await h.tools.saveStudy.execute(checkpoint({ id: "study-1", revision: 3 }))).success, true);
	const expectedIds = ["title", "goal", "state.audience", "state.conclusions.0.statement", "state.openQuestions.0", "state.nextStep"];
	for (const call of calls) {
		assert.equal(call.purpose, "saveStudy");
		assert.deepEqual(call.blocks.map(block => block.id), expectedIds);
	}
	const created = h.writes[0];
	assert.deepEqual(created.where, { userId_sourceMessageId: { userId: "user-1", sourceMessageId: "message-1" } });
	assert.deepEqual(created.update, {});
	assert.equal(created.create.title, "Verified: A study title");
	assert.equal(created.create.goal, "Verified: A study goal");
	for (const [key, value] of Object.entries(checkpoint().state)) {
		if (["audience", "nextStep"].includes(key)) assert.equal(created.create.state[key], `Verified: ${value}`);
	}
	assert.equal(created.create.state.conclusions[0].statement, "Verified: A conclusion supported by John 3:16\n\nScripture references: John 3:16");
	assert.deepEqual(created.create.state.openQuestions, ["Verified: What does John 3:16 teach?"]);
	assert.deepEqual(created.create.state.passages, ["John 3:16"]);
	assert.deepEqual(created.create.state.conclusions[0].references, ["John 3:16"]);
	assert.deepEqual(created.create.state.noteIds, ["note-1"]);
	assert.deepEqual(h.writes[1].where, { id: "study-1", userId: "user-1", revision: 3 });
	assert.deepEqual(h.writes[1].data.revision, { increment: 1 });
	assert.deepEqual(h.checks, ["John 3:16", "John 3:16"]);
});

test("an uncited false claim and its valid reference reach verification as one block and cannot be saved", async () => {
	const input = checkpoint();
	input.state.conclusions[0].statement = "God promises every believer earthly riches.";
	let conclusion;
	const h = harness(async blocks => {
		conclusion = blocks.find(block => block.id === "state.conclusions.0.statement");
		return null;
	});
	assert.equal((await h.tools.saveStudy.execute(input)).success, false);
	assert.deepEqual(conclusion, {
		id: "state.conclusions.0.statement",
		text: "God promises every believer earthly riches.\n\nScripture references: John 3:16",
	});
	assert.deepEqual(h.checks, ["John 3:16"], "the coordinate exists but does not establish the claim");
	assert.deepEqual(h.writes, []);
});

test("a conclusion without supporting references fails before verification or writes", async () => {
	const input = checkpoint();
	input.state.conclusions[0].references = [];
	let calls = 0;
	const h = harness(async blocks => { calls++; return blocks; });
	assert.equal((await h.tools.saveStudy.execute(input)).success, false);
	assert.equal(calls, 0);
	assert.deepEqual(h.writes, []);
});

test("saving an existing verified conclusion keeps one explicit reference association", async () => {
	const input = checkpoint();
	input.state.conclusions[0].statement += "\n\nScripture references: John 3:16";
	const h = harness(async blocks => blocks);
	assert.equal((await h.tools.saveStudy.execute(input)).success, true);
	assert.equal(h.writes[0].create.state.conclusions[0].statement, input.state.conclusions[0].statement);
});

for (const [label, transform] of [
	["missing block", blocks => blocks.slice(1)],
	["extra block", blocks => [...blocks, { id: "extra", text: "unexpected" }]],
	["reordered blocks", blocks => [...blocks].reverse()],
	["renamed block", blocks => blocks.map((block, index) => index === 0 ? { ...block, id: "invented" } : block)],
	["non-text result", blocks => blocks.map(block => ({ ...block, text: null }))],
	["empty repair", blocks => blocks.map(block => ({ ...block, text: "" }))],
]) {
	test(`${label} fails closed before every write`, async () => {
		const h = harness(async blocks => transform(blocks));
		await assert.rejects(h.tools.addToNote.execute(noteInput), /nothing was saved/);
		await assert.rejects(h.tools.updateNote.execute(noteInput), /nothing was saved/);
		assert.equal((await h.tools.saveStudy.execute(checkpoint())).success, false);
		assert.deepEqual(h.writes, []);
	});
}

test("a callback cannot mutate input IDs to redefine the expected structure", async () => {
	const h = harness(async blocks => { blocks[0].id = "renamed"; return blocks; });
	await assert.rejects(h.tools.addToNote.execute(noteInput), /nothing was saved/);
	assert.deepEqual(h.writes, []);
});

test("study canonical repairs must still fit the saved-state schema", async () => {
	const h = harness(async blocks => blocks.map(block => ({ ...block, text: block.id === "title" ? "x".repeat(161) : block.text })));
	assert.equal((await h.tools.saveStudy.execute(checkpoint())).success, false);
	assert.deepEqual(h.writes, []);
});

test("canonical verification cannot bypass reference validity or read-before-revision", async () => {
	let verifications = 0;
	const h = harness(async blocks => { verifications++; return blocks; });
	const invalid = checkpoint();
	invalid.state.passages.push("John 3:999");
	assert.equal((await h.tools.saveStudy.execute(invalid)).success, false);
	assert.equal(verifications, 0, "invalid coordinates never reach semantic verification");
	assert.equal((await h.tools.saveStudy.execute(checkpoint({ id: "study-1" }))).success, false);
	assert.deepEqual(h.writes, []);
});

for (const [label, verifier] of [
	["missing", undefined], ["rejected", async () => null], ["malformed", async blocks => blocks.slice(1)],
]) {
	test(`${label} verification prevents organizing any model-provided metadata`, async () => {
		const h = harness(verifier);
		for (const input of [{ title: "Incorrect claim (John 3:16)" }, { folderName: "Scripture claim" }, { tags: ["Scripture claim"] }]) {
			await assert.rejects(h.tools.organizeNote.execute({ ...input, pin: "pin" }), /nothing was saved/);
		}
		assert.deepEqual(h.writes, []);
	});
}

test("organizeNote persists verified title, folder and every tag with unchanged pin intent", async () => {
	let received;
	const h = harness(async (blocks, purpose) => {
		received = { blocks, purpose };
		return blocks.map(block => ({ ...block, text: `Verified ${block.text}` }));
	});
	await h.tools.organizeNote.execute({ title: "Love", folderName: "John", tags: ["Grace", "Mercy"], pin: "unpin" });
	assert.deepEqual(received, { purpose: "organizeNote", blocks: [
		{ id: "title", text: "Love" }, { id: "folderName", text: "John" },
		{ id: "tags.0", text: "Grace" }, { id: "tags.1", text: "Mercy" },
	] });
	assert.deepEqual(h.writes, [{ kind: "note-organize", userId: "user-1", noteId: "open-note", title: "Verified Love", folderName: "Verified John", tags: ["Verified Grace", "Verified Mercy"], pinned: false }]);
});

test("organizeNote rejects canonical folder or tag repairs beyond existing schema bounds", async () => {
	for (const field of ["folderName", "tags.0"]) {
		const h = harness(async blocks => blocks.map(block => ({ ...block, text: block.id === field ? "x".repeat(61) : block.text })));
		await assert.rejects(h.tools.organizeNote.execute({ folderName: "John", tags: ["Love"] }), /nothing was saved/);
		assert.deepEqual(h.writes, []);
	}
});

test("pure pin changes need no verifier and never introduce metadata", async () => {
	const h = harness();
	await h.tools.organizeNote.execute({ pin: "pin" });
	await h.tools.organizeNote.execute({ pin: "unpin", tags: [] });
	assert.deepEqual(h.writes.map(write => write.pinned), [true, false]);
	for (const write of h.writes) {
		assert.equal(write.title, undefined);
		assert.equal(write.folderName, undefined);
	}
});
