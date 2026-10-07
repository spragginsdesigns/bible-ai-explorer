import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activeSubscription } from "./plans";
import { appStoreConfig, asAccountSubscription, pickAppStoreRow } from "./app-store-rules";

export const playBillingAvailable = () =>
  process.env.SUREWORD_USAGE_ENABLED === "true" &&
  process.env.SUREWORD_PLAY_BILLING_ENABLED === "true" &&
  Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);

/** True when StoreKit purchases can be verified and will count toward Pro. */
export const appStoreBillingAvailable = () => appStoreConfig().available;

/** One allowance follows the account, whichever store sold its subscription. */
export async function accountSubscription(
  userId: string,
  db: Pick<Prisma.TransactionClient, "billingSubscription" | "googlePlaySubscription" | "appStoreSubscription"> = prisma,
) {
  const stripe = await db.billingSubscription.findUnique({ where: { userId } });
  const play = playBillingAvailable()
    ? await db.googlePlaySubscription.findUnique({ where: { userId } })
    : null;
  const appStoreRow = appStoreBillingAvailable()
    ? pickAppStoreRow(await db.appStoreSubscription.findMany({ where: { userId } }))
    : null;
  const appStore = appStoreRow ? { ...appStoreRow, ...asAccountSubscription(appStoreRow) } : null;
  if (stripe && activeSubscription(stripe)) return { ...stripe, provider: "stripe" as const };
  if (play && activeSubscription(play)) return { ...play, provider: "google-play" as const };
  if (appStore && activeSubscription(appStore)) return appStore;
  // Nothing active: report the store whose history ends last (Stripe on ties).
  const lapsed = [
    stripe ? { ...stripe, provider: "stripe" as const } : null,
    play ? { ...play, provider: "google-play" as const } : null,
    appStore,
  ].filter((row) => row !== null);
  return lapsed.reduce<(typeof lapsed)[number] | null>(
    (best, row) => (!best || row.periodEnd > best.periodEnd ? row : best),
    null,
  );
}
