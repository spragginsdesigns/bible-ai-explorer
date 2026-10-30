import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { generateKeyPairSync, createSign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import ts from "typescript";

const require = createRequire(import.meta.url);
const filename = path.resolve("src/lib/billing/google-play.ts");
const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
class FixtureOidcClient extends OAuth2Client {
  async getFederatedSignonCertsAsync() {
    return { certs: { k1: publicKey.export({ type: "spki", format: "pem" }) }, format: "PEM" };
  }
}

function harness(t, { allowDiscoveryReads = false, failCommit = false } = {}) {
  let rows = [];
  let tail = Promise.resolve();
  let locked = false;
  let stripe = null;
  let appStore = [];
  let acknowledgements = 0;
  let acknowledgementStatus = 204;
  let readStatus = 200;
  let orderStatus = 200;
  let orderReads = 0;
  let lastPurchase;
  let verifiedToken;
  let getOrder = (orderId) => orderForPurchase(orderId, verifiedToken, lastPurchase);
  let beforeNextTransaction;
  const acknowledgementBodies = [];
  const readLocks = [];
  let reads = 0;
  let purchase;
  let getPurchase = () => purchase;
  const db = {
    billingSubscription: { findUnique: async () => stripe },
    appStoreSubscription: { findFirst: async ({ where }) => {
      assert.equal(locked, true, "competing paid store must be checked under the User lock");
      return appStore.find((row) => row.userId === where.userId && row.status === where.status && row.expiresAt > where.expiresAt.gt) ?? null;
    } },
    googlePlaySubscription: {
      findUnique: async ({ where }) => structuredClone(rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
      upsert: async ({ where, update, create }) => {
        assert.equal(locked, true);
        const row = rows.find((candidate) => candidate.userId === where.userId);
        if (row) Object.assign(row, update); else rows.push(structuredClone(create));
      },
      update: async ({ where, data }) => {
        assert.equal(locked, true);
        const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value));
        assert.ok(row);
        Object.assign(row, data);
      },
    },
    $queryRaw: async () => { locked = true; return []; },
    $transaction: async (fn, options) => {
      assert.equal(options.timeout, 45_000);
      const beforeTransaction = beforeNextTransaction; beforeNextTransaction = undefined;
      if (beforeTransaction) await beforeTransaction();
      const preceding = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await preceding;
      const before = structuredClone(rows);
      try {
        const result = await fn(db);
        if (failCommit) throw new Error("Transaction commit failed");
        return result;
      } catch (error) { rows = before; throw error; }
      finally { locked = false; release(); }
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (id) => id === "server-only" ? {} : id === "google-auth-library" ? { OAuth2Client: FixtureOidcClient } : id === "@/lib/prisma" ? { prisma: db } : id === "@/lib/ai/crypto" ? { encryptSecret: (v) => `enc:${v}`, decryptSecret: (v) => v.slice(4) } : id === "./plans" ? { activeSubscription: (s) => (s.status === "active" || s.status === "trialing") && s.periodEnd > new Date() } : require(id), module, module.exports,
  );
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("oauth2")) return Response.json({ access_token: "access", expires_in: 3600 });
    if (String(url).includes(":acknowledge")) { acknowledgements++; acknowledgementBodies.push(JSON.parse(options.body)); return new Response(null, { status: acknowledgementStatus }); }
    if (String(url).includes("/orders/")) {
      assert.equal(locked, true, "accounting must be bound to the locked V2 snapshot");
      orderReads++;
      if (orderStatus !== 200) return new Response(null, { status: orderStatus });
      return Response.json(await getOrder(decodeURIComponent(String(url).split("/orders/")[1])));
    }
    if (!allowDiscoveryReads) assert.equal(locked, true, "authoritative purchase fetch must occur after row lock");
    reads++;
    readLocks.push(locked);
    if (readStatus !== 200) return new Response(null, { status: readStatus });
    lastPurchase = await getPurchase(String(url));
    verifiedToken = decodeURIComponent(String(url).split("/tokens/")[1]);
    return Response.json(lastPurchase);
  });
  const oldEnv = { ...process.env };
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "play@example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  process.env.SUREWORD_USAGE_ENABLED = "true";
  process.env.SUREWORD_PLAY_BILLING_ENABLED = "true";
  t.after(() => {
    for (const key of ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "SUREWORD_USAGE_ENABLED", "SUREWORD_PLAY_BILLING_ENABLED", "SUREWORD_PLAY_RTDN_AUDIENCE", "SUREWORD_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL", "APP_STORE_APP_ID", "PRO_USER_IDS", "SERVER_CREDENTIAL_USER_IDS"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  });
  const api = module.exports;
  purchase = activePurchase(api.userBinding("user-1"));
  return { ...api, setRows: (value) => { rows = value; }, rows: () => rows, setPurchase: (value) => { purchase = value; }, setGetPurchase: (value) => { getPurchase = value; }, setStripe: (value) => { stripe = value; }, setAppStore: (value) => { appStore = value; }, setAcknowledgementStatus: (value) => { acknowledgementStatus = value; }, setReadStatus: (value) => { readStatus = value; }, setOrderStatus: (value) => { orderStatus = value; }, setGetOrder: (value) => { getOrder = value; }, orders: () => orderReads, beforeNextTransaction: (value) => { beforeNextTransaction = value; }, acknowledgementBodies: () => acknowledgementBodies, readLocks: () => readLocks, reads: () => reads, acknowledgements: () => acknowledgements, active: () => activePurchase(api.userBinding("user-1")), row: (token = "token", extra = {}) => ({ userId: "user-1", purchaseTokenHash: api.tokenHash(token), encryptedPurchaseToken: `enc:${token}`, productId: "sureword_pro", periodStart: new Date("2099-08-01T00:00:00Z"), periodEnd: new Date("2099-09-01T00:00:00Z"), status: "active", lastVerifiedAt: new Date(0), latestSuccessfulOrderId: "order-1", ...extra }) };
}
function activePurchase(binding) {
  return { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", startTime: "2026-01-01T00:00:00Z", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-10-01T00:00:00Z", latestSuccessfulOrderId: "order-2" }], externalAccountIdentifiers: { obfuscatedExternalAccountId: binding }, acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" };
}

