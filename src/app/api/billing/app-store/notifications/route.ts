import { AppStoreVerificationError, processNotification } from "@/lib/billing/app-store";

/**
 * App Store Server Notifications V2 for SureWord (bundle
 * com.spragginsdesigns.sureword) only. Public in `src/middleware.ts`: Apple
 * carries no session; the signed payload is the credential, verified against
 * Apple Root CA G3 for SureWord's bundle id.
 *
 * Apple retries anything that is not a 2xx, so: a verified notification is
 * 200 whether it moved a row, was a duplicate, or is a type SureWord ignores;
 * an unverifiable one is 400; a transient failure (Apple's revocation check
 * unreachable, the database down) is 503 so the retry can land.
 */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { signedPayload?: unknown } | null;
	if (typeof body?.signedPayload !== "string") return new Response("Missing signedPayload", { status: 400 });
	try {
		const outcome = await processNotification(body.signedPayload);
		return Response.json({ received: true, result: outcome.result });
	} catch (error) {
		if (error instanceof AppStoreVerificationError && !error.retryable)
			return new Response("Invalid notification", { status: 400 });
		return new Response("Notification processing failed; retry required", { status: 503 });
	}
}
