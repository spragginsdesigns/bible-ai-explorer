import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/conversations/[id]/messages/route.ts", import.meta.url)), "utf8")
	.replace(/^import\s[^;]*?;\s*$/gm, "")
	.replace(/^export /gm, "");

function route() {
	const calls = [];
	const prisma = {
		conversation: {
			findFirst: async ({ where }) => where.userId === "owner" ? { id: where.id } : null,
			update: async () => undefined,
		},
		message: {
			createMany: async ({ data }) => { calls.push(data); return { count: data.length }; },
			findMany: async () => [],
		},
	};
	const NextResponse = { json: (body, init) => ({ status: init?.status ?? 200, body }) };
	const Prisma = { JsonNull: null };
	const POST = new Function("z", "prisma", "NextResponse", "Prisma", "getAuthUser",
		`${stripTypeScriptTypes(source)}\nreturn POST;`
	)(z, prisma, NextResponse, Prisma, async () => "owner");
	return { POST, calls };
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
	assert.deepEqual(calls[0][0], { role: "user", content: "John 3:16", metadata: null, conversationId: "owned-chat" });
});