function orderForPurchase(orderId, purchaseToken, purchase, startTime) {
  const end = new Date(purchase.lineItems[0].expiryTime);
  const start = new Date(end); const day = start.getUTCDate();
  start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 1);
  start.setUTCDate(Math.min(day, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()));
  return { orderId, purchaseToken, lineItems: [{ productId: "sureword_pro", subscriptionDetails: {
    basePlanId: "monthly", servicePeriodStartTime: startTime ?? new Date(Math.max(start.getTime(), new Date(purchase.startTime).getTime())).toISOString(), servicePeriodEndTime: end.toISOString(),
  } }] };
}

function expiredRow(h, token = "expired", extra = {}) {
  return h.row(token, { status: "revoked", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-02-01"), ...extra });
}

function outOfAppPurchase(h, extra = {}) {
  return { ...h.active(), startTime: "2026-03-01T00:00:00Z", externalAccountIdentifiers: undefined, outOfAppPurchaseContext: { expiredPurchaseToken: "expired", expiredExternalAccountIdentifiers: { obfuscatedExternalAccountId: h.userBinding("user-1") } }, ...extra };
}

function jwt(claims, key = privateKey) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const s = createSign("RSA-SHA256"); s.update(`${h}.${p}`);
  return `${h}.${p}.${s.sign(key).toString("base64url")}`;
}

function loadService(filename, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((id) => Object.hasOwn(imports, id) ? imports[id] : require(id), mod, mod.exports);
  return mod.exports;
}

function planService(h, afterInitialRead) {
  const plans = loadService("src/lib/billing/plans.ts"); let reads = 0;
  const db = {
    billingSubscription: { findUnique: async () => null },
    googlePlaySubscription: { findUnique: async () => {
      const snapshot = structuredClone(h.rows()[0]);
      if (reads++ === 0) afterInitialRead?.();
      return snapshot;
    } },
    appStoreSubscription: { findMany: async () => [] }, user: { findUnique: async () => ({ plan: "free" }) },
  };
  const subscription = loadService("src/lib/billing/subscription.ts", {
    "server-only": {}, "@/lib/prisma": { prisma: db }, "./plans": plans,
    "./app-store-rules": loadService("src/lib/billing/app-store-rules.ts"),
  });
  return loadService("src/lib/entitlements.ts", {
    "server-only": {}, "@vercel/functions": { waitUntil: () => {} }, "@/lib/prisma": { prisma: db },
    "@/lib/billing/plans": plans, "@/lib/billing/subscription": subscription,
    "@/lib/billing/google-play": h, "@/lib/entitlements-rules": loadService("src/lib/entitlements-rules.ts"),
  });
}

test("account binding is stable SHA-256 and distinguishes users", (t) => {
  const h = harness(t);
  assert.equal(h.userBinding("user-1"), "c6c289e49e9c05b2145860387b73bcb18df43fb09a1e4a4a9713c76c88bb541b");
  assert.notEqual(h.userBinding("user-1"), h.userBinding("user-2"));
});
test("monthly renewal advances the usage bucket and clamps March month-end", (t) => {
  const h = harness(t);
  const purchase = h.active();
  purchase.lineItems[0].expiryTime = "2027-03-31T08:15:00Z";
  const state = h.stateForPlayPurchase(purchase, new Date("2027-03-01"), { periodStart: new Date("2027-01-31T08:15:00Z"), periodEnd: new Date("2027-02-28T08:15:00Z"), latestSuccessfulOrderId: "order-1" });
  assert.equal(state.periodStart.toISOString(), "2027-02-28T08:15:00.000Z");
  assert.equal(state.latestSuccessfulOrderId, "order-2");
});
test("month-end calculation handles leap February", (t) => {
  const h = harness(t); const purchase = h.active(); purchase.lineItems[0].expiryTime = "2028-03-31T00:00:00Z";
  assert.equal(h.stateForPlayPurchase(purchase, new Date("2028-03-01")).periodStart.toISOString(), "2028-02-29T00:00:00.000Z");
});
test("same expiry, same order extension, and grace expiry extensions retain the usage bucket", (t) => {
  const h = harness(t); const previous = h.row();
  for (const kind of ["same-expiry", "same-order", "grace"]) {
    const purchase = h.active();
    if (kind === "same-expiry") purchase.lineItems[0].expiryTime = previous.periodEnd.toISOString();
    if (kind === "same-order") purchase.lineItems[0].latestSuccessfulOrderId = "order-1";
    if (kind === "grace") purchase.subscriptionState = "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
    assert.equal(h.stateForPlayPurchase(purchase, new Date(), previous).periodStart.getTime(), previous.periodStart.getTime());
  }
});
test("grace recovery with a new successful order advances quota period", (t) => {
  const h = harness(t); const previous = h.row("token", { periodEnd: new Date("2099-09-07") });
  assert.equal(h.stateForPlayPurchase(h.active(), new Date(), previous).periodStart.toISOString(), "2099-09-01T00:00:00.000Z");
});

test("validated Orders snapshots advance five-minute and month-end paid quotas", async (t) => {
  const h = harness(t);
  for (const [lifetime, oldStart, oldEnd, paidStart, paidEnd] of [
    ["2099-10-30T18:04:23.955Z", "2099-10-30T18:04:23.955Z", "2099-10-30T18:14:23.536Z", "2099-10-30T18:14:23.536Z", "2099-10-30T18:19:23.536Z"],
    ["2099-01-31T00:00:00Z", "2099-02-28T00:00:00Z", "2099-03-31T00:00:00Z", "2099-03-31T00:00:00Z", "2099-04-30T00:00:00Z"],
  ]) {
    const purchase = { ...h.active(), startTime: lifetime, lineItems: [{ productId: "sureword_pro", expiryTime: paidEnd, latestSuccessfulOrderId: "paid-order" }] };
    h.setRows([h.row("token", { periodStart: new Date(oldStart), periodEnd: new Date(oldEnd) })]); h.setPurchase(purchase);
    h.setGetOrder((id) => orderForPurchase(id, "token", purchase, paidStart));
    assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
    assert.equal(h.rows()[0].periodStart.toISOString(), new Date(paidStart).toISOString());
    assert.equal(h.rows()[0].periodEnd.toISOString(), new Date(paidEnd).toISOString());
    // A stale row with the same order can be repaired without another renewal.
    h.setRows([h.row("token", { periodStart: new Date(oldStart), periodEnd: new Date(paidEnd), latestSuccessfulOrderId: "paid-order" })]);
    await h.refreshBoundPurchase("token");
    assert.equal(h.rows()[0].periodStart.toISOString(), new Date(paidStart).toISOString());
  }
});

test("an initial accounting period may precede V2 lifetime start by the real grant-time skew", async (t) => {
  const h = harness(t);
  const purchase = { ...h.active(), startTime: "2099-10-30T18:27:00.781Z", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-10-30T18:32:00.388Z", latestSuccessfulOrderId: "initial-order" }] };
  h.setPurchase(purchase); h.setGetOrder((id) => orderForPurchase(id, "token", purchase, "2099-10-30T18:27:00.388Z"));
  await h.verifyAndBindPurchase("user-1", "token", "sureword_pro");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-10-30T18:27:00.388Z");
  assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-10-30T18:32:00.388Z");
  assert.equal(h.acknowledgements(), 1);
});

for (const path of ["verify", "RTDN", "cached"]) {
  test(`same-expiry grace recovery with grant-time skew advances the new paid order through ${path}`, async (t) => {
    const h = harness(t);
    const oldStart = "2099-10-30T18:27:00.388Z", nextStart = "2099-10-30T18:32:00.388Z", nextEnd = "2099-10-30T18:37:00.388Z";
    h.setRows([h.row("token", { periodStart: new Date(oldStart), periodEnd: new Date(nextStart), latestSuccessfulOrderId: "previous-paid-order" })]);
    const grace = { ...h.active(), startTime: "2099-10-30T18:27:00.781Z", linkedPurchaseToken: "predecessor", subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", lineItems: [{ productId: "sureword_pro", expiryTime: nextEnd, latestSuccessfulOrderId: "previous-paid-order" }] };
    h.setPurchase(grace); await h.refreshBoundPurchase("token");
    assert.equal(h.rows()[0].periodStart.toISOString(), oldStart);
    assert.equal(h.rows()[0].periodEnd.toISOString(), nextEnd);
    const recovered = { ...grace, subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ ...grace.lineItems[0], latestSuccessfulOrderId: "recovered-paid-order" }] };
    h.setPurchase(recovered); h.setGetOrder((id) => orderForPurchase(id, "token", recovered, nextStart));
    h.setRows(h.rows().map((row) => ({ ...row, lastVerifiedAt: new Date(0) })));
    const before = h.orders();
    if (path === "verify") await h.verifyAndBindPurchase("user-1", "token", "sureword_pro");
    else if (path === "RTDN") await h.refreshBoundPurchase("token");
    else assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
    assert.equal(h.rows()[0].periodStart.toISOString(), nextStart);
    assert.equal(h.rows()[0].periodEnd.toISOString(), nextEnd);
    assert.equal(h.rows()[0].latestSuccessfulOrderId, "recovered-paid-order");
    assert.equal(h.orders(), before + 1, "a different successful order must read its funded period despite unchanged expiry");
  });
}

test("same-expiry recovery retries accounting after persisting a new order during an outage", async (t) => {
  const h = harness(t);
  const oldStart = "2099-10-30T18:27:00.388Z", nextStart = "2099-10-30T18:32:00.388Z", nextEnd = "2099-10-30T18:37:00.388Z";
  h.setRows([h.row("token", { periodStart: new Date(oldStart), periodEnd: new Date(nextEnd), latestSuccessfulOrderId: "previous-paid-order", lastVerifiedAt: new Date() })]);
  const recovered = { ...h.active(), startTime: "2099-10-30T18:27:00.781Z", linkedPurchaseToken: "predecessor", lineItems: [{ productId: "sureword_pro", expiryTime: nextEnd, latestSuccessfulOrderId: "recovered-paid-order" }] };
  h.setPurchase(recovered); h.setGetOrder((id) => orderForPurchase(id, "token", recovered, nextStart)); h.setOrderStatus(503);
  await assert.rejects(() => h.refreshBoundPurchase("token"), /accounting retry/);
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.rows()[0].latestSuccessfulOrderId, "recovered-paid-order");
  assert.equal(h.rows()[0].periodStart.toISOString(), oldStart); assert.equal(h.rows()[0].lastVerifiedAt.getTime(), 0);
  const before = h.orders(); h.setOrderStatus(200);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  assert.equal(h.orders(), before + 1, "matching persisted order ID does not prove pending accounting was resolved");
  assert.equal(h.rows()[0].periodStart.toISOString(), nextStart); assert.ok(h.rows()[0].lastVerifiedAt.getTime() > 0);
});

