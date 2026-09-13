import { createHash } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isServerCredentialUser } from "@/lib/ai/provider";
import { rejectCrossSiteMutation } from "@/lib/billing/request";
import {
  billingAvailable,
  stripeClient,
  verifiedProPrice,
} from "@/lib/billing/stripe";

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
    const stripe = stripeClient();
    const price = await verifiedProPrice(stripe);
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
    return await prisma.$transaction(
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
        if (existing?.url) return Response.json({ url: existing.url });
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
            success_url: "https://sureword.app/membership?checkout=success",
            cancel_url: "https://sureword.app/membership",
            integration_identifier: `sureword-${integrationSuffix}`,
          },
          { idempotencyKey: attempt },
        );
        return Response.json({ url: session.url });
      },
      { timeout: 45000, maxWait: 15000 },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: "Checkout could not be opened. Please try again shortly." },
      { status: 503 },
    );
  }
}
