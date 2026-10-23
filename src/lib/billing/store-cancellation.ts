/**
 * Store subscriptions on account deletion (`DELETE /api/account`).
 *
 * Deleting the account cascades away the `GooglePlaySubscription` row, the
 * only link between a Play purchase and a person. Google keeps renewing
 * regardless, so a deleted member would go on paying for Pro with no account
 * to use it on and nothing left in our database to find them by. These rules
 * stop that first. No imports, so tests/store-cancellation.test.mjs loads this
 * file straight through type stripping with the Play client mocked.
 *
 * The App Store has no counterpart here: no server API can cancel an Apple
 * subscription, so every client warns before deleting instead (see
 * src/lib/account-deletion.ts for why deletion is not refused).
 */

/**
 * Play subscription states after which Google will never charge again on its
 * own: renewal already turned off (CANCELED), lapsed for good (EXPIRED), or a
 * pending first purchase that was abandoned. Every other state, including ones
 * Google adds later, is treated as still able to bill and gets cancelled: a
 * cancel we did not need costs nothing, a charge we missed costs a member money.
 */
export const PLAY_STATES_THAT_NEVER_BILL: readonly string[] = [
	"SUBSCRIPTION_STATE_CANCELED",
	"SUBSCRIPTION_STATE_EXPIRED",
	"SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
];

export interface PlayCancellationClient {
	/** Google's live subscriptionState, or null when Google no longer knows the token. */
	readState(purchaseToken: string): Promise<string | null>;
	/** Turn renewal off. Resolves when done or when Google no longer knows the token; throws otherwise. */
	cancel(purchaseToken: string): Promise<void>;
}

export type PlayCancellationOutcome = "not_billing" | "cancelled";

/**
 * Stop a Play subscription from renewing. Reads Google's live state first
 * rather than trusting our row: the row reads "revoked" for ON_HOLD (Google
 * still retries the card and resumes billing when it succeeds), and it lags
 * whenever a notification was missed. Any failure throws, and the caller must
 * then keep the account, because after deletion nothing could ever cancel it.
 */
export async function stopPlayRenewal(
	purchaseToken: string,
	client: PlayCancellationClient,
): Promise<PlayCancellationOutcome> {
	const state = await client.readState(purchaseToken);
	if (state === null || PLAY_STATES_THAT_NEVER_BILL.includes(state)) return "not_billing";
	await client.cancel(purchaseToken);
	return "cancelled";
}