test("grace, recovery and same-order deferral use paid boundaries without moving access expiry", async (t) => {
  const h = harness(t); h.setRows([h.row("token", { periodEnd: new Date("2099-09-07") })]);
  h.setPurchase({ ...h.active(), subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-09-08T00:00:00Z", latestSuccessfulOrderId: "order-1" }] });
  await h.refreshBoundPurchase("token");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-08-01T00:00:00.000Z"); assert.equal(h.orders(), 0);
  const recovered = h.active(); h.setPurchase(recovered);
  h.setGetOrder((id) => orderForPurchase(id, "token", recovered, "2099-09-01T00:00:00Z"));
  await h.refreshBoundPurchase("token");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-09-01T00:00:00.000Z");
  assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-10-01T00:00:00.000Z");
  const deferred = { ...recovered, lineItems: [{ ...recovered.lineItems[0], expiryTime: "2099-10-03T00:00:00Z" }] }; h.setPurchase(deferred);
  await h.refreshBoundPurchase("token");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-09-01T00:00:00.000Z");
  assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-10-03T00:00:00.000Z");
});

test("accounting identity, product, plan and date mismatches retain paid access and the prior quota", async (t) => {
  const h = harness(t); const purchase = h.active();
  for (const change of [
    (order) => { order.orderId = "different"; }, (order) => { order.purchaseToken = "different"; },
    (order) => { order.lineItems[0].productId = "different"; },
    (order) => { order.lineItems[0].subscriptionDetails.basePlanId = "annual"; },
    (order) => { order.lineItems[0].subscriptionDetails.servicePeriodStartTime = "invalid"; },
    (order) => { order.lineItems[0].subscriptionDetails.servicePeriodStartTime = order.lineItems[0].subscriptionDetails.servicePeriodEndTime; },
    (order) => { order.lineItems[0].subscriptionDetails.servicePeriodEndTime = "2099-11-01T00:00:00Z"; },
  ]) {
    h.setRows([h.row()]); const order = orderForPurchase("order-2", "token", purchase); change(order); h.setGetOrder(() => order);
    await h.verifyAndBindPurchase("user-1", "token", "sureword_pro");
    assert.equal(h.rows()[0].status, "active"); assert.equal(h.rows()[0].periodStart.toISOString(), "2099-08-01T00:00:00.000Z");
    assert.equal(h.rows()[0].lastVerifiedAt.getTime(), 0);
  }
  assert.equal(h.acknowledgements(), 7, "optional accounting never prevents legitimate acknowledgement");
});

test("Orders outage commits renewal then retries RTDN, while native bind and cache keep paid access", async (t) => {
  const h = harness(t); h.setOrderStatus(503);
  await h.verifyAndBindPurchase("user-1", "token", "sureword_pro");
  assert.equal(h.rows()[0].periodStart.toISOString(), h.active().startTime.replace("Z", ".000Z"));
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
  h.setRows([h.row()]);
  await assert.rejects(() => h.refreshBoundPurchase("token"), /accounting retry/);
  assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-10-01T00:00:00.000Z");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-08-01T00:00:00.000Z");
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  const reads = h.orders(); h.setOrderStatus(200);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true, "failed accounting remains stale for the next V2 refresh");
  assert.equal(h.orders(), reads + 1);
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-09-01T00:00:00.000Z");
});

