/**
 * Pure rules for the founders-only SureWord Beta at /beta (LC-17631,
 * docs/beta/README.md): who may open it, and what everyone else gets.
 *
 * The allowlist is `BETA_USER_IDS`, parsed by `parseUserIdAllowlist` in
 * `entitlements-rules.ts` like `ADMIN_USER_IDS` and `PRO_USER_IDS`. Unset or
 * empty means nobody, never everybody.
 *
 * No imports on purpose: `tests/beta-access.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

/** True only for a non-empty Clerk id that is on the allowlist. */
export function isBetaUserId(userId: string | null | undefined, allowlist: readonly string[]): boolean {
	if (typeof userId !== "string") return false;
	const id = userId.trim();
	if (!id) return false;
	return allowlist.includes(id);
}

/**
 * The status a beta page or API answers before anything is read. A signed-in
 * account that is not on the list gets the ordinary 404 (not 403), so the beta
 * looks like any path that does not exist. Signed-out requests never reach
 * this: the middleware sends them to /sign-in (pages) or answers 401 (API),
 * exactly as it does for every unknown path.
 */
export function betaAccessStatus(userId: string | null | undefined, allowlist: readonly string[]): 200 | 404 {
	return isBetaUserId(userId, allowlist) ? 200 : 404;
}
