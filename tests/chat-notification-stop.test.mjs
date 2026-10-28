import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setImmediate as nextTurn } from "node:timers/promises";
import ts from "typescript";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import * as stops from "../src/lib/chat-notification-stop.ts";
import { createChatClientConnection } from "../src/lib/chat-client-connection.ts";
import { createRateLimiter, rateLimitKey } from "../src/lib/rateLimit.ts";

const ATTEMPT = "a68b9240-5e76-4d72-baaa-8a13d624aebd";
const RETRY = "b68b9240-5e76-4d72-baaa-8a13d624aebd";
const identity = (attemptId = ATTEMPT) => ({ userId: "reader", conversationId: "conversation", attemptId });
const key = (attempt) => JSON.stringify(attempt);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadModule(path, injected, fallback = () => { throw new Error("Unexpected dependency"); }) {
	const code = ts.transpileModule(read(path), { compilerOptions: {
		module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
	} }).outputText;
	const loaded = { exports: {} };
	new Function("require", "module", "exports", code)(
		(id) => injected[id] ?? fallback(id), loaded, loaded.exports,
	);
	return loaded.exports;
}

function stopRoute({ user = "reader", owns = true, authError, upsertError, race = false } = {}) {
	const rows = new Map();
	const calls = [];
	const prisma = {
		conversation: { findFirst: async (query) => {
			calls.push(["owner", query]);
			return owns && query.where.id === "conversation" && query.where.userId === "reader" ? { id: "conversation" } : null;
		} },
		chatNotificationStop: {
			upsert: async (query) => {
				calls.push(["upsert", query]);
				if (upsertError) throw upsertError;
				const id = key(query.where.userId_conversationId_attemptId);
				if (!rows.has(id)) rows.set(id, structuredClone(query.create));
				if (race) throw Object.assign(new Error("private database detail"), { code: "P2002" });
				return rows.get(id);
			},
			findUnique: async (query) => rows.get(key(query.where.userId_conversationId_attemptId)) ?? null,
		},
	};
	const route = loadModule("src/app/api/chat-notifications/stop/route.ts", {
		"next/server": { NextResponse: { json: Response.json } },
		"@/lib/auth": { getAuthUser: async () => { calls.push(["auth"]); if (authError) throw authError; return user; } },
		"@/lib/prisma": { prisma },
		"@/lib/rateLimit": { createRateLimiter, rateLimitKey },
		"@/lib/chat-notification-stop": stops,
	});
	return { rows, calls, post: (body = { conversationId: "conversation", attemptId: ATTEMPT }) => route.POST(new Request(
		"https://example.test/api/chat-notifications/stop",
		{ method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) },
	)) };
}

test("full UUIDs normalize; absent chat metadata alone retains legacy behavior", () => {
	assert.equal(stops.parseChatNotificationAttemptId(undefined), undefined);
	assert.equal(stops.parseChatNotificationAttemptId(ATTEMPT.toUpperCase()), ATTEMPT);
	for (const invalid of [null, "", ATTEMPT.slice(1), ATTEMPT.replaceAll("-", ""), ` ${ATTEMPT}`, `${ATTEMPT}\n`, 3, {}, []]) {
		assert.equal(stops.parseChatNotificationAttemptId(invalid), null);
	}
});

test("Stop authenticates and verifies ownership before writing an attempt-scoped one-hour row", async () => {
	const f = stopRoute();
	assert.deepEqual(await (await f.post({ conversationId: "conversation", attemptId: ATTEMPT.toUpperCase(), userId: "spoofed" })).json(), { stopped: true });
	assert.deepEqual(f.calls.map(([kind]) => kind), ["auth", "owner", "upsert"]);
	assert.deepEqual(f.calls[1][1].where, { id: "conversation", userId: "reader" });
	const row = f.rows.get(key(identity()));
	assert.equal(row.expiresAt - row.createdAt, 60 * 60 * 1000);
	assert.deepEqual(f.calls[2][1].update, {});
});

test("duplicate Stop is idempotent without refreshing its first bounded expiry", async () => {
	const f = stopRoute();
	assert.equal((await f.post()).status, 200);
	const first = structuredClone(f.rows.get(key(identity())));
	assert.equal((await f.post()).status, 200);
	assert.equal(f.rows.size, 1);
	assert.deepEqual(f.rows.get(key(identity())), first);
});

test("a concurrent duplicate insert is acknowledged only after finding the same scoped row", async () => {
	const f = stopRoute({ race: true });
	assert.equal((await f.post()).status, 200);
	assert.equal(f.rows.size, 1);
});

test("missing and foreign conversations return identical 404s without tombstone writes", async () => {
	for (const body of [
		{ conversationId: "missing", attemptId: ATTEMPT },
		{ conversationId: "conversation", attemptId: ATTEMPT, userId: "reader" },
	]) {
		const f = stopRoute({ owns: false });
		const response = await f.post(body);
		assert.equal(response.status, 404);
		assert.deepEqual(await response.json(), { error: "Not found" });
		assert.deepEqual(f.calls.map(([kind]) => kind), ["auth", "owner"]);
	}
});

