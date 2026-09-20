import { createHash } from "node:crypto";
import { ANALYTICS_EVENTS, platformFromHeaders } from "@/lib/analytics/events";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isServerCredentialUser } from "@/lib/ai/provider";
import { rejectCrossSiteMutation } from "@/lib/billing/request";
import { accountSubscription } from "@/lib/billing/subscription";
import { activeSubscription } from "@/lib/billing/plans";
import {
  billingAvailable,
  stripeClient,
  verifiedProPrice,
  billingReturnOrigin,
} from "@/lib/billing/stripe";

/**
 * Somebody reached the paywall and asked for a checkout session.
 *
 * The top of the only funnel that ends in money, and it had no event at all:
 * `billing_checkout_started` sat in the catalog with no emitter while Stripe
 * went live on 2026-09-14, so nothing could answer "how many people try to
 * subscribe and stop". Fired on both exits because reusing an open session is
 * still a person trying to pay; `resumed` tells the two apart, and a second
 * attempt is itself a signal that the first one did not finish.
 *
 * No price, no amount, no customer id: the shape of the attempt is the whole
 * point, and Stripe already holds the rest.
 */
function captureCheckoutStarted(userId: string, req: Request, resumed: boolean): void {
  captureServerEvent({
    userId,
    event: ANALYTICS_EVENTS.billingCheckoutStarted,
    platform: platformFromHeaders(req.headers),
    properties: { resumed },
  });
}

export async function POST(req: Request) {
  const rejected = rejectCrossSiteMutation(req);
  if (rejected) return rejected;
  try {
    const userId = await getAuthUser();
    if (!billingAvailable())
      return Response.json(
        {
          error:
            "Pro checkout is not open yet. You can continue using SureWord free.",
        },
        { status: 503 },
      );
    if (isServerCredentialUser(userId))
      return Response.json(
        { error: "Your owner account already has Pro access." },
        { status: 409 },
      );
    const membership = await accountSubscription(userId);
    if (membership?.provider === "google-play" && activeSubscription(membership))
      return Response.json({ error: "Your Pro subscription is managed by Google Play." }, { status: 409 });
    const stripe = stripeClient();
    const price = await verifiedProPrice(stripe);
    const returnOrigin = billingReturnOrigin();
    let billing = await prisma.billingSubscription.findUnique({
      where: { userId },
    });
    if (!billing) {
      const customer = await stripe.customers.create(
        { metadata: { surewordUserId: userId } },
        { idempotencyKey: `sureword-customer-${userId}` },
      );
      billing = await prisma.billingSubscription.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          stripeCustomerId: customer.id,
          periodStart: new Date(),
          periodEnd: new Date(),
        },
      });
    }
    const customerId = billing.stripeCustomerId;
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        });
        if (subscriptions.has_more)
          throw new Error("Subscription history needs reconciliation.");
        if (
          subscriptions.data.some((sub) =>
            [
              "active",
              "trialing",
              "past_due",
              "unpaid",
              "incomplete",
              "paused",
            ].includes(sub.status),
          )
        ) {
          return Response.json(
            {
              error:
                "A subscription already exists. Use Manage billing to update it.",
            },
            { status: 409 },
          );
        }
        const openSessions = await stripe.checkout.sessions.list({
          customer: customerId,
          status: "open",
          limit: 100,
        });
        if (openSessions.has_more)
          throw new Error("Checkout history needs reconciliation.");
        const existing = openSessions.data.find(
          (session) =>
            session.mode === "subscription" &&
            session.client_reference_id === userId &&
            session.metadata?.surewordPriceId === price.id &&
            session.expires_at > Date.now() / 1000,
        );
        if (existing?.url) {
          captureCheckoutStarted(userId, req, true);
          return Response.json({ url: existing.url });
        }
        const attempt = `sureword-checkout-${userId}-${Math.floor(Date.now() / 300000)}`;
        const integrationSuffix = [
          ...createHash("sha256").update(attempt).digest().subarray(0, 8),
        ]
          .map((value) => String.fromCharCode(97 + (value % 26)))
          .join("");
        const session = await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer: customerId,
            line_items: [{ price: price.id, quantity: 1 }],
            client_reference_id: userId,
            metadata: { surewordPriceId: price.id },
            subscription_data: { metadata: { surewordUserId: userId } },
            success_url: `${returnOrigin}/membership?checkout=success`,
            cancel_url: `${returnOrigin}/membership`,
            integration_identifier: `sureword-${integrationSuffix}`,
          },
          { idempotencyKey: attempt },
        );
        captureCheckoutStarted(userId, req, false);
        return Response.json({ url: session.url });
      },
      { timeout: 45000, maxWait: 15000 },
    );
    // This route answers with a URL the browser immediately follows, and the
    // function can freeze the moment it responds, so the event is pushed
    // before returning rather than left in a queue nothing will drain.
    await flushAnalytics();
    return result;
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: "Checkout could not be opened. Please try again shortly." },
      { status: 503 },
    );
  }
}
