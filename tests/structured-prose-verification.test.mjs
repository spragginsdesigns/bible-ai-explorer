import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const candidate = fileURLToPath(new URL("../", import.meta.url));
const root = existsSync(path.join(candidate, "src/data/books.json")) ? candidate : JSON.parse(readFileSync(path.join(candidate, "manifest.json"), "utf8")).applicationRoot;
const filename = relative => path.join(existsSync(path.join(candidate, relative)) ? candidate : root, relative);
function load(relative, mocks = {}) {
	const source = ts.transpileModule(readFileSync(filename(relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
	const module = { exports: {} };
	new Function("require", "module", "exports", source)(id => {
		if (id in mocks) return mocks[id];
		if (id === "server-only") return {};
		if (id.startsWith("@/") || id.startsWith(".")) throw Error("Unmocked dependency: " + id);
		return require(id);
	}, module, module.exports);
	return module.exports;
}
const defaultGate = async blocks => ({ blocks, verified: true, repaired: false, issueCodes: [] });
const structured = responder => load("src/lib/ai/structured-prose.ts", { "./verified-generation": { verifyGeneratedAnswer: responder ?? defaultGate } });
const simple = module => ({ fields: [{ id: "body", read: value => value.body, write: (value, body) => ({ ...value, body }) }],
	immutable: value => ({ id: value.id }), validate: value => typeof value.body === "string" && value.body.length > 0 && value.body.length <= 20,
	verification: { model: {}, translation: "KJV", question: "The requested note", purpose: "note" }, deadlineAt: Date.now() + 120_000, persistenceReserveMs: 30_000 });

test("one verification receives every field with stable IDs and shared model identity", async () => {
	let calls = 0;
	const model = { fixture: true };
	const module = structured(async (blocks, options) => { calls++; assert.equal(options.model, model); assert.deepEqual(blocks.map(block => block.id), ["body", "title"]); return defaultGate(blocks); });
	const options = simple(module); options.verification.model = model;
	options.fields.push({ id: "title", read: value => value.title, write: (value, title) => ({ ...value, title }) });
	const output = await module.verifyStructuredProse({ id: "owned", body: "Checked prose", title: "My study" }, options);
	assert.equal(output.body, "Checked prose"); assert.equal(calls, 1);
});

test("withheld fallback is rejected even when its length and shape would fit", async () => {
	const module = structured(async blocks => ({ verified: false, blocks: blocks.map(block => ({ ...block, text: "Try again" })) }));
	await assert.rejects(module.verifyStructuredProse({ id: "owned", body: "Draft" }, simple(module)));
});

test("repair expansion beyond a final field bound rejects instead of trimming", async () => {
	const module = structured(async blocks => ({ verified: true, blocks: blocks.map(block => ({ ...block, text: "x".repeat(21) })) }));
	await assert.rejects(module.verifyStructuredProse({ id: "owned", body: "[[SCRIPTURE:John 3:16]]".slice(0, 20) }, simple(module)));
});

test("repair cannot change block identities, order, count or immutable coordinates", async () => {
	for (const rewrite of [blocks => [], blocks => [{ ...blocks[0], id: "other" }], blocks => [blocks[0], blocks[0]]]) {
		const module = structured(async blocks => ({ verified: true, blocks: rewrite(blocks) }));
		await assert.rejects(module.verifyStructuredProse({ id: "owned", body: "Draft" }, simple(module)));
	}
	const module = structured(); const options = simple(module);
	options.fields[0].write = (value, body) => ({ ...value, id: "different", body });
	await assert.rejects(module.verifyStructuredProse({ id: "owned", body: "Draft" }, options));
});

test("absolute time preserves write margin and refuses subsecond verifier rounding", () => {
	const module = structured();
	assert.equal(module.remainingProseTime(150_000, 75_000, 30_000, 45_000), 75_000);
	assert.equal(module.remainingProseTime(150_000, 75_000, 30_000, 100_000), 20_000);
	assert.throws(() => module.remainingProseTime(150_000, 75_000, 30_000, 119_001));
});

test("a late positive provider result cannot spend reserved write time", async () => {
	const realNow = Date.now; let now = 1_000;
	Date.now = () => now;
	try {
		const module = structured(async blocks => { now = 91_001; return defaultGate(blocks); });
		const options = simple(module); options.deadlineAt = 121_000;
		await assert.rejects(module.verifyStructuredProse({ id: "owned", body: "Draft" }, options));
	} finally { Date.now = realNow; }
});

test("a canonical source or provider exception never returns saveable prose", async () => {
	const module = structured(async () => { throw Error("source unavailable"); });
	await assert.rejects(module.verifyStructuredProse({ id: "owned", body: "Draft" }, simple(module)));
});

const rules = load("src/lib/reading-overview-rules.ts");
const reflectionVerifier = responder => load("src/lib/reading-reflection-verification.ts", {
	"@/lib/ai/structured-prose": structured(responder), "@/lib/reading-overview-rules": rules,
});
const revisions = load("src/lib/study-source-revisions.ts");
const sourceSnapshot = (module, sources, memoryAllowed = true, notes = [], memories = []) => module.bindReflectionSources(sources, { notes: notes.map(note => ({ id: note.id, revision: revisions.noteSourceRevision(note) })), memories: memories.map(memory => ({ id: memory.id, revision: revisions.memorySourceRevision(memory) })) }, memoryAllowed);
const reflection = () => ({ title: "My week in John", reflection: "I can return to what I read.",
	verse: { book: 43, bookName: "John", chapter: 3, verse: 16, text: "Canonical verse text.", note: "I can remember this verse." },
	next: { book: 43, bookName: "John", chapter: 4, reason: "Continue the next chapter." } });
const verification = { model: {}, translation: "KJV", question: "Your walk", purpose: "reading reflection" };

test("reflection maps at most four prose fields and preserves canonical text and next coordinates", async () => {
	const module = reflectionVerifier(async blocks => { assert.deepEqual(blocks.map(block => block.id), ["walk:title", "walk:reflection", "walk:verse-note", "walk:next-reason"]); return { verified: true, blocks: blocks.map(block => ({ ...block, text: "Checked words." })) }; });
	const input = reflection(); const result = await module.verifyReflectionContent(input, { verification, deadlineAt: Date.now() + 120_000 });
	assert.equal(result.verse.text, input.verse.text); assert.equal(result.verse.verse, 16); assert.equal(result.next.chapter, 4);
	assert.equal(result.reflection, "Checked words.");
});

for (const [field, limit] of [["walk:title", 60], ["walk:reflection", 700], ["walk:verse-note", 220], ["walk:next-reason", 220]]) {
	test("post-repair reflection rejects overlength " + field, async () => {
		const module = reflectionVerifier(async blocks => ({ verified: true, blocks: blocks.map(block => block.id === field ? { ...block, text: "x".repeat(limit + 1) } : block) }));
		await assert.rejects(module.verifyReflectionContent(reflection(), { verification, deadlineAt: Date.now() + 120_000 }));
	});
}

test("reflection certificate rejects legacy, changed fields/sources/basis and wrong version", () => {
	const module = reflectionVerifier(); const sources = sourceSnapshot(module, { memories: ["m:hash"], notes: ["n"] }, true, [{ id: "n", title: "Note", plainText: "Source" }], [{ id: "m", category: "fact", content: "Source" }]);
	const certified = module.certifyReflection(reflection(), sources, "reading-basis");
	assert.ok(module.parseVerifiedReflection(JSON.stringify(certified), "reading-basis"));
	assert.equal(module.parseVerifiedReflection(JSON.stringify({ reflection: reflection(), sources }), "reading-basis"), null);
	for (const change of [value => { value.reflection.title += "!"; }, value => { value.sources.notes = []; }, value => { value.reflection.verse.text = "Forged"; }, value => { value.verification.version = 0; }]) {
		const altered = structuredClone(certified); change(altered);
		assert.equal(module.parseVerifiedReflection(JSON.stringify(altered), "reading-basis"), null);
	}
	assert.equal(module.parseVerifiedReflection(JSON.stringify(certified), "other-reading-basis"), null);
});

function modelAudit(registry) {
	return load("src/lib/ai/structured-prose-model.ts", { "./models": { resolveDefinition: id => registry[id], NO_RUN_OPTIONS: {}, buildProviderOptions: (provider, run, _files, definition) => ({ [provider]: { effort: run.effort, actualHead: definition.providerModelId } }) } });
}
const definition = (head, pricing = { input: 0.2, output: 1.2 }) => ({ id: "openai/" + head, provider: "openai", providerModelId: head, pricing });

test("utility review follows actual 5.6 runtime head when house and foreground definitions point to 6", () => {
	const actual = { provider: "openai.responses", modelId: "gpt-5.6-luna" };
	const module = modelAudit({ "openai/gpt-5.6-luna": definition("gpt-5.6-luna"), "openai/gpt-6-luna": definition("gpt-6-luna", { input: 0.1, output: 0.5 }) });
	const job = module.checkedStructuredProseModel({ model: actual, definition: definition("gpt-6-luna"), effort: "low", access: "house", providerOptions: {} }, true);
	assert.equal(job.model, actual); assert.equal(job.definition.providerModelId, "gpt-5.6-luna");
	assert.deepEqual(job.definition.pricing, { input: 0.2, output: 1.2 });
});

test("foreground composer retains its actual selected head/options and rejects mismatched definitions", () => {
	const actual = { provider: "openai.responses", modelId: "gpt-6-luna" }; const providerOptions = { openai: { reasoningEffort: "high" } };
	const module = modelAudit({}); const resolved = { model: actual, definition: definition("gpt-6-luna", { input: 0.1, output: 0.5 }), access: "house", providerOptions };
	const job = module.checkedStructuredProseModel(resolved, false);
	assert.equal(job.model, actual); assert.equal(job.providerOptions, providerOptions);
	assert.throws(() => module.checkedStructuredProseModel({ ...resolved, definition: definition("gpt-5.6-luna") }, false));
});

test("utility audit rejects missing pricing or drift from the retained meter", () => {
	for (const pricing of [null, { input: 1, output: 2 }]) {
		const module = modelAudit({ "openai/gpt-5.6-luna": definition("gpt-5.6-luna", pricing) });
		assert.throws(() => module.checkedStructuredProseModel({ model: { provider: "openai.responses", modelId: "gpt-5.6-luna" }, access: "house", effort: "low" }, true));
	}
});

function routeHarness(result) {
	const writes = [];
	const module = load("src/app/api/notes/append/route.ts", {
		"next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
		"@/lib/auth": { getAuthUser: async () => "alice" },
		"@/lib/note-composer": { COMPOSE_WORKFLOW_MS: 150_000, composeNoteFromAnswer: async () => result },
		"@/lib/notes-io": { appendMarkdownToNote: async options => { writes.push(options); return { noteId: "note", noteTitle: "Study", created: false }; } },
		"@/lib/billing/usage": { withIncludedAiRequest: handler => handler },
	});
	return { writes, request: body => module.POST(new Request("https://fixture.invalid/api/notes/append", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })) };
}

test("AI composition failure cannot fall through to any append write", async () => {
	const h = routeHarness({ composed: false, reason: "verification" });
	assert.equal((await h.request({ markdown: "unchecked suffix", noteId: "target" })).status, 503);
	assert.equal(h.writes.length, 0);
});

test("explicit compose:false saves exact user bytes and reports composed:false", async () => {
	const h = routeHarness({ composed: false, reason: "verification" }); const markdown = "The user's own words.";
	const response = await h.request({ markdown, noteId: "target", compose: false });
	assert.equal(response.status, 200); assert.equal((await response.json()).composed, false);
	assert.equal(h.writes[0].markdown, markdown); assert.equal(h.writes[0].userId, "alice");
});

test("oversized checked or verbatim markdown is rejected before the silently slicing layer", async () => {
	const h = routeHarness({ composed: true, provenance: "verified-ai", markdown: "x".repeat(32_001), title: "Study" });
	assert.equal((await h.request({ markdown: "input" })).status, 400);
	assert.equal((await h.request({ markdown: "x".repeat(32_001), compose: false })).status, 400);
	assert.equal(h.writes.length, 0);
});

test("successful checked markdown reaches persistence once with exactly its final bytes", async () => {
	const markdown = "## What I learned\n\nChecked final words.";
	const h = routeHarness({ composed: true, provenance: "verified-ai", markdown, title: "My study" });
	assert.equal((await h.request({ markdown: "unchecked original" })).status, 200);
	assert.equal(h.writes.length, 1); assert.equal(h.writes[0].markdown, markdown); assert.equal(h.writes[0].maxLength, 32_000);
});

test("server/client workflow budgets agree without changing shared default timeouts", () => {
	const text = relative => readFileSync(filename(relative), "utf8");
	assert.match(text("src/app/api/notes/append/route.ts"), /maxDuration = 180/);
	assert.match(text("src/app/api/reading-log/reflection/route.ts"), /maxDuration = 150/);
	assert.match(text("src/components/AddToNoteDialog.tsx"), /AbortSignal\.timeout\(180_000\)/);
	assert.match(text("src/components/bible/WalkCard.tsx"), /REFLECTION_TIMEOUT_MS = 150_000/);
	assert.match(text("mobile/src/features/chat/addToNote.ts"), /timeoutMs: 180_000/);
	assert.match(text("mobile/src/features/reading/WalkCard.tsx"), /timeoutMs: 150_000/);
	assert.match(text("macos/Shared/Chat/AddToNote.swift"), /timeout: 180/);
	assert.match(text("macos/Shared/Bible/ReadingJournal.swift"), /reflectionTimeout: TimeInterval = 150/);
});

function walkHarness({ cache = null, ageMs = 0, consent = true, memoryEnabled = true, cacheMemoryEnabled = memoryEnabled, changedReading = false, sourcesPresent = true, failReview = false, failGeneration = false, revokeConsentAfterReview = false, disableMemoryAfterReview = false, deleteSourceAfterReview = false, editNoteAfterReview = false, editCachedNote = false, editMemoryAfterReview = false, editCachedMemory = false } = {}) {
	const now = new Date("2026-10-29T12:00:00Z");
	const totals = { chapterReadings: 1, partialReadings: 0, sessions: 1, lastReadAt: now };
	const basis = rules.reflectionBasis(changedReading ? { ...totals, chapterReadings: 2 } : totals, cacheMemoryEnabled);
	const cert = reflectionVerifier();
	const selectedNotes = editNoteAfterReview || editCachedNote ? [{ id: "selected-note", title: "Owned study", plainText: "Private source before correction." }] : deleteSourceAfterReview || !sourcesPresent ? [{ id: "deleted-note", title: "Owned study", plainText: "Source before deletion." }] : [];
	const selectedMemories = editMemoryAfterReview || editCachedMemory ? [{ id: "selected-memory", category: "fact", content: "Original private memory" }] : [];
	const sourceIds = { memories: selectedMemories.map(memory => memory.id + ":" + memory.content), notes: selectedNotes.map(note => note.id) };
	const sources = sourceSnapshot(cert, sourceIds, cacheMemoryEnabled, selectedNotes, selectedMemories);
	const row = cache === null ? null : { userId: "alice", basis, createdAt: new Date(now.getTime() - ageMs), content: JSON.stringify(cache === "legacy" ? { reflection: reflection(), sources } : cert.certifyReflection(reflection(), sources, basis)) };
	let reviewFinished = false;
	const writes = []; const deletes = []; const resolutions = []; const reviews = []; const model = { provider: "openai.responses", modelId: "gpt-5.6-luna" };
	const prisma = {
		user: { findUnique: async () => ({ memoryEnabled: reviewFinished && disableMemoryAfterReview ? false : memoryEnabled, consent: !(reviewFinished && revokeConsentAfterReview) && consent }) }, readingLogTotals: { findUnique: async () => totals },
		readingReflection: { findUnique: async () => row, deleteMany: async options => { deletes.push(options); }, upsert: async options => { writes.push(options); return { createdAt: now }; } },
		readingLogEntry: { findMany: async () => [], findFirst: async () => null },
		userMemory: { findMany: async ({ where }) => { assert.equal(where.userId, "alice"); return selectedMemories.map(memory => ({ ...memory, content: editCachedMemory || (reviewFinished && editMemoryAfterReview) ? "Corrected memory" : memory.content })); } },
		note: { findMany: async ({ where, select }) => { assert.equal(where.userId, "alice"); assert.deepEqual(select, { id: true, title: true, plainText: true }); return !sourcesPresent || (deleteSourceAfterReview && reviewFinished) ? [] : selectedNotes.map(note => ({ ...note, plainText: editCachedNote || (reviewFinished && editNoteAfterReview) ? "Corrected note" : note.plainText })); } },
	};
	const book = { order: 43, name: "John", chapters: 21 };
	const module = load("src/lib/reading-reflection.ts", {
		ai: { Output: { object: value => value }, generateText: async options => { assert.equal(options.model, model); if (failGeneration) throw Error("offline"); return { output: { title: "My week in John", reflection: "I can return to what I read.", verse: { book: "John", chapter: 3, verse: 16 }, verseNote: "I can remember this verse.", next: { book: "John", chapter: 4, reason: "Continue the next chapter." } } }; } },
		"@/lib/ai/provider": { resolveModel: async options => { resolutions.push(options); return { model, providerOptions: {} }; } },
		"@/lib/ai/structured-prose-model": { checkedStructuredProseModel: (value, utility) => { assert.equal(utility, true); return value; } },
		"@/lib/ai/structured-prose": structured(),
		"@/lib/reading-reflection-verification": { ...cert, verifyReflectionContent: async (payload, options) => { reviews.push(options); assert.equal(options.verification.model, model); if (failReview) throw Error("withheld"); reviewFinished = true; return payload; } },
		"@/lib/ai/plain-dashes": { stripDashes: value => value.replace(/[—–]/g, "-") },
		"@/lib/bible/books": { BOOKS: [book], bookByOrder: order => order === 43 ? book : null },
		"@/lib/memory-policy": { allowsMemoryUse: enabled => enabled !== false },
		"@/lib/prisma": { prisma }, "@/lib/preferences-contract": { hasCurrentAiConsent: user => user?.consent === true },
		"@/lib/reading-history": { localDayKey: () => "2026-10-29", shiftDayKey: () => "2026-10-15" },
		"@/lib/reading-overview": { getReadingOverview: async () => ({ totals: { chaptersComplete: 1, totalChapters: 1189, booksStarted: 1, activeDays: 1 }, streak: { current: 1, longest: 1, atRisk: false }, books: [] }) },
		"@/lib/reading-overview-rules": rules,
		"@/lib/study-source-revisions": revisions,
		"@/lib/study-context": { loadStudyContext: async () => ({ sources: sourceIds, sourceRevisions: sources.revisions, planBlock: "None", quizBlock: "None", questionsBlock: "None", notesBlock: "None", memoriesBlock: "None", churchBlock: "None" }), memorySourceKey: (id, content) => id + ":" + content },
		"@/utils/kjvBible": { getKjvBookNumber: name => name === "John" ? 43 : undefined, getKjvVerseText: async () => "Canonical verse text." },
		"@/utils/systemPrompt": { doctrinalFoundation: "UNCHANGED", interpretationGuidance: "UNCHANGED", trustedContextGuidance: "UNCHANGED" },
	});
	return { module, now, row, writes, deletes, resolutions, reviews, load: () => module.getReadingReflection("alice", "UTC", now) };
}

test("only a certified reusable reflection can bypass generation", async () => {
	const h = walkHarness({ cache: "verified", ageMs: 60_000 });
	assert.equal((await h.load()).status, "ready");
	assert.equal(h.resolutions.length, 0); assert.equal(h.writes.length, 0);
});

test("unchecked legacy rows are never consent or generation-failure fallbacks", async () => {
	for (const consent of [false, true]) {
		const h = walkHarness({ cache: "legacy", consent, failGeneration: true });
		assert.equal((await h.load()).status, consent ? "unavailable" : "consent-required");
		assert.equal(h.writes.length, 0); assert.equal(h.deletes.length, 1);
	}
});

test("stale certified rows do not become outage or backoff fallbacks", async () => {
	const h = walkHarness({ cache: "verified", ageMs: rules.REFLECTION_MAX_AGE_MS + 1, failGeneration: true });
	assert.equal((await h.load()).status, "unavailable");
	assert.equal((await h.load()).status, "unavailable");
	assert.equal(h.resolutions.length, 1, "failure backoff does not retry or expose stale content");
	assert.equal(h.writes.length, 0);
});

test("deleted source dependencies retire even a certified fresh cache", async () => {
	const h = walkHarness({ cache: "verified", consent: false, sourcesPresent: false });
	assert.equal((await h.load()).status, "consent-required");
	assert.equal(h.deletes.length, 1); assert.equal(h.writes.length, 0);
});

test("failed reflection review cannot create or replace a cached row", async () => {
	const h = walkHarness({ failReview: true });
	assert.equal((await h.load()).status, "unavailable");
	assert.equal(h.reviews.length, 1); assert.equal(h.writes.length, 0);
	assert.deepEqual(h.resolutions, [{ userId: "alice", utility: true }]);
});

test("successful reflection uses one utility model and writes a digest only after checking", async () => {
	const h = walkHarness();
	assert.equal((await h.load()).status, "ready");
	assert.equal(h.resolutions.length, 1); assert.equal(h.reviews.length, 1); assert.equal(h.writes.length, 1);
	const payload = JSON.parse(h.writes[0].create.content);
	assert.equal(payload.verification.version, 2);
	assert.ok(reflectionVerifier().parseVerifiedReflection(h.writes[0].create.content, h.writes[0].create.basis));
});

const goodNote = { title: "My study", markdown: "## I can trust Scripture\n\nI can return to what I read.\n\n## I can keep studying\n\nI need to read in context.\n\n## What I will do next\n\nI will return to this chapter." };
function composeHarness(responder = defaultGate, { noteId = undefined, ownedNote = null, translation = "KJV", transcript = [], generateHook = null } = {}) {
	const resolutions = []; const gateCalls = []; const actualModel = { provider: "openai.responses", modelId: "gpt-6-luna" };
	const helper = structured(async (blocks, options) => { gateCalls.push({ blocks, options }); assert.equal(options.model, actualModel); return responder(blocks, options); });
	const module = load("src/lib/note-composer.ts", {
		ai: { Output: { object: value => value }, generateText: async options => { assert.equal(options.model, actualModel); if (generateHook) await generateHook(options); return { output: goodNote }; } },
		"@/lib/ai/provider": { resolveModel: async options => { resolutions.push(options); return { model: actualModel, providerOptions: {}, definition: definition("gpt-6-luna", { input: 0.1, output: 0.5 }), access: "house" }; } },
		"@/lib/ai/structured-prose-model": modelAudit({}), "@/lib/ai/structured-prose": helper,
		"@/lib/bible/translations": { isTranslationId: value => ["KJV", "BSB"].includes(value) },
		"@/lib/prisma": { prisma: { message: { findMany: async ({ where }) => where.role === "assistant" ? [] : transcript }, note: { findFirst: async ({ where }) => { assert.equal(where.userId, "alice"); return ownedNote; } }, user: { findUnique: async () => ({ name: null, translation }) } } },
		"@/lib/markdown": { htmlToPlainText: text => text }, "@/utils/noteHouseStyle": { NOTE_HOUSE_STYLE: "UNCHANGED STYLE" }, "@/utils/systemPrompt": { systemPrompt: "UNCHANGED FOUNDATION" },
	});
	return { module, resolutions, gateCalls, compose: (overrides = {}) => module.composeNoteFromAnswer({ userId: "alice", markdown: "A matching prefix does not establish trust in this client's changed suffix.", noteId, ...overrides }) };
}

test("composer keeps its existing resolver options and checks selected-edition title/body with one model", async () => {
	const h = composeHarness(defaultGate, { translation: "BSB" }); const result = await h.compose();
	assert.equal(result.composed, true); assert.equal(result.provenance, "verified-ai"); assert.equal(result.markdown, goodNote.markdown);
	assert.deepEqual(h.resolutions, [{ userId: "alice", fallbackEffort: "medium", structured: true }]);
	assert.deepEqual(h.gateCalls[0].blocks.map(block => block.id), ["note:title", "note:markdown"]);
	assert.equal(h.gateCalls[0].options.translation, "BSB");
});

test("composer rejects post-repair overflow, style drift or withheld fallback without original bytes", async () => {
	for (const responder of [
		async blocks => ({ verified: false, blocks: blocks.map(block => ({ ...block, text: "Fallback" })) }),
		async blocks => ({ verified: true, blocks: blocks.map(block => block.id === "note:markdown" ? { ...block, text: "## My study\n\n" + "x".repeat(32_001) } : block) }),
		async blocks => ({ verified: true, blocks: blocks.map(block => block.id === "note:markdown" ? { ...block, text: "## My study\n\nYou need this." } : block) }),
		async blocks => ({ verified: true, blocks: blocks.map(block => block.id === "note:title" ? { ...block, text: "x".repeat(201) } : block) }),
		async blocks => ({ verified: true, blocks: blocks.map(block => block.id === "note:markdown" ? { ...block, text: goodNote.markdown + "\n<script>John 3:16</script>" } : block) }),
	]) {
		const h = composeHarness(responder); const result = await h.compose();
		assert.equal(result.composed, false); assert.equal("markdown" in result, false);
	}
});

test("composer enforces target ownership before generation and keeps an existing title immutable", async () => {
	const missing = composeHarness(defaultGate, { noteId: "not-owned" });
	assert.deepEqual(await missing.compose(), { composed: false, reason: "not-found" });
	assert.equal(missing.resolutions.length, 0);
	const existing = composeHarness(defaultGate, { noteId: "owned", ownedNote: { title: "My existing title", htmlContent: "Existing body", plainText: "Existing body" } });
	const result = await existing.compose(); assert.equal(result.composed, true); assert.equal(result.title, undefined);
	assert.deepEqual(existing.gateCalls[0].blocks.map(block => block.id), ["note:markdown"]);
});

test("memory off invalidates a certificate whose original basis allowed memory", async () => {
	const h = walkHarness({ cache: "verified", consent: false, memoryEnabled: false, cacheMemoryEnabled: true });
	assert.equal((await h.load()).status, "consent-required");
	assert.equal(h.deletes.length, 1); assert.equal(h.writes.length, 0);
});

test("new reading retains the existing three-hour minimum rewrite rule, then refuses stale fallback", async () => {
	const young = walkHarness({ cache: "verified", changedReading: true, ageMs: rules.REFLECTION_MIN_REWRITE_MS - 1, failGeneration: true });
	assert.equal((await young.load()).status, "ready"); assert.equal(young.resolutions.length, 0);
	const old = walkHarness({ cache: "verified", changedReading: true, ageMs: rules.REFLECTION_MIN_REWRITE_MS + 1, failGeneration: true });
	assert.equal((await old.load()).status, "unavailable"); assert.equal(old.writes.length, 0);
});

test("AI final markdown excludes render-hidden definitions and interpreted HTML entities", () => {
	const h = composeHarness();
	for (const addition of ["<script>hidden</script>", "![hidden Scripture](https://fixture.invalid/p.png)", "[hidden]: John 3:16", "&not;"]) {
		assert.equal(h.module.validateComposedNote({ ...goodNote, markdown: goodNote.markdown + "\n\n" + addition }).ok, false);
	}
});

for (const field of ["walk:title", "walk:reflection", "walk:verse-note", "walk:next-reason"]) {
	test("post-repair reflection rejects whitespace-only " + field, async () => {
		const module = reflectionVerifier(async blocks => ({ verified: true, blocks: blocks.map(block => block.id === field ? { ...block, text: " \n\t " } : block) }));
		await assert.rejects(module.verifyReflectionContent(reflection(), { verification, deadlineAt: Date.now() + 120_000 }));
	});
}

test("reflection consent revoked during checking cannot reach cache or response", async () => {
	const h = walkHarness({ revokeConsentAfterReview: true });
	assert.equal((await h.load()).status, "consent-required"); assert.equal(h.reviews.length, 1); assert.equal(h.writes.length, 0);
});

test("memory disabled during checking cannot persist the earlier private context", async () => {
	const h = walkHarness({ disableMemoryAfterReview: true });
	assert.equal((await h.load()).status, "unavailable"); assert.equal(h.writes.length, 0);
});

test("a note source deleted during checking cannot receive a fresh cache certificate", async () => {
	const h = walkHarness({ deleteSourceAfterReview: true });
	assert.equal((await h.load()).status, "unavailable"); assert.equal(h.reviews.length, 1); assert.equal(h.writes.length, 0);
});

for (const [when, flags] of [
  ["during review", { editNoteAfterReview: true }],
  ["behind a fresh cache", { cache: "verified", consent: false, editCachedNote: true }],
  ["memory during review", { editMemoryAfterReview: true }],
  ["memory behind a fresh cache", { cache: "verified", consent: false, editCachedMemory: true }],
]) test("owned source revision change " + when + " cannot reuse or persist earlier private prose", async () => {
  const h = walkHarness(flags);
  assert.equal((await h.load()).status, flags.consent === false ? "consent-required" : "unavailable");
  assert.equal(h.writes.length, 0);
  if (flags.cache) assert.equal(h.deletes.length, 1);
});

test("version1 id-only certificates and unbound or policy-inconsistent snapshots fail closed", () => {
  const module = reflectionVerifier();
  const sources = sourceSnapshot(module, { memories: [], notes: [] });
  const current = module.certifyReflection(reflection(), sources, "basis");
  const legacy = structuredClone(current); legacy.verification.version = 1;
  assert.equal(module.parseVerifiedReflection(JSON.stringify(legacy), "basis"), null);
  assert.throws(() => module.bindReflectionSources({ notes: ["n"], memories: [] }, { notes: [], memories: [] }, true));
  assert.throws(() => sourceSnapshot(module, { memories: ["m:old"], notes: [] }, false, [], [{ id: "m", content: "old", category: "fact" }]));
  const policy = structuredClone(current); policy.sources.memoryAllowed = false;
  assert.equal(module.parseVerifiedReflection(JSON.stringify(policy), "basis"), null);
});

for (const field of ["walk:title", "walk:reflection", "walk:verse-note", "walk:next-reason"]) {
  test("literal reflection field rejects format constructs before and after repair: " + field, async () => {
    for (const text of ["who_so_ever", "**hidden**", "`literal`", "<b>words</b>", "&amp;", "[link](https://fixture.invalid)", "# heading", "> quote", "~~strike~~", "＊hidden＊", "<\u200bspan>words</span>"]) {
      let called = 0;
      const module = reflectionVerifier(async blocks => { called++; return { verified: true, blocks: blocks.map(block => block.id === field ? { ...block, text } : block) }; });
      await assert.rejects(module.verifyReflectionContent(reflection(), { verification, deadlineAt: Date.now() + 120_000 }));
      assert.equal(called, 1, "post-repair content is rejected without a second normalization");
      const input = reflection();
      if (field === "walk:title") input.title = text;
      if (field === "walk:reflection") input.reflection = text;
      if (field === "walk:verse-note") input.verse.note = text;
      if (field === "walk:next-reason") input.next.reason = text;
      called = 0;
      await assert.rejects(module.verifyReflectionContent(input, { verification, deadlineAt: Date.now() + 120_000 }));
      assert.equal(called, 0, "literal format mismatch is rejected before review");
    }
  });
}

test("ordinary literal prose and canonical fixed verse survive without normalization", async () => {
  const input = reflection(); input.reflection = "God's Word guides me; I can read John 3:16 in context (again).";
  const result = await reflectionVerifier().verifyReflectionContent(input, { verification, deadlineAt: Date.now() + 120_000 });
  assert.deepEqual(result, input);
});

test("composer passes the entire32k source, original subject and tail instructions to complete review", async () => {
  const answer = "a".repeat(31_950) + "\nPRIMARY_PASSAGE_AT_TAIL John 3:16-18";
  assert.ok(answer.length <= 32_000);
  const transcript = [{ role: "user", content: "ORIGINAL_SUBJECT: keep the full three-verse passage." }, { role: "assistant", content: "c".repeat(17_000) + "TAIL_INSTRUCTION: keep all three." }];
  const h = composeHarness(defaultGate, { transcript });
  assert.equal((await h.compose({ markdown: answer, conversationId: "owned" })).composed, true);
  const options = h.gateCalls[0].options;
  assert.equal(options.maxContextChars, 64_000); assert.equal(options.requireCompleteContext, true);
  assert.equal(options.question, transcript[0].content);
  assert.ok(options.context.includes(answer)); assert.ok(options.context.includes("TAIL_INSTRUCTION"));
  assert.ok(options.context.indexOf("PRIMARY_PASSAGE_AT_TAIL") > 16_000);
});

test("composer refuses oversized required conversation or existing-note source before generation", async () => {
  for (const options of [
    { transcript: [{ role: "user", content: "x".repeat(24_001) }] },
    { noteId: "owned", ownedNote: { title: "Existing", htmlContent: "x".repeat(8_001), plainText: "x".repeat(8_001) } },
  ]) {
    const h = composeHarness(defaultGate, options);
    assert.equal((await h.compose({ conversationId: "owned" })).composed, false);
    assert.equal(h.resolutions.length, 0); assert.equal(h.gateCalls.length, 0);
  }
});

test("request cancellation propagates to generation and leaves no saveable composer fields", async () => {
  const controller = new AbortController();
  const h = composeHarness(defaultGate, { generateHook: async options => { controller.abort(); assert.equal(options.abortSignal.aborted, true); options.abortSignal.throwIfAborted(); } });
  const result = await h.compose({ signal: controller.signal });
  assert.equal(result.composed, false); assert.equal("markdown" in result, false); assert.equal(h.gateCalls.length, 0);
});

test("append checks an abort after a long verified compose before entering persistence", async () => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const writes = []; let signal;
  const route = load("src/app/api/notes/append/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth": { getAuthUser: async () => "alice" },
    "@/lib/note-composer": { COMPOSE_WORKFLOW_MS: 150_000, composeNoteFromAnswer: async options => { signal = options.signal; entered(); await blocked; return { composed: true, provenance: "verified-ai", ...goodNote }; } },
    "@/lib/notes-io": { appendMarkdownToNote: async options => { writes.push(options); return { noteId: "n", noteTitle: "Study", created: false }; } },
    "@/lib/billing/usage": { withIncludedAiRequest: handler => handler },
  });
  const controller = new AbortController();
  const request = new Request("https://fixture.invalid/api/notes/append", { method: "POST", signal: controller.signal, body: JSON.stringify({ markdown: "Input", noteId: "n" }) });
  const response = route.POST(request); await started; controller.abort(); release();
  assert.equal((await response).status, 499); assert.equal(signal.aborted, true); assert.equal(writes.length, 0);
});

