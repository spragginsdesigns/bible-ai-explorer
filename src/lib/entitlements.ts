import "server-only";

import { prisma } from "@/lib/prisma";
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
	if (allowlist.includes(userId)) return "pro";

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { plan: true },
	});
	return resolvePlan({ plan: user?.plan ?? null, userId, allowlist });
}

/** Whether this user may use the SureWord Pro benefits. */
export async function isProUser(userId: string): Promise<boolean> {
	return (await getUserPlan(userId)) === "pro";
}