test("RTDN returns accounting retry only after paid state commits and then heals on redelivery", async (t) => {
  const h = harness(t); h.setRows([expiredRow(h, "token")]); h.setOrderStatus(503);
  const route = loadService("src/app/api/webhooks/google-play/route.ts", { "@/lib/billing/google-play": { ...h, verifyRtdnOidc: async () => ({}) } });
  const request = () => new Request("https://sureword.test/api/webhooks/google-play", { method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ packageName: process.env.SUREWORD_PLAY_PACKAGE_NAME ?? "com.spragginsdesigns.sureword", subscriptionNotification: { purchaseToken: "token" } })).toString("base64") } }) });
  assert.equal((await route.POST(request())).status, 503);
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-10-01T00:00:00.000Z");
  assert.equal(h.rows()[0].lastVerifiedAt.getTime(), 0); assert.equal(h.acknowledgements(), 1);
  h.setOrderStatus(200);
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-09-01T00:00:00.000Z");
  assert.ok(h.rows()[0].lastVerifiedAt.getTime() > 0);
});

test("optional Orders lookup uses a five-second deadline inside the existing transaction budget", async (t) => {
  const h = harness(t); const deadlines = []; const original = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (milliseconds) => { deadlines.push(milliseconds); return original(milliseconds); });
  await h.verifyAndBindPurchase("user-1", "token", "sureword_pro");
  assert.equal(deadlines.filter((milliseconds) => milliseconds === 5_000).length, 1);
  assert.equal(h.rows()[0].status, "active");
});
test("active grace canceled paid through expiry; pending on-hold paused expired revoked unpaid", (t) => {
  const h = harness(t);
  for (const [state, expected] of [["ACTIVE", "active"], ["IN_GRACE_PERIOD", "active"], ["CANCELED", "active"], ["PENDING", "revoked"], ["ON_HOLD", "revoked"], ["PAUSED", "revoked"], ["EXPIRED", "revoked"], ["REVOKED", "revoked"]]) {
    assert.equal(h.stateForPlayPurchase({ ...h.active(), subscriptionState: `SUBSCRIPTION_STATE_${state}` }).status, expected);
  }
});
test("invalid expiry, start, and wrong product are rejected", (t) => {
  const h = harness(t);
  for (const patch of [{ lineItems: [] }, { lineItems: [{ productId: "other" }] }, { lineItems: [{ productId: "sureword_pro", expiryTime: "bad" }] }, { startTime: "bad" }]) assert.throws(() => h.stateForPlayPurchase({ ...h.active(), ...patch }));
});
test("token owned by another account is rejected before Google fetch", async (t) => {
  const h = harness(t); h.setRows([h.row("token", { userId: "other" })]);
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /another account/);
  assert.equal(h.reads(), 0);
});
test("missing and mismatched external account binding cannot bind a new token", async (t) => {
  const h = harness(t);
  for (const binding of [undefined, h.userBinding("other")]) {
    h.setPurchase(activePurchase(binding));
    await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /not bound/);
  }
  assert.equal(h.rows().length, 0);
});
test("active Stripe subscription prevents Play binding within lock", async (t) => {
  const h = harness(t); h.setStripe({ status: "active", periodEnd: new Date("2099-01-01") });
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /web subscription/);
  assert.equal(h.reads(), 0);
});

test("an active App Store period blocks new Play binding with Apple checkout disabled", async (t) => {
  const h = harness(t);
  delete process.env.APP_STORE_APP_ID;
  h.beforeNextTransaction(() => h.setAppStore([{ userId: "user-1", status: "active", expiresAt: new Date("2099-01-01") }]));
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /App Store subscription/);
  assert.equal(h.rows().length, 0); assert.equal(h.reads(), 0); assert.equal(h.acknowledgements(), 0);
});

test("expired, revoked, and another account's App Store periods do not block Play", async (t) => {
  const h = harness(t);
  h.setAppStore([
    { userId: "user-1", status: "active", expiresAt: new Date(0) },
    { userId: "user-1", status: "revoked", expiresAt: new Date("2099-01-01") },
    { userId: "other", status: "active", expiresAt: new Date("2099-01-01") },
  ]);
  await h.verifyAndBindPurchase("user-1", "token", "sureword_pro");
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
});

