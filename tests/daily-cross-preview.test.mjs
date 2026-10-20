import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("../src/app/api/verse-of-day/preview/route.ts", import.meta.url), "utf8");

function fixture({ cross = null, authError, readError } = {}) {
	const calls = [];
	const code = source.replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	const route = new Function("NextResponse", "getAuthUser", "findTodayCross",
		`${stripTypeScriptTypes(code)}; return { GET };`)(
		{ json: (body, init) => Response.json(body, init) },
		async () => { if (authError) throw authError; return "owner"; },
		async (userId) => { calls.push(userId); if (readError) throw readError; return cross; },
	);
	return { route, calls };
}

test("Today preview reads only the authenticated owner's existing word", async () => {
	const cross = { id: "saved-word", book: "Psalms", chapter: 119, verse: 105,
		text: "Thy word is a lamp unto my feet, and a light unto my path.",
		sentAt: new Date("2026-10-19T15:00:00Z"), reason: "Private devotional detail" };
	const { route, calls } = fixture({ cross });
	const response = await route.GET(new Request("https://sureword.app/api/verse-of-day/preview?userId=other"));
	assert.deepEqual(calls, ["owner"]);
	assert.deepEqual(await response.json(), { cross: {
		id: cross.id, reference: "Psalms 119:105", book: cross.book, chapter: 119,
		verse: 105, text: cross.text, sentAt: "2026-10-19T15:00:00.000Z",
	} });
	assert.match(response.headers.get("cache-control"), /private.*no-store/);
});

test("no existing word returns an empty preview without generating one", async () => {
	const { route, calls } = fixture();
	assert.deepEqual(await (await route.GET()).json(), { cross: null });
	assert.deepEqual(calls, ["owner"]);
	assert.doesNotMatch(source, /generateDailyCross|storeDailyCross|replaceDailyCross|generationLimit/);
});

test("anonymous preview requests cannot read a devotional", async () => {
	const { route, calls } = fixture({ authError: new Response("Unauthorized", { status: 401 }) });
	assert.equal((await route.GET()).status, 401);
	assert.deepEqual(calls, []);
});

test("preview failures are private and do not expose internal errors", async () => {
	const { route } = fixture({ readError: new Error("private database detail") });
	const response = await route.GET();
	assert.equal(response.status, 500);
	assert.match(response.headers.get("cache-control"), /private.*no-store/);
	assert.doesNotMatch(await response.text(), /private database detail/);
});
