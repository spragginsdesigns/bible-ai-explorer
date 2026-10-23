/**
 * POST /api/conversations: the title is validated before Prisma sees it, so a
 * bad body is a 400 and not a 500. Fake Prisma, same strip-imports harness as
 * tests/answer-feedback.test.mjs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

const NextResponse = {
	json: (body, init) => ({ status: init?.status ?? 200, body }),
};

function createRoute() {
	const creates = [];
	const { POST } = loadModule("../src/app/api/conversations/route.ts", ["POST"], {
		NextResponse,
		getAuthUser: async () => "user_alice",
		prisma: {
			conversation: {
				create: async (args) => {
					creates.push(args.data);
					return { id: "convo-1", ...args.data };
				},
			},
		},
	});
	return {
		creates,
		send: (json) => POST({ json: typeof json === "function" ? json : async () => json }),
	};
}

test("a non-string title is a 400 that creates nothing", async () => {
	for (const title of [42, true, { text: "x" }, ["Romans"]]) {
		const route = createRoute();
		const response = await route.send({ title });
		assert.equal(response.status, 400, JSON.stringify(title));
		assert.deepEqual(route.creates, []);
	}
});

test("a body that is not a JSON object is a 400, not a 500", async () => {
	for (const json of [async () => { throw new SyntaxError("Unexpected token"); }, async () => null, async () => "Romans", async () => [1]]) {
		const route = createRoute();
		const response = await route.send(json);
		assert.equal(response.status, 400);
		assert.deepEqual(route.creates, []);
	}
});

test("a missing, null or blank title takes the default, as before", async () => {
	for (const body of [{}, { title: null }, { title: "" }, { title: "   " }]) {
		const route = createRoute();
		const response = await route.send(body);
		assert.equal(response.status, 201);
		assert.equal(route.creates[0].title, "New Conversation");
	}
});

test("a title is trimmed and clipped at 120 characters without splitting an emoji", async () => {
	const route = createRoute();
	await route.send({ title: "  What does Romans 8:28 mean?  " });
	assert.equal(route.creates[0].title, "What does Romans 8:28 mean?");

	const long = createRoute();
	const response = await long.send({ title: "a".repeat(119) + "\u{1F64F}\u{1F64F}" });
	assert.equal(response.status, 201);
	assert.equal(long.creates[0].title, "a".repeat(119) + "\u{1F64F}");
});
