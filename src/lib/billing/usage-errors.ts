export class IncludedAiLimitError extends Error {
  readonly name = "IncludedAiLimitError";
  readonly status: number;
  readonly resetAt?: Date;
  /**
   * Set only on the used-up daily or monthly allowance, so a client can offer
   * Free readers the upgrade there and nowhere else (not on a burst limit, a
   * duplicate send or an oversized request).
   */
  readonly plan?: "free" | "pro";
  // Plain fields rather than parameter properties, so the node test runner's
  // type stripping can load this file.
  constructor(message: string, status = 429, resetAt?: Date, plan?: "free" | "pro") {
    super(message);
    this.status = status;
    this.resetAt = resetAt;
    this.plan = plan;
  }
}

/** The JSON body every refused included request answers with: the chat error contract plus the reset and, for a used-up allowance, the plan. */
export function includedLimitBody(error: IncludedAiLimitError): {
  error: string;
  code: "rate_limited";
  resetAt?: string;
  plan?: "free" | "pro";
} {
  return {
    error: error.message,
    code: "rate_limited",
    resetAt: error.resetAt?.toISOString(),
    ...(error.plan ? { plan: error.plan } : {}),
  };
}
