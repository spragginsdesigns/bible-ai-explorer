/**
 * Pure SureWord Pro rules: who counts as Pro, and how an env allowlist of
 * Clerk ids is parsed.
 *
 * Split from `entitlements.ts` for the same reason
 * `daily-cross-audio-script.ts` is split from `daily-cross-audio.ts` - that
 * module is `server-only` and talks to Prisma, and the rule that decides
 * whether someone is entitled to a paid feature is exactly the thing worth
 * testing directly (`tests/daily-cross-audio.test.mjs`).
 */

/** The tiers a user can be on. `User.plan` stores these strings verbatim. */
export type UserPlan = "free" | "pro";

/** Parse a comma-separated env allowlist of Clerk ids. */
export function parseUserIdAllowlist(raw: string | undefined | null): string[] {
	return (raw ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
}

export interface PlanInput {
	/** The stored `User.plan` value; null when there is no row yet. */
	plan: string | null | undefined;
	userId: string;
	/** Clerk ids granted Pro without a stored plan. */
	allowlist: string[];
}

/**
 * The tier to treat this user as.
 *
 * The allowlist wins over the column, because it exists precisely to grant Pro
 * to accounts nothing has written a plan for. Any unrecognised stored value
 * reads as "free" - a typo in that column must not hand out a paid feature.
 */
export function resolvePlan({ plan, userId, allowlist }: PlanInput): UserPlan {
	if (allowlist.includes(userId)) return "pro";
	return plan === "pro" ? "pro" : "free";
}

/**
 * Who may have today's devotional narrated (Listen), decided before any
 * database write, model call or ElevenLabs request.
 *
 * - "unavailable": this deployment has no ElevenLabs key.
 * - "locked": the account is on Free.
 * - "held": the account is Pro through a paid subscription, but subscription
 *   audio is still closed. Listen predates billing and went only to comped
 *   accounts (`PRO_USER_IDS`) and the owner (`SERVER_CREDENTIAL_USER_IDS`);
 *   with billing on (`SUREWORD_USAGE_ENABLED=true`) a subscriber hears it only
 *   when `SUREWORD_PRO_AUDIO_ENABLED=true`, so buying chat cannot start an
 *   unpriced voice workload. Clients are told "unavailable" (no card) for it.
 * - "allowed": narrate.
 */
export type ListenAccess = "unavailable" | "locked" | "held" | "allowed";

export function listenAccess(input: {
	speechConfigured: boolean;
	plan: UserPlan;
	userId: string;
	env: Record<string, string | undefined>;
}): ListenAccess {
	if (!input.speechConfigured) return "unavailable";
	if (input.plan !== "pro") return "locked";
	const existingGrant = [
		...parseUserIdAllowlist(input.env.PRO_USER_IDS),
		...parseUserIdAllowlist(input.env.SERVER_CREDENTIAL_USER_IDS),
	].includes(input.userId);
	if (input.env.SUREWORD_USAGE_ENABLED === "true" && !existingGrant && input.env.SUREWORD_PRO_AUDIO_ENABLED !== "true") {
		return "held";
	}
	return "allowed";
}