test("known Play restores and renewals still reconcile when another paid store exists", async (t) => {
  const h = harness(t);
  h.setStripe({ status: "active", periodEnd: new Date("2099-01-01") });
  h.setAppStore([{ userId: "user-1", status: "active", expiresAt: new Date("2099-01-01") }]);
  for (const refresh of [() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), () => h.refreshBoundPurchase("token"), () => h.refreshGooglePlaySubscription("user-1")]) {
    h.setRows([expiredRow(h, "token")]);
    await refresh();
    assert.equal(h.rows()[0].status, "active");
    assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-10-01T00:00:00.000Z");
  }
  assert.equal(h.acknowledgements(), 3);
});

test("a verified replacement of active Play retains its provider when legacy duplicates exist", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true });
  h.setStripe({ status: "active", periodEnd: new Date("2099-01-01") });
  h.setAppStore([{ userId: "user-1", status: "active", expiresAt: new Date("2099-01-01") }]);
  for (const bind of [() => h.verifyAndBindPurchase("user-1", "replacement", "sureword_pro"), () => h.refreshBoundPurchase("replacement")]) {
    h.setRows([h.row("current")]); h.setPurchase({ ...h.active(), linkedPurchaseToken: "current" });
    await bind();
    assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("replacement"));
    assert.equal(h.rows()[0].status, "active");
  }
});
test("pending purchase neither binds nor acknowledges", async (t) => {
  const h = harness(t); h.setPurchase({ ...h.active(), subscriptionState: "SUBSCRIPTION_STATE_PENDING" });
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /not active/);
  assert.equal(h.rows().length, 0); assert.equal(h.acknowledgements(), 0);
});
test("malformed known receipt revocation commits even when bind returns an error", async (t) => {
  const h = harness(t); h.setRows([h.row()]); h.setPurchase({ ...h.active(), lineItems: [{ productId: "sureword_pro", expiryTime: "bad" }] });
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /not active/);
  assert.equal(h.rows()[0].status, "revoked"); assert.equal(h.acknowledgements(), 0);
});
test("RTDN and cached refresh revoke malformed bound responses", async (t) => {
  const h = harness(t); h.setPurchase({ ...h.active(), lineItems: [{ productId: "sureword_pro", expiryTime: "bad" }] });
  for (const refresh of [() => h.refreshBoundPurchase("token"), () => h.refreshGooglePlaySubscription("user-1")]) {
    h.setRows([h.row()]); await refresh(); assert.equal(h.rows()[0].status, "revoked");
  }
});
test("Google transport failure preserves verified row and RTDN requests retry", async (t) => {
  const h = harness(t); h.setRows([h.row()]); h.setGetPurchase(() => { throw new Error("network unavailable"); });
  await assert.rejects(() => h.refreshBoundPurchase("token"), /network/);
  await h.refreshGooglePlaySubscription("user-1");
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.rows()[0].lastVerifiedAt.getTime(), 0);
});
test("old token cannot replace active new token; direct replacement succeeds", async (t) => {
  const h = harness(t); h.setRows([h.row("current")]);
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "old", "sureword_pro"), /does not replace/);
  assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("current"));
  h.setPurchase({ ...h.active(), linkedPurchaseToken: "current" });
  await h.verifyAndBindPurchase("user-1", "new", "sureword_pro");
  assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("new"));
});

test("verified re-signup with a new token and order retains quota until the unchanged renewal date", async (t) => {
  const h = harness(t);
  h.setRows([h.row("original", { periodStart: new Date("2099-10-18"), periodEnd: new Date("2099-11-17"), latestSuccessfulOrderId: "paid-order" })]);
  h.setPurchase({ ...h.active(), linkedPurchaseToken: "original", startTime: "2099-10-28T00:00:00Z", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-11-17T00:00:00Z", latestSuccessfulOrderId: "zero-price-replacement-order" }] });
  await h.verifyAndBindPurchase("user-1", "resigned", "sureword_pro");
  assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("resigned"));
  assert.equal(h.rows()[0].latestSuccessfulOrderId, "zero-price-replacement-order");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-10-18T00:00:00.000Z");
  assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-11-17T00:00:00.000Z");
  await h.refreshBoundPurchase("resigned");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-10-18T00:00:00.000Z", "later refreshes must retain the same bucket despite the replacement startTime");
});

test("RTDN re-signup with a new token and order retains quota until the unchanged renewal date", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true });
  h.setRows([h.row("original", { periodStart: new Date("2099-10-18"), periodEnd: new Date("2099-11-17"), latestSuccessfulOrderId: "paid-order" })]);
  h.setPurchase({ ...h.active(), linkedPurchaseToken: "original", startTime: "2099-10-28T00:00:00Z", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-11-17T00:00:00Z", latestSuccessfulOrderId: "zero-price-replacement-order" }] });
  await h.refreshBoundPurchase("resigned");
  assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("resigned"));
  assert.equal(h.rows()[0].latestSuccessfulOrderId, "zero-price-replacement-order");
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-10-18T00:00:00.000Z");
  assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-11-17T00:00:00.000Z");
  // Age a successful verification without marking its accounting as pending.
  h.setRows([{ ...h.rows()[0], lastVerifiedAt: new Date(Date.now() - 6 * 60_000) }]);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  assert.equal(h.rows()[0].periodStart.toISOString(), "2099-10-18T00:00:00.000Z");
});

