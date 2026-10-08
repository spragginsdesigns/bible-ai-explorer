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

/**
 * The reasoning efforts an included (house) account may choose, by plan
 * (Austin, 2026-10-08): Pro picks how hard Luna thinks, Free has no choice.
 * Stops at high: xhigh and max on Luna run long enough to bring back the
 * multi-minute answers that made a tester think chat had frozen.
 */
export const HOUSE_PRO_EFFORTS = ["low", "medium", "high"] as const;
export type HouseEffort = (typeof HOUSE_PRO_EFFORTS)[number];

export function houseEffortsFor(plan: "pro" | "free"): readonly HouseEffort[] {
	return plan === "pro" ? HOUSE_PRO_EFFORTS : [];
}

/**
 * The effort an included call runs at. Medium is the default and, for Free,
 * the ceiling: a call site that asks for low (tap-a-verse pins it for latency)
 * keeps low, and nothing above medium is honoured, so a hand-crafted request
 * cannot raise the server's bill. Pro may also ask for high, and nothing past
 * it. Pure so the money rule has a test.
 */
export function houseEffortFor(
	requested: string | null | undefined,
	plan: "pro" | "free" = "free",
): HouseEffort {
	if (requested === "low") return "low";
	if (plan === "pro" && requested === "high") return "high";
	return "medium";
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
