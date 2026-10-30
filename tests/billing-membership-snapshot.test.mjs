import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, imports = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", source)((id) => Object.hasOwn(imports, id) ? imports[id] : require(id), mod, mod.exports);
  return mod.exports;
}

function harness(t, { play = "expired", refresh = "renew", storedPlan = "free", enabled = true } = {}) {
  const keys = ["SUREWORD_USAGE_ENABLED", "APP_STORE_APP_ID", "APP_STORE_ENVIRONMENT", "PRO_USER_IDS", "SERVER_CREDENTIAL_USER_IDS"];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SUREWORD_USAGE_ENABLED = String(enabled); process.env.APP_STORE_APP_ID = "6700000001";
  delete process.env.APP_STORE_ENVIRONMENT; process.env.PRO_USER_IDS = ""; process.env.SERVER_CREDENTIAL_USER_IDS = "";
  t.after(() => { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } });
  const paidStart = new Date(Date.now() - 3_600_123), paidEnd = new Date(Date.now() + 3_600_000);
  const state = {
    play: play === null ? null : { userId: "user-1", status: play === "expired" ? "revoked" : "active", periodStart: new Date(Date.now() - 86_400_000), periodEnd: play === "expired" ? new Date(Date.now() - 1000) : paidEnd, cancelAtPeriodEnd: false },
    providerReads: 0, userReads: 0, refreshCalls: 0, quotaPlanReads: 0, countWindows: [], owner: false, duringCount: undefined,
  };
  const db = {
    billingSubscription: { findUnique: async () => null },
    googlePlaySubscription: { findUnique: async () => { state.providerReads++; return structuredClone(state.play); } },
    appStoreSubscription: { findMany: async () => [] },
    user: { findUnique: async () => { state.userReads++; return { plan: storedPlan }; } },
    aiUsageRequest: { count: async ({ where }) => {
      state.countWindows.push(where.createdAt);
      state.duringCount?.(); state.duringCount = undefined;
      return where.createdAt.gte.getTime() === paidStart.getTime() ? 17 : 2;
    } },
  };
  const plans = load("src/lib/billing/plans.ts");
  const subscription = load("src/lib/billing/subscription.ts", {
    "server-only": {}, "@/lib/prisma": { prisma: db }, "./plans": plans,
    "./app-store-rules": load("src/lib/billing/app-store-rules.ts"),
  });
  const entitlements = load("src/lib/entitlements.ts", {
    "server-only": {}, "@vercel/functions": { waitUntil: () => {} }, "@/lib/prisma": { prisma: db },
    "@/lib/billing/plans": plans, "@/lib/billing/subscription": subscription,
    "@/lib/entitlements-rules": load("src/lib/entitlements-rules.ts"),
    "@/lib/billing/google-play": { refreshGooglePlaySubscription: async () => {
      state.refreshCalls++;
      await Promise.resolve();
      if (refresh === "renew") state.play = { ...state.play, status: "active", periodStart: paidStart, periodEnd: paidEnd };
      if (refresh === "revoke") state.play = { ...state.play, status: "revoked" };
      return refresh !== "outage";
    } },
  });
  const usage = load("src/lib/billing/usage.ts", {
    "server-only": {}, "@vercel/functions": { waitUntil: () => {} }, "ai": { wrapLanguageModel: () => {} },
    "@/lib/prisma": { prisma: db }, "@/lib/entitlements": { ...entitlements, getUserPlan: async (...args) => { state.quotaPlanReads++; return entitlements.getUserPlan(...args); } },
    "./plans": plans, "./subscription": subscription, "./usage-errors": load("src/lib/billing/usage-errors.ts"),
    "@/lib/onboarding-rules": load("src/lib/onboarding-rules.ts"),
  });
  const route = load("src/app/api/billing/status/route.ts", {
    "@/lib/auth": { getAuthUser: async () => "user-1" }, "@/lib/entitlements": entitlements,
    "@/lib/ai/provider": { isServerCredentialUser: () => state.owner, aiAccessFor: async () => "house" },
    "@/lib/billing/usage": usage, "@/lib/billing/plans": plans, "@/lib/billing/stripe": { billingAvailable: () => true },
    "@/lib/billing/request": { rejectCrossSiteMutation: () => null },
    "@/lib/billing/subscription": subscription,
  });
  return { state, paidStart, paidEnd, send: async () => {
    const response = await route.GET(); assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    return response.json();
  } };
}

