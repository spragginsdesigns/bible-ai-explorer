import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import * as notePlainText from "../src/lib/note-plain-text.mjs";
import { analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import * as verificationLimits from '../src/lib/ai/verification-limits.mjs';
import * as tracing from '../src/lib/ai/turn-trace.ts';
const require = createRequire(import.meta.url);
const candidate = fileURLToPath(new URL("../", import.meta.url));
const filename = relative => path.join(candidate, relative);
const json = relative => JSON.parse(readFileSync(filename(relative), "utf8"));
function load(relative, mocks = {}) {
	const compiled = ts.transpileModule(readFileSync(filename(relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
	const module = { exports: {} };
	new Function("require", "module", "exports", compiled)(id => {
		if (id in mocks) return mocks[id];
		if (id.startsWith("@/") || id.startsWith(".")) throw Error("Unmocked dependency: " + id);
		return require(id);
	}, module, module.exports);
	return module.exports;
}
const bookData = json("src/data/books.json");
const books = load("src/lib/bible/books.ts", { "@/data/books.json": bookData, "@/data/book-names.json": json("src/data/book-names.json") });
const foundation = load("src/utils/systemPrompt.ts");
const markdown = load("src/lib/markdown.ts", { "./note-plain-text.mjs": notePlainText });
const rules = load("src/lib/reading-overview-rules.ts");
const chapters = new Map();
const john316 = json("src/data/kjv/43-john.json")[2][15];
function currentRuntime({ sourceFailure = false, reviewResponse = null, repairResponse = null } = {}) {
	const calls = [];
	const translations = { isTranslationId: value => ["KJV", "NKJV", "BSB", "ASV", "RV1909", "LUT1912"].includes(value), getChapter: async (translation, order, chapter) => {
		assert.equal(translation, "KJV"); if (sourceFailure) throw Error("Canonical source unavailable");
		if (!chapters.has(order)) chapters.set(order, json("src/data/kjv/" + bookData.find(book => book.order === order).file));
		return chapters.get(order)[chapter - 1];
	} };
	const verifier = load("src/lib/ai/scripture-verification.ts", { "@/lib/bible/books": books, "@/lib/bible/translations": translations,
		"@/utils/assistantMarkdown": { normalizeAssistantMarkdown },
		"./markdown-underscore-guard": { analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore },
		"@/lib/bible/bsb": { loadBsbChapter: async () => { throw Error("Unexpected BSB request in KJV fixture"); } },
		"@/lib/bible/originals": { getOriginalVerse: async () => null, getOriginalVerseForKjv: async () => null } });
	const generated = load("src/lib/ai/verified-generation.ts", {
		"./turn-trace": tracing,
		"./verification-limits.mjs": verificationLimits,
		ai: { Output: { object: value => value }, generateText: async request => {
			calls.push(request); const prompt = JSON.parse(request.prompt);
			assert.ok(request.system.startsWith(foundation.doctrinalFoundation)); assert.equal("tools" in request, false);
			if (request.system.includes("Repair the supplied answer")) return { output: repairResponse ? await repairResponse(prompt) : { blocks: prompt.blocks.map(({ id, text }) => ({ id, text })) } };
			if (reviewResponse) return { output: await reviewResponse(prompt) };
			return { output: { checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: prompt.expectedCheckedOriginalSources,
				allScriptureQuotationsVerified: true, allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: true, issues: [], requiredReferences: [] } };
		} },
		"@/utils/systemPrompt": foundation, "@/lib/bible/translations": translations,
		"./scripture-verification": verifier, "./answer-gate": load("src/lib/ai/answer-gate.ts"), "./plain-dashes": load("src/lib/ai/plain-dashes.ts"),
	});
	const adapter = load("src/lib/ai/structured-prose.ts", { "./verified-generation": generated });
	const composerMocks = { ai: { Output: { object: value => value } }, "@/lib/ai/provider": {}, "@/lib/ai/structured-prose-model": {},
		"@/lib/ai/structured-prose": adapter, "@/lib/bible/translations": translations, "@/lib/prisma": { prisma: {} }, "@/lib/markdown": markdown,
		"@/utils/noteHouseStyle": load("src/utils/noteHouseStyle.ts"), "@/utils/systemPrompt": foundation };
	const composer = load("src/lib/note-composer.ts", composerMocks);
	const fields = [{ id: "note:title", read: value => value.title, write: (value, title) => ({ ...value, title }) },
		{ id: "note:markdown", read: value => value.markdown, write: (value, text) => ({ ...value, markdown: text }) }];
	const options = { fields, immutable: () => ({ target: "owned-note" }),
		validate: value => value.title.length <= 200 && value.markdown.length <= 32_000 && composer.validateComposedNote(value).ok,
		verification: { model: { fixture: true }, translation: "KJV", question: "Save my study of John 3:16", purpose: "note title and body" },
		deadlineAt: Date.now() + 150_000, persistenceReserveMs: 30_000 };
	return { verifier, adapter, composer, composerMocks, options, calls, generated };
}

test("current managed checker/generation gate expands a real KJV marker before final note validation", async () => {
	const h = currentRuntime();
	const input = { title: "My gospel study", markdown: "## What I read\n\n[[SCRIPTURE:John 3:16]]\n\n## My next step\n\nI will keep reading." };
	const final = await h.adapter.verifyStructuredProse(input, h.options);
	assert.ok(final.markdown.includes(john316)); assert.equal(h.calls.length, 1);
	assert.ok(markdown.htmlToPlainText(markdown.markdownToNoteHtml(final.markdown)).includes(john316));
});

test("actual canonical marker expansion beyond 32k is rejected without truncation", async () => {
	const h = currentRuntime(); const input = { title: "My study", markdown: "## My study\n\n" + "x".repeat(31_900) + "\n\n[[SCRIPTURE:John 3:16]]" };
	assert.ok(input.markdown.length <= 32_000);
	await assert.rejects(h.adapter.verifyStructuredProse(input, h.options));
	assert.equal(h.calls.length, 1);
});

test("actual canonical source outage cannot become a saved fallback after bounded repair", async () => {
	const h = currentRuntime({ sourceFailure: true });
	await assert.rejects(h.adapter.verifyStructuredProse({ title: "My study", markdown: "## My study\n\n[[SCRIPTURE:John 3:16]]" }, h.options));
	assert.equal(h.calls.length, 3);
});

test("current checker and composer reject intraword underscores retained by the literal renderer", async () => {
	const h = currentRuntime();
	const input = { title: "My gospel study", markdown: "## What I read\n\n> " + john316.replace("whosoever", "who_so_ever") + "\n> — John 3:16, KJV\n\n## My next step\n\nI will keep reading." };
	const mechanical = await h.verifier.verifyScriptureDraft(input.markdown, { translation: "KJV" });
	assert.equal(mechanical.ok, false, "actual new shared checker rejects the literal spelling mismatch");
	const visible = markdown.htmlToPlainText(markdown.markdownToNoteHtml(input.markdown));
	assert.match(visible, /who_so_ever/);
	assert.equal(h.composer.validateComposedNote(input).ok, false);
	await assert.rejects(h.adapter.verifyStructuredProse(input, h.options)); assert.equal(h.calls.length, 0);

});

test("reflection rejects whitespace-only verified prose", async () => {
	const gate = { verifyStructuredProse: (payload, options) => hAdapter.verifyStructuredProse(payload, options) };
	const hAdapter = load("src/lib/ai/structured-prose.ts", { "./verified-generation": { verifyGeneratedAnswer: async blocks => ({ verified: true, blocks: blocks.map(block => ({ ...block, text: "   " })) }) } });
	const mocks = { "@/lib/ai/structured-prose": gate, "@/lib/reading-overview-rules": rules };
	const after = load("src/lib/reading-reflection-verification.ts", mocks);
	const payload = { title: "Your walk", reflection: "Keep reading.", verse: null, next: null };
	const options = { verification: { model: {}, translation: "KJV", question: "Reflect on reading." }, deadlineAt: Date.now() + 120_000 };
	await assert.rejects(after.verifyReflectionContent(payload, options));
});

test("complete64k review source preserves tail evidence and actual subject; default remains16k", async () => {
  const context = "a".repeat(17_000) + "\nPRIMARY_PASSAGE_AT_TAIL John 3:16-18\nORIGINAL_INSTRUCTION: keep all three verses.";
  const blocks = [{ id: "body", text: "I will keep reading." }];
  const complete = currentRuntime();
  const result = await complete.generated.verifyGeneratedAnswer(blocks, { model: {}, translation: "KJV", question: "Original subject: the whole gospel passage", context, maxContextChars: 64_000, requireCompleteContext: true });
  assert.equal(result.verified, true);
  const prompt = JSON.parse(complete.calls[0].prompt);
  assert.equal(prompt.extraContext, context); assert.equal(prompt.question, "Original subject: the whole gospel passage");
  assert.ok(prompt.canonical.contextEvidence.some(item => item.reference === "John 3:16-18"));
  const ordinary = currentRuntime();
  assert.equal((await ordinary.generated.verifyGeneratedAnswer(blocks, { model: {}, translation: "KJV", question: "Normal route", context })).verified, true);
  assert.equal(JSON.parse(ordinary.calls[0].prompt).extraContext.length, 16_000);
});

test("complete context budget fails closed before review instead of clipping", async () => {
  for (const options of [{ context: "x".repeat(64_001), maxContextChars: 64_000 }, { context: "x", maxContextChars: 128_001 }, { question: "x".repeat(16_001) }]) {
    const h = currentRuntime();
    const result = await h.generated.verifyGeneratedAnswer([{ id: "body", text: "Draft" }], { model: {}, translation: "KJV", question: "Subject", ...options, requireCompleteContext: true });
    assert.equal(result.verified, false); assert.ok(result.issueCodes.includes("verification_context_limit")); assert.equal(h.calls.length, 0);
  }
});

test("complete serialized review request includes block escaping in its bound", async () => {
  const h = currentRuntime();
  const result = await h.generated.verifyGeneratedAnswer([{ id: "body", text: "\u0000".repeat(50_000) }], { model: {}, translation: "KJV", question: "Subject", context: "Source", maxContextChars: 64_000, requireCompleteContext: true });
  assert.equal(result.verified, false); assert.equal(h.calls.length, 0);
});

test("actual repair and second review retain required tail source; persistent omission is withheld", async () => {
  const context = "a".repeat(17_000) + "\nPRIMARY_PASSAGE_AT_TAIL John 3:16-18\nREQUIRED: preserve all three verses.";
  const inspect = prompt => { assert.equal(prompt.extraContext, context); assert.equal(prompt.question, "Original subject: preserve John 3:16-18"); };
  const h = currentRuntime({ reviewResponse: prompt => {
    inspect(prompt);
    return { checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: prompt.expectedCheckedOriginalSources,
      allScriptureQuotationsVerified: true, allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: false,
      issues: ["Required three-verse passage is missing."], requiredReferences: ["John 3:16-18"] };
  }, repairResponse: prompt => { inspect(prompt); return { blocks: prompt.blocks.map(({ id }) => ({ id, text: "I will keep reading, without the required passage." })) }; } });
  const result = await h.generated.verifyGeneratedAnswer([{ id: "body", text: "I will keep reading, without the required passage." }], { model: {}, translation: "KJV", question: "Original subject: preserve John 3:16-18", context, maxContextChars: 64_000, requireCompleteContext: true });
  assert.equal(result.verified, false); assert.equal(result.repaired, true); assert.equal(h.calls.length, 3);
});

test("actual checker plus literal render contract rejects altered reflection quotes independently of global underscore fix", async () => {
  const h = currentRuntime();
  const literal = `John 3:16 says: "${john316.replace("whosoever", "who_so_ever")}"`;
  const mechanical = await h.verifier.verifyScriptureDraft(literal, { translation: "KJV" });
  assert.equal(typeof mechanical.ok, "boolean");
  const module = load("src/lib/reading-reflection-verification.ts", { "@/lib/ai/structured-prose": h.adapter, "@/lib/reading-overview-rules": rules });
  assert.equal(module.isPlainReflectionProse(literal), false);
  await assert.rejects(module.verifyReflectionContent({ title: "Your walk", reflection: literal, verse: null, next: null }, { verification: { model: {}, translation: "KJV", question: "Reflect on reading." }, deadlineAt: Date.now() + 120_000 }));
  assert.equal(h.calls.length, 0);
  // The shared Markdown checker correctly permits paired emphasis. Reflection
  // renders those bytes literally, so its independent plain-field policy must
  // reject the same formatted words even with the new underscore fix present.
  const boldLiteral = `John 3:16 says: "${john316.replace("whosoever", "**whosoever**")}"`;
  assert.equal((await h.verifier.verifyScriptureDraft(boldLiteral, { translation: "KJV" })).ok, true);
  assert.equal(module.isPlainReflectionProse(boldLiteral), false);
  await assert.rejects(module.verifyReflectionContent({ title: "Your walk", reflection: boldLiteral, verse: null, next: null }, { verification: { model: {}, translation: "KJV", question: "Reflect on reading." }, deadlineAt: Date.now() + 120_000 }));
  assert.equal(h.calls.length, 0);
  for (const path of ["src/components/bible/WalkCard.tsx", "mobile/src/features/reading/WalkCard.tsx"]) {
    const render = readFileSync(filename(path), "utf8");
    for (const field of ["title", "reflection", "verse.note", "next.reason"]) assert.ok(render.includes(`{state.reflection.${field}}`));
  }
  const canonical = `John 3:16 says: "${john316}"`;
  const result = await module.verifyReflectionContent({ title: "Your walk", reflection: canonical, verse: { book: 43, bookName: "John", chapter: 3, verse: 16, text: john316, note: null }, next: null }, { verification: { model: {}, translation: "KJV", question: "Reflect on reading." }, deadlineAt: Date.now() + 120_000 });
  assert.equal(result.reflection, canonical); assert.equal(result.verse.text, john316);
});

test("actual study-context captures source revisions from the exact owned selected rows", async () => {
  const revisions = load("src/lib/study-source-revisions.ts");
  const note = { id: "owned-note", title: "My study", plainText: "Private selected note before correction." };
  const memory = { id: "owned-memory", category: "fact", content: "Private selected memory before correction." };
  const module = load("src/lib/study-context.ts", {
    "@/lib/study-source-revisions": revisions,
    "@/lib/reading-log": { recentReadingChapters: async () => [] },
    "@/lib/church": { loadUserChurch: async () => null },
    "@/lib/memory": { loadUserMemories: async userId => { assert.equal(userId, "alice"); return [memory]; } },
    "@/lib/prisma": { prisma: {
      message: { findMany: async () => [] }, verseOfDay: { findMany: async () => [] },
      note: { findMany: async ({ where, select }) => { assert.equal(where.userId, "alice"); assert.deepEqual(select, { id: true, title: true, plainText: true }); return [note]; } },
    } },
    "@/lib/quiz": { recentQuizMisses: async () => [] }, "@/lib/reading-plans": { getTodayPlanReading: async () => null },
    "@/lib/study-context-format": load("src/lib/study-context-format.ts"),
  });
  const context = await module.loadStudyContext("alice");
  assert.ok(context.notesBlock.includes(note.plainText)); assert.ok(context.memoriesBlock.includes(memory.content));
  assert.equal(context.sourceRevisions.notes[0].revision, revisions.noteSourceRevision(note));
  assert.equal(context.sourceRevisions.memories[0].revision, revisions.memorySourceRevision(memory));
  note.plainText = "Corrected private note"; memory.content = "Corrected private memory";
  assert.notEqual(context.sourceRevisions.notes[0].revision, revisions.noteSourceRevision(note));
  assert.notEqual(context.sourceRevisions.memories[0].revision, revisions.memorySourceRevision(memory));
});
