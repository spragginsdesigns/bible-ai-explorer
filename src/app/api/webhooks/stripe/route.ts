import type Stripe from "stripe";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { captureServerEvent, flushAnalytics } from "@/lib/analytics/server";
import { prisma } from "@/lib/prisma";
import { stripeClient } from "@/lib/billing/stripe";

export const maxDuration = 60;

/**
 * What reconciliation actually wrote, returned out of the transaction so the
 * analytics event is emitted only after the write commits.
 *
 * Returned rather than assigned to an outer variable for a boring but real
 * reason: TypeScript cannot see an assignment made inside the callback, so an
 * outer `let` narrows to `never` after the await and the properties stop
 * type-checking. It is also more honest, because a rollback then cannot leave
 * behind a report of a change that did not happen.
 */
type SubscriptionChange = {
  userId: string;
  status: string;
  previousStatus: string;
  cancelAtPeriodEnd: boolean;
};

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  if (!signature) return new Response("Missing signature", { status: 400 });
  let event: Stripe.Event;
  let stripe;
  try {
    stripe = stripeClient();
    event = stripe.webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return new Response("Invalid webhook", { status: 400 });
  }
  try {
    const object = event.data.object;
    let subscriptionId: string | null = null;
    let paymentChange: {
      invoiceId: string;
      chargeId: string;
      disputeId?: string;
    } | null = null;
    if (
      (event.type === "charge.refunded" && object.object === "charge") ||
      object.object === "dispute"
    ) {
      const chargeId =
        object.object === "charge"
          ? object.id
          : typeof object.charge === "string"
            ? object.charge
            : object.charge.id;
      const charge = await stripe.charges.retrieve(chargeId);
      const intentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (intentId) {
        const payments = await stripe.invoicePayments.list({
          payment: { type: "payment_intent", payment_intent: intentId },
          limit: 100,
        });
        if (payments.has_more || payments.data.length > 1)
          throw new Error("Payment needs explicit invoice reconciliation.");
        const invoiceRef = payments.data[0]?.invoice;
        if (invoiceRef) {
          const invoiceId =
            typeof invoiceRef === "string" ? invoiceRef : invoiceRef.id;
          const invoice = await stripe.invoices.retrieve(invoiceId);
          const ref = invoice.parent?.subscription_details?.subscription;
          subscriptionId = typeof ref === "string" ? ref : (ref?.id ?? null);
          paymentChange = {
            invoiceId,
            chargeId,
            ...(object.object === "dispute" ? { disputeId: object.id } : {}),
          };
        }
      }
    }
    if (object.object === "subscription") subscriptionId = object.id;
    if (object.object === "checkout.session")
      subscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : (object.subscription?.id ?? null);
    if (object.object === "invoice") {
      const sub = object.parent?.subscription_details?.subscription;
      subscriptionId = typeof sub === "string" ? sub : (sub?.id ?? null);
    }
    if (!subscriptionId) return Response.json({ received: true });
    if (await prisma.billingEvent.findUnique({ where: { id: event.id } }))
      return Response.json({ received: true });
    const initialSubscription =
      await stripe.subscriptions.retrieve(subscriptionId);
    const immutableCustomerId =
      typeof initialSubscription.customer === "string"
        ? initialSubscription.customer
        : initialSubscription.customer.id;
    const change = await prisma.$transaction(
      async (tx): Promise<SubscriptionChange | null> => {
        // Serialize reconciliation and fetch current Stripe state after the lock, not the old event snapshot.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${immutableCustomerId}))`;
        if (await tx.billingEvent.findUnique({ where: { id: event.id } }))
          return null;
        let subscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["latest_invoice"],
        });
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const billing = await tx.billingSubscription.findUnique({
          where: { stripeCustomerId: customerId },
        });
        if (!billing) throw new Error("Unknown SureWord billing customer.");
        if (
          billing.stripeSubscriptionId &&
          billing.stripeSubscriptionId !== subscription.id
        ) {
          const mapped = await stripe.subscriptions.retrieve(
            billing.stripeSubscriptionId,
          );
          // A late event for an old subscription must not revoke a later paid membership.
          if (
            mapped.created > subscription.created ||
            (mapped.status === "active" && subscription.status !== "active")
          ) {
            await tx.billingEvent.create({ data: { id: event.id } });
            return null;
          }
        }
        const item = subscription.items.data.find(
          (item) => item.price.id === process.env.STRIPE_PRO_PRICE_ID,
        );
        const invoice = subscription.latest_invoice;
        const paid =
          invoice && typeof invoice !== "string" && invoice.status === "paid";
        // Only the opening invoice gates activation. A renewal invoice sits in
        // draft for about an hour before Stripe charges it, and a failed renewal
        // moves the subscription itself to past_due, so gating on it would drop
        // every paying member to Free at each renewal.
        const renewal =
          invoice &&
          typeof invoice !== "string" &&
          invoice.billing_reason !== "subscription_create";
        let status: string = !item
          ? "unrecognized_price"
          : subscription.status === "active" && !paid && !renewal
            ? "incomplete"
            : subscription.status;
        if (
          billing.status === "payment_disputed" &&
          subscription.status === "active"
        )
          status = "payment_disputed";
        const latestInvoiceId =
          typeof invoice === "string" ? invoice : invoice?.id;
        if (
          item &&
          paymentChange &&
          latestInvoiceId === paymentChange.invoiceId
        ) {
          const charge = await stripe.charges.retrieve(paymentChange.chargeId);
          const dispute = paymentChange.disputeId
            ? await stripe.disputes.retrieve(paymentChange.disputeId)
            : null;
          const revoke = charge.refunded || dispute?.status === "lost";
          if (revoke && subscription.status !== "canceled") {
            subscription = await stripe.subscriptions.cancel(
              subscription.id,
              {},
              { idempotencyKey: `sureword-revoke-${event.id}` },
            );
            status = "canceled";
          } else if (
            dispute?.status === "won" ||
            dispute?.status === "warning_closed"
          ) {
            status =
              subscription.status === "active" && paid
                ? "active"
                : subscription.status;
          } else if (dispute && subscription.status === "active") {
            status = "payment_disputed";
          }
        }
        await tx.billingSubscription.update({
          where: { userId: billing.userId },
          data: {
            stripeSubscriptionId: subscription.id,
            status,
            periodStart: item
              ? new Date(item.current_period_start * 1000)
              : billing.periodStart,
            periodEnd: item
              ? new Date(Math.min(item.current_period_end, subscription.cancel_at ?? Infinity) * 1000)
              : billing.periodEnd,
            // The hosted portal can schedule cancel_at without setting the legacy boolean.
            cancelAtPeriodEnd: subscription.cancel_at_period_end || Boolean(
              item && subscription.cancel_at && subscription.cancel_at <= item.current_period_end,
            ),
          },
        });
        await tx.billingEvent.create({ data: { id: event.id } });
        return {
          userId: billing.userId,
          status,
          previousStatus: billing.status,
          cancelAtPeriodEnd:
            subscription.cancel_at_period_end ||
            Boolean(
              item &&
                subscription.cancel_at &&
                subscription.cancel_at <= item.current_period_end,
            ),
        };
      },
      { timeout: 30000 },
    );
    if (change) {
      // Revenue was entirely invisible to analytics until now: Stripe went
      // live on 2026-09-14 and neither webhook emitted anything, so a
      // subscription starting, failing or churning left no trace outside
      // Stripe's own dashboard. No amount and no customer id travel with it.
      captureServerEvent({
        userId: change.userId,
        event: ANALYTICS_EVENTS.subscriptionChanged,
        properties: {
          status: change.status,
          previousStatus: change.previousStatus,
          cancelAtPeriodEnd: change.cancelAtPeriodEnd,
          provider: "stripe",
          reason: event.type,
        },
      });
      // Stripe retries on a non-2xx, so this must not be able to fail the
      // webhook: flushAnalytics already swallows its own errors and is
      // bounded, and a lost event is better than a redelivered charge.
      await flushAnalytics();
    }
    return Response.json({ received: true });
  } catch {
    return new Response("Reconciliation failed; retry required", {
      status: 503,
    });
  }
}
