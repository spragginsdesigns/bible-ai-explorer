import { refreshBoundPurchase, verifyRtdnOidc } from "@/lib/billing/google-play";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return new Response("Missing authorization", { status: 401 });
    try {
      await verifyRtdnOidc(auth.slice(7));
    } catch {
      return new Response("Invalid RTDN authorization", { status: 401 });
    }
    const body = await req.json().catch(() => null) as { message?: { data?: unknown } } | null;
    const encoded = body?.message?.data;
    if (typeof encoded !== "string" || !encoded || encoded.length > 32_768) return new Response("Invalid message", { status: 400 });
    let notification: { packageName?: unknown; subscriptionNotification?: { purchaseToken?: unknown }; testNotification?: unknown } | null;
    try {
      notification = JSON.parse(Buffer.from(encoded, "base64").toString());
    } catch {
      return new Response("Invalid message", { status: 400 });
    }
    if (typeof notification?.packageName !== "string") return new Response("Missing package", { status: 400 });
    if (notification.packageName !== (process.env.SUREWORD_PLAY_PACKAGE_NAME ?? "com.spragginsdesigns.sureword")) return new Response(null, { status: 204 });
    const token = notification.subscriptionNotification?.purchaseToken;
    if (token !== undefined) {
      if (typeof token !== "string" || !token || token.length > 512) return new Response("Invalid purchase token", { status: 400 });
      await refreshBoundPurchase(token);
    }
    return Response.json({ received: true });
  } catch {
    return new Response("RTDN processing failed; retry required", { status: 503 });
  }
}