test("a rejected session never performs ownership or Stop database work", async () => {
	const f = stopRoute({ authError: new Response("Unauthorized", { status: 401 }) });
	assert.equal((await f.post()).status, 401);
	assert.deepEqual(f.calls, [["auth"]]);
});

test("malformed Stop bodies/UUIDs fail before ownership or writes", async () => {
	for (const body of ["{", null, [], {}, { conversationId: "conversation" },
		{ conversationId: "conversation", attemptId: null }, { conversationId: "conversation", attemptId: "short" },
		{ conversationId: "x".repeat(129), attemptId: ATTEMPT }]) {
		const f = stopRoute();
		assert.equal((await f.post(body)).status, 400);
		assert.deepEqual(f.calls, [["auth"]]);
	}
});

test("Stop rate limits authenticated callers at 30/min without another database write", async () => {
	const f = stopRoute();
	for (let n = 0; n < 30; n++) assert.equal((await f.post()).status, 200);
	const response = await f.post();
	assert.equal(response.status, 429);
	assert.ok(Number(response.headers.get("Retry-After")) > 0);
	assert.equal(f.calls.filter(([kind]) => kind === "upsert").length, 30);
});

test("conversation deletion racing the Stop write is a generic 404", async () => {
	const f = stopRoute({ upsertError: Object.assign(new Error("private"), { code: "P2003" }) });
	assert.equal((await f.post()).status, 404);
});

test("expired tombstones, including exact expiry, do not suppress a wanted answer", async () => {
	for (const expiry of [999, 1000]) {
		let sends = 0;
		assert.equal(await stops.notifyUnlessChatStopped(identity(), {
			findStop: async () => ({ expiresAt: new Date(expiry) }), now: () => 1000,
			notify: async () => { sends += 1; },
		}), "sent");
		assert.equal(sends, 1);
	}
});

test("lookup failures fail closed with a constant log and no answer/provider/account text", async () => {
	const logs = [];
	let sends = 0;
	assert.equal(await stops.notifyUnlessChatStopped(identity(), {
		findStop: async () => { throw new Error("private account, token and answer"); },
		notify: async () => { sends += 1; }, warn: (...args) => logs.push(args),
	}), "lookup_failed");
	assert.equal(sends, 0);
	assert.deepEqual(logs, [["[chat-reply-push] Stop lookup unavailable; notification skipped"]]);
});

test("legacy clients do not query the new table; provider errors still propagate", async () => {
	const error = new Error("sender failed");
	await assert.rejects(stops.notifyUnlessChatStopped({ userId: "reader", conversationId: "conversation" }, {
		findStop: async () => assert.fail("legacy request must not read tombstones"),
		notify: async () => { throw error; },
	}), (actual) => actual === error);
});

function deferred() {
	let resolve;
	const promise = new Promise((accept) => { resolve = accept; });
	return { promise, resolve };
}

function streamAttempt(rows, attemptId = ATTEMPT) {
	const generation = deferred(), persistence = deferred(), ended = deferred();
	const abort = new AbortController(), connection = createChatClientConnection(abort.signal);
	let drained, work, saved = false, sends = 0;
	const stream = createUIMessageStream({
		generateId: () => "same-answer-message",
		execute: async ({ writer }) => {
			writer.write({ type: "start", messageId: "same-answer-message" });
			writer.write({ type: "text-start", id: "text" });
			writer.write({ type: "text-delta", id: "text", delta: "first " });
			await generation.promise;
			writer.write({ type: "text-delta", id: "text", delta: "complete answer" });
			writer.write({ type: "text-end", id: "text" });
			writer.write({ type: "finish", finishReason: "stop" });
		},
		onEnd(event) {
			work = persistence.promise.then(() => {
				saved = true;
				return connection.afterPersistence(() => stops.notifyUnlessChatStopped(identity(attemptId), {
					findStop: async (attempt) => rows.get(key(attempt)) ?? null,
					notify: async () => { sends += 1; },
				}));
			});
			ended.resolve(event);
		},
	});
	const response = connection.trackResponse(createUIMessageStreamResponse({ stream,
		consumeSseStream: ({ stream: copy }) => { drained = (async () => {
			let text = ""; const reader = copy.getReader();
			try { while (true) { const next = await reader.read(); if (next.done) return text; text += next.value; } }
			finally { reader.releaseLock(); }
		})(); },
	}));
	return { response, generation, persistence, ended: ended.promise, abort, connection,
		get drained() { return drained; }, get work() { return work; }, get saved() { return saved; }, get sends() { return sends; } };
}

test("early Stop before first SSE suppresses push without aborting the SDK drain or persistence", { timeout: 5000 }, async () => {
	const f = stopRoute(); await f.post();
	const run = streamAttempt(f.rows);
	const cancellation = run.response.body.cancel("deliberate Stop acknowledged");
	run.generation.resolve(); run.persistence.resolve();
	const event = await run.ended;
	await Promise.all([run.work, run.drained, cancellation]);
	assert.equal(event.isAborted, false);
	assert.match(event.responseMessage.parts.find((p) => p.type === "text").text, /complete answer/);
	assert.equal(run.saved, true);
	assert.equal(run.sends, 0);
});

