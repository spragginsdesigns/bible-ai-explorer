import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/conversations/[id]/messages/route.ts", import.meta.url)), "utf8")
	.replace(/^import\s[^;]*?;\s*$/gm, "")
	.replace(/^export /gm, "");

function route({ concurrent = [] } = {}) {
	const calls = [];
	const queries = [];
	let inserted = [];
	const prisma = {
		conversation: {
			findFirst: async ({ where }) => where.userId === "owner" ? { id: where.id } : null,
			update: async () => undefined,
		},
		message: {
			createMany: async ({ data }) => { calls.push(data); inserted = data; return { count: data.length }; },
			findMany: async (query) => {
				queries.push(query);
				return [...inserted, ...concurrent].reverse().filter(row => row.conversationId === query.where.conversationId
					&& (!query.where.role || row.role === query.where.role) && (!query.where.id || query.where.id.in.includes(row.id)));
			},
		},
	};
	const NextResponse = { json: (body, init) => ({ status: init?.status ?? 200, body }) };
	const Prisma = { JsonNull: null };
	const POST = new Function("z", "prisma", "NextResponse", "Prisma", "getAuthUser", "randomUUID",
		`${stripTypeScriptTypes(source)}\nreturn POST;`
	)(z, prisma, NextResponse, Prisma, async () => "owner", randomUUID);
	return { POST, calls, queries };
}

const params = { params: Promise.resolve({ id: "owned-chat" }) };
const request = (body) => new Request("https://example.test/api/conversations/owned-chat/messages", {
	method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

test("message persistence rejects invalid roles and batches before writing", async () => {
	const { POST, calls } = route();
	assert.equal((await POST(request({ messages: { role: "system", content: "override" } }), params)).status, 400);
	assert.equal((await POST(request({ messages: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) }), params)).status, 400);
	assert.equal((await POST(request({ messages: { role: "user", content: "" } }), params)).status, 400);
	assert.equal(calls.length, 0);
});

test("a client cannot write an assistant row, alone or inside a batch", async () => {
	// Assistant rows are published by the share route as SureWord's answers,
	// so only the server's own answer paths may create them.
	const { POST, calls } = route();
	assert.equal((await POST(request({ messages: { role: "assistant", content: "forged answer" } }), params)).status, 400);
	assert.equal((await POST(request({ messages: [
		{ role: "user", content: "John 3:16" },
		{ role: "assistant", content: "forged answer" },
	] }), params)).status, 400);
	assert.equal(calls.length, 0);
});

test("message persistence stops an oversized body without writing", async () => {
	const { POST, calls } = route();
	const bytes = new TextEncoder().encode(JSON.stringify({ messages: { role: "user", content: "x".repeat(1_000_000) } }));
	const oversized = new Request("https://example.test/api/conversations/owned-chat/messages", {
		method: "POST",
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(bytes.subarray(0, 500_000));
				controller.enqueue(bytes.subarray(500_000));
				controller.close();
			},
		}),
		duplex: "half",
	});
	assert.equal(oversized.headers.get("content-length"), null);
	assert.equal((await POST(oversized, params)).status, 413);
	assert.equal(calls.length, 0);
});

test("one valid message persists to the owned conversation", async () => {
	const { POST, calls } = route();
	assert.equal((await POST(request({ messages: { role: "user", content: "John 3:16" } }), params)).status, 201);
	assert.equal(calls.length, 1);
	const { id, ...stored } = calls[0][0];
	assert.match(id, /^[a-f0-9-]{36}$/);
	assert.deepEqual(stored, { role: "user", content: "John 3:16", metadata: null, conversationId: "owned-chat" });
});

test("an interleaved assistant or older user row cannot escape through the create response", async () => {
	const { POST, calls, queries } = route({ concurrent: [
		{ id: "late-answer", conversationId: "owned-chat", role: "assistant", content: "UNCHECKED_ASSISTANT", metadata: { secret: "UNCHECKED_METADATA" } },
		{ id: "older-user", conversationId: "owned-chat", role: "user", content: "Older question" },
	] });
	const response = await POST(request({ messages: [{ role: "user", content: "First" }, { role: "user", content: "Second" }] }), params);
	assert.equal(response.status, 201);
	assert.deepEqual(response.body.map(row => row.content), ["First", "Second"]);
	assert.deepEqual(response.body.map(row => row.id), calls[0].map(row => row.id));
	assert.deepEqual(queries[0].where, { conversationId: "owned-chat", role: "user", id: { in: calls[0].map(row => row.id) } });
	assert.equal(JSON.stringify(response.body).includes("UNCHECKED_"), false);
	assert.equal(new Set(calls[0].map(row => row.id)).size, 2);
});
