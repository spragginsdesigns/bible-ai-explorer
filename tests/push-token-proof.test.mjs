/**
 * Device proof for Expo push tokens (docs/FEATURES.md, "Who owns a push
 * token"). The proof itself is pure and tested directly; the registration
 * route is driven through a small in-memory PushToken table that honours the
 * route's conditional writes, so who may move a token, when a row binds, when
 * its nonce rotates, and what a lost race does all run without a database.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
	createPushTokenNonce,
	isValidPushTokenProof,
	pushTokenProof,
	pushTokenProofSecret,
} from "../src/lib/push-token-proof.ts";
import { isAllowedWebPushEndpoint, mayRegisterExistingPushToken } from "../src/lib/push-routing.ts";

const SECRET = "test-proof-secret";
const TOKEN = "ExponentPushToken[device-1]";
const NONCE = "nonce-1";
const PROOF = pushTokenProof(SECRET, TOKEN, NONCE);

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

class PrismaClientKnownRequestError extends Error {
	constructor(message, { code }) {
		super(message);
		this.code = code;
	}
}

/**
 * The route against a one-table fake. `afterRead` runs after each findUnique,
 * before the write, to simulate another request landing in between.
 */
function loadRoute({ row = null, userId = "user_new", afterRead } = {}) {
	const table = { row: row ? { id: "row-1", ...row } : null };
	const calls = [];
	let reads = 0;
	const matches = (where, current) =>
		Object.entries(where).every(([key, value]) => current[key] === value);
	const prisma = {
		pushToken: {
			findUnique: async ({ where }) => {
				calls.push("findUnique");
				const found = table.row && table.row.token === where.token ? { ...table.row } : null;
				reads += 1;
				afterRead?.(table, reads);
				return found;
			},
			create: async ({ data }) => {
				calls.push("create");
				if (table.row && table.row.token === data.token) {
					throw new PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002" });
				}
				table.row = { id: "row-new", ...data };
				return { id: table.row.id };
			},
			updateMany: async ({ where, data }) => {
				calls.push("updateMany");
				if (!table.row || !matches(where, table.row)) return { count: 0 };
				table.row = { ...table.row, ...data };
				return { count: 1 };
			},
		},
	};
	const injected = {
		NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
		Prisma: { PrismaClientKnownRequestError },
		ANALYTICS_EVENTS: { pushRegistrationChanged: "push_registration_changed" },
		platformFromHeaders: () => "android",
		captureServerEvent: () => {},
		z,
		getAuthUser: async () => userId,
		prisma,
		webPushConfig: () => null,
		isAllowedWebPushEndpoint,
		mayRegisterExistingPushToken,
		createPushTokenNonce,
		isValidPushTokenProof,
		pushTokenProof,
		pushTokenProofSecret,
	};
	const source = read("../src/app/api/push-tokens/route.ts")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const { POST } = new Function(...names, `${stripTypeScriptTypes(source)}\nreturn { POST };`)(
		...names.map((name) => injected[name]),
	);
	return {
		table,
		calls,
		register: (extra = {}) =>
			POST({
				json: async () => ({ token: TOKEN, platform: "android", timezone: "America/Los_Angeles", ...extra }),
				headers: new Headers(),
			}),
	};
}

/** Runs `fn` with PUSH_TOKEN_PROOF_SECRET set (or removed, for null). */
async function withSecret(secret, fn) {
	const previous = process.env.PUSH_TOKEN_PROOF_SECRET;
	if (secret === null) delete process.env.PUSH_TOKEN_PROOF_SECRET;
	else process.env.PUSH_TOKEN_PROOF_SECRET = secret;
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.PUSH_TOKEN_PROOF_SECRET;
		else process.env.PUSH_TOKEN_PROOF_SECRET = previous;
	}
}

const row = (overrides) => ({
	token: TOKEN,
	userId: "user_old",
	platform: "android",
	webP256dh: null,
	webAuth: null,
	deviceBound: false,
	proofNonce: NONCE,
	timezone: "UTC",
	...overrides,
});

const proofFor = (table) => pushTokenProof(SECRET, TOKEN, table.row.proofNonce);

// -- the proof ---------------------------------------------------------------