test("Stop after persistence but before departure is checked at the late send decision", { timeout: 5000 }, async () => {
	const f = stopRoute(), run = streamAttempt(f.rows);
	const reader = run.response.body.getReader(); await reader.read();
	run.generation.resolve(); await Promise.all([run.ended, run.drained]);
	run.persistence.resolve(); await nextTurn();
	assert.equal(run.saved, true); assert.equal(run.sends, 0);
	await f.post();
	await Promise.all([reader.cancel("acknowledged Stop"), run.work]);
	assert.equal(run.sends, 0);
});

test("retry with a new UUID for the same conversation/message still wants its notification", { timeout: 5000 }, async () => {
	const f = stopRoute(); await f.post();
	const run = streamAttempt(f.rows, RETRY);
	const cancel = run.response.body.cancel("accidental disconnect on retry");
	run.generation.resolve(); run.persistence.resolve(); await run.ended;
	await Promise.all([run.work, run.drained, cancel]);
	assert.equal(run.saved, true); assert.equal(run.sends, 1);
});

test("accidental disconnect with duplicate departure signals still notifies once", { timeout: 5000 }, async () => {
	const run = streamAttempt(new Map());
	const reader = run.response.body.getReader(); await reader.read();
	run.abort.abort(); const cancel = reader.cancel("app quit");
	run.generation.resolve(); run.persistence.resolve(); await run.ended;
	await Promise.all([run.work, run.drained, cancel]);
	await run.connection.afterPersistence(async () => assert.fail("duplicate notification callback"));
	assert.equal(run.saved, true); assert.equal(run.sends, 1);
});

test("ask-question rejects malformed present metadata before generation or persistence, while legacy omission passes validation", async () => {
	let databaseReads = 0;
	const route = loadModule("src/app/api/ask-question/route.ts", {
		"ai": { createIdGenerator: () => () => "server-id" },
		"next/server": { NextResponse: { json: Response.json } },
		"@/lib/auth": { getAuthUser: async () => "reader" },
		"@/lib/analytics/events": { platformFromHeaders: () => "macos" },
		"@/lib/rateLimit": { askQuestionRateLimiter: { check: () => ({ allowed: true }) }, rateLimitKey },
		"@/lib/chat-notification-stop": stops,
		"@/lib/ai/errors": { chatErrorPayload: (code, message) => ({ code, message }), UserFacingError: class extends Error {} },
		"@/lib/chat-client-connection": { withChatClientConnection: (handler) => (req) => handler(req, {}) },
		"@/lib/billing/usage": { withIncludedAiRequest: (handler) => handler },
		"@/lib/prisma": { prisma: { user: { findUnique: async () => { databaseReads++; throw new Response("passed validation", { status: 418 }); } } } },
	}, () => ({}));
	for (const value of [null, "", "partial", 7, {}]) {
		const response = await route.POST(new Request("https://example.test/api/ask-question", {
			method: "POST", body: JSON.stringify({ messages: [{}], notificationAttemptId: value }),
		}));
		assert.equal(response.status, 400);
	}
	assert.equal(databaseReads, 0);
	for (const value of [undefined, ATTEMPT]) {
		assert.equal((await route.POST(new Request("https://example.test/api/ask-question", {
			method: "POST", body: JSON.stringify({ messages: [{}], notificationAttemptId: value }),
		}))).status, 418);
	}
	assert.equal(databaseReads, 2);
});

test("authenticated cleanup removes expired Stops and preserves other cleanup results", async () => {
	const calls = [];
	const prisma = {
		chatAttachment: { findMany: async () => [] },
		guestTurn: { deleteMany: async () => ({ count: 2 }) },
		churchSaveEvent: { deleteMany: async () => ({ count: 3 }) },
		chatNotificationStop: { deleteMany: async (query) => { calls.push(query); return { count: 4 }; } },
	};
	const source = ts.transpileModule(read("src/app/api/cron/chat-attachments/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
	const loaded = { exports: {} };
	new Function("require", "module", "exports", "process", source)((id) => ({
		"next/server": { NextResponse: { json: Response.json } }, "@/lib/prisma": { prisma },
		"@/lib/chat-attachments.server": {}, "@/lib/guest-rules": { GUEST_RETENTION_DAYS: 30 },
		"@/lib/chat-attachment-types": { PENDING_ATTACHMENT_WINDOW_MS: 3600000 },
	}[id]), loaded, loaded.exports, { env: { CRON_SECRET: "qa-secret" } });
	assert.equal((await loaded.exports.GET(new Request("https://example.test/cron"))).status, 401);
	assert.equal(calls.length, 0);
	const response = await loaded.exports.GET(new Request("https://example.test/cron", { headers: { authorization: "Bearer qa-secret" } }));
	assert.deepEqual(await response.json(), { checked: 0, deleted: 0, guestTurnsDeleted: 2, churchSaveEventsDeleted: 3, chatNotificationStopsDeleted: 4 });
	assert.ok(calls[0].where.expiresAt.lte instanceof Date);
});
