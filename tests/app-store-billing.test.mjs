// App Store (StoreKit 2) billing: the pure rules, the verify/notification
// orchestration with Apple's verifier and Prisma mocked, the plan merge, and
// the middleware publicness of the notification endpoint. Nothing here talks
// to Apple or a database.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(file, resolve) {
	const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText;
	const mod = { exports: {} };
	new Function("require", "module", "exports", code)((id) => resolve(id) ?? require(id), mod, mod.exports);
	return mod.exports;
}

const rules = load("src/lib/billing/app-store-rules.ts", () => undefined);
const rootCa = load("src/lib/billing/apple-root-ca.ts", () => undefined);
const PRODUCT = "com.spragginsdesigns.sureword.pro.monthly";
const DAY = 86_400_000;
const NOW = new Date("2026-10-07T12:00:00Z");

function tx(extra = {}) {
	return {
		transactionId: "1001",
		originalTransactionId: "1000",
		productId: PRODUCT,
		bundleId: "com.spragginsdesigns.sureword",
		type: "Auto-Renewable Subscription",
		purchaseDate: NOW.getTime() - DAY,
		expiresDate: NOW.getTime() + 29 * DAY,
		appAccountToken: rules.appAccountToken("user-1"),
		signedDate: NOW.getTime(),
		environment: "Sandbox",
		...extra,
	};
}

function row(extra = {}) {
	return {
		userId: "user-1",
		originalTransactionId: "1000",
		latestTransactionId: "1001",
		productId: PRODUCT,
		status: "active",
		periodStart: new Date(NOW.getTime() - DAY),
		expiresAt: new Date(NOW.getTime() + 29 * DAY),
		cancelAtPeriodEnd: false,
		gracePeriodExpiresAt: null,
		lastSignedAt: new Date(0),
		appAccountToken: rules.appAccountToken("user-1"),
		...extra,
	};
}

// ---------------------------------------------------------------------------
// appAccountToken
// ---------------------------------------------------------------------------

