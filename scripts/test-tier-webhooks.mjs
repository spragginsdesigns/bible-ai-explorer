import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import ts from "typescript";

const env = parseEnv(fs.readFileSync(".env.local", "utf8"));
const url = new URL(env.DATABASE_URL_UNPOOLED || env.DATABASE_URL);
url.hostname = "ep-withered-dew-ak4ludji.c-3.us-west-2.aws.neon.tech";
assert.equal(url.pathname, "/neondb");
const prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
const id = `tier-billing-test-${randomUUID()}`;
const secret = "whsec_synthetic_unit_test_only";
process.env.STRIPE_WEBHOOK_SECRET = secret;
process.env.STRIPE_PRO_PRICE_ID = "price_sureword_test";
const signer = new Stripe("sk_test_synthetic_no_network");
const now = Math.floor(Date.now() / 1000);
let current = {
  id: "sub_sureword_test",
  created: now,
  customer: "cus_sureword_test",
  status: "active",
  cancel_at_period_end: false,
  items: {
    data: [
      {
        price: { id: "price_sureword_test" },
        current_period_start: now,
        current_period_end: now + 30 * 86400,
      },
    ],
  },
  latest_invoice: { id: "in_sureword_test", status: "paid" },
};
let retrieved = 0,
  cancellations = 0;
let refunded = false,
  disputeStatus = "needs_response";
