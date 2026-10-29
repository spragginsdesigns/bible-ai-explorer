import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages, validateUIMessages } from "ai";
import { NextResponse } from "next/server.js";

const target = process.env.SUREWORD_TEST_DATABASE_URL;
function loadOperations(prisma) {
	const source = readFileSync(new URL("../src/lib/note-ai-operations.ts", import.meta.url), "utf8")
		.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
		.replace(/^export /gm, "");
	return new Function("prisma", "createHash", `${stripTypeScriptTypes(source)};return {reserveNoteAIOperation,claimNoteAIOperation,withNoteAIWrite,withNoteAIHistory,settleNoteAIOperation,readNoteAIOperation,cancelNoteAIOperation,noteAIRequestHash,noteAIOperationId,NoteAIOperationError};`)(prisma, createHash);
}

function loadNoteRoute(deps) {
	const source = readFileSync(new URL("../src/app/api/note-ai/route.ts", import.meta.url), "utf8")
		.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
		.replace(/^export /gm, "");
	return new Function(...Object.keys(deps), `${stripTypeScriptTypes(source)};return {POST,persistExchange};`)(...Object.values(deps));
}

function loadClearRoute(db, userId) {
	const source = readFileSync(new URL("../src/app/api/notes/[id]/ai-messages/route.ts", import.meta.url), "utf8")
		.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/^export /gm, "");
	const facade = { $transaction: db.$transaction.bind(db), note: { findFirst: args => db.note.findFirst({ ...args, select: { id: true } }) } };
	return new Function("prisma", "getAuthUser", "NextResponse", `${stripTypeScriptTypes(source)};return DELETE;`)(facade, async () => userId, NextResponse);
}

test("note operation request identity ignores key order, keeps content and context", () => {
	const { noteAIRequestHash: hash, noteAIOperationId: id } = loadOperations({});
	const body = { operationId: randomUUID(), noteId: "note", messages: [{ id: "question", parts: [{ type: "text", text: "Save this" }] }], readingTimezone: "UTC" };
	assert.equal(hash(body), hash({ readingTimezone: "UTC", messages: [{ parts: [{ text: "Save this", type: "text" }], id: "question" }], noteId: "note", operationId: randomUUID() }));
	assert.notEqual(hash(body), hash({ ...body, readingTimezone: "America/Los_Angeles" }));
	assert.notEqual(hash(body), hash({ ...body, messages: [{ id: "question", parts: [{ type: "text", text: "Something else" }] }] }));
	assert.equal(id(body.operationId.toUpperCase()), body.operationId);
	assert.throws(() => id("../another-account"));
});

