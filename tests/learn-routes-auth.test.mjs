import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
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

/** What getAuthUser throws for a request with no Clerk session. */
const unauthorized = () => {
	throw new Response(JSON.stringify({ error: "Unauthorized", code: "unauthorized" }), {
		status: 401,
		headers: { "Content-Type": "application/json" },
	});
};

const NextResponse = {
	json: (body, init) => ({ status: init?.status ?? 200, body }),
};

/** Every call the handlers could make to the queue, all of them forbidden. */
function forbiddenLearn(reached) {
	return new Proxy(
		{},
		{
			get: (_target, name) => async () => {
				reached.push(String(name));
				throw new Error(`${String(name)} ran without a session`);
			},
		}
	);
}

const ROUTES = [
	{
		name: "GET /api/learn/today",
		path: "../src/app/api/learn/today/route.ts",
		handler: "GET",
		call: (handlers) => handlers.GET(),
	},
	{
		name: "POST /api/learn",
		path: "../src/app/api/learn/route.ts",
		handler: "POST",
		call: (handlers) =>
			handlers.POST({
				json: async () => ({
					book: 43,
					chapter: 3,
					verse: 16,
					translation: "KJV",
					source: "sheet",
				}),
			}),
	},
	{
		name: "POST /api/learn/[id]/review",
		path: "../src/app/api/learn/[id]/review/route.ts",
		handler: "POST",
		call: (handlers) =>
			handlers.POST({ json: async () => ({ result: "good" }) }, {
				params: Promise.resolve({ id: "card-1" }),
			}),
	},
	{
		name: "DELETE /api/learn/[id]",
		path: "../src/app/api/learn/[id]/route.ts",
		handler: "DELETE",
		call: (handlers) =>
			handlers.DELETE({}, { params: Promise.resolve({ id: "card-1" }) }),
	},
];

for (const route of ROUTES) {
	test(`${route.name} answers 401 and touches nothing without a session`, async () => {
		const reached = [];
		const learn = forbiddenLearn(reached);
		const handlers = loadModule(route.path, [route.handler], {
			NextResponse,
			z,
			getAuthUser: async () => unauthorized(),
			todayCards: learn.todayCards,
			addCard: learn.addCard,
			learnVerseText: learn.learnVerseText,
			reviewCardById: learn.reviewCardById,
			removeCard: learn.removeCard,
		});

		const response = await route.call(handlers);
		// The 401 Response getAuthUser throws is re-returned as-is, not swallowed
		// by the catch and reported as a 500.
		assert.ok(response instanceof Response, `${route.name} returned ${typeof response}`);
		assert.equal(response.status, 401);
		assert.deepEqual(await response.json(), { error: "Unauthorized", code: "unauthorized" });
		assert.deepEqual(reached, []);
	});
}

test("every learn route calls getAuthUser before anything else", () => {
	for (const route of ROUTES) {
		const source = read(route.path);
		const body = source.slice(source.indexOf(`export async function ${route.handler}`));
		const firstAwait = body.indexOf("await ");
		assert.ok(
			body.slice(firstAwait, firstAwait + 40).includes("getAuthUser()"),
			`${route.name} awaits something before getAuthUser()`
		);
	}
});