test("memory policy itself is bound even when no selected memories existed", async () => {
  const h = walkHarness({ cache: "verified", consent: false, memoryEnabled: true, cacheMemoryEnabled: false });
  assert.equal((await h.load()).status, "consent-required"); assert.equal(h.deletes.length, 1); assert.equal(h.writes.length, 0);
});

test("already-aborted explicit user-verbatim requests cannot begin append", async () => {
  const writes = [];
  const route = load("src/app/api/notes/append/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } }, "@/lib/auth": { getAuthUser: async () => "alice" },
    "@/lib/note-composer": { COMPOSE_WORKFLOW_MS: 150_000, composeNoteFromAnswer: async () => { throw Error("must not compose user text"); } },
    "@/lib/notes-io": { appendMarkdownToNote: async options => { writes.push(options); } }, "@/lib/billing/usage": { withIncludedAiRequest: handler => handler },
  });
  const controller = new AbortController(); controller.abort();
  const response = await route.POST(new Request("https://fixture.invalid/api/notes/append", { method: "POST", signal: controller.signal, body: JSON.stringify({ markdown: "User prose", compose: false }) }));
  assert.equal(response.status, 499); assert.equal(writes.length, 0);
});

test("an exact32k saved assistant turn is represented once in complete source, never prefix-deduplicated", async () => {
  const answer = "a".repeat(31_950) + "\nPRIMARY_PASSAGE_AT_TAIL John 3:16-18";
  const h = composeHarness(defaultGate, { transcript: [{ role: "user", content: "Original subject: preserve all three verses." }, { role: "assistant", content: answer }] });
  assert.equal((await h.compose({ markdown: answer, conversationId: "owned" })).composed, true);
  const context = h.gateCalls[0].options.context;
  assert.ok(context.includes(answer)); assert.equal(context.indexOf(answer), context.lastIndexOf(answer));
  assert.match(context, /complete answer is supplied in THE ANSWER/);
  const different = composeHarness(defaultGate, { transcript: [{ role: "user", content: "Original subject." }, { role: "assistant", content: answer + "Different source tail" }] });
  assert.equal((await different.compose({ markdown: answer, conversationId: "owned" })).composed, false);
  assert.equal(different.resolutions.length, 0);
});
