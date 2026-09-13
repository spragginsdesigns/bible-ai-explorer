import { getAuthUser } from "@/lib/auth";
import { billingEnabled, verifyAndBindPurchase } from "@/lib/billing/google-play";
import { rejectCrossSiteMutation } from "@/lib/billing/request";

export async function POST(req: Request) {
  const rejected = rejectCrossSiteMutation(req);
  if (rejected) return rejected;
  try {
    if (!billingEnabled()) return Response.json({ error: "Google Play billing is not available yet." }, { status: 503 });
    const userId = await getAuthUser();
    const body = await req.json().catch(() => null) as { purchaseToken?: unknown; productId?: unknown } | null;
    if (typeof body?.purchaseToken !== "string" || body.productId !== "sureword_pro") return Response.json({ error: "A valid Google Play purchase is required." }, { status: 400 });
    await verifyAndBindPurchase(userId, body.purchaseToken, body.productId);
    return Response.json({ verified: true });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : "Google Play purchase could not be verified.";
    return Response.json({ error: message }, { status: message.includes("account") ? 403 : 400 });
  }
}
