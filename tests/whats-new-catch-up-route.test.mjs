/**
 * GET /api/whats-new/catch-up on an account's first read: what it records as
 * seen. Driven through a fake Prisma with the real catchUpFor, the same
 * strip-imports harness tests/answer-feedback.test.mjs uses.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { catchUpFor } from "../src/lib/whats-new-rules.ts";

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

const mk = (code) => ({
	version: `1.${code}.0`,
	versionCode: code,
	date: "2026-10-20",
	sections: [{ kind: "new", items: [`item ${code}`] }],
	title: `T${code}`,
	headline: null,
	why: null,
	verse: null,
	target: null,
});
// 101 is the newest published release; 100 is what an un-updated phone has.
const ENTRIES = [mk(101), mk(100), mk(99)];
const NEWEST = 101;

function catchUpRoute(seenCode) {
	const writes = [];
	const user = { whatsNewSeenCode: seenCode };
	const prisma = {
		user: {
			findUnique: async () => ({ ...user }),
			updateMany: async (args) => {
				writes.push(args);
				if (user.whatsNewSeenCode === null) user.whatsNewSeenCode = args.data.whatsNewSeenCode;
				return { count: 1 };
			},
		},
	};
	const { GET } = loadModule("../src/app/api/whats-new/catch-up/route.ts", ["GET"], {
		NextResponse,
		prisma,
		getAuthUserId: async () => "user_alice",
		NEWEST_VERSION_CODE: NEWEST,
		WHATS_NEW_ENTRIES: ENTRIES,
		catchUpFor,
	});
	return {
		writes,
		user,
		get: (query = "") => GET(new Request(`https://sureword.app/api/whats-new/catch-up${query}`)),
	};
}

test("a first read from an older build records that build's release, not the newest", async () => {
	const route = catchUpRoute(null);
	const response = await route.get("?upTo=100");
	assert.equal(response.status, 200);
	assert.deepEqual(response.body.cards, [], "a new account is still never interrupted");
	assert.equal(response.body.seenCode, 100);
	assert.equal(route.writes.length, 1);
	assert.equal(route.writes[0].data.whatsNewSeenCode, 100);
	assert.deepEqual(route.writes[0].where, { id: "user_alice", whatsNewSeenCode: null });

	// The phone updates to the newest build: the release it skipped is a card.
	const next = await route.get("?upTo=101");
	assert.deepEqual(next.body.cards.map((card) => card.versionCode), [101]);
});

test("a first read with no cap (web) records the newest release", async () => {
	const route = catchUpRoute(null);
	const response = await route.get();
	assert.equal(response.body.seenCode, NEWEST);
	assert.equal(route.writes[0].data.whatsNewSeenCode, NEWEST);
});

test("a cap newer than anything published seeds the newest published release", async () => {
	const route = catchUpRoute(null);
	await route.get("?upTo=500");
	assert.equal(route.writes[0].data.whatsNewSeenCode, NEWEST);
});

test("a cap older than every published release seeds the cap itself, never 0", async () => {
	const route = catchUpRoute(null);
	const response = await route.get("?upTo=50");
	assert.equal(route.writes[0].data.whatsNewSeenCode, 50);
	assert.equal(response.body.seenCode, 50);
});

test("an account that has read before is never re-seeded", async () => {
	const route = catchUpRoute(99);
	const response = await route.get("?upTo=101");
	assert.deepEqual(route.writes, []);
	assert.equal(response.body.seenCode, 99);
	assert.deepEqual(response.body.cards.map((card) => card.versionCode), [101, 100]);
});

test("a malformed cap is a 400 that writes nothing", async () => {
	const route = catchUpRoute(null);
	const response = await route.get("?upTo=abc");
	assert.equal(response.status, 400);
	assert.deepEqual(route.writes, []);
});