const historicalSubscriptions = new Map();
const stripe = {
  webhooks: signer.webhooks,
  subscriptions: {
    retrieve: async (subscriptionId) => {
      retrieved++;
      return structuredClone(
        historicalSubscriptions.get(subscriptionId) ?? current,
      );
    },
    cancel: async () => {
      cancellations++;
      current.status = "canceled";
      return structuredClone(current);
    },
  },
  charges: {
    retrieve: async () => ({
      id: "ch_test",
      payment_intent: "pi_test",
      refunded,
    }),
  },
  invoicePayments: {
    list: async () => ({
      has_more: false,
      data: [{ invoice: "in_sureword_test" }],
    }),
  },
  invoices: {
    retrieve: async () => ({
      id: "in_sureword_test",
      parent: { subscription_details: { subscription: current.id } },
    }),
  },
  disputes: {
    retrieve: async () => ({ id: "dp_test", status: disputeStatus }),
  },
};
const require = createRequire(import.meta.url);
function load(relative, mocks) {
  const filename = path.resolve(relative),
    module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (id) => (id in mocks ? mocks[id] : require(id)),
    module,
    module.exports,
  );
  return module.exports;
}
const { POST } = load("src/app/api/webhooks/stripe/route.ts", {
  "@/lib/prisma": { prisma },
  "@/lib/billing/stripe": { stripeClient: () => stripe },
});
let events = [];
async function send(
  type = "customer.subscription.updated",
  object = { object: "subscription", id: current.id },
  eventId = `evt_${randomUUID()}`,
  valid = true,
) {
  events.push(eventId);
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type,
    data: { object },
  });
  const signature = signer.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": valid ? signature : `${signature}broken` },
      body: payload,
    }),
  );
}
let checks = 0;
try {
  assert.equal(
    (await prisma.$queryRaw`SELECT current_database() AS db`)[0].db,
    "neondb",
  );
  await prisma.user.create({ data: { id } });
  await prisma.billingSubscription.create({
    data: {
      userId: id,
      stripeCustomerId: "cus_sureword_test",
      periodStart: new Date(),
      periodEnd: new Date(),
    },
  });
  assert.equal(
    (await send(undefined, undefined, undefined, false)).status,
    400,
  );
  checks++;
  assert.equal((await send()).status, 200);
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "active",
  );
  checks++;
  const duplicate = events.at(-1),
    count = retrieved;
  assert.equal((await send(undefined, undefined, duplicate)).status, 200);
  assert.equal(retrieved, count);
  checks++;
  current.cancel_at_period_end = true;
  assert.equal((await send()).status, 200);
  let row = await prisma.billingSubscription.findUnique({
    where: { userId: id },
  });
  assert.equal(row.status, "active");
  assert.equal(row.cancelAtPeriodEnd, true);
  checks++;
  current.status = "canceled";
  assert.equal(
    (
      await send("customer.subscription.updated", {
        object: "subscription",
        id: current.id,
        status: "active",
      })
    ).status,
    200,
  );
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "canceled",
  );
  checks++;
  current.status = "active";
  current.latest_invoice.status = "open";
  await send();
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "incomplete",
  );
  checks++;
  current.latest_invoice.status = "paid";
  await send("charge.dispute.created", {
    object: "dispute",
    id: "dp_test",
    charge: "ch_test",
  });
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "payment_disputed",
  );
  await send();
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "payment_disputed",
  );
  checks++;
  disputeStatus = "won";
  await send("charge.dispute.created", {
    object: "dispute",
    id: "dp_test",
    charge: "ch_test",
  });
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "active",
  );
  checks++;
  refunded = true;
  await send("charge.refunded", { object: "charge", id: "ch_test" });
  assert.equal(cancellations, 1);
  assert.equal(
    (await prisma.billingSubscription.findUnique({ where: { userId: id } }))
      .status,
    "canceled",
  );
  checks++;
  const plans = load("src/lib/billing/plans.ts", {});
  const realStripeHelpers = load("src/lib/billing/stripe.ts", {
    "server-only": {},
    stripe: Stripe,
    "./plans": plans,
    "./return-origin": load("src/lib/billing/return-origin.ts", {}),
  });
  let checkoutCreates = 0;
  let amount = 1500;
  const sessions = [];
  const checkoutStripe = {
    prices: {
      retrieve: async () => ({
        id: "price_sureword_test",
        active: true,
        currency: "usd",
        unit_amount: amount,
        recurring: { interval: "month", interval_count: 1 },
      }),
    },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
    checkout: {
      sessions: {
        list: async () => ({ data: sessions, has_more: false }),
        create: async (params) => {
          checkoutCreates++;
          const session = {
            ...params,
            status: "open",
            expires_at: Date.now() / 1000 + 3600,
            url: "https://checkout.stripe.com/c/pay/test",
          };
          sessions.push(session);
          return session;
        },
      },
    },
  };
  const checkoutRoute = load("src/app/api/billing/checkout/route.ts", {
    "@/lib/auth": { getAuthUser: async () => id },
    "@/lib/prisma": { prisma },
    "@/lib/ai/provider": { isServerCredentialUser: () => false },
    "@/lib/billing/request": load("src/lib/billing/request.ts", {}),
    "@/lib/billing/stripe": {
      stripeClient: () => checkoutStripe,
      billingAvailable: () => true,
      verifiedProPrice: realStripeHelpers.verifiedProPrice,
      billingReturnOrigin: () => "https://sureword.app",
    },
  });
  const checkouts = await Promise.all([
    checkoutRoute.POST(
      new Request("https://sureword.app/api/billing/checkout"),
    ),
    checkoutRoute.POST(
      new Request("https://sureword.app/api/billing/checkout"),
    ),
  ]);
  assert.ok(checkouts.every((response) => response.status === 200));
  assert.equal(checkoutCreates, 1);
  checks++;
  amount = 1000;
  assert.equal(
    (
      await checkoutRoute.POST(
        new Request("https://sureword.app/api/billing/checkout"),
      )
    ).status,
    503,
  );
  assert.equal(checkoutCreates, 1);
  checks++;
  const oldSubscription = structuredClone(current);
  historicalSubscriptions.set(oldSubscription.id, oldSubscription);
  current = {
    ...current,
    id: "sub_sureword_resubscribed",
    created: now + 60,
    status: "active",
  };
  await send();
  await send("customer.subscription.deleted", {
    object: "subscription",
    id: oldSubscription.id,
  });
  const afterOldEvent = await prisma.billingSubscription.findUnique({
    where: { userId: id },
  });
  assert.equal(afterOldEvent.stripeSubscriptionId, current.id);
  assert.equal(afterOldEvent.status, "active");
  checks++;
  console.log(
    JSON.stringify({
      passed: checks,
      scope:
        "Real Stripe signature verification and isolated Postgres writes; Stripe network operations use controlled fixtures.",
      cases: [
        "invalid signature",
        "paid activation",
        "duplicate event",
        "end-of-period cancellation",
        "out-of-order state",
        "unpaid invoice",
        "dispute hold survives updates",
        "resolved dispute",
        "full refund cancellation",
        "concurrent checkout reuses one session",
        "wrong configured price cannot reach checkout",
        "old subscription events cannot revoke a later membership",
      ],
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      failed: true,
      name: error.name,
      message: String(error.message).slice(0, 700),
    }),
  );
  process.exitCode = 1;
} finally {
  await prisma.billingEvent.deleteMany({ where: { id: { in: events } } });
  await prisma.user.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
