import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stripeClient, billingReturnOrigin } from "@/lib/billing/stripe";
import { rejectCrossSiteMutation } from "@/lib/billing/request";

export async function POST(req: Request) {
  const rejected = rejectCrossSiteMutation(req);
  if (rejected) return rejected;
  try {
    const userId = await getAuthUser();
    const billing = await prisma.billingSubscription.findUnique({
      where: { userId },
    });
    if (!billing)
      return Response.json(
        { error: "No billing account exists yet." },
        { status: 404 },
      );
    const session = await stripeClient().billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: `${billingReturnOrigin()}/membership`,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: "Billing management is temporarily unavailable." },
      { status: 503 },
    );
  }
}
