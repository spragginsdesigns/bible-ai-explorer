/** Public plan terms. Prices are integer USD cents, never client-supplied. */
export const PRO_MONTHLY_PRICE_CENTS = 1500;
export const FREE_DAILY_MESSAGES = 10;
export const PRO_DAILY_MESSAGES = 50;
export const PRO_MONTHLY_MESSAGES = 600;
export const INCLUDED_MODEL = "openai/gpt-5.6-luna";

export function utcDayWindow(now: Date) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function calendarMonthWindow(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export function activeSubscription(
  input: { status: string; periodEnd: Date },
  now = new Date(),
): boolean {
  return (
    (input.status === "active" || input.status === "trialing") &&
    input.periodEnd > now
  );
}

export function quotaDecision(input: {
  pro: boolean;
  daily: number;
  monthly: number;
}) {
  const dailyLimit = input.pro ? PRO_DAILY_MESSAGES : FREE_DAILY_MESSAGES;
  const monthlyLimit = input.pro ? PRO_MONTHLY_MESSAGES : null;
  return {
    allowed:
      input.daily < dailyLimit &&
      (monthlyLimit === null || input.monthly < monthlyLimit),
    dailyLimit,
    monthlyLimit,
    dailyRemaining: Math.max(0, dailyLimit - input.daily),
    monthlyRemaining:
      monthlyLimit === null ? null : Math.max(0, monthlyLimit - input.monthly),
  };
}
