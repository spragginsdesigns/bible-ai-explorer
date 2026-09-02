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
 * The effort a house call runs at. Medium is the ceiling, not a floor: a call
 * site that asks for low (tap-a-verse pins it for latency) keeps low, and
 * nothing above medium is honoured, so a hand-crafted request cannot raise the
 * server's bill. Pure so the money rule has a test.
 */
export function houseEffortFor(requested: string | null | undefined): "low" | "medium" {
	return requested === "low" ? "low" : "medium";
}

export function decideAccess(options: {
	/** On SERVER_CREDENTIAL_USER_IDS: may spend the server's keys freely. */
	allowlisted: boolean;
	/** How many provider keys this account has stored of its own. */
	ownKeyCount: number;
}): AiAccess {
	// One key is enough to leave the house: the picker still lists only the
	// providers that key unlocks, so there is nothing to fall back to.
	return options.allowlisted || options.ownKeyCount > 0 ? "keys" : "house";
}