test("a direct replacement after expiry starts a new paid quota period through verify and RTDN", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true });
  for (const refresh of [() => h.verifyAndBindPurchase("user-1", "new-paid", "sureword_pro"), () => h.refreshBoundPurchase("new-paid")]) {
    h.setRows([expiredRow(h, "original")]);
    h.setPurchase({ ...h.active(), linkedPurchaseToken: "original", startTime: "2099-10-28T00:00:00Z", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-11-28T00:00:00Z", latestSuccessfulOrderId: "new-paid-order" }] });
    await refresh();
    assert.equal(h.rows()[0].periodStart.toISOString(), "2099-10-28T00:00:00.000Z");
    assert.equal(h.rows()[0].periodEnd.toISOString(), "2099-11-28T00:00:00.000Z");
  }
});
test("replacement linked to another user is rejected", async (t) => {
  const h = harness(t); h.setRows([h.row("other-token", { userId: "other" })]); h.setPurchase({ ...h.active(), linkedPurchaseToken: "other-token" });
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "new", "sureword_pro"), /another account/);
});
test("late RTDN for a replaced token cannot overwrite or acknowledge the current token", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([h.row("new")]);
  const before = structuredClone(h.rows());
  await h.refreshBoundPurchase("old");
  assert.deepEqual(h.rows(), before); assert.equal(h.acknowledgements(), 0);
});
test("concurrent refreshes serialize Google snapshots so later revocation wins", async (t) => {
  const h = harness(t); h.setRows([h.row()]);
  let entered; const firstEntered = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let read = 0;
  h.setGetPurchase(async () => { read++; if (read === 1) { entered(); await gate; return h.active(); } return { ...h.active(), subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }; });
  const first = h.refreshBoundPurchase("token"); await firstEntered;
  const second = h.refreshBoundPurchase("token"); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(read, 1, "second request cannot fetch before first transaction releases lock");
  release(); await Promise.all([first, second]); assert.equal(h.rows()[0].status, "revoked");
});
test("initial acknowledgement failure commits ownership and RTDN retries until acknowledged", async (t) => {
  const h = harness(t); h.setAcknowledgementStatus(503);
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /acknowledgement/);
  assert.equal(h.rows()[0].status, "active");
  await assert.rejects(() => h.refreshBoundPurchase("token"), /acknowledgement/);
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 2);
  h.setAcknowledgementStatus(204);
  await h.refreshBoundPurchase("token");
  assert.equal(h.acknowledgements(), 3);
  h.setPurchase({ ...h.active(), acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" });
  await h.refreshBoundPurchase("token");
  assert.equal(h.acknowledgements(), 3, "acknowledged receipts need no further acknowledgement");
});

test("acknowledgement HTTP409 is retried rather than treated as success", async (t) => {
  const h = harness(t); h.setRows([h.row()]); h.setAcknowledgementStatus(409);
  await assert.rejects(() => h.refreshBoundPurchase("token"), /acknowledgement/);
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
});

test("cached refresh recovers acknowledgement and contains transient failures", async (t) => {
  const h = harness(t); h.setRows([h.row()]); h.setAcknowledgementStatus(503);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
  h.setRows([h.row()]); h.setAcknowledgementStatus(204);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  assert.equal(h.acknowledgements(), 2);
});

test("getUserPlan sees a committed Play renewal even when acknowledgement fails", async (t) => {
  const h = harness(t); h.setRows([expiredRow(h, "token")]); h.setAcknowledgementStatus(503);
  process.env.PRO_USER_IDS = ""; process.env.SERVER_CREDENTIAL_USER_IDS = "";
  const { getUserPlan } = planService(h);
  assert.equal(await getUserPlan("user-1"), "pro");
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
  h.setAcknowledgementStatus(204);
  await h.refreshBoundPurchase("token");
  assert.equal(h.acknowledgements(), 2, "RTDN still retries the pending acknowledgement");
});

test("getUserPlan retains a Google-confirmed renewal when optional accounting is unavailable", async (t) => {
  const h = harness(t); h.setRows([expiredRow(h, "token")]); h.setOrderStatus(503);
  process.env.PRO_USER_IDS = ""; process.env.SERVER_CREDENTIAL_USER_IDS = "";
  assert.equal(await planService(h).getUserPlan("user-1"), "pro");
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.rows()[0].lastVerifiedAt.getTime(), 0);
  assert.equal(h.acknowledgements(), 1);
});

for (const timing of ["before outer read", "before lock"]) {
  test(`getUserPlan rereads when another refresh wins ${timing}`, async (t) => {
    const h = harness(t); h.setRows([expiredRow(h, "token")]);
    process.env.PRO_USER_IDS = ""; process.env.SERVER_CREDENTIAL_USER_IDS = "";
    const renew = () => h.setRows([h.row("token", { lastVerifiedAt: new Date() })]);
    if (timing === "before lock") h.beforeNextTransaction(renew);
    const { getUserPlan } = planService(h, timing === "before outer read" ? renew : undefined);
    assert.equal(await getUserPlan("user-1"), "pro");
    assert.equal(h.reads(), 0, "the winner already verified Google");
  });
}

test("a rolled-back cached renewal does not report a committed refresh or acknowledge", async (t) => {
  const h = harness(t, { failCommit: true }); h.setRows([expiredRow(h, "token")]);
  const before = structuredClone(h.rows());
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), false);
  assert.deepEqual(h.rows(), before); assert.equal(h.acknowledgements(), 0);
});

test("already acknowledged and pending payment receipts never send acknowledgement", async (t) => {
  const h = harness(t);
  for (const purchase of [{ ...h.active(), acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }, { ...h.active(), subscriptionState: "SUBSCRIPTION_STATE_PENDING" }]) {
    h.setRows([h.row()]); h.setPurchase(purchase); await h.refreshBoundPurchase("token");
  }
  assert.equal(h.acknowledgements(), 0); assert.equal(h.rows()[0].status, "revoked");
});

test("recently expired cache refreshes immediately while a recent active cache is throttled", async (t) => {
  const h = harness(t);
  h.setRows([h.row("token", { periodEnd: new Date(Date.now() - 1000), lastVerifiedAt: new Date(Date.now() - 2000) })]);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true); assert.equal(h.reads(), 1);
  assert.equal(h.rows()[0].status, "active");
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), false); assert.equal(h.reads(), 1);
});