// These cases need real Postgres row locks. They must never use the application
// database. A dedicated local database is required; the minimal fixture is
// created below and the operation DDL comes from the actual migration.
test("durable operations fence late note commits, retries and orphan recovery", { skip: !target, timeout: 30_000 }, async t => {
	const url = new URL(target);
	assert.equal(process.env.SUREWORD_TEST_DATABASE_ISOLATED, "yes");
	assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "This suite permits local isolated Postgres only.");
	assert.equal(url.pathname, "/sureword_operation_qa");
	const db = new PrismaClient({ datasources: { db: { url: target } } });
	const op = loadOperations(db);
	const userId = `operation-qa-${randomUUID()}`, foreignId = `operation-qa-${randomUUID()}`;
	const noteId = randomUUID(), foreignNoteId = randomUUID();
	const make = () => ({ id: randomUUID(), userId, noteId });
	const hash = op.noteAIRequestHash({ noteId, messages: [{ id: "question", role: "user", parts: [{ type: "text", text: "Public test fixture" }] }] });
	const rejected = async action => assert.rejects(action, error => [404, 409].includes(error.status));
	try {
		await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY)');
		await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "Note" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE, "title" TEXT NOT NULL, "content" TEXT NOT NULL, "htmlContent" TEXT NOT NULL, "plainText" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL)');
		const tables = await db.$queryRaw`SELECT to_regclass('public."NoteAIOperation"')::text AS name`;
		if (!tables[0].name) {
			const migration = readFileSync(new URL("../prisma/migrations/20261029170000_note_ai_operations/migration.sql", import.meta.url), "utf8");
			for (const statement of migration.split(";").map(text => text.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
		}
		await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "NoteAIMessage" ("id" TEXT PRIMARY KEY, "noteId" TEXT NOT NULL REFERENCES "Note"("id") ON DELETE CASCADE, "role" TEXT NOT NULL, "content" TEXT NOT NULL, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
		await db.$executeRaw`INSERT INTO "User" ("id") VALUES (${userId}), (${foreignId})`;
		await db.$executeRaw`INSERT INTO "Note" ("id", "userId", "title", "content", "htmlContent", "plainText", "updatedAt") VALUES (${noteId}, ${userId}, 'Public QA', '', '', 'initial', NOW()), (${foreignNoteId}, ${foreignId}, 'Public foreign QA', '', '', 'foreign', NOW())`;
		await t.test("lost reservation response is idempotent; request mismatch and duplicate execution are refused", async () => {
			const turn = make();
			assert.equal((await op.reserveNoteAIOperation(turn, hash)).state, "reserved");
			assert.equal((await op.reserveNoteAIOperation(turn, hash)).state, "reserved");
			await rejected(() => op.reserveNoteAIOperation(turn, "different"));
			await op.claimNoteAIOperation(turn, hash);
			await rejected(() => op.claimNoteAIOperation(turn, hash));
			await op.settleNoteAIOperation(turn);
			assert.equal((await op.readNoteAIOperation(turn)).state, "settled");
			await rejected(() => op.withNoteAIWrite(turn, tx => tx.$executeRaw`UPDATE "Note" SET "plainText"='late' WHERE "id"=${noteId}`));
		});
		await t.test("cancel before delayed reserve or execution leaves a durable tombstone", async () => {
			const turn = make();
			assert.equal((await op.cancelNoteAIOperation(turn)).state, "cancelled");
			assert.equal((await op.reserveNoteAIOperation(turn, hash)).state, "cancelled");
			await rejected(() => op.claimNoteAIOperation(turn, hash));
			await rejected(() => op.withNoteAIWrite(turn, async () => assert.fail("cancelled write callback ran")));
		});
		await t.test("an unreserved POST cannot run; a failed reservation can still be cancelled", async () => {
			const turn = make();
			await rejected(() => op.claimNoteAIOperation(turn, hash));
			assert.equal((await op.cancelNoteAIOperation(turn)).state, "cancelled");
		});
		await t.test("foreign owners and source notes cannot inspect, cancel, claim or write", async () => {
			const turn = make();
			await op.reserveNoteAIOperation(turn, hash);
			for (const impostor of [{ ...turn, userId: foreignId }, { ...turn, noteId: foreignNoteId }, { ...turn, userId: foreignId, noteId: foreignNoteId }]) {
				await rejected(() => op.readNoteAIOperation(impostor));
				await rejected(() => op.cancelNoteAIOperation(impostor));
				await rejected(() => op.claimNoteAIOperation(impostor, hash));
				await rejected(() => op.withNoteAIWrite(impostor, async () => assert.fail("foreign write callback ran")));
			}
			assert.equal((await op.readNoteAIOperation(turn)).state, "reserved");
		});
		await t.test("cancellation waits for an in-flight commit, then prevents every later tool write", async () => {
			const turn = make();
			await op.reserveNoteAIOperation(turn, hash); await op.claimNoteAIOperation(turn, hash);
			let entered, release;
			const started = new Promise(resolve => { entered = resolve; });
			const held = new Promise(resolve => { release = resolve; });
			const write = op.withNoteAIWrite(turn, async tx => {
				await tx.$executeRaw`UPDATE "Note" SET "plainText"='AI canonical' WHERE "id"=${noteId}`;
				entered(); await held;
			});
			await started;
			let cancelReturned = false;
			const cancellation = op.cancelNoteAIOperation(turn).then(result => { cancelReturned = true; return result; });
			// Observe the second backend actually waiting on a Postgres lock.
			let waiting = false;
			for (let i = 0; i < 100; i++) {
				const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
				if (rows[0].count > 0) { waiting = true; break; }
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			assert.equal(waiting, true, "cancellation must contend on the operation lock");
			assert.equal(cancelReturned, false);
			release(); await write;
			assert.equal((await cancellation).state, "cancelled");
			await db.$executeRaw`UPDATE "Note" SET "plainText"='AI canonical plus manual follow-up' WHERE "id"=${noteId}`;
			await rejected(() => op.withNoteAIWrite(turn, tx => tx.$executeRaw`UPDATE "Note" SET "plainText"='late AI overwrite' WHERE "id"=${noteId}`));
			const rows = await db.$queryRaw`SELECT "plainText" FROM "Note" WHERE "id"=${noteId}`;
			assert.equal(rows[0].plainText, "AI canonical plus manual follow-up");
		});
		await t.test("orphaned worker is recoverable without its finally callback or history", async () => {
			const turn = make();
			await op.reserveNoteAIOperation(turn, hash); await op.claimNoteAIOperation(turn, hash);
			// Simulate a gateway error/worker death: no settlement call happens.
			assert.equal((await op.readNoteAIOperation(turn)).state, "running");
			assert.equal((await op.cancelNoteAIOperation(turn)).state, "cancelled");
			await op.settleNoteAIOperation(turn); // a late callback must not revive it
			assert.equal((await op.readNoteAIOperation(turn)).state, "cancelled");
			await rejected(() => op.withNoteAIWrite(turn, async () => assert.fail("orphan write ran")));
		});
		await t.test("Clear waits for accepted history, retains the fence, and refuses late assistant or initial user persistence", async () => {
			const clear = loadClearRoute(db, userId);
			const turn = make();
			await op.reserveNoteAIOperation(turn, hash); await op.claimNoteAIOperation(turn, hash);
			let entered, release;
			const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
			const history = op.withNoteAIHistory(turn, async tx => {
				await tx.noteAIMessage.create({ data: { id: randomUUID(), noteId, role: "assistant", content: "Public history fixture" } });
				entered(); await held;
			}, true);
			await started;
			const cleared = clear(new Request("https://sureword.invalid/api/notes/owned/ai-messages", { method: "DELETE" }), { params: Promise.resolve({ id: noteId }) });
			let waiting = false;
			for (let i = 0; i < 100; i++) {
				const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
				if (rows[0].count > 0) { waiting = true; break; }
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			assert.equal(waiting, true, "the real Clear handler must wait for accepted history persistence");
			release(); assert.equal((await history).accepted, true); assert.equal((await cleared).status, 200);
			assert.equal(await db.noteAIMessage.count({ where: { noteId } }), 0);
			assert.equal((await op.readNoteAIOperation(turn)).state, "cancelled", "Clear retains the operation receipt");
			for (const allowSettled of [false, true]) {
				assert.deepEqual(await op.withNoteAIHistory(turn, async () => assert.fail("late user/onEnd history ran after Clear"), allowSettled), { accepted: false });
			}
			await rejected(() => op.withNoteAIWrite(turn, async () => assert.fail("tool ran after Clear")));
			const cancelledBeforeInitial = make();
			await op.reserveNoteAIOperation(cancelledBeforeInitial, hash); await op.claimNoteAIOperation(cancelledBeforeInitial, hash);
			await op.cancelNoteAIOperation(cancelledBeforeInitial);
			assert.deepEqual(await op.withNoteAIHistory(cancelledBeforeInitial, async () => assert.fail("cancelled initial user persistence ran")), { accepted: false });
			const settled = make();
			await op.reserveNoteAIOperation(settled, hash); await op.claimNoteAIOperation(settled, hash); await op.settleNoteAIOperation(settled);
			assert.equal((await op.withNoteAIHistory(settled, async () => "accepted final history", true)).accepted, true);
			assert.equal((await clear(new Request("https://sureword.invalid/clear", { method: "DELETE" }), { params: Promise.resolve({ id: noteId }) })).status, 200);
			assert.deepEqual(await op.withNoteAIHistory(settled, async () => assert.fail("settled history recreated after Clear"), true), { accepted: false });
			assert.deepEqual(await op.withNoteAIHistory(undefined, async () => "legacy"), { accepted: true, value: "legacy" });
		});
		await t.test("real SDK route settles before DONE even when answer verification throws ahead of an independent tool", async () => {
			const turn = make();
			const body = { operationId: turn.id, noteId, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: "Public route fixture" }] }] };
			await op.reserveNoteAIOperation(turn, op.noteAIRequestHash(body));
			let releaseTool;
			const heldTool = new Promise(resolve => { releaseTool = resolve; });
			let toolWork;
			let toolContext;
			let verificationRan = false;
			let cancelOnClaim = false, persistable = false, streamStarts = 0, extractions = 0;
			const background = [];
			const noOp = () => {};
			const { POST, persistExchange } = loadNoteRoute({
				...op, NextResponse,
				claimNoteAIOperation: async (...args) => { await op.claimNoteAIOperation(...args); if (cancelOnClaim) await op.cancelNoteAIOperation(args[0]); },
				createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages, validateUIMessages,
				getAuthUser: async () => userId,
				createIdGenerator: () => () => randomUUID(),
				createRateLimiter: () => ({ check: () => ({ allowed: true }) }),
				withIncludedAiRequest: fn => fn,
				prisma: { note: { findFirst: async () => ({ id: noteId, title: "Public QA", plainText: "Initial" }) }, user: { findUnique: async () => null }, noteAIMessage: {
					findUnique: async () => null, upsert: async () => ({ createdAt: new Date(), metadata: {} }),
				} },
				readingTimezone: value => value ?? "UTC", readingRequestContext: () => ({ timezone: "UTC" }),
				readStoredHighlightLabels: () => ({}), readStoredHighlightMeanings: () => ({}), readStoredAboutMe: () => "", readStoredTestimony: () => "",
				assistantHistoryIds: () => [], trustedAssistantHistory: value => value,
				withoutOrphanedOpenAIReferences: value => value,
				buildSureWordTools: context => { toolContext = context; return {}; },
				loadUserMemories: async () => [], loadUserChurch: async () => null, loadHighlightLegend: async () => null, describeNoteLinks: async () => null,
				noteAISystemPrompt: () => "", formatAboutMeBlock: () => "", formatTestimonyBlock: () => "", formatMemoryBlock: () => "", formatChurchBlock: () => "", formatHighlightLegendBlock: () => "", actionDecisionBlock: async () => "",
				nextStepGuidance: "", HISTORY_EVIDENCE_GUIDANCE: "", SCRIPTURE_OUTPUT_GUIDANCE: "", noteAIStablePrompt: "",
				resolveModel: async () => ({ model: {}, providerOptions: {}, definition: { provider: "fixture", providerModelId: "fixture" } }), resolveVerificationModel: async () => ({}),
				splitStableSystemPrefix: () => ({ stableSystem: "", volatileSystem: "" }), buildPromptCachePlan: () => ({ system: "", providerOptions: {} }),
				startStatusNarration: () => noOp, plainDashes: noOp, isStepCount: noOp, isOverTimeBudget: noOp, TOOL_LOOP_BUDGET_MS: 240_000,
				streamText: () => { streamStarts++; return ({
					stream: new ReadableStream({ start(controller) { controller.close(); } }),
					consumeStream: () => {
						toolWork = (async () => {
							await heldTool;
							await rejected(() => op.withNoteAIWrite(toolContext.noteOperation, tx => tx.$executeRaw`UPDATE "Note" SET "plainText"='late route tool' WHERE "id"=${noteId}`));
						})();
						return toolWork;
					},
				}); },
				toUIMessageStream: ({ stream }) => stream,
				releaseVerifiedAnswer: async () => { verificationRan = true; throw new Error("Synthetic verification failure while the provider tool remains queued"); },
				streamErrorText: () => "Verification failed.", AiCredentialError: class extends Error {}, UserFacingError: class extends Error {},
				waitUntil: task => { background.push(task); }, hasPersistableContent: () => persistable,
				persistableParts: value => value, joinAssistantTextParts: value => value.join("\n\n"),
				recordDeliveredActionProposal: async () => { extractions++; }, usedMemoryTools: () => false, extractAndStoreMemories: async () => { extractions++; },
				chatErrorPayload: (_code, message) => ({ error: message }),
			});
			const response = await POST(new Request("https://sureword.invalid/api/note-ai", { method: "POST", body: JSON.stringify(body) }));
			assert.equal(response.status, 200);
			const sse = await response.text();
			await Promise.all(background);
			assert.match(sse, /Verification failed/);
			assert.match(sse, /\[DONE\]/);
			assert.equal(verificationRan, true, "must reach the intended verification failure rather than an earlier setup failure");
			assert.ok(toolWork instanceof Promise, "provider consumption must have actually started the queued tool");
			assert.deepEqual(toolContext.noteOperation, turn);
			assert.equal((await op.readNoteAIOperation(turn)).state, "settled");
			releaseTool(); await toolWork;
			const rows = await db.$queryRaw`SELECT "plainText" FROM "Note" WHERE "id"=${noteId}`;
			assert.equal(rows[0].plainText, "AI canonical plus manual follow-up", "queued provider tool cannot overwrite a recovered manual edit");
			persistable = true;
			const exchange = { userId, noteId, userMessage: body.messages[0], responseMessage: { id: randomUUID(), role: "assistant", parts: [{ type: "text", text: "Public final answer fixture" }] }, operation: turn };
			await persistExchange(exchange);
			assert.equal(await db.noteAIMessage.count({ where: { id: exchange.responseMessage.id } }), 1, "settled onEnd exchange is persisted");
			assert.equal(extractions, 2);
			const clear = loadClearRoute(db, userId);
			assert.equal((await clear(new Request("https://sureword.invalid/clear", { method: "DELETE" }), { params: Promise.resolve({ id: noteId }) })).status, 200);
			await persistExchange(exchange);
			assert.equal(await db.noteAIMessage.count({ where: { noteId } }), 0, "late production persistExchange cannot undo real Clear");
			assert.equal(extractions, 2, "cancelled exchange does not run action or memory extraction");
			cancelOnClaim = true;
			const next = make(), nextBody = { ...body, operationId: next.id, messages: [{ ...body.messages[0], id: randomUUID() }] };
			await op.reserveNoteAIOperation(next, op.noteAIRequestHash(nextBody));
			const refused = await POST(new Request("https://sureword.invalid/api/note-ai", { method: "POST", body: JSON.stringify(nextBody) }));
			assert.equal(refused.status, 409, "cancellation between claim and initial persistence stops the real route");
			assert.equal(streamStarts, 1, "cancelled startup never starts another provider");
			assert.equal(await db.noteAIMessage.count({ where: { id: nextBody.messages[0].id } }), 0);
		});
	} finally {
		await db.$executeRaw`DELETE FROM "User" WHERE "id" IN (${userId}, ${foreignId})`;
		await db.$disconnect();
	}
});