test("status renewal returns one Pro plan, paid period and quota from actual service code", async (t) => {
  const h = harness(t);
  const body = await h.send();
  assert.equal(body.plan, "pro"); assert.equal(body.usage.pro, true);
  assert.equal(body.subscription.periodEnd, h.paidEnd.toISOString());
  assert.equal(body.usage.month.start, h.paidStart.toISOString()); assert.equal(body.usage.month.end, h.paidEnd.toISOString());
  assert.equal(body.usage.monthlyRemaining, 583);
  assert.equal(h.state.refreshCalls, 1); assert.equal(h.state.providerReads, 2); assert.equal(h.state.userReads, 1);
  assert.equal(h.state.quotaPlanReads, 0, "usage must reuse the held membership");
});

test("a settled revocation returns Free consistently instead of stale Pro plus Free quota", async (t) => {
  const h = harness(t, { play: "active", refresh: "revoke" });
  const body = await h.send();
  assert.equal(body.plan, "free"); assert.equal(body.usage.pro, false); assert.equal(body.subscription.status, "revoked");
  assert.equal(body.usage.monthlyRemaining, null); assert.equal(h.state.quotaPlanReads, 0);
});

test("a webhook arriving during quota counts cannot mix two membership periods in one response", async (t) => {
  const h = harness(t);
  h.state.duringCount = () => { h.state.play = { ...h.state.play, status: "revoked", periodEnd: new Date(0) }; };
  const body = await h.send();
  assert.equal(h.state.play.status, "revoked");
  assert.equal(body.plan, "pro"); assert.equal(body.usage.pro, true); assert.equal(body.subscription.status, "active");
  assert.equal(body.subscription.periodEnd, body.usage.month.end);
  assert.equal(body.usage.month.start, h.paidStart.toISOString());
});

test("ordinary Free status reads membership once and does not ask Google or resolve quota membership again", async (t) => {
  const h = harness(t, { play: null });
  const body = await h.send();
  assert.equal(body.plan, "free"); assert.equal(body.usage.pro, false); assert.equal(body.subscription, null);
  assert.equal(h.state.providerReads, 1); assert.equal(h.state.userReads, 1);
  assert.equal(h.state.refreshCalls, 0); assert.equal(h.state.quotaPlanReads, 0); assert.equal(h.state.countWindows.length, 1);
});

test("stored complimentary Pro keeps calendar quota without adding a Google refresh", async (t) => {
  const h = harness(t, { play: null, storedPlan: "pro" });
  const body = await h.send();
  assert.equal(body.plan, "pro"); assert.equal(body.usage.pro, true); assert.equal(body.subscription, null);
  assert.equal(h.state.refreshCalls, 0); assert.equal(h.state.providerReads, 1); assert.equal(h.state.quotaPlanReads, 0);
});

test("transient refresh failure keeps the held paid period", async (t) => {
  const h = harness(t, { play: "active", refresh: "outage" });
  const body = await h.send();
  assert.equal(body.plan, "pro"); assert.equal(body.usage.pro, true); assert.equal(body.subscription.periodEnd, h.paidEnd.toISOString());
});

test("usage disabled and owner membership preserve their existing response behavior", async (t) => {
  const h = harness(t, { play: null, enabled: false, storedPlan: "pro" });
  let body = await h.send(); assert.equal(body.plan, "pro"); assert.equal(body.usage, null); assert.equal(body.subscription, null);
  assert.equal(h.state.providerReads, 0); assert.equal(h.state.refreshCalls, 0);
  process.env.SUREWORD_USAGE_ENABLED = "true"; process.env.SERVER_CREDENTIAL_USER_IDS = "user-1"; h.state.owner = true;
  body = await h.send(); assert.equal(body.plan, "pro"); assert.equal(body.owner, true); assert.equal(body.usage, null);
});
