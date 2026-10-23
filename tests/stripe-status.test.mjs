/**
 * BillingSubscription status from the Stripe webhook (reconcileStripeStatus),
 * above all the dispute hold and the events that may lift it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { reconcileStripeStatus } from "../src/lib/billing/stripe-status.ts";

const base = {
	priceRecognized: true,
	subscriptionStatus: "active",
	latestInvoicePaid: true,
	latestInvoiceIsRenewal: false,
	storedStatus: "active",
	payment: null,
};
const run = (over) => reconcileStripeStatus({ ...base, ...over });
const dispute = (disputeStatus, onLatestInvoice) => ({ onLatestInvoice, refunded: false, disputeStatus });

test("disputed -> invoice.paid (renewal) -> dispute closed won => entitled again", () => {
	// 1. The dispute opens on the invoice that is still the latest.
	let stored = run({ payment: dispute("needs_response", true) }).status;
	assert.equal(stored, "payment_disputed");
	// 2. The renewal pays while the dispute is open: no news about it, so the hold stays.
	stored = run({ storedStatus: stored, latestInvoiceIsRenewal: true }).status;
	assert.equal(stored, "payment_disputed");
	// 3. The dispute closes won, but its invoice is no longer the latest one.
	const closed = run({ storedStatus: stored, latestInvoiceIsRenewal: true, payment: dispute("won", false) });
	assert.deepEqual(closed, { status: "active", revoke: false });
	// 4. Later unrelated events keep it active.
	assert.equal(run({ storedStatus: closed.status, latestInvoiceIsRenewal: true }).status, "active");
});

test("warning_closed counts as settled on an older invoice too", () => {
	assert.equal(run({ storedStatus: "payment_disputed", payment: dispute("warning_closed", false) }).status, "active");
});

test("a won dispute never overrides a genuinely canceled or unpaid subscription", () => {
	for (const subscriptionStatus of ["canceled", "unpaid", "past_due"]) {
		for (const onLatestInvoice of [true, false]) {
			const result = run({ storedStatus: "payment_disputed", subscriptionStatus, payment: dispute("won", onLatestInvoice) });
			assert.deepEqual(result, { status: subscriptionStatus, revoke: false }, `${subscriptionStatus} ${onLatestInvoice}`);
		}
	}
});

test("an open dispute on an older invoice keeps the hold", () => {
	for (const status of ["needs_response", "under_review", "warning_under_review"]) {
		assert.equal(run({ storedStatus: "payment_disputed", payment: dispute(status, false) }).status, "payment_disputed");
	}
});

test("a dispute closing won on the latest invoice behaves as before", () => {
	assert.equal(run({ storedStatus: "payment_disputed", payment: dispute("won", true) }).status, "active");
});

test("lost dispute or refund on the latest invoice revokes; older invoices do not", () => {
	assert.deepEqual(run({ payment: dispute("lost", true) }), { status: "canceled", revoke: true });
	assert.deepEqual(run({ payment: { onLatestInvoice: true, refunded: true, disputeStatus: null } }), { status: "canceled", revoke: true });
	assert.deepEqual(run({ payment: { onLatestInvoice: false, refunded: true, disputeStatus: null } }), { status: "active", revoke: false });
	// Already canceled: nothing to cancel again.
	assert.deepEqual(run({ subscriptionStatus: "canceled", payment: dispute("lost", true) }), { status: "canceled", revoke: false });
});

test("activation and price gates are unchanged", () => {
	assert.equal(run({ latestInvoicePaid: false }).status, "incomplete");
	assert.equal(run({ latestInvoicePaid: false, latestInvoiceIsRenewal: true }).status, "active");
	assert.equal(run({ priceRecognized: false }).status, "unrecognized_price");
	assert.equal(run({ priceRecognized: false, payment: dispute("lost", true) }).revoke, false);
});