test("the proof is a base64url HMAC of the token and the row's nonce", () => {
	assert.match(PROOF, /^[A-Za-z0-9_-]{43}$/);
	assert.equal(pushTokenProof(SECRET, TOKEN, NONCE), PROOF);
	assert.notEqual(pushTokenProof(SECRET, "ExponentPushToken[device-2]", NONCE), PROOF);
	assert.notEqual(pushTokenProof(SECRET, TOKEN, "nonce-2"), PROOF);
	assert.notEqual(pushTokenProof("another-secret", TOKEN, NONCE), PROOF);
	assert.equal(isValidPushTokenProof(SECRET, TOKEN, NONCE, PROOF), true);
	for (const wrong of [undefined, null, "", "short", PROOF.slice(1), `${PROOF}x`, pushTokenProof(SECRET, TOKEN, "nonce-2")]) {
		assert.equal(isValidPushTokenProof(SECRET, TOKEN, NONCE, wrong), false, String(wrong));
	}
	// A row with no nonce yet has no valid proof at all.
	assert.equal(isValidPushTokenProof(SECRET, TOKEN, null, PROOF), false);
});

test("nonces are random and an unset or blank secret turns the feature off", () => {
	assert.match(createPushTokenNonce(), /^[A-Za-z0-9_-]{22}$/);
	assert.notEqual(createPushTokenNonce(), createPushTokenNonce());
	assert.equal(pushTokenProofSecret({}), null);
	assert.equal(pushTokenProofSecret({ PUSH_TOKEN_PROOF_SECRET: "  " }), null);
	assert.equal(pushTokenProofSecret({ PUSH_TOKEN_PROOF_SECRET: SECRET }), SECRET);
});

// -- the route ---------------------------------------------------------------

test("a device-bound token refuses another account without its proof, or with a wrong one", async () => {
	await withSecret(SECRET, async () => {
		for (const extra of [{}, { proof: "wrong" }, { proof: pushTokenProof(SECRET, TOKEN, "nonce-2") }]) {
			const route = loadRoute({ row: row({ deviceBound: true }) });
			const response = await route.register(extra);
			assert.equal(response.status, 400, JSON.stringify(extra));
			// The same answer a malformed subscription gets, so nothing is confirmed.
			assert.match(response.body.error, /^Invalid input/);
			assert.equal(route.table.row.userId, "user_old", "a refused move still wrote");
			assert.ok(!route.calls.includes("updateMany"));
		}
	});
});

test("a device-bound token moves with its proof and keeps its nonce, so the device keeps working", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute({ row: row({ deviceBound: true }) });
		const response = await route.register({ proof: PROOF });
		assert.equal(response.status, 200);
		assert.deepEqual(response.body, { id: "row-1", proof: PROOF });
		assert.equal(route.table.row.userId, "user_new");
		assert.equal(route.table.row.deviceBound, true);
		assert.equal(route.table.row.proofNonce, NONCE);
	});
});

test("an unbound token moves as before, but its nonce rotates and every earlier proof dies", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute({ row: row({ deviceBound: false }) });
		const response = await route.register();
		assert.equal(response.status, 200);
		assert.equal(route.table.row.userId, "user_new");
		assert.equal(route.table.row.deviceBound, false);
		assert.notEqual(route.table.row.proofNonce, NONCE);
		// The new owner is handed the proof for the NEW nonce...
		assert.deepEqual(response.body, { id: "row-1", proof: proofFor(route.table) });
		// ...and the proof the previous holder kept no longer validates.
		assert.equal(isValidPushTokenProof(SECRET, TOKEN, route.table.row.proofNonce, PROOF), false);
	});
});

test("someone who once held a proof cannot take the token back after the device binds", async () => {
	await withSecret(SECRET, async () => {
		// The attacker registered the victim's old-build token and kept its proof.
		const attacker = loadRoute({ row: row({ userId: "user_victim" }), userId: "user_attacker" });
		const stolenProof = (await attacker.register()).body.proof;

		// The victim's updated app moves it back, gets a fresh proof and binds.
		const victim = loadRoute({ row: attacker.table.row, userId: "user_victim" });
		const handed = (await victim.register()).body.proof;
		assert.notEqual(handed, stolenProof);
		const bound = loadRoute({ row: victim.table.row, userId: "user_victim" });
		await bound.register({ proof: handed });
		assert.equal(bound.table.row.deviceBound, true);

		// The stale proof is refused.
		const retry = loadRoute({ row: bound.table.row, userId: "user_attacker" });
		const response = await retry.register({ proof: stolenProof });
		assert.equal(response.status, 400);
		assert.equal(retry.table.row.userId, "user_victim");
	});
});

test("the first registration that echoes the proof binds the row without changing the nonce", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute({ row: row({ userId: "user_new" }) });
		const response = await route.register({ proof: PROOF });
		assert.equal(route.table.row.deviceBound, true);
		assert.equal(route.table.row.proofNonce, NONCE);
		assert.equal(response.body.proof, PROOF);
	});
});