test("Google-confirmed expired subscriptions are cached after the first active expiry refresh", async (t) => {
  const h = harness(t);
  const expiry = new Date(Date.now() - 1000);
  h.setRows([h.row("token", { periodStart: new Date(expiry.getTime() - 30 * 24 * 60 * 60_000), periodEnd: expiry, lastVerifiedAt: new Date(Date.now() - 2000) })]);
  h.setPurchase({ ...h.active(), subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [{ productId: "sureword_pro", expiryTime: expiry.toISOString(), latestSuccessfulOrderId: "order-1" }] });
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  assert.equal(h.rows()[0].status, "revoked"); assert.equal(h.reads(), 1);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), false);
  assert.equal(h.reads(), 1, "recently verified inactive rows must not hit Google on every plan read");
});

test("existing Play subscriptions refresh while new checkout is disabled", async (t) => {
  const h = harness(t); process.env.SUREWORD_PLAY_BILLING_ENABLED = "false"; h.setRows([h.row()]);
  assert.equal(h.billingEnabled(), false);
  assert.equal(await h.refreshGooglePlaySubscription("user-1"), true);
  await h.refreshBoundPurchase("token"); assert.equal(h.reads(), 2);
});

test("Play-center resubscribe binds only the verified expired token and account chain", async (t) => {
  const h = harness(t); h.setRows([expiredRow(h)]); h.setPurchase(outOfAppPurchase(h));
  await h.verifyAndBindPurchase("user-1", "resubscribed", "sureword_pro");
  assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("resubscribed"));
  assert.equal(h.rows()[0].status, "active");
  assert.deepEqual(h.acknowledgementBodies(), [{ externalAccountIds: { obfuscatedAccountId: h.userBinding("user-1") } }]);
  h.setPurchase({ ...h.active(), externalAccountIdentifiers: undefined, acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" });
  await h.refreshBoundPurchase("resubscribed"); assert.equal(h.rows()[0].status, "active");
});

test("wrong or missing expired ownership evidence cannot bind or acknowledge a new token", async (t) => {
  const h = harness(t);
  for (const patch of [
    { expiredPurchaseToken: "unknown" },
    { expiredExternalAccountIdentifiers: { obfuscatedExternalAccountId: h.userBinding("other") } },
    { expiredExternalAccountIdentifiers: undefined },
  ]) {
    h.setRows([expiredRow(h)]);
    const purchase = outOfAppPurchase(h); Object.assign(purchase.outOfAppPurchaseContext, patch); h.setPurchase(purchase);
    await assert.rejects(() => h.verifyAndBindPurchase("user-1", "new", "sureword_pro"), /not bound|another account|does not replace/);
    assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("expired"));
  }
  h.setRows([]); h.setPurchase(outOfAppPurchase(h));
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "new", "sureword_pro"), /not bound/);
  assert.equal(h.rows().length, 0); assert.equal(h.acknowledgements(), 0);
});

test("out-of-app context cannot bypass expiry, chronology, or a conflicting current account binding", async (t) => {
  const h = harness(t);
  for (const [row, purchase] of [
    [h.row("expired"), outOfAppPurchase(h)],
    [expiredRow(h), outOfAppPurchase(h, { startTime: "2026-01-15T00:00:00Z" })],
    [expiredRow(h), outOfAppPurchase(h, { externalAccountIdentifiers: { obfuscatedExternalAccountId: h.userBinding("other") } })],
  ]) {
    h.setRows([row]); h.setPurchase(purchase);
    await assert.rejects(() => h.verifyAndBindPurchase("user-1", "new", "sureword_pro"), /not bound|does not replace/);
    assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("expired"));
  }
  assert.equal(h.acknowledgements(), 0);
});

test("unknown RTDN securely discovers an expired replacement then re-reads Google under lock", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([expiredRow(h)]); h.setPurchase(outOfAppPurchase(h));
  await h.refreshBoundPurchase("resubscribed");
  assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("resubscribed"));
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
  assert.deepEqual(h.readLocks(), [false, true]);
  await h.refreshBoundPurchase("resubscribed");
  assert.deepEqual(h.readLocks(), [false, true, true]);
});

test("unknown RTDN rejects another account's expired chain and unbound tokens", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true });
  for (const patch of [
    { expiredPurchaseToken: "unknown" },
    { expiredExternalAccountIdentifiers: { obfuscatedExternalAccountId: h.userBinding("other") } },
  ]) {
    h.setRows([expiredRow(h)]); const before = structuredClone(h.rows());
    const purchase = outOfAppPurchase(h); Object.assign(purchase.outOfAppPurchaseContext, patch); h.setPurchase(purchase);
    await h.refreshBoundPurchase("new"); assert.deepEqual(h.rows(), before);
  }
  h.setPurchase(h.active()); await h.refreshBoundPurchase("unrelated");
  assert.equal(h.acknowledgements(), 0);
});

test("an expired predecessor owned by another account cannot be reassigned by verify or RTDN", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([expiredRow(h, "expired", { userId: "other" })]); h.setPurchase(outOfAppPurchase(h));
  const before = structuredClone(h.rows());
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "new", "sureword_pro"), /another account/);
  await h.refreshBoundPurchase("new");
  assert.deepEqual(h.rows(), before); assert.equal(h.acknowledgements(), 0);
});

test("unknown RTDN discovery cannot authorize a changed or pending Google snapshot", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true });
  for (const patch of [{ subscriptionState: "SUBSCRIPTION_STATE_PENDING" }, { outOfAppPurchaseContext: undefined }, { externalAccountIdentifiers: { obfuscatedExternalAccountId: h.userBinding("other") } }]) {
    h.setRows([expiredRow(h)]); const before = structuredClone(h.rows()); let count = 0;
    h.setGetPurchase(() => ++count === 1 ? outOfAppPurchase(h) : outOfAppPurchase(h, patch));
    await h.refreshBoundPurchase("new"); assert.deepEqual(h.rows(), before);
  }
  assert.equal(h.acknowledgements(), 0);
});

test("replacement committed during RTDN discovery prevents the late token from winning", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([expiredRow(h)]); h.setPurchase(outOfAppPurchase(h));
  let entered; const paused = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  h.beforeNextTransaction(async () => { entered(); await gate; });
  const late = h.refreshBoundPurchase("late"); await paused;
  await h.verifyAndBindPurchase("user-1", "current", "sureword_pro");
  const before = structuredClone(h.rows()); release(); await late;
  assert.deepEqual(h.rows(), before); assert.equal(h.rows()[0].purchaseTokenHash, h.tokenHash("current"));
  assert.equal(h.acknowledgements(), 1); assert.deepEqual(h.readLocks(), [false, true]);
});

