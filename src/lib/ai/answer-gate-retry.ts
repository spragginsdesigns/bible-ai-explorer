import type { AnswerReview, GatedAnswer } from "@/lib/ai/answer-gate";

/**
 * Runs the pre-display Scripture gate again when it withholds an answer, so a
 * draft the gate could not fix in its own single repair gets more rounds
 * instead of reaching the reader as "I couldn't finish checking this answer".
 *
 * Nothing about the checks is relaxed. Every round is the complete gate
 * (mechanical source check, independent review, repair, review again) on the
 * original draft, and only a round that passes all of it is released:
 * - a rejection starts the next round by repairing against that rejection's
 *   findings (gateAnswer's initialReview), then reviews the repair as usual;
 * - a thrown review or repair (verification_unavailable: a provider error or
 *   structured output that did not parse) starts the next round fresh.
 *
 * Failures that another round cannot change stop at once. Rounds start only
 * while a whole one still fits before the caller's deadline, which leaves the
 * final review its own time.
 *
 * The single-gate logic in answer-gate.ts is unchanged; this only decides
 * whether to run it again, so the chat route owns its own time budget.
 */
const NOT_RETRYABLE = new Set(["answer_limit", "verification_context_limit", "repair_not_allowed"]);

export interface GateRound {
	round: number;
	/** In memory only: the last rejection's findings, never logged or stored. */
	priorReview?: AnswerReview;
	timeoutMs: number;
}

export interface GateRetryBudget {
	/** Milliseconds left before the pre-display gate must be finished. */
	remainingMs: () => number;
	/** Extra rounds after the first. */
	maxExtraRounds: number;
	/** A round starts only with at least this much time left. */
	minRoundMs: number;
	/** Upper bound for one round's own timeout. */
	maxRoundMs: number;
}

export async function gateWithRetries(run: (round: GateRound) => Promise<GatedAnswer>, budget: GateRetryBudget): Promise<GatedAnswer> {
	let result = await run({ round: 0, timeoutMs: Math.max(1000, Math.min(budget.maxRoundMs, budget.remainingMs())) });
	for (let round = 1; !result.verified && round <= budget.maxExtraRounds; round++) {
		if (result.issueCodes.some(code => NOT_RETRYABLE.has(code))) break;
		const remaining = budget.remainingMs();
		if (remaining < budget.minRoundMs) break;
		const next = await run({ round, priorReview: result.review, timeoutMs: Math.min(budget.maxRoundMs, remaining) });
		// Content-free diagnostics only: never the findings, draft or question.
		try {
			console.info("[scripture-gate-retry]", JSON.stringify({ round, verified: next.verified, priorFindings: Boolean(result.review), issues: next.issueCodes }));
		} catch { /* Diagnostics must not change the decision. */ }
		result = next;
	}
	return result;
}

/** A thrown gate step, named without its message (messages can quote content). */
export function gateErrorSummary(error: unknown): { name: string; statusCode?: number; finishReason?: string } {
	const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
	const name = typeof record.name === "string" ? record.name : typeof error;
	return {
		name,
		...(typeof record.statusCode === "number" ? { statusCode: record.statusCode } : {}),
		...(typeof record.finishReason === "string" ? { finishReason: record.finishReason } : {}),
	};
}
