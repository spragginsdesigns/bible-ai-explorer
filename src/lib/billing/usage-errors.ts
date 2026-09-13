export class IncludedAiLimitError extends Error {
  readonly name = "IncludedAiLimitError";
  constructor(
    message: string,
    public readonly status = 429,
    public readonly resetAt?: Date,
  ) {
    super(message);
  }
}
