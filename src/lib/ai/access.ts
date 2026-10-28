/**
 * Which of the two AI worlds an account lives in.
 *
 * - `house`: SureWord runs the answer on its own OpenAI key, on one fixed
 *   model at one fixed effort. No picker, no choice, nothing persisted.
 * - `keys`: the owner's account (SERVER_CREDENTIAL_USER_IDS), which runs on
 *   the server's keys unmetered. Nobody else: personal API keys were removed
 *   on 2026-10-25 (Austin: "no more BYOK, its either free or pay for pro").
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

/**
 * The effort for one included call, given who supplied `requested`.
 *
 * Only a server call site's pin (tap-a-verse, word study, connections pass
 * "low" for latency) may lower Pro. Chat's effort comes from the client's
 * stored picker state, which every client still sends and GET /api/preferences
 * still syncs from User.defaultEffort. No plan has Reasoning chips any more, so
 * a "low" left there from the BYOK or chip era would otherwise hold a Pro
 * account at low with no way to change it from any client.
 */
export function includedEffortFor(options: {
	requested: string | null | undefined;
	plan: "pro" | "free";
	/** The effort came from a chat request body, not a server call site. */
	fromChat: boolean;
}): HouseEffort {
	return houseEffortFor(options.fromChat ? null : options.requested, options.plan);
}

export function decideAccess(options: {
	/** On SERVER_CREDENTIAL_USER_IDS: may spend the server's keys freely. */
	allowlisted: boolean;
}): AiAccess {
	return options.allowlisted ? "keys" : "house";
}
