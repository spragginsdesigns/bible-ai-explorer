import "server-only";

import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { activeSubscription } from "@/lib/billing/plans";
import { accountSubscription } from "@/lib/billing/subscription";
import { refreshGooglePlaySubscription } from "@/lib/billing/google-play";
import {
	parseUserIdAllowlist,
	resolvePlan,
	type PlanInput,
	type UserPlan,
} from "@/lib/entitlements-rules";

/**
 * SureWord Pro - who is entitled to the paid benefits.
 *
 * Two ways to be Pro, deliberately: the `User.plan` column is what billing
 * will write when it exists, and `PRO_USER_IDS` is an env allowlist that
 * grants Pro with no database write at all. The allowlist is how Austin's own
 * account and any comped account are flagged today, before there is anything
 * to bill; it follows the same convention as `SERVER_CREDENTIAL_USER_IDS`
 * (comma-separated Clerk ids) and shares its parser.
 *
 * The rules themselves are pure and live in `entitlements-rules.ts`; this
 * module is only the database half.
 */

export { parseUserIdAllowlist, resolvePlan, type PlanInput, type UserPlan };

/** This user's tier, from their row plus the `PRO_USER_IDS` allowlist. */
export async function getUserPlan(userId: string): Promise<UserPlan> {
	// The allowlist alone is enough, so skip the query when it already answers.
	const allowlist = parseUserIdAllowlist(process.env.PRO_USER_IDS);
	if (allowlist.includes(userId) || parseUserIdAllowlist(process.env.SERVER_CREDENTIAL_USER_IDS).includes(userId)) return "pro";
	if (process.env.SUREWORD_USAGE_ENABLED === "true") {
		const subscription = await accountSubscription(userId);
		if (subscription && activeSubscription(subscription)) {
			// A stale Play check talks to Google and can take most of a minute, so an
			// active row answers now and a revocation lands after this response.
			if (subscription.provider === "google-play") waitUntil(refreshGooglePlaySubscription(userId));
			return "pro";
		}
		// Only a renewal Google has not pushed to us yet can turn a lapsed row back on, so wait here.
		await refreshGooglePlaySubscription(userId);
		// False can mean another request refreshed before our outer read or lock.
		// Always re-read the authoritative row before falling back to Free.
		const refreshed = await accountSubscription(userId);
		if (refreshed && activeSubscription(refreshed)) return "pro";
	}

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { plan: true },
	});
	return resolvePlan({ plan: user?.plan ?? null, userId, allowlist });
}

export type MembershipSnapshot = {
	plan: UserPlan;
	subscription: Awaited<ReturnType<typeof accountSubscription>>;
};

/** One settled membership for status and quota, held even if a later event arrives. */
export async function getMembershipSnapshot(userId: string): Promise<MembershipSnapshot> {
	const allowlist = parseUserIdAllowlist(process.env.PRO_USER_IDS);
	const complimentary = allowlist.includes(userId) || parseUserIdAllowlist(process.env.SERVER_CREDENTIAL_USER_IDS).includes(userId);
	const [initial, user] = await Promise.all([
		process.env.SUREWORD_USAGE_ENABLED === "true" ? accountSubscription(userId) : null,
		complimentary ? null : prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
	]);
	let subscription = initial;
	// Ordinary Free accounts have no paid history to refresh. Active other-store
	// subscriptions also need no Google call; lapsed history may hide a renewal.
	if (subscription && (subscription.provider === "google-play" || !activeSubscription(subscription))) {
		await refreshGooglePlaySubscription(userId);
		subscription = await accountSubscription(userId);
	}
	const plan = complimentary || (subscription && activeSubscription(subscription))
		? "pro" : resolvePlan({ plan: user?.plan ?? null, userId, allowlist });
	return { plan, subscription };
}

/** Whether this user may use the SureWord Pro benefits. */
export async function isProUser(userId: string): Promise<boolean> {
	return (await getUserPlan(userId)) === "pro";
}
