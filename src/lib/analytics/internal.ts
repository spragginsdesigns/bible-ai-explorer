/**
 * Who does not count as a user (docs/FEATURES.md, "What we measure").
 *
 * On 2026-09-20 PostHog reported four new users in a morning. Every one of
 * them was either this machine's emulator, Austin's own phone, or one of
 * Google Play's review devices running the demo account. Nothing had signed
 * up. With a handful of real people the difference between six and zero is the
 * difference between a product that is working and one nobody has opened, so
 * internal traffic has to be marked at the source rather than remembered.
 *
 * The mark is PostHog's own: the person property `$internal_or_test_user`,
 * which the project's "Internal / Test users" cohort already matches and which
 * `test_account_filters` already points at. Setting it is all that was ever
 * missing.
 *
 * It is a PERSON property, not an event property, and that is the whole design:
 * it applies backwards over everything that person has ever done, including the
 * anonymous events from before they signed in. That only works if the
 * anonymous trail actually merges into the account, which is why the reset
 * fix in AnalyticsProvider and mobile/app/_layout.tsx is part of this change
 * rather than a separate one.
 */

/** PostHog's own flag. The "Internal / Test users" cohort is defined on it. */
export const INTERNAL_PERSON_PROPERTY = "$internal_or_test_user";

/**
 * Is this account internal?
 *
 * The allowlist is `INTERNAL_USER_IDS`, read in ./server.ts with the same
 * comma-separated convention as `PRO_USER_IDS` and
 * `SERVER_CREDENTIAL_USER_IDS`. It holds Austin's own accounts and the Google
 * Play reviewer demo account.
 *
 * Unset means nobody is excluded, which is the safe direction to fail: a real
 * user wrongly counted is a smaller lie than a real user quietly dropped.
 *
 * This module imports nothing on purpose. It is the rule, and the rule is the
 * part worth running directly in tests/analytics-internal.test.mjs, which the
 * bare node test runner can only do while there is no "@" alias to resolve.
 */
export function isInternalUserId(userId: string, allowlist: string[]): boolean {
	return allowlist.includes(userId);
}

/**
 * Which deploy produced an event.
 *
 * Preview deploys share the production PostHog project, so without this a
 * branch being tested reads as production traffic. Vercel sets `VERCEL_ENV` to
 * production, preview or development on its own.
 */
export function deployEnvironment(): string {
	return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
}
