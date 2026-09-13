import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeSubscription } from "./plans";

export const playBillingAvailable = () =>
  process.env.SUREWORD_USAGE_ENABLED === "true" &&
  process.env.SUREWORD_PLAY_BILLING_ENABLED === "true" &&
  Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);

/** One allowance follows the account, whichever store sold its subscription. */
export async function accountSubscription(
  userId: string,
  db: Pick<Prisma.TransactionClient, "billingSubscription" | "googlePlaySubscription"> = prisma,
) {
  const stripe = await db.billingSubscription.findUnique({ where: { userId } });
  const play = playBillingAvailable()
    ? await db.googlePlaySubscription.findUnique({ where: { userId } })
    : null;
  if (stripe && activeSubscription(stripe)) return { ...stripe, provider: "stripe" as const };
  if (play && activeSubscription(play)) return { ...play, provider: "google-play" as const };
  if (play && (!stripe || play.periodEnd > stripe.periodEnd)) return { ...play, provider: "google-play" as const };
  return stripe ? { ...stripe, provider: "stripe" as const } : null;
}
