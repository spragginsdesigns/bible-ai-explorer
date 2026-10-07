import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	ACCOUNT_DATA_MODELS,
	accountBlobPrefixes,
	isClerkNotFound,
	isDeletionConfirmed,
	runAccountDeletion,
	uniquePathnames,
} from "../src/lib/account-deletion.ts";

function harness(overrides = {}) {
	const calls = [];
	const logs = [];
	const deps = {
		cancelBilling: async () => void calls.push("billing"),
		collectBlobPathnames: async () => (calls.push("collect"), ["a", "b"]),
		deleteDatabaseRows: async () => void calls.push("db"),
		deleteBlobs: async () => void calls.push("blobs"),
		deleteClerkUser: async () => void calls.push("clerk"),
		log: (m) => logs.push(m),
		...overrides,
	};
	return { deps, calls, logs };
}

test("only an exact DELETE confirmation passes", () => {
	assert.equal(isDeletionConfirmed({ confirm: "DELETE" }), true);
	for (const bad of [null, undefined, "DELETE", [], {}, { confirm: "delete" }, { confirm: true }, { confirm: "DELETE " }]) {
		assert.equal(isDeletionConfirmed(bad), false);
	}
});

test("steps run in order and Clerk is last", async () => {
	const { deps, calls } = harness();
	assert.deepEqual(await runAccountDeletion("u1", deps), { ok: true, blobsDeleted: true });
	assert.deepEqual(calls, ["billing", "collect", "db", "blobs", "clerk"]);
});

test("billing or database failure aborts before Clerk and blobs", async () => {
	for (const [key, stage] of [["cancelBilling", "billing"], ["collectBlobPathnames", "collect"], ["deleteDatabaseRows", "database"]]) {
		const { deps, calls } = harness({ [key]: async () => { throw new Error("boom u1@example.com"); } });
		const result = await runAccountDeletion("u1", deps);
		assert.deepEqual(result, { ok: false, stage, databaseDeleted: false });
		assert.ok(!calls.includes("clerk") && !calls.includes("blobs"));
	}
});

test("a blob failure is logged without PII and does not block Clerk", async () => {
	const { deps, calls, logs } = harness({ deleteBlobs: async () => { throw new Error("chat-attachments/u1/x.pdf"); } });
	assert.deepEqual(await runAccountDeletion("u1", deps), { ok: true, blobsDeleted: false });
	assert.ok(calls.includes("clerk"));
	assert.equal(logs.length, 1);
	assert.ok(!/u1|chat-attachments|@/.test(logs[0]));
});

test("no blobs means no blob call", async () => {
	const { deps, calls } = harness({ collectBlobPathnames: async () => [] });
	await runAccountDeletion("u1", deps);
	assert.ok(!calls.includes("blobs"));
});

test("Clerk 404 is success (idempotent); other Clerk errors are retryable after DB commit", async () => {
	const notFound = harness({ deleteClerkUser: async () => { throw { status: 404 }; } });
	assert.equal((await runAccountDeletion("u1", notFound.deps)).ok, true);
	const down = harness({ deleteClerkUser: async () => { throw { status: 500 }; } });
	assert.deepEqual(await runAccountDeletion("u1", down.deps), { ok: false, stage: "clerk", databaseDeleted: true });
	assert.equal(isClerkNotFound({ status: 404 }), true);
	assert.equal(isClerkNotFound(new Error("x")), false);
});

test("helpers", () => {
	assert.deepEqual(accountBlobPrefixes("u1"), ["chat-attachments/u1/", "daily-cross-audio/u1/"]);
	assert.deepEqual(uniquePathnames(["a", null, "b"], ["a", undefined, ""]), ["a", "b"]);
});

test("the model list covers every user-keyed model in the Prisma schema", () => {
	const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
	const listed = new Set(ACCOUNT_DATA_MODELS.map((m) => m.model));
	// Models that hold no per-user data (shared caches, reference text, dedupe keys).
	const shared = new Set(["BillingEvent", "VerseEmbedding", "KjvVerse", "OriginalVerse", "VerseInsight", "VerseWordStudy", "SermonStudy"]);
	for (const [, name, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
		if (shared.has(name) || listed.has(name)) continue;
		assert.ok(!/\buserId\b|\bUser\b/.test(body), `${name} references a user but is missing from ACCOUNT_DATA_MODELS`);
	}
	for (const m of ACCOUNT_DATA_MODELS) assert.match(schema, new RegExp(`^model ${m.model} \\{`, "m"));
});

test("every cascade model really cascades from User or its parent in the schema", () => {
	const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
	for (const m of ACCOUNT_DATA_MODELS.filter((x) => x.via === "cascade")) {
		const body = schema.match(new RegExp(`^model ${m.model} \\{([\\s\\S]*?)^\\}`, "m"))[1];
		const parent = m.parent ?? "User";
		assert.match(body, new RegExp(`${parent}\\??\\s+@relation\\([^)]*onDelete: Cascade`), `${m.model} -> ${parent}`);
	}
});