test("unknown RTDN retries Google outages but discards permanently gone old tokens", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([h.row("current")]); const before = structuredClone(h.rows());
  h.setReadStatus(503); await assert.rejects(() => h.refreshBoundPurchase("unknown"), /verify/);
  for (const status of [404, 410]) { h.setReadStatus(status); await h.refreshBoundPurchase("old"); }
  assert.deepEqual(h.rows(), before); assert.equal(h.acknowledgements(), 0);
});

test("new RTDN receipt cannot create a duplicate active web subscription", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([expiredRow(h)]); h.setPurchase(outOfAppPurchase(h));
  h.setStripe({ status: "active", periodEnd: new Date("2099-01-01") }); const before = structuredClone(h.rows());
  await h.refreshBoundPurchase("resubscribed"); assert.deepEqual(h.rows(), before); assert.equal(h.acknowledgements(), 0);
});

test("Play-center resubscribe cannot add a second paid provider through verify or RTDN", async (t) => {
  const h = harness(t, { allowDiscoveryReads: true }); h.setRows([expiredRow(h)]); h.setPurchase(outOfAppPurchase(h));
  h.setAppStore([{ userId: "user-1", status: "active", expiresAt: new Date("2099-01-01") }]); const before = structuredClone(h.rows());
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "resubscribed", "sureword_pro"), /App Store subscription/);
  await h.refreshBoundPurchase("resubscribed");
  assert.deepEqual(h.rows(), before); assert.equal(h.acknowledgements(), 0);
});

test("RTDN route returns retry on actual acknowledgement failure and succeeds on redelivery", async (t) => {
  const h = harness(t); h.setRows([h.row()]); h.setAcknowledgementStatus(503);
  const routeSource = ts.transpileModule(fs.readFileSync(path.resolve("src/app/api/webhooks/google-play/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", routeSource)(() => ({ ...h, verifyRtdnOidc: async () => ({}) }), routeModule, routeModule.exports);
  const request = () => new Request("https://sureword.test/api/webhooks/google-play", { method: "POST", headers: { authorization: "Bearer signed-token", "content-type": "application/json" }, body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ packageName: process.env.SUREWORD_PLAY_PACKAGE_NAME ?? "com.spragginsdesigns.sureword", subscriptionNotification: { purchaseToken: "token" } })).toString("base64") } }) });
  const failed = await routeModule.exports.POST(request());
  assert.equal(failed.status, 503); assert.match(await failed.text(), /retry required/);
  assert.equal(h.rows()[0].status, "active"); assert.equal(h.acknowledgements(), 1);
  h.setAcknowledgementStatus(204);
  const retried = await routeModule.exports.POST(request());
  assert.equal(retried.status, 200); assert.deepEqual(await retried.json(), { received: true }); assert.equal(h.acknowledgements(), 2);
});
test("OIDC validates signed fixtures, configuration, segments, identity, and time", async (t) => {
  const h = harness(t);
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: "https://accounts.google.com", aud: "aud", email: "rtdn@example.test", email_verified: true, iat: now, exp: now + 300, sub: "service" };
  process.env.SUREWORD_PLAY_RTDN_AUDIENCE = "aud"; process.env.SUREWORD_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = good.email;
  assert.equal((await h.verifyRtdnOidc(jwt(good))).email, good.email);
  for (const patch of [{ aud: "wrong" }, { email: "other" }, { email_verified: false }, { iss: "https://evil.example" }, { exp: now - 1 }, { iat: now + 600 }, { iat: undefined }]) await assert.rejects(() => h.verifyRtdnOidc(jwt({ ...good, ...patch })));
  await assert.rejects(() => h.verifyRtdnOidc(`${jwt(good)}.extra`), /token/);
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  await assert.rejects(() => h.verifyRtdnOidc(jwt(good, otherKey)), /signature/i);
  for (const key of ["SUREWORD_PLAY_RTDN_AUDIENCE", "SUREWORD_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL"]) {
    const saved = process.env[key]; delete process.env[key];
    await assert.rejects(() => h.verifyRtdnOidc(jwt({ ...good, aud: undefined, email: undefined })), /configuration/);
    process.env[key] = " "; await assert.rejects(() => h.verifyRtdnOidc(jwt(good)), /configuration/);
    process.env[key] = saved;
  }
});

test("RTDN route rejects malformed envelopes, ignores other packages, and retries refresh failures", async () => {
  const routeSource = ts.transpileModule(fs.readFileSync(path.resolve("src/app/api/webhooks/google-play/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const routeModule = { exports: {} };
  let received = [];
  let failing = false;
  new Function("require", "module", "exports", routeSource)(() => ({ verifyRtdnOidc: async () => ({}), refreshBoundPurchase: async (token) => { if (failing) throw new Error("retry"); received.push(token); } }), routeModule, routeModule.exports);
  const request = (notification) => new Request("https://sureword.test/api/webhooks/google-play", { method: "POST", headers: { authorization: "Bearer signed-token", "content-type": "application/json" }, body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify(notification)).toString("base64") } }) });
  const packageName = process.env.SUREWORD_PLAY_PACKAGE_NAME ?? "com.spragginsdesigns.sureword";
  assert.equal((await routeModule.exports.POST(request({}))).status, 400);
  assert.equal((await routeModule.exports.POST(request({ packageName: "another.app" }))).status, 204);
  assert.equal((await routeModule.exports.POST(request({ packageName, subscriptionNotification: { purchaseToken: 1 } }))).status, 400);
  assert.equal((await routeModule.exports.POST(request({ packageName, subscriptionNotification: { purchaseToken: "token" } }))).status, 200);
  assert.deepEqual(received, ["token"]);
  failing = true;
  assert.equal((await routeModule.exports.POST(request({ packageName, subscriptionNotification: { purchaseToken: "token" } }))).status, 503);
  assert.equal((await routeModule.exports.POST(new Request("https://sureword.test", { method: "POST" }))).status, 401);
});
