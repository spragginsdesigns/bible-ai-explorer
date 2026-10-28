/**
 * Pure copy for the Membership card's subscription lines, kept apart from the
 * component so it can be unit-tested. Mirrors the web /membership page
 * (src/app/membership/page.tsx), which shows the same period and payment
 * state for every store.
 */

export type MembershipSubscription = {
	provider?: string;
	status?: string;
	periodEnd?: string;
	cancelAtPeriodEnd?: boolean;
};

/** When the paid period ends, has ended, or why it stopped. Null when there is nothing to say. */
export function subscriptionStatusLine(
	plan: "free" | "pro",
	subscription: MembershipSubscription | null | undefined,
	formatDate: (date: Date) => string = (date) => date.toLocaleDateString(),
): string | null {
	if (!subscription) return null;
	const end = subscription.periodEnd ? new Date(subscription.periodEnd) : null;
	const date = end && !Number.isNaN(end.getTime()) ? formatDate(end) : null;
	if (plan !== "pro") {
		if (subscription.status === "past_due" || subscription.status === "unpaid")
			return "Your last payment did not go through. Update your payment method to restore Pro.";
		return date ? `Paid access ended ${date}.` : null;
	}
	if (!date) return null;
	return `${subscription.cancelAtPeriodEnd ? "Paid access ends" : "Current billing period ends"} ${date}.`;
}

/**
 * Where a subscription bought outside Google Play is managed. Plain text, not
 * a link: the phone cannot manage another store's subscription, and Play
 * billing rules keep in-app links away from other payment pages. Only for a
 * subscription that is still live (Pro, or a failed payment to fix), so a
 * lapsed one is never pointed at another store to buy again.
 */
export function externalManagementLine(
	plan: "free" | "pro",
	subscription: MembershipSubscription | null | undefined,
): string | null {
	const live = plan === "pro" || subscription?.status === "past_due" || subscription?.status === "unpaid";
	if (!live) return null;
	if (subscription?.provider === "app_store")
		return "This subscription was bought on an Apple device. Manage it in your Apple ID settings.";
	if (subscription?.provider === "stripe")
		return "This subscription was bought on sureword.app. Manage it there under Membership.";
	return null;
}
