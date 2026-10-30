import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("src/app/api/billing/checkout/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ provider, reuse = false, expired = false, revoked = false } = {}) {
  let locked = false;
  let preflightReads = 0;
  let checkoutCreates = 0;
  let stripeReads = 0;
  let sessions = reuse ? [session()] : [];
  const paid = { status: revoked ? "revoked" : "active", periodEnd: expired ? new Date(0) : new Date("2099-01-01") };
  const tx = {
    $queryRaw: async () => { locked = true; return []; },
    googlePlaySubscription: { findUnique: async () => {
      assert.equal(locked, true);
      return provider === "google-play" ? paid : null;
    } },
    appStoreSubscription: { findFirst: async ({ where }) => {
      assert.equal(locked, true);
      assert.equal(where.userId, "user-1");
      return provider === "app_store" && paid.status === where.status && paid.periodEnd > where.expiresAt.gt ? { id: "apple-row" } : null;
    } },
  };
  const prisma = {
    billingSubscription: { findUnique: async () => ({ stripeCustomerId: "customer-1" }) },
    $transaction: async (work) => work(tx),
  };
  const stripe = {
    subscriptions: { list: async () => { stripeReads++; return { has_more: false, data: [] }; } },
    checkout: { sessions: {
      list: async () => ({ has_more: false, data: sessions }),
      create: async () => { checkoutCreates++; const created = session(); sessions.push(created); return created; },
    } },
  };
  const modules = {
    "node:crypto": require("node:crypto"),
    "@/lib/analytics/events": { ANALYTICS_EVENTS: { billingCheckoutStarted: "test" }, platformFromHeaders: () => "web" },
    "@/lib/analytics/server": { captureServerEvent: () => {}, flushAnalytics: async () => {} },
    "@/lib/auth": { getAuthUser: async () => "user-1" },
    "@/lib/prisma": { prisma },
    "@/lib/ai/provider": { isServerCredentialUser: () => false },
    "@/lib/billing/request": { rejectCrossSiteMutation: () => null },
    // The native purchase commits after this preflight, before the User lock.
    "@/lib/billing/subscription": { accountSubscription: async () => { preflightReads++; return null; } },
    "@/lib/billing/plans": { activeSubscription: (row) => ["active", "trialing"].includes(row.status) && row.periodEnd > new Date() },
    "@/lib/billing/stripe": {
      billingAvailable: () => true, stripeClient: () => stripe,
      verifiedProPrice: async () => ({ id: "price-1" }), billingReturnOrigin: () => "https://sureword.app",
    },
  };
  const exports = {};
  new Function("require", "exports", source)((name) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return {
    send: () => exports.POST(new Request("https://sureword.app/api/billing/checkout", { method: "POST" })),
    counts: () => ({ preflightReads, checkoutCreates, stripeReads }),
  };
}

function session() {
  return { mode: "subscription", client_reference_id: "user-1", metadata: { surewordPriceId: "price-1" }, expires_at: Date.now() / 1000 + 3600, url: "https://checkout.example.test/session" };
}

for (const provider of ["google-play", "app_store"]) {
  for (const reuse of [false, true]) {
    test(`${provider} committed before the lock blocks ${reuse ? "reusing" : "creating"} Stripe checkout`, async () => {
      const h = harness({ provider, reuse });
      const response = await h.send();
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, provider === "google-play" ? /Google Play/ : /App Store/);
      assert.deepEqual(h.counts(), { preflightReads: 1, checkoutCreates: 0, stripeReads: 0 });
    });
  }
}

test("an account without another paid provider creates and then resumes its Stripe checkout", async () => {
  const h = harness();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await h.send();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: "https://checkout.example.test/session" });
  }
  assert.deepEqual(h.counts(), { preflightReads: 2, checkoutCreates: 1, stripeReads: 2 });
});

for (const provider of ["google-play", "app_store"]) {
  test(`${provider} expired or revoked history permits a new Stripe checkout`, async () => {
    for (const state of [{ expired: true }, { revoked: true }]) {
      const h = harness({ provider, ...state });
      assert.equal((await h.send()).status, 200);
      assert.equal(h.counts().checkoutCreates, 1);
    }
  });
}
