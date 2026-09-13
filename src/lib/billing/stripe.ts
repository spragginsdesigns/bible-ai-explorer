import "server-only";
import Stripe from "stripe";
import { PRO_MONTHLY_PRICE_CENTS } from "./plans";
import { resolveBillingReturnOrigin } from "./return-origin";

export function billingReturnOrigin() {
  const testMode = /^(sk|rk)_test_/.test(
    process.env.STRIPE_SECRET_KEY?.trim() ?? "",
  );
  return resolveBillingReturnOrigin(
    process.env.SUREWORD_BILLING_RETURN_ORIGIN,
    testMode,
  );
}

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe is not configured.");
  return new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
}

export function billingAvailable() {
  return (
    process.env.SUREWORD_USAGE_ENABLED === "true" &&
    process.env.SUREWORD_BILLING_ENABLED === "true" &&
    Boolean(
      process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_PRO_PRICE_ID &&
        process.env.STRIPE_WEBHOOK_SECRET,
    )
  );
}

export async function verifiedProPrice(stripe: Stripe) {
  const price = await stripe.prices.retrieve(
    process.env.STRIPE_PRO_PRICE_ID ?? "",
  );
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== PRO_MONTHLY_PRICE_CENTS ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    throw new Error(
      "The configured price does not match SureWord Pro's monthly terms.",
    );
  }
  return price;
}
