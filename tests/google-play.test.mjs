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

function harness(t) {
  let rows = [];
  let tail = Promise.resolve();
  let locked = false;
  let stripe = null;
  let acknowledgements = 0;
  let reads = 0;
  let purchase;
  let getPurchase = () => purchase;
  const db = {
    billingSubscription: { findUnique: async () => stripe },
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
      const preceding = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await preceding;
      const before = structuredClone(rows);
      try { return await fn(db); } catch (error) { rows = before; throw error; }
      finally { locked = false; release(); }
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (id) => id === "server-only" ? {} : id === "google-auth-library" ? { OAuth2Client: FixtureOidcClient } : id === "@/lib/prisma" ? { prisma: db } : id === "@/lib/ai/crypto" ? { encryptSecret: (v) => `enc:${v}`, decryptSecret: (v) => v.slice(4) } : id === "./plans" ? { activeSubscription: (s) => (s.status === "active" || s.status === "trialing") && s.periodEnd > new Date() } : require(id), module, module.exports,
  );
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("oauth2")) return Response.json({ access_token: "access", expires_in: 3600 });
    if (String(url).includes(":acknowledge")) { acknowledgements++; return new Response(null, { status: 204 }); }
    assert.equal(locked, true, "authoritative purchase fetch must occur after row lock");
    reads++;
    return Response.json(await getPurchase(String(url)));
  });
  const oldEnv = { ...process.env };
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "play@example.test", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  process.env.SUREWORD_USAGE_ENABLED = "true";
  process.env.SUREWORD_PLAY_BILLING_ENABLED = "true";
  t.after(() => {
    for (const key of ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "SUREWORD_USAGE_ENABLED", "SUREWORD_PLAY_BILLING_ENABLED", "SUREWORD_PLAY_RTDN_AUDIENCE", "SUREWORD_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  });
  const api = module.exports;
  purchase = activePurchase(api.userBinding("user-1"));
  return { ...api, setRows: (value) => { rows = value; }, rows: () => rows, setPurchase: (value) => { purchase = value; }, setGetPurchase: (value) => { getPurchase = value; }, setStripe: (value) => { stripe = value; }, reads: () => reads, acknowledgements: () => acknowledgements, active: () => activePurchase(api.userBinding("user-1")), row: (token = "token", extra = {}) => ({ userId: "user-1", purchaseTokenHash: api.tokenHash(token), encryptedPurchaseToken: `enc:${token}`, periodStart: new Date("2099-08-01T00:00:00Z"), periodEnd: new Date("2099-09-01T00:00:00Z"), status: "active", lastVerifiedAt: new Date(0), latestSuccessfulOrderId: "order-1", ...extra }) };
}
function activePurchase(binding) {
  return { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", startTime: "2026-01-01T00:00:00Z", lineItems: [{ productId: "sureword_pro", expiryTime: "2099-10-01T00:00:00Z", latestSuccessfulOrderId: "order-2" }], externalAccountIdentifiers: { obfuscatedExternalAccountId: binding }, acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" };
}

function jwt(claims, key = privateKey) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const s = createSign("RSA-SHA256"); s.update(`${h}.${p}`);
  return `${h}.${p}.${s.sign(key).toString("base64url")}`;
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
test("replacement linked to another user is rejected", async (t) => {
  const h = harness(t); h.setRows([h.row("other-token", { userId: "other" })]); h.setPurchase({ ...h.active(), linkedPurchaseToken: "other-token" });
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "new", "sureword_pro"), /another account/);
});
test("RTDN for a replaced token is ignored without Google fetch", async (t) => {
  const h = harness(t); h.setRows([h.row("new")]); await h.refreshBoundPurchase("old"); assert.equal(h.reads(), 0);
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
test("failed acknowledgement keeps bound row for a successful retry", async (t) => {
  const h = harness(t); const realFixtureFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => String(url).includes(":acknowledge") ? new Response(null, { status: 503 }) : realFixtureFetch(url, options));
  await assert.rejects(() => h.verifyAndBindPurchase("user-1", "token", "sureword_pro"), /acknowledgement/);
  assert.equal(h.rows()[0].status, "active");
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
