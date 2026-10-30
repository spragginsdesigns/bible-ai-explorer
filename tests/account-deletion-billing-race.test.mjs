import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as accountDeletion from "../src/lib/account-deletion.ts";
import * as storeCancellation from "../src/lib/billing/store-cancellation.ts";

const routeSource = ts.transpileModule(
	readFileSync(new URL("../src/app/api/account/route.ts", import.meta.url), "utf8"),
	{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function harness({ noPurchase = false, replaceAt = "collect", failReplacementCancel = false } = {}) {
	const events = [];
	let accountExists = true;
	let row = noPurchase ? null : { encryptedPurchaseToken: "encrypted:old", productId: "old-product" };
	let replacementFailed = failReplacementCancel;
	const states = new Map([["old", "SUBSCRIPTION_STATE_ACTIVE"], ["new", "SUBSCRIPTION_STATE_ACTIVE"]]);
	const replace = () => {
		if (!row || replaceAt === null) return;
		events.push("bind:new");
		row = { encryptedPurchaseToken: "encrypted:new", productId: "new-product" };
	};
	const findPlay = (phase) => async ({ where }) => {
		assert.equal(where.userId, "user-1");
		events.push(`${phase}:read:${row?.encryptedPurchaseToken ?? "none"}`);
		return row && { ...row };
	};
	const tx = {
		$queryRaw: async (strings, id) => {
			assert.equal(strings.join("?"), 'SELECT "id" FROM "User" WHERE "id" = ? FOR UPDATE');
			assert.equal(id, "user-1");
			// Simulates a binder committing while deletion waits for its lock.
			if (replaceAt === "lock") replace();
			events.push("lock:acquired");
			return [{ id }];
		},
		googlePlaySubscription: { findUnique: findPlay("tx") },
		user: {
			findUnique: async () => ({ email: "member@example.test" }),
			deleteMany: async () => {
				events.push("delete:user");
				assert.ok(!row || states.get(row.encryptedPurchaseToken.slice(10)) === "SUBSCRIPTION_STATE_CANCELED");
				accountExists = false;
				row = null;
			},
		},
		guestTurn: { deleteMany: async () => events.push("delete:guest") },
		legacyClerkAccount: { deleteMany: async () => events.push("delete:legacy") },
	};
	const prisma = {
		googlePlaySubscription: { findUnique: findPlay("preflight") },
		chatAttachment: { findMany: async () => {
			events.push("collect");
			if (replaceAt === "collect") replace();
			return [{ pathname: "chat-attachments/user-1/blob" }];
		} },
		verseOfDay: { findMany: async () => [] },
		$transaction: async (work, options) => {
			assert.ok(options.timeout >= 65_000, "transaction covers bounded Play reads/cancels plus DB work");
			events.push("tx:begin");
			const previousAccount = accountExists;
			const previousRow = row;
			try {
				await work(tx);
				events.push("tx:commit");
			} catch (error) {
				accountExists = previousAccount;
				row = previousRow;
				events.push("tx:rollback");
				throw error;
			}
		},
	};
	const modules = {
		"@clerk/nextjs/server": {
			auth: async () => ({ userId: "user-1" }),
			clerkClient: async () => ({ users: { deleteUser: async () => events.push("delete:clerk") } }),
		},
		"@vercel/blob": {
			list: async () => ({ blobs: [], hasMore: false }),
			del: async () => events.push("delete:blobs"),
		},
		"next/server": { NextResponse: { json: (body, { status }) => ({ body, status }) } },
		"@/lib/account-deletion": accountDeletion,
		"@/lib/ai/crypto": { decryptSecret: (value) => {
			assert.ok(value.startsWith("encrypted:"));
			return value.slice(10);
		} },
		"@/lib/auth": { forgetConfirmedUser: () => events.push("forget:user") },
		"@/lib/billing/store-cancellation": storeCancellation,
		"@/lib/billing/google-play": {
			readSubscriptionState: async (token) => {
				events.push(`play:read:${token}`);
				return states.get(token);
			},
			cancelSubscriptionRenewal: async (productId, token) => {
				events.push(`play:cancel:${token}`);
				assert.equal(productId, `${token}-product`);
				if (token === "new" && replacementFailed) throw new Error("Publisher unavailable");
				states.set(token, "SUBSCRIPTION_STATE_CANCELED");
			},
		},
		"@/lib/billing/stripe": { billingAvailable: () => false },
		"@/lib/prisma": { prisma },
	};
	const exports = {};
	new Function("require", "exports", "console", routeSource)(
		(name) => {
			assert.ok(name in modules, `unexpected route dependency ${name}`);
			return modules[name];
		},
		exports,
		{ error: () => events.push("log:failure") },
	);
	return {
		events,
		get accountExists() { return accountExists; },
		get row() { return row; },
		allowCancellation: () => { replacementFailed = false; },
		send: () => exports.DELETE({ json: async () => ({ confirm: "DELETE" }) }),
	};
}

for (const replaceAt of ["collect", "lock"]) {
	test(`deletion cancels the replacement token bound during ${replaceAt} before deleting`, async () => {
		const h = harness({ replaceAt });
		assert.equal((await h.send()).status, 200);
		assert.equal(h.accountExists, false);
		assert.equal(h.row, null);
		assert.deepEqual(h.events.filter((event) => event.startsWith("play:cancel:")), ["play:cancel:old", "play:cancel:new"]);
		const ordered = ["play:cancel:old", "collect", "lock:acquired", "tx:read:encrypted:new", "play:read:new", "play:cancel:new", "delete:guest", "delete:legacy", "delete:user", "tx:commit", "forget:user", "delete:blobs", "delete:clerk"];
		for (let i = 1; i < ordered.length; i++) {
			assert.ok(h.events.indexOf(ordered[i - 1]) < h.events.indexOf(ordered[i]), `${ordered[i - 1]} precedes ${ordered[i]}`);
		}
	});
}

test("replacement cancellation failure rolls back, retains the account and supports retry", async () => {
	const h = harness({ failReplacementCancel: true });
	const response = await h.send();
	assert.equal(response.status, 500);
	assert.deepEqual(response.body, {
		error: "Account deletion did not finish. Nothing was lost; try again.",
		code: "deletion_incomplete", stage: "database", databaseDeleted: false,
	});
	assert.equal(h.accountExists, true);
	assert.equal(h.row.encryptedPurchaseToken, "encrypted:new");
	assert.ok(h.events.includes("tx:rollback"));
	assert.ok(!h.events.some((event) => event.startsWith("delete:") || event === "forget:user"));
	h.allowCancellation();
	assert.equal((await h.send()).status, 200);
	assert.equal(h.accountExists, false);
});

test("no Play row still deletes normally after locking and rechecking", async () => {
	const h = harness({ noPurchase: true });
	assert.equal((await h.send()).status, 200);
	assert.equal(h.accountExists, false);
	assert.ok(!h.events.some((event) => event.startsWith("play:")));
	assert.ok(h.events.indexOf("lock:acquired") < h.events.indexOf("tx:read:none"));
	assert.ok(h.events.indexOf("tx:read:none") < h.events.indexOf("delete:user"));
});

test("the unchanged token is rechecked without cancelling an already cancelled purchase", async () => {
	const h = harness({ replaceAt: null });
	assert.equal((await h.send()).status, 200);
	assert.deepEqual(h.events.filter((event) => event.startsWith("play:read:")), ["play:read:old", "play:read:old"]);
	assert.deepEqual(h.events.filter((event) => event.startsWith("play:cancel:")), ["play:cancel:old"]);
});