test("appAccountToken is UUIDv5 over the Clerk id with the fixed namespace (shared vector with Swift)", () => {
	assert.equal(rules.APP_ACCOUNT_TOKEN_NAMESPACE, "2f58cff8-d92f-43e2-93d6-d21633bffbe5");
	// Cross-checked with Python's uuid.uuid5 and asserted in
	// macos/SureWord-iOSTests/StoreKitBillingTests.swift.
	assert.equal(rules.appAccountToken("user_2abcDEFghiJKLmnoPQRstu"), "b6ef9ddb-a89c-561d-9a09-9e5fbddc845c");
	assert.equal(rules.appAccountToken("user_x"), "693f7414-5fdc-5367-b107-2bdcf533e9c5");
	assert.match(rules.appAccountToken("anything"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.ok(rules.sameToken("B6EF9DDB-A89C-561D-9A09-9E5FBDDC845C", "b6ef9ddb-a89c-561d-9a09-9e5fbddc845c"));
	assert.equal(rules.sameToken(undefined, "x"), false);
});

// ---------------------------------------------------------------------------
// Configuration and the SureWord-only scope
// ---------------------------------------------------------------------------

test("App Store billing is unavailable until SureWord's app id and usage are configured", () => {
	assert.deepEqual(rules.appStoreConfig({}).environments, []);
	assert.equal(rules.appStoreConfig({ APP_STORE_APP_ID: "123" }).available, false, "usage must be enabled");
	const on = rules.appStoreConfig({ APP_STORE_APP_ID: "6700000001", SUREWORD_USAGE_ENABLED: "true" });
	assert.equal(on.available, true);
	assert.equal(on.bundleId, "com.spragginsdesigns.sureword");
	assert.equal(on.appAppleId, 6700000001);
	assert.deepEqual(on.environments, ["Production", "Sandbox"], "Production first, Sandbox fallback");
	assert.deepEqual(rules.appStoreConfig({ APP_STORE_APP_ID: "abc", SUREWORD_USAGE_ENABLED: "true" }).environments, []);
	assert.deepEqual(
		rules.appStoreConfig({ APP_STORE_ENVIRONMENT: "Sandbox", SUREWORD_USAGE_ENABLED: "true" }).environments,
		["Sandbox"],
	);
	assert.deepEqual(
		rules.appStoreConfig({ APP_STORE_ENVIRONMENT: "Production", SUREWORD_USAGE_ENABLED: "true" }).environments,
		[],
		"Production verification needs APP_STORE_APP_ID",
	);
});

test("a bundle id outside SureWord's is refused outright", () => {
	const other = rules.appStoreConfig({
		APP_STORE_APP_ID: "6774968606",
		APP_STORE_BUNDLE_ID: "com.linecrush.ios",
		SUREWORD_USAGE_ENABLED: "true",
	});
	assert.equal(other.available, false);
	assert.deepEqual(other.environments, []);
	const lookalike = rules.appStoreConfig({
		APP_STORE_APP_ID: "1",
		APP_STORE_BUNDLE_ID: "com.spragginsdesigns.surewordx",
		SUREWORD_USAGE_ENABLED: "true",
	});
	assert.equal(lookalike.available, false);
});

test("unsigned Xcode StoreKit transactions are never accepted on a production deployment", () => {
	assert.deepEqual(
		rules.appStoreConfig({ APP_STORE_ENVIRONMENT: "Xcode", SUREWORD_USAGE_ENABLED: "true" }).environments,
		["Xcode"],
	);
	for (const env of [{ VERCEL_ENV: "production" }, { NODE_ENV: "production" }]) {
		assert.equal(
			rules.appStoreConfig({ APP_STORE_ENVIRONMENT: "Xcode", SUREWORD_USAGE_ENABLED: "true", ...env }).available,
			false,
		);
	}
});

test("the bundled Apple Root CA G3 is the genuine certificate", () => {
	const cert = new X509Certificate(Buffer.from(rootCa.APPLE_ROOT_CA_G3_BASE64, "base64"));
	assert.equal(cert.fingerprint256, rootCa.APPLE_ROOT_CA_G3_SHA256);
	assert.equal(cert.fingerprint256, "63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79");
	assert.match(cert.subject, /CN=Apple Root CA - G3/);
	assert.ok(cert.ca);
});

// ---------------------------------------------------------------------------
// Transaction state
// ---------------------------------------------------------------------------

test("a transaction is active until it expires, and never once revoked", () => {
	assert.equal(rules.stateFromTransaction(tx(), undefined, NOW).status, "active");
	assert.equal(rules.stateFromTransaction(tx({ expiresDate: NOW.getTime() - 1 }), undefined, NOW).status, "expired");
	assert.equal(rules.stateFromTransaction(tx({ revocationDate: NOW.getTime() }), undefined, NOW).status, "revoked");
	const state = rules.stateFromTransaction(tx(), { autoRenewStatus: 0 }, NOW);
	assert.equal(state.cancelAtPeriodEnd, true);
	assert.equal(state.periodStart.getTime(), NOW.getTime() - DAY);
	assert.throws(() => rules.stateFromTransaction(tx({ productId: "com.linecrush.ios.pro" }), undefined, NOW), /not SureWord Pro/);
	assert.throws(() => rules.stateFromTransaction(tx({ type: "Consumable" }), undefined, NOW), /not a subscription/);
	assert.throws(() => rules.stateFromTransaction(tx({ expiresDate: undefined }), undefined, NOW), /no subscription period/);
});

test("a lapsed transaction stays active through Apple's billing grace period", () => {
	const lapsed = tx({ purchaseDate: NOW.getTime() - 31 * DAY, expiresDate: NOW.getTime() - DAY });
	const grace = NOW.getTime() + 6 * DAY;
	const state = rules.stateFromTransaction(lapsed, { isInBillingRetryPeriod: true, gracePeriodExpiresDate: grace }, NOW);
	assert.equal(state.status, "active");
	assert.equal(state.expiresAt.getTime(), grace);
	assert.equal(state.gracePeriodExpiresAt.getTime(), grace);
	const retry = rules.stateFromTransaction(lapsed, { isInBillingRetryPeriod: true }, NOW);
	assert.equal(retry.status, "billing_retry");
});

test("a device can never un-revoke a refunded purchase or roll the period back", () => {
	const next = rules.stateFromTransaction(tx(), undefined, NOW);
	assert.equal(rules.shouldApplyDeviceTransaction(null, next, NOW), true);
	assert.equal(rules.shouldApplyDeviceTransaction(row({ status: "revoked" }), next, NOW), false);
	assert.equal(rules.shouldApplyDeviceTransaction(row(), next, NOW), false, "same transaction: notifications own it");
	const revoked = rules.stateFromTransaction(tx({ revocationDate: NOW.getTime() }), undefined, NOW);
	assert.equal(rules.shouldApplyDeviceTransaction(row(), revoked, NOW), true, "the device may report its own refund");
	const renewal = rules.stateFromTransaction(
		tx({ transactionId: "1002", purchaseDate: NOW.getTime(), expiresDate: NOW.getTime() + 60 * DAY }),
		undefined,
		NOW,
	);
	assert.equal(rules.shouldApplyDeviceTransaction(row(), renewal, NOW), true);
	const older = rules.stateFromTransaction(
		tx({ transactionId: "999", purchaseDate: NOW.getTime() - 40 * DAY, expiresDate: NOW.getTime() - 10 * DAY }),
		undefined,
		NOW,
	);
	assert.equal(rules.shouldApplyDeviceTransaction(row(), older, NOW), false);
});

// ---------------------------------------------------------------------------
// Notification state transitions
// ---------------------------------------------------------------------------

function notify(type, subtype, transaction = tx(), renewal, signedDate = NOW.getTime()) {
	return rules.applyNotification(
		row(),
		{ notificationType: type, subtype, notificationUUID: "u", signedDate, transaction, renewal },
		NOW,
	);
}

test("SUBSCRIBED and DID_RENEW move the row to the new paid period", () => {
	const renewed = tx({ transactionId: "1002", purchaseDate: NOW.getTime(), expiresDate: NOW.getTime() + 30 * DAY });
	for (const type of ["SUBSCRIBED", "DID_RENEW"]) {
		const decision = notify(type, undefined, renewed, { autoRenewStatus: 1 });
		assert.equal(decision.kind, "update");
		assert.equal(decision.data.status, "active");
		assert.equal(decision.data.latestTransactionId, "1002");
		assert.equal(decision.data.expiresAt.getTime(), NOW.getTime() + 30 * DAY);
		assert.equal(decision.data.lastNotificationType, type);
		assert.equal(decision.data.lastSignedAt.getTime(), NOW.getTime());
	}
});

test("DID_FAIL_TO_RENEW keeps access in grace, and loses it without grace", () => {
	const lapsed = tx({ purchaseDate: NOW.getTime() - 31 * DAY, expiresDate: NOW.getTime() - DAY });
	const grace = notify("DID_FAIL_TO_RENEW", "GRACE_PERIOD", lapsed, {
		isInBillingRetryPeriod: true,
		gracePeriodExpiresDate: NOW.getTime() + 5 * DAY,
	});
	assert.equal(grace.data.status, "active");
	assert.equal(grace.data.expiresAt.getTime(), NOW.getTime() + 5 * DAY);
	const noGrace = notify("DID_FAIL_TO_RENEW", undefined, lapsed, { isInBillingRetryPeriod: true });
	assert.equal(noGrace.data.status, "billing_retry");
	assert.equal(noGrace.data.gracePeriodExpiresAt, null);
});

test("EXPIRED and GRACE_PERIOD_EXPIRED end access", () => {
	const lapsed = tx({ purchaseDate: NOW.getTime() - 31 * DAY, expiresDate: NOW.getTime() - DAY });
	assert.equal(notify("EXPIRED", "VOLUNTARY", lapsed).data.status, "expired");
	const graceOver = notify("GRACE_PERIOD_EXPIRED", undefined, lapsed, { isInBillingRetryPeriod: true });
	assert.equal(graceOver.data.status, "billing_retry");
	assert.equal(graceOver.data.expiresAt.getTime(), NOW.getTime() - DAY);
});

test("REFUND and REVOKE revoke even inside the paid period", () => {
	for (const type of ["REFUND", "REVOKE"]) {
		const decision = notify(type, undefined, tx({ revocationDate: NOW.getTime() }));
		assert.equal(decision.data.status, "revoked");
	}
	assert.equal(notify("REFUND", undefined, tx()).data.status, "revoked", "the notification type alone revokes");
});

test("DID_CHANGE_RENEWAL_STATUS only flips cancelAtPeriodEnd", () => {
	const off = notify("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", tx(), { autoRenewStatus: 0 });
	assert.equal(off.data.cancelAtPeriodEnd, true);
	assert.equal(off.data.status, "active");
	assert.equal(off.data.expiresAt.getTime(), row().expiresAt.getTime());
	const on = rules.applyNotification(
		row({ cancelAtPeriodEnd: true }),
		{ notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED", signedDate: NOW.getTime(), transaction: tx() },
		NOW,
	);
	assert.equal(on.data.cancelAtPeriodEnd, false);
	const revoked = rules.applyNotification(
		row({ status: "revoked" }),
		{ notificationType: "DID_CHANGE_RENEWAL_STATUS", subtype: "AUTO_RENEW_ENABLED", signedDate: NOW.getTime(), transaction: tx() },
		NOW,
	);
	assert.equal(revoked.data.status, "revoked", "a renewal toggle never restores a revoked row");
});

test("unknown types, stale deliveries and other subscriptions are no-ops", () => {
	assert.deepEqual(notify("PRICE_INCREASE"), { kind: "ignore", reason: "unhandled" });
	assert.deepEqual(notify("SOMETHING_NEW"), { kind: "ignore", reason: "unhandled" });
	assert.deepEqual(notify("DID_RENEW", undefined, tx({ originalTransactionId: "other" })), { kind: "ignore", reason: "mismatch" });
	assert.deepEqual(notify("DID_RENEW", undefined, tx({ productId: "com.linecrush.ios.pro" })), { kind: "ignore", reason: "mismatch" });
	assert.deepEqual(notify("DID_RENEW", undefined, null), { kind: "ignore", reason: "mismatch" });
	const stale = rules.applyNotification(
		row({ lastSignedAt: new Date(NOW.getTime() + 1000) }),
		{ notificationType: "REFUND", signedDate: NOW.getTime(), transaction: tx() },
		NOW,
	);
	assert.deepEqual(stale, { kind: "ignore", reason: "stale" });
});

// ---------------------------------------------------------------------------
// Orchestration (app-store.ts) with Apple's verifier and Prisma mocked
// ---------------------------------------------------------------------------

function harness(t) {
	const state = { rows: [], events: new Set(), decoded: new Map(), verifierEnvs: [], locked: false };
	class VerificationException extends Error {
		constructor(status) {
			super(`verification ${status}`);
			this.status = status;
		}
	}
	const VerificationStatus = { RETRYABLE_VERIFICATION_FAILURE: 2, INVALID_ENVIRONMENT: 4 };
	class SignedDataVerifier {
		constructor(roots, online, environment, bundleId, appAppleId) {
			assert.equal(roots.length, 1);
			assert.equal(online, true);
			assert.equal(bundleId, "com.spragginsdesigns.sureword", "every verifier is scoped to SureWord");
			if (environment === "Production") assert.equal(appAppleId, 6700000001);
			this.environment = environment;
			state.verifierEnvs.push(environment);
		}
		decode(jws) {
			const entry = state.decoded.get(jws);
			if (!entry) throw new VerificationException(1);
			if (entry.retryable) throw new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE);
			if (entry.environment !== this.environment) throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);
			return entry.value;
		}
		async verifyAndDecodeTransaction(jws) { return this.decode(jws); }
		async verifyAndDecodeRenewalInfo(jws) { return this.decode(jws); }
		async verifyAndDecodeNotification(jws) { return this.decode(jws); }
	}
	const match = (r, where) => Object.entries(where).every(([k, v]) => r[k] === v);
	const db = {
		$queryRaw: async () => { state.locked = true; return []; },
		$transaction: async (fn) => {
			const before = structuredClone(state.rows);
			const events = new Set(state.events);
			try { return await fn(db); } catch (e) { state.rows = before; state.events = events; throw e; } finally { state.locked = false; }
		},
		appStoreSubscription: {
			findUnique: async ({ where }) => structuredClone(state.rows.find((r) => match(r, where)) ?? null),
			create: async ({ data }) => { assert.ok(state.locked); state.rows.push(structuredClone(data)); return structuredClone(data); },
			update: async ({ where, data }) => {
				assert.ok(state.locked);
				const r = state.rows.find((c) => match(c, where));
				Object.assign(r, structuredClone(data));
				return structuredClone(r);
			},
		},
		billingEvent: {
			findUnique: async ({ where }) => (state.events.has(where.id) ? { id: where.id } : null),
			create: async ({ data }) => { state.events.add(data.id); return data; },
		},
	};
	const api = load("src/lib/billing/app-store.ts", (id) => {
		if (id === "server-only") return {};
		if (id === "@/lib/prisma") return { prisma: db };
		if (id === "./app-store-rules") return rules;
		if (id === "./apple-root-ca") return rootCa;
		if (id === "@apple/app-store-server-library")
			return { SignedDataVerifier, VerificationException, VerificationStatus, Environment: { PRODUCTION: "Production", SANDBOX: "Sandbox", XCODE: "Xcode" } };
		return undefined;
	});
	const keys = ["APP_STORE_APP_ID", "APP_STORE_BUNDLE_ID", "APP_STORE_ENVIRONMENT", "SUREWORD_USAGE_ENABLED"];
	const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
	process.env.APP_STORE_APP_ID = "6700000001";
	process.env.SUREWORD_USAGE_ENABLED = "true";
	delete process.env.APP_STORE_BUNDLE_ID;
	delete process.env.APP_STORE_ENVIRONMENT;
	t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
	let n = 0;
	const sign = (value, environment = "Sandbox", extra = {}) => {
		const jws = `h${++n}.p${n}.s${n}`;
		state.decoded.set(jws, { value, environment, ...extra });
		return jws;
	};
	const notification = (type, transaction, { subtype, uuid = `uuid-${n + 1}`, signedDate = Date.now(), environment = "Sandbox", renewal } = {}) =>
		sign({
			notificationType: type,
			subtype,
			notificationUUID: uuid,
			signedDate,
			data: {
				bundleId: "com.spragginsdesigns.sureword",
				signedTransactionInfo: transaction ? sign(transaction, environment) : undefined,
				signedRenewalInfo: renewal ? sign(renewal, environment) : undefined,
			},
		}, environment);
	return { api, state, sign, notification };
}

function liveTx(extra = {}) {
	return tx({ purchaseDate: Date.now() - DAY, expiresDate: Date.now() + 29 * DAY, signedDate: Date.now(), ...extra });
}

test("verify binds a genuine purchase to the account its appAccountToken names (Sandbox fallback)", async (t) => {
	const { api, state, sign } = harness(t);
	const result = await api.verifyDeviceTransaction("user-1", sign(liveTx(), "Sandbox"));
	assert.equal(result.active, true);
	assert.deepEqual(state.verifierEnvs, ["Production", "Sandbox"], "Production is tried first");
	assert.equal(state.rows.length, 1);
	assert.equal(state.rows[0].userId, "user-1");
	assert.equal(state.rows[0].environment, "Sandbox");
	assert.equal(state.rows[0].originalTransactionId, "1000");
	assert.equal(state.rows[0].lastSignedAt.getTime(), 0, "device transactions never move the notification clock");
	// Idempotent for the same transaction.
	assert.equal((await api.verifyDeviceTransaction("user-1", sign(liveTx(), "Sandbox"))).active, true);
	assert.equal(state.rows.length, 1);
});

test("verify refuses another account's purchase and an unsigned or foreign one", async (t) => {
	const { api, state, sign } = harness(t);
	await assert.rejects(api.verifyDeviceTransaction("user-2", sign(liveTx())), (e) => e instanceof api.AppStoreBindingError);
	await assert.rejects(
		api.verifyDeviceTransaction("user-2", sign(liveTx({ appAccountToken: undefined }))),
		(e) => e instanceof api.AppStoreBindingError,
		"a token-less purchase cannot create a binding",
	);
	await api.verifyDeviceTransaction("user-1", sign(liveTx()));
	await assert.rejects(
		api.verifyDeviceTransaction("user-2", sign(liveTx({ appAccountToken: rules.appAccountToken("user-2") }))),
		/belongs to another account/,
	);
	await assert.rejects(api.verifyDeviceTransaction("user-1", "not-a-jws"), (e) => e instanceof api.AppStoreVerificationError && !e.retryable);
	await assert.rejects(api.verifyDeviceTransaction("user-1", "a.b.c"), (e) => e instanceof api.AppStoreVerificationError && !e.retryable);
	await assert.rejects(api.verifyDeviceTransaction("user-1", sign(liveTx(), "Sandbox", { retryable: true })), (e) => e.retryable === true);
	await assert.rejects(api.verifyDeviceTransaction("user-1", sign(liveTx({ productId: "com.linecrush.ios.pro" }))), /not SureWord Pro/);
	assert.equal(state.rows.length, 1);
	assert.equal(state.rows[0].userId, "user-1");
});

test("verify is unavailable until configured", async (t) => {
	const { api, sign } = harness(t);
	delete process.env.APP_STORE_APP_ID;
	await assert.rejects(api.verifyDeviceTransaction("user-1", sign(liveTx())), /not available/);
});

test("notifications are idempotent by notificationUUID and move the bound row", async (t) => {
	const { api, state, sign, notification } = harness(t);
	await api.verifyDeviceTransaction("user-1", sign(liveTx()));
	const refund = notification("REFUND", liveTx({ revocationDate: Date.now() }), { uuid: "refund-1" });
	assert.deepEqual(await api.processNotification(refund), { result: "applied" });
	assert.equal(state.rows[0].status, "revoked");
	assert.ok(state.events.has("app-store:refund-1"));
	// Apple redelivers the same notification: nothing changes.
	state.rows[0].status = "sentinel";
	assert.deepEqual(await api.processNotification(refund), { result: "duplicate" });
	assert.equal(state.rows[0].status, "sentinel");
});

test("unknown notification types and TEST are 200 no-ops; unbound subscriptions are left alone", async (t) => {
	const { api, state, sign, notification } = harness(t);
	assert.deepEqual(await api.processNotification(notification("TEST")), { result: "test" });
	assert.deepEqual(await api.processNotification(notification("CONSUMPTION_REQUEST", liveTx(), { uuid: "c-1" })), { result: "ignored" });
	assert.ok(state.events.has("app-store:c-1"));
	assert.deepEqual(await api.processNotification(notification("DID_RENEW", liveTx(), { uuid: "r-1" })), { result: "unknown-subscription" });
	assert.equal(state.rows.length, 0);
	await api.verifyDeviceTransaction("user-1", sign(liveTx()));
	const old = notification("REFUND", liveTx(), { uuid: "old", signedDate: 5 });
	const newer = notification("DID_CHANGE_RENEWAL_STATUS", liveTx(), { uuid: "new", subtype: "AUTO_RENEW_DISABLED", renewal: { autoRenewStatus: 0 } });
	assert.deepEqual(await api.processNotification(newer), { result: "applied" });
	assert.equal(state.rows[0].cancelAtPeriodEnd, true);
	assert.deepEqual(await api.processNotification(old), { result: "ignored" }, "an older delivery never overwrites a newer one");
	assert.equal(state.rows[0].status, "active");
	await assert.rejects(api.processNotification("x.y.z"), (e) => e instanceof api.AppStoreVerificationError && !e.retryable);
});

// ---------------------------------------------------------------------------
// Plan merge
// ---------------------------------------------------------------------------

function planHarness() {
	const s = { stripe: null, play: null, appStore: [], plan: "free" };
	const prisma = {
		billingSubscription: { findUnique: async () => s.stripe },
		googlePlaySubscription: { findUnique: async () => s.play },
		appStoreSubscription: { findMany: async () => s.appStore },
		user: { findUnique: async () => ({ plan: s.plan }) },
	};
	const plans = load("src/lib/billing/plans.ts", () => undefined);
	const subscription = load("src/lib/billing/subscription.ts", (id) =>
		id === "server-only" ? {} : id === "@/lib/prisma" ? { prisma } : id === "./plans" ? plans : id === "./app-store-rules" ? rules : undefined,
	);
	const entitlements = load("src/lib/entitlements.ts", (id) =>
		id === "server-only" ? {} :
		id === "@/lib/prisma" ? { prisma } :
		id === "@/lib/billing/plans" ? plans :
		id === "@/lib/billing/subscription" ? subscription :
		id === "@/lib/billing/google-play" ? { refreshGooglePlaySubscription: async () => {} } :
		id === "@/lib/entitlements-rules" ? load("src/lib/entitlements-rules.ts", () => undefined) : undefined,
	);
	return { s, subscription, entitlements };
}

const appStoreRow = (extra = {}) => ({
	userId: "u",
	originalTransactionId: "1000",
	status: "active",
	periodStart: new Date(Date.now() - DAY),
	expiresAt: new Date(Date.now() + 29 * DAY),
	cancelAtPeriodEnd: false,
	...extra,
});

test("an active App Store subscription makes the account Pro, exactly like Google Play", async (t) => {
	const keys = ["APP_STORE_APP_ID", "SUREWORD_USAGE_ENABLED", "PRO_USER_IDS", "SERVER_CREDENTIAL_USER_IDS", "SUREWORD_PLAY_BILLING_ENABLED"];
	const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
	t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
	for (const k of keys) delete process.env[k];
	process.env.SUREWORD_USAGE_ENABLED = "true";
	const { s, subscription, entitlements } = planHarness();
	s.appStore = [appStoreRow()];
	assert.equal(await entitlements.getUserPlan("u"), "free", "ignored until App Store billing is configured");
	process.env.APP_STORE_APP_ID = "6700000001";
	assert.equal(await entitlements.getUserPlan("u"), "pro");
	const sub = await subscription.accountSubscription("u");
	assert.equal(sub.provider, "app_store");
	assert.equal(sub.periodEnd.getTime(), s.appStore[0].expiresAt.getTime(), "the usage window follows expiresAt");
	s.appStore = [appStoreRow({ status: "revoked" })];
	assert.equal(await entitlements.getUserPlan("u"), "free");
	s.appStore = [appStoreRow({ expiresAt: new Date(Date.now() - 1) })];
	assert.equal(await entitlements.getUserPlan("u"), "free");
	s.appStore = [appStoreRow({ status: "revoked", expiresAt: new Date(Date.now() + 90 * DAY) }), appStoreRow({ originalTransactionId: "2000" })];
	assert.equal((await subscription.accountSubscription("u")).status, "active", "an active row speaks over a later revoked one");
	// An active Stripe subscription still comes first; lapsed history reports the latest end.
	s.stripe = { status: "active", periodStart: new Date(), periodEnd: new Date(Date.now() + DAY), stripeSubscriptionId: "sub" };
	assert.equal((await subscription.accountSubscription("u")).provider, "stripe");
	s.stripe = { status: "canceled", periodStart: new Date(0), periodEnd: new Date(1) };
	s.appStore = [appStoreRow({ status: "expired", expiresAt: new Date(Date.now() - DAY) })];
	assert.equal((await subscription.accountSubscription("u")).provider, "app_store");
	assert.equal(await entitlements.getUserPlan("u"), "free");
});

// ---------------------------------------------------------------------------
// Routes and middleware
// ---------------------------------------------------------------------------

test("only the notification endpoint is public; the device verify route stays behind the session", () => {
	const middleware = fs.readFileSync("src/middleware.ts", "utf8");
	assert.match(middleware, /"\/api\/billing\/app-store\/notifications",/);
	assert.doesNotMatch(middleware, /"\/api\/billing\/app-store\/verify"/);
	assert.doesNotMatch(middleware, /"\/api\/billing(\/app-store)?\(\.\*\)"/);
	const verify = fs.readFileSync("src/app/api/billing/app-store/verify/route.ts", "utf8");
	assert.match(verify, /getAuthUser\(\)/);
	assert.match(verify, /rejectCrossSiteMutation/);
	const status = fs.readFileSync("src/app/api/billing/status/route.ts", "utf8");
	assert.match(status, /appStoreCheckoutAvailable: appStoreBillingAvailable\(\)/);
});

test("nothing in the App Store lane references another app's resources", () => {
	for (const file of [
		"src/lib/billing/app-store.ts",
		"src/lib/billing/app-store-rules.ts",
		"src/app/api/billing/app-store/verify/route.ts",
		"src/app/api/billing/app-store/notifications/route.ts",
	]) {
		assert.doesNotMatch(fs.readFileSync(file, "utf8"), /linecrush|6774968606/i, file);
	}
});

test("Apple's real verifier takes the bundled root and rejects a forged transaction offline", async () => {
	const { SignedDataVerifier, Environment, VerificationException } = require("@apple/app-store-server-library");
	const root = Buffer.from(rootCa.APPLE_ROOT_CA_G3_BASE64, "base64");
	const verifier = new SignedDataVerifier([root], true, Environment.SANDBOX, "com.spragginsdesigns.sureword");
	const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const forged = [
		part({ alg: "ES256", x5c: ["a", "b", "c"] }),
		part({ bundleId: "com.spragginsdesigns.sureword", environment: "Sandbox", signedDate: Date.now() }),
		"c2ln",
	].join(".");
	await assert.rejects(verifier.verifyAndDecodeTransaction(forged), (e) => e instanceof VerificationException);
	assert.throws(
		() => new SignedDataVerifier([root], true, Environment.PRODUCTION, "com.spragginsdesigns.sureword"),
		/appAppleId is required/,
	);
});