test("the owner always refreshes and gets the current proof, and is never unbound", async () => {
	await withSecret(SECRET, async () => {
		for (const deviceBound of [false, true]) {
			for (const extra of [{}, { proof: "stale" }, { proof: PROOF }]) {
				const route = loadRoute({ row: row({ userId: "user_new", deviceBound }) });
				const response = await route.register(extra);
				assert.equal(response.status, 200);
				assert.deepEqual(response.body, { id: "row-1", proof: PROOF });
				assert.equal(route.table.row.proofNonce, NONCE);
				assert.equal(route.table.row.deviceBound, deviceBound || extra.proof === PROOF);
			}
		}
	});
});

test("a row from before the nonce gets one on its first registration", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute({ row: row({ userId: "user_new", proofNonce: null }) });
		const response = await route.register({ proof: "v1-proof" });
		assert.match(route.table.row.proofNonce, /^[A-Za-z0-9_-]{22}$/);
		assert.equal(route.table.row.deviceBound, false);
		assert.deepEqual(response.body, { id: "row-1", proof: proofFor(route.table) });
	});
});

test("a new token is created unbound with a nonce, and handed its proof", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute();
		const response = await route.register({ proof: PROOF });
		assert.equal(route.table.row.deviceBound, false);
		assert.ok(route.table.row.proofNonce);
		assert.deepEqual(response.body, { id: "row-new", proof: proofFor(route.table) });
	});
});

test("a proof-less move that loses a race to the owner binding is decided again, and refused", async () => {
	await withSecret(SECRET, async () => {
		// Between the attacker's read and write, the owner's device binds the row.
		const route = loadRoute({
			row: row({ userId: "user_victim", deviceBound: false }),
			userId: "user_attacker",
			afterRead: (table, reads) => {
				if (reads === 1) table.row = { ...table.row, deviceBound: true };
			},
		});
		const response = await route.register();
		assert.equal(response.status, 400);
		assert.equal(route.table.row.userId, "user_victim");
		assert.deepEqual(route.calls, ["findUnique", "updateMany", "findUnique"]);
	});
});

test("a create that loses to a concurrent registration is decided again against that row", async () => {
	await withSecret(SECRET, async () => {
		const bound = row({ userId: "user_victim", deviceBound: true });
		const route = loadRoute({
			userId: "user_attacker",
			afterRead: (table, reads) => {
				if (reads === 1) table.row = { id: "row-1", ...bound };
			},
		});
		const response = await route.register();
		assert.equal(response.status, 400);
		assert.equal(route.table.row.userId, "user_victim");
		assert.deepEqual(route.calls, ["findUnique", "create", "findUnique"]);
	});
});

test("a write that keeps missing is refused rather than retried forever", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute({
			row: row({ userId: "user_old" }),
			afterRead: (table) => {
				table.row = { ...table.row, proofNonce: createPushTokenNonce() };
			},
		});
		const response = await route.register();
		assert.equal(response.status, 400);
		assert.equal(route.table.row.userId, "user_old");
		assert.deepEqual(route.calls, ["findUnique", "updateMany", "findUnique", "updateMany", "findUnique"]);
	});
});

test("two misses against the caller's own row answer with that row, not a refusal", async () => {
	await withSecret(SECRET, async () => {
		// The caller's own launch and settings-change registrations racing.
		const route = loadRoute({
			row: row({ userId: "user_new", deviceBound: true }),
			afterRead: (table, reads) => {
				if (reads <= 2) table.row = { ...table.row, proofNonce: createPushTokenNonce() };
			},
		});
		const response = await route.register({ proof: PROOF });
		assert.equal(response.status, 200);
		assert.deepEqual(response.body, { id: "row-1", proof: proofFor(route.table) });
		assert.deepEqual(route.calls, ["findUnique", "updateMany", "findUnique", "updateMany", "findUnique"]);
	});
});

test("with no secret the route behaves exactly as before: no proof, no binding, nonce untouched", async () => {
	await withSecret(null, async () => {
		const route = loadRoute({ row: row({ deviceBound: true }) });
		const response = await route.register({ proof: PROOF });
		assert.equal(response.status, 200);
		assert.deepEqual(response.body, { id: "row-1" });
		assert.equal(route.table.row.userId, "user_new");
		assert.equal(route.table.row.proofNonce, NONCE);

		const fresh = loadRoute();
		assert.deepEqual((await fresh.register()).body, { id: "row-new" });
		assert.equal(fresh.table.row.deviceBound, false);
		assert.equal(fresh.table.row.proofNonce, null);
	});
});

test("a browser subscription is never handed a device proof or a nonce", async () => {
	await withSecret(SECRET, async () => {
		const route = loadRoute();
		const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
		const response = await route.register({ token: endpoint, platform: "web", keys: { p256dh: "P", auth: "A" } });
		assert.equal(response.status, 200);
		assert.deepEqual(response.body, { id: "row-new" });
		assert.equal(route.table.row.proofNonce, null);
	});
});
