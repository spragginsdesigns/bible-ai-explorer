import { getAuthUser } from "@/lib/auth";
import { rejectCrossSiteMutation } from "@/lib/billing/request";
import { appStoreBillingAvailable } from "@/lib/billing/subscription";
import {
	AppStoreBindingError,
	AppStoreVerificationError,
	verifyDeviceTransaction,
} from "@/lib/billing/app-store";

/**
 * The iOS client posts `{ signedTransaction: transaction.jwsRepresentation }`
 * after a StoreKit 2 purchase, a restore or a `Transaction.updates` delivery,
 * and calls `transaction.finish()` only on a definitive answer:
 *  - 200 `{ verified: true, active, expiresAt }`: recorded (active or not),
 *  - 403: genuine, but bound to another SureWord account.
 * 400/503 leave the transaction unfinished so StoreKit redelivers it.
 */
export async function POST(req: Request) {
	const rejected = rejectCrossSiteMutation(req);
	if (rejected) return rejected;
	try {
		if (!appStoreBillingAvailable())
			return Response.json({ error: "App Store billing is not available yet." }, { status: 503 });
		const userId = await getAuthUser();
		const body = (await req.json().catch(() => null)) as { signedTransaction?: unknown } | null;
		if (typeof body?.signedTransaction !== "string")
			return Response.json({ error: "A signed App Store transaction is required." }, { status: 400 });
		const result = await verifyDeviceTransaction(userId, body.signedTransaction);
		return Response.json(
			{ verified: true, active: result.active, status: result.status, expiresAt: result.expiresAt.toISOString() },
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	} catch (error) {
		if (error instanceof Response) return error;
		if (error instanceof AppStoreBindingError) return Response.json({ error: error.message }, { status: 403 });
		if (error instanceof AppStoreVerificationError)
			return Response.json({ error: error.message }, { status: error.retryable ? 503 : 400 });
		const message = error instanceof Error ? error.message : "";
		if (message.startsWith("This App Store purchase") || message.startsWith("App Store transaction"))
			return Response.json({ error: message }, { status: 400 });
		return Response.json({ error: "The App Store purchase could not be verified right now." }, { status: 503 });
	}
}
