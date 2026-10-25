import { getAuthUser } from "@/lib/auth";
import { getUserPlan } from "@/lib/entitlements";
import { isServerCredentialUser, aiAccessFor } from "@/lib/ai/provider";
import { usageEnabled, usageSnapshot } from "@/lib/billing/usage";
import { PRO_MONTHLY_PRICE_CENTS } from "@/lib/billing/plans";
import { billingAvailable } from "@/lib/billing/stripe";
import { rejectCrossSiteMutation } from "@/lib/billing/request";
import { accountSubscription, appStoreBillingAvailable, playBillingAvailable } from "@/lib/billing/subscription";

export async function GET() {
  try {
    const userId = await getAuthUser();
    const enabled = usageEnabled();
    const owner = isServerCredentialUser(userId);
    const [plan, access, subscription, usage] = await Promise.all([
      getUserPlan(userId),
      aiAccessFor(userId),
      enabled
        ? accountSubscription(userId)
        : null,
      enabled && !owner ? usageSnapshot(userId) : null,
    ]);
    return Response.json(
      {
        plan,
        owner,
        access,
        // Personal keys were removed on 2026-10-25; older clients still read it.
        hasPersonalKeys: false,
        // Opening checkout creates a customer row before any subscription exists;
        // an abandoned checkout must not read as a billing period to manage.
        subscription: subscription &&
          (subscription.provider !== "stripe" || subscription.stripeSubscriptionId) ? {
          status: subscription.status,
          periodEnd: subscription.periodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          provider: subscription.provider,
        } : null,
        usage,
        enabled,
        priceCents: PRO_MONTHLY_PRICE_CENTS,
        checkoutAvailable: billingAvailable(),
        playCheckoutAvailable: playBillingAvailable(),
        // StoreKit purchases verify and count toward Pro (iOS only shows the
        // purchase UI when this is true).
        appStoreCheckoutAvailable: appStoreBillingAvailable(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: "Could not load membership details." },
      { status: 503 },
    );
  }
}

/**
 * The old "Included AI / My API key" switch. Personal keys were removed on
 * 2026-10-25, so there is nothing left to switch to; an older client that
 * still sends it gets a clear refusal.
 */
export async function PATCH(req: Request) {
  const rejected = rejectCrossSiteMutation(req);
  if (rejected) return rejected;
  return Response.json(
    { error: "Personal API keys are no longer supported. Every account is Free or Pro." },
    { status: 410 },
  );
}
