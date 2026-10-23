/**
 * The status `POST /api/webhooks/stripe` writes to `BillingSubscription`, as a
 * pure function of what the webhook read from Stripe after taking its lock.
 *
 * No imports, so tests/stripe-status.test.mjs loads it straight through type
 * stripping. The route does the Stripe reads and the cancel call; this decides.
 */

export interface StripePaymentChange {
  /** The refunded or disputed charge paid this subscription's latest invoice. */
  onLatestInvoice: boolean;
  refunded: boolean;
  /** Stripe's current dispute status, or null for a refund event. */
  disputeStatus: string | null;
}

export interface StripeStatusInput {
  /** The subscription carries the configured SureWord Pro price. */
  priceRecognized: boolean;
  subscriptionStatus: string;
  latestInvoicePaid: boolean;
  latestInvoiceIsRenewal: boolean;
  /** What the row says now, before this event. */
  storedStatus: string;
  /** Set only for a refund or dispute event that traced to this subscription. */
  payment: StripePaymentChange | null;
}

export interface StripeStatusDecision {
  status: string;
  /** Cancel the subscription in Stripe now (refund or lost dispute). */
  revoke: boolean;
}

/** Dispute statuses that end a dispute in the member's favour. */
export function disputeSettledForMember(status: string | null | undefined): boolean {
  return status === "won" || status === "warning_closed";
}

export function reconcileStripeStatus(input: StripeStatusInput): StripeStatusDecision {
  const active = input.subscriptionStatus === "active";
  // Only the opening invoice gates activation. A renewal invoice sits in
  // draft for about an hour before Stripe charges it, and a failed renewal
  // moves the subscription itself to past_due, so gating on it would drop
  // every paying member to Free at each renewal.
  let status = !input.priceRecognized
    ? "unrecognized_price"
    : active && !input.latestInvoicePaid && !input.latestInvoiceIsRenewal
      ? "incomplete"
      : input.subscriptionStatus;

  const payment = input.payment;
  const settled = disputeSettledForMember(payment?.disputeStatus);
  // payment_disputed is sticky across unrelated events (a renewal paying, the
  // portal changing something) because those carry no news about the dispute.
  // A dispute that closed in the member's favour is that news, even when it is
  // about an older invoice: a renewal that paid while the dispute was open
  // moves latest_invoice on, and before 2026-10-23 the won close then fell
  // outside the latest-invoice branch below and left a paying member locked
  // out of Pro for good. Settling only lifts the flag; the status underneath
  // is still Stripe's, so a canceled, unpaid or past_due subscription stays so.
  if (input.storedStatus === "payment_disputed" && active && !settled) status = "payment_disputed";

  if (input.priceRecognized && payment?.onLatestInvoice) {
    const revoke = payment.refunded || payment.disputeStatus === "lost";
    if (revoke && input.subscriptionStatus !== "canceled") return { status: "canceled", revoke: true };
    if (settled) status = active && input.latestInvoicePaid ? "active" : input.subscriptionStatus;
    else if (payment.disputeStatus !== null && active) status = "payment_disputed";
  }
  return { status, revoke: false };
}
