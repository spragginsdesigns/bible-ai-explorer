/**
 * Which of the two AI worlds an account lives in.
 *
 * - `house`: SureWord runs the answer on its own OpenAI key, on one fixed
 *   model at one fixed effort. No picker, no choice, nothing persisted.
 * - `keys`: the account brings its own credentials (or is allowlisted onto the
 *   server's), and keeps the full model and effort picker.
 *
 * Kept pure - no Prisma, no `server-only`, no env reads - so the rule itself is
 * unit-testable (`tests/ai-access.test.mjs`) and can be imported from anywhere.
 * `aiAccessFor` in `provider.ts` supplies the two facts it needs.
 */
export type AiAccess = "house" | "keys";

export type HouseEffort = "low" | "high";

/**
 * The reasoning efforts an included (house) account may choose: none, on
 * either plan (Austin, 2026-10-25: "there shouldn't be a model picker for
 * regular users"). The plan decides the effort instead, see `houseEffortFor`.
 * Kept as a function because GET /api/ai/models still reports the list and
 * every client renders Reasoning chips from it, so an empty list hides them.
 */
export function houseEffortsFor(_plan: "pro" | "free"): readonly HouseEffort[] {
	return [];
}

/**
 * The effort an included call runs at (Austin, 2026-10-25). Free answers on
 * low. Pro ("SureWord Pro AI") answers on high, and nothing past it: xhigh and
 * max on Luna run long enough to bring back the multi-minute answers that made
 * a tester think chat had frozen. A Pro call site that pins low for latency
 * (tap-a-verse, word study, connections) keeps low. Pure so the money rule has
 * a test.
 */
export function houseEffortFor(
	requested: string | null | undefined,
	plan: "pro" | "free" = "free",
): HouseEffort {
	if (plan === "free" || requested === "low") return "low";
	return "high";
}

export function decideAccess(options: {
	/** On SERVER_CREDENTIAL_USER_IDS: may spend the server's keys freely. */
	allowlisted: boolean;
	/** How many provider keys this account has stored of its own. */
	ownKeyCount: number;
	/** Undefined preserves legacy behavior; null means a new account defaults to included AI. */
	includedPreference?: boolean | null;
}): AiAccess {
	if (options.allowlisted) return "keys";
	if (options.includedPreference !== undefined) return options.includedPreference === false ? "keys" : "house";
	// One key is enough to leave the house: the picker still lists only the
	// providers that key unlocks, so there is nothing to fall back to.
	return options.allowlisted || options.ownKeyCount > 0 ? "keys" : "house";
}
