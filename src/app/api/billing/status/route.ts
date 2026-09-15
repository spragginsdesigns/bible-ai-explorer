import { getAuthUser } from "@/lib/auth";
import { getUserPlan } from "@/lib/entitlements";
import { isServerCredentialUser, aiAccessFor } from "@/lib/ai/provider";
import { prisma } from "@/lib/prisma";
import { usageEnabled, usageSnapshot } from "@/lib/billing/usage";
import { PRO_MONTHLY_PRICE_CENTS } from "@/lib/billing/plans";
import { billingAvailable } from "@/lib/billing/stripe";
import { rejectCrossSiteMutation } from "@/lib/billing/request";
import { accountSubscription, playBillingAvailable } from "@/lib/billing/subscription";

export async function GET() {
  try {
    const userId = await getAuthUser();
    const enabled = usageEnabled();
    const owner = isServerCredentialUser(userId);
    const [plan, access, subscription, usage, ownKeys] = await Promise.all([
      getUserPlan(userId),
      aiAccessFor(userId),
      enabled
        ? accountSubscription(userId)
        : null,
      enabled && !owner ? usageSnapshot(userId) : null,
      prisma.providerCredential.count({ where: { userId } }),
    ]);
    return Response.json(
      {
        plan,
        owner,
        access,
        hasPersonalKeys: ownKeys > 0,
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

export async function PATCH(req: Request) {
  const rejected = rejectCrossSiteMutation(req);
  if (rejected) return rejected;
  try {
    const userId = await getAuthUser();
    if (!usageEnabled())
      return Response.json(
        { error: "Membership settings are not available yet." },
        { status: 503 },
      );
    const body = await req.json().catch(() => null);
    if (body?.access !== "house" && body?.access !== "keys")
      return Response.json(
        { error: "Choose included AI or personal keys." },
        { status: 400 },
      );
    if (
      body.access === "keys" &&
      !isServerCredentialUser(userId) &&
      (await prisma.providerCredential.count({ where: { userId } })) === 0
    ) {
      return Response.json(
        { error: "Add a personal API key in Settings first." },
        { status: 400 },
      );
    }
    await prisma.aiPreference.upsert({
      where: { userId },
      update: { includedAiPreferred: body.access === "house" },
      create: { userId, includedAiPreferred: body.access === "house" },
    });
    return GET();
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: "Could not update your AI payment choice." },
      { status: 503 },
    );
  }
}
